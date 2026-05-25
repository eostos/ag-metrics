"""
Motor de conciliacion AVC <-> SAT y acceso a AVC desde PostgreSQL.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import sqlite3
from bisect import bisect_left, bisect_right
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional, Tuple

try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo

import paramiko
import pandas as pd
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from sshtunnel import open_tunnel


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SETTINGS_DB_PATH = os.path.join(BASE_DIR, "app_settings.db")
MEXICO_TZ = ZoneInfo("America/Mexico_City")
UTC = timezone.utc
SSH_REMOTE_DB_HOST = "127.0.0.1"
FILTER_TS_SQL = 'a."createdAt"'
EVENT_TS_SQL = r"""
COALESCE(
    CASE
        WHEN a."timestamp" IS NULL OR BTRIM(a."timestamp") = '' THEN NULL
        WHEN BTRIM(a."timestamp") ~ '^\d{13}$' THEN to_timestamp((a."timestamp")::double precision / 1000.0)
        WHEN BTRIM(a."timestamp") ~ '^\d{10}$' THEN to_timestamp((a."timestamp")::double precision)
        WHEN BTRIM(a."timestamp") ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$'
            THEN (a."timestamp")::timestamptz
        ELSE NULL
    END,
    a."createdAt"
)
""".strip()

load_dotenv(os.path.join(BASE_DIR, ".env"))


SAT_DESC = {
    0: "Clase no definida",
    1: "A - Auto 2 Ejes",
    2: "C2 - Camion 2 Ejes",
    3: "C3 - Camion 3 Ejes",
    4: "C4 - Camion 4 Ejes",
    5: "C5 - Camion 5 Ejes",
    6: "C6 - Camion 6 Ejes",
    7: "C7 - Camion 7 Ejes",
    8: "C8 - Camion 8 Ejes",
    9: "C9+ - Camion 9 Ejes o mas",
    10: "AR1 - Auto 2 Ejes con Remolque 1 Eje",
    11: "AR2 - Auto 2 Ejes con Remolque 2 Ejes",
    12: "B2 - Autobus 2 Ejes",
    13: "B3 - Autobus 3 Ejes",
    14: "B4 - Autobus 4 Ejes",
    15: "M - Motocicletas",
}

SAT_EJES = {
    0: 0, 1: 2, 2: 2, 3: 3, 4: 4, 5: 5,
    6: 6, 7: 7, 8: 8, 9: 9, 10: 3, 11: 4,
    12: 2, 13: 3, 14: 4, 15: 1,
}

SAT_CODE = {
    0: "-", 1: "A", 2: "C2", 3: "C3", 4: "C4", 5: "C5",
    6: "C6", 7: "C7", 8: "C8", 9: "C9+", 10: "AR1",
    11: "AR2", 12: "B2", 13: "B3", 14: "B4", 15: "M",
}


@dataclass(frozen=True)
class DbConfig:
    host: str
    port: int
    database: str
    user: str
    password: str


@dataclass(frozen=True)
class SshConfig:
    ssh_host: str
    ssh_user: str
    ssh_password: str
    ssh_port: int


def default_db_form() -> Dict[str, str]:
    return {
        "ssh_host": os.getenv("SSH_HOST", ""),
        "ssh_user": os.getenv("SSH_USER", ""),
        "ssh_password": os.getenv("SSH_PASSWORD", ""),
        "ssh_port": os.getenv("SSH_PORT", "22"),
        "media_root": os.getenv("MEDIA_ROOT", "/opt/alice-media"),
        "postgres_host": os.getenv("POSTGRES_HOST", "127.0.0.1"),
        "postgres_port": os.getenv("POSTGRES_PORT", "5432"),
        "postgres_database": os.getenv("POSTGRES_DATABASE", "alice_guardian"),
        "postgres_user": os.getenv("POSTGRES_USER", "postgres"),
        "postgres_password": os.getenv("POSTGRES_PASSWORD", ""),
        "plaza_name": "",
        "timezone": "America/Mexico_City",
        "lane_mapping": "{}",
        "avc_tariffs": "{}",
    }


def settings_keys() -> List[str]:
    return [
        "ssh_host",
        "ssh_user",
        "ssh_password",
        "ssh_port",
        "media_root",
        "postgres_host",
        "postgres_port",
        "postgres_database",
        "postgres_user",
        "postgres_password",
        "plaza_name",
        "timezone",
        "lane_mapping",
        "avc_tariffs",
    ]


def get_event_tz(form_or_name) -> "ZoneInfo":
    """Returns ZoneInfo for the configured timezone (falls back to Mexico_City)."""
    name = form_or_name if isinstance(form_or_name, str) else (form_or_name or {}).get("timezone", "")
    name = (name or "America/Mexico_City").strip()
    try:
        return ZoneInfo(name)
    except Exception:
        return MEXICO_TZ


def ensure_settings_db() -> None:
    with sqlite3.connect(SETTINGS_DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                setting_key TEXT PRIMARY KEY,
                setting_value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


def load_saved_settings() -> Dict[str, str]:
    ensure_settings_db()
    loaded = default_db_form()
    with sqlite3.connect(SETTINGS_DB_PATH) as conn:
        rows = conn.execute(
            "SELECT setting_key, setting_value FROM app_settings"
        ).fetchall()
    for key, value in rows:
        if key in loaded:
            loaded[key] = value
    return loaded


def save_settings(form: dict) -> str:
    ensure_settings_db()
    now_value = datetime.now(UTC).isoformat()
    with sqlite3.connect(SETTINGS_DB_PATH) as conn:
        for key in settings_keys():
            conn.execute(
                """
                INSERT INTO app_settings(setting_key, setting_value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(setting_key) DO UPDATE SET
                    setting_value = excluded.setting_value,
                    updated_at = excluded.updated_at
                """,
                (key, str(form.get(key, "") or ""), now_value),
            )
        conn.commit()
    return SETTINGS_DB_PATH


def _strip(value: Optional[str]) -> str:
    return (value or "").strip()


def build_db_config(form: dict) -> DbConfig:
    return DbConfig(
        host=_strip(form.get("postgres_host")) or "127.0.0.1",
        port=int(_strip(form.get("postgres_port")) or "5432"),
        database=_strip(form.get("postgres_database")) or "alice_guardian",
        user=_strip(form.get("postgres_user")) or "postgres",
        password=form.get("postgres_password", ""),
    )


def build_ssh_config(form: dict) -> Optional[SshConfig]:
    ssh_host = _strip(form.get("ssh_host"))
    ssh_user = _strip(form.get("ssh_user"))
    ssh_password = form.get("ssh_password", "")
    ssh_port = _strip(form.get("ssh_port")) or "22"
    if not (ssh_host and ssh_user and ssh_password):
        return None
    return SshConfig(
        ssh_host=ssh_host,
        ssh_user=ssh_user,
        ssh_password=ssh_password,
        ssh_port=int(ssh_port),
    )


@contextmanager
def ssh_client_connection(form: dict):
    ssh = build_ssh_config(form)
    if ssh is None:
        raise ValueError("Configura SSH Host, SSH User y SSH Password para leer imagenes remotas.")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=ssh.ssh_host,
        port=ssh.ssh_port,
        username=ssh.ssh_user,
        password=ssh.ssh_password,
        timeout=10,
        banner_timeout=10,
        auth_timeout=10,
    )
    try:
        yield client
    finally:
        client.close()


@contextmanager
def db_connection(form: dict):
    db = build_db_config(form)
    ssh = build_ssh_config(form)

    if ssh is None:
        conn = psycopg2.connect(
            host=db.host,
            port=db.port,
            database=db.database,
            user=db.user,
            password=db.password,
            connect_timeout=5,
        )
        try:
            yield conn
        finally:
            conn.close()
        return

    with open_tunnel(
        (ssh.ssh_host, ssh.ssh_port),
        ssh_username=ssh.ssh_user,
        ssh_password=ssh.ssh_password,
        remote_bind_address=(SSH_REMOTE_DB_HOST, db.port),
        local_bind_address=("127.0.0.1", 0),
        set_keepalive=10.0,
    ) as tunnel:
        conn = psycopg2.connect(
            host="127.0.0.1",
            port=tunnel.local_bind_port,
            database=db.database,
            user=db.user,
            password=db.password,
            connect_timeout=5,
        )
        try:
            yield conn
        finally:
            conn.close()


def mexico_day_to_utc_bounds(selected_day: date) -> Tuple[datetime, datetime]:
    local_start = datetime.combine(selected_day, time.min, tzinfo=MEXICO_TZ)
    local_end = local_start + timedelta(days=1)
    return (
        local_start.astimezone(UTC).replace(tzinfo=None),
        local_end.astimezone(UTC).replace(tzinfo=None),
    )


def ensure_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def format_dt(value: Optional[datetime], tz: ZoneInfo) -> Optional[str]:
    if value is None:
        return None
    return ensure_utc(value).astimezone(tz).strftime("%Y-%m-%d %H:%M:%S")


def test_database_connection(form: dict) -> Tuple[bool, str]:
    try:
        with db_connection(form) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
        mode = "SSH" if build_ssh_config(form) else "local"
        return True, f"Conexion OK a PostgreSQL ({mode})."
    except Exception as exc:
        return False, str(exc)


def fetch_lane_options(form: dict) -> List[str]:
    query = """
    SELECT DISTINCT d.name
    FROM public."Devices" d
    INNER JOIN public."AVCs" a
      ON a."deviceId" = d."deviceId"
    WHERE d.name IS NOT NULL
      AND BTRIM(d.name) <> ''
    ORDER BY d.name
    """
    with db_connection(form) as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            return [row[0] for row in cur.fetchall()]


def resolve_remote_media_path(form: dict, image_ref: str) -> str:
    image_ref = (image_ref or "").strip()
    media_root = _strip(form.get("media_root")) or "/opt/alice-media"

    if not image_ref:
        raise ValueError("La referencia de imagen esta vacia.")

    if image_ref.startswith("/opt/") or image_ref.startswith("/home/"):
        return image_ref

    if image_ref.startswith("/"):
        return os.path.join(media_root, image_ref.lstrip("/"))

    return os.path.join(media_root, image_ref)


def fetch_remote_image_bytes(form: dict, image_ref: str) -> Tuple[bytes, str, str]:
    remote_path = resolve_remote_media_path(form, image_ref)
    with ssh_client_connection(form) as client:
        with client.open_sftp() as sftp:
            with sftp.open(remote_path, "rb") as remote_file:
                content = remote_file.read()

    mime_type = mimetypes.guess_type(remote_path)[0] or "image/jpeg"
    return content, mime_type, remote_path


def fetch_avc_dataframe(form: dict, selected_day: date, selected_lane: Optional[str] = None) -> pd.DataFrame:
    # Timezone safe-sanitized (admin-configured, not user input)
    tz_pg = (form.get("timezone") or "America/Mexico_City").strip().replace("'", "").replace(";", "")
    local_tz = get_event_tz(form)

    # WHERE clause: convert DB timestamp to configured tz and compare to selected day
    where_clauses = [
        f"timezone(%s, {FILTER_TS_SQL})::date = %s::date"
    ]
    # params_where: [tz_pg, day_str, optional(lane)]
    params_where: List[object] = [tz_pg, selected_day.isoformat()]

    if selected_lane:
        where_clauses.append("d.name = %s")
        params_where.append(selected_lane)

    query = f"""
    SELECT
        a.id,
        a.vehicle_type,
        a.axle_count,
        a.vehicle_image_path,
        a.vehicle_image_url,
        a.lane_no,
        {EVENT_TS_SQL} AS event_timestamp,
        timezone(%s, {FILTER_TS_SQL}) AS created_at_filter_local,
        a."deviceId" AS device_id,
        d.name AS lane_name,
        CONCAT(a."deviceId", ' - ', d.name) AS device_with_lane,
        a."createdAt" AS created_at,
        a."updatedAt" AS updated_at
    FROM public."AVCs" a
    LEFT JOIN public."Devices" d
      ON d."deviceId" = a."deviceId"
    WHERE {" AND ".join(where_clauses)}
    ORDER BY {EVENT_TS_SQL} DESC, a.id DESC
    """
    # SELECT has one %s (tz_pg), then WHERE has the rest
    params = tuple([tz_pg] + params_where)

    with db_connection(form) as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, params)
            rows = cur.fetchall()

    normalized_rows = []
    for row in rows:
        event_timestamp        = row["event_timestamp"]
        created_at_filter_local = row["created_at_filter_local"]
        created_at             = row["created_at"]
        updated_at             = row["updated_at"]
        effective_utc = ensure_utc(event_timestamp or created_at)

        # event_mexico = hora LOCAL del evento real (a."timestamp"), NO la hora de inserción en DB (a."createdAt")
        # Diferencia típica: a."timestamp" (cuando el vehículo cruzó) vs a."createdAt" (cuando se guardó el registro)
        event_local = (
            format_dt(event_timestamp, local_tz)           # hora real del evento, convertida a tz local
            or (created_at_filter_local.strftime("%Y-%m-%d %H:%M:%S") if created_at_filter_local else None)
            or format_dt(created_at, local_tz)             # último recurso: hora de escritura en DB
        )

        normalized_rows.append(
            {
                "id": row["id"],
                "device_id": row["device_id"],
                "lane_name": row["lane_name"],
                "device_with_lane": row["device_with_lane"] or row["device_id"],
                "lane_no": row["lane_no"],
                "vehicle_type": row["vehicle_type"],
                "axle_count": row["axle_count"],
                "vehicle_image_path": row["vehicle_image_path"],
                "vehicle_image_url": row["vehicle_image_url"],
                "event_utc": effective_utc.isoformat() if effective_utc else None,
                "event_mexico": event_local,
                "created_at_utc": ensure_utc(created_at).isoformat() if created_at else None,
                "created_at_mexico": format_dt(created_at, local_tz),
                "updated_at_mexico": format_dt(updated_at, local_tz),
            }
        )

    return pd.DataFrame(normalized_rows)


def sat_desc(cls):
    c = int(cls) if pd.notna(cls) and str(cls).strip() != "" else 0
    return SAT_DESC.get(c, f"cls {c}")


def sat_ejes(cls):
    c = int(cls) if pd.notna(cls) and str(cls).strip() != "" else 0
    return SAT_EJES.get(c, 0)


def cat_of(cls):
    c = int(cls) if pd.notna(cls) and str(cls).strip() != "" else 0
    if c == 15:
        return "moto"
    if c == 1:
        return "auto"
    if c in (10, 11):
        return "auto_rem"
    if 12 <= c <= 14:
        return "bus"
    if 2 <= c <= 9:
        return "truck"
    return "indefinido"


def map_avc_class(vehicle_type: str, axles: int) -> int:
    vt = str(vehicle_type or "").lower().strip()
    ax = int(axles) if pd.notna(axles) else 0
    if "motorcycle" in vt or "moto" in vt:
        return 15
    if "light" in vt or vt in ("auto", "car"):
        return 1
    if "bus" in vt:
        if ax <= 2:
            return 12
        if ax == 3:
            return 13
        return 14
    if "truck" in vt or "camion" in vt or "camion" in vt:
        if ax < 2:
            return 0
        return 9 if ax >= 9 else ax
    if ax == 2:
        return 1
    if ax >= 9:
        return 9
    return ax or 0


def is_class_compatible(avc_cls: int, sat_cls: int, tab_cls: int) -> bool:
    if avc_cls == 0:
        return False
    if sat_cls == avc_cls or tab_cls == avc_cls:
        return True
    return False


def compat_reason(avc_cls, sat_cls, tab_cls):
    ac, sc, tc = int(avc_cls or 0), int(sat_cls or 0), int(tab_cls or 0)
    if ac == 0:
        return "AVC_cls=0_error_conteo"
    if sc == ac or tc == ac:
        return "exacto"
    return f"INCOMPAT(AVC:{ac}[{cat_of(ac)}] SAT:{sc}[{cat_of(sc)}]/TAB:{tc}[{cat_of(tc)}])"


def compare_ejes(avc_axles, sat_cls, tab_cls):
    ax = int(avc_axles or 0)
    sc = int(sat_cls or 0)
    tc = int(tab_cls or 0)
    if sc == 15 or tc == 15:
        return "OK_MOTO", "OK_MOTO", "OK_MOTO"
    eff = sat_ejes(tc if sc == 0 else sc)
    if ax == eff:
        return f"OK({ax}={eff})", f"OK({ax}={eff})", "OK"
    return (
        f"ERROR_DETECCION_AVC(AVC:{ax} SAT:{sat_ejes(sc)})",
        f"ERROR_DETECCION_AVC(AVC:{ax} TAB:{sat_ejes(tc)})" if tc else "N/A",
        f"ERROR_DETECCION_EJES_AVC(AVC:{ax} SAT:{eff})",
    )


def parse_date(v):
    if pd.isna(v) or v == "" or v is None:
        return pd.NaT
    if isinstance(v, (datetime, pd.Timestamp)):
        return pd.Timestamp(v)
    s = str(v).strip()
    m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})\s+(\d{2})", s)
    if m:
        try:
            return pd.Timestamp(f"{int(m[1]):04d}-{int(m[2]):02d}-{int(m[3]):02d} {int(m[4]):02d}:{m[5]}:{m[6]}")
        except Exception:
            pass
    for fmt in (
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S.%f",
        "%d/%m/%Y %H:%M:%S",
        "%Y-%m-%d",
        "%d/%m/%Y",
    ):
        try:
            return pd.Timestamp(datetime.strptime(s, fmt))
        except ValueError:
            pass
    try:
        return pd.Timestamp(s)
    except Exception:
        return pd.NaT


def load_file(uploaded_file) -> pd.DataFrame:
    name = uploaded_file.name.lower()
    if name.endswith(".json"):
        data = json.load(uploaded_file)
        if isinstance(data, list):
            return pd.DataFrame(data)
        for key, val in data.items():
            if isinstance(val, list) and val and isinstance(val[0], dict):
                return pd.DataFrame(val)
        raise ValueError("No se encontro un array de registros en el JSON")
    if name.endswith(".csv"):
        return pd.read_csv(uploaded_file, dtype=str)
    if name.endswith((".xlsx", ".xlsm")):
        return pd.read_excel(uploaded_file, dtype=str)
    if name.endswith(".xls"):
        return pd.read_excel(uploaded_file, engine="xlrd", dtype=str)
    raise ValueError(f"Formato no soportado: {name}")


def detect_col(cols, patterns, exclude=None):
    exclude = exclude or []
    for pat in patterns:
        for col in cols:
            if re.search(pat, col, re.IGNORECASE) and col not in exclude:
                return col
    return None


def reconcile(
    avc_df: pd.DataFrame,
    sat_df: pd.DataFrame,
    avc_lane: str,
    sat_lane: str,
    fecha: str,
    ventana: int,
    col_avc_date: str,
    col_avc_device: str,
    col_avc_type: str,
    col_avc_axles: str,
    col_avc_id: str,
    col_sat_date: str,
    col_sat_voie: str,
    col_sat_cls: str,
    col_sat_tab: str,
    col_sat_num: str,
    col_sat_prix: str,
    progress_callback=None,
) -> pd.DataFrame:
    avc_df = avc_df.copy()
    sat_df = sat_df.copy()
    avc_df["_ts"] = avc_df[col_avc_date].apply(parse_date)
    sat_df["_ts"] = sat_df[col_sat_date].apply(parse_date)

    avc_f = avc_df[
        (avc_df[col_avc_device].astype(str).str.strip() == avc_lane.strip()) &
        (avc_df["_ts"].dt.strftime("%Y-%m-%d") == fecha)
    ].sort_values("_ts").reset_index(drop=True)

    sat_f = sat_df[
        (sat_df[col_sat_voie].astype(str).str.strip() == sat_lane.strip()) &
        (sat_df["_ts"].dt.strftime("%Y-%m-%d") == fecha)
    ].sort_values("_ts").reset_index(drop=True)

    # Pre-extraer timestamps SAT como floats para búsqueda binaria O(log n)
    def _int_cls(val) -> int:
        try:
            return int(float(val)) if val != "" and val is not None and not (isinstance(val, float) and pd.isna(val)) else 0
        except Exception:
            return 0

    sat_ts_s: List[float] = [
        ts.timestamp() if not pd.isna(ts) else float("inf")
        for ts in sat_f["_ts"]
    ]
    sat_cls_pre = [_int_cls(sat_f.at[j, col_sat_cls]) for j in range(len(sat_f))]
    sat_tab_pre = [_int_cls(sat_f.at[j, col_sat_tab]) for j in range(len(sat_f))]

    used_sat: set = set()
    rows = []
    n_avc = len(avc_f)

    def safe(df, col, idx):
        try:
            value = df.at[idx, col]
            return "" if pd.isna(value) else value
        except Exception:
            return ""

    def sat_extra_fields(j):
        return {
            "sat_day_id": safe(sat_f, "day_id", j),
            "sat_id_gare": safe(sat_f, "id_gare", j),
            "sat_id_voie": safe(sat_f, "id_voie", j),
            "sat_id_mode_voie": safe(sat_f, "id_mode_voie", j),
            "sat_numero_poste": safe(sat_f, "numero_poste", j),
            "sat_matricule": safe(sat_f, "matricule", j),
            "sat_id_obs_mp": safe(sat_f, "id_obs_mp", j),
            "sat_id_obs_sequence": safe(sat_f, "id_obs_sequence", j),
            "sat_id_obs_passage": safe(sat_f, "id_obs_passage", j),
            "sat_id_paiement": safe(sat_f, "id_paiement", j),
            "sat_mode_reglement": safe(sat_f, "mode_reglement", j),
            "sat_fh_carga": safe(sat_f, "fh_carga", j),
        }

    for i in range(n_avc):
        if progress_callback and i % 50 == 0:
            progress_callback(i / n_avc)

        ts_avc = avc_f.at[i, "_ts"]
        if pd.isna(ts_avc):
            continue
        ts_avc_s = ts_avc.timestamp()

        vt = str(safe(avc_f, col_avc_type, i) or "")
        ax_raw = safe(avc_f, col_avc_axles, i)
        ax = int(float(ax_raw)) if ax_raw != "" else 0
        avc_cls = map_avc_class(vt, ax)
        avc_id = safe(avc_f, col_avc_id, i)

        # SAT ocurre ANTES que AVC: ventana asimétrica
        # Busca SAT en [avc_ts - ventana, avc_ts + 30s] ordenados de menor a mayor
        _SAT_AFTER_TOLERANCE = 30  # segundos de tolerancia por desfase de relojes
        lo = bisect_left(sat_ts_s,  ts_avc_s - ventana)
        hi = bisect_right(sat_ts_s, ts_avc_s + _SAT_AFTER_TOLERANCE)

        cands = []
        for j in range(lo, hi):
            if j in used_sat:
                continue
            delta = sat_ts_s[j] - ts_avc_s  # negativo = SAT antes de AVC (correcto)
            sc = sat_cls_pre[j]
            tc = sat_tab_pre[j]
            cands.append({"j": j, "delta": delta, "abs_delta": abs(delta), "sc": sc, "tc": tc})

        # Prioridad: SAT antes de AVC (delta <= 0), luego por proximidad temporal
        cands.sort(key=lambda c: (0 if c["delta"] <= 0 else 1, c["abs_delta"]))
        diag = " | ".join(
            f"#{c['j']}[D{round(c['delta'])}s cls{c['sc']}/tab{c['tc']}->{compat_reason(avc_cls, c['sc'], c['tc'])}]"
            for c in cands[:8]
        ) or f"sin_candidatos_en_ventana+-{ventana}s"

        chosen = next((c for c in cands if is_class_compatible(avc_cls, c["sc"], c["tc"])), None)

        if chosen:
            used_sat.add(chosen["j"])
            j = chosen["j"]
            sc_val = safe(sat_f, col_sat_cls, j)
            tc_val = safe(sat_f, col_sat_tab, j)
            sc = int(float(sc_val or 0))
            tc = int(float(tc_val or 0))
            comp_id, comp_tab, nota = compare_ejes(ax, sc, tc)
            dir_delta = f"SAT_antes_AVC_{abs(round(chosen['delta']))}s" if chosen["delta"] <= 0 else f"SAT_despues_AVC_{round(chosen['delta'])}s_ATIPICO"
            obs = (
                "Motocicleta conciliada" if nota == "OK_MOTO"
                else "Match correcto - ejes coinciden" if nota == "OK"
                else f"Match valido - error deteccion ejes AVC: {nota}"
            )
            rows.append(
                {
                    "tipo": "MATCH",
                    "avc_id": avc_id,
                    "avc_device": safe(avc_f, col_avc_device, i),
                    "avc_date": str(safe(avc_f, col_avc_date, i)),
                    "avc_image_url": safe(avc_f, "vehicle_image_url", i),
                    "avc_image_path": safe(avc_f, "vehicle_image_path", i),
                    "Vehicle_type": vt,
                    "axles_avc": ax,
                    "clase_avc_mapeada": avc_cls,
                    "sat_voie": safe(sat_f, col_sat_voie, j),
                    "sat_date": str(safe(sat_f, col_sat_date, j)),
                    "sat_numero": safe(sat_f, col_sat_num, j),
                    "sat_prix": safe(sat_f, col_sat_prix, j),
                    **sat_extra_fields(j),
                    "id_classe": sc_val,
                    "tab_id_classe": tc_val,
                    "sat_id_classe_desc": sat_desc(sc),
                    "sat_id_classe_ejes": sat_ejes(sc),
                    "sat_tab_id_classe_desc": sat_desc(tc),
                    "sat_tab_id_classe_ejes": sat_ejes(tc),
                    "comparacion_ejes_id": comp_id,
                    "comparacion_ejes_tab": comp_tab,
                    "nota_ejes": nota,
                    "delta_segundos": round(chosen["delta"]),
                    "direccion_delta": dir_delta,
                    "match_valido": True,
                    "motivo_no_match": "",
                    "observacion_auditoria": obs,
                    "candidatos_sat": diag,
                }
            )
        else:
            motivo = (
                "error_conteo_avc" if avc_cls == 0
                else "moto_detectada_solo_por_avc" if avc_cls == 15
                else "clase_distinta" if cands
                else "SAT_no_detecto"
            )
            obs = (
                "AVC sin ejes validos - error de conteo" if avc_cls == 0
                else "Motocicleta AVC - sin SAT correspondiente" if avc_cls == 15
                else f"SAT en ventana pero clase incompatible - AVC:{avc_cls}" if cands
                else f"Sin eventos SAT en ventana +- {ventana}s"
            )
            rows.append(
                {
                    "tipo": "AVC",
                    "avc_id": avc_id,
                    "avc_device": safe(avc_f, col_avc_device, i),
                    "avc_date": str(safe(avc_f, col_avc_date, i)),
                    "avc_image_url": safe(avc_f, "vehicle_image_url", i),
                    "avc_image_path": safe(avc_f, "vehicle_image_path", i),
                    "Vehicle_type": vt,
                    "axles_avc": ax,
                    "clase_avc_mapeada": avc_cls,
                    **{
                        key: "" for key in [
                            "sat_voie", "sat_date", "sat_numero", "sat_prix",
                            "sat_day_id", "sat_id_gare", "sat_id_voie",
                            "sat_id_mode_voie", "sat_numero_poste",
                            "sat_matricule", "sat_id_obs_mp",
                            "sat_id_obs_sequence", "sat_id_obs_passage",
                            "sat_id_paiement", "sat_mode_reglement",
                            "sat_fh_carga",
                            "id_classe", "tab_id_classe",
                            "sat_id_classe_desc", "sat_id_classe_ejes",
                            "sat_tab_id_classe_desc", "sat_tab_id_classe_ejes",
                            "comparacion_ejes_id", "comparacion_ejes_tab",
                            "nota_ejes", "delta_segundos", "direccion_delta",
                        ]
                    },
                    "match_valido": False,
                    "motivo_no_match": motivo,
                    "observacion_auditoria": obs,
                    "candidatos_sat": diag,
                }
            )

    if progress_callback:
        progress_callback(1.0)

    for j in range(len(sat_f)):
        if j in used_sat:
            continue
        sc_val = safe(sat_f, col_sat_cls, j)
        tc_val = safe(sat_f, col_sat_tab, j)
        sc = _int_cls(sc_val)
        tc = _int_cls(tc_val)
        eff = tc or sc
        motivo = (
            "moto_SAT_sin_AVC" if eff == 15
            else "SAT_clase_indefinida" if sc == 0
            else "AVC_no_detecto"
        )
        rows.append(
            {
                "tipo": "SAT",
                **{key: "" for key in ["avc_id", "avc_device", "avc_date", "avc_image_url", "avc_image_path", "Vehicle_type", "axles_avc", "clase_avc_mapeada"]},
                "sat_voie": safe(sat_f, col_sat_voie, j),
                "sat_date": str(safe(sat_f, col_sat_date, j)),
                "sat_numero": safe(sat_f, col_sat_num, j),
                "sat_prix": safe(sat_f, col_sat_prix, j),
                **sat_extra_fields(j),
                "id_classe": sc_val,
                "tab_id_classe": tc_val,
                "sat_id_classe_desc": sat_desc(sc),
                "sat_id_classe_ejes": sat_ejes(sc),
                "sat_tab_id_classe_desc": sat_desc(tc),
                "sat_tab_id_classe_ejes": sat_ejes(tc),
                **{key: "" for key in ["comparacion_ejes_id", "comparacion_ejes_tab", "nota_ejes", "delta_segundos", "direccion_delta"]},
                "match_valido": False,
                "motivo_no_match": motivo,
                "observacion_auditoria": "SAT sin AVC - posible vehiculo no detectado",
                "candidatos_sat": "",
            }
        )

    result = pd.DataFrame(rows)
    if result.empty:
        return result

    result["_sort_key"] = result.apply(
        lambda r: parse_date(r["avc_date"]) if r["avc_date"] else parse_date(r["sat_date"]),
        axis=1,
    )
    result = result.sort_values("_sort_key").drop(columns=["_sort_key"]).reset_index(drop=True)
    result.index += 1
    return result
