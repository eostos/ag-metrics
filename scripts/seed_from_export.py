#!/usr/bin/env python
"""
Reconstruye las entradas AVC y SP a partir de un export de conciliación.

El export de `Lane Detail` lleva las dos fuentes y el veredicto en la misma
fila, así que se puede invertir: cada fila MATCH aporta un evento AVC *y* una
transacción SP, cada fila AVC aporta sólo el evento AVC, y las filas SAT y
SP_EXCLUDED aportan sólo la transacción SP. Eso permite volver a alimentar el
sistema con un día real y comparar lo que sale contra lo que salió entonces.

Lo que el export NO lleva y hay que reconstruir: `id_obs_mp`, `id_paiement` y
las columnas de folio del SP. Sólo las dos primeras influyen en la conciliación
—son dos tercios de la regla de exclusión— y se derivan del propio veredicto:
la fila salió como SP_EXCLUDED si y sólo si el motor vio id_obs_mp==30,
id_classe==0 e id_paiement==0. Las demás se dejan vacías; `reconcile()` las lee
con `safe()`, que devuelve "" cuando la columna no existe.

Uso:
    .venv/bin/python scripts/seed_from_export.py test/<export>.xls
"""
from __future__ import annotations

import glob
import html
import json
import os
import re
import sys
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import api  # noqa: E402  (necesita BASE_DIR en sys.path)
from engine import SETTINGS_DB_PATH, load_saved_settings, save_settings  # noqa: E402

SOURCE_NAME = "SIMULACION (export test/)"


# ── Lectura del export ────────────────────────────────────

def parse_export(path: str):
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()

    head = re.search(r"<thead><tr>(.*?)</tr></thead>", raw, re.S)
    body = re.search(r"<tbody>(.*)</tbody>", raw, re.S)
    if not head or not body:
        raise SystemExit(f"No parece un export de conciliación: {path}")

    cols = [html.unescape(c) for c in re.findall(r"<th>(.*?)</th>", head.group(1), re.S)]
    rows = []
    for tr in re.findall(r"<tr>(.*?)</tr>", body.group(1), re.S):
        cells = [
            html.unescape(re.sub(r"<[^>]+>", "", td)).strip()
            for td in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        ]
        if len(cells) == len(cols):
            rows.append(dict(zip(cols, cells)))
    return rows


def _int(value, default=0):
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return default


# ── Reconstrucción de las dos fuentes ─────────────────────

def build_avc(rows):
    """Eventos AVC: filas MATCH (el vehículo se detectó y se cobró) y AVC."""
    out = []
    for r in rows:
        if r["Tipo fila"] not in ("MATCH", "AVC") or not r["AVC hora"]:
            continue
        out.append({
            "event_id": r["AVC ID"],
            "lane_name": r["AVC carril"],
            "vehicle_type": r["AVC tipo vehiculo"],
            "axle_count": _int(r["AVC ejes"], None) if r["AVC ejes"] != "" else None,
            "event_timestamp": r["AVC hora"],
            "event_date": r["AVC hora"][:10],
        })
    return out


def build_sp(rows):
    """Transacciones SP: filas MATCH, SAT y SP_EXCLUDED."""
    out = []
    for r in rows:
        if r["Tipo fila"] not in ("MATCH", "SAT", "SP_EXCLUDED") or not r["SP hora"]:
            continue
        # Único punto donde se inventa dato: la regla de exclusión mira
        # id_obs_mp, id_classe e id_paiement, y el export sólo trae id_classe.
        # El veredicto guardado dice cuál de los dos casos era.
        excluido = r["Tipo fila"] == "SP_EXCLUDED"
        voie = r["SP carril"]
        out.append({
            "voie": voie,
            "date_transaction": r["SP hora"],
            "numero_transaction": r["SP numero"],
            "id_classe": _int(r["SP id_classe"]),
            "tab_id_classe": _int(r["SP tab_id_classe"]),
            "prix_total": _int(r["SP precio"]),
            "id_obs_mp": 30 if excluido else 0,
            "id_paiement": 0 if excluido else 1,
            "id_voie": _int(re.sub(r"\D", "", voie) or 0),
            "id_gare": "TEXCOCO",
        })
    out.sort(key=lambda t: t["date_transaction"])
    return out


# ── Escritura ─────────────────────────────────────────────

def write_merged(sp_rows, day_str):
    """
    Escribe el MERGED del día ACUMULANDO por voie.

    Un MERGED real lleva todos los carriles de la plaza, pero cada export trae
    uno solo. Sobrescribir el archivo dejaría al carril anterior sin sus
    transacciones y lo volvería 100% "AVC sin SP": por eso se conservan las
    voies que ya estuvieran y sólo se reemplazan las que trae este export.
    """
    os.makedirs(api.MERGED_DIR, exist_ok=True)
    path = os.path.join(api.MERGED_DIR, "SAT-TEXCOCO-%s-MERGED.json" % day_str)

    previas = []
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as fh:
                previas = json.load(fh).get("transactions", []) or []
        except Exception:
            previas = []

    voies_nuevas = {t["voie"] for t in sp_rows}
    conservadas = [t for t in previas if t.get("voie") not in voies_nuevas]
    todas = sorted(conservadas + sp_rows, key=lambda t: t["date_transaction"])

    payload = {
        "batchuid": "SAT-TEXCOCO-%s-MERGED" % day_str,
        "sourcesystem": "SATTexcoco",
        "generatedat": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "transactions": todas,
        "processed_batches": ["SEED-FROM-EXPORT-%s" % day_str],
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
    return path, len(conservadas), len(sp_rows)


def seed_db(avc_rows, lanes_voies):
    api._ensure_schema()
    now = api._now()

    with api._db() as c:
        row = c.execute("SELECT id FROM avc_sources WHERE name=?", (SOURCE_NAME,)).fetchone()
        if row:
            source_id = row["id"]
        else:
            cur = c.execute(
                "INSERT INTO avc_sources(name,type,config,enabled,created_at) VALUES(?,?,?,?,?)",
                (SOURCE_NAME, "database", "{}", 1, now),
            )
            source_id = cur.lastrowid

        for e in avc_rows:
            c.execute(
                """
                INSERT OR REPLACE INTO avc_local_events
                (event_id,source_id,event_date,lane_name,vehicle_type,axle_count,
                 event_timestamp,vehicle_image_url,vehicle_image_path,extra_json,synced_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
                """,
                (e["event_id"], source_id, e["event_date"], e["lane_name"],
                 e["vehicle_type"], e["axle_count"], e["event_timestamp"],
                 "", "", "{}", now),
            )

    # El mapeo de carriles es lo que une los dos espacios de nombres: el nombre
    # de dispositivo del AVC y la voie del SP no coinciden nunca por sí solos.
    cfg = load_saved_settings()
    mapping = json.loads(cfg.get("lane_mapping") or "{}")
    mapping.update(lanes_voies)
    cfg["lane_mapping"] = json.dumps(mapping)
    cfg["plaza_name"] = cfg.get("plaza_name") or "Texcoco"
    cfg["timezone"] = cfg.get("timezone") or "America/Mexico_City"
    save_settings(cfg)
    return source_id


def sembrar_export(path):
    rows = parse_export(path)
    avc_rows, sp_rows = build_avc(rows), build_sp(rows)
    if not avc_rows or not sp_rows:
        print("  %-52s SIN DATOS, ignorado" % os.path.basename(path))
        return None

    fecha = avc_rows[0]["event_date"]
    lanes_voies = {r["AVC carril"]: r["SP carril"] for r in rows
                   if r["Tipo fila"] == "MATCH" and r["AVC carril"] and r["SP carril"]}

    _, conservadas, nuevas = write_merged(sp_rows, fecha.replace("-", ""))
    source_id = seed_db(avc_rows, lanes_voies)

    horas_avc = sorted(e["event_timestamp"] for e in avc_rows)
    horas_sp = sorted(t["date_transaction"] for t in sp_rows)
    print("  %-52s %s  %-16s AVC=%-5d SP=%-5d  %s..%s"
          % (os.path.basename(path)[:52], fecha,
             list(lanes_voies) and list(lanes_voies)[0] or "?",
             len(avc_rows), nuevas, horas_avc[0][11:16], horas_avc[-1][11:16]))
    # El corte del export importa: si el SP acaba mucho antes que el AVC, la
    # cola queda sin pareja posible y ensucia cualquier métrica que se saque.
    desfase_cola = (parse_hhmmss(horas_avc[-1]) - parse_hhmmss(horas_sp[-1])) / 60.0
    if desfase_cola > 3:
        print("      ⚠ el AVC sigue %.0f min despues del ultimo SP: dia truncado" % desfase_cola)
    return fecha, source_id, lanes_voies


def parse_hhmmss(ts):
    t = ts.replace("T", " ")[11:19]
    h, m, s = (int(x) for x in t.split(":"))
    return h * 3600 + m * 60 + s


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not args:
        raise SystemExit(__doc__)

    paths = []
    for a in args:
        paths.extend(sorted(glob.glob(a)) if any(c in a for c in "*?[") else [a])
    paths = [p for p in paths if os.path.isfile(p)]
    if not paths:
        raise SystemExit("Ningun archivo coincide con: %s" % " ".join(args))

    print("Sembrando %d export(s)\n" % len(paths))
    print("  %-52s %-11s %-16s %-11s %s" % ("archivo", "fecha", "carril", "conteos", "rango AVC"))
    print("  " + "-" * 104)
    fechas, mapping_total, source_id = set(), {}, None
    for p in paths:
        r = sembrar_export(p)
        if r:
            fechas.add(r[0]); source_id = r[1]; mapping_total.update(r[2])

    print("\nMapeo de carriles: %s" % mapping_total)
    print("SQLite           : %s  (source_id=%s)" % (SETTINGS_DB_PATH, source_id))

    print("\nΔt medido por el pipeline real, por fecha y carril")
    print("  %-12s %-16s %6s %8s %10s %9s %8s" %
          ("fecha", "carril", "Δt", "nitidez", "cobertura", "ventana", "origen"))
    print("  " + "-" * 78)
    for fecha in sorted(fechas):
        api._estimate_offsets_for_date(fecha)
        with api._db() as c:
            filas = c.execute("SELECT * FROM lane_offsets WHERE offset_date=? ORDER BY lane_name",
                              (fecha,)).fetchall()
        if not filas:
            print("  %-12s (sin medicion: muestra insuficiente)" % fecha)
        for o in filas:
            ventana, oper = api._ventana_para_carril(o["lane_name"], fecha)
            fiable = (o["sharpness"] or 0) >= api._OFFSET_MIN_SHARPNESS
            print("  %-12s %-16s %5ss %8s%s %9s%% %8ss %9s"
                  % (fecha, o["lane_name"], o["offset_s"], o["sharpness"],
                     "" if fiable else "!", o["coverage"], ventana,
                     (oper or {}).get("resolved") or "fijo"))
    print("\n  (! = por debajo del umbral de nitidez %s: se hereda el dia anterior)"
          % api._OFFSET_MIN_SHARPNESS)


if __name__ == "__main__":
    main()
