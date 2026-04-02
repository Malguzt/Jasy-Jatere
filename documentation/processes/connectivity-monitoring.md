# Connectivity Monitoring

## Target Purpose

This process should compute durable camera health from multiple signals and expose a stable monitoring API and metric model.

## Trigger

The control plane health engine runs scheduled probe jobs and may also execute ad hoc probes requested by the operator.

## Main Participants

- Frontend monitoring workspace
- Control plane health engine
- Probe runners
- Stream gateway metrics API
- Perception freshness signals
- ONVIF event freshness feed
- Metadata store
- Metrics scraper

## Target Happy Path

1. The health engine loads the active camera topology from the metadata store.
2. Probe runners test all configured source endpoints and emit normalized probe samples.
3. The health engine reads:
   - source probe samples,
   - stream gateway session metrics,
   - observation freshness,
   - optional ONVIF event freshness.
4. A policy layer computes:
   - logical camera health,
   - source health,
   - degradation reasons,
   - recommended source policy changes.
5. The resulting health snapshot is persisted.
6. The frontend reads the snapshot through the control plane API.
7. The metrics exporter exposes the same snapshot as Prometheus-compatible metrics.

## Target Outputs

- current health snapshot per camera
- current health snapshot per source
- degradation reason codes
- metrics series for scraping
- optional policy recommendations for stream orchestration

## Structural Improvements in This Design

### Monitoring becomes a domain model

It stops being only an in-memory loop and becomes:

- testable,
- restart-safe,
- queryable,
- reusable by stream policy.

### Freshness becomes explicit

The target health model should distinguish:

- source unreachable,
- stream idle but healthy,
- perception stale,
- ONVIF events stale,
- degraded but usable.

### Metrics and UI read the same truth

The monitoring UI and `/metrics` should both derive from persisted health snapshots, not separate ad hoc computations.

## Failure Modes

- probe runners fail but last good snapshot still exists,
- stream metrics are delayed,
- observation freshness disagrees with source health,
- operator forces a probe during an already degraded state.

## Sequence Diagram

- [PlantUML sequence: connectivity monitoring](../diagrams/sequences/connectivity-monitoring.puml)
