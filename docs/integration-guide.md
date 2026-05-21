# Integration Guide — AUDITEC AVC/SAT

## Overview

AUDITEC integrates with two external systems:
1. **Alice Guardian** (AVC source) — via PostgreSQL database or REST API
2. **SAT System** — via SFTP file delivery

No webhooks, message queues, or streaming protocols are used. All integrations are pull-based or file-based.

---

## Integration 1: Alice Guardian PostgreSQL (type=database)

### Connection Method

Direct PostgreSQL connection (local or via SSH tunnel).

Config parameters stored in `avc_sources.config`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `ssh_host` | `""` | SSH server hostname/IP. If empty, no tunnel is used. |
| `ssh_user` | `""` | SSH login username |
| `ssh_password` | `""` | SSH login password |
| `ssh_port` | `"22"` | SSH port |
| `postgres_host` | `"127.0.0.1"` | PostgreSQL host (as seen from SSH server) |
| `postgres_port` | `"5432"` | PostgreSQL port |
| `postgres_database` | `"alice_guardian"` | Database name |
| `postgres_user` | `"postgres"` | PostgreSQL username |
| `postgres_password` | `""` | PostgreSQL password |
| `media_root` | `"/opt/alice-media"` | Base path for vehicle images on SSH server |
| `timezone` | `"America/Mexico_City"` | Used to convert timestamps |

### Query Details

`fetch_avc_dataframe()` in `engine.py:366` executes:

```sql
SELECT
    a.id, a.vehicle_type, a.axle_count,
    a.vehicle_image_path, a.vehicle_image_url, a.lane_no,
    COALESCE(
        CASE WHEN BTRIM(a."timestamp") ~ '^\d{13}$' THEN to_timestamp(a."timestamp"::float/1000)
             WHEN BTRIM(a."timestamp") ~ '^\d{10}$' THEN to_timestamp(a."timestamp"::float)
             WHEN BTRIM(a."timestamp") ~ '^\d{4}-...' THEN a."timestamp"::timestamptz
             ELSE NULL END,
        a."createdAt"
    ) AS event_timestamp,
    timezone(%s, a."createdAt") AS created_at_filter_local,
    a."deviceId" AS device_id,
    d.name AS lane_name,
    CONCAT(a."deviceId", ' - ', d.name) AS device_with_lane,
    a."createdAt", a."updatedAt"
FROM public."AVCs" a
LEFT JOIN public."Devices" d ON d."deviceId" = a."deviceId"
WHERE timezone(%s, a."createdAt")::date = %s::date
  [AND d.name = %s]  -- optional lane filter
ORDER BY event_timestamp DESC, a.id DESC
```

**Note on timestamps:** The query handles three formats of `a.timestamp`: epoch milliseconds (13 digits), epoch seconds (10 digits), and ISO datetime strings. Falls back to `a."createdAt"` (DB insert time) when the sensor timestamp is null or malformed.

### Image Proxy

Vehicle images are stored on the SSH server's filesystem. AUDITEC proxies them via:
- `GET /api/image?ref=<path>` — reads from SSH server using SFTP
- Path resolution: `media_root + image_ref` (see `resolve_remote_media_path()` in `engine.py:339`)

---

## Integration 2: Alice Guardian REST API (type=api)

### Connection Method

HTTP GET request with configurable auth and field mapping.

Config parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `api_url` | `""` | Base URL, e.g. `https://alice-server:8080` |
| `auth_type` | `"bearer"` | `bearer` \| `api-key` \| `basic` |
| `api_key` | `""` | Token for bearer/api-key auth |
| `api_user` | `""` | Username for basic auth |
| `api_password` | `""` | Password for basic auth |
| `events_path` | `"/api/v1/events"` | Endpoint path |
| `date_param` | `"from"` | Query param name for start date |
| `date_end_param` | `"to"` | Query param name for end date |
| `lane_param` | `"lane"` | Query param name for lane filter |
| `verify_ssl` | `true` | SSL certificate verification |
| `events_key` | `""` | JSON key containing the events array (empty = auto-detect) |
| `field_id` | `"id"` | Response field for event ID |
| `field_lane` | `"lane_name"` | Response field for lane name |
| `field_type` | `"vehicle_type"` | Response field for vehicle type |
| `field_axles` | `"axle_count"` | Response field for axle count |
| `field_timestamp` | `"created_at"` | Response field for timestamp |
| `field_image_url` | `"vehicle_image_url"` | Response field for image URL |
| `field_image_path` | `"vehicle_image_path"` | Response field for image path |

### Request Format

```
GET {api_url}{events_path}?{date_param}=YYYY-MM-DD&{date_end_param}=YYYY-MM-DD[&{lane_param}=lane_name]
Authorization: Bearer {api_key}
```
(Auth header varies by `auth_type`.)

### Expected Response

Either a JSON array directly, or an object with an array at `events_key`:
```json
{
  "data": [
    { "id": "1234", "lane_name": "Lane1", "vehicle_type": "truck", "axle_count": 5, "created_at": "2026-05-19T08:14:28Z" }
  ]
}
```

---

## Integration 3: SAT System (SFTP File Delivery)

### Delivery Method

The SAT system deposits JSON batch files to a directory accessible via SFTP.

**Upload directory:** `/home/sftpuser/uploads/`  
**File naming pattern:** `SAT-TEXCOCO-YYYYMMDD-<batch-suffix>.json`

### Batch File Schema

```json
{
  "batchuid": "SAT-TEXCOCO-20260519-001",
  "sourcesystem": "SATTexcoco",
  "generatedat": "2026-05-19T08:30:00",
  "transactions": [
    {
      "date_transaction": "2026-05-19 08:14:28",
      "voie": "1",
      "id_classe": 5,
      "tab_id_classe": 5,
      "numero_transaction": "TXN-001234",
      "prix_total": "82.00"
    }
  ]
}
```

**Notes:**
- `voie` is the lane identifier in the SAT system (may be a number string like `"1"` or a string like `"VOIE1"`).
- `id_classe` and `tab_id_classe` are the dual classification fields (see classification guide).
- `prix_total` is the toll charge amount.
- The SAT files may contain Windows-style CRLF line endings embedded in JSON strings; the merge code sanitizes these before parsing.

### Column Auto-Detection

AUDITEC does not require exact column names. `_auto_cols_sat()` in `api.py:396` auto-detects columns using regex patterns:

| Internal Name | Regex Pattern |
|--------------|--------------|
| `date` | `^date_transaction$`, `date|time|hora|fecha` |
| `voie` | `^voie$`, `voie|carril|lane` |
| `cls` | `^id_classe$`, `id_class` |
| `tab` | `tab_id_classe`, `tab.*class` |
| `num` | `numero_transaction`, `numero|number|trans` |
| `prix` | `prix_total`, `price|precio|prix` |

---

## No Other Integrations Found

The following were **not found** in this repository:
- Webhooks (inbound or outbound)
- Message queues (Kafka, RabbitMQ, etc.)
- Email notifications
- SMS alerts
- External reporting systems (BI tools, data warehouses)
- ONVIF camera integrations (ONVIF URLs appear in `.claude/settings.local.json` permissions but not in application code)
