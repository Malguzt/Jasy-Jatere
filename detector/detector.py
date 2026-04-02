import os
import json
import time
import threading
import subprocess
import select
import re
import urllib.request
import urllib.error
import urllib.parse
from collections import deque

# Optional: Set global capture options if needed (currently commented out to allow auto-negotiation)
# os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

import cv2
import numpy as np
from datetime import datetime
from ultralytics import YOLO
from flask import Flask, jsonify, request
from flask_cors import CORS

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


def parse_positive_int_env(name, default):
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return int(default)
    try:
        value = int(raw)
        if value > 0:
            return value
    except Exception:
        pass
    return int(default)


def parse_positive_float_env(name, default):
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return float(default)
    try:
        value = float(raw)
        if value > 0:
            return value
    except Exception:
        pass
    return float(default)

# --- Configuration ---
DATA_FILE = "/app/data/cameras.json"
RECORDINGS_DIR = "/app/recordings"
RECORDINGS_INDEX_FILE = os.path.join(RECORDINGS_DIR, "recordings-index.json")
DEFAULT_RECORDINGS_MAX_SIZE_GB = parse_positive_float_env("RECORDINGS_MAX_SIZE_GB", 50)
DEFAULT_DELETE_OLDEST_BATCH = parse_positive_int_env("RECORDINGS_DELETE_OLDEST_BATCH", 100)
FRAME_INTERVAL = 0.5          # Capture 1 frame every 500ms (2 FPS)
MOTION_THRESHOLD = 25          # Pixel diff threshold for motion
MOTION_MIN_AREA = 0.01         # Min % of frame with motion to trigger
RECORD_DURATION = 60           # Record for 60 seconds
COOLDOWN_DURATION = 10         # Cooldown after false alarm
CONFIDENCE_THRESHOLD = 0.35    # YOLO confidence threshold
MOTION_API_BASE = "http://localhost:4000/api/camera-motion"
MOTION_CACHE_TTL = 1.0
WALL_CHECK_INTERVAL = 20.0
WALL_CONFIRMATIONS = 3
PTZ_SCAN_COOLDOWN = 12.0
PTZ_STEP_DURATION = 0.7
PTZ_DIRECTIONS = ["left", "right", "up", "down"]
PTZ_CONTROL_PLANE_BASE = (os.getenv("CONTROL_PLANE_URL", "http://localhost:4000") or "http://localhost:4000").rstrip("/")
PTZ_API_MOVE = f"{PTZ_CONTROL_PLANE_BASE}/api/cameras/ptz/move"
PTZ_API_STOP = f"{PTZ_CONTROL_PLANE_BASE}/api/cameras/ptz/stop"
DETECTOR_OUTPUT_STREAM_BASE = (os.getenv("DETECTOR_OUTPUT_STREAM_BASE", "http://localhost:5001/stream") or "http://localhost:5001/stream").rstrip("/")
DETECTOR_MONITOR_TRANSPORT = (os.getenv("DETECTOR_MONITOR_TRANSPORT", "udp") or "udp").strip().lower()
if DETECTOR_MONITOR_TRANSPORT not in {"tcp", "udp"}:
    DETECTOR_MONITOR_TRANSPORT = "udp"
MONITOR_FRAME_WIDTH = 640
MONITOR_FRAME_HEIGHT = 360
MONITOR_READ_TIMEOUT_SEC = 8.0
MONITOR_RESTART_AFTER_FAILS = 6
CAMERA_DEFAULT_USER = (os.getenv("CAMERA_DEFAULT_USER", "admin") or "admin").strip() or "admin"
CAMERA_DEFAULT_PASS = os.getenv("CAMERA_DEFAULT_PASS", "PerroN3gro")
SOFT_MOTION_SIZE = (320, 180)
SOFT_MOTION_DELTA_THRESHOLD = 16
SOFT_MOTION_SCORE_THRESHOLD = 0.010
SOFT_MOTION_MIN_BLOB_RATIO = 0.0012
SOFT_MOTION_HOLD_SECONDS = 2.0
SOFT_MOTION_CYCLE_CORR_THRESHOLD = 0.86
CONTROL_PLANE_URL = (os.getenv("CONTROL_PLANE_URL", "http://localhost:4000") or "http://localhost:4000").rstrip("/")
CONTROL_PLANE_CAMERA_CONFIG_URL = f"{CONTROL_PLANE_URL}/api/internal/config/cameras"
CONTROL_PLANE_RETENTION_CONFIG_URL = f"{CONTROL_PLANE_URL}/api/internal/config/retention"
CONTROL_PLANE_RECORDINGS_URL = f"{CONTROL_PLANE_URL}/api/recordings"
CONTROL_PLANE_PERCEPTION_OBSERVATIONS_URL = f"{CONTROL_PLANE_URL}/api/perception/observations"
CONTROL_PLANE_PERCEPTION_RECORDINGS_URL = f"{CONTROL_PLANE_URL}/api/perception/recordings"
USE_CONTROL_PLANE_CAMERA_CONFIG = parse_bool_env("USE_CONTROL_PLANE_CAMERA_CONFIG", True)
REQUIRE_CONTROL_PLANE_CAMERA_CONFIG = parse_bool_env("REQUIRE_CONTROL_PLANE_CAMERA_CONFIG", False)
USE_CONTROL_PLANE_RETENTION_CONFIG = parse_bool_env("USE_CONTROL_PLANE_RETENTION_CONFIG", True)
REQUIRE_CONTROL_PLANE_RETENTION_CONFIG = parse_bool_env("REQUIRE_CONTROL_PLANE_RETENTION_CONFIG", False)
RETENTION_CONFIG_TTL_SEC = parse_positive_int_env("RETENTION_CONFIG_TTL_SEC", 60)
USE_CONTROL_PLANE_PERCEPTION_INGEST = parse_bool_env("USE_CONTROL_PLANE_PERCEPTION_INGEST", True)
USE_CONTROL_PLANE_RECORDING_CATALOG = parse_bool_env("USE_CONTROL_PLANE_RECORDING_CATALOG", True)

# Classes of interest (COCO dataset IDs)
PERSON_CLASSES = {0}  # person
VEHICLE_CLASSES = {1, 2, 3, 5, 7}  # bicycle, car, motorcycle, bus, truck
ANIMAL_CLASSES = {14, 15, 16, 17, 18, 19, 20, 21, 22, 23}  # bird, cat, dog, horse, sheep, cow, elephant, bear, zebra, giraffe
TARGET_CLASSES = PERSON_CLASSES | VEHICLE_CLASSES | ANIMAL_CLASSES

CLASS_LABELS = {
    0: "persona", 1: "bicicleta", 2: "auto", 3: "moto", 5: "bus", 7: "camión",
    14: "ave", 15: "gato", 16: "perro", 17: "caballo", 18: "oveja",
    19: "vaca", 20: "elefante", 21: "oso", 22: "cebra", 23: "jirafa"
}

# --- State ---
camera_states = {}  # cam_id -> {status, last_detection, detected_objects, recording_until, cooldown_until}
events_log = []     # List of detection events
models = {}         # device_id -> YOLO model
device_round_robin = 0
device_lock = threading.Lock()
motion_cache = {}   # cam_id -> {"ts": epoch, "motion": bool, "healthy": bool}
recordings_index_lock = threading.Lock()
retention_policy_lock = threading.Lock()
retention_policy_state = {
    "recordings_max_size_gb": float(DEFAULT_RECORDINGS_MAX_SIZE_GB),
    "delete_oldest_batch": int(DEFAULT_DELETE_OLDEST_BATCH),
    "last_fetch_ts": 0.0,
    "last_success_ts": 0.0,
    "source": "defaults"
}

os.makedirs(RECORDINGS_DIR, exist_ok=True)


class PersistentFFmpegReader:
    """Persistent low-res RTSP reader that keeps a single socket open per camera."""

    def __init__(self, url, width=MONITOR_FRAME_WIDTH, height=MONITOR_FRAME_HEIGHT, transport=DETECTOR_MONITOR_TRANSPORT):
        self.url = url
        self.width = int(width)
        self.height = int(height)
        self.transport = transport if transport in {"tcp", "udp"} else "udp"
        self.frame_size = self.width * self.height * 3
        self.process = None
        self.start()

    def start(self):
        self.release()
        is_rtsp = isinstance(self.url, str) and self.url.startswith("rtsp://")
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
        if is_rtsp:
            cmd.extend([
                "-rtsp_transport", self.transport,
                "-fflags", "+discardcorrupt",
                "-flags", "low_delay",
                "-analyzeduration", "1000000",
                "-probesize", "500000"
            ])
        else:
            cmd.extend([
                "-fflags", "+discardcorrupt",
                "-analyzeduration", "1000000",
                "-probesize", "500000"
            ])
        cmd.extend([
            "-i", self.url,
            "-an",
            "-sn",
            "-dn",
            "-vf", f"scale={self.width}:{self.height}",
            "-pix_fmt", "bgr24",
            "-f", "rawvideo",
            "-vcodec", "rawvideo",
            "-"
        ])
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

    def read(self, timeout_sec=MONITOR_READ_TIMEOUT_SEC):
        if not self.is_opened():
            return False, None
        raw = bytearray()
        fd = self.process.stdout.fileno()
        deadline = time.monotonic() + max(0.05, timeout_sec)
        while len(raw) < self.frame_size:
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

    def restart(self, transport=None):
        if transport in {"tcp", "udp"}:
            self.transport = transport
        self.start()

    def release(self):
        if self.process and self.process.poll() is None:
            try:
                self.process.terminate()
                self.process.wait(timeout=1.5)
            except Exception:
                try:
                    self.process.kill()
                except Exception:
                    pass
        self.process = None


def get_recordings_dir_size_bytes():
    total = 0
    if not os.path.isdir(RECORDINGS_DIR):
        return 0
    for entry in os.scandir(RECORDINGS_DIR):
        if entry.is_file():
            try:
                total += entry.stat().st_size
            except FileNotFoundError:
                pass
    return total


def get_metadata_path_from_filename(filename):
    if filename.endswith(".mp4"):
        return os.path.join(RECORDINGS_DIR, filename[:-4] + ".meta.json")
    return os.path.join(RECORDINGS_DIR, filename + ".meta.json")


def get_metadata_path_from_mp4(mp4_path):
    if mp4_path.endswith(".mp4"):
        return mp4_path[:-4] + ".meta.json"
    return mp4_path + ".meta.json"


def load_recordings_index():
    if not os.path.exists(RECORDINGS_INDEX_FILE):
        return []
    try:
        with open(RECORDINGS_INDEX_FILE, "r") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
    except Exception as e:
        print(f"[META] Error loading index: {e}")
    return []


def save_recordings_index(entries):
    tmp_file = RECORDINGS_INDEX_FILE + ".tmp"
    try:
        with open(tmp_file, "w") as f:
            json.dump(entries, f, ensure_ascii=False, indent=2)
        os.replace(tmp_file, RECORDINGS_INDEX_FILE)
    except Exception as e:
        print(f"[META] Error saving index: {e}")
        try:
            if os.path.exists(tmp_file):
                os.remove(tmp_file)
        except Exception:
            pass


def load_sidecar_metadata(filename):
    meta_path = get_metadata_path_from_filename(filename)
    if not os.path.exists(meta_path):
        return None
    try:
        with open(meta_path, "r") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except Exception as e:
        print(f"[META] Error loading sidecar {meta_path}: {e}")
    return None


def upsert_recording_metadata(metadata):
    filename = metadata.get("filename")
    if not filename:
        return

    meta_path = get_metadata_path_from_filename(filename)
    try:
        with open(meta_path, "w") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[META] Error writing sidecar {meta_path}: {e}")

    with recordings_index_lock:
        index = load_recordings_index()
        index = [m for m in index if m.get("filename") != filename]
        index.append(metadata)
        index.sort(key=lambda m: m.get("event_time") or m.get("created_at") or "", reverse=True)
        save_recordings_index(index)

    publish_recording_catalog(metadata)


def remove_recording_metadata(filename):
    if not filename:
        return

    meta_path = get_metadata_path_from_filename(filename)
    try:
        if os.path.exists(meta_path):
            os.remove(meta_path)
    except Exception as e:
        print(f"[META] Error removing sidecar {meta_path}: {e}")

    with recordings_index_lock:
        index = load_recordings_index()
        filtered = [m for m in index if m.get("filename") != filename]
        if len(filtered) != len(index):
            save_recordings_index(filtered)

    delete_recording_catalog_entry(filename)


def delete_recording_family(mp4_path):
    deleted_bytes = 0
    filename = os.path.basename(mp4_path)
    base = mp4_path[:-4] if mp4_path.endswith(".mp4") else mp4_path
    related_paths = [
        mp4_path,
        f"{base}.jpg",
        f"{mp4_path}.log",
        get_metadata_path_from_mp4(mp4_path)
    ]
    for p in related_paths:
        try:
            if os.path.exists(p):
                deleted_bytes += os.path.getsize(p)
                os.remove(p)
        except Exception as e:
            print(f"[RECYCLE] Error deleting {p}: {e}")
    remove_recording_metadata(filename)
    return deleted_bytes


def recycle_recordings_if_needed():
    max_size_bytes, delete_oldest_batch, max_size_gb = get_active_retention_policy()
    total_bytes = get_recordings_dir_size_bytes()
    if total_bytes <= max_size_bytes:
        return

    candidates = []
    if not os.path.isdir(RECORDINGS_DIR):
        return

    for entry in os.scandir(RECORDINGS_DIR):
        if not entry.is_file():
            continue
        if not entry.name.endswith(".mp4"):
            continue
        try:
            st = entry.stat()
            candidates.append((entry.path, st.st_mtime))
        except FileNotFoundError:
            continue

    candidates.sort(key=lambda item: item[1])  # Older first
    to_delete = candidates[:delete_oldest_batch]
    if not to_delete:
        print("[RECYCLE] Size exceeded but no .mp4 candidates were found.")
        return

    reclaimed = 0
    deleted_count = 0
    for mp4_path, _ in to_delete:
        reclaimed += delete_recording_family(mp4_path)
        deleted_count += 1

    new_total = get_recordings_dir_size_bytes()
    print(
        f"[RECYCLE] Triggered at {round(total_bytes / (1024**3), 2)} GB (limit {round(max_size_gb, 2)} GB). "
        f"Deleted {deleted_count} oldest videos (batch {delete_oldest_batch}). "
        f"Reclaimed {round(reclaimed / (1024**3), 2)} GB. "
        f"Current size: {round(new_total / (1024**3), 2)} GB."
    )


def get_category(class_id):
    if class_id in PERSON_CLASSES:
        return "persona"
    elif class_id in VEHICLE_CLASSES:
        return "vehiculo"
    elif class_id in ANIMAL_CLASSES:
        return "animal"
    return "otro"


def load_cameras_from_control_plane():
    try:
        payload = http_json("GET", CONTROL_PLANE_CAMERA_CONFIG_URL, timeout=4)
        cameras = payload.get("cameras") if isinstance(payload, dict) else None
        if payload.get("success") and isinstance(cameras, list):
            return cameras
    except Exception as e:
        print(f"[CFG] Control-plane camera config unavailable: {e}")
    return None


def load_cameras():
    if USE_CONTROL_PLANE_CAMERA_CONFIG:
        cameras = load_cameras_from_control_plane()
        if isinstance(cameras, list):
            return cameras
        if REQUIRE_CONTROL_PLANE_CAMERA_CONFIG:
            print("[CFG] Control-plane camera config is required; skipping shared-file fallback.")
            return []

    try:
        if os.path.exists(DATA_FILE):
            with open(DATA_FILE, "r") as f:
                return json.load(f)
    except Exception as e:
        print(f"Error loading cameras: {e}")
    return []


def load_retention_from_control_plane():
    try:
        payload = http_json("GET", CONTROL_PLANE_RETENTION_CONFIG_URL, timeout=4)
        retention = payload.get("retention") if isinstance(payload, dict) else None
        if payload.get("success") and isinstance(retention, dict):
            return retention
    except Exception as e:
        print(f"[CFG] Control-plane retention config unavailable: {e}")
    return None


def retention_snapshot_to_policy(retention):
    if not isinstance(retention, dict):
        return None
    detector_recycle = retention.get("detectorRecycle")
    max_size_gb = None
    delete_batch = None
    if isinstance(detector_recycle, dict):
        max_size_gb = detector_recycle.get("recordingsMaxSizeGb")
        delete_batch = detector_recycle.get("deleteOldestBatch")
    if max_size_gb is None:
        max_size_gb = retention.get("recordingsMaxSizeGb")
    if delete_batch is None:
        delete_batch = retention.get("deleteOldestBatch")

    try:
        max_size_gb = float(max_size_gb)
    except Exception:
        max_size_gb = 0.0
    try:
        delete_batch = int(delete_batch)
    except Exception:
        delete_batch = 0

    if max_size_gb <= 0 or delete_batch <= 0:
        return None
    return {
        "recordings_max_size_gb": max_size_gb,
        "delete_oldest_batch": delete_batch
    }


def refresh_retention_policy(force=False):
    if not USE_CONTROL_PLANE_RETENTION_CONFIG:
        return False

    now = time.time()
    with retention_policy_lock:
        last_fetch = float(retention_policy_state.get("last_fetch_ts", 0.0))
    if not force and (now - last_fetch) < float(RETENTION_CONFIG_TTL_SEC):
        return True

    retention = load_retention_from_control_plane()
    policy = retention_snapshot_to_policy(retention)
    with retention_policy_lock:
        retention_policy_state["last_fetch_ts"] = now
        if policy:
            retention_policy_state.update(policy)
            retention_policy_state["last_success_ts"] = now
            retention_policy_state["source"] = "control-plane"
            return True

        if REQUIRE_CONTROL_PLANE_RETENTION_CONFIG and retention_policy_state.get("last_success_ts", 0.0) <= 0:
            print("[CFG] Control-plane retention config is required but unavailable; continuing with detector defaults.")
        return False


def get_active_retention_policy():
    refresh_retention_policy()
    with retention_policy_lock:
        max_size_gb = float(retention_policy_state.get("recordings_max_size_gb", DEFAULT_RECORDINGS_MAX_SIZE_GB))
        delete_batch = int(retention_policy_state.get("delete_oldest_batch", DEFAULT_DELETE_OLDEST_BATCH))
    max_size_bytes = int(max_size_gb * 1024 * 1024 * 1024)
    return max_size_bytes, delete_batch, max_size_gb


def resolve_camera_credentials(cam):
    user = (cam.get("user") or cam.get("username") or "").strip()
    password = cam.get("pass")
    if password is None:
        password = cam.get("password")
    if password is None:
        password = ""
    password = str(password)
    return {
        "user": user or CAMERA_DEFAULT_USER,
        "pass": password if password != "" else CAMERA_DEFAULT_PASS
    }


def build_rtsp_url(cam):
    """Build authenticated RTSP URL from camera data."""
    url = cam.get("rtspUrl", "")
    
    # If it is a combined AI stream, take the first real RTSP URL as reference for detection
    if url == "combined" and "allRtspUrls" in cam:
        url = cam["allRtspUrls"][0]

    creds = resolve_camera_credentials(cam)
    user = creds["user"]
    password = creds["pass"]
    if password and "@" not in url:
        url = url.replace("rtsp://", f"rtsp://{user}:{password}@")
    return url


def inject_rtsp_auth(url, user, password):
    if not url or not isinstance(url, str):
        return None
    if not url.startswith("rtsp://"):
        return url
    if "@" in url:
        return url
    if not password:
        return url
    return url.replace("rtsp://", f"rtsp://{user}:{password}@")


def derive_companion_rtsp(url):
    if not url or not isinstance(url, str):
        return None
    candidates = []
    if "/onvif1" in url:
        candidates.append(url.replace("/onvif1", "/onvif2"))
    if "/onvif2" in url:
        candidates.append(url.replace("/onvif2", "/onvif1"))
    if "/stream1" in url:
        candidates.append(url.replace("/stream1", "/stream2"))
    if "/stream2" in url:
        candidates.append(url.replace("/stream2", "/stream1"))
    if "subtype=0" in url:
        candidates.append(url.replace("subtype=0", "subtype=1"))
    if "subtype=1" in url:
        candidates.append(url.replace("subtype=1", "subtype=0"))
    for cand in candidates:
        if cand and cand != url:
            return cand
    return None


def parse_resolution_hint(label):
    if not label:
        return None
    m = re.search(r"(\d{2,5})\s*x\s*(\d{2,5})", str(label))
    if not m:
        return None
    w = int(m.group(1))
    h = int(m.group(2))
    if w <= 0 or h <= 0:
        return None
    return (w, h)


def collect_camera_sources(cam):
    creds = resolve_camera_credentials(cam)
    user = creds["user"]
    password = creds["pass"]

    raw_urls = []
    base_url = cam.get("rtspUrl")
    extra_urls = cam.get("allRtspUrls") if isinstance(cam.get("allRtspUrls"), list) else []
    if cam.get("type") == "combined" or base_url == "combined":
        raw_urls.extend(extra_urls)
        if base_url and base_url != "combined":
            raw_urls.append(base_url)
    else:
        if base_url and base_url != "combined":
            raw_urls.append(base_url)
        raw_urls.extend(extra_urls)

    labels = cam.get("sourceLabels") if isinstance(cam.get("sourceLabels"), list) else []
    out = []
    seen = set()
    for idx, raw_url in enumerate(raw_urls):
        authed = inject_rtsp_auth(raw_url, user, password)
        if not authed:
            continue
        label = labels[idx] if idx < len(labels) else f"source_{idx}"
        if authed in seen:
            # Some cameras return duplicate main/sub URLs. Derive a companion endpoint when possible.
            companion = derive_companion_rtsp(authed)
            if companion:
                authed = companion
            if authed in seen:
                continue
        if authed in seen:
            continue
        seen.add(authed)
        resolution = parse_resolution_hint(label)
        pixels = resolution[0] * resolution[1] if resolution else None
        out.append({
            "url": authed,
            "label": label,
            "resolution": resolution,
            "pixels": pixels
        })
    return out


def select_reconstructor_sources(cam):
    sources = collect_camera_sources(cam)
    if not sources:
        return None, None, []

    with_pixels = [s for s in sources if s["pixels"] is not None]
    if with_pixels:
        main = max(with_pixels, key=lambda s: s["pixels"])
        low = min(with_pixels, key=lambda s: s["pixels"])
    else:
        # Keep backward compatibility with existing ordering: first as main, second as low when possible.
        main = sources[0]
        low = sources[1] if len(sources) > 1 else sources[0]

    return main["url"], low["url"], sources


def build_output_stream_url(cam):
    cam_id = cam.get("id")
    main_url, low_url, _ = select_reconstructor_sources(cam)
    if not cam_id or not main_url or not low_url:
        return None, main_url, low_url
    cam_id_safe = urllib.parse.quote(str(cam_id), safe="")
    query = urllib.parse.urlencode({"main": main_url, "sub": low_url})
    return f"{DETECTOR_OUTPUT_STREAM_BASE}/{cam_id_safe}?{query}", main_url, low_url


def soft_motion_is_cyclic(scores):
    if len(scores) < 40:
        return False
    arr = np.array(scores, dtype=np.float32)
    centered = arr - float(np.mean(arr))
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
    amp = float(np.percentile(arr, 90) - np.percentile(arr, 10))
    return best_corr >= SOFT_MOTION_CYCLE_CORR_THRESHOLD and amp < 0.08


def update_soft_motion_state(state, frame):
    if frame is None or frame.size == 0:
        return state.get("soft_motion_active", False), 0.0, False

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, SOFT_MOTION_SIZE, interpolation=cv2.INTER_AREA)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    prev = state.get("soft_prev_gray")
    scores = state.get("soft_motion_scores")
    if scores is None:
        scores = deque(maxlen=120)
        state["soft_motion_scores"] = scores

    if prev is None:
        state["soft_prev_gray"] = gray
        scores.append(0.0)
        state["soft_motion_active"] = False
        state["soft_motion_score"] = 0.0
        state["soft_motion_cyclic"] = False
        return False, 0.0, False

    delta = cv2.absdiff(gray, prev)
    state["soft_prev_gray"] = gray
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
    scores.append(score)
    cyclic = soft_motion_is_cyclic(scores)
    motion_now = (
        score >= SOFT_MOTION_SCORE_THRESHOLD and
        max_blob_ratio >= SOFT_MOTION_MIN_BLOB_RATIO and
        not cyclic
    )

    now = time.time()
    if motion_now:
        state["soft_last_motion_ts"] = now
        state["soft_motion_active"] = True
    else:
        last = state.get("soft_last_motion_ts", 0.0)
        state["soft_motion_active"] = bool(last > 0 and (now - last) <= SOFT_MOTION_HOLD_SECONDS)

    state["soft_motion_score"] = float(score)
    state["soft_motion_cyclic"] = bool(cyclic)
    return state["soft_motion_active"], float(score), bool(cyclic)


def grab_frame(rtsp_url):
    """Grab a single frame from RTSP stream using FFmpeg subprocess."""
    cmd = [
        "ffmpeg", "-y",
        "-i", rtsp_url,
        "-frames:v", "1",
        "-f", "image2pipe",
        "-vcodec", "mjpeg",
        "-q:v", "5",
        "-loglevel", "error",
        "-"
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=10)
        if result.returncode == 0 and len(result.stdout) > 0:
            img_array = np.frombuffer(result.stdout, dtype=np.uint8)
            frame = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
            if frame is not None:
                return frame
            else:
                print(f"[ERR] Failed to decode MJPEG from {rtsp_url[:30]}...")
        else:
            stderr = result.stderr.decode('utf-8', 'ignore') if result.stderr else "No stderr"
            # Silently fail for known non-critical errors or log specific ones
            if "Connection refused" in stderr:
                pass # Expected if cam is offline
            else:
                print(f"[ERR] FFmpeg failed for {rtsp_url[:30]}...: {stderr[:100]}")
    except subprocess.TimeoutExpired:
        # print(f"[ERR] FFmpeg timeout for {rtsp_url[:30]}...")
        pass
    except Exception as e:
        print(f"[ERR] Grab frame exception: {e}")
    return None


def http_json(method, url, payload=None, timeout=2):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8", "ignore")
        return json.loads(body) if body else {}


def publish_observation_event(event):
    if not USE_CONTROL_PLANE_PERCEPTION_INGEST:
        return
    try:
        http_json("POST", CONTROL_PLANE_PERCEPTION_OBSERVATIONS_URL, payload=event, timeout=2)
    except Exception as e:
        print(f"[INGEST] observation publish failed: {e}")


def publish_recording_catalog(metadata):
    if not USE_CONTROL_PLANE_RECORDING_CATALOG:
        return
    try:
        http_json("POST", CONTROL_PLANE_PERCEPTION_RECORDINGS_URL, payload=metadata, timeout=2)
    except Exception as e:
        print(f"[INGEST] recording metadata publish failed: {e}")


def delete_recording_catalog_entry(filename):
    if not USE_CONTROL_PLANE_RECORDING_CATALOG:
        return
    if not filename:
        return
    try:
        safe = urllib.parse.quote(str(filename), safe="")
        http_json("DELETE", f"{CONTROL_PLANE_RECORDINGS_URL}/{safe}", timeout=2)
    except Exception as e:
        print(f"[INGEST] recording metadata delete failed: {e}")


def get_camera_motion_trigger(cam_id):
    now = time.time()
    cached = motion_cache.get(cam_id)
    if cached and now - cached["ts"] < MOTION_CACHE_TTL:
        return cached["motion"], "camera-events-cache", cached.get("healthy", True)

    try:
        data = http_json("GET", f"{MOTION_API_BASE}/{cam_id}", timeout=2)
        if data.get("success"):
            motion = bool(data.get("motion", False))
            healthy = bool(data.get("healthy", True))
            motion_cache[cam_id] = {"ts": now, "motion": motion, "healthy": healthy}
            return motion, "camera-events", healthy
    except Exception:
        pass

    return False, "camera-events-unavailable", False


def scene_is_wall_like(frame, device_id=0):
    """
    AI-assisted wall detector:
    - semantic detections (YOLO)
    - edge density and texture
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    edge_density = float(np.count_nonzero(edges)) / float(edges.size)
    texture_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())

    semantic_hits = 0
    model = models.get(device_id)
    if model:
        try:
            results = model(frame, conf=0.25, verbose=False, device=device_id)
            for r in results:
                semantic_hits += len(r.boxes)
        except Exception:
            semantic_hits = 0

    wall_like = (edge_density < 0.015 and texture_var < 90 and semantic_hits == 0)
    return {
        "wall_like": wall_like,
        "edge_density": round(edge_density, 4),
        "texture_var": round(texture_var, 1),
        "semantic_hits": int(semantic_hits)
    }


def nudge_camera_ptz(cam, direction):
    if not cam.get("ip"):
        return False
    creds = resolve_camera_credentials(cam)
    payload = {
        "url": cam.get("ip"),
        "user": creds["user"],
        "pass": creds["pass"],
        "direction": direction
    }
    try:
        move_res = http_json("POST", PTZ_API_MOVE, payload=payload, timeout=3)
        if not move_res.get("success"):
            return False
        time.sleep(PTZ_STEP_DURATION)
        http_json("POST", PTZ_API_STOP, payload={
            "url": cam.get("ip"),
            "user": creds["user"],
            "pass": creds["pass"]
        }, timeout=3)
        return True
    except Exception:
        return False


def detect_motion(prev_frame, curr_frame):
    """Simple motion detection via frame differencing."""
    if prev_frame is None:
        return False

    gray_prev = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)
    gray_curr = cv2.cvtColor(curr_frame, cv2.COLOR_BGR2GRAY)
    gray_prev = cv2.GaussianBlur(gray_prev, (21, 21), 0)
    gray_curr = cv2.GaussianBlur(gray_curr, (21, 21), 0)

    diff = cv2.absdiff(gray_prev, gray_curr)
    _, thresh = cv2.threshold(diff, MOTION_THRESHOLD, 255, cv2.THRESH_BINARY)

    motion_ratio = np.count_nonzero(thresh) / thresh.size
    return motion_ratio > MOTION_MIN_AREA


def classify_frame(frame, device_id=0):
    """Run YOLOv8 on frame using a specific GPU device."""
    global models
    model = models.get(device_id)
    if not model:
        print(f"[ERR] Model not initialized for device {device_id}")
        return []
    
    # Run inference on specific device
    results = model(frame, conf=CONFIDENCE_THRESHOLD, verbose=False, device=device_id)
    detections = []
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            if cls_id in TARGET_CLASSES:
                conf = float(box.conf[0])
                label = CLASS_LABELS.get(cls_id, f"class_{cls_id}")
                category = get_category(cls_id)
                detections.append({
                    "class_id": cls_id,
                    "label": label,
                    "category": category,
                    "confidence": round(conf, 2)
                })
    return detections


def save_thumbnail(frame, filepath):
    """Save the detection frame as a JPG thumbnail."""
    try:
        cv2.imwrite(filepath, frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        return True
    except Exception as e:
        print(f"[ERR] Error saving thumbnail: {e}")
    return False


def start_recording(cam, source_url, duration=RECORD_DURATION):
    """Start FFmpeg recording from OUTPUT stream and return (filename, filepath, process)."""
    cam_id = cam["id"]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    cam_name = cam.get("name", cam_id).replace(" ", "_").replace("/", "_")
    filename = f"{cam_name}_{timestamp}.mp4"
    filepath = os.path.join(RECORDINGS_DIR, filename)
    if not source_url:
        print(f"[REC] {cam_name}: output stream URL unavailable, recording skipped.")
        return None, None, None

    cmd = [
        "ffmpeg", "-y",
        "-fflags", "+genpts",
        "-analyzeduration", "1000000",
        "-probesize", "1000000",
        "-i", source_url,
        "-t", str(duration),
        "-c:v", "h264_nvenc",
        "-preset", "p3",
        "-b:v", "2M",
        "-an",
        "-movflags", "+faststart",
        filepath
    ]

    print(f"[REC] Starting OUTPUT recording for {cam_name}: {filename}")
    try:
        log_file = open(f"{filepath}.log", "w")
        process = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=log_file)
        log_file.close()
        return filename, filepath, process
    except Exception as e:
        print(f"[REC] Error starting recording process: {e}")
        return None, None, None


def monitor_camera(cam):
    """Main monitoring loop for a single camera."""
    cam_id = cam["id"]
    output_stream_url, fusion_main_url, fusion_sub_url = build_output_stream_url(cam)
    monitor_rtsp_url = output_stream_url or fusion_sub_url or fusion_main_url
    cam_name = cam.get("name", cam_id)
    if not monitor_rtsp_url:
        print(f"[MON] {cam_name}: no monitor source available, camera thread disabled.")
        return

    # Assign device
    global device_round_robin
    with device_lock:
        device_id = device_round_robin
        device_round_robin = (device_round_robin + 1) % 2 # Toggle 0 and 1
    
    camera_states[cam_id] = {
        "status": "monitoring",
        "cam_name": cam_name,
        "device_id": device_id,
        "last_detection": None,
        "detected_objects": [],
        "recording_until": 0,
        "cooldown_until": 0,
        "recording_file": None,
        "recording_started_at": None,
        "pending_metadata": None,
        "motion_source": "camera-events",
        "last_motion": False,
        "motion_healthy": False,
        "soft_motion_score": 0.0,
        "soft_motion_cyclic": False,
        "soft_motion_active": False,
        "soft_last_motion_ts": 0.0,
        "soft_motion_scores": deque(maxlen=120),
        "soft_prev_gray": None,
        "last_wall_check": 0,
        "wall_suspect_count": 0,
        "wall_like": False,
        "scene_metrics": {},
        "scan_index": 0,
        "last_ptz_adjust": 0,
        "active_process": None,
        "monitor_source_url": monitor_rtsp_url,
        "output_stream_url": output_stream_url,
        "fusion_main_url": fusion_main_url,
        "fusion_sub_url": fusion_sub_url
    }

    reader_transport = DETECTOR_MONITOR_TRANSPORT
    reader = PersistentFFmpegReader(
        monitor_rtsp_url,
        width=MONITOR_FRAME_WIDTH,
        height=MONITOR_FRAME_HEIGHT,
        transport=reader_transport
    )
    is_rtsp_monitor = isinstance(monitor_rtsp_url, str) and monitor_rtsp_url.startswith("rtsp://")
    read_failures = 0
    print(f"[MON] Monitoring camera: {cam_name} (monitor={monitor_rtsp_url}, output={output_stream_url})")

    while True:
        try:
            state = camera_states[cam_id]
            now = time.time()

            # 1. Handle Active Recording
            if state.get("active_process"):
                # Check if process is still running
                poll = state["active_process"].poll()
                if poll is not None:
                    # Recording finished
                    print(f"[REC] Recording finished for {cam_name}")
                    if state.get("pending_metadata") and state.get("recording_file"):
                        final_meta = dict(state["pending_metadata"])
                        final_meta["status"] = "ready"
                        final_meta["recording_completed_at"] = datetime.now().isoformat()
                        rec_path = state.get("recording_path")
                        if rec_path and os.path.exists(rec_path):
                            final_meta["size_mb"] = round(os.path.getsize(rec_path) / 1024 / 1024, 1)
                        try:
                            started = state.get("recording_started_at")
                            if started:
                                final_meta["duration_seconds"] = max(0, int(time.time() - started))
                        except Exception:
                            pass
                        upsert_recording_metadata(final_meta)
                    recycle_recordings_if_needed()
                    state["active_process"] = None
                    state["recording_until"] = 0
                    state["status"] = "monitoring"
                    state["recording_file"] = None
                    state["recording_path"] = None
                    state["recording_started_at"] = None
                    state["pending_metadata"] = None
                    continue
                else:
                    # Still recording
                    state["status"] = "recording"
                    state["recording_remaining"] = int(state["recording_until"] - now) if state["recording_until"] > 0 else RECORD_DURATION
                    # Keep low-res socket alive while recording by draining frames.
                    keepalive_ok, _ = reader.read(timeout_sec=1.2)
                    if not keepalive_ok:
                        read_failures += 1
                        if read_failures >= MONITOR_RESTART_AFTER_FAILS:
                            if is_rtsp_monitor:
                                next_transport = "tcp" if reader_transport == "udp" else "udp"
                                print(
                                    f"[MON] {cam_name}: monitor keepalive stalled on {reader_transport.upper()} during recording, switching to {next_transport.upper()}",
                                    flush=True
                                )
                                reader_transport = next_transport
                            else:
                                print(
                                    f"[MON] {cam_name}: monitor keepalive stalled on output stream, restarting reader",
                                    flush=True
                                )
                            reader.restart(reader_transport)
                            read_failures = 0
                    else:
                        read_failures = 0
                    time.sleep(FRAME_INTERVAL)
                    continue

            # 2. Handle Cooldown
            if state["cooldown_until"] > now:
                state["status"] = "cooldown"
                state["cooldown_remaining"] = int(state["cooldown_until"] - now)
                time.sleep(1)
                continue

            state["detected_objects"] = []

            # 3. Capture and Detect Motion
            ret, frame = reader.read(timeout_sec=MONITOR_READ_TIMEOUT_SEC)
            if not ret or frame is None:
                read_failures += 1
                state["status"] = "error"
                if read_failures >= MONITOR_RESTART_AFTER_FAILS:
                    if is_rtsp_monitor:
                        next_transport = "tcp" if reader_transport == "udp" else "udp"
                        print(
                            f"[MON] {cam_name}: monitor stream stalled on {reader_transport.upper()}, switching to {next_transport.upper()}",
                            flush=True
                        )
                        reader_transport = next_transport
                    else:
                        print(
                            f"[MON] {cam_name}: output monitor stream stalled, restarting reader",
                            flush=True
                        )
                    reader.restart(reader_transport)
                    read_failures = 0
                time.sleep(5)
                continue
            read_failures = 0

            # Resize for faster processing
            small = cv2.resize(frame, (MONITOR_FRAME_WIDTH, MONITOR_FRAME_HEIGHT))

            # 3a. Motion trigger: prefer camera-native events, fallback to lightweight software motion.
            cam_motion, motion_source, motion_healthy = get_camera_motion_trigger(cam_id)
            soft_motion, soft_score, soft_cyclic = update_soft_motion_state(state, small)
            if motion_healthy:
                motion_triggered = bool(cam_motion)
                effective_motion_source = motion_source
            else:
                motion_triggered = bool(soft_motion)
                effective_motion_source = "software-motion-cyclic-filter" if soft_cyclic else "software-motion"

            state["motion_source"] = effective_motion_source
            state["last_motion"] = bool(motion_triggered)
            state["motion_healthy"] = bool(motion_healthy)
            state["soft_motion_score"] = round(float(soft_score), 4)
            state["soft_motion_cyclic"] = bool(soft_cyclic)
            state["soft_motion_active"] = bool(soft_motion)

            state["status"] = "monitoring"

            # 3b. Wall suspicion check + autonomous PTZ reposition
            if now - state.get("last_wall_check", 0) >= WALL_CHECK_INTERVAL:
                scene = scene_is_wall_like(small, device_id=state["device_id"])
                state["last_wall_check"] = now
                state["scene_metrics"] = scene
                state["wall_like"] = scene["wall_like"]

                if scene["wall_like"]:
                    state["wall_suspect_count"] = state.get("wall_suspect_count", 0) + 1
                else:
                    state["wall_suspect_count"] = 0

                if (
                    state["wall_suspect_count"] >= WALL_CONFIRMATIONS and
                    now - state.get("last_ptz_adjust", 0) >= PTZ_SCAN_COOLDOWN
                ):
                    direction = PTZ_DIRECTIONS[state.get("scan_index", 0) % len(PTZ_DIRECTIONS)]
                    moved = nudge_camera_ptz(cam, direction)
                    if moved:
                        state["status"] = "repositioning"
                        state["last_ptz_adjust"] = now
                        state["scan_index"] = (state.get("scan_index", 0) + 1) % len(PTZ_DIRECTIONS)
                    state["wall_suspect_count"] = 0

            if motion_triggered:
                # Motion detected: start OUTPUT recording immediately. Detection is independent.
                filename, filepath, process = start_recording(cam, output_stream_url, RECORD_DURATION)
                if process:
                    state["active_process"] = process
                    state["recording_file"] = filename
                    state["recording_path"] = filepath
                    state["recording_started_at"] = now
                    state["recording_until"] = now + RECORD_DURATION
                    state["status"] = "recording"
                    
                    # Run AI classification on monitor frame without coupling it to recording lifecycle.
                    detections = classify_frame(small, device_id=state["device_id"])
                    state["detected_objects"] = detections

                    event_ts = datetime.now().isoformat()
                    categories = sorted(set(d["category"] for d in detections)) if detections else []
                    labels = [d["label"] for d in detections]
                    if detections:
                        state["last_detection"] = event_ts
                    thumb_path = filepath.replace(".mp4", ".jpg")
                    save_thumbnail(small, thumb_path)

                    event_type = "ai_detection" if detections else "motion"
                    event = {
                        "timestamp": event_ts,
                        "camera": cam_name,
                        "camera_id": cam_id,
                        "type": event_type,
                        "categories": categories,
                        "objects": labels,
                        "recording": filename,
                        "thumbnail": filename.replace(".mp4", ".jpg"),
                        "motion_source": state.get("motion_source"),
                        "motion_healthy": state.get("motion_healthy", False)
                    }
                    events_log.append(event)
                    if len(events_log) > 100:
                        events_log.pop(0)
                    publish_observation_event(event)

                    confidences = [d.get("confidence", 0) for d in detections]
                    metadata = {
                        "schema_version": 1,
                        "filename": filename,
                        "camera_id": cam_id,
                        "camera_name": cam_name,
                        "event_type": event_type,
                        "event_time": event_ts,
                        "recording_started_at": event_ts,
                        "recording_completed_at": None,
                        "duration_seconds": RECORD_DURATION,
                        "status": "recording_in_progress",
                        "categories": categories,
                        "objects": labels,
                        "detections_count": len(detections),
                        "top_confidence": round(max(confidences), 2) if confidences else 0,
                        "motion_source": state.get("motion_source"),
                        "motion_healthy": state.get("motion_healthy", False),
                        "wall_like": state.get("wall_like", False),
                        "scene_metrics": state.get("scene_metrics", {}),
                        "thumbnail": filename.replace(".mp4", ".jpg"),
                        "tags": sorted(set(categories + labels + [event_type])),
                        "created_at": event_ts,
                        "recording_source": "reconstructor-output",
                        "output_stream_url": output_stream_url,
                        "fusion_main_url": fusion_main_url,
                        "fusion_sub_url": fusion_sub_url
                    }
                    state["pending_metadata"] = metadata
                    upsert_recording_metadata(metadata)
                    if detections:
                        print(f"[DET] {cam_name}: {', '.join(labels)} -> recording output {RECORD_DURATION}s")
                    else:
                        print(f"[DET] {cam_name}: motion-only trigger -> recording output {RECORD_DURATION}s")
                else:
                    state["status"] = "recording_error"
                    state["cooldown_until"] = now + COOLDOWN_DURATION

            time.sleep(FRAME_INTERVAL)

        except Exception as e:
            print(f"[ERR] {cam_name}: {e}")
            time.sleep(5)


# --- API Routes ---

@app.route("/status")
def get_status():
    return jsonify({
        "success": True,
        "cameras": {
            cam_id: {
                "status": s["status"],
                "cam_name": s["cam_name"],
                "detected_objects": s.get("detected_objects", []),
                "last_detection": s.get("last_detection"),
                "recording_remaining": s.get("recording_remaining", 0),
                "cooldown_remaining": s.get("cooldown_remaining", 0),
                "recording_file": s.get("recording_file"),
                "motion_source": s.get("motion_source"),
                "last_motion": s.get("last_motion", False),
                "motion_healthy": s.get("motion_healthy", False),
                "soft_motion_score": s.get("soft_motion_score", 0.0),
                "soft_motion_cyclic": s.get("soft_motion_cyclic", False),
                "soft_motion_active": s.get("soft_motion_active", False),
                "wall_like": s.get("wall_like", False),
                "scene_metrics": s.get("scene_metrics", {}),
                "monitor_source_url": s.get("monitor_source_url"),
                "output_stream_url": s.get("output_stream_url")
            }
            for cam_id, s in camera_states.items()
        }
    })


@app.route("/events")
def get_events():
    return jsonify({"success": True, "events": events_log[-50:]})


@app.route("/recordings/<filename>", methods=["DELETE"])
def delete_recording(filename):
    """Delete a recording and its associated files."""
    if ".." in filename or filename.startswith("/"):
        return jsonify({"success": False, "error": "Invalid filename"}), 400

    filepath = os.path.join(RECORDINGS_DIR, filename)
    thumb_path = filepath.replace(".mp4", ".jpg")
    log_path = filepath + ".log"

    deleted = []
    try:
        # Delete video
        if os.path.exists(filepath):
            os.remove(filepath)
            deleted.append("video")
        
        # Delete thumbnail
        if os.path.exists(thumb_path):
            os.remove(thumb_path)
            deleted.append("thumbnail")
        
        # Delete log
        if os.path.exists(log_path):
            os.remove(log_path)
            deleted.append("log")

        # Delete metadata sidecar + index entry
        remove_recording_metadata(filename)
        deleted.append("metadata")
            
        print(f"[API] Deleted recording: {filename} ({', '.join(deleted)})")
        return jsonify({"success": True, "deleted": deleted})
    except Exception as e:
        print(f"[ERR] Error deleting recording {filename}: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/recordings")
def list_recordings():
    files = []
    q = (request.args.get("q") or "").strip().lower()
    camera_id_filter = (request.args.get("camera_id") or "").strip()
    category_filter = (request.args.get("category") or "").strip().lower()
    object_filter = (request.args.get("object") or "").strip().lower()
    date_from = (request.args.get("date_from") or "").strip()
    date_to = (request.args.get("date_to") or "").strip()

    with recordings_index_lock:
        index = load_recordings_index()
    index_map = {m.get("filename"): m for m in index if isinstance(m, dict) and m.get("filename")}

    def parse_iso(value):
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            return None

    from_dt = parse_iso(date_from)
    to_dt = parse_iso(date_to)

    if os.path.isdir(RECORDINGS_DIR):
        for f in sorted(os.listdir(RECORDINGS_DIR), reverse=True):
            if f.endswith(".mp4"):
                path = os.path.join(RECORDINGS_DIR, f)
                thumb = f.replace(".mp4", ".jpg")
                metadata = load_sidecar_metadata(f) or index_map.get(f) or {}
                event_time = metadata.get("event_time")
                event_dt = parse_iso(event_time) if event_time else None
                categories = [str(c).lower() for c in metadata.get("categories", [])]
                objects = [str(o).lower() for o in metadata.get("objects", [])]

                if camera_id_filter and metadata.get("camera_id") != camera_id_filter:
                    continue
                if category_filter and category_filter not in categories:
                    continue
                if object_filter and object_filter not in objects:
                    continue
                if from_dt and (not event_dt or event_dt < from_dt):
                    continue
                if to_dt and (not event_dt or event_dt > to_dt):
                    continue

                search_haystack = " ".join([
                    f.lower(),
                    str(metadata.get("camera_name", "")).lower(),
                    str(metadata.get("camera_id", "")).lower(),
                    " ".join(str(t).lower() for t in metadata.get("tags", [])),
                    " ".join(categories),
                    " ".join(objects),
                    str(metadata.get("event_type", "")).lower()
                ])
                if q and q not in search_haystack:
                    continue

                files.append({
                    "filename": f,
                    "thumbnail": thumb if os.path.exists(os.path.join(RECORDINGS_DIR, thumb)) else None,
                    "size_mb": round(os.path.getsize(path) / 1024 / 1024, 1),
                    "created": datetime.fromtimestamp(os.path.getctime(path)).isoformat(),
                    "camera_id": metadata.get("camera_id"),
                    "camera_name": metadata.get("camera_name"),
                    "event_type": metadata.get("event_type"),
                    "event_time": metadata.get("event_time"),
                    "categories": metadata.get("categories", []),
                    "objects": metadata.get("objects", []),
                    "tags": metadata.get("tags", []),
                    "metadata": metadata
                })
    return jsonify({"success": True, "recordings": files[:50]})


# --- Main ---

def main():
    global model
    print("=" * 60)
    print("  IP Camera AI Detector — YOLOv8 Nano")
    print("=" * 60)

    # Load model on both GPUs
    global models
    print("[INIT] Loading YOLOv8n models on Dual GPUs...")
    try:
        models[0] = YOLO("yolov8n.pt").to("cuda:0")
        print("[INIT] Model loaded on GPU 0")
        models[1] = YOLO("yolov8n.pt").to("cuda:1")
        print("[INIT] Model loaded on GPU 1")
    except Exception as e:
        print(f"[INIT] Error loading models on GPUs: {e}")
        print("[INIT] Falling back to single instance...")
        models[0] = YOLO("yolov8n.pt")
        models[1] = models[0]

    if USE_CONTROL_PLANE_CAMERA_CONFIG:
        print(f"[INIT] Camera config source: control-plane API ({CONTROL_PLANE_CAMERA_CONFIG_URL})")
    else:
        print("[INIT] Waiting for camera database...")
        while not os.path.exists(DATA_FILE):
            time.sleep(2)

    if USE_CONTROL_PLANE_RETENTION_CONFIG:
        print(f"[INIT] Retention config source: control-plane API ({CONTROL_PLANE_RETENTION_CONFIG_URL})")
        refresh_retention_policy(force=True)
    else:
        print("[INIT] Retention config source: detector local defaults/env")

    _, delete_batch, max_size_gb = get_active_retention_policy()
    print(f"[INIT] Active recycle policy: {round(max_size_gb, 2)} GB limit, delete batch {delete_batch}")

    cameras = load_cameras()
    print(f"[INIT] Found {len(cameras)} cameras.")

    # Start monitoring thread for each camera
    for cam in cameras:
        t = threading.Thread(target=monitor_camera, args=(cam,), daemon=True)
        t.start()
        print(f"[INIT] Started monitor for: {cam.get('name', cam['id'])}")

    # Periodically reload camera config snapshot to pick up new cameras
    def reload_loop():
        known_ids = set(c["id"] for c in cameras)
        while True:
            time.sleep(15)
            current = load_cameras()
            for cam in current:
                if cam["id"] not in known_ids:
                    known_ids.add(cam["id"])
                    t = threading.Thread(target=monitor_camera, args=(cam,), daemon=True)
                    t.start()
                    print(f"[INIT] New camera detected, monitoring: {cam.get('name', cam['id'])}")

    threading.Thread(target=reload_loop, daemon=True).start()

    # Start Flask API
    print("[API] Starting detector API on port 5000...")
    app.run(host="0.0.0.0", port=5000)


if __name__ == "__main__":
    main()
