# Deployment Guide — AG-metrics AVC/SAT

## Prerequisites

- Python 3.8 or higher (3.8+ required for `backports.zoneinfo`; 3.9+ does not need the backport)
- `python3.8 -m venv` available (or `python3 -m venv` if 3.8+ is the default)
- Network access to: the AVC PostgreSQL server (or Alice Guardian API), the SFTP upload directory
- SFTP user `sftpuser` with upload directory at `/home/sftpuser/uploads/` (for SAT file reception)
- Port 8080 available (or reconfigure in `run.sh`)

---

## Deployment Steps

### 1. Clone / Copy the Repository

```bash
cd /opt  # or your preferred location
git clone <repo-url> auditec_avc_sat_py38
cd auditec_avc_sat_py38
```

### 2. (Optional) Create a `.env` File

```bash
cp .env.example .env  # no example file exists — create manually
nano .env
```

Add environment variables for the PostgreSQL/SSH defaults (see `docs/configuration-guide.md`). This step is optional — config can be entered through the Admin UI.

### 3. Install Production Services

```bash
sudo scripts/install_systemd_services.sh
```

This:
- Creates `.venv/` if it doesn't exist.
- Installs dependencies from `requirements.txt`.
- Installs `auditec.service` for the FastAPI backend.
- Installs `auditec-sat-watcher.service` for unattended SAT merge processing.
- Enables both services on boot and starts them immediately.

The backend service uses the same production parameters as `run.sh prod`: port 8080 and 2 Uvicorn workers.

### 4. Verify

```bash
systemctl status auditec.service --no-pager
systemctl status auditec-sat-watcher.service --no-pager
curl -s http://localhost:8080/ | head -5
journalctl -u auditec.service -n 100 --no-pager
journalctl -u auditec-sat-watcher.service -n 100 --no-pager
```

### 5. First-Run Configuration

Follow the checklist in `docs/configuration-guide.md` (change admin password, configure AVC source, set timezone and lane mapping).

---

## SAT Watcher

`sat_watcher.py` monitors `/home/sftpuser/uploads/` for new SAT JSON files and merges them automatically into `~/sat_merged/`, the same directory read by `api.py`.

The production installer starts it as `auditec-sat-watcher.service`:

```bash
systemctl status auditec-sat-watcher.service --no-pager
journalctl -u auditec-sat-watcher.service -f
```

The watcher scans both today and yesterday every 60 seconds. This handles late-arriving files near midnight and avoids relying on an open Dashboard session.

For manual foreground debugging:

```bash
.venv/bin/python sat_watcher.py
```

---

## Production Server Management

```bash
./run.sh prod      # start in background (2 workers)
./run.sh stop      # stop background server
./run.sh status    # check if running and show PID
./run.sh logs      # tail /tmp/auditec_api.log
./run.sh debug     # start in foreground with auto-reload (development only)
```

For installed production services, prefer:

```bash
systemctl restart auditec.service
systemctl restart auditec-sat-watcher.service
systemctl status auditec.service --no-pager
systemctl status auditec-sat-watcher.service --no-pager
```

---

## Environment Prerequisites

| Requirement | Notes |
|-------------|-------|
| Python 3.8+ | System or pyenv |
| pip | Comes with Python |
| venv | `python3.8 -m venv` must work |
| libpq (psycopg2) | `psycopg2-binary` handles this |
| OpenSSH (paramiko) | paramiko handles SSH; no system ssh required |
| SFTP directory | `/home/sftpuser/uploads/` — writable by SAT system, readable by AG-metrics process |
| Merged output dir | `~/sat_merged/` — writable by AG-metrics process |

---

## Reverse Proxy (Recommended for Production)

AG-metrics does not handle TLS. Use nginx or Caddy in front:

**nginx example:**
```nginx
server {
    listen 443 ssl;
    server_name auditec.example.com;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 60s;
    }
}
```

---

## Safe Deployment Checklist

Before deploying an updated version:

- [ ] Back up `app_settings.db`: `cp app_settings.db app_settings.db.bak.$(date +%Y%m%d)`
- [ ] Review changes in `api.py` — check if `_ensure_schema()` has schema changes
- [ ] If `_ensure_schema()` changed: verify the `ALTER TABLE` migration guard is in place
- [ ] Stop the current server: `./run.sh stop`
- [ ] Pull/copy new code
- [ ] Reinstall dependencies if `requirements.txt` changed: `.venv/bin/pip install -r requirements.txt`
- [ ] Start in debug mode first to verify startup: `./run.sh debug`
- [ ] Confirm `/api/docs` is accessible
- [ ] Start production services: `sudo scripts/install_systemd_services.sh`
- [ ] Verify: `systemctl status auditec.service --no-pager`
- [ ] Verify: `systemctl status auditec-sat-watcher.service --no-pager`

---

## Rollback

```bash
systemctl stop auditec.service auditec-sat-watcher.service
cp app_settings.db.bak.YYYYMMDD app_settings.db
git checkout <previous-commit>
systemctl start auditec.service auditec-sat-watcher.service
```

---

## Unknown Deployment Steps

- No process supervisor (supervisord, pm2, etc.) configuration found.
- No CI/CD pipeline found.
- No Docker/Compose found.
- No SFTP server configuration (vsftpd, openssh-sftp) found in repository.
