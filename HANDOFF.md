# HANDOFF.md

Fecha: 2026-05-25

## Estado Actual

- Contexto persistente disponible en `AGENTS.md` y `PROJECT_CONTEXT.md`.
- No hay suite automatizada formal documentada para este repo.
- El servidor usa FastAPI en `api.py`; el motor de conciliacion vive en `engine.py`.
- La UI principal operativa esta en `frontend/components/Operations.jsx`.
- La configuracion SMTP debe mantenerse centralizada en `Settings -> Email / SMTP Configuration`.
- Cambios recientes: sync AVC automatico en backend, estado `processing` en `/api/status`, dashboard evita pintar datos parciales mientras procesa.
- Dashboard muestra ultima actualizacion AVC/SAT y animacion suave durante merge/conciliacion/sync.
- Comparativa por clase ahora expone diferencias por carril; click abre `LaneDetail` filtrado para revisar eventos de esa clase.
- Comparativa por clase ahora muestra impacto economico global y por clase:
  - SAT registrado usa suma real de `sat_prix`.
  - AVC estimado usa tarifas AVC configuradas en `avc_tariffs`.
  - Si falta una tarifa AVC, usa como respaldo la tarifa SAT mas frecuente para esa clase en el cache de la fecha.
- `Settings -> System Configuration -> Integracion SAT` incluye tabla de tarifas AVC por clase y comparacion contra tarifa SAT automatica.
- Nuevo endpoint `GET /api/sat/tariffs` extrae tarifas SAT observadas por clase desde todos los `SAT-TEXCOCO-*-MERGED.json` historicos si no se pasa `day`; esto permite llenar clases raras como C7/C8 aunque no existan en la fecha actual.
- Las tarifas AVC se guardan en `/api/config` como `avc_tariffs`; `engine.default_db_form()` y `settings_keys()` ya incluyen esa clave para persistencia.
- Se agrego fallback para leer `avc_tariffs` desde `avc_sources.config` si quedaron guardadas ahi antes de corregir persistencia.
- Detalle SAT incluye campos extra: `id_obs_mp`, `id_paiement`, `mode_reglement`, `matricule`, etc.
- Servicio reiniciado y verificado en `http://localhost:8080` con PID `3628892`.

## Reglas Importantes

- No modificar `engine.py` sin revisar primero el algoritmo completo de conciliacion.
- No modificar `_ensure_schema` en `api.py` sin verificar compatibilidad con `app_settings.db`.
- No imprimir ni registrar credenciales de `avc_sources.config`.
- No commitear `app_settings.db`.
- No ejecutar SQL destructivo sin aprobacion explicita.
- Los Excel de analisis local (`analisis_*.xlsx` y `.~lock.*`) son artefactos de trabajo y no deben commitearse salvo solicitud explicita.

## Pendientes Conocidos

- Mantener este archivo actualizado al cerrar cambios importantes.
- Registrar aqui decisiones recientes, bugs abiertos o pasos manuales pendientes.
- Si gerencia valida tarifas oficiales AVC, capturarlas en `Integracion SAT -> Tarifas AVC` y guardar; el Dashboard cambiara la fuente de tarifa a `AVC configurada`.
