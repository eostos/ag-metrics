# Dashboard and Reports Guide — AG-metrics AVC/SAT

## Application Structure

The frontend is a single-page React 18 application served from `frontend/AUDITEC.html`. It has three main screens accessible via the navigation layout:

1. **Dashboard** — real-time overview of all lanes for a selected date
2. **Lane Detail** — per-event reconciliation detail for a single lane
3. **Reports** — date-range analysis and discrepancy reporting
4. **Config** — administrative configuration (Admin role required)

---

## Dashboard

**Component:** `frontend/components/Dashboard.jsx`

### Behavior

- Polls `/api/status` every **30 seconds** to get live counts (AVC events, SAT transactions, pending files).
- On first load (or date change), fetches lanes from `/api/lanes`.
- Auto-merges pending SAT files silently when `sat_pending > 0`.
- Auto-syncs AVC data silently when no local events exist for today.
- Auto-runs background reconciliation for all lanes without cached stats.

### KPI Strip

Displayed at the top of the Dashboard:

| KPI | Definition |
|-----|-----------|
| Eventos AVC | Total AVC events detected (matched + AVC-only) |
| Coincidencias | Events where `match_valido == True` |
| AVC sin SAT | AVC events with no corresponding SAT transaction |
| SAT sin AVC | SAT transactions with no corresponding AVC event |
| Detección AVC | Detection rate: `avc_base / total * 100%` |

**Detection rate color thresholds:**
- ≥97% → green
- ≥94% → yellow
- <94% → red

### Live Bar

Shows current counts for AVC events, SAT merged transactions, and SAT pending files. Updates every 30 seconds from `/api/status`.

### Lane Cards

One card per AVC lane with local data for the selected date. Each card shows:
- Lane name and source name
- Match rate ring (color-coded)
- Matched / AVC-only / SAT-only / Axle-error counts
- Total AVC events
- Sparkline (12-bucket hourly distribution)

Clicking a lane card opens the **Lane Detail** screen.

### Summary Chart

A stacked bar chart (Chart.js) showing Matched / AVC-only / SAT-only / Axle-error per lane.

### Class Breakdown

Below the chart: a grid of per-class cards from `/api/class-summary`, showing AVC vs SAT counts for each vehicle class (1–15). Motorcycles (class 15) are visually separated.

---

## Lane Detail

**Component:** `frontend/components/LaneDetail.jsx`

### Behavior

- Loads events for the lane from `/api/lanes/{lane_id}/events`.
- If events are not yet reconciled, auto-runs `/api/reconcile` with the mapped SAT voie.
- Checks the configured lane mapping from `/api/config` to auto-select the correct SAT voie.

### Event Table

Columns: `#`, Status, Hora AVC, Hora SAT, Δ(s), Tipo Vehículo, Ejes AVC, Clase SAT, Monto, Notas, Actions.

Sortable by any column. Paginated (50/100/250/500 per page). Text search across all fields.

**Status filters (tabs):**

| Tab | Shows |
|-----|-------|
| Todos | All events |
| Coincidencias | `tipo == "MATCH"` |
| AVC sin SAT | `tipo == "AVC"` |
| SAT sin AVC | `tipo == "SAT"` |
| Error Ejes | `tipo == "MATCH"` and `nota_ejes` starts with `"ERROR"` |

### Evidence Panel (right-side panel)

Shows details for the selected row:
- AVC data: ID, timestamp, lane, vehicle type, axle count
- SAT transaction: timestamp, delta, id_classe, tab_id_classe, class description, expected axles, toll amount

### Event Modal

Opened via the info button on each row. Shows full event details in two columns:
- Left: vehicle image + AVC data
- Right: SAT file reference, SAT transaction data, reconciliation diagnostics, SAT candidate list

### Controls

- **Date picker** — changes the date and re-loads events
- **SAT voie selector** — select which SAT lane to compare against
- **Re-conciliar button** — forces a fresh reconciliation run
- **CSV / Excel buttons** — UI present; export implementation not confirmed in the repository

---

## Reports Screen

**Component:** `frontend/components/Reports.jsx`

### Filters

- Date range: from / to
- Report type: Daily Summary | Discrepancies
- Lane selector: toggle individual lanes or select all/none

### KPI Strip

Same metrics as Dashboard KPI strip, aggregated over the selected date range and lanes.

### Chart

Line chart showing match rate (%) per lane over the selected date range.

### Table

**Daily Summary:** one row per (date, lane) with columns:
Fecha, Carril, Total AVC, Total SAT, Coincidencias, AVC sin SAT, SAT sin AVC, % Coincidencia, Err. Ejes

**Discrepancias:** same table filtered to rows where `avcOnly > 0`, `satOnly > 0`, or `axleErr > 0`.

Color coding for AVC-only column: >20 → red, >5 → orange, else gray.  
Color coding for SAT-only column: >10 → red, >3 → blue, else gray.

The Reports screen uses real data from `/api/reports/summary`, which reads `recon_cache`. A date/lane appears in Reports only after that lane/date has been reconciled.

The discrepancy analysis includes:
- Aggregate motive breakdown from `motivo_no_match`
- Axle error totals from `nota_ejes`
- Worst lane/day rows by discrepancy rate
- Global detection and discrepancy rates

### Export

Excel export is generated client-side from the currently filtered report rows.

---

## Configuration Screen

**Component:** `frontend/components/Config.jsx`  
**Access:** Admin role only

Four tabs:

### 1. Fuentes AVC
- List of all AVC sources with status indicator
- Add / Edit / Delete sources
- Test connection button (calls `/api/sources/{id}/test`)
- Sync button (calls `/api/sources/{id}/sync` for a selected date)
- Sync all sources button

### 2. Integración SAT
- Shows SFTP upload directory status (`/home/sftpuser/uploads/`)
- Lists files by day: pending count, merged status, transaction count
- Manual merge button per day
- Auto-updates every 30 seconds

### 3. Sistema
- Timezone selector (Mexican timezones + UTC)
- AVC ↔ SAT lane mapping table
  - AVC lane names from `avc_local_events`
  - SAT voies from merged files
  - Dropdown (or text input) to assign each AVC lane to a SAT voie

### 4. Usuarios y Permisos
- User table: name, email, role, status, last login
- Add user modal
- Toggle active/inactive status
