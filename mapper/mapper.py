import math
import time
from hashlib import sha1

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


CATEGORY_RULES = [
    ("vehiculo", ("auto", "coche", "camion", "camión", "bus", "moto", "vehiculo", "vehículo")),
    ("electrodomestico", ("lavadora", "heladera", "nevera", "microondas", "horno", "electrodomestico", "electrodoméstico")),
    ("vegetacion", ("arbol", "árbol", "planta", "vegetacion", "vegetación", "cesped", "césped")),
    ("persona", ("persona", "hombre", "mujer", "niño", "niña")),
    ("animal", ("animal", "perro", "gato", "caballo", "vaca", "oveja", "ave")),
]


def make_map_id():
    stamp = time.strftime("%Y%m%d%H%M%S")
    entropy = str(time.time_ns())[-5:]
    return f"map_{stamp}_{entropy}"


def normalize_label(label):
    return str(label or "").strip()


def resolve_category(label):
    raw = normalize_label(label).lower()
    if not raw:
        return "estructura"
    for category, terms in CATEGORY_RULES:
        if any(term in raw for term in terms):
            return category
    return "estructura"


def unit_hash(text):
    digest = sha1(str(text).encode("utf-8")).hexdigest()
    value = int(digest[:6], 16)
    return (value % 1000) / 1000.0


def normalize_manual_layout(layout):
    if not isinstance(layout, list):
        return []
    out = []
    seen = set()
    for index, item in enumerate(layout):
        if not isinstance(item, dict):
            continue
        cam_id = str(item.get("id") or item.get("cameraId") or f"manual-{index + 1}")
        if cam_id in seen:
            continue
        try:
            x = float(item.get("x"))
            y = float(item.get("y"))
        except Exception:
            continue
        try:
            yaw = float(item.get("yawDeg", 0.0))
        except Exception:
            yaw = 0.0
        label = str(item.get("label") or item.get("name") or f"Camara {index + 1}").strip()
        seen.add(cam_id)
        out.append({
            "id": cam_id,
            "label": label or f"Camara {index + 1}",
            "x": round(x, 2),
            "y": round(y, 2),
            "yawDeg": round(yaw, 1)
        })
    return out


def build_camera_layout(cameras, manual_layout=None):
    manual = normalize_manual_layout(manual_layout or [])
    manual_by_id = {item["id"]: item for item in manual}

    if (not isinstance(cameras, list) or len(cameras) == 0) and len(manual) > 0:
        return manual, True

    cams = cameras if isinstance(cameras, list) else []
    count = max(1, len(cams))
    radius = max(8.0, count * 3.5)
    out = []
    used_manual = False
    for index, cam in enumerate(cams):
        cam_id = str(cam.get("id"))
        if cam_id in manual_by_id:
            base = manual_by_id[cam_id]
            out.append({
                "id": cam_id,
                "label": cam.get("name") or base["label"],
                "x": float(base["x"]),
                "y": float(base["y"]),
                "yawDeg": float(base.get("yawDeg", 0.0))
            })
            used_manual = True
            continue

        angle = (index / count) * math.pi * 2.0 - (math.pi / 2.0)
        x = round(radius * math.cos(angle), 2)
        y = round(radius * math.sin(angle), 2)
        yaw_deg = round(((angle + math.pi) * 180.0 / math.pi) % 360.0, 1)
        out.append({
            "id": cam_id,
            "label": cam.get("name") or f"Camara {index + 1}",
            "x": x,
            "y": y,
            "yawDeg": yaw_deg
        })
    return out, used_manual


def camera_by_id(cameras):
    return {str(cam.get("id")): cam for cam in cameras}


def event_objects(recent_events, by_id):
    objects = []
    dedupe = set()
    events = recent_events[-80:] if isinstance(recent_events, list) else []
    for event_index, event in enumerate(events):
        labels = event.get("objects") if isinstance(event, dict) else []
        if not isinstance(labels, list):
            continue
        cam_id = str(event.get("camera_id")) if isinstance(event, dict) and event.get("camera_id") is not None else None
        anchor = by_id.get(cam_id) if cam_id else None
        base_x = float(anchor.get("x")) if anchor else 0.0
        base_y = float(anchor.get("y")) if anchor else 0.0

        for label_index, label in enumerate(labels):
            safe_label = normalize_label(label)
            if not safe_label:
                continue
            key = f"{cam_id or 'none'}:{safe_label.lower()}"
            if key in dedupe:
                continue
            dedupe.add(key)

            h1 = unit_hash(f"{event_index}-{label_index}-{safe_label}")
            h2 = unit_hash(f"{safe_label}-{event.get('timestamp') if isinstance(event, dict) else ''}")
            angle = h1 * math.pi * 2.0
            distance = 1.2 + h2 * 2.7
            x = round(base_x + math.cos(angle) * distance, 2)
            y = round(base_y + math.sin(angle) * distance, 2)

            objects.append({
                "id": f"obj_evt_{event_index}_{label_index}",
                "label": safe_label,
                "category": resolve_category(safe_label),
                "x": x,
                "y": y,
                "confidence": round(0.58 + h2 * 0.32, 2),
                "sources": [cam_id] if cam_id else []
            })
    return objects


def hint_objects(object_hints, by_id):
    out = []
    hints = object_hints if isinstance(object_hints, list) else []
    for index, hint in enumerate(hints):
        if not isinstance(hint, dict):
            continue
        label = normalize_label(hint.get("label"))
        if not label:
            continue
        cam_id = str(hint.get("cameraId")) if hint.get("cameraId") is not None else None
        anchor = by_id.get(cam_id) if cam_id else None
        x = hint.get("x")
        y = hint.get("y")
        if x is None and anchor is not None:
            x = float(anchor.get("x")) + ((index % 3) - 1) * 1.1
        if y is None and anchor is not None:
            y = float(anchor.get("y")) + ((index % 2) - 0.5) * 1.2
        if x is None:
            x = 0.0
        if y is None:
            y = 0.0

        out.append({
            "id": f"obj_hint_{index + 1}",
            "label": label,
            "category": hint.get("category") or resolve_category(label),
            "x": round(float(x), 2),
            "y": round(float(y), 2),
            "confidence": round(max(0.05, min(0.99, float(hint.get("confidence", 0.74)))), 2),
            "sources": [cam_id] if cam_id else []
        })
    return out


def heuristic_objects_from_cameras(layout):
    out = []
    cameras = layout if isinstance(layout, list) else []
    for index, cam in enumerate(cameras):
        cx = float(cam.get("x", 0.0))
        cy = float(cam.get("y", 0.0))
        angle = (index / max(1, len(cameras))) * math.pi * 2.0
        out.append({
            "id": f"obj_b_{index + 1}",
            "label": f"zona_{index + 1}",
            "category": "estructura",
            "x": round(cx + math.cos(angle) * 1.8, 2),
            "y": round(cy + math.sin(angle) * 1.8, 2),
            "confidence": 0.42,
            "sources": [str(cam.get("id"))] if cam.get("id") is not None else []
        })
    return out


@app.route("/health")
def health():
    return jsonify({"success": True, "service": "mapper", "time": int(time.time())})


@app.route("/generate", methods=["POST"])
def generate():
    payload = request.get_json(silent=True) or {}
    cameras = payload.get("cameras")
    manual_layout = payload.get("manualCameraLayout")
    if (not isinstance(cameras, list) or len(cameras) == 0) and (not isinstance(manual_layout, list) or len(manual_layout) == 0):
        return jsonify({"success": False, "error": "cameras is required"}), 400

    layout, used_manual_layout = build_camera_layout(cameras, manual_layout)
    by_id = camera_by_id(layout)
    recent_events = payload.get("recentEvents") or []
    object_hints = payload.get("objectHints") or []
    plan_hint = str(payload.get("planHint") or "").strip().upper()
    force_fallback = bool(payload.get("forceFallback", False))

    objects = event_objects(recent_events, by_id) + hint_objects(object_hints, by_id)
    warnings = []
    score = 0.72
    plan_used = "C" if used_manual_layout else "A"

    prefer_plan_b = force_fallback or plan_hint == "B"
    if prefer_plan_b:
        if len(objects) == 0:
            objects = heuristic_objects_from_cameras(layout)
            warnings.append("Fallback heuristic objects were generated from camera anchors.")
        plan_used = "B"
        score = 0.56 if len(objects) > 0 else 0.45

    if not objects:
        warnings.append("No se detectaron objetos recientes; mapa generado solo con camaras.")
        if plan_used == "B":
            score = 0.45
        else:
            score = 0.63

    map_doc = {
        "schemaVersion": "1.0",
        "mapId": make_map_id(),
        "createdAt": int(time.time() * 1000),
        "updatedAt": int(time.time() * 1000),
        "sourceJobId": payload.get("jobId"),
        "quality": {
            "mode": "croquis",
            "score": round(score, 2),
            "planUsed": plan_used,
            "warnings": warnings
        },
        "cameras": layout,
        "objects": objects,
        "metadata": {
            "generatedBy": "mapper-service",
            "usedManualLayout": used_manual_layout,
            "cameraCount": len(layout),
            "objectCount": len(objects)
        }
    }

    return jsonify({
        "success": True,
        "planUsed": plan_used,
        "qualityScore": map_doc["quality"]["score"],
        "warnings": warnings,
        "map": map_doc
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002)
