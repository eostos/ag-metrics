#!/usr/bin/env python
"""
Concilia de nuevo un día sembrado y compara el resultado con el veredicto que
traía el export original.

Sirve para dos cosas distintas y conviene no confundirlas:
  - Verificar que la reconstrucción de entradas es fiel (si lo es, los eventos
    que el export ya emparejaba deben volver a emparejarse igual).
  - Detectar cambios de comportamiento del motor desde que se generó el export.

Uso:
    .venv/bin/python scripts/diff_against_export.py <export> [--window N]
"""
from __future__ import annotations

import json
import os
import sys
from collections import Counter, defaultdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import requests  # noqa: E402

from seed_from_export import parse_export  # noqa: E402

API = os.environ.get("AGM_API", "http://127.0.0.1:8081")


def token():
    r = requests.post("%s/api/auth/login" % API, timeout=15,
                      json={"email": "admin@auditec.mx", "password": "admin123"})
    r.raise_for_status()
    return r.json()["token"]


def key_of(row, avc_id_f, tipo_f, sat_date_f, sat_num_f):
    """Identidad estable de una fila: el evento AVC si lo hay, si no la transacción SP."""
    if row[tipo_f] in ("MATCH", "AVC") and row[avc_id_f]:
        return ("avc", str(row[avc_id_f]))
    return ("sp", str(row[sat_date_f]), str(row[sat_num_f]))


def main():
    path = sys.argv[1]
    window = None
    if "--window" in sys.argv:
        window = int(sys.argv[sys.argv.index("--window") + 1])

    export_rows = parse_export(path)
    fecha = next(r["AVC hora"][:10] for r in export_rows if r["AVC hora"])
    lane = next(r["AVC carril"] for r in export_rows if r["AVC carril"])

    body = {"avc_lane": lane, "date": fecha, "source_id": 2}
    if window is not None:
        body["window_s"] = window
    r = requests.post("%s/api/reconcile" % API, json=body, timeout=300,
                      headers={"Authorization": "Bearer %s" % token()})
    r.raise_for_status()
    payload = r.json()
    if "error" in payload:
        raise SystemExit("API error: %s" % payload["error"])

    new_rows = payload["result"]
    summary = payload["summary"]

    old = {key_of(r, "AVC ID", "Tipo fila", "SP hora", "SP numero"): r for r in export_rows}
    new = {key_of(r, "avc_id", "tipo", "sat_date", "sat_numero"): r for r in new_rows}

    print("=" * 72)
    print("Carril %s   fecha %s   ventana=%ss (%s)  Δt=%ss"
          % (lane, fecha, summary.get("windowS"), summary.get("windowFrom"),
             summary.get("offsetS")))
    print("=" * 72)
    print("%-14s %8s %8s" % ("tipo", "export", "ahora"))
    co = Counter(r["Tipo fila"] for r in export_rows)
    cn = Counter(r["tipo"] for r in new_rows)
    for t in ("MATCH", "AVC", "SAT", "SP_EXCLUDED"):
        print("%-14s %8d %8d %s" % (t, co[t], cn[t],
                                    "" if co[t] == cn[t] else "  <-- difiere"))
    print("%-14s %8d %8d" % ("TOTAL", len(export_rows), len(new_rows)))

    solo_export = set(old) - set(new)
    solo_nuevo = set(new) - set(old)
    print("\nfilas sólo en el export: %d    filas sólo ahora: %d"
          % (len(solo_export), len(solo_nuevo)))

    cambios = defaultdict(list)
    pareja_distinta = 0
    for k in set(old) & set(new):
        o, n = old[k], new[k]
        if o["Tipo fila"] != n["tipo"]:
            cambios["%s -> %s" % (o["Tipo fila"], n["tipo"])].append(k)
        elif o["Tipo fila"] == "MATCH" and str(o["SP numero"]) != str(n["sat_numero"]):
            pareja_distinta += 1

    print("\ncambios de veredicto sobre la misma fila:")
    if not cambios:
        print("  ninguno")
    for k, v in sorted(cambios.items(), key=lambda x: -len(x[1])):
        print("  %-28s %4d   ej. %s" % (k, len(v), v[0]))
    print("MATCH que ahora emparejan con OTRA transacción SP: %d" % pareja_distinta)

    print("\nmotivo_no_match ahora:")
    for t in ("AVC", "SAT"):
        c = Counter(r["motivo_no_match"] for r in new_rows if r["tipo"] == t)
        print("  %-12s %s" % (t, dict(c)))

    print("\nresumen: %s" % json.dumps(
        {k: summary[k] for k in ("total", "matched", "avcOnly", "satOnly", "axleErr",
                                 "excluded", "matchRate", "motoAvc", "motoSinCobro",
                                 "motoRate", "matchRateSinMotos") if k in summary},
        indent=2))


if __name__ == "__main__":
    main()
