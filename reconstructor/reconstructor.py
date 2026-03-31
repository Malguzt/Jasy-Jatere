import os
import sys
import cv2
import torch
import numpy as np
import threading
import time
import subprocess
import signal
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

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

# Global store for active reconstruction processes
# stream_id -> client count
active_streams = {}
OUTPUT_WIDTH = 1280
OUTPUT_HEIGHT = 720
MOTION_API_BASE = os.environ.get("MOTION_API_BASE", "http://localhost:4000/api/camera-motion")
MOTION_POLL_INTERVAL = 0.6
MOTION_HOLD_SECONDS = 5.0
MOTION_API_TIMEOUT = 1.5

# Global shared model to save VRAM when multiple cameras are using the same arch
shared_model = None
model_init_attempted = False
model_init_error = None
model_lock = threading.Lock()
gpu_assign_lock = threading.Lock()
gpu_stream_counts = {}
camera_gpu_assignment = {}
camera_gpu_refcounts = {}

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
            "-fflags", "+nobuffer+discardcorrupt",
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

    def read(self):
        if not self.is_opened():
            return False, None
        raw = bytearray()
        while len(raw) < self.frame_size:
            chunk = self.process.stdout.read(self.frame_size - len(raw))
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

class AIReconstructor:
    def __init__(self, cam_id, main_url, sub_url, output_pipe):
        self.cam_id = cam_id
        self.main_url = main_url
        self.sub_url = sub_url
        self.output_pipe = output_pipe
        self.stop_event = threading.Event()
        self.window_size = 5 # Small window for lower latency
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
        self.motion_active = True
        self.last_motion_ts = 0.0
        self.last_mode = "enhanced"

    def get_motion_active(self):
        now = time.time()
        if (now - self.motion_poll_ts) < MOTION_POLL_INTERVAL:
            if self.last_motion_ts > 0 and (now - self.last_motion_ts) <= MOTION_HOLD_SECONDS:
                return True, "camera-events"
            return self.motion_active, "camera-events-cache"

        self.motion_poll_ts = now
        motion = None
        source = "camera-events-unavailable"

        try:
            resp = requests.get(f"{MOTION_API_BASE}/{self.cam_id}", timeout=MOTION_API_TIMEOUT)
            if resp.ok:
                data = resp.json()
                if data.get("success"):
                    motion = bool(data.get("motion", False))
                    source = "camera-events"
        except Exception:
            motion = None

        if motion is None:
            if self.last_motion_ts > 0 and (now - self.last_motion_ts) <= MOTION_HOLD_SECONDS:
                self.motion_active = True
            else:
                self.motion_active = False
            return self.motion_active, source

        if motion:
            self.last_motion_ts = now
            self.motion_active = True
        else:
            self.motion_active = (self.last_motion_ts > 0 and (now - self.last_motion_ts) <= MOTION_HOLD_SECONDS)

        return self.motion_active, source

    def release_device(self):
        if not self.device_released and self.device_index is not None:
            release_cuda_device(self.cam_id)
            self.device_released = True

    def run(self):
        print(f"[RECON] Tentando abrir streams para {self.main_url[:40]}...", flush=True)
        cap_main = None
        cap_sub = None
        ff_main = None
        ff_sub = None
        use_ffmpeg_reader = False
        single_stream_mode = False

        def enable_ffmpeg_fallback():
            nonlocal ff_main, ff_sub, use_ffmpeg_reader, single_stream_mode
            same_source = (self.main_url == self.sub_url)
            ff_main = FFmpegRawReader(self.main_url, OUTPUT_WIDTH, OUTPUT_HEIGHT, transport="tcp")
            if same_source:
                ff_sub = ff_main
                if not ff_main.is_opened():
                    return False
                single_stream_mode = True
                use_ffmpeg_reader = True
                print("[WARN] Main/Sub URL idénticas. Modo single-stream activado.", flush=True)
                return True

            ff_sub = FFmpegRawReader(self.sub_url, OUTPUT_WIDTH, OUTPUT_HEIGHT, transport="tcp")
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

        main_ok = False
        sub_ok = False
        same_source = (self.main_url == self.sub_url)

        if same_source:
            print("[WARN] Main/Sub URL idénticas detectadas. Se evitará fusión dual.", flush=True)
            single_stream_mode = True

        # Prefer FFmpeg raw readers (more stable than OpenCV for many RTSP cameras).
        ff_ok = enable_ffmpeg_fallback()
        if ff_ok:
            use_ffmpeg_reader = True
            main_ok = True
            sub_ok = True
        else:
            # If FFmpeg readers fail, fallback to OpenCV.
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

        # Fallback: continue with single-stream mode if one source is unavailable.
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

        buffer_main = []
        
        # Output FFmpeg process to encode raw frames to MPEG-TS for the Node.js backend
        ffmpeg_cmd = [
            'ffmpeg', '-y',
            '-f', 'rawvideo',
            '-vcodec', 'rawvideo',
            '-s', '1280x720',
            '-pix_fmt', 'bgr24',
            '-r', '20',
            '-i', '-',
            '-f', 'mpegts',
            '-codec:v', 'mpeg1video',
            '-b:v', '2000k',
            '-bf', '0',
            '-muxdelay', '0.001',
            '-'
        ]
        
        try:
            print("[RECON] Opening FFmpeg output pipe...")
            ffmpeg_proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stdout=self.output_pipe)
        except Exception as e:
            print(f"[ERR] Failed to start FFmpeg: {e}")
            return

        print("[RECON] Entering main loop...")
        empty_reads = 0
        while not self.stop_event.is_set():
            motion_active, motion_source = self.get_motion_active()
            mode = "enhanced" if motion_active else "idle-lowres"
            if mode != self.last_mode:
                print(f"[RECON] {self.cam_id}: mode={mode} source={motion_source}", flush=True)
                self.last_mode = mode

            if use_ffmpeg_reader:
                if mode == "enhanced" and not single_stream_mode:
                    ret_m, frame_m = ff_main.read()
                    ret_s, frame_s = ff_sub.read()
                else:
                    low_reader = ff_sub if ff_sub and ff_sub.is_opened() else ff_main
                    ret_s, frame_s = low_reader.read()
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
                # If OpenCV claims stream is open but delivers no frames, switch to ffmpeg fallback.
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
                
            # 1. Implementation of "Dual Stream Fusion" 
            # Concept: Use high-res frame but enhance with information from sub-stream 
            # and temporal frames via BasicVSR++
            
            # For this version, we combine them into a single image to "trick" the VSR 
            # or we run VSR and then blend.
            
            # Simple AI-Assisted Blending (Place-holder for heavy model inference)
            # This simulates the "alignment + fusion" steps mentioned by GPT
            combined = self.process_frame(frame_m, frame_s, enhance=(mode == "enhanced"))
            
            try:
                ffmpeg_proc.stdin.write(combined.tobytes())
            except BrokenPipeError:
                break
            except Exception as e:
                print(f"[ERR] Pipe error: {e}")
                break

        print("[RECON] Cleaning up...")
        if use_ffmpeg_reader:
            if ff_main:
                ff_main.release()
            if ff_sub and ff_sub is not ff_main:
                ff_sub.release()
            if cap_main:
                cap_main.release()
            if cap_sub and cap_sub is not cap_main:
                cap_sub.release()
        else:
            if cap_main:
                cap_main.release()
            if cap_sub and cap_sub is not cap_main:
                cap_sub.release()
        ffmpeg_proc.terminate()

    @staticmethod
    def frame_looks_corrupted(frame):
        if frame is None or frame.ndim != 3 or frame.size == 0:
            return True
        mean = float(frame.mean())
        std = float(frame.std())
        return mean < 3.0 or mean > 252.0 or std < 2.0

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
            return np.zeros((target_size[1], target_size[0], 3), dtype=np.uint8)
        if main_bad:
            main = sub.copy()
        if sub_bad:
            sub = main.copy()

        # Idle mode: keep only low-res/sub stream to reduce GPU usage and skip fusion.
        if not enhance:
            idle = sub if not self.frame_looks_corrupted(sub) else main
            idle = cv2.resize(idle, target_size, interpolation=cv2.INTER_LINEAR)
            self.last_good_frame = idle
            return idle
        
        # EFFICIENCY FIRST: 
        # If the AI model is available, use it for deep reconstruction.
        # Otherwise, use high-speed weighted fusion with laplacian enhancement.
        if self.model:
            # Deep Fusion Placeholder
            # (In a real scenario, we'd pass the window of frames to self.model.infer)
            # For efficiency and multi-camera support, we skip deep inference 
            # if the queue is backing up (to be implemented later).
            pass

        # Fast Fusion Path (Always used as base/fallback)
        # If CUDA is available, do the blend in GPU tensors to actually use NVIDIA devices.
        if self.device.startswith("cuda"):
            main_t = torch.from_numpy(main).to(device=self.device, dtype=torch.float16)
            sub_t = torch.from_numpy(sub).to(device=self.device, dtype=torch.float16)
            fused_t = (main_t * 0.82 + sub_t * 0.18).clamp(0, 255).to(torch.uint8)
            fused = fused_t.cpu().numpy()
        else:
            fused = cv2.addWeighted(main, 0.82, sub, 0.18, 0)
        
        # Safe unsharp mask (no positive bias that could blow up to white).
        blurred = cv2.GaussianBlur(fused, (0, 0), 1.0)
        enhanced = cv2.addWeighted(fused, 1.08, blurred, -0.08, 0)
        enhanced = np.clip(enhanced, 0, 255).astype(np.uint8)

        if self.frame_looks_corrupted(enhanced):
            enhanced = fused

        self.last_good_frame = enhanced
        return enhanced


@app.route('/health')
def health():
    with gpu_assign_lock:
        gpu_counts_snapshot = dict(gpu_stream_counts)
    active_clients = sum(active_streams.values()) if active_streams else 0
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
        "gpu_stream_counts": gpu_counts_snapshot
    })

from flask import Response

@app.route('/stream/<cam_id>')
def stream_video(cam_id):
    """
    Returns an MPEG-TS stream for a given camera.
    """
    main_url = request.args.get('main')
    sub_url = request.args.get('sub')
    
    print(f"[API] Stream request for {cam_id}: main={main_url[:40]}...", flush=True)

    def generate():
        # Setup local pipe for this specific request
        # We use a sub-shell to get the MPEG-TS bytes
        recon = AIReconstructor(cam_id, main_url, sub_url, None)
        active_streams[cam_id] = active_streams.get(cam_id, 0) + 1
        
        # We need a way to capture the output of the internal FFmpeg
        # Instead of sys.stdout, we'll use a pipe
        r, w = os.pipe()
        recon.output_pipe = os.fdopen(w, 'wb')
        
        thread = threading.Thread(target=recon.run)
        thread.start()
        
        try:
            with os.fdopen(r, 'rb') as pipe_in:
                while not recon.stop_event.is_set():
                    data = pipe_in.read(4096)
                    if not data: break
                    yield data
        finally:
            recon.stop_event.set()
            thread.join()
            recon.release_device()
            active_streams[cam_id] = max(0, active_streams.get(cam_id, 1) - 1)
            if active_streams[cam_id] == 0:
                active_streams.pop(cam_id, None)

    return Response(generate(), mimetype='video/mp2t')

if __name__ == "__main__":
    # Always run as a server to share VRAM efficiently
    print("=" * 60, flush=True)
    print("  AI Stream Reconstructor — MMagic Service", flush=True)
    print("  Port: 5001", flush=True)
    print("=" * 60, flush=True)
    app.run(host="0.0.0.0", port=5001, threaded=True)
