import urllib.parse


class ControlPlaneClient:
    def __init__(
        self,
        *,
        recordings_url,
        perception_observations_url,
        perception_recordings_url,
        use_perception_ingest=True,
        http_json_func=None,
        logger=print
    ):
        self.recordings_url = recordings_url
        self.perception_observations_url = perception_observations_url
        self.perception_recordings_url = perception_recordings_url
        self.use_perception_ingest = use_perception_ingest is True
        self.http_json = http_json_func
        self.log = logger if callable(logger) else print

    def publish_observation_event(self, event):
        if not self.use_perception_ingest or not callable(self.http_json):
            return
        try:
            self.http_json("POST", self.perception_observations_url, payload=event, timeout=2)
        except Exception as error:
            self.log(f"[INGEST] observation publish failed: {error}")

    def publish_recording_catalog(self, metadata):
        if not callable(self.http_json):
            return
        try:
            self.http_json("POST", self.perception_recordings_url, payload=metadata, timeout=2)
        except Exception as error:
            self.log(f"[INGEST] recording metadata publish failed: {error}")

    def delete_recording_catalog_entry(self, filename, raise_on_error=False):
        if not callable(self.http_json):
            return False
        if not filename:
            return False
        try:
            safe = urllib.parse.quote(str(filename), safe="")
            self.http_json("DELETE", f"{self.recordings_url}/{safe}", timeout=2)
            return True
        except Exception as error:
            self.log(f"[INGEST] recording metadata delete failed: {error}")
            if raise_on_error:
                raise
            return False

    def list_recordings(self, query):
        if not callable(self.http_json):
            raise ValueError("Control-plane http client is not configured")

        params = {}
        for key in ("q", "camera_id", "category", "object", "date_from", "date_to"):
            value = query.get(key)
            if value is None:
                continue
            text = str(value).strip()
            if text:
                params[key] = text

        url = self.recordings_url
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"

        payload = self.http_json("GET", url, timeout=4)
        if isinstance(payload, dict) and payload.get("success") and isinstance(payload.get("recordings"), list):
            return payload.get("recordings", [])
        raise ValueError("Invalid control-plane recordings payload")
