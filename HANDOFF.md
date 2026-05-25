# HANDOFF.md

Fecha: 2026-05-24

## Estado Actual

- Contexto persistente disponible en `AGENTS.md` y `PROJECT_CONTEXT.md`.
- No hay suite automatizada formal documentada para este repo.
- El servidor usa FastAPI en `api.py`; el motor de conciliacion vive en `engine.py`.
- La UI principal operativa esta en `frontend/components/Operations.jsx`.
- La configuracion SMTP debe mantenerse centralizada en `Settings -> Email / SMTP Configuration`.
- Cambios recientes: sync AVC automatico en backend, estado `processing` en `/api/status`, dashboard evita pintar datos parciales mientras procesa.
- Dashboard muestra ultima actualizacion AVC/SAT y animacion suave durante merge/conciliacion/sync.
- Comparativa por clase ahora expone diferencias por carril; click abre `LaneDetail` filtrado para revisar eventos de esa clase.
- Detalle SAT incluye campos extra: `id_obs_mp`, `id_paiement`, `mode_reglement`, `matricule`, etc.

## Reglas Importantes

- No modificar `engine.py` sin revisar primero el algoritmo completo de conciliacion.
- No modificar `_ensure_schema` en `api.py` sin verificar compatibilidad con `app_settings.db`.
- No imprimir ni registrar credenciales de `avc_sources.config`.
- No commitear `app_settings.db`.
- No ejecutar SQL destructivo sin aprobacion explicita.

## Pendientes Conocidos

- Mantener este archivo actualizado al cerrar cambios importantes.
- Registrar aqui decisiones recientes, bugs abiertos o pasos manuales pendientes.
