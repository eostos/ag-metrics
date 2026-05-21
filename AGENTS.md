# AGENTS.md — AI Coding Agent Instructions

This file provides operational rules for AI coding agents (Codex, Claude Code, etc.) working in this repository.

---

## Safe Working Rules

1. **Never modify `engine.py`** without understanding the full reconciliation algorithm. Any change to matching logic, class mapping, or axle comparison functions affects all audit results.
2. **Never modify `api.py` schema creation** (`_ensure_schema`) without verifying backward compatibility with existing `app_settings.db`.
3. **Never commit `app_settings.db`** — it contains production credentials in `avc_sources.config` and is already gitignored.
4. **Never print or log credentials** — the `avc_sources` table stores SSH passwords and PostgreSQL passwords as JSON in the `config` column.
5. **Never run destructive SQL** against SQLite without explicit user approval (`DELETE FROM`, `DROP TABLE`).
6. **Never modify production configuration without a backup** — back up `app_settings.db` before schema or data migrations.
7. **Never change the `run.sh` prod command** without confirming port and worker count with the operator.

---

## How to Inspect the Project

```bash
# Start development server (auto-reload)
./run.sh debug

# Check server status
./run.sh status

# Tail production logs
./run.sh logs

# Check Python environment
.venv/bin/python --version
.venv/bin/pip list

# Inspect SQLite database schema
sqlite3 app_settings.db ".schema"

# Check local AVC events
sqlite3 app_settings.db "SELECT COUNT(*), event_date, lane_name FROM avc_local_events GROUP BY event_date, lane_name ORDER BY event_date DESC LIMIT 20;"

# Check AVC sources
sqlite3 app_settings.db "SELECT id, name, type, enabled, last_sync FROM avc_sources;"

# Check reconciliation cache
sqlite3 app_settings.db "SELECT cache_key, created_at FROM recon_cache ORDER BY created_at DESC LIMIT 10;"

# Check SAT merged files
ls -lh ~/sat_merged/

# Check SAT upload directory
ls /home/sftpuser/uploads/ 2>/dev/null || echo "Upload directory not accessible"
```

---

## Debugging Order

When investigating a problem, follow this order:

1. **Server running?** — `./run.sh status`
2. **Server logs?** — `./run.sh logs` or `tail -f /tmp/auditec_api.log`
3. **API responding?** — `curl -s http://localhost:8080/api/docs`
4. **AVC data present?** — check `avc_local_events` in SQLite
5. **SAT data present?** — check `~/sat_merged/` for MERGED files
6. **SAT files pending?** — check `/home/sftpuser/uploads/` for unmerged files
7. **Reconciliation cache stale?** — delete `recon_cache` rows for the affected date
8. **Lane mapping correct?** — check `app_settings` table key `lane_mapping`
9. **AVC source configured?** — check `avc_sources` table; verify `enabled=1`
10. **SSH tunnel working?** — try `POST /api/sources/{id}/test`

---

## Test Commands

No formal automated test suite exists in this repository.

Manual smoke tests:
```bash
# 1. Start debug server
./run.sh debug

# 2. Login
curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@auditec.mx","password":"admin123"}' | python3 -m json.tool

# 3. Check status (use token from login response)
curl -s http://localhost:8080/api/status \
  -H "Authorization: Bearer <TOKEN>" | python3 -m json.tool

# 4. List lanes
curl -s "http://localhost:8080/api/lanes?query_date=2026-05-19" \
  -H "Authorization: Bearer <TOKEN>" | python3 -m json.tool

# 5. Test reconciliation engine in isolation
.venv/bin/python -c "
from engine import reconcile, SAT_DESC, SAT_EJES, map_avc_class
print('engine.py imports OK')
print('SAT classes:', list(SAT_DESC.values())[:5])
print('map_avc_class(\"truck\", 5):', map_avc_class('truck', 5))
"
```

---

## Deployment Precautions

- **Always use `./run.sh prod`** for production — it uses nohup, 2 workers, logs to `/tmp/auditec_api.log`.
- **Check port 8080** is not in use before starting: `ss -tlnp | grep 8080`
- **Change default admin password** immediately on a new deployment.
- **Back up `app_settings.db`** before any schema change or upgrade.
- **`sat_watcher.py` must be started separately** if real-time SAT file monitoring is needed; the main `run.sh` does not start it.
- **No HTTPS** is configured in the application — use a reverse proxy (nginx/caddy) for TLS in production.
- **Python 3.8 minimum** — `backports.zoneinfo` is required for Python < 3.9.

---

## Code Style and Change Policy

- Python files follow implicit PEP 8 conventions; no linter config file exists.
- Frontend JSX uses inline styles (no CSS modules, no Tailwind). Style objects are defined at the bottom of each component file.
- Do not introduce new dependencies without updating `requirements.txt`.
- Do not add build steps or bundlers to the frontend — the no-build approach (Babel standalone) is intentional for simplicity.
- Do not rename the `reconcile()` function in `engine.py` — it is called directly by `api.py`.
- Do not change column names in the reconciliation result DataFrame — the frontend renders specific field names (`tipo`, `match_valido`, `nota_ejes`, `delta_segundos`, `id_classe`, `tab_id_classe`, etc.).
- Add comments only when the business reason is non-obvious; avoid paraphrasing code in comments.
