#!/usr/bin/env python3
"""
Vigila /home/sftpuser/uploads/ cada minuto.
Fusiona los archivos SAT-TEXCOCO-<HOY>*.json en un archivo diario MERGED
y borra cada archivo fuente despues de incorporarlo.
"""
import glob
import json
import logging
import os
import time
from datetime import datetime

WATCH_DIR   = "/home/sftpuser/uploads"
OUTPUT_DIR  = "/home/sftpuser/uploads/merged"
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
    before = len(merged["transactions"])
    merged["transactions"].extend(txns)
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
        day_str = datetime.now().strftime("%Y%m%d")
        try:
            scan_once(day_str, processed)
        except Exception as exc:
            log.error("Error inesperado en scan: %s", exc)

        time.sleep(POLL_SECS)


if __name__ == "__main__":
    main()
