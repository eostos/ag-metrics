# PROJECT_CONTEXT.md — AUDITEC AVC/SAT (AG-Metrics)

## What This Project Does

AUDITEC is a **toll transaction auditing and reconciliation platform** developed by AG-Metrics for the Ebenezer / Alice Guardian ecosystem. It compares two independent sources of vehicle-crossing data — the **AVC system** (Automatic Vehicle Classification) and the **SAT system** (Sistema de Administración de Tráfico) — to detect discrepancies, count mismatches, and verify vehicle classification consistency at toll plazas.

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
| Entry point | `api.py` → FastAPI app → serves `frontend/AUDITEC.html` |
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
- Reports screen UI shows daily summaries and discrepancy reports, but its dataset is currently driven by `frontend/components/MockData.jsx`; live report API wiring is not confirmed.

---

## How AI Agents Should Reason About This Project

- The **central data flow** is: AVC events ↔ SAT transactions, joined by time window + class compatibility.
- The **reconciliation result** has three row types: `MATCH`, `AVC` (no SAT match), `SAT` (no AVC match).
- The `tipo` field on each result row is the primary audit status field.
- **Class mapping** is AVC-to-SAT: AVC uses `vehicle_type` strings + `axle_count` → mapped to a numeric SAT class (1–15, or 0 for invalid/unknown); SAT uses `id_classe` and `tab_id_classe`.
- **Class compatibility is exact**: `is_class_compatible()` returns true only if the AVC mapped class equals `id_classe` or `tab_id_classe`. Do not describe category matching unless the code changes.
- **`matchRate` is a detection-rate metric**, calculated as `(total - satOnly) / total * 100`; it is not the percentage of perfect MATCH rows.
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
