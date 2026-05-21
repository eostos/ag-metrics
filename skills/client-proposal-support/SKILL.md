# Skill: Client Proposal Support

## When to Use This Skill

Use this skill when:
- Generating technical-commercial proposals for toll operators or concessionaires
- Describing AUDITEC's capabilities to a prospective client
- Creating a statement of work, scope of delivery, or implementation plan
- Answering technical RFP questions based on what the system actually does
- Comparing AUDITEC's capabilities against a client's requirements

---

## Confirmed Capabilities (from Repository)

Only include these in proposals. Do not invent features not present in the code.

### Core Reconciliation

- Per-lane, per-date comparison of AVC vehicle detection events against SAT toll transactions
- Time-window matching with configurable before-AVC tolerance (default: 120s before AVC) and fixed 30s after-AVC clock tolerance
- Exact vehicle class compatibility check across two SAT class fields (`id_classe`, `tab_id_classe`): the AVC-mapped class must equal one of those fields
- AVC-to-SAT class mapping from raw vehicle_type strings and axle counts
- Axle count validation against expected SAT class axle counts
- Three-way result classification: MATCH / AVC-only / SAT-only
- Per-event diagnostic fields including time delta, class codes, axle comparison notes, and SAT candidate trace

### AVC Integration

- PostgreSQL direct connection (with or without SSH tunnel)
- REST API integration with configurable auth (Bearer, API Key, Basic) and field mapping
- Multiple simultaneous AVC sources, each independently configured and enabled/disabled
- Local event caching in SQLite for offline/disconnected operation
- Manual and automatic sync triggers

### SAT Integration

- JSON batch file ingestion via SFTP upload directory
- Incremental merge: new batches are appended to a daily merged file; already-processed batches are skipped
- Automatic column name detection (supports different field naming conventions)
- Handling of malformed JSON (CRLF sanitization)

### Dashboard and Monitoring

- Real-time lane card grid with match rate, event counts, and sparklines
- Match rate is currently an AVC detection-rate metric: `(total - SAT-only) / total`, not a perfect-match percentage
- Live status bar showing AVC event count and SAT transaction count
- 30-second auto-refresh polling
- Class distribution comparison panel (AVC vs SAT by vehicle class)
- Background auto-sync and auto-reconciliation for unreviewed lanes

### Lane Detail

- Per-event event table with filtering by status (Match / AVC-only / SAT-only / Axle Error)
- Vehicle image display (proxied from remote SSH media server or direct URL)
- Evidence panel with full AVC and SAT transaction fields
- SAT candidate trace for unmatched AVC events (diagnostic detail)
- Paginated table (50–500 events per page)
- Column sorting and free-text search

### Reports

- Date-range daily summary table per lane
- Discrepancy-focused view (rows with AVC-only or SAT-only counts)
- Aggregated KPIs across date range and lane selection
- Line chart of match rate per lane over time

### User Management and Security

- Role-based access: Admin / Auditor / Operator
- Session-based authentication (24h sessions)
- User management UI (add, activate/deactivate users)

### Configuration Management

- Admin-only configuration UI
- AVC source CRUD with test and sync controls
- Configurable timezone (IANA timezone names)
- Lane mapping configuration (AVC lane name → SAT voie identifier)
- SAT file directory management UI

---

## Architecture Facts for Proposals

| Item | Fact |
|------|------|
| Backend | Python 3.8+, FastAPI |
| Frontend | React 18, no build server required |
| Local storage | SQLite |
| External AVC DB | PostgreSQL (alice_guardian schema) |
| External AVC API | Alice Guardian REST API |
| SAT ingestion | SFTP JSON file delivery |
| Deployment | Single process, port 8080, managed by run.sh |
| No Docker required | Runs natively on Linux with Python 3.8+ |

---

## Limitations to Disclose

These limitations are real and confirmed:

1. **No real-time streaming**: AVC and SAT data are ingested on-demand or via periodic polling — not real-time.
2. **No automated alerting**: No email, SMS, or webhook notifications when match rates fall below thresholds.
3. **No LPR/OCR**: Vehicle images are stored and displayed but license plate text is not extracted or compared.
4. **No multi-plaza isolation**: Multiple plazas can be configured as separate AVC sources, but the Dashboard aggregates all lanes together with no per-plaza segmentation view.
5. **Reports use mock data**: The Reports screen's table and chart currently use `MockData.jsx` — live report data is not yet wired to the API.
6. **No export confirmed**: CSV/Excel export buttons exist in Lane Detail and Reports but their backend implementation was not confirmed.
7. **Single node only**: No clustering or horizontal scaling. Two Uvicorn workers share a single SQLite file.
8. **Password security**: SHA-256 hashing (not bcrypt). Acceptable for internal tools; should be disclosed for security-sensitive clients.
9. **No TLS in application**: Requires external reverse proxy for HTTPS.

---

## Implementation Phases (Suggested)

Based on the actual system structure, a phased delivery could be:

**Phase 1 — Core Deployment**
- Server setup and configuration
- AVC source integration (database or API)
- SAT SFTP directory setup and merge pipeline
- Lane mapping configuration
- User account creation

**Phase 2 — Operations Validation**
- Daily reconciliation validation over 5–10 days
- Time window calibration per lane
- Class mapping verification against actual AVC vehicle_type values
- Match rate baseline establishment

**Phase 3 — Reporting (Optional Enhancement)**
- Wire Reports screen to live API data (currently mock)
- Implement CSV/Excel export
- Add automated alerts for low match rates

---

## Questions to Ask the Client Before Proposing

1. What is the AVC system vendor? (Alice Guardian confirmed; other vendors may need adapter work)
2. How does the SAT system deliver transaction files? (SFTP JSON confirmed; other formats need parser work)
3. What are the column names in their SAT transaction files?
4. How many plazas and lanes? (affects performance sizing)
5. Is the PostgreSQL accessible via SSH tunnel, or is the AUDITEC server on the same network?
6. What is the expected daily transaction volume per lane?
7. Is HTTPS required? (needs reverse proxy setup)
8. What are the expected match rate thresholds for the SLA?
