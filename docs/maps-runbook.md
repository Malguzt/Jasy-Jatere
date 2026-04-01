# Runbook de Mapeo (Croquis)

## 1. Objetivo operativo

Este runbook describe como operar, validar y recuperar el pipeline de mapas 2D (planes A/B/C/D) en produccion.

## 2. Servicios involucrados

1. `backend` (`:4000`): orquesta jobs y persiste mapas.
2. `mapper` (`:5002`): genera croquis automatico/asistido.
3. `detector` (`:5000`): fuente de eventos recientes (opcional para objetos).
4. `frontend` (`:5173`): pestaña `Mapa`.

## 3. Endpoints de operacion

1. `GET /api/maps/health`: salud + config runtime + estado de correcciones.
2. `POST /api/maps/generate`: crea job automatico o asistido.
3. `GET /api/maps/jobs`: historial de jobs.
4. `GET /api/maps/jobs/:jobId`: detalle/estado/progreso de job.
5. `POST /api/maps/jobs/:jobId/cancel`: cancela job.
6. `POST /api/maps/jobs/:jobId/retry`: reintenta un job finalizado con mismos parametros (u overrides).
7. `POST /api/maps/manual`: guarda mapa manual (Plan D).
8. `GET /api/maps/latest`: mapa activo.
9. `GET /api/maps/history`: versiones.
10. `POST /api/maps/:mapId/promote`: promueve version.
11. `GET /api/maps/corrections`: correcciones manuales persistidas.
12. `GET /api/maps/metrics`: metricas agregadas de timings y tasa de exito.

## 4. Flujo recomendado de uso

1. Verificar salud:
   `curl http://localhost:4000/api/maps/health`
2. Lanzar generacion:
   `curl -X POST http://localhost:4000/api/maps/generate -H 'Content-Type: application/json' -d '{"reason":"manual"}'`
3. Monitorear job:
   `curl http://localhost:4000/api/maps/jobs/<jobId>`
4. Reintentar un job finalizado:
   `curl -X POST http://localhost:4000/api/maps/jobs/<jobId>/retry`
5. Confirmar mapa activo:
   `curl http://localhost:4000/api/maps/latest`

## 5. Interpretacion de planes

1. `A`: automatico con mapper.
2. `B`: fallback heuristico visual.
3. `C`: asistido (layout/hints manuales).
4. `D`: mapa manual guardado por usuario.

## 6. Feature flags (entorno)

1. `MAP_PLAN_A_ENABLED` (`1/0`): habilita plan A.
2. `MAP_PLAN_B_ENABLED` (`1/0`): habilita plan B.
3. `MAP_PLAN_C_ENABLED` (`1/0`): habilita plan C.
4. `MAP_PLAN_D_ENABLED` (`1/0`): habilita plan D.
5. `MAP_APPLY_MANUAL_CORRECTIONS` (`1/0`): aplica hints/camaras de correcciones manuales en jobs nuevos.
6. `MAP_MAPPER_TIMEOUT_MS`: timeout de mapper por job.
7. `MAP_MAX_JOBS_HISTORY`: limite de historial de jobs persistidos.

## 7. Fallos frecuentes y mitigacion

1. `No hay camaras guardadas para mapear`
   - Causa: `cameras.json` vacio y sin layout manual.
   - Accion: guardar camaras o usar modo manual en frontend.

2. `Mapper HTTP ...` o `Mapper no disponible`
   - Causa: `mapper` caido/no accesible.
   - Accion: revisar `docker compose logs mapper`; verificar `MAPPER_URL`.
   - El backend cae a fallback si hay planes activos.

3. `Mapa manual invalido`
   - Causa: payload manual incompleto.
   - Accion: validar que camaras tengan `id,label,x,y`.

4. Jobs en `failed` tras reinicio
   - Esperado: jobs `queued/running` previos quedan `failed` con mensaje de reinicio.
   - Accion: relanzar job.

## 8. Validacion de calidad rapida

1. Ejecutar escenas del mapper:
   `python mapper/scripts/validate_scenes.py --mapper-url http://localhost:5002/generate`
2. Revisar metricas:
   `curl http://localhost:4000/api/maps/metrics`
3. Confirmar criterio croquis:
   - camaras en posicion relativa coherente
   - objetos principales en zona correcta

## 9. Datos persistidos

1. `backend/data/maps/index.json`: indice/version activa.
2. `backend/data/maps/jobs.json`: historial jobs.
3. `backend/data/maps/map_*.json`: mapas.
4. `backend/data/maps/manual-corrections.json`: correcciones manuales reutilizables.
