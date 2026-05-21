# Docker Runbook — AG-metrics AVC/SAT

## Docker Not Found in Repository

No `Dockerfile`, `docker-compose.yml`, `.dockerignore`, or any Docker-related configuration was found in this repository.

AG-metrics is deployed directly on the host using the `run.sh` script and a Python virtual environment. See `docs/deployment-guide.md` for deployment instructions.

---

## If Docker Containerization Is Required in the Future

The following considerations apply based on the current application structure:

### What Would Need to Be Containerized

1. The FastAPI application (`api.py`, `engine.py`, `frontend/`) — straightforward.
2. `sat_watcher.py` — ideally a separate container or sidecar.
3. SQLite data file (`app_settings.db`) — must be mounted as a volume; do not bake into image.
4. SAT file directories (`/home/sftpuser/uploads/`, `~/sat_merged/`) — must be shared volumes.

### Known Constraints

- The SSH tunnel uses `sshtunnel` + `paramiko` (pure Python). No system `ssh` binary required.
- `psycopg2-binary` includes its own libpq; no system PostgreSQL client needed.
- Python 3.8+ required; `backports.zoneinfo` needed for 3.8.
- The `.env` file should be mounted as a secret, not baked into the image.
- The `app_settings.db` file must persist across container restarts (use a named volume).

### Path Considerations

`api.py` hardcodes:
- `MERGED_DIR = os.path.expanduser("~/sat_merged")` — becomes `/root/sat_merged` in a container; override with an environment variable if containerizing.
- `WATCH_DIR = "/home/sftpuser/uploads"` — must be a mounted volume.
