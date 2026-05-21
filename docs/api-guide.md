# API Guide — AUDITEC AVC/SAT

Base URL: `http://localhost:8080`  
Interactive docs: `http://localhost:8080/api/docs`  
All endpoints (except login) require `Authorization: Bearer <token>`.

---

## Authentication

### POST /api/auth/login
**Auth required:** No

Request:
```json
{ "email": "admin@auditec.mx", "password": "admin123" }
```
Response:
```json
{ "token": "<bearer-token>", "user": { "id": 1, "name": "...", "email": "...", "role": "Admin" } }
```
Sessions expire after 24 hours.

### POST /api/auth/logout
**Auth required:** Yes  
Deletes the caller's session token. Returns `{"ok": true}`.

---

## AVC Sources

### GET /api/sources
Returns list of all AVC sources (credentials excluded from response).

### POST /api/sources
**Admin only**  
Request body:
```json
{
  "name": "AVC Principal",
  "type": "database",
  "config": {
    "ssh_host": "...", "ssh_user": "...", "ssh_password": "...", "ssh_port": "22",
    "postgres_host": "127.0.0.1", "postgres_port": "5432",
    "postgres_database": "alice_guardian", "postgres_user": "postgres", "postgres_password": "..."
  }
}
```
For `type: "api"`, config fields include `api_url`, `api_key`, `auth_type`, `events_path`, and field mapping keys.

### GET /api/sources/{sid}
**Admin only** — returns full config including credentials.

### PUT /api/sources/{sid}
**Admin only** — updates `name`, `config`, or `enabled` fields.

### DELETE /api/sources/{sid}
**Admin only**

### POST /api/sources/{sid}/test
Tests connectivity for today's date. Returns:
```json
{ "ok": true, "records": 142, "lanes": ["Axle-Lane1", "Axle-Lane2"] }
```
or `{ "ok": false, "error": "..." }`.

### POST /api/sources/{sid}/sync
Fetches events from the source and stores them in `avc_local_events`.  
Request: `{ "date": "2026-05-19", "lane": "Axle-Lane1" }` (lane optional)  
Response: `{ "ok": true, "records": 856, "date": "2026-05-19" }`

---

## Lanes and Events

### GET /api/lanes
Query params: `query_date=YYYY-MM-DD`, `source_id=<int>` (optional)  
Returns lanes known for that date from local storage, with cached reconciliation stats.

```json
{
  "lanes": [{"id": "Axle-Lane1", "name": "Axle-Lane1", "source_id": 1, "source_name": "AVC Principal", "source_type": "database"}],
  "stats": {
    "Axle-Lane1": {"total": 856, "matched": 830, "avcOnly": 14, "satOnly": 8, "axleErr": 4, "matchRate": 96.8, "spark": [...]}
  }
}
```

### GET /api/lanes/{lane_id}/events
Query params: `query_date`, `source_id`, `offset`, `limit`  
Returns events for the lane. Checks reconciliation cache first, then local events.

```json
{
  "events": [ { "tipo": "MATCH", "avc_id": "...", "avc_date": "...", "sat_date": "...", ... } ],
  "total": 856,
  "summary": { ... },
  "source": "reconciled"
}
```
`source` values: `"reconciled"` | `"local"` | `"none"`

---

## SAT Data

### GET /api/sat/merged-files
Returns list of `SAT-TEXCOCO-*-MERGED.json` files in `~/sat_merged/`.

### GET /api/sat/lanes?day=YYYYMMDD
Returns SAT voie identifiers for the specified day's merged file.

### GET /api/avc/lanes
Returns all unique AVC lane names ever stored in `avc_local_events`.

### GET /api/sat/voies
Returns all unique SAT voie values across all merged files (used for lane mapping UI).

### GET /api/sat/directory
Returns the status of the SFTP upload directory: pending files per day, merged status, transaction counts.

### POST /api/merge-sat
Merges pending SAT JSON batches for a given day.  
Request: `{ "day": "20260519" }`  
Response: `{ "ok": true, "added": 142, "skipped": 3, "total": 1430, "path": "..." }`

---

## Reconciliation

### POST /api/reconcile
Runs the reconciliation engine for one AVC lane vs one SAT voie.

Request:
```json
{
  "avc_lane": "Axle-Lane1",
  "sat_lane": "1",
  "date": "2026-05-19",
  "window_s": 120,
  "source_id": 1
}
```
- `window_s`: how many seconds before the AVC event to search for SAT matches (default: 120).
- `sat_lane`: if omitted, resolved from the lane_mapping config.

Response:
```json
{
  "result": [
    {
      "tipo": "MATCH",
      "avc_id": "...", "avc_device": "Axle-Lane1", "avc_date": "2026-05-19 08:14:32",
      "Vehicle_type": "truck", "axles_avc": 5, "clase_avc_mapeada": 5,
      "sat_voie": "1", "sat_date": "2026-05-19 08:14:28",
      "sat_numero": "TXN-001234", "sat_prix": "82.00",
      "id_classe": "5", "tab_id_classe": "5",
      "sat_id_classe_desc": "C5 - Camion 5 Ejes", "sat_id_classe_ejes": 5,
      "match_valido": true, "nota_ejes": "OK(5=5)",
      "delta_segundos": -4, "observacion_auditoria": "Match correcto - ejes coinciden"
    }
  ],
  "summary": { "total": 856, "matched": 830, "avcOnly": 14, "satOnly": 8, "axleErr": 4, "matchRate": 96.8 },
  "cols": { "avc": {...}, "sat": {...} }
}
```

### GET /api/reconcile/cache
Lists all entries in the reconciliation cache with summary stats.

### GET /api/class-summary?query_date=YYYY-MM-DD
Returns AVC vs SAT class distribution aggregated from the reconciliation cache.

```json
{
  "date": "2026-05-19",
  "breakdown": [
    { "class_id": 1, "name": "Auto", "avc": 412, "sat": 408 },
    { "class_id": 5, "name": "C5", "avc": 88, "sat": 90 }
  ]
}
```

---

## Status and Polling

### GET /api/status?query_date=YYYY-MM-DD
Fast polling endpoint (called every 30s by Dashboard). Returns:
```json
{
  "date": "2026-05-19",
  "sat_pending": 0,
  "sat_merged": 1430,
  "sat_lanes": ["1", "2", "3"],
  "avc_events": 856,
  "avc_lanes": ["Axle-Lane1"],
  "sources": [...],
  "timezone": "America/Mexico_City",
  "lane_mapping": { "Axle-Lane1": "1" },
  "timestamp": "2026-05-19T..."
}
```

---

## Configuration (Legacy)

### GET /api/config
**Admin only** — returns the `app_settings` key-value store as a flat object.

### POST /api/config
**Admin only** — saves settings and syncs to the first `database`-type AVC source.

---

## Users

### GET /api/users — Admin only
### POST /api/users — Admin only
Request: `{ "name": "...", "email": "...", "password": "...", "role": "Auditor" }`  
Roles: `Admin` | `Auditor` | `Operator`

### PUT /api/users/{uid} — Admin only
Supports: `status` (`Active`/`Inactive`), `role`, `password`.

---

## Images (Proxy)

### GET /api/image?ref=<path>&source_id=<int>
Proxies vehicle images from the remote SSH server's media directory.  
`ref` can be a path or URL; localhost URLs are rewritten to the path component.  
Returns the raw image bytes with correct MIME type.

---

## Frontend

### GET / (and /index.html, /AUDITEC.html)
Serves `frontend/AUDITEC.html` with no-cache headers.  
All other static assets served from `frontend/`.
