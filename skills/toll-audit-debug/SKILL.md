# Skill: Toll Audit Debug

## When to Use This Skill

Use this skill when:
- A reconciliation run produces unexpected results (too many AVC-only, too many SAT-only, no matches at all)
- A lane is missing from the Dashboard
- Match rate is anomalously low (below expected threshold)
- Axle error counts are unusually high
- A specific transaction appears to be missing from results
- The user reports that "something is wrong" with the audit for a specific date or lane

---

## Step-by-Step Debugging Procedure

### Step 1: Confirm Data Exists

```bash
# AVC events for the date/lane
sqlite3 app_settings.db "
SELECT event_date, lane_name, COUNT(*) as events,
       COUNT(DISTINCT vehicle_type) as types,
       MIN(event_timestamp) as first, MAX(event_timestamp) as last
FROM avc_local_events
WHERE event_date = '2026-05-19' AND lane_name = 'Axle-Lane1'
GROUP BY event_date, lane_name;"

# SAT transactions in merged file
python3 -c "
import json
with open('/root/sat_merged/SAT-TEXCOCO-20260519-MERGED.json') as f:
    d = json.load(f)
txns = [t for t in d['transactions'] if str(t.get('voie','')) == '1']
print(f'SAT transactions for voie 1: {len(txns)}')
if txns: print('First:', txns[0])
"
```

### Step 2: Inspect Column Auto-Detection

Run the reconciliation manually and check the `cols` field:
```bash
curl -s -X POST http://localhost:8080/api/reconcile \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"avc_lane":"Axle-Lane1","sat_lane":"1","date":"2026-05-19","window_s":120}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print(json.dumps(r.get('cols',{}), indent=2)); print('Error:', r.get('error','none'))"
```

If any column key is empty string (`""`), the auto-detection failed — the column name in the data doesn't match the regex patterns in `_auto_cols_avc()` or `_auto_cols_sat()`.

### Step 3: Check Time Window Alignment

Look at the `candidatos_sat` field on unmatched AVC rows — this shows what SAT events were considered and why they were rejected. The current window is `[AVC_ts - window_s, AVC_ts + 30s]`; `window_s` controls only the "before AVC" side.

```bash
curl -s "http://localhost:8080/api/lanes/Axle-Lane1/events?query_date=2026-05-19" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
avc_only = [e for e in data.get('events',[]) if e.get('tipo') == 'AVC']
print(f'AVC-only rows: {len(avc_only)}')
for e in avc_only[:5]:
    print(f'  {e.get(\"avc_date\",\"\")} | {e.get(\"motivo_no_match\",\"\")} | {e.get(\"candidatos_sat\",\"\")[:100]}')
"
```

Common patterns in `candidatos_sat`:
- `"sin_candidatos_en_ventana+-120s"` — no SAT events within the window. Check timestamps.
- `"#N[D-90s clsX/tabY->INCOMPAT...]"` — SAT events found but class mismatch.

Class compatibility is exact in the current `engine.py`: mapped AVC class must equal SAT `id_classe` or `tab_id_classe`. Same-category matches such as truck class 5 vs truck class 6 are rejected unless the code is changed.

### Step 4: Check Timestamps

Time zone mismatch is the most common cause of "no candidates in window":

```bash
# What timezone is configured?
sqlite3 app_settings.db "SELECT setting_value FROM app_settings WHERE setting_key='timezone';"

# Sample AVC timestamps
sqlite3 app_settings.db "SELECT event_timestamp FROM avc_local_events WHERE event_date='2026-05-19' AND lane_name='Axle-Lane1' LIMIT 5;"

# Sample SAT timestamps from merged file
python3 -c "
import json
with open('/root/sat_merged/SAT-TEXCOCO-20260519-MERGED.json') as f:
    d = json.load(f)
txns = [t for t in d['transactions'] if str(t.get('voie','')) == '1'][:5]
for t in txns:
    print(t.get('date_transaction') or t.get('fecha') or t)
"
```

If AVC timestamps are in UTC and SAT is in local time (or vice versa), all time-window searches will fail. Verify the `timezone` setting matches the SAT file's timestamp zone.

### Step 5: Test Class Mapping

```bash
# Check unique vehicle types in AVC data
sqlite3 app_settings.db "SELECT DISTINCT vehicle_type, COUNT(*) FROM avc_local_events WHERE event_date='2026-05-19' GROUP BY vehicle_type;"

# Test mapping for each type
.venv/bin/python -c "
from engine import map_avc_class
types = [('truck', 5), ('light', 2), ('bus', 3), ('motorcycle', 2)]
for vt, ax in types:
    print(f'{vt}/{ax} → class {map_avc_class(vt, ax)}')
"
```

### Step 6: Expand the Time Window

If many AVC events have SAT candidates but they fall outside the window, try a wider window:
```bash
curl -s -X POST http://localhost:8080/api/reconcile \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"avc_lane":"Axle-Lane1","sat_lane":"1","date":"2026-05-19","window_s":300}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print(json.dumps(r.get('summary',{}), indent=2))"
```

---

## Expected Outputs

A healthy reconciliation:
- `matchRate` ≥ 93% (typically ≥ 97% for a well-calibrated system). This is AVC detection rate, not perfect-match percentage.
- `satOnly` < 5% of total
- `avcOnly` < 5% of total
- `axleErr` < 3% of total

A reconciliation with clock skew:
- `avcOnly` approaches 100%, `candidatos_sat` shows `sin_candidatos_en_ventana`

A reconciliation with class mismatch:
- `avcOnly` elevated, `candidatos_sat` shows `INCOMPAT` entries

---

## Safety Rules

- Never delete from `avc_local_events` without explicit user authorization.
- Never delete from `recon_cache` in production without first documenting the current state.
- If adjusting `map_avc_class()` or `is_class_compatible()` in engine.py, re-run all affected dates after saving — the cache must be cleared: `DELETE FROM recon_cache WHERE cache_key LIKE '%::YYYY-MM-DD'`.
- Do not increase `window_s` beyond 600 seconds without business approval — a 10-minute window may incorrectly pair events from different vehicles.
