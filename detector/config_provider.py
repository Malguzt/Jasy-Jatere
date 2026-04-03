import json
import os
import threading
import time


class DetectorConfigProvider:
    def __init__(
        self,
        *,
        data_file,
        control_plane_camera_config_url,
        control_plane_retention_config_url,
        use_control_plane_camera_config=True,
        require_control_plane_camera_config=False,
        use_control_plane_retention_config=True,
        require_control_plane_retention_config=False,
        retention_config_ttl_sec=60,
        default_recordings_max_size_gb=50.0,
        default_delete_oldest_batch=100,
        http_json_func=None,
        logger=print
    ):
        self.data_file = data_file
        self.control_plane_camera_config_url = control_plane_camera_config_url
        self.control_plane_retention_config_url = control_plane_retention_config_url
        self.use_control_plane_camera_config = use_control_plane_camera_config is True
        self.require_control_plane_camera_config = require_control_plane_camera_config is True
        self.use_control_plane_retention_config = use_control_plane_retention_config is True
        self.require_control_plane_retention_config = require_control_plane_retention_config is True
        self.retention_config_ttl_sec = max(1, int(retention_config_ttl_sec))
        self.default_recordings_max_size_gb = float(default_recordings_max_size_gb)
        self.default_delete_oldest_batch = int(default_delete_oldest_batch)
        self.http_json = http_json_func
        self.log = logger if callable(logger) else print

        self.retention_policy_lock = threading.Lock()
        self.retention_policy_state = {
            "recordings_max_size_gb": self.default_recordings_max_size_gb,
            "delete_oldest_batch": self.default_delete_oldest_batch,
            "last_fetch_ts": 0.0,
            "last_success_ts": 0.0,
            "source": "defaults",
        }

    def load_cameras_from_control_plane(self):
        if not callable(self.http_json):
            return None
        try:
            payload = self.http_json("GET", self.control_plane_camera_config_url, timeout=4)
            cameras = payload.get("cameras") if isinstance(payload, dict) else None
            if payload.get("success") and isinstance(cameras, list):
                return cameras
        except Exception as error:
            self.log(f"[CFG] Control-plane camera config unavailable: {error}")
        return None

    def load_cameras(self):
        if self.use_control_plane_camera_config:
            cameras = self.load_cameras_from_control_plane()
            if isinstance(cameras, list):
                return cameras
            if self.require_control_plane_camera_config:
                self.log("[CFG] Control-plane camera config is required; skipping shared-file fallback.")
                return []

        try:
            if os.path.exists(self.data_file):
                with open(self.data_file, "r") as camera_file:
                    payload = json.load(camera_file)
                if isinstance(payload, list):
                    return payload
        except Exception as error:
            self.log(f"Error loading cameras: {error}")
        return []

    def load_retention_from_control_plane(self):
        if not callable(self.http_json):
            return None
        try:
            payload = self.http_json("GET", self.control_plane_retention_config_url, timeout=4)
            retention = payload.get("retention") if isinstance(payload, dict) else None
            if payload.get("success") and isinstance(retention, dict):
                return retention
        except Exception as error:
            self.log(f"[CFG] Control-plane retention config unavailable: {error}")
        return None

    @staticmethod
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
            "delete_oldest_batch": delete_batch,
        }

    def refresh_retention_policy(self, force=False):
        if not self.use_control_plane_retention_config:
            return False

        now = time.time()
        with self.retention_policy_lock:
            last_fetch = float(self.retention_policy_state.get("last_fetch_ts", 0.0))
        if not force and (now - last_fetch) < float(self.retention_config_ttl_sec):
            return True

        retention = self.load_retention_from_control_plane()
        policy = self.retention_snapshot_to_policy(retention)
        with self.retention_policy_lock:
            self.retention_policy_state["last_fetch_ts"] = now
            if policy:
                self.retention_policy_state.update(policy)
                self.retention_policy_state["last_success_ts"] = now
                self.retention_policy_state["source"] = "control-plane"
                return True

            if (
                self.require_control_plane_retention_config
                and self.retention_policy_state.get("last_success_ts", 0.0) <= 0
            ):
                self.log(
                    "[CFG] Control-plane retention config is required but unavailable; continuing with detector defaults."
                )
            return False

    def get_active_retention_policy(self):
        self.refresh_retention_policy()
        with self.retention_policy_lock:
            max_size_gb = float(
                self.retention_policy_state.get(
                    "recordings_max_size_gb", self.default_recordings_max_size_gb
                )
            )
            delete_batch = int(
                self.retention_policy_state.get(
                    "delete_oldest_batch", self.default_delete_oldest_batch
                )
            )
        max_size_bytes = int(max_size_gb * 1024 * 1024 * 1024)
        return max_size_bytes, delete_batch, max_size_gb
