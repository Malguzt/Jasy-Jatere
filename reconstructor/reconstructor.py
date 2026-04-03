import os
import sys
import cv2
import torch
import numpy as np
import threading
import time
import subprocess
import signal
import select
import queue
from collections import deque
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from motion_client import CameraMotionClient

# Optional: Try to import MMagic if available
MMAGIC_IMPORT_ERROR = None
try:
    from mmagic.apis import MMagicInferencer
    HAS_MMAGIC = True
except Exception as e:
    MMAGIC_IMPORT_ERROR = f"{type(e).__name__}: {e}"
    HAS_MMAGIC = False
    print(f"[WARN] MMagic unavailable ({MMAGIC_IMPORT_ERROR}), falling back to fast fusion.")

app = Flask(__name__)
CORS(app)

def parse_bool_env(name, default=True):
    raw = os.getenv(name)
    if raw is None:
        return bool(default)
    normalized = str(raw).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return bool(default)

# Global store for active reconstruction processes
# stream_id -> client count
active_streams = {}
active_streams_lock = threading.Lock()
OUTPUT_WIDTH = 1280
OUTPUT_HEIGHT = 720
MAIN_INPUT_WIDTH = 1280
MAIN_INPUT_HEIGHT = 720
LOW_INPUT_WIDTH = 640
LOW_INPUT_HEIGHT = 360
CONTROL_PLANE_URL = (os.getenv("CONTROL_PLANE_URL", "http://localhost:4000") or "http://localhost:4000").rstrip("/")
MOTION_API_BASE = (os.environ.get("MOTION_API_BASE") or f"{CONTROL_PLANE_URL}/api/camera-motion").rstrip("/")
MOTION_POLL_INTERVAL = 0.6
MOTION_HOLD_SECONDS = 5.0
MOTION_API_TIMEOUT = 1.5
USE_CONTROL_PLANE_MOTION_API = parse_bool_env("USE_CONTROL_PLANE_MOTION_API", True)
REQUIRE_CONTROL_PLANE_MOTION_API = parse_bool_env("REQUIRE_CONTROL_PLANE_MOTION_API", True)
SOFT_MOTION_SIZE = (320, 180)
SOFT_MOTION_DELTA_THRESHOLD = 16
SOFT_MOTION_SCORE_THRESHOLD = 0.010
SOFT_MOTION_MIN_BLOB_RATIO = 0.0012
SOFT_MOTION_HOLD_SECONDS = 2.0
SOFT_MOTION_CYCLE_CORR_THRESHOLD = 0.86
TEMPORAL_WINDOW_SIZE = int(os.environ.get("TEMPORAL_WINDOW_SIZE", "5"))
TEMPORAL_MIN_FRAMES = int(os.environ.get("TEMPORAL_MIN_FRAMES", "3"))
TEMPORAL_DIFF_SIGMA = float(os.environ.get("TEMPORAL_DIFF_SIGMA", "18.0"))
TEMPORAL_CURRENT_BIAS = float(os.environ.get("TEMPORAL_CURRENT_BIAS", "1.35"))
RECON_OUTPUT_FPS = max(6, int(os.environ.get("RECON_OUTPUT_FPS", "20")))
SESSION_RESTART_DELAY_SEC = max(0.3, float(os.environ.get("RECON_SESSION_RESTART_DELAY_SEC", "1.5")))

# Global shared model to save VRAM when multiple cameras are using the same arch
shared_model = None
model_init_attempted = False
model_init_error = None
model_lock = threading.Lock()
gpu_assign_lock = threading.Lock()
gpu_stream_counts = {}
camera_gpu_assignment = {}
camera_gpu_refcounts = {}
motion_client = None


def get_motion_client():
    global motion_client
    if motion_client is None:
        motion_client = CameraMotionClient(
            motion_api_base=MOTION_API_BASE,
            timeout_sec=MOTION_API_TIMEOUT,
            use_control_plane_motion_api=USE_CONTROL_PLANE_MOTION_API,
            require_control_plane_motion_api=REQUIRE_CONTROL_PLANE_MOTION_API,
            http_get=requests.get,
            logger=print
        )
    return motion_client

class FFmpegRawReader:
    """Read BGR frames from an RTSP source via ffmpeg rawvideo pipe."""

    def __init__(self, url, width=OUTPUT_WIDTH, height=OUTPUT_HEIGHT, transport="tcp"):
        self.url = url
        self.width = width
        self.height = height
        self.frame_size = width * height * 3
        self.process = None

        cmd = [
            "ffmpeg",
            "-rtsp_transport", transport,
            "-analyzeduration", "10000000",
            "-probesize", "5000000",
            "-fflags", "+discardcorrupt",
            "-flags", "low_delay",
            "-err_detect", "ignore_err",
            "-i", url,
            "-an",
            "-sn",
            "-dn",
            "-vf", f"scale={width}:{height}",
            "-pix_fmt", "bgr24",
            "-f", "rawvideo",
            "-vcodec", "rawvideo",
            "-loglevel", "error",
            "-"
        ]
        try:
            self.process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                bufsize=10**7
            )
        except Exception:
            self.process = None

    def is_opened(self):
        return self.process is not None and self.process.poll() is None and self.process.stdout is not None

    def read(self, timeout_sec=8.0, stop_event=None):
        if not self.is_opened():
            return False, None
        raw = bytearray()
        fd = self.process.stdout.fileno()
        deadline = time.monotonic() + max(0.05, timeout_sec)
        while len(raw) < self.frame_size:
            if stop_event is not None and stop_event.is_set():
                return False, None
            if self.process.poll() is not None:
                return False, None

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False, None

            ready, _, _ = select.select([fd], [], [], min(0.2, remaining))
            if not ready:
                continue

            chunk = os.read(fd, self.frame_size - len(raw))
            if not chunk:
                return False, None
            raw.extend(chunk)
        frame = np.frombuffer(raw, dtype=np.uint8).reshape((self.height, self.width, 3)).copy()
        return True, frame

    def release(self):
        if self.process and self.process.poll() is None:
            self.process.terminate()
        self.process = None


def acquire_cuda_device(cam_id):
    if not torch.cuda.is_available():
        return "cpu", None

    total = torch.cuda.device_count()
    if total <= 0:
        return "cpu", None

    with gpu_assign_lock:
        idx = camera_gpu_assignment.get(cam_id)
        if idx is None:
            idx = min(range(total), key=lambda i: gpu_stream_counts.get(i, 0))
            camera_gpu_assignment[cam_id] = idx

        camera_gpu_refcounts[cam_id] = camera_gpu_refcounts.get(cam_id, 0) + 1
        gpu_stream_counts[idx] = gpu_stream_counts.get(idx, 0) + 1
        return f"cuda:{idx}", idx


def release_cuda_device(cam_id):
    with gpu_assign_lock:
        idx = camera_gpu_assignment.get(cam_id)
        if idx is None:
            return

        refs = camera_gpu_refcounts.get(cam_id, 0) - 1
        if refs <= 0:
            camera_gpu_refcounts.pop(cam_id, None)
            camera_gpu_assignment.pop(cam_id, None)
        else:
            camera_gpu_refcounts[cam_id] = refs

        active = gpu_stream_counts.get(idx, 0) - 1
        if active <= 0:
            gpu_stream_counts.pop(idx, None)
        else:
            gpu_stream_counts[idx] = active


def get_shared_model(device):
    global shared_model, model_init_attempted, model_init_error
    with model_lock:
        if model_init_attempted:
            return shared_model

        model_init_attempted = True
        if not HAS_MMAGIC:
            model_init_error = MMAGIC_IMPORT_ERROR or "MMagic import failed."
            return None

        if shared_model is None:
            try:
                print(f"[RECON] Loading GLOBAL BasicVSR++ on {device}...")
                shared_model = MMagicInferencer(model_name='basicvsr_plusplus', device=device)
                print("[RECON] BasicVSR++ loaded successfully.")
            except Exception as e:
                model_init_error = f"{type(e).__name__}: {e}"
                print(f"[ERR] Loading model error: {model_init_error}")
    return shared_model


def build_service_status_frame(cam_id, title, detail=None):
    frame = np.zeros((OUTPUT_HEIGHT, OUTPUT_WIDTH, 3), dtype=np.uint8)
    cv2.rectangle(frame, (0, 0), (OUTPUT_WIDTH, OUTPUT_HEIGHT), (20, 20, 20), -1)
    cv2.putText(
        frame,
        str(title)[:64],
        (40, OUTPUT_HEIGHT // 2 - 10),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.0,
        (220, 220, 220),
        2,
        cv2.LINE_AA
    )
    subtitle = (detail or f"Camera {cam_id}")[:96]
    cv2.putText(
        frame,
        subtitle,
        (40, OUTPUT_HEIGHT // 2 + 34),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (120, 220, 240),
        2,
        cv2.LINE_AA
    )
    return frame

class AIReconstructor:
    def __init__(self, cam_id, main_url, sub_url, output_pipe=None):
        self.cam_id = cam_id
        self.main_url = main_url
        self.sub_url = sub_url
        self.output_pipe = output_pipe
        self.stop_event = threading.Event()
        self.window_size = max(3, min(12, TEMPORAL_WINDOW_SIZE))
        self.last_good_frame = None
        self.device_released = False
        self.device, self.device_index = acquire_cuda_device(cam_id)
        self.device_count = torch.cuda.device_count() if torch.cuda.is_available() else 0
        self.gpu_name = torch.cuda.get_device_name(self.device_index) if self.device_index is not None else None
        print(
            f"[RECON] Device selected: {self.device} (cuda_available={torch.cuda.is_available()}, "
            f"device_count={self.device_count}{f', gpu={self.gpu_name}' if self.gpu_name else ''})",
            flush=True
        )
        self.model = get_shared_model(self.device)
        if self.device.startswith("cuda"):
            print("[RECON] GPU-accelerated fusion path enabled with torch CUDA.", flush=True)
        self.motion_poll_ts = 0.0
        self.motion_active = False
        self.last_motion_ts = 0.0
        self.last_mode = "enhanced"
        self.preferred_transport = os.environ.get("RTSP_TRANSPORT", "tcp").strip().lower() or "tcp"
        if self.preferred_transport not in {"tcp", "udp"}:
            self.preferred_transport = "tcp"
        self.camera_motion_healthy = False
        self.soft_motion_active = False
        self.soft_last_motion_ts = 0.0
        self.soft_prev_gray = None
        self.soft_motion_scores = deque(maxlen=120)
        self.temporal_min_frames = max(2, min(self.window_size, TEMPORAL_MIN_FRAMES))
        self.temporal_diff_sigma = max(1.0, TEMPORAL_DIFF_SIGMA)
        self.temporal_current_bias = max(1.0, TEMPORAL_CURRENT_BIAS)
        self.temporal_buffer = deque(maxlen=self.window_size)
        self.temporal_cuda_failed_once = False
        print(
            f"[RECON] Temporal enhancement configured (window={self.window_size}, "
            f"min_frames={self.temporal_min_frames}, sigma={self.temporal_diff_sigma:.2f})",
            flush=True
        )

    def get_motion_active(self):
        now = time.time()
        if (now - self.motion_poll_ts) < MOTION_POLL_INTERVAL:
            if self.camera_motion_healthy:
                if self.last_motion_ts > 0 and (now - self.last_motion_ts) <= MOTION_HOLD_SECONDS:
                    return True, "camera-events"
                return self.motion_active, "camera-events-cache"
            if self.soft_last_motion_ts > 0 and (now - self.soft_last_motion_ts) <= SOFT_MOTION_HOLD_SECONDS:
                return True, "software-motion"
            return self.soft_motion_active, "software-motion-cache"

        self.motion_poll_ts = now
        motion = None
        source = "camera-events-unavailable"
        healthy = False

        motion_state = get_motion_client().get_motion(self.cam_id)
        motion = motion_state.get("motion")
        healthy = bool(motion_state.get("healthy", False))
        source = motion_state.get("source") or source

        if motion is None:
            self.camera_motion_healthy = False
            if motion_state.get("strict_unavailable"):
                self.motion_active = False
                return False, source
            if self.soft_last_motion_ts > 0 and (now - self.soft_last_motion_ts) <= SOFT_MOTION_HOLD_SECONDS:
                self.soft_motion_active = True
            self.motion_active = self.soft_motion_active
            return self.motion_active, "software-motion"

        if motion:
            self.last_motion_ts = now
            self.motion_active = True
        else:
            self.motion_active = (self.last_motion_ts > 0 and (now - self.last_motion_ts) <= MOTION_HOLD_SECONDS)
        self.camera_motion_healthy = healthy

        return self.motion_active, source

    def soft_motion_is_cyclic(self):
        if len(self.soft_motion_scores) < 40:
            return False
        scores = np.array(self.soft_motion_scores, dtype=np.float32)
        centered = scores - float(np.mean(scores))
        std = float(np.std(centered))
        if std < 1e-4:
            return False
        norm = centered / std
        max_lag = min(36, len(norm) - 4)
        if max_lag <= 6:
            return False
        best_corr = 0.0
        for lag in range(6, max_lag):
            x = norm[:-lag]
            y = norm[lag:]
            corr = float(np.dot(x, y) / max(1, len(x)))
            if corr > best_corr:
                best_corr = corr
        amp = float(np.percentile(scores, 90) - np.percentile(scores, 10))
        return best_corr >= SOFT_MOTION_CYCLE_CORR_THRESHOLD and amp < 0.08

    def update_soft_motion(self, frame):
        if frame is None or frame.size == 0:
            return self.soft_motion_active, 0.0, False
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, SOFT_MOTION_SIZE, interpolation=cv2.INTER_AREA)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)

        if self.soft_prev_gray is None:
            self.soft_prev_gray = gray
            self.soft_motion_scores.append(0.0)
            return False, 0.0, False

        delta = cv2.absdiff(gray, self.soft_prev_gray)
        self.soft_prev_gray = gray
        _, mask = cv2.threshold(delta, SOFT_MOTION_DELTA_THRESHOLD, 255, cv2.THRESH_BINARY)
        mask = cv2.medianBlur(mask, 3)
        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)

        active_ratio = float(np.count_nonzero(mask)) / float(mask.size)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        max_blob_ratio = 0.0
        if contours:
            max_blob = max(cv2.contourArea(c) for c in contours)
            max_blob_ratio = float(max_blob) / float(mask.size)

        score = 0.65 * active_ratio + 0.35 * max_blob_ratio
        self.soft_motion_scores.append(score)
        cyclic = self.soft_motion_is_cyclic()
        motion_now = (score >= SOFT_MOTION_SCORE_THRESHOLD and max_blob_ratio >= SOFT_MOTION_MIN_BLOB_RATIO and not cyclic)

        now = time.time()
        if motion_now:
            self.soft_last_motion_ts = now
            self.soft_motion_active = True
        else:
            self.soft_motion_active = (self.soft_last_motion_ts > 0 and (now - self.soft_last_motion_ts) <= SOFT_MOTION_HOLD_SECONDS)
        return self.soft_motion_active, score, cyclic

    def release_device(self):
        if not self.device_released and self.device_index is not None:
            release_cuda_device(self.cam_id)
            self.device_released = True

    def run_frame_loop(self, frame_callback):
        print(f"[RECON] Tentando abrir streams para {self.main_url[:40]}...", flush=True)
        cap_main = None
        cap_sub = None
        ff_main = None
        ff_sub = None
        use_ffmpeg_reader = False
        single_stream_mode = False
        current_transport = self.preferred_transport

        def deliver(frame):
            if frame is None:
                return True
            try:
                result = frame_callback(frame)
                if result is False:
                    return False
                return True
            except Exception as e:
                print(f"[ERR] Frame callback error: {e}", flush=True)
                return False

        def release_ffmpeg_readers():
            nonlocal ff_main, ff_sub
            if ff_main:
                ff_main.release()
            if ff_sub and ff_sub is not ff_main:
                ff_sub.release()
            ff_main = None
            ff_sub = None

        def enable_ffmpeg_fallback():
            nonlocal ff_main, ff_sub, use_ffmpeg_reader, single_stream_mode
            same_source = (self.main_url == self.sub_url)
            if same_source:
                ff_main = FFmpegRawReader(
                    self.main_url,
                    LOW_INPUT_WIDTH,
                    LOW_INPUT_HEIGHT,
                    transport=current_transport
                )
                if not ff_main.is_opened():
                    return False
                single_stream_mode = True
                use_ffmpeg_reader = True
                ff_sub = ff_main
                print(
                    f"[WARN] Main/Sub URL idénticas. Modo single-stream activado (transport={current_transport}).",
                    flush=True
                )
                return True

            ff_main = FFmpegRawReader(
                self.main_url,
                MAIN_INPUT_WIDTH,
                MAIN_INPUT_HEIGHT,
                transport=current_transport
            )
            ff_sub = FFmpegRawReader(
                self.sub_url,
                LOW_INPUT_WIDTH,
                LOW_INPUT_HEIGHT,
                transport=current_transport
            )
            main_ff_ok = ff_main.is_opened()
            sub_ff_ok = ff_sub.is_opened()
            if not main_ff_ok and not sub_ff_ok:
                return False
            single_stream_mode = False
            if not main_ff_ok and sub_ff_ok:
                ff_main = ff_sub
                single_stream_mode = True
                print("[WARN] Main stream unavailable (FFmpeg). Falling back to sub stream only.", flush=True)
            elif main_ff_ok and not sub_ff_ok:
                single_stream_mode = True
                print("[WARN] Sub stream unavailable (FFmpeg). Falling back to main stream only.", flush=True)
            use_ffmpeg_reader = True
            return True

        def restart_ffmpeg_fallback():
            nonlocal use_ffmpeg_reader
            release_ffmpeg_readers()
            use_ffmpeg_reader = False
            return enable_ffmpeg_fallback()

        main_ok = False
        sub_ok = False
        same_source = (self.main_url == self.sub_url)

        if same_source:
            print("[WARN] Main/Sub URL idénticas detectadas. Se evitará fusión dual.", flush=True)
            single_stream_mode = True

        ff_ok = enable_ffmpeg_fallback()
        if ff_ok:
            use_ffmpeg_reader = True
            main_ok = True
            sub_ok = True
        else:
            use_ffmpeg_reader = False
            cap_main = cv2.VideoCapture(self.main_url)
            cap_sub = cv2.VideoCapture(self.sub_url)
            main_ok = cap_main.isOpened()
            sub_ok = cap_sub.isOpened()

        if not main_ok and not sub_ok:
            print(f"[ERR] Falha ao abrir streams. Main: {main_ok}, Sub: {sub_ok}", flush=True)
            if cap_main:
                cap_main.release()
            if cap_sub and cap_sub is not cap_main:
                cap_sub.release()
            if ff_main:
                ff_main.release()
            if ff_sub:
                ff_sub.release()
            return

        if not main_ok and sub_ok:
            print("[WARN] Main stream unavailable. Falling back to sub stream only.", flush=True)
            if use_ffmpeg_reader:
                ff_main = ff_sub
            else:
                cap_main = cap_sub
            single_stream_mode = True
        elif main_ok and not sub_ok:
            print("[WARN] Sub stream unavailable. Falling back to main stream only.", flush=True)
            single_stream_mode = True

        print(f"[RECON] Streams abiertos. Iniciando loop...", flush=True)
        bootstrap = self.build_status_frame("Iniciando stream", f"Camera {self.cam_id}")
        if not deliver(bootstrap):
            return

        empty_reads = 0
        ever_received_frame = False
        while not self.stop_event.is_set():
            motion_active, motion_source = self.get_motion_active()
            mode = "enhanced" if motion_active else "idle-lowres"
            if mode != self.last_mode:
                print(f"[RECON] {self.cam_id}: mode={mode} source={motion_source}", flush=True)
                self.last_mode = mode

            if use_ffmpeg_reader:
                read_timeout = 2.5 if not ever_received_frame else 6.0
                if mode == "enhanced" and not single_stream_mode:
                    ret_m, frame_m = ff_main.read(timeout_sec=read_timeout, stop_event=self.stop_event)
                    ret_s, frame_s = ff_sub.read(timeout_sec=read_timeout, stop_event=self.stop_event)
                else:
                    low_reader = ff_sub if ff_sub and ff_sub.is_opened() else (ff_main if ff_main and ff_main.is_opened() else None)
                    if low_reader is None:
                        ret_s, frame_s = False, None
                    else:
                        ret_s, frame_s = low_reader.read(timeout_sec=read_timeout, stop_event=self.stop_event)
                    ret_m, frame_m = ret_s, frame_s
            else:
                if mode == "enhanced" and not single_stream_mode:
                    ret_m, frame_m = cap_main.read()
                    ret_s, frame_s = cap_sub.read()
                else:
                    low_cap = cap_sub if cap_sub.isOpened() else cap_main
                    ret_s, frame_s = low_cap.read()
                    ret_m, frame_m = ret_s, frame_s

            if not ret_m or not ret_s:
                empty_reads += 1
                fallback = self.render_idle_frame(None, None) if mode != "enhanced" else (
                    self.last_good_frame if self.last_good_frame is not None else self.build_status_frame(
                        "Sin video util", f"Reintentando cam {self.cam_id}"
                    )
                )
                if not deliver(fallback):
                    break

                ffmpeg_retry_threshold = 6 if not ever_received_frame else 20
                if use_ffmpeg_reader and empty_reads >= ffmpeg_retry_threshold:
                    print(
                        f"[WARN] FFmpeg raw reader stalled on {current_transport.upper()}. "
                        f"Restarting reader...",
                        flush=True
                    )
                    if not restart_ffmpeg_fallback():
                        next_transport = "udp" if current_transport == "tcp" else "tcp"
                        print(
                            f"[WARN] FFmpeg restart failed on {current_transport.upper()}. "
                            f"Trying {next_transport.upper()}...",
                            flush=True
                        )
                        current_transport = next_transport
                        if not restart_ffmpeg_fallback():
                            print("[ERR] Unable to recover FFmpeg raw readers.", flush=True)
                            break
                    empty_reads = 0
                    continue

                if not use_ffmpeg_reader and empty_reads >= 60:
                    print("[WARN] OpenCV stream stalled. Switching to FFmpeg raw readers...", flush=True)
                    cap_main.release()
                    if cap_sub is not cap_main:
                        cap_sub.release()
                    if not enable_ffmpeg_fallback():
                        print("[ERR] FFmpeg fallback could not be initialized.", flush=True)
                        break
                    empty_reads = 0
                time.sleep(0.01)
                continue

            empty_reads = 0
            ever_received_frame = True
            soft_frame = frame_s if frame_s is not None else frame_m
            soft_motion, _, soft_cyclic = self.update_soft_motion(soft_frame)
            if not self.camera_motion_healthy:
                self.motion_active = soft_motion
                mode = "enhanced" if self.motion_active else "idle-lowres"
                motion_source = "software-motion-cyclic-filter" if soft_cyclic else "software-motion"

            if mode != "enhanced":
                idle_frame = self.render_idle_frame(frame_s, frame_m)
                if not deliver(idle_frame):
                    break
                continue

            combined = self.process_frame(frame_m, frame_s, enhance=True)
            if not deliver(combined):
                break

        print("[RECON] Cleaning up...", flush=True)
        if use_ffmpeg_reader:
            release_ffmpeg_readers()
            if cap_main:
                cap_main.release()
            if cap_sub and cap_sub is not cap_main:
                cap_sub.release()
        else:
            if cap_main:
                cap_main.release()
            if cap_sub and cap_sub is not cap_main:
                cap_sub.release()

    def run(self):
        if self.output_pipe is None:
            return self.run_frame_loop(lambda _frame: True)

        ffmpeg_cmd = [
            'ffmpeg', '-y',
            '-f', 'rawvideo',
            '-vcodec', 'rawvideo',
            '-s', f'{OUTPUT_WIDTH}x{OUTPUT_HEIGHT}',
            '-pix_fmt', 'bgr24',
            '-r', str(RECON_OUTPUT_FPS),
            '-i', '-',
            '-f', 'mpegts',
            '-codec:v', 'mpeg1video',
            '-b:v', '2000k',
            '-bf', '0',
            '-muxdelay', '0.001',
            '-'
        ]

        ffmpeg_proc = None
        try:
            ffmpeg_proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stdout=self.output_pipe)
        except Exception as e:
            print(f"[ERR] Failed to start FFmpeg encoder: {e}", flush=True)
            return

        def on_frame(frame):
            try:
                ffmpeg_proc.stdin.write(frame.tobytes())
                return True
            except BrokenPipeError:
                return False
            except Exception as e:
                print(f"[ERR] Pipe error: {e}", flush=True)
                return False

        try:
            self.run_frame_loop(on_frame)
        finally:
            try:
                if ffmpeg_proc and ffmpeg_proc.stdin:
                    ffmpeg_proc.stdin.close()
            except Exception:
                pass
            try:
                if ffmpeg_proc:
                    ffmpeg_proc.terminate()
                    ffmpeg_proc.wait(timeout=2)
            except Exception:
                try:
                    if ffmpeg_proc:
                        ffmpeg_proc.kill()
                except Exception:
                    pass
            if self.output_pipe:
                try:
                    self.output_pipe.close()
                except Exception:
                    pass

    @staticmethod
    def frame_looks_corrupted(frame):
        if frame is None or frame.ndim != 3 or frame.size == 0:
            return True
        mean = float(frame.mean())
        std = float(frame.std())
        return mean < 3.0 or mean > 252.0 or std < 2.0

    def build_status_frame(self, title, detail=None):
        frame = np.zeros((OUTPUT_HEIGHT, OUTPUT_WIDTH, 3), dtype=np.uint8)
        cv2.rectangle(frame, (0, 0), (OUTPUT_WIDTH, OUTPUT_HEIGHT), (20, 20, 20), -1)
        cv2.putText(
            frame,
            title[:64],
            (40, OUTPUT_HEIGHT // 2 - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (220, 220, 220),
            2,
            cv2.LINE_AA
        )
        subtitle = (detail or f"Camera {self.cam_id}")[:96]
        cv2.putText(
            frame,
            subtitle,
            (40, OUTPUT_HEIGHT // 2 + 34),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (120, 220, 240),
            2,
            cv2.LINE_AA
        )
        return frame

    def temporal_multi_frame_enhance(self, current_frame):
        if current_frame is None or current_frame.size == 0:
            return current_frame

        self.temporal_buffer.append(current_frame.copy())
        if len(self.temporal_buffer) < self.temporal_min_frames:
            return current_frame

        frames = list(self.temporal_buffer)
        current = frames[-1].astype(np.float32)
        history = frames[:-1]
        if not history:
            return current_frame

        if self.device.startswith("cuda"):
            try:
                cur_t = torch.from_numpy(current).to(device=self.device, dtype=torch.float32)
                hist_t = torch.stack(
                    [torch.from_numpy(f.astype(np.float32)).to(device=self.device, dtype=torch.float32) for f in history],
                    dim=0
                )
                diff = torch.mean(torch.abs(hist_t - cur_t.unsqueeze(0)), dim=3, keepdim=True)
                hist_w = torch.exp(-diff / self.temporal_diff_sigma).clamp(min=0.03, max=1.0)
                cur_w = torch.full(
                    (1, cur_t.shape[0], cur_t.shape[1], 1),
                    self.temporal_current_bias,
                    device=self.device,
                    dtype=torch.float32
                )
                frame_stack = torch.cat([hist_t, cur_t.unsqueeze(0)], dim=0)
                weight_stack = torch.cat([hist_w, cur_w], dim=0)
                fused = (frame_stack * weight_stack).sum(dim=0) / torch.clamp(weight_stack.sum(dim=0), min=1e-4)
                return fused.clamp(0, 255).to(torch.uint8).cpu().numpy()
            except Exception as e:
                if not self.temporal_cuda_failed_once:
                    print(f"[WARN] Temporal CUDA enhancement failed, switching to CPU: {e}", flush=True)
                    self.temporal_cuda_failed_once = True

        hist_np = np.stack([f.astype(np.float32) for f in history], axis=0)
        diff_np = np.mean(np.abs(hist_np - current[None, ...]), axis=3, keepdims=True)
        hist_w_np = np.exp(-diff_np / self.temporal_diff_sigma).astype(np.float32)
        hist_w_np = np.clip(hist_w_np, 0.03, 1.0)
        cur_w_np = np.full(
            (1, current.shape[0], current.shape[1], 1),
            self.temporal_current_bias,
            dtype=np.float32
        )
        frames_np = np.concatenate([hist_np, current[None, ...]], axis=0)
        weights_np = np.concatenate([hist_w_np, cur_w_np], axis=0)
        fused_np = np.sum(frames_np * weights_np, axis=0) / np.clip(np.sum(weights_np, axis=0), 1e-4, None)
        return np.clip(fused_np, 0, 255).astype(np.uint8)

    def process_frame(self, main, sub, enhance=True):
        """
        Logic to fuse information from main and sub streams efficiently.
        """
        # Targeted size for the combined output
        target_size = (OUTPUT_WIDTH, OUTPUT_HEIGHT) 
        
        # Optimization: Only resize the lower-res sub stream if it's different
        # Usually 'main' is already high-res but compressed.
        if main.shape[0] != target_size[1] or main.shape[1] != target_size[0]:
            main = cv2.resize(main, target_size, interpolation=cv2.INTER_LANCZOS4)
        
        sub = cv2.resize(sub, target_size, interpolation=cv2.INTER_LINEAR)

        main_bad = self.frame_looks_corrupted(main)
        sub_bad = self.frame_looks_corrupted(sub)
        if main_bad and sub_bad:
            if self.last_good_frame is not None:
                return self.last_good_frame
            return self.build_status_frame("Sin señal", f"Camera {self.cam_id}")
        if main_bad:
            main = sub.copy()
        if sub_bad:
            sub = main.copy()

        # Idle mode: keep only low-res/sub stream to reduce GPU usage and skip fusion.
        if not enhance:
            idle = sub if not self.frame_looks_corrupted(sub) else main
            idle = cv2.resize(idle, target_size, interpolation=cv2.INTER_LINEAR)
            self.temporal_buffer.append(idle.copy())
            self.last_good_frame = idle
            return idle

        # Fast Fusion Path (Always used as base/fallback)
        # If CUDA is available, do the blend in GPU tensors to actually use NVIDIA devices.
        if self.device.startswith("cuda"):
            main_t = torch.from_numpy(main).to(device=self.device, dtype=torch.float16)
            sub_t = torch.from_numpy(sub).to(device=self.device, dtype=torch.float16)
            fused_t = (main_t * 0.82 + sub_t * 0.18).clamp(0, 255).to(torch.uint8)
            fused = fused_t.cpu().numpy()
        else:
            fused = cv2.addWeighted(main, 0.82, sub, 0.18, 0)

        # Dynamic temporal enhancement using N previous frames.
        fused = self.temporal_multi_frame_enhance(fused)
        
        # Safe unsharp mask (no positive bias that could blow up to white).
        blurred = cv2.GaussianBlur(fused, (0, 0), 1.0)
        enhanced = cv2.addWeighted(fused, 1.08, blurred, -0.08, 0)
        enhanced = np.clip(enhanced, 0, 255).astype(np.uint8)

        if self.frame_looks_corrupted(enhanced):
            enhanced = fused

        self.last_good_frame = enhanced
        return enhanced

    def render_idle_frame(self, low_frame, hi_frame=None):
        target_size = (OUTPUT_WIDTH, OUTPUT_HEIGHT)
        if low_frame is not None and not self.frame_looks_corrupted(low_frame):
            chosen = low_frame
        elif hi_frame is not None and not self.frame_looks_corrupted(hi_frame):
            chosen = hi_frame
        elif self.last_good_frame is not None:
            return self.last_good_frame
        else:
            return self.build_status_frame("Sin video util", f"Reintentando cam {self.cam_id}")

        if chosen.shape[0] != target_size[1] or chosen.shape[1] != target_size[0]:
            chosen = cv2.resize(chosen, target_size, interpolation=cv2.INTER_LINEAR)
        self.last_good_frame = chosen
        return chosen


class SharedReconstructorSession:
    def __init__(self, cam_id, main_url, sub_url):
        self.cam_id = str(cam_id)
        self.main_url = main_url
        self.sub_url = sub_url or main_url
        self.stop_event = threading.Event()
        self.frame_cond = threading.Condition()
        self.latest_frame = build_service_status_frame(self.cam_id, "Iniciando stream", f"Camera {self.cam_id}")
        self.latest_seq = 0
        self.last_frame_ts = time.time()
        self.worker_alive = False
        self.worker_restarts = 0
        self.last_error = None
        self.created_at = time.time()
        self.clients = 0
        self.worker_thread = threading.Thread(target=self._worker_loop, daemon=True)
        self.worker_thread.start()

    def matches(self, main_url, sub_url):
        return self.main_url == main_url and self.sub_url == (sub_url or main_url)

    def _publish_frame(self, frame):
        with self.frame_cond:
            self.latest_frame = frame
            self.latest_seq += 1
            self.last_frame_ts = time.time()
            self.frame_cond.notify_all()

    def _worker_loop(self):
        while not self.stop_event.is_set():
            recon = None
            try:
                self.worker_alive = True
                recon = AIReconstructor(self.cam_id, self.main_url, self.sub_url, None)
                recon.stop_event = self.stop_event
                self._publish_frame(build_service_status_frame(self.cam_id, "Conectando", f"Camera {self.cam_id}"))

                def on_frame(frame):
                    self._publish_frame(frame)
                    return not self.stop_event.is_set()

                recon.run_frame_loop(on_frame)
                self.last_error = None
            except Exception as e:
                self.last_error = f"{type(e).__name__}: {e}"
                self._publish_frame(build_service_status_frame(self.cam_id, "Sin video util", f"Reintentando cam {self.cam_id}"))
                print(f"[RECON-SESSION] {self.cam_id} worker error: {self.last_error}", flush=True)
            finally:
                self.worker_alive = False
                if recon is not None:
                    recon.release_device()

            if self.stop_event.is_set():
                break
            self.worker_restarts += 1
            time.sleep(SESSION_RESTART_DELAY_SEC)

    def add_client(self):
        with self.frame_cond:
            self.clients += 1

    def remove_client(self):
        with self.frame_cond:
            self.clients = max(0, self.clients - 1)

    def get_frame(self, min_seq=-1, timeout=1.0):
        with self.frame_cond:
            if self.latest_seq <= min_seq and not self.stop_event.is_set():
                self.frame_cond.wait(timeout=timeout)
            frame = self.latest_frame
            seq = self.latest_seq
            if frame is None:
                frame = build_service_status_frame(self.cam_id, "Sin video util", f"Camera {self.cam_id}")
            return frame, seq

    def stop(self):
        self.stop_event.set()
        with self.frame_cond:
            self.frame_cond.notify_all()
        self.worker_thread.join(timeout=3.5)

    def snapshot(self):
        with self.frame_cond:
            return {
                "cam_id": self.cam_id,
                "main_url": self.main_url,
                "sub_url": self.sub_url,
                "clients": self.clients,
                "worker_alive": self.worker_alive,
                "worker_restarts": self.worker_restarts,
                "last_error": self.last_error,
                "last_frame_ts": self.last_frame_ts,
                "created_at": self.created_at
            }


class SharedSessionManager:
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()

    def ensure_session(self, cam_id, main_url, sub_url):
        cam_key = str(cam_id)
        with self.lock:
            current = self.sessions.get(cam_key)
            if current and current.matches(main_url, sub_url):
                return current
            if current:
                current.stop()
                self.sessions.pop(cam_key, None)
            created = SharedReconstructorSession(cam_key, main_url, sub_url)
            self.sessions[cam_key] = created
            return created

    def get_session(self, cam_id):
        with self.lock:
            return self.sessions.get(str(cam_id))

    def configure(self, streams, prune=False):
        ensured = []
        desired_ids = set()
        for item in streams or []:
            cam_id = str(item.get("id", "")).strip()
            main_url = item.get("main")
            sub_url = item.get("sub") or main_url
            if not cam_id or not main_url:
                continue
            desired_ids.add(cam_id)
            sess = self.ensure_session(cam_id, main_url, sub_url)
            ensured.append(sess.snapshot())

        if prune:
            with self.lock:
                to_stop = [cid for cid in self.sessions.keys() if cid not in desired_ids]
            for cid in to_stop:
                self.drop_session(cid)

        return ensured

    def drop_session(self, cam_id):
        with self.lock:
            sess = self.sessions.pop(str(cam_id), None)
        if sess:
            sess.stop()
            return True
        return False

    def snapshot(self):
        with self.lock:
            entries = [s.snapshot() for s in self.sessions.values()]
        return {
            "count": len(entries),
            "sessions": entries
        }


session_manager = SharedSessionManager()


@app.route('/health')
def health():
    with gpu_assign_lock:
        gpu_counts_snapshot = dict(gpu_stream_counts)
    with active_streams_lock:
        active_clients = sum(active_streams.values()) if active_streams else 0
    sessions_snapshot = session_manager.snapshot()
    return jsonify({
        "success": True,
        "cuda_available": torch.cuda.is_available(),
        "cuda_device_count": torch.cuda.device_count() if torch.cuda.is_available() else 0,
        "cuda_device_0": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "mmagic_available": HAS_MMAGIC,
        "mmagic_import_error": MMAGIC_IMPORT_ERROR,
        "model_loaded": shared_model is not None,
        "model_init_attempted": model_init_attempted,
        "model_init_error": model_init_error,
        "active_streams": active_clients,
        "gpu_stream_counts": gpu_counts_snapshot,
        "session_count": sessions_snapshot.get("count", 0),
        "sessions": sessions_snapshot.get("sessions", [])
    })

from flask import Response


@app.route('/sessions')
def sessions():
    return jsonify({"success": True, **session_manager.snapshot()})


@app.route('/configure', methods=['POST'])
def configure_sessions():
    try:
        payload = request.get_json(silent=True) or {}
        streams = payload.get('streams') or payload.get('cameras') or []
        prune = bool(payload.get('prune', False))
        ensured = session_manager.configure(streams, prune=prune)
        snap = session_manager.snapshot()
        return jsonify({
            "success": True,
            "configured": len(ensured),
            "session_count": snap.get("count", 0),
            "sessions": snap.get("sessions", [])
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/stream/<cam_id>')
def stream_video(cam_id):
    """
    Returns an MPEG-TS stream for a given camera.
    """
    main_url = request.args.get('main')
    sub_url = request.args.get('sub') or main_url

    if not main_url:
        existing = session_manager.get_session(cam_id)
        if existing:
            main_url = existing.main_url
            sub_url = existing.sub_url
        else:
            return jsonify({"success": False, "error": "main query param is required for first subscription"}), 400

    session = session_manager.ensure_session(cam_id, main_url, sub_url)
    print(f"[API] Stream request for {cam_id}: shared-session", flush=True)

    def generate():
        ffmpeg_cmd = [
            'ffmpeg', '-y',
            '-f', 'rawvideo',
            '-vcodec', 'rawvideo',
            '-s', f'{OUTPUT_WIDTH}x{OUTPUT_HEIGHT}',
            '-pix_fmt', 'bgr24',
            '-r', str(RECON_OUTPUT_FPS),
            '-i', '-',
            '-f', 'mpegts',
            '-codec:v', 'mpeg1video',
            '-b:v', '2000k',
            '-bf', '0',
            '-muxdelay', '0.001',
            '-'
        ]

        ffmpeg_proc = subprocess.Popen(
            ffmpeg_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            bufsize=10**6
        )

        stop_client = threading.Event()
        session.add_client()
        with active_streams_lock:
            active_streams[cam_id] = active_streams.get(cam_id, 0) + 1

        def feed_encoder():
            interval = 1.0 / float(RECON_OUTPUT_FPS)
            last_seq = -1
            last_frame = None
            while not stop_client.is_set():
                frame, seq = session.get_frame(min_seq=last_seq, timeout=1.0)
                if frame is not None and seq != last_seq:
                    last_frame = frame
                    last_seq = seq
                if last_frame is None:
                    last_frame = build_service_status_frame(cam_id, "Sin video util", f"Camera {cam_id}")
                try:
                    ffmpeg_proc.stdin.write(last_frame.tobytes())
                except Exception:
                    break
                time.sleep(interval)

        feeder = threading.Thread(target=feed_encoder, daemon=True)
        feeder.start()
        last_data_ts = time.monotonic()

        try:
            while True:
                if ffmpeg_proc.poll() is not None:
                    break
                ready, _, _ = select.select([ffmpeg_proc.stdout.fileno()], [], [], 1.0)
                if not ready:
                    if (time.monotonic() - last_data_ts) > 45.0:
                        print(f"[WARN] Stream {cam_id} produced no bytes for 45s. Closing request.", flush=True)
                        break
                    continue
                data = os.read(ffmpeg_proc.stdout.fileno(), 4096)
                if not data:
                    break
                last_data_ts = time.monotonic()
                yield data
        except GeneratorExit:
            pass
        finally:
            stop_client.set()
            feeder.join(timeout=2)
            session.remove_client()
            try:
                if ffmpeg_proc.stdin:
                    ffmpeg_proc.stdin.close()
            except Exception:
                pass
            try:
                ffmpeg_proc.terminate()
                ffmpeg_proc.wait(timeout=2)
            except Exception:
                try:
                    ffmpeg_proc.kill()
                except Exception:
                    pass
            with active_streams_lock:
                active_streams[cam_id] = max(0, active_streams.get(cam_id, 1) - 1)
                if active_streams[cam_id] == 0:
                    active_streams.pop(cam_id, None)

    return Response(generate(), mimetype='video/mp2t')


@app.route('/drop/<cam_id>', methods=['POST'])
def drop_session(cam_id):
    try:
        removed = session_manager.drop_session(cam_id)
        return jsonify({"success": True, "removed": bool(removed)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == "__main__":
    # Always run as a server to share VRAM efficiently
    print("=" * 60, flush=True)
    print("  AI Stream Reconstructor — MMagic Service", flush=True)
    print("  Port: 5001", flush=True)
    print("=" * 60, flush=True)
    app.run(host="0.0.0.0", port=5001, threaded=True)
