# Skill: Transaction Reconciliation

## When to Use This Skill

Use this skill when:
- Investigating why a specific AVC event did not find a SAT match
- Investigating why a specific SAT transaction appears as "SAT-only"
- Comparing transaction counts between AVC and SAT for a specific lane/date
- Diagnosing systemic discrepancy patterns (e.g., all trucks unmatched, all motorcycles SAT-only)
- Evaluating whether a time-window adjustment would improve match rates
- Reviewing reconciliation results for an audit report

---

## Understanding Result Row Types

Every row in the reconciliation output has a `tipo` field:

| tipo | Meaning | Audit Interpretation |
|------|---------|---------------------|
| `MATCH` | AVC event ↔ SAT transaction paired | Vehicle was detected and charged correctly |
| `AVC` | AVC event, no SAT match | Vehicle detected but either not charged or SAT record missing |
| `SAT` | SAT transaction, no AVC event | Toll charged but vehicle not detected by AVC |

`MATCH` rows with axle-count errors are still valid matches (`match_valido=True`). Use `nota_ejes` and the `axleErr` summary counter to separate detection/class pairing from axle-count quality.

`matchRate` in API summaries is an AVC detection-rate metric: `(total - satOnly) / total * 100`. It is not the percentage of perfect matches.

---

## Reasoning About Mismatches

### AVC-only (tipo = AVC)

Check `motivo_no_match`:

| motivo | Cause | Next Step |
|--------|-------|-----------|
| `SAT_no_detecto` | No SAT events within the time window | Check timestamps — clock skew? Widen window? |
| `clase_distinta` | SAT candidates in window but wrong class | Check `candidatos_sat` field for class details |
| `error_conteo_avc` | AVC counted 0 axles | Sensor issue; check vehicle_type for the period |
| `moto_detectada_solo_por_avc` | Motorcycle in AVC, no SAT counterpart | Normal for many plazas — motorcycles may not be charged |

```bash
# Count AVC-only rows by motive
curl -s "http://localhost:8080/api/lanes/Axle-Lane1/events?query_date=2026-05-19" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
data = json.load(sys.stdin)
from collections import Counter
motivos = Counter(e.get('motivo_no_match','') for e in data.get('events',[]) if e.get('tipo')=='AVC')
print(dict(motivos.most_common()))
"
```

### SAT-only (tipo = SAT)

Check `motivo_no_match`:

| motivo | Cause | Next Step |
|--------|-------|-----------|
| `AVC_no_detecto` | No AVC event in window | Camera/sensor gap? AVC offline during that period? |
| `moto_SAT_sin_AVC` | Motorcycle SAT charge, no AVC detection | Normal if AVC doesn't track motorcycles on this lane |
| `SAT_clase_indefinida` | SAT class = 0 and no tab class | SAT data quality issue |

### Missing Transactions (Not In Either System)

If a vehicle appears in physical logs but not in either AVC or SAT:
- Check if the AVC sync covers the full day (not just part of it)
- Check if all SAT batch files were merged: `GET /api/sat/directory`
- Check the SAT merged file transaction count vs expected daily volume

---

## Comparing AVC vs SAT Counts

```python
# Run from project directory
.venv/bin/python -c "
import sqlite3, json
from datetime import date

# AVC events count
conn = sqlite3.connect('app_settings.db')
avc_total = conn.execute(
    \"SELECT COUNT(*) FROM avc_local_events WHERE event_date='2026-05-19'\").fetchone()[0]
avc_lanes = dict(conn.execute(
    \"SELECT lane_name, COUNT(*) FROM avc_local_events WHERE event_date='2026-05-19' GROUP BY lane_name\").fetchall())

# SAT transactions count
with open('/root/sat_merged/SAT-TEXCOCO-20260519-MERGED.json') as f:
    d = json.load(f)
txns = d.get('transactions', [])
from collections import Counter
sat_lanes = Counter(str(t.get('voie','')) for t in txns)

print(f'AVC total: {avc_total}')
print(f'AVC by lane: {avc_lanes}')
print(f'SAT total: {len(txns)}')
print(f'SAT by voie: {dict(sat_lanes.most_common())}')
"
```

---

## Reconciliation with Different Time Windows

The default window is asymmetric: 120 seconds before AVC + 30 seconds after AVC. The `window_s` request field controls only the "before AVC" side; the 30-second after-AVC tolerance is fixed in `engine.reconcile()`.

Matching priority:
1. Candidate SAT events are collected in `[AVC_ts - window_s, AVC_ts + 30s]`.
2. SAT before AVC (`delta <= 0`) is preferred over SAT after AVC.
3. Within that direction priority, the closest absolute delta wins.
4. The chosen candidate must be class-compatible.

Class compatibility is exact in the current code: mapped AVC class must equal SAT `id_classe` or `tab_id_classe`. Category-level compatibility is not currently accepted.

When investigating timing issues:

```bash
# Try windows of 60s, 120s, 180s, 300s and compare match rates
for WIN in 60 120 180 300; do
  RESULT=$(curl -s -X POST http://localhost:8080/api/reconcile \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"avc_lane\":\"Axle-Lane1\",\"sat_lane\":\"1\",\"date\":\"2026-05-19\",\"window_s\":$WIN}")
  RATE=$(echo "$RESULT" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('summary',{}).get('matchRate','err'))")
  echo "window_s=$WIN → matchRate=$RATE%"
done
```

**Note:** Increasing the window beyond business requirements may incorrectly pair events from different vehicles. Get business approval before adjusting the default.

---

## Duplicate Transaction Detection

The reconciliation engine does not explicitly detect duplicate SAT transactions. To check for duplicates manually:

```python
.venv/bin/python -c "
import json
from collections import Counter

with open('/root/sat_merged/SAT-TEXCOCO-20260519-MERGED.json') as f:
    d = json.load(f)
txns = d.get('transactions', [])

# Check for duplicate transaction numbers
nums = [t.get('numero_transaction') for t in txns if t.get('numero_transaction')]
dupes = {n: c for n, c in Counter(nums).items() if c > 1}
print(f'Duplicate transaction numbers: {len(dupes)}')
if dupes:
    for n, c in list(dupes.items())[:5]:
        print(f'  {n}: {c} times')
"
```

---

## Time-Window Differences and Clock Skew

If `candidatos_sat` shows SAT candidates with deltas consistently far from 0 (e.g., consistently +300s or -300s), the clocks on AVC and SAT systems are misaligned.

Analysis:
```bash
curl -s "http://localhost:8080/api/lanes/Axle-Lane1/events?query_date=2026-05-19" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json, statistics
data = json.load(sys.stdin)
deltas = [float(e.get('delta_segundos',0)) for e in data.get('events',[]) if e.get('tipo')=='MATCH']
if deltas:
    print(f'Delta stats (MATCH rows):')
    print(f'  count: {len(deltas)}')
    print(f'  mean: {statistics.mean(deltas):.1f}s')
    print(f'  median: {statistics.median(deltas):.1f}s')
    print(f'  stdev: {statistics.stdev(deltas):.1f}s')
    print(f'  min: {min(deltas):.0f}s, max: {max(deltas):.0f}s')
"
```

If median delta is, e.g., consistently -90s (SAT 90s before AVC), the system is working correctly within expected parameters.  
If median delta is +5s (SAT after AVC), the 30s tolerance window should accommodate this, but a large positive median indicates unusual timing.
