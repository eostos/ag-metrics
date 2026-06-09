# PROJECT_CONTEXT.md — AG-metrics AVC/SAT

## What This Project Does

AG-metrics is a **toll transaction auditing and reconciliation platform** developed by AG-metrics for the Ebenezer / Alice Guardian ecosystem. It compares two independent sources of vehicle-crossing data — the **AVC system** (Automatic Vehicle Classification) and the **SAT system** (Sistema de Administración de Tráfico) — to detect discrepancies, count mismatches, and verify vehicle classification consistency at toll plazas.

The system does **not** process live video, RTSP streams, or run inference models. All data arrives as structured records: AVC events from a PostgreSQL database or a REST API, SAT transactions from JSON files delivered via SFTP.

---

## Business Purpose

Toll operators need to verify that:
1. Every vehicle detected by the AVC system corresponds to a SAT transaction (and vice versa).
2. The vehicle class assigned by AVC matches the class registered in SAT.
3. The axle count reported by AVC is consistent with the expected axle count for the SAT class.
4. Any unmatched events (AVC-only or SAT-only) are flagged for manual review.

This reconciliation process produces an audit trail per lane, per date, with detailed per-event diagnostics.

---

## Technical Stack (Confirmed from Repository)

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.8+, FastAPI, Uvicorn (2 workers in prod) |
| Reconciliation engine | `engine.py` — pure Python + pandas |
| SAT file watcher | `sat_watcher.py` — polling daemon (60s interval) |
| Alternative UI | `app.py` — Streamlit (legacy/alternative, not the primary interface) |
| Local database | SQLite (`app_settings.db`) |
| External AVC DB | PostgreSQL (`alice_guardian` schema) via SSH tunnel (sshtunnel + paramiko) |
| External AVC API | Alice Guardian REST API (optional integration type) |
| Frontend | React 18 + Chart.js, served by FastAPI as static files — **no build step**, uses Babel standalone in the browser |
| Entry point | `api.py` -> FastAPI app -> serves `frontend/AUDITEC.html` |
| Port | 8080 |

---

## Main Workflows

### 1. AVC Data Ingestion
- Admin configures an AVC source (type: `database` or `api`) in Config → Fuentes AVC.
- On sync, the backend fetches events for the selected date and stores them locally in `avc_local_events`.
- Dashboard auto-syncs silently when no local data is found for today.

### 2. SAT Data Ingestion
- SAT system drops JSON batch files to `/home/sftpuser/uploads/` via SFTP.
- Files follow the pattern `SAT-TEXCOCO-YYYYMMDD*.json`.
- `sat_watcher.py` (runs as a separate process) merges these into a daily `SAT-TEXCOCO-YYYYMMDD-MERGED.json` in `~/sat_merged/`.
- The Dashboard also auto-merges pending SAT files via the `/api/merge-sat` endpoint every 30 seconds.

### 3. Reconciliation
- User opens a lane card in the Dashboard or navigates to Lane Detail.
- The backend runs `engine.reconcile()` matching AVC events to SAT transactions within an asymmetric configurable time window: `window_s` seconds before the AVC event, plus a fixed 30 seconds after the AVC event for clock tolerance. Default `window_s` is 120.
- Candidate ordering prefers SAT transactions before the AVC timestamp, then closest absolute time delta.
- Class compatibility is exact: the AVC-mapped class must equal either SAT `id_classe` or `tab_id_classe`; category-level compatibility is not currently accepted.
- Matched rows with axle-count errors still have `match_valido=True`; the axle issue is reported in `nota_ejes` and counted in `axleErr`.
- Results are cached in `recon_cache` with key format `{source_id}::{lane_name}::{YYYY-MM-DD}` for fast re-display.

### 4. Audit Result Review
- Lane Detail shows all events per lane filtered by: All / Matches / AVC-only / SAT-only / Axle Errors.
- Evidence panel shows AVC vehicle image (proxied via SSH from remote media path).
- Reports screen uses `/api/reports/summary` for real data from `recon_cache`, with global KPIs, discrepancy motive breakdown, worst lane/day rows, and Excel export.
- The active navigation now separates operational modules: Reports, Alarms, Notifications, and Settings. The legacy technical configuration remains available as `Settings -> System Configuration`.
- SMTP configuration is global and lives under `Settings -> Email / SMTP Configuration`. Do not duplicate SMTP forms inside Reports or Alarms.
- Automated report sends run from the backend scheduler and are guarded by a lock to avoid duplicate sends with multiple workers.

---

## Current UI/Configuration State

The frontend remains a no-build React app served from `frontend/AUDITEC.html`. New operational pages are implemented in `frontend/components/Operations.jsx`, loaded by `AUDITEC.html`.

### Navigation

Current main navigation:

```text
Dashboard
Reports
  - Report List
  - Create Report
  - Report Settings
  - Report Templates
  - Report History
Alarms
  - Active Alarms
  - Alarm Rules
  - Create Alarm Rule
  - Alarm Settings
  - Alarm History
Notifications
  - Notification History
  - Contact Groups
Settings
  - Email / SMTP Configuration
  - System Configuration
```

`System Configuration` is the old technical config screen and still contains:

```text
Fuentes AVC
Integración SAT
Sistema
Usuarios y Permisos
```

The old `Report Email Settings` tab was intentionally removed from `System Configuration` to avoid duplicating SMTP configuration.

### SMTP / Email Rules

- The existing SMTP/email implementation is working and must not be replaced.
- Existing email routes are still the source of truth:
  - `GET /api/report-email/settings`
  - `POST /api/report-email/settings`
  - `POST /api/report-email/test`
  - `POST /api/report-email/send-now`
- `Settings -> Email / SMTP Configuration` uses the existing `/api/report-email/*` routes.
- Reports and Alarms must reuse `_send_report_email()` and `_report_email_settings()` in `api.py`; do not create a second mailer.
- Do not print SMTP passwords or source credentials.

### Reports Module

Reports Phase 1 is UI/configuration-first:

- Report configurations are stored as JSON in `app_settings` under `report_configs`.
- Report-level settings are stored under `report_settings`.
- Report templates are stored under `report_templates`.
- Report history is stored under `report_history`.
- A default `Standard PDF` template is always returned by `GET /api/report-templates`, even if stored templates are empty or incomplete.
- `Create Report` pulls real system data:
  - Plaza from `GET /api/config` (`plaza_name`)
  - Lanes from `GET /api/avc/lanes`
  - Contact groups from `GET /api/contact-groups`
  - PDF templates from `GET /api/report-templates`
- `Create Report` includes a visual report builder preview before the setup fields:
  - KPI cards
  - Chart.js bar chart by lane/day
  - Report content summary
  - Preview table filtered by report type and selected lanes
- `Generate Preview PDF` opens a print-ready browser report with company logo (`/logo.jpeg`), the same KPI indicators, chart-style bars, scope summary, and detail table so the user can print/save as PDF without changing SMTP/email sending logic. The printable CSS uses `print-color-adjust: exact` to preserve colors/backgrounds in browser PDF export.
- `Send Test Report` in Create Report posts to `POST /api/report-email/send-preview`, which reuses the existing SMTP service but sends the designed report for the current builder selection instead of the older plain SMTP test PDF.
- Send now / test report paths reuse the existing report email route and PDF generation flow.

### Dashboard Economic Impact

- The Dashboard class comparison (`/api/class-summary`) now includes monetary impact by class and global totals.
- SAT money is authoritative and comes from the actual `sat_prix` values in reconciled SAT rows.
- AVC money is an estimate: AVC count by mapped class multiplied by configured AVC tariffs from `/api/config` key `avc_tariffs`.
- If a configured AVC tariff is missing for a class, `/api/class-summary` falls back to the most frequent SAT tariff for that class in the selected date cache and marks the class tariff source as `SAT frecuente`.
- `Settings -> System Configuration -> Integración SAT` contains the editable AVC tariff table and shows side-by-side:
  - `AVC configurada`
  - `SAT automática`
  - match status: Igual / Diferente / Sin comparar
- `GET /api/sat/tariffs` extracts observed SAT tariffs by class. With no `day` parameter it scans all historical merged files in `~/sat_merged/`, which is necessary for rare classes such as C7/C8 that may not appear on the current date. With `day=YYYYMMDD` or `YYYY-MM-DD` it uses that specific merged file.
- The UI has buttons to copy one SAT tariff into one AVC class (`Usar SAT`) or copy all observed SAT tariffs into AVC (`Copiar SAT a AVC`), but the operator must save the tariffs.

### Alarms Module

Alarms Phase 1 is basic configuration/history only:

- Alarm rules are stored as JSON in `app_settings` under `alarm_rules`.
- Active alarms are stored under `active_alarms`.
- Alarm settings are stored under `alarm_settings`.
- Alarm history is stored under `alarm_history`.
- Test alarm email uses existing SMTP/email logic through `_send_report_email()`.
- Do not add camera-related alarms, camera offline logic, camera health settings, or camera auto-resolve logic.

### Notifications Module

- Contact groups are stored under `contact_groups`.
- Notification history is stored under `notification_history`.
- Default contact groups returned by the API if none are saved:
  - Toll Audit Team
  - Operations Team
  - Management
  - IT Support
- Notification history should include report emails, alarm emails, and system test emails.

### Language Preference

- The platform has a basic English/Spanish UI language preference.
- The selector is in `Settings -> System Configuration -> Sistema`.
- It is saved in `/api/config` as `ui_language`.
- The frontend also mirrors the value to `localStorage` key `agm_ui_language`.
- `frontend/AUDITEC.html` defines `window.t()` and the base translation dictionary.
- Current translation coverage focuses on the main navigation, module headings, shared controls, and new Operations pages. It does not yet fully translate all older Dashboard/Lane Detail/technical config text.

---

## How AI Agents Should Reason About This Project

- The **central data flow** is: AVC events ↔ SAT transactions, joined by time window + class compatibility.
- The **reconciliation result** has four row types: `MATCH`, `AVC` (no SAT match), `SAT` (no AVC match), `SP_EXCLUDED` (SAT event excluded from reconciliation — `id_obs_mp==30 AND id_classe==0 AND id_paiement==0`).
- The `tipo` field on each result row is the primary audit status field.
- **Class mapping** is AVC-to-SAT: AVC uses `vehicle_type` strings + `axle_count` → mapped to a numeric SAT class (1–15, or 0 for invalid/unknown); SAT uses `id_classe` and `tab_id_classe`.
- **Class compatibility is exact**: `is_class_compatible()` returns true only if the AVC mapped class equals `id_classe` or `tab_id_classe`. Do not describe category matching unless the code changes.
- **Economic impact is not reconciliation logic**: it is reporting/management presentation. Do not change `engine.reconcile()` to calculate money; keep monetary estimates in `api.py`/Dashboard using `sat_prix` and `avc_tariffs`.
- **`matchRate` is a detection-rate metric**, calculated as `(total - satOnly) / total * 100`; it is not the percentage of perfect MATCH rows. `SP_EXCLUDED` rows are subtracted from `total` before this calculation.
- **Lane identity** is a string (device name from AVC). SAT uses a "voie" number. The lane mapping config links AVC lane names to SAT voie identifiers.
- **Source identity matters**: AVC events are stored per `source_id`, and reconciliation cache keys include `source_id`. When debugging stale or missing results, check whether the frontend/API request passed the expected `source_id`.
- The `engine.py` file is the most critical file — it contains all business logic.
- `api.py` is the second most critical — it orchestrates data access, caching, and exposes the REST API.
- The frontend is served entirely from `frontend/` with no build step; `.jsx` files are compiled by Babel in the browser.

---

## Do Not Assume

- Do **not** assume camera pipelines, RTSP, OpenVINO, YOLO, or frame decoding. None of these exist in this repository.
- Do **not** assume Docker or docker-compose — not found in this repository.
- Do **not** assume formal test suites — none found.
- Do **not** assume LPR/OCR capabilities — image URLs are stored but no OCR logic exists.
- Do **not** assume the Reports screen exports are fully implemented — export buttons (CSV/Excel) exist in the UI but their backend implementation was not confirmed in the repository.
- Do **not** assume the SAT plaza is always "Texcoco" — the plaza name is configurable; the filename pattern suggests the current deployment targets Texcoco.
- Do **not** assume `sat_watcher.py` is always running — it is a separate process that must be started independently of the main FastAPI server.
- Do **not** assume there is a `.env` file present — it is optional; engine.py calls `load_dotenv()` but falls back gracefully to empty strings.
