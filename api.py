"""
AUDITEC — FastAPI backend
Soporta dos tipos de integración AVC:
  - 'database': PostgreSQL via SSH (usa engine.py)
  - 'api':      Alice Guardian REST API
Los eventos se almacenan localmente en SQLite para acceso rápido.
Run: uvicorn api:app --host 0.0.0.0 --port 8080 --reload
"""
from __future__ import annotations

import glob
import hashlib
import json
import os
import re
import secrets
import sqlite3
from datetime import date, datetime, timedelta
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
    load_saved_settings,
    parse_date,
    reconcile,
    save_settings,
)

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
MERGED_DIR = os.path.expanduser("~/sat_merged")
WATCH_DIR  = "/home/sftpuser/uploads"

app = FastAPI(title="AUDITEC API", docs_url="/api/docs")

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


# ─────────────────────────────────────────────────────────
# Startup + static
# ─────────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    _ensure_schema()

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
