# Jasy Jatere Documentation

## Status

This documentation set describes the **target architecture** for the next structural iteration of the platform, not the current implementation exactly as it exists today.

The current codebase is the starting point.
The documents in this folder describe:

- the system shape we want to end up with,
- the refactors and boundaries that should exist after the redesign,
- the target runtime processes,
- the target data ownership model,
- the migration plan from the current code to that design.

## Documentation Map

- [Target architecture overview](./architecture/overview.md)
- [Target control plane components](./architecture/backend-components.md)
- [Target data and artifact relationships](./architecture/data-and-artifacts.md)
- [Camera discovery and onboarding](./processes/camera-discovery-and-onboarding.md)
- [Live streaming and device control](./processes/live-streaming-and-control.md)
- [Detection, observations, and recording](./processes/detection-and-recording.md)
- [Connectivity monitoring](./processes/connectivity-monitoring.md)
- [Map generation and promotion](./processes/map-generation.md)
- [Migration plan](./plan/migration-plan.md)

## Sequence Diagrams

- [Camera discovery and onboarding](./diagrams/sequences/camera-discovery-and-onboarding.puml)
- [Live streaming and control](./diagrams/sequences/live-streaming-and-control.puml)
- [Detection and recording](./diagrams/sequences/detection-and-recording.puml)
- [Connectivity monitoring](./diagrams/sequences/connectivity-monitoring.puml)
- [Map generation and promotion](./diagrams/sequences/map-generation.puml)

## What Changes in the Target Design

The main architectural shift is from a file-coupled multi-service implementation to a cleaner platform with:

- a clear control plane,
- explicit worker responsibilities,
- a single authoritative metadata store,
- typed contracts between services,
- a dedicated stream gateway,
- an observation and recording pipeline with well-defined ownership,
- mapping strategies consolidated inside the mapper domain,
- stronger operational and testing boundaries.

## High-Level Target Topology

- `frontend`: domain-oriented SPA with typed API clients.
- `control-plane`: the main backend entrypoint and system authority.
- `stream-gateway`: live session management and protocol delivery.
- `perception-service`: motion fusion, object detection, and observation production.
- `reconstructor`: enhancement and fusion worker behind the stream gateway.
- `mapper`: map generation strategies and spatial inference worker.
- `metadata-store`: authoritative relational metadata store.
- `media-store`: recordings, thumbnails, exports, and generated artifacts.

## Reading Order

If you want the shortest path through the redesign, use this order:

1. [Target architecture overview](./architecture/overview.md)
2. [Target control plane components](./architecture/backend-components.md)
3. [Target data and artifact relationships](./architecture/data-and-artifacts.md)
4. The target process documents under [`./processes`](./processes)
5. [Migration plan](./plan/migration-plan.md)

## Notes

- The C4 diagrams are embedded in Markdown with Mermaid.
- Sequence diagrams remain as standalone PlantUML files, one per core process.
- The migration plan is intentionally phased so the current system can evolve incrementally instead of being rewritten in one step.
- Stream runtime can now be split via a dedicated gateway process and control-plane proxy wiring as an incremental extraction path.
- Compose now defaults to backend stream proxy mode with `stream-gateway` enabled (`STREAM_GATEWAY_API_URL=http://stream-gateway:4100/api/internal/streams`, `STREAM_PROXY_MODE_ENABLED=1`, `STREAM_PROXY_REQUIRED=1`) so local backend stream runtime is disabled by default.
- Outside proxy mode, backend local websocket stream runtime is also opt-in (`STREAM_WEBSOCKET_GATEWAY_ENABLED=0` by default) to keep control-plane deployments aligned with gateway-owned media runtime.
- Stream proxy readiness can be enforced with `STREAM_PROXY_REQUIRED=1` (default when proxy mode is enabled) so backend readiness fails if the gateway upstream is unavailable.
- Stream session descriptors are now exposed via `GET /api/streams/sessions/:cameraId` so frontend tiles consume logical stream sessions instead of hardcoding transport URLs; optional `STREAM_PUBLIC_BASE_URL` can publish externally reachable WS endpoints in those descriptors.
- In proxy mode, backend `/stream/:cameraId` websocket traffic is now relayed to the stream-gateway upstream, keeping legacy frontend websocket paths working while runtime ownership stays in the gateway.
- In that mode, backend composition now skips local stream runtime stack instantiation and relies on stream-gateway APIs for stream runtime/control endpoints.
- Internal worker stream snapshots (`GET /api/internal/config/streams`) now also attach runtime data from stream-gateway when local orchestrator/runtime is not present.
- WebRTC offer/answer signaling is now exposed via `POST /api/streams/webrtc/sessions` (proxied to stream-gateway when proxy mode is enabled) and can be wired to an external signaling backend through `STREAM_WEBRTC_SIGNALING_URL`.
- Trickle ICE candidate forwarding is exposed via `POST /api/streams/webrtc/sessions/:sessionId/candidates`; signaling retries, request timeout, and fallback ICE servers can be tuned with `STREAM_WEBRTC_SIGNALING_RETRIES`, `STREAM_WEBRTC_SIGNALING_TIMEOUT_MS`, and `STREAM_WEBRTC_ICE_SERVERS_JSON`.
- Explicit WebRTC session teardown is exposed via `DELETE /api/streams/webrtc/sessions/:sessionId` and is invoked by frontend cleanup to avoid lingering signaling sessions.
- Stream runtime Prometheus metrics are available via `GET /api/streams/metrics` (and `GET /api/internal/streams/metrics` in stream-gateway).
- Global `GET /metrics` now includes both connectivity metrics and stream-runtime metrics in a single Prometheus payload.
- Legacy detector recording aliases (`/api/detector/recordings*`) are retired (`410 Gone`); use `/api/recordings*` as canonical catalog APIs.
- Detector legacy `/recordings*` routes are now retired (`410 Gone`); use control-plane `/api/recordings*`.
- Detector local catalog artifacts (`recordings-index.json` and `*.meta.json`) are no longer used as runtime source-of-truth.
- Backend and stream-gateway expose explicit readiness/liveness probes (`/readyz`, `/livez`) for operational checks.
- Recording retention and cleanup are now modeled as control-plane runtime policy (`RECORDING_RETENTION_*`).
- Detector recycle policy can be synchronized from `GET /api/internal/config/retention` (`USE_CONTROL_PLANE_RETENTION_CONFIG`) to avoid drift with control-plane retention settings.
- Detector camera config strict mode is now default (`REQUIRE_CONTROL_PLANE_CAMERA_CONFIG=1` unless explicitly disabled), so shared-file fallback requires explicit opt-out.
- Detector retention config strict mode is now default in compose (`REQUIRE_CONTROL_PLANE_RETENTION_CONFIG=1`), so retention snapshot unavailability is treated as a strict control-plane dependency (with explicit logging).
- Detector camera/retention config source resolution is now centralized in `detector/config_provider.py`, separating control-plane snapshot reads and legacy file fallback policy from detection runtime loops.
- Detector control-plane ingest/catalog HTTP interactions are now centralized in `detector/control_plane_client.py`, keeping publish/list/delete integration boundaries explicit.
- Detector `/recordings` compatibility endpoints are retired and return `410 Gone`.
- Reconstructor camera-motion polling is now centralized in `reconstructor/motion_client.py`, with strict control-plane motion mode default-enabled (`REQUIRE_CONTROL_PLANE_MOTION_API=1` unless explicitly disabled).
- Backend connectivity monitoring now resolves cameras from repository-backed inventory only (no direct `cameras.json` fallback in runtime monitoring paths).
- Stream websocket gateways (backend and stream-gateway) now resolve cameras from repository-backed inventory only (no direct `cameras.json` fallback in runtime stream paths).
- Camera event monitoring now resolves cameras from repository-backed inventory only (no direct file fallback in runtime monitoring paths).
- Stream-sync orchestration now resolves cameras from repository-backed inventory only (no direct file fallback path).
- ONVIF discovery now resolves known scan prefixes from repository-backed inventory only (no legacy file prefix fallback in runtime discovery paths).
- Camera inventory fallback logic is now centralized in a shared loader (`backend/src/domains/cameras/camera-inventory-loader.js`) and should only be used by explicit migration/bootstrap tooling.
- That loader now defaults to repository-only behavior; legacy file fallback must be explicitly enabled by the caller during migration/bootstrap flows.
- Camera inventory ID resolution (`findCamera`/`listCameras`) is also centralized in that shared loader and reused by stream websocket gateways.
- SQLite-backed repositories now treat legacy JSON as compatibility export targets only; implicit runtime legacy-read fallback is retired (migration/import paths remain explicit).
- Camera inventory and recording catalog repositories now also avoid implicit SQLite bootstrap-from-JSON on read paths; runtime state must come from repository writes or explicit import/bootstrap tooling.
- Legacy map/correction JSON compatibility I/O is now centralized through a shared adapter (`backend/maps/legacy-json-adapter.js`) consumed by both `backend/maps/storage.js` and `backend/maps/corrections.js`.
- Map persistence runtime flag resolution is now centralized in `backend/maps/persistence-flags.js` to keep storage/corrections behavior aligned.
- Map/corrections legacy bootstrap now runs only through explicit migration bootstrap entrypoints (`bootstrapFromLegacy`) and is no longer auto-enabled in runtime read paths.
- Shared map domain defaults are now centralized in `backend/maps/defaults.js` to avoid drift across storage/corrections and compatibility adapters.
- Camera onboarding routes now use composition-injected domain services (`/api/cameras`, `/api/saved-cameras`) so repository/runtime wiring is owned by control-plane bootstrap rather than route-local singletons.
- Map and detector API routes are also composition-injected (`/api/maps`, `/api/detector`) to keep bootstrap ownership explicit and testable.
- Backend service wiring is now centralized in a dedicated composition factory (`backend/src/app/create-backend-services.js`) so app bootstrap focuses on HTTP/runtime lifecycle only.
- Stream-gateway service wiring follows the same pattern via `backend/src/app/create-stream-gateway-services.js`.
- Stream-gateway internal stream APIs are now mounted through a dedicated router module (`backend/routes/internal-streams-gateway.js`) instead of inline app handlers.
- Control-plane and stream-gateway liveness/readiness probes are now mounted through dedicated router modules (`backend/routes/control-plane-probes.js`, `backend/routes/stream-gateway-probes.js`) to keep app bootstrap focused on composition.
- Shared server lifecycle wiring (listen/start/shutdown signal handling) is now centralized in `backend/src/app/http-runtime-bootstrap.js`, reused by both `server.js` and `stream-gateway-server.js`.
- Backend and stream-gateway app factories now also share a common Express bootstrap helper (`backend/src/app/create-http-app-base.js`) for CORS/JSON/correlation middleware wiring.
- Backend and stream-gateway app factories now delegate HTTP route wiring to dedicated modules (`backend/src/app/create-backend-routes.js`, `backend/src/app/create-stream-gateway-routes.js`), reducing bootstrapping file coupling.
- Backend and stream-gateway composition now share common runtime option mappers (`backend/src/app/composition-options.js`) for stream-control runtime flags.
- Backend and stream-gateway composition now also share metadata bootstrap wiring through `backend/src/app/create-metadata-context.js` (driver normalization + SQLite migrate/bootstrap).
- Camera inventory composition wiring (repository + inventory service) is now shared through `backend/src/app/create-camera-inventory-stack.js`.
- Stream runtime composition wiring (sync orchestrator + stream control + websocket gateway) is now shared through `backend/src/app/create-stream-runtime-stack.js`.
- Frontend polling-heavy data hooks now reuse a shared polling helper (`frontend/src/api/polling.js`) to keep query cadence and cancellation behavior consistent across domains.
