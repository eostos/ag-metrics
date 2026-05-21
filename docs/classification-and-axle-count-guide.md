# Classification and Axle Count Guide — AUDITEC AVC/SAT

## SAT Vehicle Classification System

The SAT system uses a numeric class code (0–15) to classify vehicles. This is the authoritative classification in the reconciliation context.

### Class Table (Confirmed from engine.py:SAT_DESC, SAT_CODE, SAT_EJES)

| Class ID | Code | Full Name | Expected Axles | Category |
|---------|------|-----------|---------------|----------|
| 0 | - | Clase no definida | 0 | indefinido |
| 1 | A | Auto 2 Ejes | 2 | auto |
| 2 | C2 | Camión 2 Ejes | 2 | truck |
| 3 | C3 | Camión 3 Ejes | 3 | truck |
| 4 | C4 | Camión 4 Ejes | 4 | truck |
| 5 | C5 | Camión 5 Ejes | 5 | truck |
| 6 | C6 | Camión 6 Ejes | 6 | truck |
| 7 | C7 | Camión 7 Ejes | 7 | truck |
| 8 | C8 | Camión 8 Ejes | 8 | truck |
| 9 | C9+ | Camión 9 Ejes o más | 9 | truck |
| 10 | AR1 | Auto 2 Ejes con Remolque 1 Eje | 3 | auto_rem |
| 11 | AR2 | Auto 2 Ejes con Remolque 2 Ejes | 4 | auto_rem |
| 12 | B2 | Autobús 2 Ejes | 2 | bus |
| 13 | B3 | Autobús 3 Ejes | 3 | bus |
| 14 | B4 | Autobús 4 Ejes | 4 | bus |
| 15 | M | Motocicleta | 1 | moto |

### SAT Dual Class Fields

SAT transactions carry **two class fields**:

- `id_classe`: The primary class declared by the toll lane system.
- `tab_id_classe`: A secondary class from a lookup table (may be used when `id_classe` is 0 or for cross-validation).

The reconciliation uses both fields. When `id_classe == 0`, the system falls back to `tab_id_classe` as the effective class. Both fields are compared against the AVC-mapped class.

---

## AVC Vehicle Classification

The AVC system (Alice Guardian) does **not** use SAT class numbers directly. It reports:

- `vehicle_type`: A string describing the vehicle type (e.g., `"truck"`, `"light"`, `"bus"`, `"motorcycle"`).
- `axle_count`: An integer count of axles detected by the sensor.

These are mapped to a SAT class number by `map_avc_class()` in `engine.py:474`.

### AVC Type String Mapping

The mapping uses substring matching (case-insensitive):

| AVC vehicle_type contains | axle_count | → SAT Class |
|--------------------------|-----------|-------------|
| `"motorcycle"` or `"moto"` | any | 15 (Moto) |
| `"light"` or exactly `"auto"` or `"car"` | any | 1 (Auto) |
| `"bus"` | ≤2 | 12 (B2) |
| `"bus"` | 3 | 13 (B3) |
| `"bus"` | ≥4 | 14 (B4) |
| `"truck"` or `"camion"` | ≥9 | 9 (C9+) |
| `"truck"` or `"camion"` | 1–8 | axle count (e.g. 5 → C5) |
| none of the above | 2 | 1 (Auto, fallback) |
| none of the above | ≥9 | 9 (C9+, fallback) |
| none of the above | 1–8 | axle count (truck fallback) |
| axle count is 0 or missing | — | 0 (undefined, causes no-match) |

The result is stored in the reconciliation output as `clase_avc_mapeada`.

---

## Axle Count Comparison Logic

After a time-window match is found, the engine checks whether the AVC axle count is consistent with the expected count for the SAT class.

`compare_ejes(avc_axles, sat_cls, tab_cls)` — `engine.py:530`

Steps:
1. Determine the effective SAT class: `tab_cls if sat_cls == 0 else sat_cls`.
2. Look up expected axles from `SAT_EJES` table.
3. If effective class is 15 (motorcycle): `nota_ejes = "OK_MOTO"` — axles not compared.
4. If `avc_axles == expected`: `nota_ejes = "OK(N=N)"`.
5. Otherwise: `nota_ejes = "ERROR_DETECCION_AVC(AVC:N SAT:M)"`.

The axle comparison result is surfaced in:
- `nota_ejes` field on the result row
- `comparacion_ejes_id` (vs `id_classe`)
- `comparacion_ejes_tab` (vs `tab_id_classe`)
- `axleErr` counter in the reconciliation summary

---

## Class Compatibility

The current engine uses exact class compatibility:

- `avc_cls == 0` is always incompatible.
- A MATCH is valid only when the AVC-mapped class equals SAT `id_classe` or `tab_id_classe`.
- Category-level matching is not currently accepted. For example, AVC class 5 and SAT class 6 are both truck classes, but they are incompatible unless one SAT class field exactly equals 5.

`cat_of()` still exists for diagnostic text, but it does not make classes compatible.

---

## Common Axle Count Issues

| Issue | Symptom | `nota_ejes` |
|-------|---------|-------------|
| AVC sensor miscounts axles | AVC=4, SAT class expects 5 | `ERROR_DETECCION_AVC(AVC:4 SAT:5)` |
| AVC reports 0 axles | Can't map to class | `avc_cls=0`, no match possible |
| SAT uses `tab_id_classe` when `id_classe=0` | Comparison uses tab class | `"tab_exacto(id=0)"` in compat_reason |
| Motorcycle in AVC, no SAT record | SAT may not count motos | `tipo=AVC`, `motivo=moto_detectada_solo_por_avc` |

---

## Unknown / Not Found

- The actual AVC sensor hardware model and its native vehicle_type vocabulary beyond the strings handled in `map_avc_class()` are not documented in this repository.
- No calibration or sensor accuracy documentation was found.
- The LPR/license plate fields (`vehicle_image_url`, `vehicle_image_path`) are stored but no OCR or plate recognition logic exists in this codebase.
- No documentation was found for class codes beyond the 15 defined in `SAT_DESC`. If the SAT system introduces new class codes, the `SAT_DESC`, `SAT_EJES`, `SAT_CODE`, and `cat_of()` function must all be updated.
