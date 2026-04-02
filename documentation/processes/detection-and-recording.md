# Detection, Observations, and Recording

## Target Purpose

This process should turn visual activity into normalized observations and controlled recording artifacts, with the control plane owning the searchable catalog.

## Trigger

The perception service continuously consumes configured camera sessions and emits observations when motion or object rules are satisfied.

## Main Participants

- Perception service
- Stream gateway
- Optional ONVIF event freshness feed
- Control plane observation ingest API
- Recording coordinator
- Media store
- Recording catalog

## Target Happy Path

1. The perception service receives the desired camera processing configuration from the control plane.
2. It consumes normalized stream inputs from the stream gateway, not direct shared-file configuration.
3. It fuses motion signals from:
   - low-cost frame differencing,
   - optional ONVIF event freshness,
   - object activity heuristics.
4. When trigger policy is satisfied, the perception service emits a normalized `ObservationEvent`.
5. The control plane persists that observation immediately.
6. The perception service or a recording coordinator emits a `RecordingIntent`.
7. A recording worker writes media artifacts to the media store.
8. The recording catalog persists searchable metadata in the metadata store.
9. The frontend recordings area reads from control-plane APIs, not detector-local indexes.

## Target Outputs

- normalized observation events
- motion and object detections
- recording intent records
- persisted recording catalog rows
- media artifacts in the media store

## Structural Improvements in This Design

### Observation events become reusable system inputs

Map generation, monitoring, and audit views should all consume the same normalized observation model.

### Recording catalog leaves the worker

Workers create evidence.
The control plane owns:

- search,
- filtering,
- deletion semantics,
- retention policies,
- metadata truth.

### Camera config becomes explicit

The perception service should not read `cameras.json` or infer topology from backend-local files.

## Failure Modes

- Stream gateway cannot provide the requested feed.
- Observation publish succeeds but recording artifact creation fails.
- Media is written but catalog persistence fails.
- On-camera motion is stale while visual activity still exists.

## Sequence Diagram

- [PlantUML sequence: detection and recording](../diagrams/sequences/detection-and-recording.puml)
