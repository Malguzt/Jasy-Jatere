# Migration Plan

## Goal

This plan describes how to move the codebase from the current implementation to the target architecture described in this documentation.

The plan is intentionally incremental.
Each phase should produce a working system and avoid a large-bang rewrite.

## Implementation Progress Snapshot (April 2, 2026)

- Phase 0: in progress with schema-validated contracts extended for stream sync, perception ingest, recording catalog upsert payloads, internal worker-config snapshots (`/api/internal/config/cameras|streams|retention`), and composed WebRTC request rules via `anyOf/oneOf` for session create/candidate/close APIs.
- Phase 1: in progress with backend app composition split into domain services, runtime coordinator, and dedicated routers, including injected camera/saved-camera/maps/detector route services wired from control-plane composition instead of route-local singleton instantiation, plus service graph extraction into dedicated composition factories for control-plane and stream-gateway bootstrap (`create-backend-services`, `create-stream-gateway-services`), dedicated route-registration modules for each app (`create-backend-routes`, `create-stream-gateway-routes`), dedicated gateway internal-stream router wiring (`routes/internal-streams-gateway`), extracted liveness/readiness probe routers (`routes/control-plane-probes`, `routes/stream-gateway-probes`), and shared HTTP runtime lifecycle bootstrap (`http-runtime-bootstrap`) reused by both backend entrypoints.
- Phase 2: in progress with SQLite-backed metadata repositories for camera inventory, recording catalog, observations, map versions, map jobs, and manual map corrections, all with legacy JSON compatibility exports.
- Phase 3: in progress with worker-facing internal config APIs (`/api/internal/config/*`), detector camera-config and retention-policy consumption through control-plane snapshots, strict no-shared-file mode via `REQUIRE_CONTROL_PLANE_CAMERA_CONFIG`, backend connectivity monitor legacy `cameras.json` fallback now gated behind `LEGACY_COMPAT_EXPORTS_ENABLED`, stream websocket camera lookup fallback to shared files gated behind the same legacy-compat toggle, both camera-event monitoring plus stream-sync camera loading aligned to repository-first behavior with gated legacy fallback, ONVIF discovery composition wired to repository-backed inventory prefixes before legacy file fallback, and shared camera-inventory fallback loading extracted to a reusable domain helper (`camera-inventory-loader`) consumed across monitor/stream/discovery domains.
- Phase 4A: in progress with stream orchestration extracted into stream control services and WS gateway modules, plus lifecycle toggles (`STREAM_RUNTIME_ENABLED`, `STREAM_WEBSOCKET_GATEWAY_ENABLED`), transport capability negotiation (`GET /api/streams/capabilities`, `STREAM_WEBRTC_ENABLED`, `STREAM_WEBRTC_REQUIRE_HTTPS`), logical session descriptors (`GET /api/streams/sessions/:cameraId`), WebRTC signaling handoff (`POST /api/streams/webrtc/sessions`, `POST /api/streams/webrtc/sessions/:sessionId/candidates`, `DELETE /api/streams/webrtc/sessions/:sessionId`, `STREAM_WEBRTC_SIGNALING_URL`), schema-validated WebRTC request contracts (`stream-webrtc-session-create-request`, `stream-webrtc-candidate-request`, `stream-webrtc-session-close-request`), signaling hardening (`STREAM_WEBRTC_SIGNALING_RETRIES`, `STREAM_WEBRTC_ICE_SERVERS_JSON`), stream-runtime Prometheus metrics (`GET /api/streams/metrics`, `GET /api/internal/streams/metrics`), proxy support (`STREAM_GATEWAY_API_URL`) to support gradual runtime separation, compose defaults wired for proxy ownership (`STREAM_PROXY_MODE_ENABLED=1`, `STREAM_PROXY_REQUIRED=1`), backend WS tunnel mode that relays `/stream/:cameraId` to the gateway when proxy mode is enabled, and optional externally reachable session URL publication via `STREAM_PUBLIC_BASE_URL`.
- Phase 5: in progress with perception ingest and control-plane-owned recording catalog APIs (`/api/perception/*`, `/api/recordings`), retirement of detector recording aliases (`/api/detector/recordings*` -> `410`), detector `/recordings*` compatibility routes now delegating list/delete to control-plane catalog APIs when catalog ownership mode is enabled, strict detector fallback control via `REQUIRE_CONTROL_PLANE_RECORDING_CATALOG`, and sidecar/index metadata writes limited to non-strict compatibility mode.
- Phase 6: in progress with health and monitoring APIs modularized under dedicated services and connectivity snapshots persisted through repository adapters.
- Phase 7: in progress with map job persistence in metadata store, map queue inputs sourced from repository-backed camera and observation metadata, mapper-first fallback execution (no backend local fallback path in runtime), and detector-event fallback gated behind `MAP_USE_DETECTOR_EVENTS_FALLBACK`.
- Phase 8: in progress with a typed frontend API client, stream capability-aware live view wiring, and domain query hooks (`frontend/src/api/hooks.js`) replacing component-local polling/fetch logic for recordings, connectivity monitoring, dashboard camera/detector status, map workspace jobs/history/state, discovery scan state, and camera onboarding/live-control API actions (including recording deletion and force-probe mutations), plus shared polling cadence/cancellation helper extraction (`frontend/src/api/polling.js`).
- Phase 9: in progress with compose networking moved from host-network coupling to explicit service networking and health checks, worker runtime decoupling from shared `backend/data` mounts where control-plane snapshots are enforced, optional at-rest camera credential encryption via `CAMERA_CREDENTIALS_MASTER_KEY`, explicit liveness/readiness probes (`/livez`, `/readyz`), control-plane-managed recording retention job wiring (`RECORDING_RETENTION_*`), and centralized retention/recycle knobs (`RECORDINGS_*`, `OBSERVATION_MAX_ENTRIES`) exposed through worker config snapshots.
- Phase 10: in progress with import-script test coverage for legacy JSON migration into repository-backed SQLite state, plus dedicated composition-factory tests for control-plane and stream-gateway service graphs.

## Starting Point Summary

Today the platform works, but it has several structural bottlenecks:

- the backend mixes control plane, worker, and stream responsibilities,
- multiple services depend on shared mutable files,
- contracts between services are implicit,
- recording metadata is owned by the detector instead of the control plane,
- map strategies are split between backend and mapper,
- frontend data access is ad hoc and untyped,
- deployment still assumes host-network style coupling.

## Refactor Themes

### 1. Turn the backend into a true control plane

Keep orchestration, validation, policy, and metadata there.
Move heavy runtime media concerns out.

### 2. Replace shared files with owned APIs and snapshots

Workers should receive camera configuration and publish observations through explicit contracts.

### 3. Unify duplicate logic

Especially in:

- map strategy generation,
- source selection rules,
- RTSP source normalization,
- health and stream policy computation.

### 4. Introduce typed contracts before major service extraction

This prevents each refactor from inventing a new payload shape.

### 5. Preserve compatibility through feature flags and dual-write stages

The migration should keep the old behavior alive until the new behavior is verified.

## Phase Plan

## Phase 0 - Lock the Target Contracts and Migration Rules

### Objective

Define the target payloads and module boundaries before moving ownership around.

### Changes

- Create a `contracts/` folder for JSON Schema or OpenAPI definitions.
- Define canonical models for:
  - `Camera`
  - `CameraSource`
  - `ObservationEvent`
  - `Recording`
  - `HealthSnapshot`
  - `MapJob`
  - `MapVersion`
- Add one shared request/response schema for each existing backend API that will survive the redesign.
- Add correlation IDs and common error envelope conventions.

### Current code touch points

- `backend/routes/*.js`
- `backend/server.js`
- `detector/detector.py`
- `mapper/mapper.py`
- `reconstructor/reconstructor.py`
- `frontend/src/components/*`

### Deliverables

- Versioned contract files
- Validation helpers in backend
- Contract compatibility notes for detector, mapper, and reconstructor

### Exit criteria

- No new endpoint or worker payload is added without a schema.
- Every inter-service payload used in later phases has a canonical definition.

## Phase 1 - Introduce a Real Backend Application Structure

### Objective

Break the backend monolith into domains before changing persistence.

### Changes

- Create a new backend layout such as:
  - `backend/src/app`
  - `backend/src/domains`
  - `backend/src/infrastructure`
  - `backend/src/contracts`
- Move route logic into domain services.
- Keep existing endpoints stable.
- Add a central configuration module and stop reading environment values from arbitrary files everywhere.
- Introduce structured logging and request correlation.

### Current code touch points

- `backend/server.js`
- `backend/routes/camera.js`
- `backend/routes/saved-cameras.js`
- `backend/routes/maps.js`
- `backend/stream-manager.js`
- `backend/camera-connectivity-monitor.js`
- `backend/camera-event-monitor.js`

### Migration strategy

- Wrap current modules behind thin service classes first.
- Do not change external behavior yet.
- Keep old route files as adapters until the new structure settles.

### Exit criteria

- Backend business logic is no longer route-centric.
- `server.js` becomes composition/bootstrap code instead of application logic.

## Phase 2 - Introduce the Metadata Store with Repository Adapters

### Objective

Stop treating JSON files as the system source of truth.

### Changes

- Add a metadata persistence layer to the control plane.
- Start with SQLite to reduce migration risk.
- Create repositories for:
  - cameras,
  - camera sources,
  - credentials,
  - recordings catalog,
  - health snapshots,
  - map jobs,
  - map versions,
  - manual corrections.
- Add migration scripts for schema creation.
- Introduce dual-write mode:
  - write to SQLite,
  - still write legacy JSON outputs temporarily.

### Current code touch points

- `backend/routes/saved-cameras.js`
- `backend/camera-event-monitor.js`
- `backend/camera-connectivity-monitor.js`
- `backend/maps/storage.js`
- `backend/maps/corrections.js`
- `detector/detector.py`

### Migration strategy

- Keep `cameras.json` and map JSON files as compatibility exports during the transition.
- Add a one-time importer for:
  - `backend/data/cameras.json`
  - `backend/data/maps/*`
  - `recordings/recordings-index.json`

### Exit criteria

- The control plane can boot entirely from the metadata store.
- Legacy JSON files are generated from repositories, not treated as the primary store.

## Phase 3 - Move Worker Configuration to Internal APIs and Snapshots

### Objective

Remove worker dependence on shared filesystem metadata.

### Changes

- Add internal control plane endpoints for:
  - desired camera config
  - source snapshots
  - stream policies
  - recording retention settings
- Update detector, reconstructor, and monitoring code to pull config from internal APIs or subscribe to snapshots.
- Stop reading `backend/data/cameras.json` directly from worker services.

### Current code touch points

- `detector/detector.py`
- `reconstructor/reconstructor.py`
- `backend/camera-connectivity-monitor.js`
- `backend/camera-event-monitor.js`
- `backend/stream-manager.js`

### Migration strategy

- Add compatibility readers first.
- Flip services one by one behind feature flags:
  - `USE_CONTROL_PLANE_CAMERA_CONFIG`
  - `USE_CONTROL_PLANE_STREAM_POLICY`

### Exit criteria

- Worker services no longer require shared metadata files.
- Camera inventory changes propagate through explicit control plane flows.

## Phase 4 - Extract Stream Ownership into a Stream Gateway

### Objective

Separate live session runtime from the control plane.

### Changes

- Move `stream-manager` behavior into a dedicated `stream-gateway` service or separately bootstrapped module.
- Make the control plane request logical sessions instead of proxying bytes itself.
- Move keepalive ownership to the stream gateway.
- Centralize:
  - source selection,
  - stall detection,
  - restart policy,
  - throughput tracking,
  - session fan-out.
- Add capability negotiation:
  - preferred `WebRTC`
  - fallback `WebSocket/JSMpeg`
- Introduce a session descriptor API (`/api/streams/sessions/:cameraId`) so clients resolve stream transport metadata from control-plane policy instead of embedding transport URL rules in UI components.

### Current code touch points

- `backend/stream-manager.js`
- WebSocket section in `backend/server.js`
- `frontend/src/components/CameraStream.jsx`
- `reconstructor/reconstructor.py`

### Migration strategy

- Phase 4A: keep current JSMpeg transport but move session control out of the main backend app.
- Phase 4B: add WebRTC as an optional transport while keeping JSMpeg fallback.

### Exit criteria

- The main backend no longer serves raw video bytes directly.
- Stream runtime metrics are available through a gateway API.

## Phase 5 - Split Perception from Recording Catalog Ownership

### Objective

Make the detector a producer of observations, not the owner of recording metadata truth.

### Changes

- Define a `Perception Service` boundary.
- Normalize detector outputs into:
  - `MotionSignal`
  - `ObservationEvent`
  - `RecordingIntent`
- Add control plane ingest endpoints for those payloads.
- Move recording catalog persistence into the control plane.
- Keep media file writing in a worker path:
  - either detector-internal at first,
  - later a dedicated recording worker if needed.

### Current code touch points

- `detector/detector.py`
- detector `/status`, `/events`, `/recordings` APIs
- backend detector proxy endpoints in `backend/server.js`
- frontend recordings UI in `frontend/src/components/Recordings.jsx`

### Migration strategy

- First, preserve detector media writing but publish catalog metadata to the control plane as the primary store.
- Later, retire `recordings-index.json` and sidecars as authoritative metadata.

### Exit criteria

- Search, filtering, deletion, and retention run against control plane metadata.
- Detector no longer defines the only truth for recording catalog state.

## Phase 6 - Rebuild Monitoring Around a Health Engine

### Objective

Turn monitoring into a reusable domain instead of a large in-memory probe script.

### Changes

- Split monitoring into:
  - probe runners,
  - source scoring,
  - health policy engine,
  - snapshot repository,
  - metrics exporter.
- Persist current health snapshots in the metadata store.
- Add explicit freshness rules for:
  - probe data,
  - stream activity,
  - ONVIF events,
  - perception events.
- Define logical camera health separately from raw source health.

### Current code touch points

- `backend/camera-connectivity-monitor.js`
- `/metrics` section in `backend/server.js`
- `backend/camera-event-monitor.js`
- `frontend/src/components/ConnectivityMonitor.jsx`

### Migration strategy

- Keep current response shape first.
- Move computation behind an internal health engine API.
- Evolve the UI after parity is confirmed.

### Exit criteria

- Health snapshots survive process restart.
- Monitoring logic is testable without booting the full HTTP server.

## Phase 7 - Consolidate Map Strategies Inside the Mapper Domain

### Objective

Remove map generation duplication and make the mapper the only place where map inference strategies live.

### Changes

- Move Plan A, Plan B, and Plan C strategy logic into the mapper service.
- Keep Plan D manual persistence in the control plane, but store it using the same map schema contracts.
- Replace backend fallback generation with:
  - mapper strategies,
  - or a mapper-provided explicit fallback response.
- Change map jobs to use normalized observations from the control plane instead of scraping detector-local logs.

### Current code touch points

- `backend/maps/job-queue.js`
- `backend/maps/validate-map.js`
- `backend/maps/corrections.js`
- `mapper/mapper.py`
- `frontend/src/components/MapView.jsx`

### Migration strategy

- First, keep the current backend job orchestration.
- Move heuristic generation behind a mapper API contract.
- Keep mapper as the only runtime fallback strategy engine once parity is confirmed.

### Exit criteria

- Backend no longer contains duplicate map inference code.
- Mapper owns spatial strategy selection.

## Phase 8 - Frontend Domain Refactor and Typed Data Access

### Objective

Make the frontend resilient to backend evolution and reduce component-level request duplication.

### Changes

- Introduce a typed API client generated from contracts.
- Add a query layer for:
  - camera inventory
  - recordings
  - health snapshots
  - maps
  - jobs
- Split UI by domain:
  - onboarding
  - live view
  - recordings
  - monitoring
  - mapping
- Move imperative fetch logic out of presentation components.

### Current code touch points

- `frontend/src/App.jsx`
- `frontend/src/components/CameraDetailsModal.jsx`
- `frontend/src/components/CameraStream.jsx`
- `frontend/src/components/Recordings.jsx`
- `frontend/src/components/ConnectivityMonitor.jsx`
- `frontend/src/components/MapView.jsx`

### Migration strategy

- Introduce one typed client first without changing all pages.
- Migrate tab by tab.

### Exit criteria

- UI pages consume typed hooks or services instead of raw fetch calls.
- Stream transport choice is abstracted behind a client capability layer.

## Phase 9 - Deployment, Security, and Operations Hardening

### Objective

Make the improved architecture operationally sustainable.

### Changes

- Replace host-network assumptions with explicit service networking.
- Add health checks for each service.
- Separate internal and external ports.
- Encrypt stored camera credentials with a master key.
- Add structured logs across all services.
- Add service-level readiness and liveness endpoints.
- Add retention and cleanup jobs owned by the control plane.

Current incremental implementation:

- `GET /api/health/live`, `GET /api/health/ready`, `GET /livez`, and `GET /readyz` are available in the backend.
- `GET /livez` and `GET /readyz` are available in the stream-gateway process.
- recording retention runs as a control-plane background job and can be configured with:
  - `RECORDING_RETENTION_ENABLED`
  - `RECORDING_RETENTION_INTERVAL_MS`
  - `RECORDING_RETENTION_MAX_AGE_DAYS`
  - `RECORDING_RETENTION_MAX_ENTRIES`

### Current code touch points

- `docker-compose.yml`
- Dockerfiles under each service
- environment variable handling across services

### Migration strategy

- Migrate networking after the new internal APIs exist.
- Keep a compatibility compose profile during rollout.

### Exit criteria

- Services can be restarted independently.
- Control plane startup does not depend on shared filesystem timing.
- Sensitive credentials no longer live in plain JSON inventory files.

## Phase 10 - Test Matrix and Cleanup

### Objective

Finish the redesign by removing temporary compatibility layers only after confidence is high.

### Changes

- Add contract tests for every internal API.
- Add fake ONVIF/RTSP fixtures for integration tests.
- Add map job integration tests using recorded observation fixtures.
- Add stream session smoke tests.
- Add migration tests for importing legacy JSON and recordings metadata.
- Remove deprecated compatibility writers and readers.

Current incremental implementation:

- `backend/scripts/import-legacy-to-sqlite.js` now exposes a testable `run()` entrypoint and keeps CLI behavior via `require.main === module`.
- migration tests now validate import of legacy cameras, recordings, observations, health snapshot, maps, map jobs, and correction history into repository-backed SQLite adapters.
- legacy camera API aliases under `/api/*` are retired; `/api/cameras/*` remains the canonical namespace.
- compatibility dual-write exports are now runtime-gated with `LEGACY_COMPAT_EXPORTS_ENABLED` (default disabled in compose defaults).
- observation event repository compatibility JSON writes are now also gated by `LEGACY_COMPAT_EXPORTS_ENABLED` when running on SQLite.
- map/corrections compatibility JSON exports and health snapshot JSON fallback/write paths are now aligned to `LEGACY_COMPAT_EXPORTS_ENABLED`, with explicit forced bootstrap hooks reserved for migration/import workflows.
- camera inventory and recording catalog repositories now align primary/legacy JSON write and legacy-read fallback behavior to `LEGACY_COMPAT_EXPORTS_ENABLED` in SQLite runtime mode.

### Current code touch points

- `backend/tests/*`
- new integration and fixture suites
- `scripts/`
- CI pipeline configuration

### Exit criteria

- Legacy JSON outputs are optional exports only.
- No runtime service depends on the old coupling model.
- The target architecture is the real architecture, not just the documented one.

## Recommended Execution Order

The safest order is:

1. Contracts
2. Backend modularization
3. Metadata store with dual-write
4. Worker config APIs
5. Stream gateway extraction
6. Observation ingest and recording catalog ownership
7. Health engine
8. Mapper consolidation
9. Frontend typed client migration
10. Deployment hardening
11. Compatibility cleanup

## Cross-Phase Rules

- Use feature flags for every ownership shift.
- Keep import/export tooling for legacy JSON until the new stores are trusted.
- Prefer dual-read or dual-write transitions over sudden cutovers.
- Add tests before deleting compatibility code.
- Do not change stream transport and metadata storage in the same release if it can be avoided.

## Highest-Value Refactors to Start With

If time is limited, start with these four changes first:

1. Introduce backend domain modules and shared contracts.
2. Move camera and map metadata into a real repository layer.
3. Stop detector and other workers from reading shared JSON files directly.
4. Consolidate map strategy logic inside the mapper domain.

These four changes remove the largest structural sources of coupling without forcing the biggest runtime changes immediately.
