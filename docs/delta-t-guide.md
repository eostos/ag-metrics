# Δt Guide — SP→AVC Time Offset

How the platform measures, stores and applies the per-lane time offset between an
SP toll transaction and the corresponding AVC detection.

Everything below is confirmed from the repository and from production data
measured on 2026-07-22 … 2026-07-25.

---

## 1. What Δt Is

The number of seconds by which the **SP transaction precedes** the AVC
detection. The driver pays at the booth (SP), then crosses the sensor (AVC), so
SP always comes first.

Δt is a property of the **lane**, not of the vehicle: every vehicle segment in a
given lane shares the same mode.

| Lane | Δt (2026-07-24) |
|---|---|
| Carril-7-Ejes | 97 s |
| Carril-8-Ejes | 134 s |
| Carril-9-Ejes | 86 s |

### Why it matters

Δt drifts by roughly **1 second per day**. When a lane's Δt exceeded the old
fixed 120 s window, the correct SP transaction became unreachable and the
matcher paired each AVC event with the *previous vehicle's* charge.

Carril-8 crossed 120 s on **2026-07-10** and had been reconciling incorrectly
ever since. Measured impact for a single day (2026-07-23, Carril-8): 407 matches
lost, **1067 of 1112 matches paired with the wrong transaction**, and ~44,000 in
SP amount left unreconciled.

The drift is a clock-synchronisation (NTP) problem. Everything here is
mitigation, not a cure — all three lanes drift in the same direction, which
points to a single common clock.

---

## 2. How Δt Is Measured — `engine.estimar_offset()`

```python
estimar_offset(avc_ts, sat_ts, lag_min=0, lag_max=300, tol=1, with_curve=False)
```

Cross-correlation. Slide the SP series over the AVC series across every shift
from 0 to 300 s; for each shift, count how many AVC events have some SP event at
`avc_time - lag` within ±1 s. The shift with the most coincidences is Δt.

**It never needs to know which SP goes with which AVC.** That breaks the
chicken-and-egg problem: reconciliation needs Δt, but deriving Δt from matches
would require having reconciled first. It also ignores vehicle class, so it is
immune to the mis-pairing problem it is meant to diagnose.

Returns `offset_s`, `peak`, `coverage`, `sharpness`, `background`, `n_avc`,
`n_sat`, and optionally `curve` (301 points, used by the analysis panel).

**Cost:** ~164 ms for 2472 × 1637 events. A single `reconcile()` pass costs
~1.4 s — roughly 10× more.

### Worked example (Carril-8, 2026-07-22)

- Peak: **1478** coincidences at a 132 s shift
- Background: **347** — the best any other shift achieves
- Sharpness: **4.26×** above background; coverage 59.5 %

The background is not zero because traffic is dense: with 1706 transactions in a
day, any shift hits a few hundred by chance. What identifies the true value is
that ~1500 line up *simultaneously*.

---

## 3. Quality Gates

Three gates in sequence. A value can pass the first two and still not be used.

| # | Gate | Where | Threshold | If it fails |
|---|---|---|---|---|
| 1 | Sample floor | `estimar_offset` (`engine.py`) | **15 events in *each* series** (AVC and SP) | Returns `None` — no estimate at all |
| 2 | Storage floor | `_estimate_offsets_for_date` | `n_avc` ≥ `_OFFSET_MIN_EVENTS` = **30** | Row not written to `lane_offsets` |
| 3 | Trust | `_resolve_lane_offset` | `sharpness` ≥ `_OFFSET_MIN_SHARPNESS` = **2.5** | Stored but flagged; the previous day's value is inherited instead |

Gate 3 is the one that actually protects reconciliation: a noisy measurement can
be recorded and still be refused as the operating value.

Sharpness catches degenerate inputs: perfectly periodic synthetic data returns
1.01, well below the threshold. Observed sharpness in production ranges 3.3–16;
coverage 43–94 %.

---

## 4. When Δt Is Measured

Twice a day — `OFFSET_RUN_HOURS`, default `"9,23"`
(env `AUDITEC_OFFSET_RUN_HOURS`).

Chosen from evidence, not convention: cumulative estimation from 00:00 up to
each cut-off shows the day's value is **already final by 08:00** on all lanes
and never moves afterwards. Carril-9 reaches sharpness 16.3 with only 51 events.

- **09h** — validates early, so an overnight clock jump is caught that morning
- **23h** — consolidates the full-day value, which the next day inherits

`_lane_offset_scheduler_loop()` (background thread, lock
`/tmp/auditec_lane_offset_scheduler.lock`) wakes every
`OFFSET_CHECK_INTERVAL_SECONDS` (600) and records completed slots in the
`lane_offset_runs` app setting. A slot that fails for lack of data is retried on
the next wake-up.

Intraday estimation is also viable — 1-hour windows land the correct value in 12
of 13 traffic-bearing slots (06:00–19:00). There is no traffic at night.

---

## 5. Carrying Δt Across Days — `_resolve_lane_offset(lane, fecha)`

| Priority | Condition | `resolved` | Window |
|---|---|---|---|
| 1 | Today's measurement, sharpness ≥ 2.5 | `medido` | Δt + 30 |
| 2 | Last trustworthy prior measurement | `heredado` | Δt + 40 |
| 3 | Only a doubtful measurement exists | `medido_dudoso` | Δt + 40 |
| 4 | Nothing at all | `None` | falls back to `_RECON_WINDOW_S` (120) |

Also returns `age_days`. Inheriting without correcting for drift introduces
~1 s of error per elapsed day — negligible against the margin.

> **Critical rule:** a low-sharpness measurement taken today must **never**
> override a good inherited value. Otherwise a noisy 06:00 estimate computed
> from a handful of events ruins the whole day.

---

## 6. The Reconciliation Window Is Derived From Δt

```
window(lane, day) = Δt_operating + margin(confidence)
```

`_ventana_para_carril()`. Margins: `_OFFSET_MARGEN_MEDIDO` = 30,
`_OFFSET_MARGEN_HEREDADO` = 40.

**Why 30 s.** Cumulative coverage around the mode (Carril-8, 2026-07-23,
n = 1386 high-confidence matches):

| Range | Coverage |
|---|---|
| ±2 s | 83.9 % |
| ±8 s | 89.6 % |
| ±20 s | 95.9 % |
| **±30 s** | **97.5 %** |

Verified empirically: a 163 s window (133 + 30) yields the **same 1492 matches**
as 180, 240, 300 and 600 s. Nothing new appears beyond that.

### Keep the window snug, never generous

Measured pairing changes relative to Δt+30:

| Margin | +30 | +40 | +50 | +60 | +80 | +100 |
|---|---|---|---|---|---|---|
| Carril-7 | 0 | 0 | 0 | 0 | 0 | 0 |
| Carril-8 | 0 | 0 | 0 | 0 | 0 | 0 |
| Carril-9 | 0 | 0 | 0 | 0 | **3** | **3** |

Safe up to Δt+60. Beyond that the DP starts sacrificing good pairings to gain
one extra match — see §7.

---

## 7. The DP Tie-Break Also Uses Δt

`engine.align_avc_sat(..., offset_s=0)` scores a candidate pair as:

```
BIG - abs(delta + offset_s)      # was: BIG - abs(delta)
```

Distance is measured from the **lane's expected offset**, not from zero. In a
lane with a 133 s offset the correct partner sits at 133 s, while the one that
looks temporally adjacent belongs to the *previous* vehicle.

`offset_s=0` reproduces the historical behaviour exactly, so the parameter is
backwards compatible.

### Known limitation

Cardinality dominates **unconditionally** — `BIG` is 10⁶ and dwarfs any delta,
so the offset only breaks ties among solutions with equal match counts. Widening
the window too far still lets the DP trade good pairings for one extra match.

Observed on Carril-9 going from 115 s to 300 s: one match gained, but three
pairings at delta −84/−86 (near-perfect) became −141/−154/−133.

Changing that lexicographic objective is a **business decision** — three wrong
amount attributions versus one extra match — and has deliberately not been made.

---

## 8. Evidence Photos Also Add Δt

`GET /api/sat-evidence/photo` requests the camera snapshot at
`sp_timestamp + Δt`, resolved for that lane and that day.
`_EVIDENCIA_OFFSET_FALLBACK` (60) applies only when no measurement exists.

Response headers `X-Delta-T` and `X-Delta-T-Origen` record what was applied.

Verified against the live camera: an SP transaction at 09:15:00 on Carril-8
returned a frame stamped **09:17:12** — 132 s later, matching the 134 s
requested within camera granularity. The previous hard-coded 60 s would have
requested 09:16:00, about five vehicles earlier at that lane's headway.

---

## 9. Persistence

Table `lane_offsets`, primary key `(lane_name, offset_date)`:

| Column | Meaning |
|---|---|
| `offset_s` | Measured Δt in seconds |
| `peak`, `coverage`, `sharpness` | Quality metrics |
| `n_avc`, `n_sat` | Sample sizes |
| `origin` | `auto` \| `backfill` \| `manual` |

When a day's Δt changes, `_invalidate_recon_cache()` drops that lane/day from
`recon_cache`. The auto-reconcile loop only checks the SP file's mtime, so it
would not otherwise notice that the window changed.

`recon_cache` summaries carry `schemaV` (`_RECON_SCHEMA_VERSION`). Bump that
constant whenever reconciliation logic or summary keys change — stale caches are
then rebuilt automatically. **Without it the Dashboard (which reads cache) and
the lane view (which recomputes live) silently diverge.**

---

## 10. Endpoints

### `GET /api/lane-offsets?days=30`

Historical series per lane, plus drift, status and an `operating` block
(`offset_s`, `resolved`, `age_days`, `window_s`).

Drift is computed with **Theil-Sen** (median of pairwise slopes). Neither
alternative works:

- *Least squares* absorbs clock jumps — it reported 1.89 s/day for Carril-8
  because of the 33 s step between 1 and 2 July.
- *Median of daily differences* can only return 0 or 1, mis-rounding
  Carril-9's true 0.65 s/day.

Theil-Sen returns 0.95 / 1.00 / 0.65, matching hand measurement.

### `GET /api/lane-offset-analysis?lane=X&query_date=Y&compare=1`

Deep analysis: correlation curve (301 points), verdict, current-vs-derived
window comparison, and Δt distribution by vehicle segment. Takes ~3.6 s because
it runs two `reconcile()` passes.

Frontend components in `Dashboard.jsx`: `DeltaT` (card row), `OffsetCurve`
(SVG), `DeepDeltaPanel` (the "Análisis profundo de Δt" modal).

---

## 11. Alerts — `_check_offset_alerts()`

| Alert | Trigger |
|---|---|
| Clock jump | \|Δt today − Δt yesterday\| ≥ 10 s |
| Stalled measurement | Operating Δt inherited with `age_days` ≥ 2 |

Deduplicated per lane and day via the `lane_offset_alerts_sent` app setting.

> A "margin running out" alert comparing the window against Δt would be
> **vacuous** — the window *is* Δt+30 by construction. That alert only made
> sense while the window was fixed at 120.

---

## 12. Pitfalls — Approaches That Do Not Work

| Approach | Why it fails |
|---|---|
| Nearest preceding SP for each AVC | Measures traffic **headway**, not offset. Gave 14 s for Carril-8 where the true value is 133 s. |
| Deriving Δt from matched pairs | Circular: the matches themselves are wrong when the window is wrong. |
| Widening the window "to be safe" | Past Δt+60 the DP trades good pairings for spurious matches (§7). |
| Treating `moto_detectada_solo_por_avc` as a defect | It is the correct output. ~95 % of motorcycles evade and genuinely have no charge — see `docs/toll-audit-logic.md`. |
| Matching low-Δt events to the nearby SP | That SP belongs to the *preceding* vehicle. Pairing them would fabricate matches and hide evasion. |

---

## 13. The Δt Pipeline — Who Calls What

Two independent chains. Neither depends on a browser being open.

### Measurement chain (twice daily)

```
_lane_offset_scheduler_loop()          background thread, wakes every 600 s
  └─ _estimate_offsets_for_date(fecha) at hours OFFSET_RUN_HOURS = 9, 23
       └─ per lane: _lane_offset_estimate()
            └─ engine.estimar_offset()  ← cross-correlation
       └─ _save_lane_offset()           → table lane_offsets
       └─ if the derived window changed: _invalidate_recon_cache(lane, fecha)
  └─ _check_offset_alerts(fecha)        → notification_history
```

A slot is recorded in the `lane_offset_runs` app setting so it runs once per day.
If it produces nothing (no data yet) the slot is **not** marked done and retries
on the next wake-up.

### Consumption chain (every reconciliation)

```
_ventana_para_carril(lane, fecha)
  └─ _resolve_lane_offset(lane, fecha)   ← measured today, else inherited
  └─ returns (window, info)
       ├─ window  → reconcile(..., ventana)
       └─ offset  → reconcile(..., offset_s=…)   ← DP tie-break centre
```

Called from `_reconcile_date_cache()` (background) and `POST /api/reconcile`
(on demand). An explicit `window_s` in the request body still wins — used by the
analysis panel and tests.

`_info_ventana()` stamps `schemaV`, `windowS`, `windowFrom`, `offsetS` and
`offsetDate` onto every summary, so any cached result records which window
produced it and where that window came from.

### Evidence chain

`GET /api/sat-evidence/photo` → `_fecha_de_timestamp()` → `_resolve_lane_offset()`
→ snapshot requested at `sp_timestamp + Δt`.

---

## 14. Verified in Production

On **2026-08-01** Carril-7's clock jumped **+60 s** in one day (104 → 164), then
resumed its normal +1 s/day drift.

| | |
|---|---|
| Detected | Same morning, 09:08, by the 09h slot |
| Alert raised | *"Δt de Carril-7-Ejes saltó +60s en un día (104s → 164s) — posible ajuste de reloj"* |
| Window response | 134 → 194, automatically |
| Reconciliation | `satOnly` **improved**: 64 → 40 → 11 over three days |
| Manual intervention | None |

Under the previous fixed 120 s window, Carril-7 at 164 s would have broken
exactly as Carril-8 did from 2026-07-10.

This was the second observed jump — the first was Carril-8 on 2026-07-01
(+33 s). **Both landed on the 1st of the month**, which suggests a scheduled
maintenance or monthly clock event. Worth watching on the 1st of each month.

Current values (2026-08-07): Carril-7 **170 s**, Carril-8 **148 s**, Carril-9
**95 s**. Carril-7 is now the largest, having overtaken Carril-8 after the jump.

---

## 15. Known Limitations

**Slot completion is global, not per lane.** `_lane_offset_scheduler_loop` marks
a slot done if `_estimate_offsets_for_date` stored *at least one* lane. Carril-7
works shifts — some days afternoon only — so if it is closed at 09:00 while
Carril-8 has data, the slot is marked done and Carril-7 gets no measurement of
its own until 23:00, inheriting the previous day meanwhile. Harmless (inheritance
costs ~1 s/day) but it means a shift-working lane is effectively measured once a
day. Fix would be per-lane slot bookkeeping.

**The jump alert only catches steps, not acceleration.** It fires on
`|Δt today − Δt yesterday| ≥ 10 s`. A drift that gradually accelerates — say from
1 to 6 s/day — would never trigger it.

**Cardinality dominates the DP objective unconditionally** (§7). The Δt-centred
tie-break mitigates but does not remove this.

**Everything here is mitigation.** The clocks keep drifting; the real fix is NTP
synchronisation on the SP and AVC equipment. When that happens there will be a
step change, which the jump alert covers.
