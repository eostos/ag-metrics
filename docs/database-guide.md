# Database Guide — AG-metrics AVC/SAT

## Local Database: SQLite

File: `app_settings.db` (in the project root)  
Created automatically on first startup by `_ensure_schema()` in `api.py`.  
**This file is gitignored and must never be committed.** It contains credentials and production data.

---

## Tables

### `auditec_users`

Stores application users.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| name | TEXT | Display name |
| email | TEXT UNIQUE | Login identifier |
| password_hash | TEXT | SHA-256 hex digest |
| role | TEXT | `Admin` \| `Auditor` \| `Operator` |
| status | TEXT | `Active` \| `Inactive` |
| last_login | TEXT | ISO datetime string |
| created_at | TEXT | ISO datetime string |

Default seed: `admin@auditec.mx` / `admin123` (SHA-256 hashed). **Change immediately in production.**

---

### `auditec_sessions`

Token-based sessions. Sessions expire after 24 hours.

| Column | Type | Notes |
|--------|------|-------|
| token | TEXT PK | `secrets.token_urlsafe(32)` |
| user_id | INTEGER | FK → auditec_users.id |
| expires_at | TEXT | ISO datetime string |

---

### `avc_sources`

Configured AVC data sources. Supports two integration types.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| name | TEXT | Human label |
| type | TEXT | `database` or `api` |
| config | TEXT | JSON blob with all credentials |
| enabled | INTEGER | 1 = active, 0 = disabled |
| last_sync | TEXT | ISO datetime of last sync |
| created_at | TEXT | |

**Security note:** The `config` column stores SSH passwords, PostgreSQL passwords, and API keys as plaintext JSON. This is stored in the gitignored SQLite file. Do not expose this column in logs or API responses without Admin auth.

Config keys for `type=database`:
- `ssh_host`, `ssh_user`, `ssh_password`, `ssh_port`
- `postgres_host`, `postgres_port`, `postgres_database`, `postgres_user`, `postgres_password`
- `media_root`, `timezone`, `lane_mapping`, `plaza_name`

Config keys for `type=api`:
- `api_url`, `api_key`, `auth_type` (`bearer` | `api-key` | `basic`)
- `api_user`, `api_password` (basic auth only)
- `events_path`, `date_param`, `date_end_param`, `lane_param`, `verify_ssl`
- `field_id`, `field_lane`, `field_type`, `field_axles`, `field_timestamp`, `field_image_url`, `field_image_path`, `events_key`

---

### `avc_local_events`

Locally cached AVC vehicle crossing events. Populated by `POST /api/sources/{sid}/sync`.

| Column | Type | Notes |
|--------|------|-------|
| event_id | TEXT | ID from source system |
| source_id | INTEGER | FK → avc_sources.id |
| event_date | TEXT | YYYY-MM-DD |
| lane_name | TEXT | Device/lane identifier |
| vehicle_type | TEXT | e.g. `"truck"`, `"light"`, `"bus"`, `"motorcycle"` |
| axle_count | INTEGER | Raw axle count from AVC sensor |
| event_timestamp | TEXT | ISO datetime of the physical event |
| vehicle_image_url | TEXT | Remote URL (may need SSH proxy) |
| vehicle_image_path | TEXT | Remote filesystem path |
| extra_json | TEXT | All other source fields as JSON |
| synced_at | TEXT | When this record was stored locally |

**Primary key:** (`event_id`, `source_id`) — duplicate syncs use `INSERT OR REPLACE`.

---

### `recon_cache`

Stores the full reconciliation result per (source, lane, date) tuple.

| Column | Type | Notes |
|--------|------|-------|
| cache_key | TEXT PK | Format: `{source_id}::{lane_name}::{YYYY-MM-DD}` |
| result_json | TEXT | JSON array of reconciliation rows |
| summary_json | TEXT | JSON with total/matched/avcOnly/satOnly/axleErr/matchRate |
| source_id | INTEGER | Denormalized for quick filtering |
| created_at | TEXT | |

The cache is invalidated (deleted by `event_date`) when a new sync occurs for that date. This forces re-reconciliation on the next lane open.

---

### `app_settings`

Key-value store for system configuration (legacy, still used by `GET /api/config`).

| Column | Type | Notes |
|--------|------|-------|
| setting_key | TEXT PK | One of the keys in `settings_keys()` in `engine.py` |
| setting_value | TEXT | String value |
| updated_at | TEXT | |

Known keys: `ssh_host`, `ssh_user`, `ssh_password`, `ssh_port`, `media_root`, `postgres_host`, `postgres_port`, `postgres_database`, `postgres_user`, `postgres_password`, `plaza_name`, `timezone`, `lane_mapping`

`lane_mapping` stores a JSON string: `{"AVC-Lane-Name": "SAT-Voie-ID", ...}`

---

## External Database: PostgreSQL (`alice_guardian`)

Used only when an AVC source has `type=database`. Connection goes through an SSH tunnel when `ssh_host` is configured.

### Tables Queried (from `engine.py`)

**`public."AVCs"`** — vehicle detection events from Alice Guardian

| Column | Notes |
|--------|-------|
| id | Event ID |
| vehicle_type | Vehicle type string |
| axle_count | Number of axles detected |
| vehicle_image_path | Path to image on remote server |
| vehicle_image_url | URL for image |
| lane_no | Lane number |
| timestamp | Event timestamp (can be epoch ms, epoch s, or ISO string) |
| createdAt | DB insert timestamp (used as fallback) |
| updatedAt | Last update timestamp |
| deviceId | FK to Devices table |

**`public."Devices"`** — lane device registry

| Column | Notes |
|--------|-------|
| deviceId | PK |
| name | Lane name (string used as lane identifier) |

The query in `fetch_avc_dataframe()` joins `AVCs` and `Devices` on `deviceId`, filters by date using `timezone(%s, "createdAt")::date = %s::date`, and handles multiple timestamp formats (epoch ms, epoch s, ISO string).

---

## SAT Data Files (Not a Database)

SAT data is not stored in a database — it arrives as JSON files and is kept as merged JSON files on disk.

**Upload directory:** `/home/sftpuser/uploads/`  
**Merged directory:** `~/sat_merged/`  
**File pattern:** `SAT-TEXCOCO-YYYYMMDD-MERGED.json`

Merged file structure:
```json
{
  "batchuid": "SAT-TEXCOCO-20260519-MERGED",
  "sourcesystem": "SATTexcoco",
  "generatedat": "2026-05-19T08:30:00",
  "processed_batches": ["batch-uid-1", "batch-uid-2"],
  "transactions": [
    {
      "date_transaction": "2026-05-19 08:14:28",
      "voie": "1",
      "id_classe": 5,
      "tab_id_classe": 5,
      "numero_transaction": "TXN-001234",
      "prix_total": "82.00"
    }
  ]
}
```

SAT column names are auto-detected by `_auto_cols_sat()` in `api.py` using regex patterns.

---

## Common Queries

```sql
-- Count events per date
SELECT event_date, COUNT(*) FROM avc_local_events GROUP BY event_date ORDER BY event_date DESC;

-- Check reconciliation cache
SELECT cache_key, summary_json, created_at FROM recon_cache ORDER BY created_at DESC;

-- Find a specific event
SELECT * FROM avc_local_events WHERE event_id = '12345';

-- List AVC sources
SELECT id, name, type, enabled, last_sync FROM avc_sources;

-- Clear cache for a date (forces re-reconciliation)
DELETE FROM recon_cache WHERE cache_key LIKE '%::2026-05-19';
```
