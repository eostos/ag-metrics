#!/usr/bin/env python3
"""
Vigila /home/sftpuser/uploads/ cada minuto.
Fusiona los archivos SAT-TEXCOCO-<YYYYMMDD>*.json en el MERGED diario
que consume la API y borra cada archivo fuente despues de incorporarlo.
"""
import glob
import json
import logging
import os
import time
from datetime import datetime, timedelta

WATCH_DIR   = "/home/sftpuser/uploads"
OUTPUT_DIR  = os.path.expanduser("~/sat_merged")
POLL_SECS   = 60  # intervalo entre escaneos

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


def load_json_safe(filepath: str):
    """Lee un JSON tolerando CRLF embebidos en los archivos SAT."""
    with open(filepath, "rb") as fh:
        raw = fh.read()
    raw = raw.replace(b',"\r\n,"', b',"')
    raw = raw.replace(b"\r\n", b"").replace(b"\r", b"")
    text = raw.decode("utf-8", errors="replace").strip()
    if not text:
        return None
    return json.loads(text)


def merged_path(day_str: str) -> str:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    return os.path.join(OUTPUT_DIR, f"SAT-TEXCOCO-{day_str}-MERGED.json")


def load_merged(day_str: str) -> dict:
    path = merged_path(day_str)
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except Exception as exc:
            log.warning("No se pudo leer el MERGED existente (%s): %s", path, exc)
    return {
        "batchuid": f"SAT-TEXCOCO-{day_str}-MERGED",
        "sourcesystem": "SATTexcoco",
        "generatedat": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "transactions": [],
        "processed_batches": [],
    }


def save_merged(day_str: str, merged: dict) -> None:
    merged["generatedat"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    path = merged_path(day_str)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(merged, fh, ensure_ascii=False)
    os.replace(tmp, path)


def process_file(filepath: str, day_str: str) -> bool:
    """Incorpora las transacciones del archivo al MERGED del dia. Retorna True si tuvo exito."""
    try:
        data = load_json_safe(filepath)
    except Exception as exc:
        log.error("Error leyendo %s: %s", os.path.basename(filepath), exc)
        return False

    if data is None:
        log.warning("Archivo vacio, ignorando: %s", os.path.basename(filepath))
        return True

    txns = data.get("transactions", [])
    if not isinstance(txns, list):
        log.warning("Campo 'transactions' no es lista en %s", os.path.basename(filepath))
        return True

    merged = load_merged(day_str)
    batch_id = data.get("batchuid", os.path.splitext(os.path.basename(filepath))[0])
    processed_batches = set(merged.get("processed_batches", []))
    if batch_id in processed_batches:
        log.info("Lote ya incorporado, borrando duplicado: %s", os.path.basename(filepath))
        return True

    before = len(merged["transactions"])
    merged["transactions"].extend(txns)
    processed_batches.add(batch_id)
    merged["processed_batches"] = sorted(processed_batches)
    save_merged(day_str, merged)

    log.info(
        "%-45s  +%d txns  (total dia: %d)",
        os.path.basename(filepath),
        len(txns),
        len(merged["transactions"]),
    )
    return True


def scan_once(day_str: str, processed: set) -> None:
    pattern = os.path.join(WATCH_DIR, f"SAT-TEXCOCO-{day_str}*.json")
    candidates = sorted(glob.glob(pattern))

    # Excluir el propio archivo MERGED si estuviera en WATCH_DIR
    candidates = [
        p for p in candidates
        if not os.path.basename(p).endswith("-MERGED.json")
        and p not in processed
    ]

    for filepath in candidates:
        ok = process_file(filepath, day_str)
        if ok:
            processed.add(filepath)
            try:
                os.remove(filepath)
                log.info("Borrado: %s", os.path.basename(filepath))
            except Exception as exc:
                log.warning("No se pudo borrar %s: %s", os.path.basename(filepath), exc)


def main() -> None:
    log.info("SAT Watcher iniciado. Vigilando: %s", WATCH_DIR)
    log.info("Salida MERGED en: %s", OUTPUT_DIR)
    log.info("Intervalo de escaneo: %ds", POLL_SECS)

    processed: set = set()

    while True:
        now = datetime.now()
        day_strs = [
            now.strftime("%Y%m%d"),
            (now - timedelta(days=1)).strftime("%Y%m%d"),
        ]
        try:
            for day_str in day_strs:
                scan_once(day_str, processed)
        except Exception as exc:
            log.error("Error inesperado en scan: %s", exc)

        time.sleep(POLL_SECS)


if __name__ == "__main__":
    main()
