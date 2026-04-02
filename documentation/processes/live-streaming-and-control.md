# Live Streaming and Device Control

## Target Purpose

This process should provide live video and camera control through explicit stream session management, not through a stream proxy hidden inside the main backend process.

## Trigger

The operator opens a live view tile and the frontend requests a session from the platform.

## Main Participants

- Frontend live view client
- Control plane API gateway
- Stream session orchestrator
- Stream gateway
- Reconstructor
- Device control service
- ONVIF camera

## Target Happy Path

1. The frontend asks the control plane for live view capabilities for a camera.
2. The control plane resolves the current stream policy using:
   - camera source topology,
   - source health,
   - client capabilities,
   - operator intent.
3. The control plane requests a logical session from the stream gateway.
4. The stream gateway chooses the active pipeline:
   - direct source,
   - reconstructed source,
   - degraded fallback source.
5. If enhancement is required, the stream gateway provisions or reuses a reconstructor-backed pipeline.
6. The frontend receives a session descriptor and connects using the preferred delivery protocol.
7. The stream gateway fans out the session to one or more viewers.
8. Stream health and throughput are reported back to the control plane.
9. When the session ends, stream gateway policy decides whether to keep a warm session alive.

## Target Device Control Path

Device control is intentionally separate from video delivery.

The frontend should call control-plane APIs for:

- PTZ
- snapshot
- auxiliary light or IR actions
- credential refresh
- capability refresh

The device control service should talk directly to the ONVIF camera and persist command results or capability updates through the registry.

## Incremental Control-Plane APIs

As an intermediate migration step, the control plane can expose internal stream orchestration endpoints such as:

- `GET /api/streams/capabilities` for transport negotiation policy (WebRTC optional, JSMpeg fallback).
- `GET /api/streams/sessions/:cameraId` for a logical session descriptor (selected transport + protocol endpoints).
- `GET /api/streams/runtime` for current stream and keepalive runtime state.
- `POST /api/streams/sync` for operator-triggered keepalive and reconstructor resynchronization.
- `GET /api/internal/config/streams` for worker-consumable stream snapshots.

When stream runtime is externalized, the control plane can proxy these APIs to `STREAM_GATEWAY_API_URL`.
`STREAM_PUBLIC_BASE_URL` can be used to embed externally reachable stream URLs in session descriptors; when omitted, descriptors expose protocol paths and frontend clients can still resolve host/base through `VITE_STREAM_BASE_URL`.
WebRTC policy can be enabled incrementally with `STREAM_WEBRTC_ENABLED` and constrained to secure contexts with `STREAM_WEBRTC_REQUIRE_HTTPS`.

## Target Outputs

- logical stream session record
- protocol-specific session descriptor
- source selection decision
- stream health metrics
- device control command results

## Structural Improvements in This Design

### Session management becomes explicit

The system should know:

- why a session exists,
- which source policy it uses,
- what delivery protocol is active,
- what fallback was applied.

### Streaming leaves the main backend runtime

The control plane should orchestrate sessions, not own byte fan-out loops.

### Protocol choice becomes a policy decision

The system should be free to evolve from:

- WebSocket/JSMpeg today
- to WebRTC first with JSMpeg fallback later

without rewriting frontend business logic.

## Failure Modes

- No valid delivery capability available.
- Source health degrades below the chosen policy.
- Reconstructor capacity is unavailable.
- Camera control succeeds while live viewing degrades, or vice versa.

## Sequence Diagram

- [PlantUML sequence: live streaming and control](../diagrams/sequences/live-streaming-and-control.puml)
