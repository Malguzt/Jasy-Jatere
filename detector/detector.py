import os
import json
import time
import threading
import subprocess
import urllib.request
import urllib.error

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

# --- Configuration ---
DATA_FILE = "/app/data/cameras.json"
RECORDINGS_DIR = "/app/recordings"
RECORDINGS_INDEX_FILE = os.path.join(RECORDINGS_DIR, "recordings-index.json")
MAX_RECORDINGS_SIZE_GB = 50
MAX_RECORDINGS_SIZE_BYTES = int(MAX_RECORDINGS_SIZE_GB * 1024 * 1024 * 1024)
DELETE_OLDEST_BATCH = 100
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
PTZ_API_MOVE = "http://localhost:4000/api/ptz/move"
PTZ_API_STOP = "http://localhost:4000/api/ptz/stop"

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

os.makedirs(RECORDINGS_DIR, exist_ok=True)


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
    total_bytes = get_recordings_dir_size_bytes()
    if total_bytes <= MAX_RECORDINGS_SIZE_BYTES:
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
    to_delete = candidates[:DELETE_OLDEST_BATCH]
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
        f"[RECYCLE] Triggered at {round(total_bytes / (1024**3), 2)} GB. "
        f"Deleted {deleted_count} oldest videos. "
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


def load_cameras():
    try:
        if os.path.exists(DATA_FILE):
            with open(DATA_FILE, "r") as f:
                return json.load(f)
    except Exception as e:
        print(f"Error loading cameras: {e}")
    return []


def build_rtsp_url(cam):
    """Build authenticated RTSP URL from camera data."""
    url = cam.get("rtspUrl", "")
    
    # If it is a combined AI stream, take the first real RTSP URL as reference for detection
    if url == "combined" and "allRtspUrls" in cam:
        url = cam["allRtspUrls"][0]
        
    user = cam.get("user", "")
    password = cam.get("pass", "")
    if password and "@" not in url:
        effective_user = user or "admin"
        url = url.replace("rtsp://", f"rtsp://{effective_user}:{password}@")
    return url


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
    payload = {
        "url": cam.get("ip"),
        "user": cam.get("user", ""),
        "pass": cam.get("pass", ""),
        "direction": direction
    }
    try:
        move_res = http_json("POST", PTZ_API_MOVE, payload=payload, timeout=3)
        if not move_res.get("success"):
            return False
        time.sleep(PTZ_STEP_DURATION)
        http_json("POST", PTZ_API_STOP, payload={
            "url": cam.get("ip"),
            "user": cam.get("user", ""),
            "pass": cam.get("pass", "")
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


def start_recording(cam, duration=RECORD_DURATION):
    """Start FFmpeg recording for the given camera and return (filename, filepath, process)."""
    cam_id = cam["id"]
    rtsp_url = build_rtsp_url(cam)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    cam_name = cam.get("name", cam_id).replace(" ", "_").replace("/", "_")
    filename = f"{cam_name}_{timestamp}.mp4"
    filepath = os.path.join(RECORDINGS_DIR, filename)

    cmd = [
        "ffmpeg", "-y",
        "-hwaccel", "cuda",
        "-i", rtsp_url,
        "-t", str(duration),
        "-c:v", "h264_nvenc",
        "-preset", "p1",
        "-b:v", "2M",
        "-an",
        "-movflags", "+faststart",
        filepath
    ]

    print(f"[REC] Starting recording for {cam_name}: {filename}")
    try:
        log_file = open(f"{filepath}.log", "w")
        process = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=log_file)
        return filename, filepath, process
    except Exception as e:
        print(f"[REC] Error starting recording process: {e}")
        return None, None, None


def monitor_camera(cam):
    """Main monitoring loop for a single camera."""
    cam_id = cam["id"]
    rtsp_url = build_rtsp_url(cam)
    cam_name = cam.get("name", cam_id)

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
        "last_wall_check": 0,
        "wall_suspect_count": 0,
        "wall_like": False,
        "scene_metrics": {},
        "scan_index": 0,
        "last_ptz_adjust": 0
    }

    prev_frame = None
    print(f"[MON] Monitoring camera: {cam_name} ({rtsp_url})")

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
                    time.sleep(1)
                    continue

            # 2. Handle Cooldown
            if state["cooldown_until"] > now:
                state["status"] = "cooldown"
                state["cooldown_remaining"] = int(state["cooldown_until"] - now)
                time.sleep(1)
                continue

            state["detected_objects"] = []

            # 3. Capture and Detect Motion
            frame = grab_frame(rtsp_url)
            if frame is None:
                state["status"] = "error"
                time.sleep(5)
                continue

            # Resize for faster processing
            small = cv2.resize(frame, (640, 360))

            # 3a. Camera-native motion trigger (strict: no vision fallback)
            motion_triggered, motion_source, motion_healthy = get_camera_motion_trigger(cam_id)

            state["motion_source"] = motion_source
            state["last_motion"] = bool(motion_triggered)
            state["motion_healthy"] = bool(motion_healthy)

            if not motion_healthy:
                state["status"] = "waiting_motion_events"
                prev_frame = small
                time.sleep(FRAME_INTERVAL)
                continue

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
                # Motion detected! START RECORDING IMMEDIATELY (Pre-record)
                filename, filepath, process = start_recording(cam, RECORD_DURATION)
                if process:
                    state["active_process"] = process
                    state["recording_file"] = filename
                    state["recording_path"] = filepath
                    state["recording_started_at"] = now
                    state["status"] = "detecting" # Transient state
                    
                    # Now run AI classification on the SAME frame
                    detections = classify_frame(small, device_id=state["device_id"])

                    if detections:
                        # TARGET FOUND - CONFIRM RECORDING
                        state["detected_objects"] = detections
                        state["status"] = "recording"
                        event_ts = datetime.now().isoformat()
                        state["last_detection"] = event_ts
                        state["recording_until"] = now + RECORD_DURATION
                        
                        # Save thumbnail
                        thumb_path = filepath.replace(".mp4", ".jpg")
                        save_thumbnail(small, thumb_path)

                        categories = list(set(d["category"] for d in detections))
                        labels = [d["label"] for d in detections]

                        event = {
                            "timestamp": event_ts,
                            "camera": cam_name,
                            "camera_id": cam_id,
                            "type": "detection",
                            "categories": categories,
                            "objects": labels,
                            "recording": filename,
                            "thumbnail": filename.replace(".mp4", ".jpg")
                        }
                        events_log.append(event)
                        if len(events_log) > 100: events_log.pop(0)

                        # Persist searchable metadata for this recording
                        confidences = [d.get("confidence", 0) for d in detections]
                        metadata = {
                            "schema_version": 1,
                            "filename": filename,
                            "camera_id": cam_id,
                            "camera_name": cam_name,
                            "event_type": "ai_detection",
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
                            "tags": sorted(set(categories + labels)),
                            "created_at": event_ts
                        }
                        state["pending_metadata"] = metadata
                        upsert_recording_metadata(metadata)

                        print(f"[DET] {cam_name}: {', '.join(labels)} -> CONFIRMED Recording 60s")
                    else:
                        # MOTION BUT NO TARGET - DISCARD RECORDING
                        print(f"[CDN] {cam_name}: Motion without targets, discarding recording.")
                        process.terminate() # Stop FFmpeg
                        try:
                            # Wait a bit for file to be released, then delete
                            time.sleep(1)
                            if os.path.exists(filepath): os.remove(filepath)
                            if os.path.exists(filepath + ".log"): os.remove(filepath + ".log")
                        except: pass
                        
                        state["active_process"] = None
                        state["recording_file"] = None
                        state["recording_path"] = None
                        state["recording_started_at"] = None
                        state["pending_metadata"] = None
                        remove_recording_metadata(filename)
                        state["status"] = "cooldown"
                        state["cooldown_until"] = now + COOLDOWN_DURATION

            prev_frame = small
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
                "wall_like": s.get("wall_like", False),
                "scene_metrics": s.get("scene_metrics", {})
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

    # Wait for cameras.json to exist
    print("[INIT] Waiting for camera database...")
    while not os.path.exists(DATA_FILE):
        time.sleep(2)

    cameras = load_cameras()
    print(f"[INIT] Found {len(cameras)} cameras.")

    # Start monitoring thread for each camera
    for cam in cameras:
        t = threading.Thread(target=monitor_camera, args=(cam,), daemon=True)
        t.start()
        print(f"[INIT] Started monitor for: {cam.get('name', cam['id'])}")

    # Periodically reload cameras.json to pick up new cameras
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
