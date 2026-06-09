# CLAUDE.md — Claude Code Instructions

## Project Summary

AG-metrics AVC/SAT is a toll auditing platform. It reconciles AVC vehicle detection events against SAT toll transactions, per lane, per date. The core logic lives in `engine.py`. The API is in `api.py` (FastAPI). The frontend is in `frontend/` (React 18, no build step). The local store is SQLite (`app_settings.db`).

Read `PROJECT_CONTEXT.md` before working on any task.

---

## How Claude Should Work in This Repo

1. **Inspect before writing.** Read the relevant source file(s) fully before making changes. Never guess at function signatures, column names, or config keys — they are all confirmed in the code.
2. **Never hallucinate endpoints or database tables.** The full API and schema are documented in `docs/api-guide.md` and `docs/database-guide.md`.
3. **Never modify application logic unless explicitly asked.** If the user asks for documentation or context files, create those. Do not fix bugs or refactor unless instructed.
4. **Trace data flow before debugging.** The flow is: AVC source → `avc_local_events` → `reconcile()` → `recon_cache` → Dashboard. Follow this chain when investigating problems.
5. **Always distinguish confirmed facts from assumptions.** If something is not visible in the code, say "not found in repository" rather than inferring.

---

## Preferred Response Style

- Concise and direct. No marketing language.
- When referring to code, include file name and line number (e.g., `engine.py:474`).
- When discussing the reconciliation result, use the exact field names from the DataFrame: `tipo`, `match_valido`, `nota_ejes`, `delta_segundos`, `clase_avc_mapeada`, `id_classe`, `tab_id_classe`.
- Do not explain what code does by restating the variable names — explain the business reason.
- When uncertain, say so explicitly rather than providing a plausible-sounding answer.

---

## Step-by-Step Workflow for Changes

### Debugging

1. Read `docs/troubleshooting-guide.md` for the relevant symptom.
2. Identify the affected layer: frontend / API endpoint / engine function / SQLite / external source.
3. Reproduce the problem with the minimal API call using `curl` (see `AGENTS.md`).
4. Read the relevant function in full before proposing a fix.
5. State the root cause explicitly before making changes.

### Modifying

1. Read the function to be changed in full.
2. Identify all callers — especially if modifying `engine.py` or shared utilities.
3. Make the minimal change required; do not refactor surrounding code.
4. Verify that reconciliation result column names are not changed (frontend depends on them).
5. If modifying the SQLite schema, add a migration guard (see the `ALTER TABLE` pattern in `api.py:113`).

### Testing

1. Start the server: `./run.sh debug`
2. Run manual smoke tests from `AGENTS.md`.
3. Exercise the affected endpoint directly with `curl`.
4. For engine changes, test `engine.reconcile()` in isolation with a Python one-liner.

### Documenting

1. Update the relevant `docs/` file when adding a new API endpoint or changing config keys.
2. Update `docs/api-guide.md` if adding endpoints.
3. Update `docs/database-guide.md` if changing the SQLite schema.
4. Do not create new documentation files unless instructed.

---

## Important Invariants

- The `tipo` field on reconciliation rows is one of: `"MATCH"`, `"AVC"`, `"SAT"`, `"SP_EXCLUDED"`. The fourth value marks SAT events excluded from reconciliation (`id_obs_mp==30 AND id_classe==0 AND id_paiement==0`).
- `match_valido` is `True` only for `MATCH` rows (not for axle-error matches — those are still valid matches).
- SAT events are expected to arrive **before** the AVC event (SAT records the toll charge; AVC records the physical detection). The default window is 120s before AVC + 30s after.
- AVC lane names and SAT voie identifiers are **not** the same namespace — the lane mapping config bridges them.
- The `app_settings.db` file is a runtime artifact — never commit it, never hard-code its path.
