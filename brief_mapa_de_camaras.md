# Brief v2: Mapa de Terreno y Camaras

## 1. Objetivo

Construir un mapa 2D del terreno (tipo croquis) usando las camaras instaladas, con:

1. Posicion relativa de cada camara.
2. Objetos relevantes ubicados en el mapa.
3. Objetos con etiqueta conceptual (ejemplo: "lavadora", "auto", "arbol"), no solo geometria abstracta.

## 2. Criterio de precision acordado

La meta minima es precision tipo croquis. Se considera exito del MVP si:

1. La posicion relativa de las camaras es coherente visualmente (orden, cercania relativa y orientacion general).
2. Los objetos principales quedan en la zona correcta del mapa.
3. No se requiere exactitud metrica de plano de ingenieria.
4. Cualquier precision superior a esto se considera ganancia.

## 3. Alcance funcional

### 3.1 Indispensables (MVP)

1. Mapa 2D de distribucion de objetos.
2. Posicion de cada camara en el mapa.
3. Objetos conceptualizados con etiquetas semanticas.
4. Nueva pestana de "Mapa" en el frontend.
5. Estado inicial sin mapa cuando se abre por primera vez.
6. Opcion de generar y actualizar mapa.

### 3.2 Deseables

1. Objetos seleccionables para ver detalle.
2. Area/cono de vision por camara.
3. Historico de versiones de mapa (fecha, origen, calidad estimada).

### 3.3 Opcionales

1. Mapa 3D simplificado (solo si no retrasa MVP 2D).

### 3.4 Fuera de alcance del MVP

1. Medicion exacta en centimetros.
2. Gemelo digital 3D realista.
3. Calibracion fisica profesional de camaras.

## 4. Definiciones funcionales

### 4.1 Que significa "objeto conceptualizado"

Cada objeto del mapa debe incluir, como minimo:

1. `label`: nombre semantico (ejemplo: "lavadora", "auto", "arbol").
2. `category`: categoria general (electrodomestico, vehiculo, vegetacion, persona, animal, estructura).
3. `confidence`: nivel de confianza del clasificador.
4. `source`: camara(s) o frame(s) desde donde fue inferido.

Si el modelo no reconoce con buena confianza, usar:

1. Etiqueta generica ("objeto-no-clasificado").
2. Capacidad de correccion manual desde UI.

### 4.2 Estados de UI en la pestana de mapa

1. `sin_mapa`: no existe mapa generado aun.
2. `generando`: proceso de mapeo en ejecucion.
3. `listo`: mapa disponible y vigente.
4. `desactualizado`: hubo cambios de camaras o nueva corrida parcial.
5. `error`: fallo de generacion con causa visible y accion de reintento.

## 5. Proceso de mapeo principal (Plan A)

Este es el flujo ideal, no bloqueante por pasos experimentales.

1. Captura de secuencias por camara (barrido del domo visible).
2. Captura en modo normal, infrarrojo y luz encendida (si aplica).
3. Inferencia de profundidad monocular o estimacion de escala relativa.
4. Deteccion y segmentacion de objetos.
5. Construccion de mapa local por camara.
6. Matching de objetos/anclas repetidas entre camaras.
7. Fusion global en un unico mapa 2D.
8. Publicacion del resultado como version de mapa.

Nota:
La etapa de eco/acustica se considera experimental y no bloqueante para el MVP.

## 6. Planes de contingencia

### 6.1 Plan B (si falla profundidad robusta)

Generar mapa topologico 2D por coincidencias visuales:

1. Priorizar relaciones "cerca/lejos", "izquierda/derecha", "adelante/atras".
2. Escala aproximada por heuristicas de tamano de bounding boxes.
3. Resultado valido si conserva coherencia espacial tipo croquis.

### 6.2 Plan C (si falla matching entre camaras)

Modo asistido:

1. Generar mini-mapa por camara de forma independiente.
2. Permitir al usuario vincular 2-3 anclas comunes entre camaras.
3. Resolver transformacion global con esas anclas manuales.

### 6.3 Plan D (si falla pipeline automatico casi completo)

Fallback operativo minimo:

1. Usuario ubica camaras manualmente sobre un lienzo.
2. Sistema sugiere objetos detectados por camara para arrastrar/confirmar.
3. Se guarda un mapa inicial util, mejorable en corridas posteriores.

## 7. Recursos disponibles (entrada del sistema)

1. Camaras con giro 360 grados horizontal y 180 grados vertical.
2. Audio bidireccional en todas las camaras.
3. Luz LED.
4. Vision infrarroja.

## 8. Arquitectura actual y ajustes propuestos

### 8.1 Stack actual detectado

1. `backend` Node/Express con rutas ONVIF, guardado de camaras, streaming y monitoreo.
2. `detector` Python/Flask + YOLO para deteccion/eventos.
3. `reconstructor` Python/Flask para fusion/mejora de stream.
4. `frontend` React/Vite con tabs de exploracion, dashboard, grabaciones y monitoreo.

### 8.2 Refactors y mejoras recomendadas

1. Crear servicio nuevo `mapper` (Python) para desacoplar mapeo de `detector` y `reconstructor`.
2. Centralizar helpers RTSP duplicados en backend (hoy se repiten en varios modulos).
3. Versionar salida de mapa en JSON con `schemaVersion`.
4. Guardar mapas en `backend/data/maps/` con metadata y trazabilidad.
5. Exponer cola de trabajos de mapeo en backend (crear/consultar/reintentar/cancelar).
6. Evitar que experimentos (audio/eco) bloqueen el flujo base.

## 9. Contratos de datos propuestos

### 9.1 Estructura base del mapa

```json
{
  "schemaVersion": "1.0",
  "mapId": "map_2026_04_01_001",
  "createdAt": 1775000000000,
  "quality": {
    "mode": "croquis",
    "score": 0.74
  },
  "cameras": [
    {
      "id": "cam-1",
      "label": "Camara Patio",
      "x": 12.3,
      "y": 4.1,
      "yawDeg": 130
    }
  ],
  "objects": [
    {
      "id": "obj-1",
      "label": "lavadora",
      "category": "electrodomestico",
      "x": 7.2,
      "y": 3.4,
      "confidence": 0.81,
      "sources": ["cam-1", "cam-2"]
    }
  ]
}
```

### 9.2 API minima sugerida

1. `POST /api/maps/generate` crea trabajo de generacion.
2. `GET /api/maps/jobs/:jobId` consulta estado.
3. `POST /api/maps/jobs/:jobId/cancel` cancela trabajo.
4. `POST /api/maps/jobs/:jobId/retry` reintenta un trabajo finalizado.
5. `GET /api/maps/latest` obtiene mapa vigente.
6. `GET /api/maps/history` lista versiones previas.
7. `POST /api/maps/:mapId/promote` marca mapa como activo.

## 10. Plan detallado de implementacion

### Fase 0 - Preparacion y refactor base

1. Crear carpeta `backend/data/maps/`.
2. Definir `map-schema.json` y validacion basica.
3. Extraer utilidades RTSP duplicadas a modulo comun en backend.
4. Agregar feature flags para plan A/B/C/D.

Entregable:
Backend listo para almacenar y servir mapas versionados.

### Fase 1 - Backend de orquestacion de mapeo

1. Crear rutas `/api/maps/*`.
2. Implementar cola simple de jobs (in-memory + persistencia JSON).
3. Registrar eventos de job (`queued`, `running`, `failed`, `done`).
4. Guardar logs de calidad y causa de fallback usado.

Entregable:
Se puede lanzar un mapeo y consultar su progreso.

### Fase 2 - Servicio `mapper` (Plan A + B)

1. Nuevo servicio Python en `mapper/`.
2. Captura de frames por camara (modo normal/IR/luz cuando exista).
3. Deteccion/segmentacion de objetos.
4. Estimacion de posicion relativa camara-objeto.
5. Fusion multi-camara con matching de anclas.
6. Si profundidad falla, aplicar Plan B automaticamente.

Entregable:
Generacion automatica de mapa 2D tipo croquis con objetos etiquetados.

### Fase 3 - Frontend (nueva pestana Mapa)

1. Agregar tab `Mapa` en `App.jsx`.
2. Crear `MapView.jsx` y `MapToolbar.jsx`.
3. Implementar estados de UI: `sin_mapa`, `generando`, `listo`, `error`, `desactualizado`.
4. Botones: `Generar`, `Actualizar`, `Reintentar`.
5. Mostrar lista de objetos con etiqueta semantica y confianza.

Entregable:
Pestana funcional de mapa integrada con backend.

### Fase 4 - Plan C y Plan D (asistido/manual)

1. Modo de anclas manuales para fusion cuando falle matching automatico.
2. Modo de colocacion manual de camaras y objetos sugeridos.
3. Guardado de correcciones humanas para mejorar corridas futuras.

Entregable:
Sistema resistente a fallos fuertes, siempre produce salida util.

### Fase 5 - Calidad, pruebas y operacion

1. Pruebas unitarias de schema y reglas de negocio.
2. Pruebas de integracion backend-mapper-frontend.
3. Set de escenas de validacion con criterio tipo croquis.
4. Metricas de tiempos: captura, fusion, publicacion.
5. Runbook de errores frecuentes y recuperacion.

Entregable:
Release estable para uso diario.

## 11. Criterios de aceptacion del MVP

1. Existe mapa 2D navegable en la nueva pestana.
2. Todas las camaras guardadas tienen posicion aproximada en el mapa.
3. Objetos relevantes aparecen con etiqueta conceptual.
4. Si falla plan A, el sistema cae automaticamente a B/C/D sin quedar inutilizable.
5. Tiempo de generacion razonable para operacion (objetivo inicial: menos de 5 minutos para sitio pequeno).
6. Se puede regenerar mapa bajo demanda desde UI.

## 12. Riesgos y mitigaciones

1. Baja calidad de imagen o baja luz.
Mitigacion: combinar normal/IR/luz y usar fallback Plan B.

2. Objetos no presentes en clases base del detector.
Mitigacion: etiquetas genericas + correccion manual + ampliacion incremental de clases.

3. Poco solapamiento entre camaras.
Mitigacion: Plan C con anclas manuales.

4. Carga computacional alta.
Mitigacion: ejecucion asyncrona por jobs y limitacion de concurrencia.

5. Deriva de mapa por cambios del entorno.
Mitigacion: versionado, fecha de vigencia y regeneracion rapida.

## 13. Resultado esperado de negocio

1. Tener una vista espacial util desde el primer intento, aunque sea tipo croquis.
2. Reducir tiempo de ubicacion de eventos y camaras.
3. Permitir evolucion progresiva a mayor precision sin bloquear valor temprano.
