# Troubleshooting Guide — AG-metrics AVC/SAT

## Quick Status Checks

```bash
./run.sh status              # Is the server running?
./run.sh logs                # What is the server logging?
sqlite3 app_settings.db ".tables"   # Is the database accessible?
ls ~/sat_merged/             # Are SAT merged files present?
```

---

## Server Not Starting

**Symptom:** `./run.sh prod` reports "ERROR: el servidor no arrancó"

1. Check port conflict: `ss -tlnp | grep 8080`
2. Check `app_settings.db` is writable: `ls -la app_settings.db`
3. Check Python version: `.venv/bin/python --version` (needs 3.8+)
4. Check dependency install errors: `.venv/bin/pip install -r requirements.txt`
5. Start in debug mode to see full traceback: `./run.sh debug`
6. Check log: `cat /tmp/auditec_api.log`

---

## API Not Responding

**Symptom:** `curl http://localhost:8080/` returns connection refused

1. `./run.sh status` — is it running?
2. If PID exists but process is dead: `rm .auditec.pid && ./run.sh prod`
3. Check uvicorn is listening: `ss -tlnp | grep 8080`
4. Try: `curl -v http://127.0.0.1:8080/api/docs`

---

## Login Fails

**Symptom:** Login returns 401 or "Credenciales incorrectas"

1. Default credentials: `admin@auditec.mx` / `admin123`
2. Check users table: `sqlite3 app_settings.db "SELECT email, role, status FROM auditec_users;"`
3. If table is empty, restart server to re-seed: the `_ensure_schema()` function seeds admin on first run.
4. Verify password hash: `python3 -c "import hashlib; print(hashlib.sha256(b'admin123').hexdigest())"`
5. Compare with DB: `sqlite3 app_settings.db "SELECT password_hash FROM auditec_users WHERE email='admin@auditec.mx';"`

---

## No AVC Events in Dashboard

**Symptom:** Dashboard shows "Sin datos para YYYY-MM-DD"

1. Check AVC sources: `sqlite3 app_settings.db "SELECT id, name, type, enabled, last_sync FROM avc_sources;"`
2. If no sources: go to Config → Fuentes AVC and add one.
3. If source exists but `last_sync` is null: sync has never run. Click "Sincronizar" in Dashboard.
4. If sync fails: click "Probar" on the source in Config → Fuentes AVC.
   - Check the error message (SSH timeout, PG connection refused, API 401, etc.)
5. Check local events after sync: `sqlite3 app_settings.db "SELECT event_date, lane_name, COUNT(*) FROM avc_local_events GROUP BY event_date, lane_name ORDER BY event_date DESC LIMIT 20;"`
6. If source type=database: verify SSH access and PostgreSQL credentials.
7. If source type=api: verify API URL, key, and that the API returns data for today.

---

## No SAT Data / SAT Pending Shows 0

**Symptom:** LiveBar shows SAT=0 or SAT pending files don't appear

1. Check SFTP upload directory: `ls /home/sftpuser/uploads/ 2>/dev/null | head -20`
2. Check merged directory: `ls ~/sat_merged/`
3. If files exist in uploads but not merged: manually trigger merge via Config → SAT → "Fusionar"
4. If `sat_watcher.py` is supposed to run: check `ps aux | grep sat_watcher`
5. Check SAT file format: `cat /home/sftpuser/uploads/SAT-TEXCOCO-$(date +%Y%m%d)*.json | head -20`
   - Verify it has a `transactions` array and a `batchuid` field.
6. Check merged file: `cat ~/sat_merged/SAT-TEXCOCO-$(date +%Y%m%d)-MERGED.json | python3 -m json.tool | head -20`

---

## Reconciliation Fails or Returns Empty

**Symptom:** `POST /api/reconcile` returns `{"error": "..."}` or empty result

1. Verify AVC data exists for the lane/date:
   ```bash
   sqlite3 app_settings.db "SELECT COUNT(*) FROM avc_local_events WHERE event_date='2026-05-19' AND lane_name='Axle-Lane1';"
   ```
2. Verify SAT merged file exists: `ls ~/sat_merged/SAT-TEXCOCO-20260519-MERGED.json`
3. Verify lane mapping: `sqlite3 app_settings.db "SELECT setting_value FROM app_settings WHERE setting_key='lane_mapping';"`
   - If empty or wrong mapping: go to Config → Sistema → Mapeo de Carriles.
4. Check SAT voie list: `curl -s "http://localhost:8080/api/sat/lanes?day=20260519" -H "Authorization: Bearer $TOKEN"`
5. Run reconciliation manually with explicit `sat_lane`:
   ```bash
   curl -s -X POST http://localhost:8080/api/reconcile \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"avc_lane":"Axle-Lane1","sat_lane":"1","date":"2026-05-19","window_s":120}' \
     | python3 -m json.tool
   ```
6. If error mentions missing columns: the SAT file's column names don't match expected patterns. Check `_auto_cols_sat()` patterns.

---

## Stale Reconciliation Results

**Symptom:** Dashboard shows old stats that don't reflect new data after sync

1. The reconciliation cache is keyed by `{source_id}::{lane}::{date}`.
2. A new AVC sync automatically invalidates the cache for that date.
3. To force-clear the cache manually:
   ```bash
   sqlite3 app_settings.db "DELETE FROM recon_cache WHERE cache_key LIKE '%::2026-05-19';"
   ```
4. Then open the lane in the Dashboard to trigger fresh reconciliation.

---

## Incorrect Vehicle Class in Results

**Symptom:** `clase_avc_mapeada` doesn't match expected SAT class

1. Check the raw `vehicle_type` string from AVC: `sqlite3 app_settings.db "SELECT DISTINCT vehicle_type FROM avc_local_events LIMIT 20;"`
2. Test the mapping: `.venv/bin/python -c "from engine import map_avc_class; print(map_avc_class('YOUR_TYPE', 5))"`
3. If the AVC system uses a non-standard `vehicle_type` string: update `map_avc_class()` in `engine.py:474` to handle the new string.

---

## Axle Count Errors (nota_ejes = ERROR)

**Symptom:** Many rows show axle errors in Lane Detail → Error Ejes tab

1. Check AVC axle counts: `sqlite3 app_settings.db "SELECT axle_count, COUNT(*) FROM avc_local_events WHERE event_date='2026-05-19' GROUP BY axle_count;"`
2. Check if AVC sensor is calibrated (systemic 0-axle events suggest sensor failure).
3. Verify the SAT class for the mismatched vehicles — if SAT consistently assigns C5 but AVC sees 4 axles, one system may be misconfigured.
4. Look at the `SAT_EJES` table in `engine.py:72` to verify expected axle counts are correct for your class definitions.

---

## Dashboard/Reports Not Updating

**Symptom:** Dashboard shows stale data despite new events arriving

1. Check polling: the Dashboard polls `/api/status` every 30s. Open browser DevTools → Network to verify.
2. Check browser console for JavaScript errors.
3. Force-refresh: Ctrl+Shift+R (clears browser cache).
4. Clear Babel cache: the app auto-clears stale Babel cache on version change via `localStorage.agm_ver`.
5. If the Reports screen is empty: verify the selected date/lane has entries in `recon_cache`; Reports uses real reconciled cache data, not raw AVC/SAT rows.

---

## Authentication / Permission Errors

**Symptom:** 401 or 403 on API calls

- 401: session expired (24h TTL). Log out and log in again.
- 403 on config endpoints: user role is not `Admin`. Check `auditec_users.role`.
- Expired sessions: `sqlite3 app_settings.db "DELETE FROM auditec_sessions WHERE expires_at < datetime('now');"`

---

## Database Locked / Corruption

**Symptom:** `sqlite3.OperationalError: database is locked`

1. Check if another process holds the file: `lsof app_settings.db`
2. If a zombie uvicorn worker: `./run.sh stop && ./run.sh prod`
3. For corruption: restore from backup: `cp app_settings.db.bak.YYYYMMDD app_settings.db`

---

## SAT Watcher Not Processing Files

**Symptom:** Files accumulate in `/home/sftpuser/uploads/` but are not merged

1. Is the watcher service running? `systemctl status auditec-sat-watcher.service --no-pager`
2. Check watcher logs: `journalctl -u auditec-sat-watcher.service -n 100 --no-pager`
3. Verify the file naming pattern: must match `SAT-TEXCOCO-YYYYMMDD*.json`; the watcher scans today and yesterday.
4. Confirm merged files are appearing in `~/sat_merged/`, the same directory read by `api.py`.
5. If watcher died: `sudo systemctl restart auditec-sat-watcher.service`.
6. Alternative: use the Dashboard auto-merge (every 30s) or manual merge in Config → SAT, but do not rely on this for unattended overnight operation.
