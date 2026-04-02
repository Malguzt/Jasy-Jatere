# Camera Discovery and Onboarding

## Target Purpose

This process should produce a normalized camera record inside the control plane, not just append a row to a shared file.

Its output must be immediately usable by:

- live streaming,
- perception workers,
- monitoring,
- map generation,
- device control.

## Trigger

The operator starts camera onboarding from the frontend by either:

1. launching a discovery session, or
2. entering a manual ONVIF endpoint.

## Main Participants

- Frontend onboarding flow
- Control plane API gateway
- Discovery coordinator
- ONVIF adapter or probe worker
- Camera registry
- Credential service
- Metadata store

## Target Happy Path

1. The frontend starts a discovery session through the control plane.
2. The discovery coordinator creates a tracked session record.
3. A discovery worker probes the network using:
   - WS-Discovery first,
   - active subnet and endpoint validation second.
4. Candidate devices are stored as discovery results, not only returned transiently.
5. The operator selects a candidate and tests credentials.
6. The control plane loads device capabilities and normalized stream profiles.
7. The registry builds canonical `CameraSource` entries.
8. The credential service encrypts stored credentials.
9. The control plane validates source definitions and source roles.
10. The camera is committed to the metadata store.
11. The control plane emits a fresh camera configuration snapshot for workers.

## Incremental Control-Plane APIs

During migration, the canonical camera API namespace should be:

- `GET /api/cameras/discover`
- `POST /api/cameras/connect`
- `POST /api/cameras/ptz/move`
- `POST /api/cameras/ptz/stop`
- `POST /api/cameras/snapshot`
- `POST /api/cameras/light/toggle`

The legacy `/api/*` camera endpoints may remain temporarily for compatibility while frontend clients migrate.

Worker-facing snapshots can be exposed through:

- `GET /api/internal/config/cameras`

## Target Outputs

- `Camera` record
- `CameraSource` records
- encrypted credential reference
- discovery session and candidate history
- normalized capability summary
- worker-facing configuration snapshot

## Structural Improvements in This Design

### Discovery becomes auditable

The system should retain:

- who discovered the camera,
- what candidates were seen,
- which validation failed or succeeded,
- what source topology was accepted.

### Credentials become a managed concern

Credentials should not remain embedded in plain text camera inventory exports.

### Combined sources become first-class

Instead of the UI inventing a synthetic combined profile ad hoc, the control plane should define a proper logical source policy such as:

- direct source,
- dual-source fused session,
- low-bandwidth fallback.

## Failure Modes

- Discovery session finds no devices.
- Capability probe succeeds but credentials fail.
- Profile normalization finds duplicate or invalid sources.
- Device control capabilities are partially available.

## Why This Matters

This process defines the topology for the rest of the system.
If camera identity, sources, and credentials are not modeled cleanly here, every downstream capability stays brittle.

## Sequence Diagram

- [PlantUML sequence: camera discovery and onboarding](../diagrams/sequences/camera-discovery-and-onboarding.puml)
