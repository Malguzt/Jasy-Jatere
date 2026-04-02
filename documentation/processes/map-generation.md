# Map Generation and Promotion

## Target Purpose

This process should create versioned maps from normalized observations and camera topology while keeping all spatial generation strategies inside the mapper domain.

## Trigger

The operator starts map generation, retries a previous job, or saves a manual correction set from the mapping workspace.

## Main Participants

- Frontend mapping workspace
- Control plane map orchestrator
- Job runtime
- Mapper service
- Metadata store
- Media store

## Target Happy Path for Generated Maps

1. The frontend submits a map generation request to the control plane.
2. The control plane creates a durable `MapJob`.
3. The job runtime gathers normalized inputs:
   - camera topology,
   - latest health-aware source context,
   - recent observation events,
   - manual correction hints.
4. The mapper executes one of its internal strategies:
   - Plan A automatic
   - Plan B heuristic fallback
   - Plan C assisted layout
5. The mapper returns a normalized map result plus warnings and quality information.
6. The control plane validates the returned document against the shared schema.
7. The control plane persists a `MapVersion` row and an immutable JSON export artifact.
8. If requested, the new version is promoted to active.
9. The frontend refreshes active map, history, and job state.

## Target Manual Editing Path

1. The operator edits cameras and objects in the mapping workspace.
2. The control plane persists the manual layout as:
   - a new `MapVersion` if the operator saves a manual map,
   - reusable manual hints if the operator saves corrections only.
3. Future generated jobs may reuse those hints as mapper input.

## Target Strategy Ownership

The mapper owns Plans A, B, and C.
The control plane owns Plan D persistence and job lifecycle.

During migration, the control plane may still keep a minimal emergency local fallback only for resilience when the mapper is unavailable.
That fallback is a temporary compatibility layer and should be removed once mapper coverage is complete.
Current runtime guidance is to keep it disabled by default (`MAP_LOCAL_FALLBACK_ENABLED=0`) and only enable it as an emergency rollback switch.

This removes duplicate spatial logic from the backend and keeps:

- strategy selection,
- heuristics,
- fusion rules,
- quality scoring

inside one domain.

## Target Outputs

- durable map job records
- validated map versions
- immutable map export artifacts
- active map pointer
- reusable correction hints

## Structural Improvements in This Design

### Observation-driven mapping

The map pipeline should use normalized observation events from the control plane rather than scraping detector-local event structures.

### Mapper becomes the single strategy engine

Fallbacks should no longer be reimplemented in backend code.

### Versioning becomes explicit

The system should store:

- map version metadata,
- quality score,
- warnings,
- source strategy,
- promotion history.

## Failure Modes

- no valid topology or observations available,
- mapper strategy fails or returns invalid output,
- validation rejects the result,
- promotion is blocked by operator policy,
- manual corrections conflict with canonical camera identity.

## Sequence Diagram

- [PlantUML sequence: map generation and promotion](../diagrams/sequences/map-generation.puml)
