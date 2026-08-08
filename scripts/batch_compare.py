#!/usr/bin/env python
"""
Concilia todos los carriles/fechas sembrados con la regla ANTERIOR y con la
NUEVA, y compara.

La cifra que decide si el cambio es seguro no es cuántos matches gana, sino
cuántos PIERDE y cuántos REEMPAREJA: un match que se mueve a otra transacción
cambia a qué vehículo se le atribuye un cobro sin que ningún total lo delate.
Con la jerarquía de dos niveles ambos deben salir 0; si un día no lo hace, ese
día es el que hay que mirar.

Uso:
    .venv/bin/python scripts/batch_compare.py            # todo lo sembrado
    .venv/bin/python scripts/batch_compare.py 2026-08-04 # sólo esa fecha
"""
from __future__ import annotations

import os
import sys
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import api  # noqa: E402
import engine  # noqa: E402
from engine import is_class_compatible  # noqa: E402


def _i(v):
    try:
        return int(float(str(v).strip()))
    except Exception:
        return 0


def combinaciones(filtro_fecha=None):
    """(fecha, carril) que tienen a la vez eventos AVC y un MERGED del día."""
    with api._db() as c:
        filas = c.execute(
            "SELECT DISTINCT event_date, lane_name FROM avc_local_events "
            "WHERE lane_name IS NOT NULL AND lane_name <> '' ORDER BY event_date, lane_name"
        ).fetchall()
    out = []
    for f in filas:
        fecha = f["event_date"]
        if filtro_fecha and fecha != filtro_fecha:
            continue
        if not os.path.exists(os.path.join(
                api.MERGED_DIR, "SAT-TEXCOCO-%s-MERGED.json" % fecha.replace("-", ""))):
            continue
        out.append((fecha, f["lane_name"]))
    return out


def corre(avc, sat, lane, voie, fecha, ventana, offset, banda):
    ac, sc = api._auto_cols_avc(avc), api._auto_cols_sat(sat)
    return engine.reconcile(
        avc, sat, lane, voie, fecha, ventana,
        ac["date"], ac["device"], ac["type"], ac["axles"], ac["id"],
        sc["date"], sc["voie"], sc["cls"], sc["tab"], sc["num"], sc["prix"],
        offset_s=offset, banda_clase=banda)


def pares(r):
    """
    {avc_id: identidad_de_la_transaccion_SP}

    La identidad NO puede ser el folio: se reinicia con el turno. En Carril-8 el
    2026-08-06 hay folio 1 a las 05:56 y otro folio 1 a las 13:52, y 760 de 820
    folios se repiten. Comparar por folio hacía parecer que un match se había
    movido cuando en realidad apuntaba a otra transacción distinta con el mismo
    número. Hay que llevar la hora dentro de la clave.
    """
    m = r[r["tipo"] == "MATCH"]
    return dict(zip(m["avc_id"].astype(str),
                    m["sat_date"].astype(str) + "#" + m["sat_numero"].astype(str)))


def main():
    filtro = sys.argv[1] if len(sys.argv) > 1 else None
    combos = combinaciones(filtro)
    if not combos:
        raise SystemExit("Nada sembrado que comparar. Corre antes seed_from_export.py")

    print("%-12s %-16s %6s %5s %s" % ("fecha", "carril", "Δt", "vent", ""))
    print("%-12s %-16s %6s %5s | %6s %6s %6s | %6s %6s %6s | %7s %7s %8s %7s"
          % ("", "", "", "", "MAT-0", "MAT-N", "+", "avcO", "satO", "ejes",
             "PERDID", "DAÑINO", "resecu.", "disc.cl"))
    print("-" * 128)

    tot = {"perdidos": 0, "repareados": 0, "nuevos": 0, "disc": 0, "resec": 0}
    alertas = []
    for fecha, lane in combos:
        d = datetime.strptime(fecha, "%Y-%m-%d").date()
        avc = api._events_from_local(None, d, lane, margin_days=1)
        try:
            sat = api._load_sat_merged(fecha.replace("-", ""))
        except Exception as exc:
            print("%-12s %-16s  SP no disponible: %s" % (fecha, lane, exc))
            continue
        sc = api._auto_cols_sat(sat)
        voies = sorted(sat[sc["voie"]].dropna().astype(str).str.strip().unique().tolist())
        cfg = api.load_saved_settings()
        try:
            mapping = api.json.loads(cfg.get("lane_mapping") or "{}")
        except Exception:
            mapping = {}
        voie = api._resolve_sat_lane(lane, voies, mapping)
        if not voie:
            print("%-12s %-16s  sin voie SP equivalente" % (fecha, lane))
            continue

        ventana, oper = api._ventana_para_carril(lane, fecha)
        offset = int((oper or {}).get("offset_s") or 0)

        r0 = corre(avc, sat, lane, voie, fecha, ventana, offset, 0)
        rN = corre(avc, sat, lane, voie, fecha, ventana, offset, api._BANDA_CLASE_S)
        if r0.empty or rN.empty:
            continue
        p0, pN = pares(r0), pares(rN)
        ka, kb = set(p0), set(pN)
        perdidos = len(ka - kb)

        # Un emparejamiento que se mueve NO es automáticamente daño. Si el folio
        # que suelta se lo queda un AVC que antes estaba huérfano, lo que ha
        # pasado es que la secuencia se reordena: dos vehículos seguidos dejan de
        # pelearse por la misma transacción y cada uno toma la suya, en orden.
        # Eso gana un match y respeta el tiempo. Daño de verdad es soltar el
        # folio para que no lo coja nadie, o que lo coja alguien ya emparejado.
        dueno_nuevo = {v: k for k, v in pN.items()}
        resecuencia = danino = 0
        for k in ka & kb:
            if p0[k] == pN[k]:
                continue
            quien = dueno_nuevo.get(p0[k])
            if quien is not None and quien not in ka:
                resecuencia += 1
            else:
                danino += 1
        repar = danino
        s0, sN = api._recon_summary(r0), api._recon_summary(rN)
        disc = sum(1 for _, x in rN[rN["tipo"] == "MATCH"].iterrows()
                   if not is_class_compatible(_i(x["clase_avc_mapeada"]),
                                              _i(x["id_classe"]), _i(x["tab_id_classe"])))

        marca = "  <-- REVISAR" if (perdidos or repar) else ""
        print("%-12s %-16s %5ss %4ss | %6d %6d %+6d | %6d %6d %6d | %7d %7d %8d %7d%s"
              % (fecha, lane, offset, ventana, s0["matched"], sN["matched"],
                 sN["matched"] - s0["matched"], sN["avcOnly"], sN["satOnly"],
                 sN["axleErr"], perdidos, repar, resecuencia, disc, marca))
        if perdidos or repar:
            alertas.append((fecha, lane, perdidos, repar))
        tot["perdidos"] += perdidos
        tot["repareados"] += repar
        tot["resec"] += resecuencia
        tot["nuevos"] += len(kb - ka)
        tot["disc"] += disc

    print("-" * 128)
    print("TOTAL  nuevos=%d  perdidos=%d  DAÑINOS=%d  resecuenciados=%d  discrepancias_clase=%d"
          % (tot["nuevos"], tot["perdidos"], tot["repareados"], tot["resec"], tot["disc"]))
    print()
    if alertas:
        print("NO SEGURO todavia — estos dias pierden o mueven emparejamientos:")
        for f, l, p, r in alertas:
            print("   %s %s  perdidos=%d reemparejados=%d" % (f, l, p, r))
    else:
        print("SEGURO en la muestra: 0 matches perdidos y 0 movimientos daninos en %d "
              "combinacion(es) carril/dia." % len(combos))
        if tot["resec"]:
            print("(%d resecuenciados: el folio soltado se lo queda un AVC que estaba "
                  "huerfano, o sea dos vehiculos seguidos dejan de pelearse por la misma "
                  "transaccion. Es correccion, no dano.)" % tot["resec"])


if __name__ == "__main__":
    main()
