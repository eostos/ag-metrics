"""
AG-metrics — FastAPI backend
Soporta dos tipos de integración AVC:
  - 'database': PostgreSQL via SSH (usa engine.py)
  - 'api':      Alice Guardian REST API
Los eventos se almacenan localmente en SQLite para acceso rápido.
Run: uvicorn api:app --host 0.0.0.0 --port 8080 --reload
"""
from __future__ import annotations

import asyncio
import base64
import glob
import hashlib
import fcntl
import json
import os
import re
import secrets
import sqlite3
import smtplib
import ssl
import textwrap
import threading
import time
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import pandas as pd
import requests as _requests
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from engine import (
    SETTINGS_DB_PATH,
    detect_col,
    fetch_avc_dataframe,
    fetch_remote_image_bytes,
    get_event_tz,
    ensure_settings_db,
    load_saved_settings,
    parse_date,
    reconcile,
    save_settings,
)

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
MERGED_DIR = os.path.expanduser("~/sat_merged")
WATCH_DIR  = "/home/sftpuser/uploads"

app = FastAPI(title="AG-metrics API", docs_url="/api/docs")

# ─────────────────────────────────────────────────────────
# Esquema SQLite
# ─────────────────────────────────────────────────────────

def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(SETTINGS_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_schema() -> None:
    with _db() as c:
        c.executescript("""
        -- Usuarios y sesiones
        CREATE TABLE IF NOT EXISTS auditec_users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            email         TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role          TEXT NOT NULL DEFAULT 'Auditor',
            status        TEXT NOT NULL DEFAULT 'Active',
            last_login    TEXT,
            created_at    TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS auditec_sessions (
            token      TEXT PRIMARY KEY,
            user_id    INTEGER NOT NULL,
            expires_at TEXT NOT NULL
        );

        -- Fuentes AVC (API o base de datos)
        CREATE TABLE IF NOT EXISTS avc_sources (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            type       TEXT NOT NULL DEFAULT 'database',  -- 'database' | 'api'
            config     TEXT NOT NULL DEFAULT '{}',        -- JSON con credenciales
            enabled    INTEGER NOT NULL DEFAULT 1,
            last_sync  TEXT,
            created_at TEXT NOT NULL
        );

        -- Eventos AVC almacenados localmente
        CREATE TABLE IF NOT EXISTS avc_local_events (
            event_id          TEXT NOT NULL,
            source_id         INTEGER NOT NULL,
            event_date        TEXT NOT NULL,
            lane_name         TEXT,
            vehicle_type      TEXT,
            axle_count        INTEGER,
            event_timestamp   TEXT,
            vehicle_image_url TEXT,
            vehicle_image_path TEXT,
            extra_json        TEXT,
            synced_at         TEXT NOT NULL,
            PRIMARY KEY (event_id, source_id)
        );

        -- Cache de conciliación
        CREATE TABLE IF NOT EXISTS recon_cache (
            cache_key    TEXT PRIMARY KEY,
            result_json  TEXT NOT NULL,
            summary_json TEXT NOT NULL,
            source_id    INTEGER,
            created_at   TEXT NOT NULL
        );
        """)

        # Migración: añadir source_id a recon_cache si la tabla existía sin ella
        try:
            c.execute("ALTER TABLE recon_cache ADD COLUMN source_id INTEGER")
        except Exception:
            pass  # ya existe

        # Seed admin
        if not c.execute("SELECT COUNT(*) FROM auditec_users").fetchone()[0]:
            c.execute(
                "INSERT INTO auditec_users(name,email,password_hash,role,status,created_at)"
                " VALUES(?,?,?,?,?,?)",
                ("Administrador","admin@auditec.mx",_hash("admin123"),"Admin","Active",_now()),
            )

        # Migrar configuración existente de app_settings a avc_sources si no existe ninguna fuente
        if not c.execute("SELECT COUNT(*) FROM avc_sources").fetchone()[0]:
            settings = load_saved_settings()
            if settings.get("ssh_host") or settings.get("postgres_host"):
                c.execute(
                    "INSERT INTO avc_sources(name,type,config,enabled,created_at) VALUES(?,?,?,?,?)",
                    ("AVC Principal (DB)", "database", json.dumps(settings), 1, _now()),
                )


# ─────────────────────────────────────────────────────────
# Helpers de autenticación
# ─────────────────────────────────────────────────────────

def _hash(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

def _now() -> str:
    return datetime.now().isoformat()

def _create_session(user_id: int) -> str:
    token   = secrets.token_urlsafe(32)
    expires = (datetime.now() + timedelta(hours=24)).isoformat()
    with _db() as c:
        c.execute("INSERT INTO auditec_sessions(token,user_id,expires_at) VALUES(?,?,?)",
                  (token, user_id, expires))
    return token

def _get_user(request: Request) -> Dict:
    token = request.headers.get("Authorization","").replace("Bearer ","").strip()
    if not token:
        raise HTTPException(401, "No autenticado")
    with _db() as c:
        row = c.execute(
            """SELECT u.id,u.name,u.email,u.role,u.status
               FROM auditec_sessions s JOIN auditec_users u ON u.id=s.user_id
               WHERE s.token=? AND s.expires_at>?""",
            (token, _now()),
        ).fetchone()
    if not row:
        raise HTTPException(401, "Sesión expirada")
    return dict(row)

def _require_admin(user=Depends(_get_user)):
    if user["role"] != "Admin":
        raise HTTPException(403, "Solo administradores")
    return user


# ─────────────────────────────────────────────────────────
# Integración tipo 'database' (engine.py + SSH + PostgreSQL)
# ─────────────────────────────────────────────────────────

def _fetch_from_database(source_config: Dict, event_date: date,
                          lane: Optional[str] = None) -> pd.DataFrame:
    """Usa fetch_avc_dataframe de engine.py con la config de la fuente."""
    return fetch_avc_dataframe(source_config, event_date, lane)


# ─────────────────────────────────────────────────────────
# Integración tipo 'api' (Alice Guardian REST API)
# ─────────────────────────────────────────────────────────

def _fetch_from_api(source_config: Dict, event_date: date,
                    lane: Optional[str] = None) -> pd.DataFrame:
    """
    Conecta con la API REST de Alice Guardian y devuelve un DataFrame
    con el mismo esquema que fetch_avc_dataframe.
    Config esperada:
      api_url      : URL base, ej. https://alice-server:8080
      api_key      : token/api-key
      auth_type    : 'bearer' | 'api-key' | 'basic'
      api_user     : usuario (si auth_type='basic')
      api_password : contraseña (si auth_type='basic')
      events_path  : path del endpoint, ej. /api/v1/events  (default: /api/v1/events)
      date_param   : nombre del parámetro de fecha inicio (default: from)
      date_end_param: nombre del parámetro de fecha fin   (default: to)
      lane_param   : nombre del parámetro de carril       (default: lane)
      -- Mapeo de campos de respuesta a campos internos --
      field_id         : (default: id)
      field_lane       : (default: lane_name)
      field_type       : (default: vehicle_type)
      field_axles      : (default: axle_count)
      field_timestamp  : (default: created_at)
      field_image_url  : (default: vehicle_image_url)
      field_image_path : (default: vehicle_image_path)
      events_key       : clave JSON que contiene el array (default: data  o raíz si es array)
    """
    base_url    = source_config.get("api_url","").rstrip("/")
    api_key     = source_config.get("api_key","")
    auth_type   = source_config.get("auth_type","bearer").lower()
    events_path = source_config.get("events_path", "/api/v1/events")
    date_param  = source_config.get("date_param", "from")
    date_end    = source_config.get("date_end_param", "to")
    lane_param  = source_config.get("lane_param", "lane")

    day_str = event_date.isoformat()
    end_str = (event_date + timedelta(days=1)).isoformat()

    params: Dict[str, str] = {date_param: day_str, date_end: end_str}
    if lane:
        params[lane_param] = lane

    # Auth headers
    headers: Dict[str, str] = {"Accept": "application/json"}
    if auth_type == "bearer":
        headers["Authorization"] = f"Bearer {api_key}"
    elif auth_type == "api-key":
        headers["X-API-Key"] = api_key
    # basic auth handled via requests auth= parameter

    auth = None
    if auth_type == "basic":
        auth = (source_config.get("api_user",""), source_config.get("api_password",""))

    verify_ssl = source_config.get("verify_ssl", True)

    resp = _requests.get(
        base_url + events_path,
        params=params,
        headers=headers,
        auth=auth,
        timeout=30,
        verify=verify_ssl,
    )
    resp.raise_for_status()
    raw = resp.json()

    # Extraer array de eventos
    events_key = source_config.get("events_key", "")
    if isinstance(raw, list):
        events = raw
    elif events_key and isinstance(raw.get(events_key), list):
        events = raw[events_key]
    else:
        # Buscar primer campo que sea lista
        events = next((v for v in raw.values() if isinstance(v, list)), [])

    if not events:
        return pd.DataFrame()

    # Mapear campos al esquema interno
    fm = {
        "id":                source_config.get("field_id",          "id"),
        "lane_name":         source_config.get("field_lane",        "lane_name"),
        "vehicle_type":      source_config.get("field_type",        "vehicle_type"),
        "axle_count":        source_config.get("field_axles",       "axle_count"),
        "event_mexico":      source_config.get("field_timestamp",   "created_at"),
        "vehicle_image_url": source_config.get("field_image_url",   "vehicle_image_url"),
        "vehicle_image_path":source_config.get("field_image_path",  "vehicle_image_path"),
    }

    rows = []
    for ev in events:
        row: Dict[str, Any] = {}
        for internal, external in fm.items():
            row[internal] = ev.get(external) or ev.get(internal)
        # Preservar campos extra
        row["created_at_mexico"] = row.get("event_mexico")
        row["device_with_lane"]  = row.get("lane_name")
        rows.append(row)

    return pd.DataFrame(rows)


# ─────────────────────────────────────────────────────────
# Fetch unificado + almacenamiento local
# ─────────────────────────────────────────────────────────

def _fetch_and_store(source_id: int, source_type: str, source_config: Dict,
                     event_date: date, lane: Optional[str] = None) -> pd.DataFrame:
    """
    Llama al fetcher correspondiente al tipo de fuente y almacena
    los eventos en avc_local_events.
    """
    if source_type == "api":
        df = _fetch_from_api(source_config, event_date, lane)
    else:
        df = _fetch_from_database(source_config, event_date, lane)

    if df.empty:
        return df

    date_str  = event_date.isoformat()
    synced_at = _now()
    ac = _auto_cols_avc(df)

    with _db() as c:
        for _, row in df.iterrows():
            event_id = str(row.get(ac["id"], "") or row.get("id", ""))
            if not event_id:
                continue
            lane_val  = str(row.get(ac["device"], "") or "")
            vtype     = str(row.get(ac["type"],   "") or "")
            axles_val = row.get(ac["axles"])
            ts        = str(row.get(ac["date"],   "") or "")
            img_url   = str(row.get("vehicle_image_url",  "") or "")
            img_path  = str(row.get("vehicle_image_path", "") or "")
            extra     = json.dumps({k: str(v) for k, v in row.items()
                                    if k not in (ac["id"],"id",ac["device"],ac["type"],
                                                 ac["axles"],ac["date"],
                                                 "vehicle_image_url","vehicle_image_path")})
            try:
                axles_int = int(float(axles_val)) if axles_val and str(axles_val) not in ("","nan") else None
            except Exception:
                axles_int = None

            c.execute("""
                INSERT OR REPLACE INTO avc_local_events
                (event_id,source_id,event_date,lane_name,vehicle_type,axle_count,
                 event_timestamp,vehicle_image_url,vehicle_image_path,extra_json,synced_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
            """, (event_id, source_id, date_str, lane_val, vtype, axles_int,
                  ts, img_url, img_path, extra, synced_at))

        c.execute("UPDATE avc_sources SET last_sync=? WHERE id=?", (synced_at, source_id))
        # Invalidar caché de conciliación para esta fecha: los timestamps pueden haber cambiado
        # Así la próxima apertura de un carril re-concilia con los datos corregidos
        c.execute("DELETE FROM recon_cache WHERE cache_key LIKE ?", (f"%::{date_str}",))

    return df


def _events_from_local(source_id: Optional[int], event_date: date,
                        lane: Optional[str] = None) -> pd.DataFrame:
    """Devuelve eventos desde avc_local_events (ya sincronizados)."""
    date_str = event_date.isoformat()
    with _db() as c:
        if source_id:
            base = "SELECT * FROM avc_local_events WHERE source_id=? AND event_date=?"
            args: list = [source_id, date_str]
        else:
            base = "SELECT * FROM avc_local_events WHERE event_date=?"
            args = [date_str]
        if lane:
            base += " AND lane_name=?"
            args.append(lane)
        rows = c.execute(base, args).fetchall()

    if not rows:
        return pd.DataFrame()

    records = []
    for r in rows:
        rec = dict(r)
        extra = json.loads(rec.pop("extra_json", "{}") or "{}")
        rec.update(extra)
        rec["id"]                = rec.pop("event_id", "")
        rec["created_at_mexico"] = rec.get("event_timestamp","")
        rec["event_mexico"]      = rec.get("event_timestamp","")
        rec["device_with_lane"]  = rec.get("lane_name","")
        records.append(rec)
    return pd.DataFrame(records)


# ─────────────────────────────────────────────────────────
# Helpers de columnas y conciliación
# ─────────────────────────────────────────────────────────

def _auto_cols_avc(df: pd.DataFrame) -> Dict[str, str]:
    cols = df.columns.tolist()
    return {
        "date":   detect_col(cols, [r"^event_mexico$",r"created_at_mexico",r"event_timestamp",r"date|time|hora|fecha"]) or "",
        "device": detect_col(cols, [r"^lane_name$",r"^device_with_lane$",r"device|carril|lane"]) or "",
        "type":   detect_col(cols, [r"vehicle_type|tipo|type"]) or "",
        "axles":  detect_col(cols, [r"axle_count|ejes|axle"]) or "",
        "id":     detect_col(cols, [r"^id$"]) or (cols[0] if cols else ""),
    }

def _auto_cols_sat(df: pd.DataFrame) -> Dict[str, str]:
    cols = df.columns.tolist()
    return {
        "date":  detect_col(cols, [r"^date_transaction$",r"date|time|hora|fecha"]) or "",
        "voie":  detect_col(cols, [r"^voie$",r"voie|carril|lane"]) or "",
        "cls":   detect_col(cols, [r"^id_classe$",r"id_class"]) or "",
        "tab":   detect_col(cols, [r"tab_id_classe",r"tab.*class"]) or "",
        "num":   detect_col(cols, [r"numero_transaction",r"numero|number|trans"]) or "",
        "prix":  detect_col(cols, [r"prix_total",r"price|precio|prix"]) or "",
    }

def _load_sat_merged(day_str: str) -> pd.DataFrame:
    mp = os.path.join(MERGED_DIR, f"SAT-TEXCOCO-{day_str}-MERGED.json")
    if not os.path.exists(mp):
        raise FileNotFoundError(f"SAT MERGED no encontrado: {mp}")
    with open(mp, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    txns = data.get("transactions", [])
    if not txns:
        raise ValueError("El archivo SAT MERGED no tiene transacciones")
    return pd.DataFrame(txns)

def _recon_summary(result: pd.DataFrame) -> Dict:
    total    = len(result)
    matched  = int(result["match_valido"].sum())
    avc_only = int(((result["tipo"]=="AVC") & ~result["match_valido"]).sum())
    sat_only = int((result["tipo"]=="SAT").sum())
    axle_err = int((result["match_valido"] &
                    result["nota_ejes"].astype(str).str.startswith("ERROR",na=False)).sum())
    avc_base = max(total - sat_only, 1)   # AVC events (matched + avc_only)
    # Tasa de detección = AVC eventos / (AVC eventos + SAT-sin-AVC) = avc_base / total
    detect_rate = round(avc_base / max(total, 1) * 100, 1)
    return {"total":total,"matched":matched,"avcOnly":avc_only,
            "satOnly":sat_only,"axleErr":axle_err,
            "matchRate":detect_rate}

def _cache_key(lane: str, fecha: str, source_id: int = 0) -> str:
    return f"{source_id}::{lane}::{fecha}"

def _save_cache(lane: str, fecha: str, result: pd.DataFrame, summary: Dict, source_id: int = 0) -> None:
    key = _cache_key(lane, fecha, source_id)
    with _db() as c:
        c.execute("INSERT OR REPLACE INTO recon_cache(cache_key,result_json,summary_json,source_id,created_at) VALUES(?,?,?,?,?)",
                  (key, result.fillna("").astype(str).to_json(orient="records"),
                   json.dumps(summary), source_id, _now()))

def _load_cache(lane: str, fecha: str, source_id: int = 0):
    with _db() as c:
        row = c.execute("SELECT result_json,summary_json FROM recon_cache WHERE cache_key=?",
                        (_cache_key(lane, fecha, source_id),)).fetchone()
    if not row:
        return None, None
    return json.loads(row["result_json"]), json.loads(row["summary_json"])


def _get_app_setting_json(key: str, default: Any) -> Any:
    ensure_settings_db()
    with _db() as c:
        row = c.execute("SELECT setting_value FROM app_settings WHERE setting_key=?", (key,)).fetchone()
    if not row:
        return default
    try:
        return json.loads(row["setting_value"])
    except Exception:
        return default


def _set_app_setting_json(key: str, value: Any) -> None:
    ensure_settings_db()
    with _db() as c:
        c.execute(
            "INSERT OR REPLACE INTO app_settings(setting_key,setting_value,updated_at) VALUES(?,?,?)",
            (key, json.dumps(value), _now()),
        )


def _setting_list(key: str) -> List[Dict[str, Any]]:
    value = _get_app_setting_json(key, [])
    return value if isinstance(value, list) else []


def _save_setting_list(key: str, rows: List[Dict[str, Any]]) -> None:
    _set_app_setting_json(key, rows)


def _next_row_id(rows: List[Dict[str, Any]]) -> int:
    return max([int(r.get("id") or 0) for r in rows] or [0]) + 1


def _upsert_setting_row(key: str, body: Dict[str, Any]) -> Dict[str, Any]:
    rows = _setting_list(key)
    now = _now()
    if body.get("id"):
        row_id = int(body["id"])
        updated = None
        new_rows = []
        for row in rows:
            if int(row.get("id") or 0) == row_id:
                updated = {**row, **body, "id": row_id, "updated_at": now}
                new_rows.append(updated)
            else:
                new_rows.append(row)
        if updated is None:
            updated = {**body, "id": row_id, "created_at": now, "updated_at": now}
            new_rows.append(updated)
        rows = new_rows
    else:
        updated = {**body, "id": _next_row_id(rows), "created_at": now, "updated_at": now}
        rows.append(updated)
    _save_setting_list(key, rows)
    return updated


def _append_setting_row(key: str, body: Dict[str, Any], limit: int = 500) -> Dict[str, Any]:
    rows = _setting_list(key)
    row = {**body, "id": _next_row_id(rows), "created_at": body.get("created_at") or _now()}
    rows.insert(0, row)
    _save_setting_list(key, rows[:limit])
    return row


def _record_notification(kind: str, related: str, subject: str, recipients: List[str],
                         status: str, error: str = "") -> Dict[str, Any]:
    return _append_setting_row("notification_history", {
        "date_time": _now(),
        "type": kind,
        "related": related,
        "subject": subject,
        "recipients": recipients,
        "status": status,
        "error": error,
    })


def _record_report_history(name: str, period: str, recipients: List[str],
                           status: str, pdf_file: str = "", error: str = "") -> Dict[str, Any]:
    return _append_setting_row("report_history", {
        "date_time": _now(),
        "report_name": name,
        "period": period,
        "recipients": recipients,
        "status": status,
        "pdf_file": pdf_file,
        "error": error,
    })


def _default_report_email_settings() -> Dict[str, Any]:
    cfg = load_saved_settings()
    return {
        "smtp": {
            "host": "",
            "port": 587,
            "security": "TLS",
            "username": "",
            "password": "",
            "from_email": "",
            "from_name": "AG-metrics",
        },
        "recipients": [],
        "schedule": {
            "daily_enabled": False,
            "daily_time": "07:00",
            "weekly_enabled": False,
            "weekly_day": "monday",
            "weekly_time": "07:00",
            "timezone": cfg.get("timezone") or "America/Mexico_City",
        },
    }


def _report_email_settings() -> Dict[str, Any]:
    base = _default_report_email_settings()
    saved = _get_app_setting_json("report_email_settings", {})
    if isinstance(saved, dict):
        for section in ("smtp", "schedule"):
            base[section].update(saved.get(section) or {})
        if isinstance(saved.get("recipients"), list):
            base["recipients"] = saved["recipients"]
    return base


def _report_pdf_bytes(title: str, report: Dict[str, Any]) -> bytes:
    totals = report.get("totals") or {}
    lines = [
        title,
        f"Periodo: {report.get('date_from')} a {report.get('date_to')}",
        f"Fuente: {report.get('source', 'recon_cache')}",
        "",
        "Indicadores globales",
        f"Total eventos: {totals.get('total', 0)}",
        f"Coincidencias: {totals.get('matched', 0)}",
        f"AVC sin SAT: {totals.get('avcOnly', 0)}",
        f"SAT sin AVC: {totals.get('satOnly', 0)}",
        f"Errores ejes: {totals.get('axleErr', 0)}",
        f"Tasa deteccion: {totals.get('matchRate', 0)}%",
        f"Discrepancias: {totals.get('discrepancyCount', 0)} ({totals.get('discrepancyRate', 0)}%)",
        "",
        "Motivos principales",
    ]
    for item in (report.get("motive_breakdown") or [])[:10]:
        lines.append(f"- {item.get('motivo')}: {item.get('count')}")
    lines.extend(["", "Peores carriles/dias"])
    for row in (report.get("worst_rows") or [])[:10]:
        lines.append(
            f"- {row.get('date')} {row.get('lane')}: {row.get('discrepancyRate')}% "
            f"({row.get('discrepancyCount')} casos)"
        )
    lines.extend(["", "Resumen por carril"])
    for row in (report.get("rows") or [])[:18]:
        lines.append(
            f"{row.get('date')} | {row.get('lane')} | total {row.get('total')} | "
            f"match {row.get('matchRate')}% | AVC {row.get('avcOnly')} | SAT {row.get('satOnly')} | ejes {row.get('axleErr')}"
        )

    wrapped: List[str] = []
    for line in lines:
        wrapped.extend(textwrap.wrap(str(line), width=92) or [""])
    wrapped = wrapped[:58]

    content_lines = ["BT", "/F1 10 Tf", "50 790 Td", "14 TL"]
    for line in wrapped:
        safe = str(line).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        content_lines.append(f"({safe}) Tj")
        content_lines.append("T*")
    content_lines.append("ET")
    stream = "\n".join(content_lines).encode("latin-1", errors="replace")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for idx, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf.extend(f"{idx} 0 obj\n".encode())
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")
    xref = len(pdf)
    pdf.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode())
    for off in offsets[1:]:
        pdf.extend(f"{off:010d} 00000 n \n".encode())
    pdf.extend(f"trailer << /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(pdf)


def _html_escape(value: Any) -> str:
    return (
        str(value if value is not None else "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _report_rows_for_type(rows: List[Dict[str, Any]], report_type: str) -> List[Dict[str, Any]]:
    if report_type == "Axle Count Discrepancy Report":
        return [r for r in rows if int(r.get("axleErr") or 0) > 0]
    if report_type == "Vehicle Classification Mismatch Report":
        return [r for r in rows if int(r.get("classMismatch") or 0) > 0]
    if report_type == "Possible Evasion Report":
        return [r for r in rows if int(r.get("satOnly") or 0) > 0 or int(r.get("avcOnly") or 0) > 0]
    return rows


def _designed_report_html_bytes(form: Dict[str, Any], report: Dict[str, Any]) -> bytes:
    lanes = form.get("lanes") if isinstance(form.get("lanes"), list) else []
    rows = [
        r for r in report.get("rows", [])
        if not lanes or r.get("lane") in lanes
    ]
    rows = _report_rows_for_type(rows, form.get("type") or "")
    totals = {
        "total": sum(int(r.get("total") or 0) for r in rows),
        "matched": sum(int(r.get("matched") or 0) for r in rows),
        "avcOnly": sum(int(r.get("avcOnly") or 0) for r in rows),
        "satOnly": sum(int(r.get("satOnly") or 0) for r in rows),
        "axleErr": sum(int(r.get("axleErr") or 0) for r in rows),
        "classMismatch": sum(int(r.get("classMismatch") or 0) for r in rows),
    }
    totals["discrepancy"] = totals["avcOnly"] + totals["satOnly"] + totals["axleErr"]
    totals["matchRate"] = round((totals["total"] - totals["satOnly"]) / max(totals["total"], 1) * 100, 1)
    max_total = max([int(r.get("total") or 0) for r in rows] or [1])
    logo_data = ""
    logo_path = os.path.join(BASE_DIR, "frontend", "logo.jpeg")
    try:
        with open(logo_path, "rb") as fh:
            logo_data = "data:image/jpeg;base64," + base64.b64encode(fh.read()).decode("ascii")
    except Exception:
        logo_data = "/logo.jpeg"

    def n(value: Any) -> str:
        try:
            return f"{int(value):,}"
        except Exception:
            return str(value or 0)

    chart_rows = []
    for r in rows[:12]:
        total = max(int(r.get("total") or 0), 1)
        row_width = max(8, round(int(r.get("total") or 0) / max(max_total, 1) * 100))
        def seg(key: str) -> int:
            value = int(r.get(key) or 0)
            return max(4 if value else 0, round(value / total * 100))
        chart_rows.append(
            f"""<div class="bar-row">
              <div class="bar-label"><strong>{_html_escape(r.get('lane'))}</strong><span>{_html_escape(r.get('date'))}</span></div>
              <div class="bar-shell" style="width:{row_width}%">
                <div class="seg matched" style="width:{seg('matched')}%"></div>
                <div class="seg avc" style="width:{seg('avcOnly')}%"></div>
                <div class="seg sat" style="width:{seg('satOnly')}%"></div>
                <div class="seg axle" style="width:{seg('axleErr')}%"></div>
              </div>
              <strong>{n(r.get('total'))}</strong>
            </div>"""
        )
    table_rows = "\n".join(
        f"""<tr><td>{_html_escape(r.get('date'))}</td><td>{_html_escape(r.get('lane'))}</td><td>{n(r.get('total'))}</td>
        <td>{n(r.get('matched'))}</td><td>{n(r.get('avcOnly'))}</td><td>{n(r.get('satOnly'))}</td>
        <td>{n(r.get('axleErr'))}</td><td>{_html_escape(r.get('discrepancyRate') or 0)}%</td></tr>"""
        for r in rows[:40]
    )
    html = f"""<!doctype html><html><head><meta charset="utf-8"/><title>{_html_escape(form.get('name') or form.get('type') or 'AG-metrics Report')}</title>
<style>
*{{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}body{{font-family:Arial,Helvetica,sans-serif;color:#111827;margin:0;background:#f3f6fb}}.page{{max-width:1080px;margin:0 auto;background:#fff;min-height:100vh;padding:30px 34px 36px}}.header{{display:grid;grid-template-columns:170px 1fr auto;gap:22px;align-items:center;border-bottom:3px solid #111827;padding-bottom:20px}}.logo-box{{border:1px solid #dbe3ef;border-radius:10px;padding:12px;background:#fff;display:flex;align-items:center;justify-content:center;min-height:86px}}.logo{{max-width:138px;max-height:64px;object-fit:contain}}.brand{{font-size:11px;text-transform:uppercase;letter-spacing:1.4px;color:#64748b;font-weight:700}}h1{{margin:5px 0 6px;font-size:25px}}.meta{{color:#64748b;font-size:12px;line-height:1.55}}.badge{{display:inline-block;background:#eaf1ff;color:#2f5fb7;border:1px solid #c7d8ff;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:700}}.kpis{{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:18px 0}}.kpi{{border:1px solid #dbe3ef;border-radius:10px;padding:12px;background:#fff}}.kpi span{{display:block;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.5px}}.kpi strong{{display:block;font-size:22px;margin-top:5px}}.good strong{{color:#14965a}}.warn strong{{color:#b88900}}.bad strong{{color:#d92d53}}.info strong{{color:#2f5fb7}}.summary{{display:grid;grid-template-columns:1.2fr .8fr;gap:14px;margin:18px 0}}.summary-card{{border:1px solid #dbe3ef;border-radius:10px;padding:13px 15px;background:#fbfdff}}.summary-card h2{{font-size:13px;margin:0 0 8px}}.summary-card p{{margin:4px 0;color:#475569;font-size:12px}}.section{{margin-top:24px;border:1px solid #dbe3ef;border-radius:10px;padding:16px;background:#fff}}.section h2{{font-size:15px;margin:0 0 12px}}.legend{{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px;font-size:11px;color:#475569}}.dot{{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px}}.matched-dot{{background:#22c97b}}.avc-dot{{background:#ff7e3f}}.sat-dot{{background:#5b9cf6}}.axle-dot{{background:#f5d433}}.bar-row{{display:grid;grid-template-columns:145px 1fr 58px;gap:10px;align-items:center;margin:10px 0;font-size:11px}}.bar-label strong{{display:block}}.bar-label span{{display:block;color:#64748b;margin-top:2px}}.bar-shell{{height:18px;background:#eef2f7;border-radius:999px;overflow:hidden;display:flex;min-width:32px}}.seg{{height:18px}}.matched{{background:#22c97b}}.avc{{background:#ff7e3f}}.sat{{background:#5b9cf6}}.axle{{background:#f5d433}}table{{width:100%;border-collapse:separate;border-spacing:0;margin-top:10px;font-size:11px;border:1px solid #dbe3ef;border-radius:8px}}th,td{{padding:8px 9px;text-align:left;border-bottom:1px solid #e5eaf2}}th{{background:#f1f5f9;color:#475569;font-size:10px;text-transform:uppercase;letter-spacing:.45px}}.footer{{display:flex;justify-content:space-between;margin-top:24px;color:#64748b;font-size:10px;border-top:1px solid #dbe3ef;padding-top:12px}}@page{{margin:12mm}}@media print{{body{{background:#fff}}.page{{padding:18px;max-width:none}}.section,.kpis{{break-inside:avoid}}}}
</style></head><body><div class="page">
<div class="header"><div class="logo-box"><img class="logo" src="{logo_data}" alt="AG Holdings"/></div><div><div class="brand">AG-metrics Toll Audit Platform</div><h1>{_html_escape(form.get('name') or form.get('type') or 'AG-metrics Report')}</h1><div class="meta">{_html_escape(form.get('plaza') or '')} · {_html_escape(form.get('type') or '')}<br/>{_html_escape(report.get('date_from'))} to {_html_escape(report.get('date_to'))} · Generated {_html_escape(_now())}</div></div><div><span class="badge">{_html_escape(form.get('template') or 'Standard PDF')}</span></div></div>
<div class="kpis"><div class="kpi info"><span>Total events</span><strong>{n(totals['total'])}</strong></div><div class="kpi good"><span>Matched</span><strong>{n(totals['matched'])}</strong></div><div class="kpi bad"><span>Discrepancies</span><strong>{n(totals['discrepancy'])}</strong></div><div class="kpi info"><span>Detection rate</span><strong>{totals['matchRate']}%</strong></div><div class="kpi warn"><span>Axle errors</span><strong>{n(totals['axleErr'])}</strong></div><div class="kpi bad"><span>Class mismatch</span><strong>{n(totals['classMismatch'])}</strong></div></div>
<div class="summary"><div class="summary-card"><h2>Report scope</h2><p><strong>Lanes:</strong> {_html_escape(', '.join(lanes) if lanes else 'All available lanes')}</p><p><strong>Frequency:</strong> {_html_escape(form.get('frequency') or 'Manual only')}</p><p><strong>Recipients:</strong> {_html_escape(', '.join(form.get('recipients') or []) or form.get('contact_group') or 'Not configured')}</p></div><div class="summary-card"><h2>Included sections</h2><p>KPI indicators</p><p>Lane/day discrepancy chart</p><p>Detail table with reconciliation totals</p></div></div>
<div class="section"><h2>Results by lane and day</h2><div class="legend"><span><i class="dot matched-dot"></i>Matched</span><span><i class="dot avc-dot"></i>AVC only</span><span><i class="dot sat-dot"></i>SAT only</span><span><i class="dot axle-dot"></i>Axle errors</span></div>{''.join(chart_rows) or '<p class="meta">No data available</p>'}</div>
<div class="section"><h2>Detail table</h2><table><thead><tr><th>Date</th><th>Lane</th><th>Total</th><th>Matched</th><th>AVC only</th><th>SAT only</th><th>Axle errors</th><th>Discrepancy rate</th></tr></thead><tbody>{table_rows}</tbody></table></div>
<div class="footer"><span>AG-metrics · AVC/SAT Audit Report</span><span>{_html_escape(form.get('template') or 'Standard PDF')}</span></div></div></body></html>"""
    return html.encode("utf-8")


def _pdf_escape(value: Any) -> str:
    return str(value if value is not None else "").replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _jpeg_dimensions(data: bytes) -> Optional[tuple]:
    try:
        i = 2
        while i < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            length = int.from_bytes(data[i + 2:i + 4], "big")
            if marker in (0xC0, 0xC2):
                h = int.from_bytes(data[i + 5:i + 7], "big")
                w = int.from_bytes(data[i + 7:i + 9], "big")
                return w, h
            i += 2 + length
    except Exception:
        return None
    return None


def _designed_report_pdf_bytes(form: Dict[str, Any], report: Dict[str, Any]) -> bytes:
    lang_raw = str(form.get("language") or "").lower()
    if not lang_raw:
        cfg = load_saved_settings()
        lang_raw = str(cfg.get("ui_language") or "").lower()
    spanish = lang_raw.startswith("es") or "spanish" in lang_raw or "español" in lang_raw
    labels = {
        "brand": "Plataforma de Auditoría AG-metrics" if spanish else "AG-metrics Toll Audit Platform",
        "generated": "Generado" if spanish else "Generated",
        "total": "Eventos totales" if spanish else "Total events",
        "matched": "Coincidencias" if spanish else "Matched",
        "discrepancies": "Discrepancias" if spanish else "Discrepancies",
        "detection": "Tasa de detección" if spanish else "Detection rate",
        "axle": "Errores de ejes" if spanish else "Axle errors",
        "class": "Clase distinta" if spanish else "Class mismatch",
        "scope": "Alcance del reporte" if spanish else "Report scope",
        "lanes": "Carriles" if spanish else "Lanes",
        "all_lanes": "Todos los carriles disponibles" if spanish else "All available lanes",
        "frequency": "Frecuencia" if spanish else "Frequency",
        "manual": "Solo manual" if spanish else "Manual only",
        "results": "Resultados por carril y día" if spanish else "Results by lane and day",
        "avc_only": "Solo AVC" if spanish else "AVC only",
        "sat_only": "Solo SAT" if spanish else "SAT only",
        "detail": "Tabla de detalle" if spanish else "Detail table",
        "date": "Fecha" if spanish else "Date",
        "lane": "Carril" if spanish else "Lane",
        "match": "Match" if spanish else "Match",
        "footer": "AG-metrics - Reporte de Auditoría AVC/SAT" if spanish else "AG-metrics - AVC/SAT Audit Report",
    }
    lanes = form.get("lanes") if isinstance(form.get("lanes"), list) else []
    rows = [r for r in report.get("rows", []) if not lanes or r.get("lane") in lanes]
    rows = _report_rows_for_type(rows, form.get("type") or "")
    totals = {
        "total": sum(int(r.get("total") or 0) for r in rows),
        "matched": sum(int(r.get("matched") or 0) for r in rows),
        "avcOnly": sum(int(r.get("avcOnly") or 0) for r in rows),
        "satOnly": sum(int(r.get("satOnly") or 0) for r in rows),
        "axleErr": sum(int(r.get("axleErr") or 0) for r in rows),
        "classMismatch": sum(int(r.get("classMismatch") or 0) for r in rows),
    }
    totals["discrepancy"] = totals["avcOnly"] + totals["satOnly"] + totals["axleErr"]
    totals["matchRate"] = round((totals["total"] - totals["satOnly"]) / max(totals["total"], 1) * 100, 1)
    max_total = max([int(r.get("total") or 0) for r in rows] or [1])

    def n(value: Any) -> str:
        try:
            return f"{int(value):,}"
        except Exception:
            return str(value or 0)

    cmds: List[str] = []

    def fill(r: float, g: float, b: float, x: float, y: float, w: float, h: float) -> None:
        cmds.append(f"{r} {g} {b} rg {x} {y} {w} {h} re f")

    def text(value: Any, x: float, y: float, size: int = 10, color=(0.07, 0.09, 0.14), font="F1") -> None:
        r, g, b = color
        cmds.append(f"{r} {g} {b} rg BT /{font} {size} Tf {x} {y} Td ({_pdf_escape(value)}) Tj ET")

    image_bytes = b""
    image_dims = None
    logo_path = os.path.join(BASE_DIR, "frontend", "logo.jpeg")
    try:
        with open(logo_path, "rb") as fh:
            image_bytes = fh.read()
        image_dims = _jpeg_dimensions(image_bytes)
    except Exception:
        image_bytes = b""

    fill(0.96, 0.98, 1.0, 0, 0, 612, 792)
    fill(1, 1, 1, 32, 28, 548, 736)
    fill(0.07, 0.09, 0.14, 32, 675, 548, 3)
    fill(1, 1, 1, 42, 692, 120, 54)
    if image_bytes and image_dims:
        iw, ih = image_dims
        ratio = min(108 / iw, 42 / ih)
        w, h = iw * ratio, ih * ratio
        cmds.append(f"q {w:.2f} 0 0 {h:.2f} {48 + (108 - w) / 2:.2f} {698 + (42 - h) / 2:.2f} cm /Im1 Do Q")
    else:
        text("AG-metrics", 58, 715, 16, (0.18, 0.37, 0.72))
    text(labels["brand"], 178, 735, 9, (0.39, 0.45, 0.55))
    text(form.get("name") or form.get("type") or "AG-metrics Report", 178, 712, 19)
    text(f"{form.get('plaza') or ''}  |  {form.get('type') or ''}", 178, 694, 10, (0.39, 0.45, 0.55))
    connector = "a" if spanish else "to"
    text(f"{report.get('date_from')} {connector} {report.get('date_to')}  |  {labels['generated']} {_now()}", 178, 680, 9, (0.39, 0.45, 0.55))
    fill(0.92, 0.95, 1.0, 465, 715, 82, 18)
    text(form.get("template") or "Standard PDF", 472, 721, 8, (0.18, 0.37, 0.72))

    kpis = [
        (labels["total"], n(totals["total"]), (0.18, 0.37, 0.72)),
        (labels["matched"], n(totals["matched"]), (0.08, 0.59, 0.35)),
        (labels["discrepancies"], n(totals["discrepancy"]), (0.85, 0.18, 0.33)),
        (labels["detection"], f"{totals['matchRate']}%", (0.18, 0.37, 0.72)),
        (labels["axle"], n(totals["axleErr"]), (0.72, 0.54, 0.0)),
        (labels["class"], n(totals["classMismatch"]), (0.85, 0.18, 0.33)),
    ]
    for idx, (label, value, color) in enumerate(kpis):
        col, row = idx % 3, idx // 3
        x, y = 46 + col * 174, 616 - row * 56
        fill(1, 1, 1, x, y, 158, 42)
        fill(0.86, 0.89, 0.94, x, y, 158, 0.8)
        text(label.upper(), x + 10, y + 27, 7, (0.39, 0.45, 0.55))
        text(value, x + 10, y + 9, 16, color)

    fill(0.98, 0.99, 1.0, 46, 490, 502, 46)
    text(labels["scope"], 58, 518, 10)
    text(f"{labels['lanes']}: {', '.join(lanes) if lanes else labels['all_lanes']}", 58, 503, 8, (0.29, 0.33, 0.41))
    text(f"{labels['frequency']}: {form.get('frequency') or labels['manual']}", 320, 503, 8, (0.29, 0.33, 0.41))

    text(labels["results"], 46, 465, 12)
    legend = [(labels["matched"], (0.13, 0.79, 0.48)), (labels["avc_only"], (1.0, 0.49, 0.25)), (labels["sat_only"], (0.36, 0.61, 0.96)), (labels["axle"], (0.96, 0.83, 0.20))]
    lx = 46
    for label, color in legend:
        fill(*color, lx, 445, 8, 8)
        text(label, lx + 12, 446, 7, (0.29, 0.33, 0.41))
        lx += 82

    y = 420
    for r in rows[:10]:
        total = max(int(r.get("total") or 0), 1)
        bar_w = max(12, int(r.get("total") or 0) / max(max_total, 1) * 320)
        text(f"{r.get('lane')} {r.get('date')}", 46, y + 4, 7, (0.29, 0.33, 0.41))
        x = 190
        for key, color in [("matched", (0.13, 0.79, 0.48)), ("avcOnly", (1.0, 0.49, 0.25)), ("satOnly", (0.36, 0.61, 0.96)), ("axleErr", (0.96, 0.83, 0.20))]:
            value = int(r.get(key) or 0)
            seg_w = max(2 if value else 0, value / total * bar_w)
            if seg_w:
                fill(*color, x, y, seg_w, 10)
                x += seg_w
        text(n(r.get("total")), 525, y + 2, 7)
        y -= 18

    text(labels["detail"], 46, 230, 12)
    headers = [labels["date"], labels["lane"], "Total", labels["match"], "AVC", "SAT", "Ejes", "% Disc."]
    widths = [60, 118, 45, 45, 45, 45, 45, 55]
    x = 46
    fill(0.95, 0.96, 0.98, 46, 210, 468, 16)
    for h, w in zip(headers, widths):
        text(h, x + 3, 216, 7, (0.29, 0.33, 0.41))
        x += w
    y = 195
    for r in rows[:11]:
        x = 46
        vals = [r.get("date"), r.get("lane"), n(r.get("total")), n(r.get("matched")), n(r.get("avcOnly")), n(r.get("satOnly")), n(r.get("axleErr")), f"{r.get('discrepancyRate') or 0}%"]
        for val, w in zip(vals, widths):
            text(str(val)[:22], x + 3, y, 7, (0.11, 0.15, 0.22))
            x += w
        y -= 14
    text(labels["footer"], 46, 46, 8, (0.39, 0.45, 0.55))

    stream = "\n".join(cmds).encode("latin-1", errors="replace")
    resources = "/Font << /F1 4 0 R >>"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        None,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    if image_bytes and image_dims:
        iw, ih = image_dims
        resources = "/Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >>"
        objects.append(
            b"<< /Type /XObject /Subtype /Image /Width " + str(iw).encode() +
            b" /Height " + str(ih).encode() +
            b" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + str(len(image_bytes)).encode() +
            b" >>\nstream\n" + image_bytes + b"\nendstream"
        )
    objects[2] = f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << {resources} >> /Contents 5 0 R >>".encode()
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for idx, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf.extend(f"{idx} 0 obj\n".encode())
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")
    xref = len(pdf)
    pdf.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode())
    for off in offsets[1:]:
        pdf.extend(f"{off:010d} 00000 n \n".encode())
    pdf.extend(f"trailer << /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(pdf)


def _smtp_error_msg(exc: Exception) -> str:
    """Traduce excepciones SMTP/SSL/red a mensajes legibles en español."""
    import socket
    name = type(exc).__name__
    raw = str(exc)
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return f"Credenciales rechazadas por el servidor — verifica usuario y contraseña SMTP ({raw})"
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        refused = ", ".join(exc.recipients.keys()) if hasattr(exc, "recipients") else raw
        return f"El servidor rechazó el destinatario: {refused}"
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return f"El servidor rechazó el remitente '{exc.sender}' — verifica From email"
    if isinstance(exc, smtplib.SMTPConnectError):
        return f"No se pudo conectar al servidor SMTP ({raw})"
    if isinstance(exc, smtplib.SMTPServerDisconnected):
        return "El servidor SMTP cerró la conexión — posible conflicto puerto/seguridad (¿SSL en puerto 465 o TLS en 587?)"
    if isinstance(exc, smtplib.SMTPException):
        return f"Error SMTP: {raw}"
    if isinstance(exc, ssl.SSLError):
        return f"Error SSL/TLS — verifica que el modo de seguridad coincida con el puerto ({raw})"
    if isinstance(exc, (ConnectionRefusedError, OSError)) and "refused" in raw.lower():
        return f"Conexión rechazada — verifica host y puerto SMTP ({raw})"
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return "Timeout de conexión — el host SMTP no responde en ese puerto"
    if isinstance(exc, ValueError):
        return str(exc)
    return f"{name}: {raw}"


def _send_report_email(settings: Dict[str, Any], recipients: List[str], subject: str,
                       body: str, pdf_name: str, pdf_bytes: bytes,
                       attachment_subtype: str = "pdf") -> None:
    smtp = settings.get("smtp") or {}
    host = str(smtp.get("host") or "").strip()
    if not host:
        raise ValueError("SMTP host no configurado")
    port = int(smtp.get("port") or 587)
    security = str(smtp.get("security") or "TLS").upper()
    from_email = str(smtp.get("from_email") or smtp.get("username") or "").strip()
    if not from_email:
        raise ValueError("From email no configurado")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{smtp.get('from_name') or 'AG-metrics'} <{from_email}>"
    msg["To"] = ", ".join(recipients)
    msg.set_content(body)
    maintype = "text" if attachment_subtype == "html" else "application"
    msg.add_attachment(pdf_bytes, maintype=maintype, subtype=attachment_subtype, filename=pdf_name)

    username = smtp.get("username") or ""
    password = smtp.get("password") or ""
    if security == "SSL":
        with smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=30) as server:
            if username:
                server.login(username, password)
            server.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=30) as server:
            if security == "TLS":
                server.starttls(context=ssl.create_default_context())
            if username:
                server.login(username, password)
            server.send_message(msg)


# ─────────────────────────────────────────────────────────
# Auth endpoints
# ─────────────────────────────────────────────────────────

@app.post("/api/auth/login")
async def login(request: Request):
    body  = await request.json()
    email = body.get("email","").strip().lower()
    pw    = body.get("password","")
    with _db() as c:
        row = c.execute(
            "SELECT id,name,email,role FROM auditec_users WHERE LOWER(email)=? AND password_hash=? AND status='Active'",
            (email, _hash(pw)),
        ).fetchone()
    if not row:
        raise HTTPException(401, "Credenciales incorrectas")
    token = _create_session(row["id"])
    with _db() as c:
        c.execute("UPDATE auditec_users SET last_login=? WHERE id=?",
                  (datetime.now().strftime("%Y-%m-%d %H:%M"), row["id"]))
    return {"token": token, "user": dict(row)}

@app.post("/api/auth/logout")
async def logout(request: Request):
    token = request.headers.get("Authorization","").replace("Bearer ","").strip()
    if token:
        with _db() as c:
            c.execute("DELETE FROM auditec_sessions WHERE token=?", (token,))
    return {"ok": True}


# ─────────────────────────────────────────────────────────
# Fuentes AVC — CRUD + test + sync
# ─────────────────────────────────────────────────────────

@app.get("/api/sources")
def list_sources(user=Depends(_get_user)):
    with _db() as c:
        rows = c.execute(
            "SELECT id,name,type,enabled,last_sync,created_at FROM avc_sources ORDER BY id"
        ).fetchall()
    return [dict(r) for r in rows]

@app.post("/api/sources")
async def add_source(request: Request, user=Depends(_require_admin)):
    body = await request.json()
    with _db() as c:
        cur = c.execute(
            "INSERT INTO avc_sources(name,type,config,enabled,created_at) VALUES(?,?,?,?,?)",
            (body["name"], body.get("type","database"),
             json.dumps(body.get("config",{})), 1, _now()),
        )
    return {"ok": True, "id": cur.lastrowid}

@app.get("/api/sources/{sid}")
def get_source(sid: int, user=Depends(_require_admin)):
    with _db() as c:
        row = c.execute("SELECT * FROM avc_sources WHERE id=?", (sid,)).fetchone()
    if not row:
        raise HTTPException(404)
    d = dict(row)
    d["config"] = json.loads(d["config"] or "{}")
    return d

@app.put("/api/sources/{sid}")
async def update_source(sid: int, request: Request, user=Depends(_require_admin)):
    body = await request.json()
    with _db() as c:
        if "config" in body:
            c.execute("UPDATE avc_sources SET config=? WHERE id=?",
                      (json.dumps(body["config"]), sid))
        if "name" in body:
            c.execute("UPDATE avc_sources SET name=? WHERE id=?", (body["name"], sid))
        if "enabled" in body:
            c.execute("UPDATE avc_sources SET enabled=? WHERE id=?", (int(body["enabled"]), sid))
    return {"ok": True}

@app.delete("/api/sources/{sid}")
def delete_source(sid: int, user=Depends(_require_admin)):
    with _db() as c:
        c.execute("DELETE FROM avc_sources WHERE id=?", (sid,))
    return {"ok": True}

@app.post("/api/sources/{sid}/test")
async def test_source(sid: int, request: Request, user=Depends(_get_user)):
    """Prueba la conexión a la fuente usando la fecha de hoy."""
    with _db() as c:
        row = c.execute("SELECT * FROM avc_sources WHERE id=?", (sid,)).fetchone()
    if not row:
        raise HTTPException(404)
    cfg   = json.loads(row["config"] or "{}")
    stype = row["type"]
    try:
        if stype == "api":
            df = _fetch_from_api(cfg, date.today())
        else:
            df = _fetch_from_database(cfg, date.today())
        return {"ok": True, "records": len(df),
                "lanes": sorted(df[detect_col(df.columns.tolist(),[r"^lane_name$",r"lane"])].dropna().unique().tolist()) if not df.empty else []}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

@app.post("/api/sources/{sid}/sync")
async def sync_source(sid: int, request: Request, user=Depends(_get_user)):
    """Descarga eventos de la fuente y los almacena localmente."""
    body = await request.json()
    fecha_str = body.get("date", date.today().isoformat())
    lane      = body.get("lane")

    with _db() as c:
        row = c.execute("SELECT * FROM avc_sources WHERE id=?", (sid,)).fetchone()
    if not row:
        raise HTTPException(404)

    cfg   = json.loads(row["config"] or "{}")
    stype = row["type"]
    try:
        d  = datetime.strptime(fecha_str, "%Y-%m-%d").date()
        df = _fetch_and_store(sid, stype, cfg, d, lane)
        return {"ok": True, "records": len(df), "date": fecha_str}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ─────────────────────────────────────────────────────────
# Dashboard — carriles y stats
# ─────────────────────────────────────────────────────────

@app.get("/api/lanes")
def get_lanes(query_date: str = "", source_id: Optional[int] = None, user=Depends(_get_user)):
    d     = datetime.strptime(query_date, "%Y-%m-%d").date() if query_date else date.today()
    fecha = d.isoformat()

    # Obtener fuentes habilitadas
    with _db() as c:
        if source_id:
            sources = c.execute("SELECT * FROM avc_sources WHERE id=? AND enabled=1",(source_id,)).fetchall()
        else:
            sources = c.execute("SELECT * FROM avc_sources WHERE enabled=1").fetchall()

    lanes_out: List[Dict] = []
    stats_out: Dict[str, Any] = {}
    seen_lanes: set = set()

    for src in sources:
        sid   = src["id"]
        stype = src["type"]

        # Solo leer del almacenamiento local — nunca conectar automáticamente
        local_df = _events_from_local(sid, d)
        if local_df.empty:
            continue

        ac = _auto_cols_avc(local_df)
        device_col = ac["device"]
        if not device_col or device_col not in local_df.columns:
            continue

        for lane_id in sorted(local_df[device_col].dropna().unique()):
            if lane_id in seen_lanes:
                continue
            seen_lanes.add(lane_id)
            lanes_out.append({"id": str(lane_id), "name": str(lane_id), "direction": "",
                               "source_id": sid, "source_name": src["name"],
                               "source_type": stype})
            # El caché se guarda con source_id=0 desde /api/reconcile; probamos ambos
            _, cached_summary = _load_cache(lane_id, fecha, sid)
            if not cached_summary:
                _, cached_summary = _load_cache(lane_id, fecha, 0)
            if cached_summary:
                stats_out[lane_id] = {**cached_summary, "spark":[cached_summary["total"]//12]*12}
            else:
                total = int((local_df[device_col]==lane_id).sum())
                stats_out[lane_id] = {"total":total,"matched":0,"avcOnly":total,
                                       "satOnly":0,"axleErr":0,"matchRate":0,
                                       "spark":[max(total//12,0)]*12}

    return {"lanes": lanes_out, "stats": stats_out}


# ─────────────────────────────────────────────────────────
# Eventos de un carril
# ─────────────────────────────────────────────────────────

@app.get("/api/lanes/{lane_id}/events")
def get_lane_events(lane_id: str, query_date: str = "",
                    source_id: Optional[int] = None,
                    offset: int = 0, limit: int = 0,
                    user=Depends(_get_user)):
    d     = datetime.strptime(query_date, "%Y-%m-%d").date() if query_date else date.today()
    fecha = d.isoformat()

    def _paginate(rows):
        total = len(rows)
        sliced = rows[offset:offset + limit] if limit > 0 else rows
        return total, sliced

    # Cache de conciliación primero
    cached_rows, cached_summary = _load_cache(lane_id, fecha, source_id or 0)
    if cached_rows:
        total, rows = _paginate(cached_rows)
        return {"events": rows, "total": total, "summary": cached_summary, "source": "reconciled"}

    # Solo leer del almacenamiento local — nunca conectar automáticamente
    local_df = _events_from_local(source_id, d, lane_id)
    if not local_df.empty:
        all_rows = local_df.fillna("").astype(str).to_dict(orient="records")
        total, rows = _paginate(all_rows)
        return {"events": rows, "total": total, "source": "local"}

    return {"events": [], "total": 0, "source": "none",
            "hint": "Usa el botón Sincronizar en Configuración para cargar los datos."}


# ─────────────────────────────────────────────────────────
# SAT archivos y carriles
# ─────────────────────────────────────────────────────────

@app.get("/api/sat/merged-files")
def list_merged_files(user=Depends(_get_user)):
    os.makedirs(MERGED_DIR, exist_ok=True)
    files = sorted(glob.glob(os.path.join(MERGED_DIR,"SAT-TEXCOCO-*-MERGED.json")), reverse=True)
    result = []
    for fp in files:
        fname = os.path.basename(fp)
        m = re.search(r"(\d{8})", fname)
        day_str = m.group(1) if m else ""
        try:
            size = os.path.getsize(fp)
            with open(fp,"r",encoding="utf-8") as fh:
                data = json.load(fh)
            txns = len(data.get("transactions",[]))
        except Exception:
            size, txns = 0, 0
        result.append({"filename":fname,"day":day_str,"transactions":txns,
                        "size_kb":round(size/1024,1),"path":fp})
    return result

@app.get("/api/sat/lanes")
def get_sat_lanes(day: str, user=Depends(_get_user)):
    try:
        sat_df = _load_sat_merged(day.replace("-",""))
        sc     = _auto_cols_sat(sat_df)
        voies  = sorted(sat_df[sc["voie"]].astype(str).str.strip().unique().tolist()) if sc["voie"] else []
        return {"lanes": voies, "voie_col": sc["voie"]}
    except Exception as exc:
        return {"lanes": [], "error": str(exc)}

@app.get("/api/avc/lanes")
def get_all_avc_lanes(user=Depends(_get_user)):
    """All unique AVC lane names ever synced to local storage (any date)."""
    with _db() as c:
        rows = c.execute(
            "SELECT DISTINCT lane_name FROM avc_local_events WHERE lane_name != '' ORDER BY lane_name"
        ).fetchall()
    return {"lanes": [r["lane_name"] for r in rows]}

@app.get("/api/sat/voies")
def get_all_sat_voies(user=Depends(_get_user)):
    """Unique SAT voies across ALL merged files — used for lane mapping UI."""
    voies: set = set()
    os.makedirs(MERGED_DIR, exist_ok=True)
    for fp in glob.glob(os.path.join(MERGED_DIR, "SAT-TEXCOCO-*-MERGED.json")):
        try:
            with open(fp, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            txns = data.get("transactions", [])
            if not txns:
                continue
            df = pd.DataFrame(txns)
            sc = _auto_cols_sat(df)
            if sc["voie"]:
                voies.update(df[sc["voie"]].dropna().astype(str).str.strip().unique())
        except Exception:
            pass
    return {"voies": sorted(voies)}


# ─────────────────────────────────────────────────────────
# Status — endpoint de polling para auto-refresh del Dashboard
# ─────────────────────────────────────────────────────────

@app.get("/api/status")
def get_status(query_date: str = "", user=Depends(_get_user)):
    """Respuesta rápida con contadores de AVC y SAT para polling cada 30s."""
    if query_date:
        d = datetime.strptime(query_date, "%Y-%m-%d").date()
    else:
        # Usar la zona horaria configurada para determinar "hoy" correctamente
        cfg      = load_saved_settings()
        local_tz = get_event_tz(cfg)
        d        = datetime.now(local_tz).date()
    day_str  = d.strftime("%Y%m%d")
    date_str = d.isoformat()

    # Archivos SAT pendientes de merge
    pending_files = [
        f for f in glob.glob(os.path.join(WATCH_DIR, f"SAT-TEXCOCO-{day_str}*.json"))
        if not os.path.basename(f).endswith("-MERGED.json")
    ]

    # SAT merged: transacciones y carriles
    mp = os.path.join(MERGED_DIR, f"SAT-TEXCOCO-{day_str}-MERGED.json")
    sat_merged, sat_lanes = 0, []
    if os.path.exists(mp):
        try:
            with open(mp, "r", encoding="utf-8") as fh:
                mdata = json.load(fh)
            sat_merged = len(mdata.get("transactions", []))
            sat_df_tmp = pd.DataFrame(mdata.get("transactions", []))
            if not sat_df_tmp.empty:
                sc = _auto_cols_sat(sat_df_tmp)
                if sc["voie"]:
                    sat_lanes = sorted(sat_df_tmp[sc["voie"]].dropna().astype(str).unique().tolist())
        except Exception:
            pass

    # AVC local: eventos y carriles
    with _db() as c:
        avc_count = c.execute(
            "SELECT COUNT(*) FROM avc_local_events WHERE event_date=?", (date_str,)
        ).fetchone()[0]
        avc_lane_rows = c.execute(
            "SELECT DISTINCT lane_name FROM avc_local_events WHERE event_date=? AND lane_name!=''",
            (date_str,),
        ).fetchall()
        src_rows = c.execute(
            "SELECT id,name,type,last_sync,enabled FROM avc_sources ORDER BY id"
        ).fetchall()

    avc_lanes = sorted(r["lane_name"] for r in avc_lane_rows if r["lane_name"])

    cfg = load_saved_settings()
    try:
        lane_mapping = json.loads(cfg.get("lane_mapping") or "{}")
    except Exception:
        lane_mapping = {}

    return {
        "date":         date_str,
        "sat_pending":  len(pending_files),
        "sat_merged":   sat_merged,
        "sat_lanes":    sat_lanes,
        "avc_events":   int(avc_count),
        "avc_lanes":    avc_lanes,
        "sources":      [{"id":r["id"],"name":r["name"],"type":r["type"],
                           "last_sync":r["last_sync"],"enabled":bool(r["enabled"])} for r in src_rows],
        "timezone":     cfg.get("timezone", "America/Mexico_City"),
        "lane_mapping": lane_mapping,
        "timestamp":    _now(),
    }


@app.get("/api/sat/directory")
def sat_directory_status(user=Depends(_get_user)):
    """Estado completo del directorio SAT: archivos por día, último archivo, días mergeados."""
    # Agrupar archivos pendientes por día
    all_files = glob.glob(os.path.join(WATCH_DIR, "SAT-TEXCOCO-????????*.json"))
    days_pending: Dict[str, Dict] = {}
    last_file_time: Optional[float] = None

    for fp in all_files:
        if os.path.basename(fp).endswith("-MERGED.json"):
            continue
        m = re.search(r"SAT-TEXCOCO-(\d{8})", os.path.basename(fp))
        if not m:
            continue
        day = m.group(1)
        mtime = os.path.getmtime(fp)
        if last_file_time is None or mtime > last_file_time:
            last_file_time = mtime
        if day not in days_pending:
            days_pending[day] = {"count": 0, "newest": mtime}
        days_pending[day]["count"] += 1
        if mtime > days_pending[day]["newest"]:
            days_pending[day]["newest"] = mtime

    # Archivos MERGED
    merged_files = glob.glob(os.path.join(MERGED_DIR, "SAT-TEXCOCO-*-MERGED.json"))
    days_merged: Dict[str, Dict] = {}
    for fp in merged_files:
        m = re.search(r"SAT-TEXCOCO-(\d{8})-MERGED", os.path.basename(fp))
        if not m:
            continue
        day = m.group(1)
        try:
            with open(fp, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            txns = len(data.get("transactions", []))
            generated = data.get("generatedat", "")
        except Exception:
            txns, generated = 0, ""
        days_merged[day] = {"transactions": txns, "generated_at": generated,
                             "size_kb": round(os.path.getsize(fp) / 1024, 1)}

    # Todos los días (union)
    all_days = sorted(set(list(days_pending.keys()) + list(days_merged.keys())), reverse=True)

    # Tiempo desde el último archivo
    seconds_since_last: Optional[int] = None
    if last_file_time:
        seconds_since_last = int(datetime.now().timestamp() - last_file_time)

    days_out = []
    for day in all_days:
        pend = days_pending.get(day, {})
        merg = days_merged.get(day, {})
        try:
            dt = datetime.strptime(day, "%Y%m%d")
            date_label = dt.strftime("%d/%m/%Y")
        except Exception:
            date_label = day
        days_out.append({
            "day":          day,
            "date_label":   date_label,
            "pending":      pend.get("count", 0),
            "merged":       bool(merg),
            "transactions": merg.get("transactions", 0),
            "generated_at": merg.get("generated_at", ""),
            "size_kb":      merg.get("size_kb", 0),
        })

    return {
        "watch_dir":          WATCH_DIR,
        "merged_dir":         MERGED_DIR,
        "total_pending":      sum(d["pending"] for d in days_out),
        "seconds_since_last": seconds_since_last,
        "days":               days_out,
    }


# ─────────────────────────────────────────────────────────
# Conciliación
# ─────────────────────────────────────────────────────────

@app.post("/api/reconcile")
async def run_reconcile(request: Request, user=Depends(_get_user)):
    body      = await request.json()
    lane_avc  = body.get("avc_lane","")
    fecha     = body.get("date", date.today().isoformat())
    ventana   = int(body.get("window_s", 120))
    source_id = int(body.get("source_id", 0))
    day_str   = fecha.replace("-","")

    # Resolve SAT lane: explicit > lane_mapping config > fallback to avc lane name
    lane_sat = body.get("sat_lane", "")
    if not lane_sat:
        cfg = load_saved_settings()
        try:
            mapping = json.loads(cfg.get("lane_mapping") or "{}")
        except Exception:
            mapping = {}
        lane_sat = mapping.get(lane_avc, "") or lane_avc

    d = datetime.strptime(fecha, "%Y-%m-%d").date()

    # Cargar AVC desde almacenamiento local
    avc_df = _events_from_local(source_id or None, d, lane_avc)
    if avc_df.empty:
        # Intentar sincronizar desde la fuente
        if source_id:
            with _db() as c:
                src_row = c.execute("SELECT * FROM avc_sources WHERE id=?", (source_id,)).fetchone()
            if src_row:
                cfg = json.loads(src_row["config"] or "{}")
                try:
                    avc_df = _fetch_and_store(source_id, src_row["type"], cfg, d, lane_avc)
                except Exception as exc:
                    return {"error": f"No se pudo obtener AVC: {exc}"}
        else:
            # Sin source_id: intentar con todas las fuentes habilitadas
            with _db() as c:
                sources = c.execute("SELECT * FROM avc_sources WHERE enabled=1").fetchall()
            for src in sources:
                cfg = json.loads(src["config"] or "{}")
                try:
                    avc_df = _fetch_and_store(src["id"], src["type"], cfg, d, lane_avc)
                    if not avc_df.empty:
                        source_id = src["id"]
                        break
                except Exception:
                    continue

    if avc_df.empty:
        return {"error": f"Sin datos AVC para carril '{lane_avc}' en {fecha}. ¿Has sincronizado la fuente?"}

    # Cargar SAT
    try:
        sat_df = _load_sat_merged(day_str)
    except Exception as exc:
        return {"error": str(exc)}

    # Auto-detectar columnas (igual que app.py)
    ac = _auto_cols_avc(avc_df)
    sc = _auto_cols_sat(sat_df)

    missing = [k for k,v in {**ac,**sc}.items() if not v]
    if missing:
        return {"error": f"No se detectaron columnas: {missing}"}

    try:
        result = reconcile(
            avc_df, sat_df, lane_avc, lane_sat, fecha, ventana,
            ac["date"], ac["device"], ac["type"], ac["axles"], ac["id"],
            sc["date"], sc["voie"], sc["cls"], sc["tab"], sc["num"], sc["prix"],
        )
    except Exception as exc:
        return {"error": f"Error en conciliación: {exc}"}

    if result.empty:
        return {"result":[], "summary":{}, "cols":{"avc":ac,"sat":sc}}

    summary = _recon_summary(result)
    _save_cache(lane_avc, fecha, result, summary, source_id)

    return {"result": result.fillna("").astype(str).to_dict(orient="records"),
            "summary": summary, "cols": {"avc":ac,"sat":sc}}

@app.get("/api/class-summary")
def get_class_summary(query_date: str = "", user=Depends(_get_user)):
    """Distribución de clases AVC vs SAT desde el caché de conciliación."""
    if query_date:
        d = datetime.strptime(query_date, "%Y-%m-%d").date()
    else:
        cfg = load_saved_settings()
        d   = datetime.now(get_event_tz(cfg)).date()
    fecha = d.isoformat()

    CLASS_NAMES = {
        1:"Auto", 2:"C2", 3:"C3", 4:"C4", 5:"C5",
        6:"C6", 7:"C7", 8:"C8", 9:"C9+", 10:"AR1",
        11:"AR2", 12:"B2", 13:"B3", 14:"B4", 15:"Moto",
    }

    avc_counts: Dict[int, int] = {}
    sat_counts: Dict[int, int] = {}

    with _db() as c:
        rows = c.execute(
            "SELECT result_json FROM recon_cache WHERE cache_key LIKE ?",
            (f"%::{fecha}",)
        ).fetchall()

    for row in rows:
        try:
            events = json.loads(row["result_json"])
        except Exception:
            continue
        for ev in events:
            tipo = ev.get("tipo", "")
            # Clase AVC — de filas MATCH y AVC
            if tipo in ("MATCH", "AVC"):
                try:
                    cls = int(float(ev.get("clase_avc_mapeada") or 0))
                    if cls > 0:
                        avc_counts[cls] = avc_counts.get(cls, 0) + 1
                except Exception:
                    pass
            # Clase SAT — de filas MATCH y SAT
            if tipo in ("MATCH", "SAT"):
                try:
                    sc = int(float(ev.get("id_classe")     or 0))
                    tc = int(float(ev.get("tab_id_classe") or 0))
                    eff = tc if sc == 0 else sc
                    if eff > 0:
                        sat_counts[eff] = sat_counts.get(eff, 0) + 1
                except Exception:
                    pass

    all_cls = sorted(set(list(avc_counts.keys()) + list(sat_counts.keys())))
    breakdown = [
        {
            "class_id": cls,
            "name":     CLASS_NAMES.get(cls, f"Cls {cls}"),
            "avc":      avc_counts.get(cls, 0),
            "sat":      sat_counts.get(cls, 0),
        }
        for cls in all_cls if cls > 0
    ]
    return {"date": fecha, "breakdown": breakdown}


@app.get("/api/reconcile/cache")
def list_cache(user=Depends(_get_user)):
    with _db() as c:
        rows = c.execute(
            "SELECT cache_key,summary_json,source_id,created_at FROM recon_cache ORDER BY created_at DESC"
        ).fetchall()
    result = []
    for r in rows:
        parts = r["cache_key"].split("::", 2)
        result.append({"source_id":parts[0],"lane":parts[1] if len(parts)>1 else "",
                        "date":parts[2] if len(parts)>2 else "",
                        "summary":json.loads(r["summary_json"]),
                        "created_at":r["created_at"]})
    return result


@app.get("/api/reports/summary")
def get_reports_summary(date_from: str = "", date_to: str = "", user=Depends(_get_user)):
    """Real report data from reconciliation cache, grouped by date and lane."""
    cfg = load_saved_settings()
    today = datetime.now(get_event_tz(cfg)).date()
    if not date_to:
        date_to = today.isoformat()
    if not date_from:
        date_from = (today - timedelta(days=13)).isoformat()

    try:
        d_from = datetime.strptime(date_from, "%Y-%m-%d").date()
        d_to = datetime.strptime(date_to, "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(status_code=400, detail="date_from/date_to deben usar YYYY-MM-DD")
    if d_from > d_to:
        raise HTTPException(status_code=400, detail="date_from no puede ser mayor que date_to")

    with _db() as c:
        rows = c.execute(
            "SELECT cache_key,result_json,summary_json,source_id,created_at FROM recon_cache ORDER BY cache_key"
        ).fetchall()

    report_rows: List[Dict[str, Any]] = []
    totals = {"total":0, "matched":0, "avcOnly":0, "satOnly":0, "axleErr":0}
    discrepancy_totals: Dict[str, int] = {}
    class_totals: Dict[str, Dict[str, int]] = {}
    worst_rows: List[Dict[str, Any]] = []

    for r in rows:
        parts = r["cache_key"].split("::", 2)
        if len(parts) == 3:
            source_id, lane, fecha = parts
        else:
            source_id = str(r["source_id"] or 0)
            lane = parts[0] if parts else ""
            fecha = parts[-1] if parts else ""
        try:
            row_date = datetime.strptime(fecha, "%Y-%m-%d").date()
        except Exception:
            continue
        if row_date < d_from or row_date > d_to:
            continue

        try:
            summary = json.loads(r["summary_json"] or "{}")
        except Exception:
            summary = {}
        try:
            events = json.loads(r["result_json"] or "[]")
        except Exception:
            events = []

        total = int(summary.get("total") or 0)
        matched = int(summary.get("matched") or 0)
        avc_only = int(summary.get("avcOnly") or 0)
        sat_only = int(summary.get("satOnly") or 0)
        axle_err = int(summary.get("axleErr") or 0)
        match_rate = float(summary.get("matchRate") or 0)
        discrepancy_count = avc_only + sat_only + axle_err
        discrepancy_rate = round(discrepancy_count / max(total, 1) * 100, 1)

        motive_counts: Dict[str, int] = {}
        class_mismatch = 0
        for ev in events:
            tipo = ev.get("tipo", "")
            motivo = str(ev.get("motivo_no_match") or "")
            nota = str(ev.get("nota_ejes") or "")
            if motivo:
                motive_counts[motivo] = motive_counts.get(motivo, 0) + 1
                discrepancy_totals[motivo] = discrepancy_totals.get(motivo, 0) + 1
            if motivo == "clase_distinta":
                class_mismatch += 1
            if tipo in ("MATCH", "AVC"):
                cls = str(ev.get("clase_avc_mapeada") or "")
                if cls and cls not in ("0", "nan", "None"):
                    class_totals.setdefault(cls, {"avc":0, "sat":0})
                    class_totals[cls]["avc"] += 1
            if tipo in ("MATCH", "SAT"):
                sc = str(ev.get("id_classe") or "0")
                tc = str(ev.get("tab_id_classe") or "0")
                eff = tc if sc in ("", "0", "0.0", "nan", "None") else sc
                try:
                    eff = str(int(float(eff)))
                except Exception:
                    eff = ""
                if eff:
                    class_totals.setdefault(eff, {"avc":0, "sat":0})
                    class_totals[eff]["sat"] += 1
            if nota.startswith("ERROR"):
                discrepancy_totals["ERROR_DETECCION_EJES_AVC"] = discrepancy_totals.get("ERROR_DETECCION_EJES_AVC", 0) + 1

        row = {
            "date": fecha,
            "lane": lane,
            "source_id": source_id,
            "total": total,
            "matched": matched,
            "avcOnly": avc_only,
            "satOnly": sat_only,
            "axleErr": axle_err,
            "matchRate": match_rate,
            "discrepancyCount": discrepancy_count,
            "discrepancyRate": discrepancy_rate,
            "classMismatch": class_mismatch,
            "motives": motive_counts,
            "created_at": r["created_at"],
        }
        report_rows.append(row)
        worst_rows.append(row)
        for key in totals:
            totals[key] += int(row[key])

    totals["matchRate"] = round((totals["total"] - totals["satOnly"]) / max(totals["total"], 1) * 100, 1)
    totals["discrepancyCount"] = totals["avcOnly"] + totals["satOnly"] + totals["axleErr"]
    totals["discrepancyRate"] = round(totals["discrepancyCount"] / max(totals["total"], 1) * 100, 1)

    worst_rows = sorted(
        worst_rows,
        key=lambda x: (x["discrepancyRate"], x["discrepancyCount"]),
        reverse=True,
    )[:10]
    motive_breakdown = [
        {"motivo": k, "count": v}
        for k, v in sorted(discrepancy_totals.items(), key=lambda item: item[1], reverse=True)
    ]
    class_breakdown = [
        {"class_id": k, "avc": v["avc"], "sat": v["sat"], "delta": v["avc"] - v["sat"]}
        for k, v in sorted(class_totals.items(), key=lambda item: int(float(item[0])) if str(item[0]).isdigit() else 999)
    ]
    lanes = sorted({r["lane"] for r in report_rows if r["lane"]})
    dates = sorted({r["date"] for r in report_rows if r["date"]})
    return {
        "date_from": d_from.isoformat(),
        "date_to": d_to.isoformat(),
        "rows": report_rows,
        "totals": totals,
        "lanes": lanes,
        "dates": dates,
        "motive_breakdown": motive_breakdown,
        "class_breakdown": class_breakdown,
        "worst_rows": worst_rows,
        "source": "recon_cache",
    }


def _send_configured_report(report_type: str, date_from: str, date_to: str) -> Dict[str, Any]:
    settings = _report_email_settings()
    recipients = [
        r.get("email") for r in settings.get("recipients", [])
        if r.get("enabled", True) and report_type in (r.get("report_types") or [])
    ]
    recipients = [r for r in recipients if r]
    if not recipients:
        raise ValueError(f"Sin destinatarios activos para reporte {report_type}")
    report = get_reports_summary(date_from, date_to, user={"id": 0})
    title = f"Reporte AG-metrics {report_type.upper()}"
    pdf = _report_pdf_bytes(title, report)
    _send_report_email(
        settings,
        recipients,
        f"{title} | {date_from} a {date_to}",
        "Adjunto encontrarás el reporte PDF generado automáticamente por AG-metrics.",
        f"ag-metrics-{report_type}-{date_from}-{date_to}.pdf",
        pdf,
    )
    return {"ok": True, "sent": len(recipients), "recipients": recipients}


@app.get("/api/report-email/settings")
def get_report_email_settings(user=Depends(_require_admin)):
    return _report_email_settings()


@app.post("/api/report-email/settings")
async def save_report_email_settings(request: Request, user=Depends(_require_admin)):
    body = await request.json()
    current = _report_email_settings()
    current["smtp"].update(body.get("smtp") or {})
    current["schedule"].update(body.get("schedule") or {})
    if isinstance(body.get("recipients"), list):
        current["recipients"] = body["recipients"]
    _set_app_setting_json("report_email_settings", current)
    return {"ok": True}


@app.post("/api/report-email/test")
async def send_test_report_email(request: Request, user=Depends(_require_admin)):
    body = await request.json()
    settings = _report_email_settings()
    to_email = (body.get("to") or user.get("email") or settings["smtp"].get("from_email") or "").strip()
    if not to_email:
        raise HTTPException(400, "Escribe un correo de destino antes de enviar la prueba")
    if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', to_email):
        raise HTTPException(400, f"Correo inválido: {to_email}")
    pdf = _report_pdf_bytes("Prueba de correo AG-metrics", {
        "date_from": date.today().isoformat(),
        "date_to": date.today().isoformat(),
        "source": "test",
        "totals": {"total": 0, "matched": 0, "avcOnly": 0, "satOnly": 0, "axleErr": 0, "matchRate": 0, "discrepancyCount": 0, "discrepancyRate": 0},
        "motive_breakdown": [],
        "worst_rows": [],
        "rows": [],
    })
    subject = "AG-metrics - prueba SMTP"
    try:
        loop = asyncio.get_event_loop()
        await asyncio.wait_for(
            loop.run_in_executor(None, lambda: _send_report_email(
                settings, [to_email], subject,
                "Este es un correo de prueba de configuración SMTP de AG-metrics.",
                "ag-metrics-prueba.pdf", pdf,
            )),
            timeout=20.0,
        )
        _record_notification("System", "SMTP test", subject, [to_email], "Sent")
    except asyncio.TimeoutError:
        _record_notification("System", "SMTP test", subject, [to_email], "Failed", "Timeout SMTP 20s")
        raise HTTPException(400, "Timeout: el servidor SMTP no respondió en 20 segundos — verifica host y puerto")
    except Exception as exc:
        msg = _smtp_error_msg(exc)
        _record_notification("System", "SMTP test", subject, [to_email], "Failed", msg)
        raise HTTPException(400, msg)
    return {"ok": True, "sent_to": to_email}


@app.post("/api/report-email/send-now")
async def send_report_now(request: Request, user=Depends(_require_admin)):
    body = await request.json()
    report_type = body.get("report_type") or "daily"
    cfg = load_saved_settings()
    today = datetime.now(get_event_tz(cfg)).date()
    date_to = body.get("date_to") or today.isoformat()
    if body.get("date_from"):
        date_from = body["date_from"]
    elif report_type == "weekly":
        date_from = (today - timedelta(days=6)).isoformat()
    elif report_type == "monthly":
        date_from = today.replace(day=1).isoformat()
    else:
        date_from = date_to
    try:
        loop = asyncio.get_event_loop()
        result = await asyncio.wait_for(
            loop.run_in_executor(None, lambda: _send_configured_report(report_type, date_from, date_to)),
            timeout=20.0,
        )
        period = f"{date_from} a {date_to}"
        pdf_file = f"ag-metrics-{report_type}-{date_from}-{date_to}.pdf"
        subject = f"Reporte AG-metrics {report_type.upper()} | {period}"
        recipients = result.get("recipients") or []
        _record_report_history(f"Reporte {report_type}", period, recipients, "Sent", pdf_file)
        _record_notification("Report", f"Reporte {report_type}", subject, recipients, "Sent")
        return result
    except asyncio.TimeoutError:
        _record_report_history(f"Reporte {report_type}", f"{date_from} a {date_to}", [], "Failed", "", "Timeout SMTP 20s")
        _record_notification("Report", f"Reporte {report_type}", f"Reporte AG-metrics {report_type.upper()}", [], "Failed", "Timeout SMTP 20s")
        raise HTTPException(400, "Timeout: el servidor SMTP no respondió en 20 segundos — verifica host y puerto")
    except Exception as exc:
        msg = _smtp_error_msg(exc)
        _record_report_history(f"Reporte {report_type}", f"{date_from} a {date_to}", [], "Failed", "", msg)
        _record_notification("Report", f"Reporte {report_type}", f"Reporte AG-metrics {report_type.upper()}", [], "Failed", msg)
        raise HTTPException(400, msg)


@app.post("/api/report-email/send-preview")
async def send_preview_report_email(request: Request, user=Depends(_require_admin)):
    body = await request.json()
    form = body.get("report") or {}
    recipients = [
        str(r).strip() for r in (form.get("recipients") or body.get("recipients") or [])
        if str(r).strip()
    ]
    if not recipients and isinstance(form.get("recipients"), str):
        recipients = [r.strip() for r in form["recipients"].split(",") if r.strip()]
    if not recipients:
        raise HTTPException(400, "Agrega destinatarios antes de enviar el reporte de prueba")
    invalid = [r for r in recipients if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', r)]
    if invalid:
        raise HTTPException(400, f"Correo inválido: {invalid[0]}")

    date_from = body.get("date_from") or date.today().isoformat()
    date_to = body.get("date_to") or date_from
    settings = _report_email_settings()
    report = get_reports_summary(date_from, date_to, user={"id": 0})
    pdf = _designed_report_pdf_bytes({**form, "recipients": recipients}, report)
    title = form.get("name") or form.get("type") or "AG-metrics Report"
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "-", title).strip("-").lower() or "ag-metrics-report"
    filename = f"{safe_name}-{date_from}-{date_to}.pdf"
    subject = f"{title} | {date_from} a {date_to}"
    try:
        loop = asyncio.get_event_loop()
        await asyncio.wait_for(
            loop.run_in_executor(None, lambda: _send_report_email(
                settings,
                recipients,
                subject,
                "Adjunto encontrarás el reporte de prueba generado desde la vista previa de AG-metrics.",
                filename,
                pdf,
                "pdf",
            )),
            timeout=20.0,
        )
        _record_report_history(title, f"{date_from} a {date_to}", recipients, "Sent", filename)
        _record_notification("Report", title, subject, recipients, "Sent")
        return {"ok": True, "sent": len(recipients), "recipients": recipients, "filename": filename}
    except asyncio.TimeoutError:
        _record_report_history(title, f"{date_from} a {date_to}", recipients, "Failed", filename, "Timeout SMTP 20s")
        _record_notification("Report", title, subject, recipients, "Failed", "Timeout SMTP 20s")
        raise HTTPException(400, "Timeout: el servidor SMTP no respondió en 20 segundos — verifica host y puerto")
    except Exception as exc:
        msg = _smtp_error_msg(exc)
        _record_report_history(title, f"{date_from} a {date_to}", recipients, "Failed", filename, msg)
        _record_notification("Report", title, subject, recipients, "Failed", msg)
        raise HTTPException(400, msg)


@app.get("/api/report-configs")
def get_report_configs(user=Depends(_require_admin)):
    return _setting_list("report_configs")


@app.post("/api/report-configs")
async def save_report_config(request: Request, user=Depends(_require_admin)):
    body = await request.json()
    return _upsert_setting_row("report_configs", body)


@app.get("/api/report-settings")
def get_report_settings(user=Depends(_require_admin)):
    return _get_app_setting_json("report_settings", {
        "timezone": "America/Mexico_City",
        "default_template": "Standard PDF",
        "language": "English",
        "attach_pdf": True,
        "footer_text": "Generated by AG-metrics",
    })


@app.post("/api/report-settings")
async def save_report_settings(request: Request, user=Depends(_require_admin)):
    body = await request.json()
    _set_app_setting_json("report_settings", body)
    return {"ok": True}


@app.get("/api/report-templates")
def get_report_templates(user=Depends(_require_admin)):
    default_template = {
        "id": 1,
        "name": "Standard PDF",
        "logo": "",
        "header_text": "AG-metrics Toll Audit",
        "footer_text": "Generated by AG-metrics",
        "language": "English",
        "is_default": True,
        "status": "Active",
    }
    rows = [r for r in _setting_list("report_templates") if str(r.get("name") or "").strip()]
    has_standard = any(r.get("name") == default_template["name"] for r in rows)
    if not has_standard:
        rows.insert(0, default_template)
    if not any(r.get("is_default") for r in rows):
        rows[0]["is_default"] = True
    return rows


@app.post("/api/report-templates")
async def save_report_template(request: Request, user=Depends(_require_admin)):
    body = await request.json()
    rows = _setting_list("report_templates")
    if body.get("is_default"):
        rows = [{**r, "is_default": False} for r in rows]
        _save_setting_list("report_templates", rows)
    return _upsert_setting_row("report_templates", body)


@app.get("/api/report-history")
def get_report_history(user=Depends(_require_admin)):
    return _setting_list("report_history")


@app.get("/api/contact-groups")
def get_contact_groups(user=Depends(_require_admin)):
    rows = _setting_list("contact_groups")
    if rows:
        return rows
    return [
        {"id": 1, "name": "Toll Audit Team", "description": "Daily audit recipients", "emails": [], "status": "Active"},
        {"id": 2, "name": "Operations Team", "description": "Operations notifications", "emails": [], "status": "Active"},
        {"id": 3, "name": "Management", "description": "Management summaries", "emails": [], "status": "Active"},
        {"id": 4, "name": "IT Support", "description": "System support contacts", "emails": [], "status": "Active"},
    ]


@app.post("/api/contact-groups")
async def save_contact_group(request: Request, user=Depends(_require_admin)):
    body = await request.json()
    return _upsert_setting_row("contact_groups", body)


@app.get("/api/notification-history")
def get_notification_history(user=Depends(_require_admin)):
    return _setting_list("notification_history")


@app.get("/api/alarm-rules")
def get_alarm_rules(user=Depends(_require_admin)):
    return _setting_list("alarm_rules")


@app.post("/api/alarm-rules")
async def save_alarm_rule(request: Request, user=Depends(_require_admin)):
    body = await request.json()
    return _upsert_setting_row("alarm_rules", body)


@app.get("/api/active-alarms")
def get_active_alarms(user=Depends(_require_admin)):
    rows = _setting_list("active_alarms")
    return [r for r in rows if r.get("status", "Open") not in ("Resolved", "Ignored")]


@app.post("/api/active-alarms")
async def save_active_alarm(request: Request, user=Depends(_require_admin)):
    body = await request.json()
    saved = _upsert_setting_row("active_alarms", body)
    if saved.get("status") in ("Resolved", "Ignored"):
        _append_setting_row("alarm_history", saved)
    return saved


@app.get("/api/alarm-settings")
def get_alarm_settings(user=Depends(_require_admin)):
    return _get_app_setting_json("alarm_settings", {
        "default_severity": "Warning",
        "default_cooldown": 10,
        "emails_enabled": True,
        "critical_group": "",
        "history_days": 90,
    })


@app.post("/api/alarm-settings")
async def save_alarm_settings(request: Request, user=Depends(_require_admin)):
    body = await request.json()
    _set_app_setting_json("alarm_settings", body)
    return {"ok": True}


@app.get("/api/alarm-history")
def get_alarm_history(user=Depends(_require_admin)):
    return _setting_list("alarm_history")


@app.post("/api/alarm-email/test")
async def send_test_alarm_email(request: Request, user=Depends(_require_admin)):
    body = await request.json()
    settings = _report_email_settings()
    recipients = [e.strip() for e in (body.get("recipients") or []) if str(e).strip()]
    if not recipients:
        to_email = (user.get("email") or settings["smtp"].get("from_email") or "").strip()
        recipients = [to_email] if to_email else []
    if not recipients:
        raise HTTPException(400, "Sin destinatarios para prueba de alarma")
    alarm_name = body.get("alarm_name") or "Test alarm"
    subject = f"AG-metrics Alarm - {alarm_name}"
    pdf = _report_pdf_bytes(subject, {
        "date_from": date.today().isoformat(),
        "date_to": date.today().isoformat(),
        "source": "alarm-test",
        "totals": {"total": 0, "matched": 0, "avcOnly": 0, "satOnly": 0, "axleErr": 0, "matchRate": 0, "discrepancyCount": 0, "discrepancyRate": 0},
        "motive_breakdown": [],
        "worst_rows": [],
        "rows": [],
    })
    try:
        loop = asyncio.get_event_loop()
        await asyncio.wait_for(
            loop.run_in_executor(None, lambda: _send_report_email(
                settings,
                recipients,
                subject,
                "This is a test alarm notification from AG-metrics.",
                "ag-metrics-alarm-test.pdf",
                pdf,
            )),
            timeout=20.0,
        )
        _record_notification("Alarm", alarm_name, subject, recipients, "Sent")
        _append_setting_row("alarm_history", {
            "date_time": _now(),
            "alarm_name": alarm_name,
            "event_type": body.get("event_type") or "Test Rule",
            "plaza": body.get("plaza") or "",
            "lane": "",
            "severity": body.get("severity") or "Info",
            "status": "Resolved",
            "notification_status": "Sent",
            "resolved_at": _now(),
        })
        return {"ok": True, "sent_to": recipients}
    except asyncio.TimeoutError:
        _record_notification("Alarm", alarm_name, subject, recipients, "Failed", "Timeout SMTP 20s")
        raise HTTPException(400, "Timeout: el servidor SMTP no respondió en 20 segundos — verifica host y puerto")
    except Exception as exc:
        msg = _smtp_error_msg(exc)
        _record_notification("Alarm", alarm_name, subject, recipients, "Failed", msg)
        raise HTTPException(400, msg)


# ─────────────────────────────────────────────────────────
# Merge SAT
# ─────────────────────────────────────────────────────────

@app.post("/api/merge-sat")
async def merge_sat(request: Request, user=Depends(_get_user)):
    body    = await request.json()
    day_str = body.get("day", date.today().strftime("%Y%m%d"))
    os.makedirs(MERGED_DIR, exist_ok=True)

    pattern = os.path.join(WATCH_DIR, f"SAT-TEXCOCO-{day_str}*.json")
    files   = sorted([f for f in glob.glob(pattern)
                      if not os.path.basename(f).endswith("-MERGED.json")])
    mp = os.path.join(MERGED_DIR, f"SAT-TEXCOCO-{day_str}-MERGED.json")

    try:
        merged = json.load(open(mp,"r",encoding="utf-8")) if os.path.exists(mp) else \
                 {"batchuid":f"SAT-TEXCOCO-{day_str}-MERGED","sourcesystem":"SATTexcoco",
                  "generatedat":"","transactions":[],"processed_batches":[]}
    except Exception:
        merged = {"batchuid":f"SAT-TEXCOCO-{day_str}-MERGED","sourcesystem":"SATTexcoco",
                  "generatedat":"","transactions":[],"processed_batches":[]}

    done = set(merged.get("processed_batches",[]))
    added, skipped = 0, 0
    for fp in files:
        try:
            raw  = open(fp,"rb").read()
            raw  = raw.replace(b',"\r\n,"',b',"').replace(b"\r\n",b"").replace(b"\r",b"")
            data = json.loads(raw.decode("utf-8",errors="replace").strip())
            bid  = data.get("batchuid", os.path.basename(fp))
            if bid in done:
                skipped += 1
                try: os.remove(fp)
                except: pass
                continue
            merged["transactions"].extend(data.get("transactions",[]))
            done.add(bid); added += len(data.get("transactions",[]));
            try: os.remove(fp)
            except: pass
        except Exception:
            pass

    merged["generatedat"]      = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    merged["processed_batches"] = sorted(done)
    tmp = mp+".tmp"
    with open(tmp,"w",encoding="utf-8") as fh:
        json.dump(merged, fh, ensure_ascii=False)
    os.replace(tmp, mp)
    return {"ok":True,"added":added,"skipped":skipped,"total":len(merged["transactions"]),"path":mp}


# ─────────────────────────────────────────────────────────
# Imagen — proxy SSH
# ─────────────────────────────────────────────────────────

@app.get("/api/image")
def get_image(ref: str, source_id: Optional[int] = None, user=Depends(_get_user)):
    # Resolver config SSH de la fuente indicada (o la primera disponible)
    settings = {}
    if source_id:
        with _db() as c:
            row = c.execute("SELECT config FROM avc_sources WHERE id=?", (source_id,)).fetchone()
        if row:
            settings = json.loads(row["config"] or "{}")
    if not settings:
        settings = load_saved_settings()

    for prefix in ("http://localhost","http://127.0.0.1","https://localhost","https://127.0.0.1"):
        if ref.lower().startswith(prefix):
            ref = urlparse(ref).path
            break
    try:
        img_bytes, mime, _ = fetch_remote_image_bytes(settings, ref)
        return Response(content=img_bytes, media_type=mime)
    except Exception as exc:
        raise HTTPException(404, str(exc))


# ─────────────────────────────────────────────────────────
# Configuración legacy (para compatibilidad con app.py)
# ─────────────────────────────────────────────────────────

@app.get("/api/config")
def get_config(user=Depends(_require_admin)):
    return load_saved_settings()

@app.post("/api/config")
async def post_config(request: Request, user=Depends(_require_admin)):
    body = await request.json()
    save_settings(body)
    # Sincronizar también la primera fuente de tipo database
    with _db() as c:
        row = c.execute("SELECT id FROM avc_sources WHERE type='database' ORDER BY id LIMIT 1").fetchone()
        if row:
            c.execute("UPDATE avc_sources SET config=? WHERE id=?",
                      (json.dumps(body), row["id"]))
        else:
            c.execute("INSERT INTO avc_sources(name,type,config,enabled,created_at) VALUES(?,?,?,?,?)",
                      ("AVC Principal", "database", json.dumps(body), 1, _now()))
    return {"ok": True}


# ─────────────────────────────────────────────────────────
# Usuarios
# ─────────────────────────────────────────────────────────

@app.get("/api/users")
def get_users(user=Depends(_require_admin)):
    with _db() as c:
        rows = c.execute("SELECT id,name,email,role,status,last_login FROM auditec_users").fetchall()
    return [{"id":r["id"],"name":r["name"],"email":r["email"],
             "role":r["role"],"status":r["status"],"lastLogin":r["last_login"] or "—"}
            for r in rows]

@app.post("/api/users")
async def add_user(request: Request, user=Depends(_require_admin)):
    body = await request.json()
    try:
        with _db() as c:
            c.execute("INSERT INTO auditec_users(name,email,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?)",
                      (body["name"],body["email"],_hash(body.get("password","auditec123")),
                       body.get("role","Auditor"),"Active",_now()))
        return {"ok": True}
    except sqlite3.IntegrityError:
        raise HTTPException(409, "El correo ya existe")

@app.put("/api/users/{uid}")
async def update_user(uid: int, request: Request, user=Depends(_require_admin)):
    body = await request.json()
    with _db() as c:
        if "status"   in body: c.execute("UPDATE auditec_users SET status=? WHERE id=?",(body["status"],uid))
        if "role"     in body: c.execute("UPDATE auditec_users SET role=? WHERE id=?",(body["role"],uid))
        if body.get("password"): c.execute("UPDATE auditec_users SET password_hash=? WHERE id=?",(_hash(body["password"]),uid))
    return {"ok": True}


_REPORT_SCHED_LOCK_FH = None

def _weekday_key(dt: datetime) -> str:
    return ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"][dt.weekday()]


def _report_scheduler_loop() -> None:
    while True:
        try:
            settings = _report_email_settings()
            schedule = settings.get("schedule") or {}
            tz = get_event_tz({"timezone": schedule.get("timezone") or "America/Mexico_City"})
            now = datetime.now(tz)
            last_sent = _get_app_setting_json("report_email_last_sent", {})

            def mark_sent(key: str):
                last_sent[key] = now.strftime("%Y-%m-%d")
                _set_app_setting_json("report_email_last_sent", last_sent)

            if schedule.get("daily_enabled") and now.strftime("%H:%M") == (schedule.get("daily_time") or "07:00"):
                key = "daily"
                if last_sent.get(key) != now.strftime("%Y-%m-%d"):
                    day = (now.date() - timedelta(days=1)).isoformat()
                    _send_configured_report("daily", day, day)
                    mark_sent(key)

            if (
                schedule.get("weekly_enabled")
                and _weekday_key(now) == (schedule.get("weekly_day") or "monday")
                and now.strftime("%H:%M") == (schedule.get("weekly_time") or "07:00")
            ):
                key = "weekly"
                if last_sent.get(key) != now.strftime("%Y-%m-%d"):
                    end_day = now.date() - timedelta(days=1)
                    start_day = end_day - timedelta(days=6)
                    _send_configured_report("weekly", start_day.isoformat(), end_day.isoformat())
                    mark_sent(key)
        except Exception:
            pass
        time.sleep(60)


def _start_report_scheduler_once() -> None:
    global _REPORT_SCHED_LOCK_FH
    try:
        _REPORT_SCHED_LOCK_FH = open("/tmp/auditec_report_scheduler.lock", "w")
        fcntl.flock(_REPORT_SCHED_LOCK_FH, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except Exception:
        return
    t = threading.Thread(target=_report_scheduler_loop, daemon=True)
    t.start()


# ─────────────────────────────────────────────────────────
# Startup + static
# ─────────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    _ensure_schema()
    _start_report_scheduler_once()

frontend_dir = os.path.join(BASE_DIR, "frontend")

# Servir AUDITEC.html SIN caché para que el navegador siempre cargue la versión más reciente
_NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}

@app.get("/", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
@app.get("/AUDITEC.html", include_in_schema=False)
async def serve_app():
    return FileResponse(os.path.join(frontend_dir, "AUDITEC.html"), headers=_NO_CACHE)

if os.path.isdir(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8080, reload=True)
