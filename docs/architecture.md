# Architecture — AG-metrics AVC/SAT

## System Overview

AG-metrics is a single-process web application. One Uvicorn process (or 2 in production) runs the FastAPI app defined in `api.py`. The same process serves both the REST API and the React frontend as static files. There is an optional separate polling process (`sat_watcher.py`) for SAT file ingestion.

---

## Modules and Responsibilities

| File | Role |
|------|------|
| `api.py` | FastAPI application. All REST endpoints. SQLite schema. Auth. AVC fetch/store. SAT merge. Reconciliation orchestration. Static file serving. |
| `engine.py` | Business logic only. AVC PostgreSQL queries. SSH tunnel management. Reconciliation algorithm. Vehicle class mapping. Axle comparison. Settings persistence. |
| `sat_watcher.py` | Standalone polling daemon. Watches `/home/sftpuser/uploads/` every 60 seconds. Merges daily SAT JSON batches. Not started by `run.sh`. |
| `app.py` | Legacy Streamlit interface. Uses the same `engine.py`. Not the primary interface. |
| `frontend/AUDITEC.html` | Single HTML entry point. Loads all JSX components via Babel standalone. Defines global `window.API` client. |
| `frontend/components/` | React components loaded in-browser without a build step. |

---

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                   External Systems                       │
│                                                         │
│  Alice Guardian PostgreSQL ──SSH Tunnel──┐             │
│  Alice Guardian REST API ────────────────┤             │
│  SAT System ──SFTP──► /home/sftpuser/uploads/          │
└──────────────────────────────────────────┼─────────────┘
                                           │
                          ┌────────────────▼──────────────┐
                          │        api.py (FastAPI)        │
                          │                               │
                          │  ┌──────────────────────────┐ │
                          │  │  engine.py               │ │
                          │  │  - fetch_avc_dataframe() │ │
                          │  │  - reconcile()           │ │
                          │  │  - map_avc_class()       │ │
                          │  │  - is_class_compatible() │ │
                          │  └──────────────────────────┘ │
                          │                               │
                          │  SQLite: app_settings.db      │
                          │  ├─ auditec_users             │
                          │  ├─ auditec_sessions          │
                          │  ├─ avc_sources               │
                          │  ├─ avc_local_events          │
                          │  ├─ recon_cache               │
                          │  └─ app_settings              │
                          │                               │
                          │  ~/sat_merged/ (JSON files)   │
                          └───────────────┬───────────────┘
                                          │ HTTP (port 8080)
                          ┌───────────────▼───────────────┐
                          │      Browser (React 18)        │
                          │  Dashboard | LaneDetail        │
                          │  Reports   | Config            │
                          └───────────────────────────────┘

sat_watcher.py ──polls every 60s──► /home/sftpuser/uploads/
                                 ──writes──► ~/sat_merged/
```

---

## Mermaid Diagram

```mermaid
graph TD
    subgraph External
        PG[PostgreSQL alice_guardian]
        AliceAPI[Alice Guardian REST API]
        SFTP[SFTP Upload Directory<br/>/home/sftpuser/uploads/]
    end

    subgraph Backend [FastAPI Process — api.py]
        EP_AUTH[/api/auth/*]
        EP_SOURCES[/api/sources/*]
        EP_SYNC[/api/sources/sync]
        EP_RECON[/api/reconcile]
        EP_LANES[/api/lanes/*]
        EP_SAT[/api/sat/*]
        ENGINE[engine.py<br/>reconcile / map_avc_class]
        SQLITE[(SQLite<br/>app_settings.db)]
        MERGED[~/sat_merged/<br/>*.MERGED.json]
    end

    subgraph Watcher [sat_watcher.py — optional]
        SW[polls SFTP dir every 60s]
    end

    subgraph Frontend [React 18 — Babel standalone]
        DASH[Dashboard]
        LANE[LaneDetail]
        RPT[Reports]
        CFG[Config]
    end

    PG -->|SSH Tunnel| EP_SYNC
    AliceAPI -->|HTTP| EP_SYNC
    EP_SYNC --> SQLITE
    SFTP -->|JSON batches| SW
    SW --> MERGED
    EP_SAT --> MERGED
    EP_RECON --> ENGINE
    ENGINE --> SQLITE
    EP_LANES --> SQLITE
    SQLITE --> EP_AUTH
    DASH --> EP_LANES
    DASH --> EP_RECON
    DASH --> EP_SAT
    LANE --> EP_RECON
    CFG --> EP_SOURCES
    RPT --> SQLITE
```

---

## External Dependencies

| Dependency | Version | Purpose |
|-----------|---------|---------|
| fastapi | ≥0.110,<1 | REST framework |
| uvicorn | ≥0.29,<1 | ASGI server |
| pandas | 2.0.3 | DataFrame operations for reconciliation |
| psycopg2-binary | ≥2.9 | PostgreSQL client |
| sshtunnel | ≥0.4,<0.5 | SSH port forwarding |
| paramiko | <4 | SSH client (image proxy) |
| python-dotenv | ≥1.0 | Optional .env support |
| openpyxl / xlrd / xlsxwriter | fixed versions | SAT file reading/writing |
| streamlit | 1.33.0 | Legacy alternative UI |
| plotly | 5.24.1 | Charts in Streamlit UI |
| backports.zoneinfo | Python<3.9 only | Timezone support |

Frontend (CDN, no build):
- React 18.3.1
- Babel standalone 7.29.0
- Chart.js 4.4.0
- Google Fonts (Inter)

---

## Unknowns

- No CI/CD pipeline found in repository.
- No Docker or docker-compose found.
- No reverse proxy configuration (nginx, caddy) found — assumed to exist in the deployment environment.
- `sat_watcher.py` startup mechanism in production is unknown — no systemd unit or supervisor config found.
