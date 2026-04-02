# Contracts

This directory contains versioned JSON schemas that define cross-module and cross-service payloads.

Current scope:

- camera entities
- source entities
- observation events
- recording catalog entries
- health snapshots
- map job and map version payloads
- stream control requests
- perception ingest requests
- recording catalog ingest requests
- internal worker-config snapshots (cameras, streams, retention)

Notes:

- These schemas are the first implementation step toward a shared contract layer.
- They are intentionally strict on core fields and permissive on optional metadata.
