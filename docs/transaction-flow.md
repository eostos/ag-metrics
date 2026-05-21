# Transaction Flow — AG-metrics AVC/SAT

## Overview

Transactions enter the system from two independent sources. Neither source has a concept of the other — reconciliation happens entirely within AG-metrics.

---

## AVC Transaction Flow

### Source: PostgreSQL (type=database)

```
Alice Guardian system
  ↓ writes vehicle crossing events
PostgreSQL: public."AVCs" table
  ↓ SSH tunnel (if remote)
engine.fetch_avc_dataframe()  [engine.py:366]
  ↓ normalizes timestamps, joins Devices table
pandas DataFrame (normalized schema)
  ↓ stored by _fetch_and_store()  [api.py:296]
SQLite: avc_local_events table
```

### Source: Alice Guardian REST API (type=api)

```
Alice Guardian REST API
  GET /api/v1/events?from=...&to=...&lane=...
  ↓ HTTP request with Bearer/API-Key/Basic auth
_fetch_from_api()  [api.py:191]
  ↓ field mapping (configurable)
pandas DataFrame (normalized schema)
  ↓ stored by _fetch_and_store()  [api.py:296]
SQLite: avc_local_events table
```

### Trigger Mechanisms

| Trigger | Description |
|---------|-------------|
| Manual sync | User clicks "Sincronizar" in Dashboard or Config → Fuentes AVC |
| Auto-sync | Dashboard polls `/api/status` every 30s; if `avc_events=0` and no local lanes, triggers silent background sync |
| Lane Detail open | If no local events exist for the lane/date, `/api/reconcile` attempts a sync before returning an error |

---

## SAT Transaction Flow

SAT transactions arrive as JSON batch files, not via API.

```
SAT System (external)
  ↓ deposits files via SFTP
/home/sftpuser/uploads/SAT-TEXCOCO-YYYYMMDD-HH*.json
  ↓ merge (one of two paths)
Path A: sat_watcher.py polls every 60s → automatic merge
Path B: Dashboard polls /api/status → if sat_pending > 0, calls POST /api/merge-sat
Path C: Manual "Fusionar" button in Config → SAT
  ↓
~/sat_merged/SAT-TEXCOCO-YYYYMMDD-MERGED.json
```

**Batch file structure** (each file dropped by SAT system):
```json
{
  "batchuid": "SAT-TEXCOCO-20260519-001",
  "sourcesystem": "SATTexcoco",
  "transactions": [
    { "date_transaction": "...", "voie": "1", "id_classe": 5, "tab_id_classe": 5, "numero_transaction": "...", "prix_total": "..." }
  ]
}
```

The merge process:
1. Reads all pending `SAT-TEXCOCO-YYYYMMDD*.json` files (excluding already-MERGED).
2. Checks `processed_batches` in the existing MERGED file to skip already-incorporated batches.
3. Appends new transactions to the MERGED file using atomic write (write to `.tmp`, then `os.replace`).
4. Deletes each source file after successful merge.

---

## Reconciliation Flow

Reconciliation is the core audit step — it joins AVC events to SAT transactions.

```
User opens lane in Dashboard (or LaneDetail auto-triggers)
  ↓
POST /api/reconcile  [api.py:886]
  → loads AVC events from avc_local_events (or syncs from source)
  → loads SAT transactions from ~/sat_merged/SAT-TEXCOCO-YYYYMMDD-MERGED.json
  → filters both to: lane + date
  → calls engine.reconcile()  [engine.py:605]
      ↓
      For each AVC event (sorted by timestamp):
        - map AVC vehicle_type + axle_count → SAT class number (map_avc_class)
        - binary search SAT events in time window [AVC_ts - 120s, AVC_ts + 30s]
        - find best candidate: SAT before AVC preferred, then closest in time
        - check class compatibility (is_class_compatible)
        - if match: compare axle counts (compare_ejes), mark MATCH
        - if no match: mark AVC row (no SAT)
      For remaining unmatched SAT events:
        - mark SAT row (no AVC)
  → result DataFrame sorted by event timestamp
  → cached in recon_cache  [api.py:964]
  → returned to frontend
```

---

## Validation Steps

During reconciliation, the following validations occur:

1. **Column detection**: `detect_col()` auto-detects required columns in both AVC and SAT DataFrames using regex patterns. If a required column is missing, the reconciliation returns an error.

2. **Timestamp parsing**: `parse_date()` handles multiple formats: ISO, epoch ms, epoch s, `DD/MM/YYYY HH:MM:SS`, etc.

3. **Lane filtering**: AVC events are filtered to `lane_name == avc_lane`; SAT transactions are filtered to `voie == sat_lane`.

4. **Class mapping**: AVC `vehicle_type` string + `axle_count` integer → SAT class integer (0–15).

5. **Class compatibility**: `is_class_compatible(avc_cls, sat_cls, tab_cls)` — exact match only; mapped AVC class must equal either SAT `id_classe` or `tab_id_classe`.

6. **Axle comparison**: `compare_ejes(avc_axles, sat_cls, tab_cls)` — compares AVC axle count to the expected count for the effective SAT class.

---

## Data Storage After Reconciliation

- Full result is serialized as JSON and stored in `recon_cache`.
- Cache key: `{source_id}::{lane_name}::{YYYY-MM-DD}`.
- Cache is invalidated when a new AVC sync occurs for the same date.
- Dashboard reads summary stats from cache without re-running reconciliation.
- Lane Detail reads full event list from cache.

---

## Real-time vs Batch Processing

| Aspect | Reality |
|--------|---------|
| AVC ingestion | On-demand (manual sync or auto-trigger) |
| SAT ingestion | Near-real-time via `sat_watcher.py` (60s polling) or Dashboard auto-merge (30s) |
| Reconciliation | On-demand per lane/date; cached after first run |
| Dashboard refresh | 30-second polling via `/api/status` |
| No streaming | Neither AVC nor SAT data is processed as a live stream |
