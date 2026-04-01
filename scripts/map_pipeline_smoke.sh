#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[maps-smoke] Building core services..."
docker compose build backend mapper frontend >/dev/null

echo "[maps-smoke] Starting services..."
docker compose up -d backend mapper frontend >/dev/null

echo "[maps-smoke] Running backend-driven smoke checks..."
docker compose exec backend node - <<'NODE'
(async () => {
  const health = await fetch('http://localhost:4000/api/maps/health').then(r => r.json());
  if (!health.success) throw new Error('maps health failed');

  const manualBody = {
    promote: true,
    cameras: [
      { id: 'cam-smoke-1', label: 'Camara Smoke 1', x: 4, y: 2, yawDeg: 40 },
      { id: 'cam-smoke-2', label: 'Camara Smoke 2', x: -3, y: -1, yawDeg: 220 }
    ],
    objects: [
      { label: 'auto', category: 'vehiculo', x: -1.2, y: -0.8, cameraId: 'cam-smoke-2' },
      { label: 'arbol', category: 'vegetacion', x: 2.0, y: 2.7, cameraId: 'cam-smoke-1' }
    ],
    qualityScore: 0.5
  };

  const manualRes = await fetch('http://localhost:4000/api/maps/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manualBody)
  });
  const manual = await manualRes.json();
  if (!manualRes.ok || !manual.success) throw new Error(`manual route failed: ${manual.error || manualRes.status}`);

  const genRes = await fetch('http://localhost:4000/api/maps/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reason: 'smoke-assist',
      planHint: 'C',
      manualCameraLayout: manualBody.cameras,
      objectHints: [{ label: 'lavadora', cameraId: 'cam-smoke-1', x: 1.1, y: 0.9, category: 'electrodomestico' }]
    })
  });
  const gen = await genRes.json();
  if (!genRes.ok || !gen.success) throw new Error(`generate failed: ${gen.error || genRes.status}`);

  let done = null;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const snap = await fetch(`http://localhost:4000/api/maps/jobs/${gen.job.id}`).then(r => r.json());
    if (snap.job && !['queued', 'running'].includes(snap.job.status)) {
      done = snap.job;
      break;
    }
  }
  if (!done || done.status !== 'done') {
    throw new Error(`job did not finish successfully: ${done ? done.status : 'timeout'}`);
  }

  const retryRes = await fetch(`http://localhost:4000/api/maps/jobs/${gen.job.id}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'smoke-retry' })
  });
  const retry = await retryRes.json();
  if (!retryRes.ok || !retry.success || !retry.job?.id) {
    throw new Error(`retry route failed: ${retry.error || retryRes.status}`);
  }

  const retryCancelRes = await fetch(`http://localhost:4000/api/maps/jobs/${retry.job.id}/cancel`, {
    method: 'POST'
  });
  const retryCancel = await retryCancelRes.json();
  if (!retryCancelRes.ok || !retryCancel.success) {
    throw new Error(`cancel retry failed: ${retryCancel.error || retryCancelRes.status}`);
  }

  const latestRes = await fetch('http://localhost:4000/api/maps/latest');
  const latest = await latestRes.json();
  if (!latestRes.ok || !latest.success) throw new Error('latest map missing');
  if (!latest.map || !Array.isArray(latest.map.cameras) || latest.map.cameras.length === 0) {
    throw new Error('latest map has no cameras');
  }

  const metrics = await fetch('http://localhost:4000/api/maps/metrics').then(r => r.json());
  if (!metrics.success) throw new Error('metrics endpoint failed');
  if (!metrics.averagesMs || metrics.averagesMs.totalRunMs === null) {
    throw new Error('metrics averages missing');
  }

  console.log('[maps-smoke] OK');
})().catch((error) => {
  console.error('[maps-smoke] FAILED', error.message || error);
  process.exit(1);
});
NODE

echo "[maps-smoke] Done."
