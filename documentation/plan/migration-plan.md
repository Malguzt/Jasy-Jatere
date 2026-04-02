# Migration Plan

## Goal

This plan describes how to move the codebase from the current implementation to the target architecture described in this documentation.

The plan is intentionally incremental.
Each phase should produce a working system and avoid a large-bang rewrite.

## Implementation Progress Snapshot (April 2, 2026)

- Phase 0: in progress with schema-validated contracts extended for stream sync, perception ingest, and recording catalog upsert payloads.
- Phase 1: in progress with backend app composition split into domain services, runtime coordinator, and dedicated routers.
- Phase 2: in progress with metadata repositories introduced for camera inventory, recording catalog, and observations, plus legacy compatibility exports.
- Phase 3: in progress with worker-facing internal config APIs (`/api/internal/config/*`) and detector camera-config consumption through control-plane snapshots.
- Phase 4A: in progress with stream orchestration extracted into stream control services and WS gateway modules.
- Phase 5: in progress with perception ingest and control-plane-owned recording catalog APIs (`/api/perception/*`, `/api/recordings`).
- Phase 6: in progress with health and monitoring APIs modularized under dedicated services.
- Phase 8: in progress with a typed frontend API client and migration of major UI domains away from ad hoc `fetch` calls.
- Phase 9: in progress with compose networking moved from host-network coupling to explicit service networking and health checks.

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
- `backend/maps/fallback-generator.js`
- `backend/maps/validate-map.js`
- `backend/maps/corrections.js`
- `mapper/mapper.py`
- `frontend/src/components/MapView.jsx`

### Migration strategy

- First, keep the current backend job orchestration.
- Move heuristic generation behind a mapper API contract.
- Only remove `fallback-generator.js` after the mapper strategies fully cover the old behavior.

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
