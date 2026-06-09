# Toll Audit Logic — AG-metrics AVC/SAT

## Business Rules (Confirmed from engine.py)

The reconciliation engine compares AVC events to SAT transactions for the same lane and date. The goal is to determine whether every detected vehicle (AVC) corresponds to a charged toll (SAT), and vice versa.

---

## Time Window Matching

Each AVC event is matched to a SAT transaction using a time window search (binary search for efficiency):

- **Search window:** `[AVC_timestamp - window_s, AVC_timestamp + 30s]`
- **Default window_s:** 120 seconds (configurable per reconciliation request)
- **Direction priority:** SAT events arriving **before** the AVC event are preferred (delta ≤ 0). This reflects the physical reality: the toll gate charges the vehicle (SAT) before or at the moment of AVC detection.
- **Tolerance:** 30 seconds of tolerance for clock skew (AVC arriving slightly before SAT timestamp).

### Candidate Selection

Among all SAT candidates in the window:
1. First, class-compatible candidates are collected.
2. Sorted by: (SAT before AVC = priority 0, SAT after AVC = priority 1), then by `abs(delta)`.
3. The first class-compatible candidate is chosen.

---

## Class Compatibility Rules

`is_class_compatible(avc_cls, sat_cls, tab_cls)` in `engine.py`

A match is considered class-compatible if:
1. `avc_cls == 0` → incompatible (AVC failed to count axles).
2. `sat_cls == avc_cls` → exact match on `id_classe`.
3. `tab_cls == avc_cls` → exact match on `tab_id_classe`.
4. Otherwise → incompatible.

The current engine does not allow category-level compatibility. For example, AVC class 5 and SAT class 6 are both truck classes but are treated as incompatible unless `id_classe` or `tab_id_classe` exactly equals 5.

### Vehicle Categories (cat_of)

`cat_of()` is still used in diagnostic text from `compat_reason()`, but it does not make two classes compatible.

| Category | SAT Classes |
|----------|-------------|
| `moto` | 15 |
| `auto` | 1 |
| `auto_rem` | 10, 11 |
| `bus` | 12, 13, 14 |
| `truck` | 2, 3, 4, 5, 6, 7, 8, 9 |
| `indefinido` | 0 or unrecognized |

---

## AVC to SAT Class Mapping

`map_avc_class(vehicle_type, axles)` in `engine.py:474`

Maps the AVC sensor's output (vehicle_type string + axle_count integer) to a SAT class number:

| Condition | → SAT Class |
|-----------|-------------|
| `vehicle_type` contains `"motorcycle"` or `"moto"` | → 15 (Moto) |
| `vehicle_type` in `["light", "auto", "car"]` | → 1 (Auto) |
| `vehicle_type` contains `"bus"`, axles ≤ 2 | → 12 (B2) |
| `vehicle_type` contains `"bus"`, axles == 3 | → 13 (B3) |
| `vehicle_type` contains `"bus"`, axles ≥ 4 | → 14 (B4) |
| `vehicle_type` contains `"truck"` or `"camion"`, axles ≥ 9 | → 9 (C9+) |
| `vehicle_type` contains `"truck"` or `"camion"` | → axle count (1–8) |
| axles == 2 (fallback) | → 1 (Auto) |
| axles ≥ 9 (fallback) | → 9 (C9+) |
| else | → axle count or 0 |

---

## Axle Count Comparison

`compare_ejes(avc_axles, sat_cls, tab_cls)` in `engine.py:530`

After a MATCH is found, the axle counts are compared:

1. If effective SAT class is motorcycle (15): returns `"OK_MOTO"` — motorcycles are not axle-counted.
2. The effective SAT class is `tab_id_classe` if `id_classe == 0`, otherwise `id_classe`.
3. Expected axles = `SAT_EJES[effective_class]`.
4. If `avc_axles == expected`: returns `"OK(avc=expected)"`.
5. Otherwise: returns `"ERROR_DETECCION_AVC(AVC:{ax} SAT:{expected})"` — flags an axle detection error.

### SAT Expected Axle Counts (SAT_EJES)

| Class | Expected Axles |
|-------|---------------|
| 0 (undefined) | 0 |
| 1 (Auto) | 2 |
| 2 (C2) | 2 |
| 3 (C3) | 3 |
| 4 (C4) | 4 |
| 5 (C5) | 5 |
| 6 (C6) | 6 |
| 7 (C7) | 7 |
| 8 (C8) | 8 |
| 9 (C9+) | 9 |
| 10 (AR1) | 3 |
| 11 (AR2) | 4 |
| 12 (B2) | 2 |
| 13 (B3) | 3 |
| 14 (B4) | 4 |
| 15 (Moto) | 1 |

---

## Result Row Types

Every event in the reconciliation output has a `tipo` field:

| tipo | Meaning | match_valido |
|------|---------|-------------|
| `MATCH` | AVC event matched to a SAT transaction | `True` |
| `AVC` | AVC event with no SAT match in window | `False` |
| `SAT` | SAT transaction with no AVC event | `False` |
| `SP_EXCLUDED` | SAT transaction excluded from reconciliation (non-conciliable system event) | `False` |

`SP_EXCLUDED` rows are generated when a SAT event meets **all three** conditions: `id_obs_mp == 30`, `id_classe == 0`, and `id_paiement == 0`. These represent administrative/system events that are not real vehicle transactions and should not be reconciled against AVC events.

Even `MATCH` rows with axle errors have `match_valido = True`. The axle error is reported in `nota_ejes` and affects the `axleErr` counter in the summary.

---

## Anomaly / Inconsistency Types

| Field | Value | Meaning |
|-------|-------|---------|
| `tipo` | `AVC` | Vehicle detected by AVC but no toll charged (or SAT timeout exceeded) |
| `tipo` | `SAT` | Toll charged but no AVC event found |
| `nota_ejes` | starts with `"ERROR"` | Axle count mismatch between AVC and SAT class |
| `motivo_no_match` | `"error_conteo_avc"` | AVC mapped to class 0 (axle count failed) |
| `motivo_no_match` | `"moto_detectada_solo_por_avc"` | Motorcycle detected by AVC but SAT has no motorcycle record |
| `motivo_no_match` | `"clase_distinta"` | SAT candidates existed in window but class was incompatible |
| `motivo_no_match` | `"SAT_no_detecto"` | No SAT candidates found in the time window |
| `motivo_no_match` | `"moto_SAT_sin_AVC"` | SAT motorcycle charge without AVC detection |
| `motivo_no_match` | `"SAT_clase_indefinida"` | SAT `id_classe == 0` and no `tab_id_classe` |
| `motivo_no_match` | `"AVC_no_detecto"` | SAT transaction with no AVC event in window |
| `motivo_no_match` | `"evento_no_conciliable_obs_mp_30"` | SAT event excluded as non-conciliable (`SP_EXCLUDED` row) |

---

## Summary Metrics

`_recon_summary()` in `api.py:418`:

| Metric | Definition |
|--------|-----------|
| `total` | Conciliable rows only: `len(result) - excluded` (excludes `SP_EXCLUDED`) |
| `matched` | Rows where `match_valido == True` |
| `avcOnly` | Rows where `tipo == "AVC"` and not matched |
| `satOnly` | Rows where `tipo == "SAT"` |
| `axleErr` | Rows where `match_valido == True` and `nota_ejes` starts with `"ERROR"` |
| `excluded` | Rows where `tipo == "SP_EXCLUDED"` (non-conciliable SAT events, not counted in total) |
| `matchRate` | `avc_base / total * 100` where `avc_base = total - satOnly` (AVC detection rate) |

**matchRate** measures what fraction of all vehicle events (AVC + SAT-only) were detected by the AVC system, not what fraction were perfectly matched. `SP_EXCLUDED` rows do not affect this metric.

---

## Unknown / Not Found

- No business rule found for detecting duplicate SAT transactions (same transaction number appearing twice).
- No rule found for flagging transactions outside business hours.
- No minimum match rate threshold is enforced programmatically (visual thresholds in UI: ≥97% green, ≥93% yellow, <93% red — but no automated alerting).
- LPR/license plate data is not part of the reconciliation logic; image URLs are stored but not parsed.
