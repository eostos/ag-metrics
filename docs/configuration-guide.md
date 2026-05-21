# Configuration Guide — AG-metrics AVC/SAT

## Overview

AG-metrics has three layers of configuration:

1. **Environment variables** (`.env` file, optional) — database/SSH defaults
2. **SQLite settings** (`app_settings` table) — persistent runtime config
3. **AVC source configs** (`avc_sources.config` column) — per-source connection settings

---

## Environment Variables (`.env` file)

The `.env` file is **optional** and not committed to git. It is loaded by `engine.py` via `load_dotenv()`.

These variables set **default values** for the database connection form. They are overridden by values saved in the SQLite `app_settings` table.

| Variable | Default (if not set) | Purpose |
|----------|---------------------|---------|
| `SSH_HOST` | `""` | SSH server hostname/IP |
| `SSH_USER` | `""` | SSH username |
| `SSH_PASSWORD` | `""` | SSH password |
| `SSH_PORT` | `"22"` | SSH port |
| `MEDIA_ROOT` | `"/opt/alice-media"` | Base path for vehicle images on SSH server |
| `POSTGRES_HOST` | `"127.0.0.1"` | PostgreSQL host |
| `POSTGRES_PORT` | `"5432"` | PostgreSQL port |
| `POSTGRES_DATABASE` | `"alice_guardian"` | PostgreSQL database name |
| `POSTGRES_USER` | `"postgres"` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `""` | PostgreSQL password |

Example `.env`:
```
SSH_HOST=10.10.0.1
SSH_USER=ubuntu
SSH_PASSWORD=<not shown here>
POSTGRES_HOST=127.0.0.1
POSTGRES_DATABASE=alice_guardian
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<not shown here>
```

---

## SQLite Settings (`app_settings` table)

Written by `save_settings()` in `engine.py:175`. Read by `load_saved_settings()`.

These settings are managed via the Config screen (Admin only) through `POST /api/config`.

| Key | Description |
|-----|-------------|
| `ssh_host` | SSH tunnel host |
| `ssh_user` | SSH username |
| `ssh_password` | SSH password (stored in plaintext in SQLite) |
| `ssh_port` | SSH port (default: 22) |
| `media_root` | Remote path for vehicle images |
| `postgres_host` | PostgreSQL host |
| `postgres_port` | PostgreSQL port |
| `postgres_database` | PostgreSQL database |
| `postgres_user` | PostgreSQL user |
| `postgres_password` | PostgreSQL password (stored in plaintext in SQLite) |
| `plaza_name` | Plaza display name (shown in Dashboard header) |
| `timezone` | Timezone for timestamp normalization (IANA name, e.g. `America/Mexico_City`) |
| `lane_mapping` | JSON string mapping AVC lane names to SAT voie IDs |

### Lane Mapping Format

`lane_mapping` is a JSON string:
```json
{"Axle-Lane1": "1", "Axle-Lane2": "2", "Axle-Lane9": "9"}
```
Keys are AVC lane names (as they appear in `avc_local_events.lane_name`).  
Values are SAT voie identifiers (as they appear in the SAT transaction files).

---

## AVC Source Configuration

Each entry in `avc_sources` has a `config` column containing a JSON object. The JSON keys depend on the source `type`.

### type=database (PostgreSQL + SSH)

```json
{
  "ssh_host": "10.10.0.1",
  "ssh_user": "ubuntu",
  "ssh_password": "<password>",
  "ssh_port": "22",
  "postgres_host": "127.0.0.1",
  "postgres_port": "5432",
  "postgres_database": "alice_guardian",
  "postgres_user": "postgres",
  "postgres_password": "<password>",
  "media_root": "/opt/alice-media",
  "timezone": "America/Mexico_City",
  "lane_mapping": "{}",
  "plaza_name": "Plaza Texcoco"
}
```

**Local mode:** If `ssh_host`, `ssh_user`, and `ssh_password` are all empty, the PostgreSQL connection is made directly (no SSH tunnel).

### type=api (Alice Guardian REST API)

```json
{
  "api_url": "https://alice-server:8080",
  "auth_type": "bearer",
  "api_key": "<token>",
  "events_path": "/api/v1/events",
  "date_param": "from",
  "date_end_param": "to",
  "lane_param": "lane",
  "verify_ssl": true,
  "events_key": "data",
  "field_id": "id",
  "field_lane": "lane_name",
  "field_type": "vehicle_type",
  "field_axles": "axle_count",
  "field_timestamp": "created_at",
  "field_image_url": "vehicle_image_url",
  "field_image_path": "vehicle_image_path"
}
```

---

## System-Level Configuration (Hardcoded Paths)

These paths are hardcoded in `api.py` and `sat_watcher.py`. Changing them requires editing the source files.

| Variable | Value | File |
|----------|-------|------|
| `PORT` | `8080` | `run.sh` |
| `MERGED_DIR` | `~/sat_merged` | `api.py:42` |
| `WATCH_DIR` | `/home/sftpuser/uploads` | `api.py:43` |
| `SETTINGS_DB_PATH` | `<project_dir>/app_settings.db` | `engine.py:32` |
| `WATCH_DIR` (watcher) | `/home/sftpuser/uploads` | `sat_watcher.py:14` |
| `OUTPUT_DIR` (watcher) | `~/sat_merged` | `sat_watcher.py:15` |
| `POLL_SECS` | `60` | `sat_watcher.py:17` |
| `LOG_FILE` (prod) | `/tmp/auditec_api.log` | `run.sh:8` |

`sat_watcher.py` and `api.py` must use the same merged directory. The current code aligns both on `~/sat_merged/`.

---

## Timezone Configuration

AG-metrics normalizes all timestamps to a single configured timezone before comparison. This is critical because:
- AVC timestamps may be stored in UTC in PostgreSQL.
- SAT timestamps are typically local time.
- The date filter for AVC events uses the configured timezone to determine what "today" means.

Supported timezones (from Config → Sistema):
- `America/Mexico_City` (Centro — CDMX, Jalisco, NL, UTC−6/−5) — **default**
- `America/Monterrey`
- `America/Cancun` (UTC−5, no DST)
- `America/Chihuahua`
- `America/Hermosillo` (UTC−7, no DST)
- `America/Mazatlan`
- `America/Tijuana`
- `UTC`

---

## First-Run Setup Checklist

1. Start the server: `./run.sh debug`
2. Login with default admin: `admin@auditec.mx` / `admin123`
3. **Change the admin password immediately.**
4. Go to Config → Sistema: set the correct timezone and plaza name.
5. Go to Config → Fuentes AVC: add an AVC source (type=database or type=api).
6. Test the connection: click "Probar" on the source.
7. Go to Config → Sistema: set up lane mapping (AVC lane name → SAT voie).
8. Sync data: click "Sincronizar" on the Dashboard or in Fuentes AVC.
9. Open a lane to verify reconciliation results.
