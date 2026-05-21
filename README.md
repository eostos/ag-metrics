# AUDITEC AVC/SAT — AG-Metrics

Plataforma de auditoría y conciliación AVC/SAT. Incluye un backend FastAPI y un frontend React servidos desde el mismo proceso.

## Requisitos

- Python 3.8+
- Entorno virtual en `.venv/` (el script lo crea automáticamente)

## Arranque rápido

```bash
./run.sh prod     # producción  — background, 2 workers
./run.sh debug    # desarrollo  — primer plano, reload automático
```

Para una instalación persistente en servidor Linux, instala los servicios `systemd`:

```bash
sudo scripts/install_systemd_services.sh
```

Esto deja activos el backend y el watcher SAT con reinicio automático.

Accede en **http://localhost:8080**  
Credenciales por defecto: `admin@auditec.mx` / `admin123`

## Comandos del script

| Comando | Descripción |
|---------|-------------|
| `./run.sh debug` | Inicia en primer plano con reload automático al guardar archivos |
| `./run.sh prod` | Inicia en background con 2 workers (logs en `/tmp/auditec_api.log`) |
| `./run.sh stop` | Detiene el servidor en background |
| `./run.sh status` | Muestra si el servidor está corriendo y su PID |
| `./run.sh logs` | Sigue el log de producción en tiempo real (`tail -f`) |

## Servicios de producción

| Servicio | Propósito |
|----------|-----------|
| `auditec.service` | Backend FastAPI en puerto 8080 con 2 workers |
| `auditec-sat-watcher.service` | Fusiona archivos SAT pendientes de hoy y ayer hacia `~/sat_merged/` |

Comandos útiles:

```bash
systemctl status auditec.service --no-pager
systemctl status auditec-sat-watcher.service --no-pager
journalctl -u auditec-sat-watcher.service -f
```

## Arquitectura

```
auditec_avc_sat_py38/
├── api.py          — Backend FastAPI (endpoints REST + sirve el frontend)
├── engine.py       — Lógica de conciliación AVC/SAT
├── sat_watcher.py  — Monitor de archivos SAT
├── app.py          — App Streamlit (versión alternativa)
├── run.sh          — Script de gestión del servidor
├── requirements.txt
└── frontend/       — Frontend React (sin build, Babel standalone)
    ├── AUDITEC.html
    └── components/
        ├── Auth.jsx
        ├── Dashboard.jsx
        ├── LaneDetail.jsx
        ├── Reports.jsx
        ├── Config.jsx
        ├── Layout.jsx
        └── MockData.jsx
```

## Flujo de conciliación

1. Inicia sesión con tu cuenta.
2. En **Configuración** (solo Admin), completa las credenciales SSH/PostgreSQL.
3. Desde el **Dashboard**, selecciona fecha y carril AVC.
4. Carga el archivo SAT (CSV / XLSX / JSON).
5. Ajusta el mapeo de columnas y ejecuta la conciliación.
6. Revisa el detalle por carril o exporta desde **Reportes**.

## Notas

- Si dejas vacíos `SSH Host`, `SSH User` y `SSH Password`, la conexión a PostgreSQL se hace en modo local.
- Los defaults de PostgreSQL se leen de variables de entorno si existen.
- En modo `prod`, el PID se guarda en `.auditec.pid` para que `stop` y `status` funcionen correctamente.
