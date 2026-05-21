# Skill: API Integration Review

## When to Use This Skill

Use this skill when:
- A new AVC source (type=api) is being configured and events are not appearing
- An existing API integration stopped returning data
- The Alice Guardian API changed its response schema and field mapping needs updating
- A new SAT batch file format has arrived and the column auto-detection is failing
- Reviewing the health of all configured integrations

---

## Validation Steps

### Step 1: Verify Source Configuration

```bash
# List all sources and their state
sqlite3 app_settings.db "SELECT id, name, type, enabled, last_sync FROM avc_sources;"

# Inspect source config (Admin only — contains credentials)
sqlite3 app_settings.db "SELECT id, name, type, config FROM avc_sources WHERE id=1;" | python3 -c "
import sys, json
for line in sys.stdin:
    parts = line.strip().split('|')
    if len(parts) >= 4:
        cfg = json.loads(parts[3])
        # Print config without exposing passwords
        safe = {k: ('***' if 'password' in k.lower() or 'key' in k.lower() or 'secret' in k.lower() else v) for k,v in cfg.items()}
        print(json.dumps(safe, indent=2))
"
```

### Step 2: Test the API Connection

```bash
# Via AUDITEC's test endpoint (safest method — uses stored config)
curl -s -X POST http://localhost:8080/api/sources/1/test \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool
```

Expected: `{"ok": true, "records": N, "lanes": [...]}`  
If `ok: false`: the error message will indicate the failure type (connection refused, auth failure, invalid response, etc.)

`POST /api/sources/{id}/sync` stores events under that source's `source_id`. When later reconciling or reading lane events, include the same `source_id` if multiple AVC sources can contain the same lane name.

### Step 3: Manual API Response Inspection

If the test fails, manually trace the API call (do not print credentials):

```bash
.venv/bin/python -c "
from engine import load_saved_settings
from api import _fetch_from_api
import sqlite3, json
from datetime import date

conn = sqlite3.connect('app_settings.db')
conn.row_factory = sqlite3.Row
row = conn.execute('SELECT config FROM avc_sources WHERE id=1').fetchone()
cfg = json.loads(row['config'])

# Test with today
df = _fetch_from_api(cfg, date.today())
print(f'Records: {len(df)}')
if not df.empty:
    print('Columns:', df.columns.tolist())
    print('First row:', df.iloc[0].to_dict())
"
```

### Step 4: Schema Review (API Response)

Check if the API response structure matches what AUDITEC expects:
- Is there a top-level array, or is it nested under a key?
- What is the key name for the events array? (configure `events_key`)
- What are the field names for: id, lane, vehicle_type, axle_count, timestamp?

Compare with the configured field mapping in `avc_sources.config`:
- `field_id`, `field_lane`, `field_type`, `field_axles`, `field_timestamp`

If fields don't match: update the source config via `PUT /api/sources/{id}`.

The API fetcher normalizes mapped fields to: `id`, `lane_name`, `vehicle_type`, `axle_count`, `event_mexico`, `created_at_mexico`, `device_with_lane`, `vehicle_image_url`, and `vehicle_image_path`. `_fetch_and_store()` then auto-detects those columns before writing `avc_local_events`.

### Step 5: SAT File Schema Validation

When SAT files arrive with new column names:

```bash
# Sample the latest SAT file
python3 -c "
import json, glob, os
files = sorted(glob.glob('/home/sftpuser/uploads/SAT-TEXCOCO-*.json'))
if not files:
    files = sorted(glob.glob(os.path.expanduser('~/sat_merged/SAT-TEXCOCO-*-MERGED.json')))
if files:
    with open(files[-1]) as f:
        d = json.load(f)
    txns = d.get('transactions', d if isinstance(d, list) else [])
    if txns:
        print('Columns found:', list(txns[0].keys()))
        print('First transaction:', json.dumps(txns[0], indent=2))
"
```

Compare detected columns with patterns in `_auto_cols_sat()` (`api.py:396`):
- `date_transaction` → `date`
- `voie` → `voie`
- `id_classe` → `cls`
- `tab_id_classe` → `tab`
- `numero_transaction` → `num`
- `prix_total` → `prix`

If SAT file uses different names, update the regex patterns in `_auto_cols_sat()`.

Reconciliation class matching is exact: the AVC-mapped class must equal `id_classe` or `tab_id_classe`. A SAT schema issue that swaps or zeroes these fields can create many `clase_distinta` AVC-only rows even when timestamps are aligned.

---

## Error Handling Checks

| Failure Mode | Where to Check |
|-------------|---------------|
| API returns 401 | Check `auth_type` and `api_key` in source config |
| API returns 403 | API key lacks permissions for the events endpoint |
| API SSL error | Set `verify_ssl: false` in source config (not recommended for production) |
| API returns empty array | Verify `date_param` / `date_end_param` names match API contract |
| API array is nested | Set `events_key` to the correct JSON key |
| SAT file parse fails | Check for embedded CRLF (already handled) or malformed JSON |
| Timestamp parse fails | Check `parse_date()` in `engine.py:546` — add new format if needed |

---

## Data Consistency Checks

After a successful sync:

```bash
# Check for events with null axle counts (will map to class 0 = unmatchable)
sqlite3 app_settings.db "
SELECT COUNT(*) as null_axles FROM avc_local_events
WHERE event_date='2026-05-19' AND axle_count IS NULL;"

# Check for events with null timestamps (will be skipped in reconciliation)
sqlite3 app_settings.db "
SELECT COUNT(*) as null_ts FROM avc_local_events
WHERE event_date='2026-05-19' AND event_timestamp IS NULL;"

# Check lane name distribution
sqlite3 app_settings.db "
SELECT lane_name, COUNT(*) FROM avc_local_events
WHERE event_date='2026-05-19' GROUP BY lane_name ORDER BY COUNT(*) DESC;"
```

---

## Retry Logic

The current codebase does **not** implement automatic retries for API calls. A failed sync must be manually retried. If automated retries are needed, they must be implemented in `_fetch_from_api()` (`api.py:191`).
