# Security Notes — AG-metrics AVC/SAT

## Credential Storage (Confirmed Issues)

### 1. Plaintext Credentials in SQLite

**Location:** `avc_sources.config` column, `app_settings.setting_value` rows  
**Risk:** SSH passwords and PostgreSQL passwords are stored as unencrypted JSON in the local SQLite file.

`app_settings.db` is **gitignored** — it will not be committed. However, anyone with filesystem access to the server can read these credentials from the SQLite file.

**Recommendation:** Encrypt the `config` column at rest, or use a secrets manager (HashiCorp Vault, AWS Secrets Manager) to inject credentials at runtime rather than storing them in the database.

### 2. SHA-256 Password Hashing

**Location:** `api.py:141`, `_hash()` function  
**Issue:** User passwords are hashed with plain SHA-256 (no salt, no iterations). SHA-256 is not a password-hashing function — it is vulnerable to rainbow table attacks and GPU brute-force.

**Recommendation:** Replace `hashlib.sha256` with `bcrypt` or `argon2-cffi`:
```python
# Example with bcrypt
import bcrypt
def _hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
def _check(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode(), hashed.encode())
```

### 3. Default Admin Credentials

**Location:** `api.py:121-125`  
**Issue:** Default credentials `admin@auditec.mx` / `admin123` are seeded on first run and visible in the README.

**Recommendation:** Change the admin password immediately after deployment. Ideally, force a password change on first login.

---

## Authentication and Session Management

### Session Tokens

- Tokens are generated with `secrets.token_urlsafe(32)` (cryptographically secure, 256-bit).
- Sessions expire after **24 hours**.
- Sessions are stored in SQLite — valid for the server lifetime; server restart does not invalidate sessions.
- No refresh token mechanism; users must re-login after expiry.
- **No rate limiting on `/api/auth/login`** — brute-force protection relies on the reverse proxy.

### Authorization

- Role check (`_require_admin`) is applied consistently to admin endpoints.
- Token validation checks the `auditec_sessions` table on every authenticated request — no JWT, no signing.

---

## Network Security

- **No TLS/HTTPS** in the application. The server listens on plain HTTP on port 8080.
- **Recommendation:** Always place a TLS-terminating reverse proxy (nginx, Caddy) in front of AG-metrics in production.
- The API is bound to `0.0.0.0` — accessible on all network interfaces. In `run.sh`, consider binding to `127.0.0.1` if behind a reverse proxy: `uvicorn api:app --host 127.0.0.1 --port 8080`.

---

## Input Validation

- SQL injection: Not applicable — all queries use parameterized statements (`psycopg2` with `%s` placeholders; SQLite with `?` placeholders).
- The timezone parameter in PostgreSQL queries is sanitized: `tz_pg = tz.strip().replace("'", "").replace(";", "")` (`engine.py:368`).
- SAT file JSON is parsed with `json.loads()` after CRLF sanitization — no eval or exec.
- No server-side file upload processing beyond SAT JSON merge.

---

## Sensitive Files and .gitignore

The `.gitignore` correctly excludes:
- `.venv/` — Python environment
- `__pycache__/`, `*.pyc` — bytecode
- `*.pid`, `.auditec.pid` — PID files
- `app_settings.db` — **credentials and session tokens**
- `.claude/` — Claude Code settings
- `*.jpeg`, `*.jpg`, `*.png` — media files

**Missing from .gitignore:**
- `.env` file — if created, it should be added: `echo ".env" >> .gitignore`
- Log files (currently written to `/tmp/` — not in repo directory, so safe)

---

## API Key and Token Exposure

- AVC source API keys (`api_key` in `avc_sources.config`) are only returned by `GET /api/sources/{sid}` which requires Admin role.
- The `GET /api/sources` (list) endpoint excludes the `config` field — it only returns `id, name, type, enabled, last_sync, created_at`.
- Avoid logging request bodies that may contain credentials.

---

## Recommendations Summary

| Issue | Severity | Action |
|-------|----------|--------|
| SHA-256 password hashing | High | Replace with bcrypt/argon2 |
| Default admin credentials | High | Change immediately after deployment |
| Plaintext credentials in SQLite | Medium | Use encrypted storage or secrets manager |
| No TLS on application | Medium | Add TLS termination via reverse proxy |
| No login rate limiting | Medium | Add rate limiting at reverse proxy |
| `.env` not in `.gitignore` | Low | Add `.env` to `.gitignore` |
| Sessions not invalidated on restart | Low | Acceptable for single-node deployments |

---

## Production Safety Rules

1. Never commit `app_settings.db`.
2. Never commit `.env` files.
3. Never log or print AVC source configs (`config` column).
4. Never expose `/api/sources/{id}` to non-Admin users.
5. Always use HTTPS in production.
6. Change the default admin password before going live.
7. Restrict the server's bind address to `127.0.0.1` when behind a reverse proxy.
