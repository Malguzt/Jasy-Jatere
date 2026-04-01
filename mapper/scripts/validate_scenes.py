#!/usr/bin/env python3
import argparse
import glob
import json
import os
import sys
import urllib.error
import urllib.request


def call_mapper(url, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def evaluate(scene_name, expected, result):
    errors = []
    if not result.get("success"):
        errors.append(f"{scene_name}: mapper returned success=false")
        return errors

    map_doc = result.get("map", {})
    cameras = map_doc.get("cameras", []) if isinstance(map_doc.get("cameras"), list) else []
    objects = map_doc.get("objects", []) if isinstance(map_doc.get("objects"), list) else []
    plan_used = (map_doc.get("quality") or {}).get("planUsed") or result.get("planUsed")

    min_cameras = int(expected.get("min_cameras", 0))
    min_objects = int(expected.get("min_objects", 0))
    required_labels = [str(label).strip().lower() for label in expected.get("required_labels", []) if str(label).strip()]
    accepted_plans = [str(plan).strip().upper() for plan in expected.get("plan_one_of", []) if str(plan).strip()]

    if len(cameras) < min_cameras:
        errors.append(f"{scene_name}: expected >= {min_cameras} cameras, got {len(cameras)}")
    if len(objects) < min_objects:
        errors.append(f"{scene_name}: expected >= {min_objects} objects, got {len(objects)}")

    labels = {str(obj.get("label", "")).strip().lower() for obj in objects}
    for label in required_labels:
        if label not in labels:
            errors.append(f"{scene_name}: missing required label '{label}'")

    if accepted_plans and str(plan_used).upper() not in accepted_plans:
        errors.append(f"{scene_name}: planUsed={plan_used} not in {accepted_plans}")

    return errors


def main():
    parser = argparse.ArgumentParser(description="Validate mapper scenes against expected croquis criteria.")
    parser.add_argument(
        "--scenes-dir",
        default=os.path.join(os.path.dirname(__file__), "..", "validation-scenes"),
        help="Directory containing scene JSON fixtures.",
    )
    parser.add_argument(
        "--mapper-url",
        default=os.environ.get("MAPPER_GENERATE_URL", "http://localhost:5002/generate"),
        help="Mapper /generate endpoint URL.",
    )
    args = parser.parse_args()

    scene_files = sorted(glob.glob(os.path.join(args.scenes_dir, "*.json")))
    if not scene_files:
        print("No scene fixtures found.", file=sys.stderr)
        return 2

    all_errors = []
    print(f"Validating {len(scene_files)} scenes against {args.mapper_url}")
    for scene_file in scene_files:
        with open(scene_file, "r", encoding="utf-8") as handle:
            fixture = json.load(handle)
        scene_name = fixture.get("name") or os.path.basename(scene_file)
        payload = fixture.get("payload") or {}
        expected = fixture.get("expected") or {}
        try:
            result = call_mapper(args.mapper_url, payload)
        except urllib.error.URLError as exc:
            print(f"{scene_name}: ERROR calling mapper: {exc}", file=sys.stderr)
            return 3
        errors = evaluate(scene_name, expected, result)
        if errors:
            all_errors.extend(errors)
            print(f"[FAIL] {scene_name}")
            for error in errors:
                print(f"  - {error}")
        else:
            cameras = len((result.get("map") or {}).get("cameras") or [])
            objects = len((result.get("map") or {}).get("objects") or [])
            plan = ((result.get("map") or {}).get("quality") or {}).get("planUsed") or result.get("planUsed")
            print(f"[OK] {scene_name} (plan={plan}, cameras={cameras}, objects={objects})")

    if all_errors:
        print(f"Validation failed with {len(all_errors)} issue(s).", file=sys.stderr)
        return 1

    print("All mapper validation scenes passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
