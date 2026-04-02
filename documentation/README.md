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
- A compose profile (`stream-gateway`) and `make run-with-stream-gateway` target are available to run backend stream APIs in proxy mode (`STREAM_GATEWAY_API_URL=http://stream-gateway:4100`) while local stream runtime is disabled.
- Stream proxy readiness can be enforced with `STREAM_PROXY_REQUIRED=1` (default when proxy mode is enabled) so backend readiness fails if the gateway upstream is unavailable.
- Stream session descriptors are now exposed via `GET /api/streams/sessions/:cameraId` so frontend tiles consume logical stream sessions instead of hardcoding transport URLs; optional `STREAM_PUBLIC_BASE_URL` can publish externally reachable WS endpoints in those descriptors.
- In proxy mode, backend `/stream/:cameraId` websocket traffic is now relayed to the stream-gateway upstream, keeping legacy frontend websocket paths working while runtime ownership stays in the gateway.
- Backend and stream-gateway expose explicit readiness/liveness probes (`/readyz`, `/livez`) for operational checks.
- Recording retention and cleanup are now modeled as control-plane runtime policy (`RECORDING_RETENTION_*`).
- Detector recycle policy can be synchronized from `GET /api/internal/config/retention` (`USE_CONTROL_PLANE_RETENTION_CONFIG`) to avoid drift with control-plane retention settings.
