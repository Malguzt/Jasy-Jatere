class CameraMotionClient:
    def __init__(
        self,
        *,
        motion_api_base,
        timeout_sec=1.5,
        use_control_plane_motion_api=True,
        require_control_plane_motion_api=True,
        http_get=None,
        logger=print
    ):
        self.motion_api_base = str(motion_api_base or "").rstrip("/")
        self.timeout_sec = max(0.2, float(timeout_sec))
        self.use_control_plane_motion_api = use_control_plane_motion_api is True
        self.require_control_plane_motion_api = require_control_plane_motion_api is True
        self.http_get = http_get
        self.log = logger if callable(logger) else print

    def get_motion(self, cam_id):
        if not self.use_control_plane_motion_api:
            return {
                "motion": None,
                "healthy": False,
                "source": "camera-events-disabled",
                "strict_unavailable": False
            }

        if not callable(self.http_get) or not self.motion_api_base:
            return {
                "motion": False if self.require_control_plane_motion_api else None,
                "healthy": False,
                "source": "camera-events-client-unavailable",
                "strict_unavailable": self.require_control_plane_motion_api
            }

        try:
            response = self.http_get(f"{self.motion_api_base}/{cam_id}", timeout=self.timeout_sec)
            if not response.ok:
                raise RuntimeError(f"motion-api-status:{response.status_code}")
            data = response.json() if callable(getattr(response, "json", None)) else {}
            if isinstance(data, dict) and data.get("success"):
                healthy = bool(data.get("healthy", False))
                source = data.get("source") or "camera-events"
                if healthy:
                    return {
                        "motion": bool(data.get("motion", False)),
                        "healthy": True,
                        "source": source,
                        "strict_unavailable": False
                    }
                return {
                    "motion": None,
                    "healthy": False,
                    "source": source,
                    "strict_unavailable": False
                }
        except Exception as error:
            self.log(f"[RECON] camera-motion API unavailable for {cam_id}: {error}")

        return {
            "motion": False if self.require_control_plane_motion_api else None,
            "healthy": False,
            "source": "camera-events-unavailable",
            "strict_unavailable": self.require_control_plane_motion_api
        }
