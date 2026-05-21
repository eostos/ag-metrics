# Skill: Database Audit Review

## When to Use This Skill

Use this skill when:
- Auditing what data was stored for a specific date, lane, or transaction
- Verifying the integrity of the reconciliation cache
- Investigating why a specific event appears (or doesn't appear) in results
- Reviewing user activity or access patterns
- Checking AVC source configuration (without exposing credentials)
- Cleaning up stale cache entries after a data correction

---

## Query Safety Rules

1. **Never run `DELETE`, `UPDATE`, or `DROP` on production data without explicit user approval.**
2. **Always use `SELECT` first** to preview what will be affected before any modification.
3. **Never print or log the `config` column of `avc_sources`** — it contains credentials.
4. **Back up `app_settings.db` before any schema changes**: `cp app_settings.db app_settings.db.bak.$(date +%Y%m%d_%H%M%S)`
5. **Use `LIMIT`** on all exploratory queries to avoid loading large result sets.
6. **Do not print full session tokens** unless explicitly needed; they are bearer credentials.

---

## Read-Only Audit Queries

### Local AVC Events

```sql
-- Events by date and lane (summary)
SELECT event_date, lane_name, COUNT(*) as events,
       MIN(event_timestamp) as first_event, MAX(event_timestamp) as last_event
FROM avc_local_events
GROUP BY event_date, lane_name
ORDER BY event_date DESC, lane_name;

-- Events for a specific date and lane
SELECT event_id, lane_name, vehicle_type, axle_count, event_timestamp, vehicle_image_url
FROM avc_local_events
WHERE event_date = '2026-05-19' AND lane_name = 'Axle-Lane1'
ORDER BY event_timestamp DESC LIMIT 20;

-- Vehicle type distribution
SELECT vehicle_type, COUNT(*) as count
FROM avc_local_events
WHERE event_date = '2026-05-19'
GROUP BY vehicle_type ORDER BY count DESC;

-- Events with no axle count (will cause class 0 = unmatchable)
SELECT COUNT(*) FROM avc_local_events
WHERE event_date = '2026-05-19' AND axle_count IS NULL;

-- Events with no timestamp (will be skipped in reconciliation)
SELECT COUNT(*) FROM avc_local_events
WHERE event_date = '2026-05-19' AND event_timestamp IS NULL;
```

### Reconciliation Cache

```sql
-- All cache entries
SELECT cache_key, source_id, summary_json, created_at
FROM recon_cache
ORDER BY created_at DESC LIMIT 20;

-- Cache entries for a specific date
-- Current cache_key format: source_id::lane_name::YYYY-MM-DD
SELECT cache_key, source_id, summary_json, created_at
FROM recon_cache WHERE cache_key LIKE '%::2026-05-19';

-- Parse summary stats
SELECT
    cache_key,
    source_id,
    json_extract(summary_json, '$.total') as total,
    json_extract(summary_json, '$.matched') as matched,
    json_extract(summary_json, '$.avcOnly') as avc_only,
    json_extract(summary_json, '$.satOnly') as sat_only,
    json_extract(summary_json, '$.axleErr') as axle_err,
    json_extract(summary_json, '$.matchRate') as match_rate,
    created_at
FROM recon_cache
ORDER BY created_at DESC LIMIT 20;
```

`matchRate` in `summary_json` is the AVC detection rate: `(total - satOnly) / total * 100`. It is not the perfect-match percentage.

### AVC Sources (Without Credentials)

```sql
-- Safe source list (no config column)
SELECT id, name, type, enabled, last_sync, created_at FROM avc_sources;
```

### Users and Sessions

```sql
-- User list
SELECT id, name, email, role, status, last_login FROM auditec_users;

-- Active sessions
SELECT substr(s.token, 1, 8) || '...' as token_prefix, u.email, u.role, s.expires_at
FROM auditec_sessions s JOIN auditec_users u ON u.id = s.user_id
WHERE s.expires_at > datetime('now')
ORDER BY s.expires_at DESC;

-- Expired sessions count
SELECT COUNT(*) as expired FROM auditec_sessions WHERE expires_at <= datetime('now');
```

### App Settings

```sql
-- All settings (no credentials in most keys, but ssh_password and postgres_password are here)
SELECT setting_key, updated_at FROM app_settings;

-- Safe settings (non-credential keys only)
SELECT setting_key, setting_value, updated_at FROM app_settings
WHERE setting_key NOT IN ('ssh_password', 'postgres_password', 'api_password');
```

---

## Approved Maintenance Queries

These queries are safe to run with user approval:

```sql
-- Clear expired sessions (safe cleanup)
DELETE FROM auditec_sessions WHERE expires_at <= datetime('now');

-- Invalidate reconciliation cache for a specific date (forces re-reconciliation)
-- Run: SELECT first to confirm scope
SELECT cache_key FROM recon_cache WHERE cache_key LIKE '%::2026-05-19';
-- Then with approval:
DELETE FROM recon_cache WHERE cache_key LIKE '%::2026-05-19';

-- Remove AVC events for a specific source/date if data was re-imported
-- ALWAYS confirm scope first:
SELECT COUNT(*) FROM avc_local_events WHERE source_id=1 AND event_date='2026-05-19';
-- Then with explicit approval:
DELETE FROM avc_local_events WHERE source_id=1 AND event_date='2026-05-19';
```

---

## Schema Reference

```sql
-- Inspect full schema
.schema

-- Table sizes
SELECT
    'auditec_users'    as t, COUNT(*) as rows FROM auditec_users UNION ALL
SELECT 'auditec_sessions', COUNT(*) FROM auditec_sessions UNION ALL
SELECT 'avc_sources',      COUNT(*) FROM avc_sources UNION ALL
SELECT 'avc_local_events', COUNT(*) FROM avc_local_events UNION ALL
SELECT 'recon_cache',      COUNT(*) FROM recon_cache UNION ALL
SELECT 'app_settings',     COUNT(*) FROM app_settings;
```

---

## External PostgreSQL Queries (alice_guardian)

Only query the external database when specifically requested and with credentials confirmed available. Use `engine.py`'s `db_connection()` context manager — never construct raw psycopg2 connections outside of it.

```python
from engine import load_saved_settings, db_connection

settings = load_saved_settings()
with db_connection(settings) as conn:
    with conn.cursor() as cur:
        cur.execute('SELECT COUNT(*) FROM public."AVCs" WHERE "createdAt"::date = %s', ('2026-05-19',))
        print(cur.fetchone())
```
