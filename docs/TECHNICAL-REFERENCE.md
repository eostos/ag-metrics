# AG-metrics AVC/SP — Technical Reference

**Version 2.0** · 2026-08-07 · Toll transaction auditing platform

Single authoritative reference for the platform: architecture, business logic,
integrations, data contracts, API surface, reports, operations and known gaps.

Everything in this document is confirmed from the repository or measured against
production data. Anything unverified is labelled as such.

---

## Table of Contents

1. [What the platform does](#1-what-the-platform-does)
2. [Architecture](#2-architecture)
3. [Data model](#3-data-model)
4. [Data contracts](#4-data-contracts)
5. [Integrations](#5-integrations)
6. [Core logic — reconciliation](#6-core-logic--reconciliation)
7. [Core logic — Δt](#7-core-logic--δt)
8. [Unattended pipelines](#8-unattended-pipelines)
9. [API surface](#9-api-surface)
10. [Reports and notifications](#10-reports-and-notifications)
11. [Frontend](#11-frontend)
12. [Configuration](#12-configuration)
13. [Operations](#13-operations)
14. [Metrics reference](#14-metrics-reference)
15. [Known gaps and open risks](#15-known-gaps-and-open-risks)
16. [Changelog](#16-changelog)

---

## 1. What the platform does

Reconciles **AVC** vehicle-detection events against **SP** toll transactions,
per lane, per day, to verify that every vehicle physically detected corresponds
to a toll charge with the correct vehicle class and axle count.

Deployment: toll plaza with three active lanes (Carril-7-Ejes, Carril-8-Ejes,
Carril-9-Ejes → SP voies T07, T08, T09). Plaza name is configurable; current
deployment targets Texcoco.

**Naming:** the backend says SAT everywhere (variables, functions, DB fields);
only UI-facing labels say SP. Do not rename backend identifiers.

### Volume (as of 2026-08-07)

| | |
|---|---|
| AVC events stored | 376,208 |
| Reconciliation cache entries | 628 |
| Δt measurements | 122 |
| Typical daily volume | ~4,600 AVC · ~3,800 SP across three lanes |

---

## 2. Architecture

```
┌──────────────┐   SFTP    ┌──────────────┐          ┌────────────────┐
│ SP (toll)    │──batches─►│ sat_watcher  │──merge──►│ ~/sat_merged/  │
└──────────────┘           │ systemd user │          │ *-MERGED.json  │
                           └──────────────┘          └────────┬───────┘
┌──────────────┐  SSH tunnel + psycopg2                       │
│ PostgreSQL   │◄────────────────┐                            │
│ (AVC source) │                 │                            ▼
└──────────────┘        ┌────────┴───────┐          ┌──────────────────┐
                        │    api.py      │◄─────────┤   engine.py      │
┌──────────────┐  HTTP  │   FastAPI      │          │ reconcile()      │
│ Alice        │◄───────┤                │          │ estimar_offset() │
│ Guardian     │        │  SQLite store  │          │ align_avc_sat()  │
│ (evidence)   │        └────────┬───────┘          └──────────────────┘
└──────────────┘                 │
                                 ▼
                        ┌────────────────┐
                        │  frontend/     │  React 18, Babel in-browser
                        │  no build step │  served as static files
                        └────────────────┘
```

**Stack:** Python 3.8, FastAPI + GZipMiddleware, pandas, SQLite, React 18 via
Babel standalone (no bundler), psycopg2 + sshtunnel, paramiko, smtplib.

**Critical files:**

| File | Lines | Role |
|---|---|---|
| `api.py` | ~4,500 | All endpoints, SQLite schema, orchestration, background threads |
| `engine.py` | ~1,000 | Reconciliation, Δt estimation, class mapping, AVC fetching |
| `sat_watcher.py` | 153 | Independent daemon merging SP batches |
| `frontend/components/*.jsx` | ~5,200 | UI, compiled in the browser |

---

## 3. Data model

SQLite at `app_settings.db` (runtime artifact — never commit, never hard-code
the path).

### `avc_local_events` — synchronised AVC detections

| Column | Type | Notes |
|---|---|---|
| `event_id`, `source_id` | TEXT, INTEGER | Composite primary key |
| `event_date` | TEXT | **Derived from `event_timestamp`**, not from the query date |
| `lane_name` | TEXT | AVC device name |
| `vehicle_type` | TEXT | `motorcycle`, `light_vehicle`, `bus`, `truck`… |
| `axle_count` | INTEGER | |
| `event_timestamp` | TEXT | Local Mexico time — the authoritative instant |
| `vehicle_image_url`, `vehicle_image_path` | TEXT | Evidence references |
| `extra_json` | TEXT | Everything else from the source, flattened on read |
| `synced_at` | TEXT | |

### `lane_offsets` — measured Δt per lane per day

Primary key `(lane_name, offset_date)`. Columns: `offset_s`, `peak`,
`coverage`, `sharpness`, `n_avc`, `n_sat`, `origin` (`auto` \| `backfill` \|
`manual`), `created_at`.

### `recon_cache` — reconciliation results

Primary key `cache_key` = `"{source_id}::{lane}::{date}"`. Every result is
written **twice**: under the real `source_id` and under `0`.

`summary_json` carries `schemaV` (`_RECON_SCHEMA_VERSION`). Bump that constant
whenever reconciliation logic or summary keys change — stale caches then rebuild
themselves. Without it the Dashboard (which reads cache) and lane views (which
recompute live) diverge silently.

### `avc_sources`, `auditec_users`, `auditec_sessions`

Sources hold connection config as JSON. Users have `role` (`Admin` / `Auditor`)
and `status`. Sessions are bearer tokens with `expires_at`.

### `app_settings` — key/value configuration

Also used as a scratch store for runtime state: `processing_status::<date>`,
`lane_offset_runs`, `lane_offset_alerts_sent`, `avc_background_sync_last_run`.

---

## 4. Data contracts

### SP transaction (from the merged JSON)

Envelope: `batchuid`, `sourcesystem`, `generatedat`, `processed_batches[]`,
`transactions[]`.

| Field | Type | Meaning |
|---|---|---|
| `date_transaction` | str | ISO local time — **the instant the toll was charged** |
| `voie` | str | Lane identifier (`T07`, `T08`, `T09`) |
| `numero_poste` | int | Booth/operator position within the lane |
| `numero_transaction` | int | Folio, sequential **per (voie, numero_poste)**, restarts per poste |
| `id_classe`, `tab_id_classe` | int | Vehicle class, catalogue 1–15 |
| `prix_total` | int | Amount charged |
| `mode_reglement` | str | `EFEC` (cash), `PTAG` (tag), `EXEN` (exempt), empty |
| `id_paiement` | int | 1 = cash, 15 = tag, 27 = exempt, 0 = none |
| `id_obs_mp` | str | Observation code — `30` marks non-reconcilable events |
| `day_id`, `id_gare`, `id_voie`, `id_mode_voie`, `matricule`, `id_obs_sequence`, `id_obs_passage`, `fh_carga` | | Carried through to the result rows |

**Folio is not a unique key.** It repeats within a poste. The natural key is
`(voie, numero_poste, numero_transaction, date_transaction)`.

### Reconciliation result row

Produced by `engine.reconcile()`. Frontend depends on these exact names — **do
not rename**.

`tipo`, `avc_id`, `avc_device`, `avc_date`, `avc_image_url`, `avc_image_path`,
`Vehicle_type`, `axles_avc`, `clase_avc_mapeada`, `sat_voie`, `sat_date`,
`sat_numero`, `sat_prix`, `sat_*` (twelve pass-through SP fields), `id_classe`,
`tab_id_classe`, `sat_id_classe_desc`, `sat_id_classe_ejes`,
`sat_tab_id_classe_desc`, `sat_tab_id_classe_ejes`, `comparacion_ejes_id`,
`comparacion_ejes_tab`, `nota_ejes`, `delta_segundos`, `direccion_delta`,
`match_valido`, `motivo_no_match`, `observacion_auditoria`, `candidatos_sat`.

`delta_segundos` is **negative when SP precedes AVC** — the normal case.

### Class catalogue

`1` Auto · `2–9` C2–C9+ · `10–11` AR1/AR2 (trailer) · `12–14` B2/B3/B4 (bus) ·
`15` Moto · `0` undefined/invalid.

---

## 5. Integrations

### SP — SFTP batches

Files land in `/home/sftpuser/uploads` as
`SAT-TEXCOCO-<YYYYMMDD>T<HHMMSS>-<NNNN>.json`, roughly every 5 minutes
(~287/day). `sat_watcher.py` merges them into
`~/sat_merged/SAT-TEXCOCO-<YYYYMMDD>-MERGED.json`, deduplicating by `batchuid`
via `processed_batches`.

**Known source quirk:** batches are hard-wrapped at 2033 bytes with raw CRLF
that can split a JSON token mid-string (`"voie\r\n":"T07"`), breaking 40–65 % of
files for a naive `json.load`. `load_json_safe()` (`sat_watcher.py`) strips them.
This is handled — do not "fix" it again.

**Deletion:** the watcher tries to delete source batches after merging but lacks
write permission on the upload directory, so raw batches persist. That is
desirable — they are the only recoverable copy, and they were used to rebuild
2026-07-22 when its merge produced an empty file.

### AVC — PostgreSQL over SSH tunnel

`engine.fetch_avc_dataframe()` opens an SSH tunnel (`sshtunnel.open_tunnel`),
then queries `public."AVCs"` joined to `public."Devices"`, selecting `id`,
`vehicle_type`, `axle_count`, `vehicle_image_path`, `vehicle_image_url`,
`lane_no`, `deviceId`, `createdAt`, `updatedAt`. Timestamps are normalised
through a `COALESCE` expression tolerating epoch seconds, epoch millis and ISO
strings.

An HTTP API source type also exists (`_fetch_from_api`).

### Alice Guardian — evidence photos

`GET /api/sat-evidence/photo` requests a camera snapshot at
`sp_timestamp + Δt`, where Δt is the lane's measured offset for that day.
Response headers `X-Delta-T` and `X-Delta-T-Origen` record what was applied.

Verified against the live camera: an SP transaction at 09:15:00 on Carril-8
returned a frame stamped 09:17:12 — 132 s later, matching the 134 s requested.

### SMTP — report and alarm email

`smtplib` with SSL or STARTTLS. Errors are mapped to human messages by
`_smtp_error_msg()`. Settings under `report_email_settings`.

---

## 6. Core logic — reconciliation

Full detail in **`docs/toll-audit-logic.md`**. Summary:

### Pipeline

`reconcile()` runs per lane, per date:

1. Filter AVC and SP by lane and by the **date of their timestamp**, sort both ascending
2. Flag excluded SP events
3. Global optimal assignment via `align_avc_sat()`
4. Emit result rows

### Matching — `align_avc_sat()`

Needleman-Wunsch global sequence alignment (dynamic programming). Replaced
greedy matching in commit `ae4867c4`.

Lexicographic objective:
1. **Maximise the number of valid matches** — dominates unconditionally (`BIG` = 10⁶)
2. Minimise `Σ|delta + offset_s|` — tie-break, centred on the lane's Δt

Monotonicity is guaranteed: matches never cross in time. O(n·m) time and space.

### Hard rules for a candidate pair

1. **Asymmetric window** — SP must precede AVC: `delta ∈ [-window, +30 s]`. The
   +30 s (`_SAT_AFTER_TOLERANCE`) absorbs clock skew.
2. **Class compatibility is mandatory** — `is_class_compatible()`: AVC class ≠ 0
   and equals either `id_classe` or `tab_id_classe`. No category matching.
3. SP events already flagged `SP_EXCLUDED` are never candidates.

### Row types (`tipo`)

| Value | Meaning |
|---|---|
| `MATCH` | Paired. `match_valido = True` |
| `AVC` | AVC detection with no SP charge |
| `SAT` | SP charge with no AVC detection |
| `SP_EXCLUDED` | `id_obs_mp == 30 AND id_classe == 0 AND id_paiement == 0`. Excluded from `total` and `matchRate` |

An axle mismatch inside a `MATCH` does **not** invalidate it — `match_valido`
stays `True` and `nota_ejes` records the discrepancy.

### `motivo_no_match` values

Unmatched AVC: `error_conteo_avc`, `moto_detectada_solo_por_avc`,
`SP_compatible_fuera_de_ventana`, `clase_distinta`, `SAT_no_detecto`.

Unmatched SP: `moto_SAT_sin_AVC`, `SAT_clase_indefinida`, `AVC_no_detecto`.

> `SP_compatible_fuera_de_ventana` exists because the old cascade reported
> `clase_distinta` whenever *any* candidate sat in the window, even when a
> perfectly class-compatible SP existed just outside it. That sent auditors
> hunting a classification bug when the problem was timing.

**Label maps are duplicated in three places** — `api.py` `MOTIVE_LABELS`,
`Operations.jsx` `MOTIVE_LABELS_MAP`, `Reports.jsx` `motiveLabel()`. A new
motivo requires editing all three.

### Motorcycle evasion is normal

~95 % of motorcycles in lanes 7 and 8 pass without generating a charge.
`moto_detectada_solo_por_avc` rows are **correct output**, not defects. Moto
volume alone accounts for the entire AVC/SP gap on Carril-8. Detection metrics
therefore report motorcycles separately.

Measured: excluding motorcycles, the AVC/SP ratio is 0.94–0.96 across weekdays,
weekends and Sundays — rock stable.

---

## 7. Core logic — Δt

Full detail in **`docs/delta-t-guide.md`**. Summary:

Δt is the number of seconds by which the SP transaction **precedes** the AVC
detection. It is a property of the lane, measured — never configured.

| Lane | Δt (2026-08-07) |
|---|---|
| Carril-7-Ejes | 170 s |
| Carril-8-Ejes | 148 s |
| Carril-9-Ejes | 96 s |

These are a snapshot. They move every day — query
`GET /api/lane-offsets` for live values rather than trusting any number written
in a document.

**Measured** by cross-correlation (`engine.estimar_offset`, ~164 ms): slide the
SP series over the AVC series across shifts 0–300 s, count coincidences at ±1 s,
take the peak. Needs no prior matching, so it breaks the chicken-and-egg problem.

**Three quality gates:** ≥15 events per series to estimate · ≥30 AVC events to
store · sharpness ≥2.5 to trust.

**Everything time-related derives from it:** the reconciliation window
(`Δt + 30`, or `+40` when inherited), the DP tie-break centre, and the evidence
photo timestamp.

**It drifts ~1 s/day** and occasionally jumps (Carril-8 +33 s on 2026-07-01,
Carril-7 +60 s on 2026-08-01 — both on the 1st of the month). The drift is a
clock-synchronisation problem; everything built here is mitigation, not a cure.

### Why this matters

Carril-8's Δt crossed the old fixed 120 s window on **2026-07-10**. From then
until the window was derived, the matcher paired each AVC event with the
*previous vehicle's* charge: on 2026-07-23 alone, **1067 of 1112 matches were
wrong** and ~44,000 in SP amount went unreconciled.

The 2026-08-01 jump on Carril-7 validated the fix in production: detected and
alerted at 09:08 the same morning, window auto-adjusted 134 → 194, `satOnly`
improved 64 → 40 → 11, zero manual intervention.

---

## 8. Unattended pipelines

Four background threads in `api.py` started at FastAPI startup, plus one
external daemon. None requires a browser to be open.

| Pipeline | Thread / process | Cadence | Guard |
|---|---|---|---|
| SP merge | `sat_watcher.py` (systemd user service, linger on) | 60 s | — |
| AVC sync | `_avc_sync_scheduler_loop` | 300 s | — |
| Reconciliation | `_auto_reconcile_scheduler_loop` | 300 s | Per-day flock |
| Δt measurement | `_lane_offset_scheduler_loop` | 600 s wake, acts at 09h and 23h | Slot registry + flock |
| Reports | `_report_scheduler_loop` | — | flock |

**Cache invalidation must be followed by re-reconciliation.** When
`_fetch_and_store` drops caches for dates it touched, it relaunches those dates
immediately. Without that, `/api/lanes/{id}/events` falls back to raw local
events (`source: "local"`) for up to five minutes — the UI shows unreconciled
numbers and the day appears "not to load properly".

---

## 9. API surface

63 endpoints. All except static file serving require `Authorization: Bearer
<token>`; admin-only endpoints use `Depends(_require_admin)`.

Full reference in `docs/api-guide.md`. Principal endpoints:

### Auth
`POST /api/auth/login` · `POST /api/auth/logout`

### Reconciliation and lanes
| Endpoint | Notes |
|---|---|
| `GET /api/lanes?query_date=` | Dashboard data — **reads cache** |
| `GET /api/lanes/{lane_id}/events?query_date=` | Full result rows; falls back to raw local events if no cache |
| `POST /api/reconcile` | Body: `avc_lane`, `date`, optional `sat_lane`, `source_id`, `window_s`. Omit `window_s` to derive from Δt |
| `GET /api/reconcile/cache` | Cache inventory |
| `GET /api/class-summary?query_date=` | Class distribution AVC vs SP |

### Δt
| Endpoint | Notes |
|---|---|
| `GET /api/lane-offsets?days=30` | Series per lane + Theil-Sen drift + `operating` block |
| `GET /api/lane-offset-analysis?lane=&query_date=&compare=1` | Correlation curve (301 points), verdict, window comparison, Δt by segment. ~3.6 s |

### Sources and data
`GET/POST/PUT/DELETE /api/sources[/{sid}]` · `POST /api/sources/{sid}/test` ·
`POST /api/sources/{sid}/sync` · `POST /api/merge-sat` ·
`GET /api/sat/{merged-files,lanes,voies,tariffs,directory}` ·
`GET /api/avc/lanes` · `GET /api/status`

### Evidence
`GET /api/image?ref=` · `GET /api/sat-evidence/photo?source_id=&avc_lane=&sat_timestamp=` ·
`GET /api/avc-source-evidence/lanes` · `POST /api/avc-source-evidence/test`

### Reports, alarms, admin
`GET /api/reports/{summary,hourly,events}` ·
`GET/POST /api/report-{configs,settings,templates}` ·
`POST /api/report-email/{test,send-now,send-preview}` ·
`GET /api/report-history` · `GET/POST /api/contact-groups` ·
`GET /api/notification-history` · `GET/POST /api/alarm-{rules,settings}` ·
`GET/POST /api/active-alarms` · `GET /api/alarm-history` ·
`GET/POST /api/config` · `GET/POST/PUT /api/users[/{uid}]`

---

## 10. Reports and notifications

### Report types

`_report_rows_for_type()` filters aggregated rows:

| Type | Filter |
|---|---|
| Axle Count Discrepancy Report | `axleErr > 0` |
| Vehicle Classification Mismatch Report | `classMismatch > 0` |
| Possible Evasion Report | `satOnly > 0 OR avcOnly > 0` |
| (default) | all rows |

Frequencies: `daily`, `weekly`, `monthly`. Delivered by
`_report_scheduler_loop` via SMTP, with PDF templates and contact groups.
History in `report_history`; deliveries logged to `notification_history`.

### Δt alarms

`_check_offset_alerts()` runs after each successful Δt measurement:

| Alert | Trigger |
|---|---|
| Clock jump | \|Δt today − Δt yesterday\| ≥ 10 s |
| Stalled measurement | Operating Δt inherited with `age_days` ≥ 2 |

Deduplicated per lane and day via `lane_offset_alerts_sent`.

---

## 11. Frontend

React 18 compiled in the browser by Babel standalone. **No build step, no
bundler, no npm install.** Components load as `<script type="text/babel">` from
`frontend/AUDITEC.html`, each with a `?v=` cache-buster that **must be bumped on
every change** — otherwise the browser serves the cached version.

| Component | Lines | Role |
|---|---|---|
| `Dashboard.jsx` | 1,161 | Lane cards, Δt card, deep-Δt modal, class breakdown |
| `Config.jsx` | 1,532 | Sources, lane mapping, integrations, users |
| `Reports.jsx` | 1,153 | Report configuration, templates, history |
| `LaneDetail.jsx` | 1,041 | Per-lane event tables and evidence |
| `Operations.jsx` | 990 | Printable operational reports |
| `Layout.jsx`, `Auth.jsx` | 379 | Shell and login |
| `MockData.jsx` | 138 | **Static mock data — the Reports screen still uses it** |

Δt-specific components in `Dashboard.jsx`: `DeltaT` (card row), `OffsetCurve`
(SVG correlation curve), `DeepDeltaPanel` (analysis modal).

Validate JSX changes by compiling with `@babel/standalone` under Node —
balanced-brace checks are not sufficient, and a syntax error only surfaces at
runtime in the browser.

---

## 12. Configuration

Stored in `app_settings` (key/value). No `.env` required — `load_dotenv()` falls
back gracefully.

| Key | Purpose |
|---|---|
| `lane_mapping` | AVC lane name → SP voie. **Not the same namespace** |
| `avc_tariffs` | Per-class tariff for AVC-side amount estimation |
| `plaza_name`, `timezone`, `media_root` | Deployment identity |
| `postgres_*`, `ssh_*` | AVC source connection |
| `avc_evidence_integration` | Alice Guardian settings |
| `report_*`, `contact_groups` | Reporting |
| `lane_offset_runs`, `lane_offset_alerts_sent` | Δt scheduler state |

### Tunable constants (`api.py`)

| Constant | Default | Env override |
|---|---|---|
| `_RECON_WINDOW_S` | 120 | — (fallback only) |
| `_RECON_SCHEMA_VERSION` | 2 | — |
| `_OFFSET_MIN_SHARPNESS` | 2.5 | — |
| `_OFFSET_MIN_EVENTS` | 30 | — |
| `_OFFSET_MARGEN_MEDIDO` / `_HEREDADO` | 30 / 40 | — |
| `OFFSET_RUN_HOURS` | `9,23` | `AUDITEC_OFFSET_RUN_HOURS` |
| `OFFSET_CHECK_INTERVAL_SECONDS` | 600 | `AUDITEC_OFFSET_CHECK_INTERVAL_SECONDS` |
| `AVC_SYNC_INTERVAL_SECONDS` | 300 | `AUDITEC_AVC_SYNC_INTERVAL_SECONDS` |
| `RECONCILE_AUTO_INTERVAL_SECONDS` | 300 | `AUDITEC_RECONCILE_INTERVAL_SECONDS` |
| `RECONCILE_AUTO_DAYS_BACK` | 3 | `AUDITEC_RECONCILE_DAYS_BACK` |

---

## 13. Operations

```bash
./run.sh prod      # background, 2 workers, log /tmp/auditec_api.log
./run.sh debug     # foreground with reload — STOPS any running instance first
./run.sh stop | status | logs

systemctl --user status sat-watcher     # SP merge daemon (linger enabled)
```

Server on port 8080. Virtualenv at `.venv` (Python 3.8) — pandas is **not**
available in the system Python; use `.venv/bin/python` for any script. The
`sqlite3` CLI is not installed; use Python's module.

### Smoke test

```bash
TOK=$(curl -s -X POST localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@auditec.mx","password":"admin123"}' | jq -r .token)
curl -s "localhost:8080/api/lanes?query_date=2026-08-07" -H "Authorization: Bearer $TOK"
```

### Diagnostics

| Symptom | First check |
|---|---|
| Dashboard ≠ lane detail | Stale cache — is `schemaV` current? |
| A day "doesn't load" | Cache invalidated without re-reconciliation |
| Lane mis-pairing everything | Δt vs window — `GET /api/lane-offsets` |
| No new SP data | `systemctl --user is-active sat-watcher` |
| Totals don't add up | `AVC = MATCH + avcOnly` · `SP = MATCH + satOnly + excluded` |

---

## 14. Metrics reference

From `_recon_summary()`:

| Key | Definition |
|---|---|
| `total` | Rows excluding `SP_EXCLUDED` |
| `matched` | `match_valido == True` |
| `avcOnly` | Unmatched AVC |
| `satOnly` | Unmatched SP |
| `axleErr` | Matches whose `nota_ejes` starts with `ERROR` |
| `excluded` | `SP_EXCLUDED` count |
| `matchRate` | **Detection rate**, `(total − satOnly) / total × 100`. Not a match percentage |
| `motoAvc`, `motoSinCobro`, `motoSat` | Motorcycle counts |
| `motoRate` | Motorcycle evasion percentage |
| `matchRateSinMotos` | Detection rate excluding motorcycles from both sides |
| `windowS`, `windowFrom`, `offsetS`, `offsetDate` | Which window was applied and where it came from |
| `schemaV` | Summary schema version |

**Accounting invariants** — all must hold:

```
AVC events = matched + avcOnly
SP events  = matched + satOnly + excluded
total      = matched + avcOnly + satOnly
```

---

## 15. Known gaps and open risks

### Operational

| Gap | Impact |
|---|---|
| Clocks drift ~1 s/day and jump monthly | Root cause is NTP; everything here is mitigation |
| Carril-7 AVC non-detection reached 8 % (peaks 17 %) on 2026-07-27 morning vs 2.8 % normal | Detector issue, not software — needs field review |
| Carril-7 works shifts (some days afternoon only) | Undocumented until now; affects Δt slot coverage |
| AVC source returns events outside the queried day | Handled defensively via `margin_days`; origin not investigated |

### Design

| Gap | Impact |
|---|---|
| DP cardinality dominates unconditionally | Can trade 3 good pairings for 1 extra match. **Business decision — deliberately not changed** |
| Δt slot marked done if *any* lane succeeds | A shift-working lane may get only one measurement per day |
| Jump alert catches steps, not gradual acceleration | A drift going 1 → 6 s/day would not fire it |
| Three duplicated `motivo` label maps | Must be edited in lockstep |

### Product

- Reports screen still uses `MockData.jsx`, not live API
- CSV/Excel export buttons exist in the UI; backend implementation unconfirmed
- No automated test suite in the repository (ad-hoc scripts only)
- No Docker, no TLS in the app itself
- Motorcycle evasion (~850 uncharged passes/day on Carril-8) is measured but not
  yet surfaced as a first-class audit report

---

## 16. Changelog

### 2.0 — 2026-08-07

Δt subsystem and its consequences.

- **Δt measurement** by cross-correlation, twice daily, stored per lane/day with
  quality gates and inheritance
- **Reconciliation window derived from Δt** instead of a fixed 120 s — fixed
  Carril-8, broken since 2026-07-10
- **DP tie-break centred on Δt** (`offset_s`, backwards compatible)
- **Evidence photos** requested at `sp_timestamp + Δt` instead of a hard-coded
  60 s
- **Motorcycle evasion** promoted to a reported metric; detection metrics now
  exclude motorcycles
- **`SP_compatible_fuera_de_ventana`** motivo — no longer misreports a timing
  problem as a classification problem
- **Δt alarms** for clock jumps and stalled measurement
- **Deep Δt analysis panel** with correlation curve
- **`_RECON_SCHEMA_VERSION`** so stale caches self-rebuild
- **`event_date` derived from the event's own timestamp** — 68 previously
  invisible events recovered
- **`sat_watcher` as a systemd user service** — SP merge no longer depends on
  someone opening the Dashboard
- **Cache invalidation now relaunches reconciliation immediately**

### 1.x — before 2026-07-24

Greedy matching replaced by DP alignment (`ae4867c4`); `amount_delta` sign fixed
(`143a89a9`); dual lane metrics (`dd4352a5`); `SP_EXCLUDED` type (`335aba61`);
SAT→SP UI labels (`40bd7e70`).

---

## Related documents

| Document | Scope |
|---|---|
| `docs/delta-t-guide.md` | Δt in full — measurement, gates, inheritance, pipeline, limitations |
| `docs/toll-audit-logic.md` | Reconciliation rules, class mapping, axle comparison |
| `docs/api-guide.md` | Endpoint-by-endpoint reference |
| `docs/database-guide.md` | Schema detail |
| `docs/integration-guide.md` | External systems |
| `docs/troubleshooting-guide.md` | Symptom-driven diagnostics |
| `PROJECT_CONTEXT.md` | Orientation for new contributors and AI agents |
| `CLAUDE.md` | Working rules and invariants |
