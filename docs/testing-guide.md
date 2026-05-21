# Testing Guide — AUDITEC AVC/SAT

## Automated Tests

**No formal automated test suite exists in this repository.** No `tests/` directory, no `pytest`, no `unittest` files, no linting configuration (`.flake8`, `pyproject.toml`, etc.) were found.

---

## Manual Smoke Tests

The following manual tests verify the core system is working correctly.

### Prerequisites

```bash
./run.sh debug  # start server in debug mode
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@auditec.mx","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "Token: $TOKEN"
```

---

### Test 1: Authentication

```bash
# Login
curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@auditec.mx","password":"admin123"}' | python3 -m json.tool

# Expect: {"token": "...", "user": {"role": "Admin", ...}}

# Invalid login
curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"wrong@test.com","password":"wrong"}' | python3 -m json.tool
# Expect: 401 error
```

---

### Test 2: Status Endpoint

```bash
curl -s "http://localhost:8080/api/status" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Expect: JSON with date, avc_events, sat_merged, sat_pending, sources, timezone
```

---

### Test 3: AVC Sources

```bash
# List sources
curl -s http://localhost:8080/api/sources \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Test a source connection (replace 1 with actual source ID)
curl -s -X POST http://localhost:8080/api/sources/1/test \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool
# Expect: {"ok": true, "records": N, "lanes": [...]}
```

---

### Test 4: SAT Directory

```bash
curl -s http://localhost:8080/api/sat/directory \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Expect: JSON with watch_dir, merged_dir, total_pending, days list
```

---

### Test 5: Lanes and Reconciliation

```bash
DATE=$(date +%Y-%m-%d)

# List lanes for today
curl -s "http://localhost:8080/api/lanes?query_date=$DATE" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# If lanes exist, run reconciliation (adjust lane and voie names)
curl -s -X POST http://localhost:8080/api/reconcile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"avc_lane\":\"Axle-Lane1\",\"sat_lane\":\"1\",\"date\":\"$DATE\",\"window_s\":120}" \
  | python3 -m json.tool
# Expect: {"result": [...], "summary": {...}, "cols": {...}}
```

---

### Test 6: Engine Isolation Test

```bash
.venv/bin/python -c "
from engine import (
    reconcile, map_avc_class, is_class_compatible,
    compare_ejes, SAT_DESC, SAT_EJES, cat_of, parse_date
)

# Class mapping
assert map_avc_class('truck', 5) == 5, 'truck 5 axles → C5'
assert map_avc_class('motorcycle', 2) == 15, 'moto → 15'
assert map_avc_class('light', 2) == 1, 'light → auto'
assert map_avc_class('bus', 3) == 13, 'bus 3 axles → B3'
print('class mapping: OK')

# Compatibility
assert is_class_compatible(5, 5, 0) == True, 'exact match'
assert is_class_compatible(5, 3, 0) == False, 'same category is not enough'
assert is_class_compatible(5, 0, 5) == True, 'tab class exact match'
assert is_class_compatible(5, 1, 0) == False, 'truck vs auto'
assert is_class_compatible(0, 5, 0) == False, 'avc_cls=0 always False'
print('class compatibility: OK')

# Axle comparison
n, t, s = compare_ejes(5, 5, 0)
assert s == 'OK', f'5 axles, C5 expected → {s}'
n, t, s = compare_ejes(4, 5, 0)
assert s.startswith('ERROR'), f'4 vs 5 expected → {s}'
print('axle comparison: OK')

# Parse date
ts = parse_date('2026-05-19 08:14:28')
assert str(ts.date()) == '2026-05-19', f'date parse failed: {ts}'
print('date parsing: OK')

print('All engine tests passed.')
"
```

---

## Linting (No Config Found)

No linting config exists. If needed:

```bash
# Install flake8
.venv/bin/pip install flake8

# Lint main files
.venv/bin/flake8 api.py engine.py sat_watcher.py --max-line-length=120
```

---

## Type Checking (No Config Found)

```bash
.venv/bin/pip install mypy
.venv/bin/mypy engine.py --ignore-missing-imports
```

---

## Load Testing (Not Configured)

No load testing setup exists in the repository. For basic load testing, tools like `locust` or `k6` could be used against `/api/status` and `/api/reconcile` endpoints.
