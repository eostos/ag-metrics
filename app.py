"""
Aplicacion Streamlit para conciliacion AVC (BD) / SAT (archivo).
"""
from __future__ import annotations

import glob
import io
import json
import os
import re
import traceback
from datetime import date, datetime, timedelta
from typing import List

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from engine import (
    SAT_CODE,
    SAT_DESC,
    SAT_EJES,
    default_db_form,
    detect_col,
    fetch_avc_dataframe,
    fetch_lane_options,
    fetch_remote_image_bytes,
    load_saved_settings,
    load_file,
    parse_date,
    reconcile,
    save_settings,
    test_database_connection,
)
import streamlit as st

# Inicializar claves en st.session_state si no existen
if "db_test_msg" not in st.session_state:
    st.session_state["db_test_msg"] = None  # O un valor prede

st.set_page_config(
    page_title="AUDITEC AVC/SAT - BD",
    page_icon="🚦",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
<style>
[data-testid="stAppViewContainer"] { background: #0d0f12; }
[data-testid="stSidebar"] { background: #131720; border-right: 1px solid #2a3045; }
h1,h2,h3,h4 { color: #00d4aa; }
.stDataFrame { font-size: 11px; }
.metric-ok { color: #22c97b; font-size: 1.8rem; font-weight: 700; }
.metric-err { color: #ff4c6a; font-size: 1.8rem; font-weight: 700; }
.metric-warn { color: #ffaa00; font-size: 1.8rem; font-weight: 700; }
.metric-moto { color: #5b9cf6; font-size: 1.8rem; font-weight: 700; }
</style>
""",
    unsafe_allow_html=True,
)


def init_state() -> None:
    defaults = load_saved_settings()
    for key in [
        "avc_df", "sat_df", "result_df", "run_done",
        "lane_options", "db_test_ok", "db_test_msg",
    ]:
        if key not in st.session_state:
            st.session_state[key] = None if key.endswith("_df") or key == "db_test_msg" else False
    if not isinstance(st.session_state.get("lane_options"), list):
        st.session_state.lane_options = []
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value
    if "query_date" not in st.session_state:
        st.session_state.query_date = date.today()
    if "selected_db_lane" not in st.session_state:
        st.session_state.selected_db_lane = ""
    if "sat_upload_name" not in st.session_state:
        st.session_state.sat_upload_name = ""
    if "sat_source" not in st.session_state:
        st.session_state.sat_source = None
    if "debug_mode" not in st.session_state:
        st.session_state.debug_mode = True


def fmt_ts(ts):
    if pd.isna(ts):
        return "-"
    return pd.Timestamp(ts).strftime("%d/%m/%Y %H:%M:%S")


def file_analysis(df, label):
    cols = df.columns.tolist()
    date_col = (
        detect_col(cols, [r"^date_transaction$", r"^event_mexico$", r"^created_at_mexico$"])
        or detect_col(cols, [r"date", r"time", r"hora", r"fecha"])
    )
    lane_col = detect_col(cols, [r"^voie$", r"^lane_name$", r"^device_with_lane$", r"voie|device|carril|lane"])

    st.markdown(f"#### {label}")
    c1, c2 = st.columns(2)
    c1.metric("Total eventos", f"{len(df):,}")

    if date_col:
        ts = df[date_col].apply(parse_date)
        valid = ts.dropna()
        if not valid.empty:
            mn, mx = valid.min(), valid.max()
            span = (mx - mn).total_seconds()
            hours = int(span // 3600)
            minutes = int((span % 3600) // 60)
            seconds = int(span % 60)
            dur = f"{hours}h {minutes}m {seconds}s" if hours else f"{minutes}m {seconds}s"
            c2.metric("Duracion", dur)
            st.markdown(
                f"""
| | Timestamp |
|---|---|
| Primer evento | `{fmt_ts(mn)}` |
| Ultimo evento | `{fmt_ts(mx)}` |
| Columna fecha | `{date_col}` |
"""
            )
            days = ts.dropna().dt.strftime("%Y-%m-%d").value_counts().sort_index()
            st.markdown("**Dias disponibles:**")
            for day_value, count in days.items():
                st.markdown(f"- `{day_value}` -> **{count}** eventos")
        else:
            c2.metric("Duracion", "-")
            st.warning(f"Columna `{date_col}` encontrada pero sin fechas parseables.")
    else:
        c2.metric("Duracion", "-")
        st.warning("No se detecto columna de fecha.")

    if lane_col:
        lanes = df[lane_col].astype(str).str.strip().value_counts().sort_index()
        st.markdown("**Carriles:**")
        for lane_value, count in lanes.items():
            st.markdown(f"- `{lane_value}` -> {count}")


def reset_results() -> None:
    st.session_state.result_df = None
    st.session_state.run_done = False


def show_debug_exception(context: str, exc: Exception) -> None:
    st.error(f"{context}: {exc}")
    if st.session_state.get("debug_mode"):
        with st.expander(f"Debug details - {context}", expanded=True):
            st.code(traceback.format_exc())


def render_selected_event_image(selected_df: pd.DataFrame, title: str) -> None:
    if selected_df.empty:
        return

    row = selected_df.iloc[0]
    if str(row.get("tipo", "")) == "SAT":
        st.info("La fila seleccionada es SAT y no trae evidencia AVC.")
        return

    image_url  = str(row.get("avc_image_url",  "") or "").strip()
    image_path = str(row.get("avc_image_path", "") or "").strip()

    st.markdown(f"#### Evidencia AVC - {title}")
    meta1, meta2, meta3 = st.columns(3)
    meta1.markdown(f"**AVC ID:** `{row.get('avc_id', '')}`")
    meta2.markdown(f"**Carril:** `{row.get('avc_device', '')}`")
    meta3.markdown(f"**Fecha:** `{row.get('avc_date', '')}`")

    # Debug: muestra los valores crudos para diagnostico
    if st.session_state.get("debug_mode"):
        with st.expander("Debug imagen", expanded=True):
            st.caption(f"**avc_image_url:**  `{image_url  or '(vacío)'}`")
            st.caption(f"**avc_image_path:** `{image_path or '(vacío)'}`")
            ssh_ok = bool(
                st.session_state.get("ssh_host") and
                st.session_state.get("ssh_user") and
                st.session_state.get("ssh_password")
            )
            st.caption(f"**SSH configurado:** {'✓' if ssh_ok else '✗ — configura SSH Host/User/Password'}")
            st.caption(f"**Media Root:** `{st.session_state.get('media_root') or '/opt/alice-media'}`")

    def try_remote(ref: str, label: str) -> bool:
        """Intenta traer la imagen via SSH SFTP. Retorna True si tuvo exito."""
        try:
            img_bytes, mime, resolved = fetch_remote_image_bytes(st.session_state, ref)
            st.image(img_bytes, caption=f"AVC {row.get('avc_id', '')}", width=420)
            st.caption(f"SSH ({label}): `{resolved}` — {mime}")
            return True
        except Exception as exc:
            if st.session_state.get("debug_mode"):
                show_debug_exception(f"SSH {label}", exc)
            return False

    def try_local(ref: str) -> bool:
        if not os.path.exists(ref):
            return False
        try:
            st.image(ref, caption=f"AVC {row.get('avc_id', '')}", width=420)
            st.caption(f"Local: `{ref}`")
            return True
        except Exception as exc:
            if st.session_state.get("debug_mode"):
                show_debug_exception("Local imagen", exc)
            return False

    _LOCALHOST = ("http://localhost", "http://127.0.0.1", "https://localhost", "https://127.0.0.1")

    # --- Intentos ordenados por probabilidad de exito ---

    # 1. URL web publica (no localhost)
    if image_url.lower().startswith(("http://", "https://", "data:image/")) and \
       not image_url.lower().startswith(_LOCALHOST):
        try:
            st.image(image_url, caption=f"AVC {row.get('avc_id', '')}", width=420)
            st.caption(f"URL: `{image_url}`")
            return
        except Exception as exc:
            show_debug_exception("URL publica", exc)

    # 2. URL localhost → extraer path y buscar via SSH
    if image_url.lower().startswith(_LOCALHOST):
        from urllib.parse import urlparse as _urlparse
        _path = _urlparse(image_url).path
        if try_local(_path) or try_remote(_path, "image_url(localhost)"):
            return

    # 3. image_url como ruta de archivo (absoluta o relativa)
    if image_url and not image_url.lower().startswith(("http://", "https://")):
        if try_local(image_url) or try_remote(image_url, "image_url"):
            return

    # 4. image_path
    if image_path:
        if try_local(image_path) or try_remote(image_path, "image_path"):
            return

    # Sin imagen encontrada
    if image_url or image_path:
        st.warning("No se pudo cargar la imagen. Activa **Debug mode** para ver detalles.")
    else:
        st.info("Este evento AVC no tiene imagen registrada en la base de datos.")


def render_selectable_result_table(df: pd.DataFrame, show_cols: List[str], key: str, title: str) -> None:
    if df.empty:
        st.info("Sin resultados en esta vista.")
        return

    _ed_cols = [c for c in show_cols if c in df.columns]

    # Columna de estado visual (emojis + texto)
    def _estado(row):
        if bool(row.get("match_valido", False)):
            return "✅ Match"
        tipo = str(row.get("tipo", ""))
        if tipo == "AVC":
            return "🟠 AVC sin match"
        if tipo == "SAT":
            return "🔵 SAT sin AVC"
        return "—"

    df_edit = df[_ed_cols].copy()
    df_edit.insert(0, "📷", False)
    df_edit.insert(1, "Estado", df.apply(_estado, axis=1))

    col_table, col_img = st.columns([3, 2])

    with col_table:
        edited = st.data_editor(
            df_edit,
            column_config={
                "📷":    st.column_config.CheckboxColumn("📷", default=False, width="small"),
                "Estado": st.column_config.TextColumn("Estado", width="medium"),
            },
            disabled=_ed_cols + ["Estado"],
            hide_index=False,
            use_container_width=True,
            height=540,
            key=key + "_editor",
        )

    with col_img:
        cur_checked  = set(edited.index[edited["📷"] == True].tolist())
        prev_key     = key + "_prev_checked"
        active_key   = key + "_active_idx"
        prev_checked = st.session_state.get(prev_key, set())

        # Detectar fila recien marcada
        newly_checked = cur_checked - prev_checked
        if newly_checked:
            st.session_state[active_key]  = min(newly_checked)
            st.session_state[prev_key]    = cur_checked
        elif not cur_checked:
            # Todo desmarcado
            st.session_state[active_key]  = None
            st.session_state[prev_key]    = set()

        active_idx = st.session_state.get(active_key)
        if active_idx is not None and active_idx in df.index:
            render_selected_event_image(df.loc[[active_idx]], title)
        else:
            st.info("Marca la casilla 📷 en una fila para ver la evidencia.")


init_state()

st.markdown("# AUDITEC - Conciliacion AVC / SAT desde BD")

with st.sidebar:
    st.markdown("## AUDITEC")
    st.markdown("AVC desde PostgreSQL + SAT desde archivo")
    st.checkbox("Debug mode", key="debug_mode")
    st.divider()

    with st.expander("Permisos de acceso a uploads", expanded=False):
        st.caption(
            "Necesario la primera vez para que la app pueda "
            "escribir y borrar en `/home/sftpuser/uploads/`."
        )
        _sudo_pw = st.text_input("Contraseña sudo", type="password", key="sudo_pw")
        if st.button("Aplicar permisos", key="btn_sudo_perms"):
            if not _sudo_pw:
                st.warning("Ingresa la contraseña sudo.")
            else:
                import subprocess
                _cmds = [
                    ["sudo", "-S", "usermod", "-aG", "sftpuser", "agholdings"],
                    ["sudo", "-S", "chmod", "g+w", "/home/sftpuser/uploads/"],
                ]
                _all_ok = True
                for _cmd in _cmds:
                    try:
                        _r = subprocess.run(
                            _cmd,
                            input=(_sudo_pw + "\n").encode(),
                            capture_output=True,
                            timeout=10,
                        )
                        if _r.returncode != 0:
                            _err = _r.stderr.decode(errors="replace").strip()
                            st.error(f"`{' '.join(_cmd[2:])}` falló: {_err}")
                            _all_ok = False
                    except Exception as _exc:
                        st.error(f"Error ejecutando comando: {_exc}")
                        _all_ok = False
                if _all_ok:
                    st.success(
                        "Permisos aplicados. Reinicia la app (Ctrl+C y volver a correr) "
                        "para que el grupo tome efecto."
                    )

    st.divider()
    st.markdown("### 1 - Conexion AVC")
    st.text_input("SSH Host", key="ssh_host")
    st.text_input("SSH User", key="ssh_user")
    st.text_input("SSH Password", key="ssh_password", type="password")
    st.text_input("SSH Port", key="ssh_port")
    st.text_input("Media Root", key="media_root", help="Raiz remota para evidencias tipo /axle/... por defecto /opt/alice-media")

    st.text_input("Postgres Host", key="postgres_host")
    st.text_input("Postgres Port", key="postgres_port")
    st.text_input("Database", key="postgres_database")
    st.text_input("User", key="postgres_user")
    st.text_input("Password", key="postgres_password", type="password")

    save_col, load_col = st.columns(2)
    with save_col:
        if st.button("Guardar credenciales", use_container_width=True):
            try:
                db_path = save_settings(st.session_state)
                st.success(f"Credenciales guardadas en SQLite: {db_path}")
            except Exception as exc:
                show_debug_exception("Error guardando credenciales", exc)
    with load_col:
        if st.button("Recargar credenciales", use_container_width=True):
            try:
                saved = load_saved_settings()
                for key, value in saved.items():
                    st.session_state[key] = value
                st.success("Credenciales recargadas desde SQLite.")
                st.rerun()
            except Exception as exc:
                show_debug_exception("Error recargando credenciales", exc)

    if st.button("Probar conexion", use_container_width=True):
        try:
            ok, msg = test_database_connection(st.session_state)
            st.session_state.db_test_ok = ok
            st.session_state.db_test_msg = msg
            if ok:
                try:
                    st.session_state.lane_options = [""] + fetch_lane_options(st.session_state)
                except Exception as exc:
                    st.session_state.lane_options = []
                    st.session_state.db_test_msg = f"{msg} Pero no pude cargar carriles: {exc}"
                    show_debug_exception("Error cargando carriles AVC", exc)
        except Exception as exc:
            st.session_state.db_test_ok = False
            st.session_state.db_test_msg = str(exc)
            show_debug_exception("Error probando conexion", exc)

    if st.session_state.db_test_msg:
        if st.session_state.db_test_ok:
            st.success(st.session_state.db_test_msg)
        else:
            st.error(st.session_state.db_test_msg)

    st.date_input("Fecha AVC", key="query_date")
    lane_options = st.session_state.lane_options or [""]
    st.selectbox(
        "Carril AVC desde BD",
        lane_options,
        key="selected_db_lane",
        format_func=lambda value: "Todos" if value == "" else value,
        help="Primero prueba conexion para cargar los carriles.",
    )

    if st.button("Cargar AVC desde BD", type="primary", use_container_width=True):
        try:
            st.session_state.avc_df = fetch_avc_dataframe(
                st.session_state,
                st.session_state.query_date,
                st.session_state.selected_db_lane or None,
            )
            reset_results()
            st.success(f"AVC cargado: {len(st.session_state.avc_df):,} registros")
        except Exception as exc:
            show_debug_exception("Error cargando AVC", exc)

    st.divider()
    st.markdown("### 2 - Merge SAT desde Uploads")
    _watch_dir = "/home/sftpuser/uploads"
    _out_dir   = os.path.expanduser("~/sat_merged")

    # Descubrir todos los dias unicos con archivos pendientes en el directorio
    _all_files = [
        f for f in glob.glob(os.path.join(_watch_dir, "SAT-TEXCOCO-????????*.json"))
        if not os.path.basename(f).endswith("-MERGED.json")
    ]
    _days_found: dict[str, list] = {}
    for _fp in _all_files:
        _m = re.match(r"SAT-TEXCOCO-(\d{8})", os.path.basename(_fp))
        if _m:
            _ds = _m.group(1)
            _days_found.setdefault(_ds, []).append(_fp)
    # Ordenar de mas reciente a mas antiguo
    _days_sorted = sorted(_days_found.keys(), reverse=True)

    if not _days_sorted:
        st.info("No hay archivos pendientes en uploads.")
    else:
        today_d = date.today()

        def _day_label(ds: str) -> str:
            try:
                d = datetime.strptime(ds, "%Y%m%d").date()
                diff = (today_d - d).days
                suffix = {0: " (Hoy)", 1: " (Ayer)", 2: " (Antes de ayer)"}.get(diff, "")
                return f"{d.strftime('%d/%m/%Y')}{suffix} — {len(_days_found[ds])} archivo(s)"
            except Exception:
                return ds

        _opts = [_ds for _ds in _days_sorted]
        _opt_labels = {_ds: _day_label(_ds) for _ds in _opts}
        _sel_days = st.multiselect(
            "Dias a mergear",
            _opts,
            default=_opts,
            format_func=lambda ds: _opt_labels.get(ds, ds),
            key="merge_sel_days",
        )

        # Mostrar resumen de lo seleccionado
        for _ds in _sel_days:
            _merged_exists = os.path.exists(os.path.join(_out_dir, f"SAT-TEXCOCO-{_ds}-MERGED.json"))
            _merged_badge  = " · MERGED existe ✓" if _merged_exists else ""
            st.caption(f"{_opt_labels[_ds]}{_merged_badge}")

        if st.button("Ejecutar Merge", type="primary", key="btn_merge_dias"):
            os.makedirs(_out_dir, exist_ok=True)
            _total_files, _total_txns = 0, 0
            for _ds in _sel_days:
                _files = sorted(_days_found[_ds])
                _mp    = os.path.join(_out_dir, f"SAT-TEXCOCO-{_ds}-MERGED.json")
                if os.path.exists(_mp):
                    try:
                        with open(_mp, "r", encoding="utf-8") as _fh:
                            _merged = json.load(_fh)
                    except Exception:
                        _merged = {"batchuid": f"SAT-TEXCOCO-{_ds}-MERGED", "sourcesystem": "SATTexcoco", "generatedat": "", "transactions": [], "processed_batches": []}
                else:
                    _merged = {"batchuid": f"SAT-TEXCOCO-{_ds}-MERGED", "sourcesystem": "SATTexcoco", "generatedat": "", "transactions": [], "processed_batches": []}
                # Set de batchuids ya procesados para evitar duplicados
                _done_batches = set(_merged.get("processed_batches", []))
                _day_added, _day_files, _day_no_delete = 0, 0, 0
                for _fp in _files:
                    try:
                        with open(_fp, "rb") as _fh:
                            _raw = _fh.read()
                        _raw = _raw.replace(b',"\r\n,"', b',"').replace(b"\r\n", b"").replace(b"\r", b"")
                        _fdata = json.loads(_raw.decode("utf-8", errors="replace").strip())
                        _batch_id = _fdata.get("batchuid", os.path.basename(_fp))
                        if _batch_id in _done_batches:
                            # Ya procesado, solo intentar borrar
                            try:
                                os.remove(_fp)
                            except Exception:
                                pass
                            continue
                        _merged["transactions"].extend(_fdata.get("transactions", []))
                        _done_batches.add(_batch_id)
                        _day_added += len(_fdata.get("transactions", []))
                        _day_files += 1
                    except Exception as _exc:
                        st.warning(f"Error leyendo {os.path.basename(_fp)}: {_exc}")
                        continue
                    try:
                        os.remove(_fp)
                    except PermissionError:
                        _day_no_delete += 1
                    except Exception as _exc:
                        st.warning(f"No se pudo borrar {os.path.basename(_fp)}: {_exc}")
                if _day_no_delete:
                    st.warning(
                        f"{_day_no_delete} archivo(s) no se pudieron borrar por permisos. "
                        "Usa el expander **Permisos de acceso a uploads** para solucionarlo."
                    )
                _merged["generatedat"]     = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
                _merged["processed_batches"] = sorted(_done_batches)
                _tmp = _mp + ".tmp"
                with open(_tmp, "w", encoding="utf-8") as _fh:
                    json.dump(_merged, _fh, ensure_ascii=False)
                os.replace(_tmp, _mp)
                _total_files += _day_files
                _total_txns  += _day_added
                st.success(
                    f"**{_opt_labels[_ds]}**: {_day_files} archivos, {_day_added} txns nuevas. "
                    f"Total en MERGED: **{len(_merged['transactions'])}** → `{_mp}`"
                )
            if _total_files:
                st.info(f"Merge completo: {_total_files} archivos procesados, {_total_txns} txns nuevas.")

    st.divider()
    st.markdown("### 3 - Archivo SAT")

    # --- Selector de archivos MERGED generados ---
    _merged_dir   = os.path.expanduser("~/sat_merged")
    _merged_avail = sorted(
        glob.glob(os.path.join(_merged_dir, "SAT-TEXCOCO-*-MERGED.json")),
        reverse=True,
    )
    if _merged_avail:
        _mf_names = [os.path.basename(f) for f in _merged_avail]

        def _merged_label(fname):
            m = re.search(r"(\d{8})", fname)
            if m:
                try:
                    d = datetime.strptime(m.group(1), "%Y%m%d").date()
                    diff = (date.today() - d).days
                    suffix = {0: " — Hoy", 1: " — Ayer", 2: " — Antes de ayer"}.get(diff, "")
                    return f"{d.strftime('%d/%m/%Y')}{suffix}"
                except Exception:
                    pass
            return fname

        _mf_opts  = ["(ninguno)"] + _mf_names
        _sel_mf   = st.selectbox(
            "Archivos MERGED disponibles",
            _mf_opts,
            format_func=lambda n: n if n == "(ninguno)" else _merged_label(n),
            key="sel_merged_file",
        )
        if _sel_mf != "(ninguno)":
            if st.button("Cargar MERGED", key="btn_load_merged", type="primary", use_container_width=True):
                try:
                    _mpath = os.path.join(_merged_dir, _sel_mf)
                    with open(_mpath, "r", encoding="utf-8") as _fh:
                        _mdata = json.load(_fh)
                    _mtxns = _mdata.get("transactions", [])
                    st.session_state.sat_df = pd.DataFrame(_mtxns)
                    st.session_state.sat_upload_name = _sel_mf
                    st.session_state.sat_source = "merged"
                    reset_results()
                    st.success(f"SAT MERGED: {len(_mtxns):,} registros cargados")
                except Exception as _exc:
                    show_debug_exception("Error cargando MERGED", _exc)
        st.caption("— o sube un archivo manualmente —")

    sat_file = st.file_uploader("Archivo SAT", type=["xlsx", "xls", "csv", "json"], key="sat_upload")
    if sat_file and (st.session_state.sat_df is None or sat_file.name != st.session_state.sat_upload_name):
        try:
            st.session_state.sat_df = load_file(sat_file)
            st.session_state.sat_upload_name = sat_file.name
            st.session_state.sat_source = "upload"
            reset_results()
            st.success(f"SAT: {len(st.session_state.sat_df):,} registros")
        except Exception as exc:
            show_debug_exception("Error SAT", exc)

    if sat_file is None and st.session_state.sat_source != "merged":
        st.session_state.sat_df = None
        st.session_state.sat_upload_name = ""
        reset_results()

    avc_df = st.session_state.avc_df
    sat_df = st.session_state.sat_df

    if avc_df is not None and sat_df is not None and not avc_df.empty:
        st.divider()
        st.markdown("### 4 - Mapeo de Columnas")

        avc_cols = avc_df.columns.tolist()
        sat_cols = sat_df.columns.tolist()

        def sel(label, cols, patterns, key, exclude=None):
            default = detect_col(cols, patterns, exclude) or (cols[0] if cols else "")
            idx = cols.index(default) if default in cols else 0
            return st.selectbox(label, cols, index=idx, key=key)

        st.markdown("**AVC**")
        col_avc_date = sel("Fecha/Hora", avc_cols, [r"^event_mexico$", r"created_at_mexico", r"date|time|hora|fecha"], "c_avc_date")
        col_avc_device = sel("Carril/Device", avc_cols, [r"^lane_name$", r"^device_with_lane$", r"device|carril|lane"], "c_avc_dev")
        col_avc_type = sel("Tipo Vehiculo", avc_cols, [r"vehicle_type|tipo|type"], "c_avc_type")
        col_avc_axles = sel("Ejes", avc_cols, [r"axle_count|ejes|axle"], "c_avc_axl")
        col_avc_id = sel("ID", avc_cols, [r"^id$"], "c_avc_id")

        st.markdown("**SAT**")
        col_sat_date = sel("Fecha/Hora", sat_cols, [r"^date_transaction$", r"date|time|hora|fecha"], "c_sat_date")
        col_sat_voie = sel("Carril/Voie", sat_cols, [r"^voie$", r"voie|carril|lane"], "c_sat_voie")
        col_sat_cls = sel("id_classe", sat_cols, [r"^id_classe$", r"id_class"], "c_sat_cls")
        col_sat_tab = sel("tab_id_classe", sat_cols, [r"tab_id_classe", r"tab.*class"], "c_sat_tab")
        col_sat_num = sel("Numero Trans.", sat_cols, [r"numero_transaction", r"numero|number|trans"], "c_sat_num")
        col_sat_prix = sel("Precio", sat_cols, [r"prix_total", r"price|precio|prix"], "c_sat_prix")

        st.divider()
        st.markdown("### 5 - Parametros")

        avc_ts = avc_df[col_avc_date].apply(parse_date)
        sat_ts = sat_df[col_sat_date].apply(parse_date)
        avc_days = sorted(avc_ts.dropna().dt.strftime("%Y-%m-%d").unique().tolist())
        sat_days = sorted(sat_ts.dropna().dt.strftime("%Y-%m-%d").unique().tolist())
        common_days = sorted(set(avc_days) & set(sat_days))

        avc_lanes = sorted(avc_df[col_avc_device].astype(str).str.strip().unique().tolist())
        sat_lanes = sorted(sat_df[col_sat_voie].astype(str).str.strip().unique().tolist())

        st.selectbox("Carril AVC", avc_lanes, key="sel_avc_lane")
        st.selectbox("Carril SAT", sat_lanes, key="sel_sat_lane")

        if common_days:
            st.selectbox("Fecha (dias en comun)", common_days, key="sel_fecha")
        else:
            st.warning("Sin dias en comun entre AVC y SAT.")
            fallback_days = avc_days or sat_days or [st.session_state.query_date.strftime("%Y-%m-%d")]
            st.selectbox("Fecha", fallback_days, key="sel_fecha")

        st.slider("Ventana de tiempo (segundos)", 10, 600, 120, 10, key="sel_ventana")

        run_btn = st.button("Ejecutar Conciliacion", type="primary", use_container_width=True)
        if st.button("Reiniciar resultados", use_container_width=True):
            reset_results()
            st.rerun()

        if run_btn:
            try:
                _prog_bar  = st.progress(0, text="Conciliando…")
                _prog_text = st.empty()

                def _update_progress(p: float) -> None:
                    pct = int(p * 100)
                    _prog_bar.progress(p, text=f"Conciliando… {pct}%")
                    _prog_text.caption(f"Procesando eventos AVC: {pct}%")

                with st.spinner("Ejecutando conciliacion, por favor espera…"):
                    st.session_state.result_df = reconcile(
                        avc_df,
                        sat_df,
                        st.session_state.sel_avc_lane,
                        st.session_state.sel_sat_lane,
                        st.session_state.sel_fecha,
                        st.session_state.sel_ventana,
                        col_avc_date,
                        col_avc_device,
                        col_avc_type,
                        col_avc_axles,
                        col_avc_id,
                        col_sat_date,
                        col_sat_voie,
                        col_sat_cls,
                        col_sat_tab,
                        col_sat_num,
                        col_sat_prix,
                        progress_callback=_update_progress,
                    )
                _prog_bar.empty()
                _prog_text.empty()
                st.session_state.run_done = True
                st.rerun()
            except Exception as exc:
                show_debug_exception("Error ejecutando conciliacion", exc)


avc_df = st.session_state.avc_df
sat_df = st.session_state.sat_df

if not st.session_state.run_done:
    if avc_df is not None or sat_df is not None:
        c1, c2 = st.columns(2)
        with c1:
            if avc_df is not None:
                file_analysis(avc_df, "Analisis AVC")
        with c2:
            if sat_df is not None:
                file_analysis(sat_df, "Analisis SAT")
    else:
        st.info("Carga AVC desde base de datos y un archivo SAT para comenzar.")
        with st.expander("Tabla de Clases SAT (referencia)"):
            cls_data = [
                {"id_classe": k, "Codigo": SAT_CODE[k], "Descripcion": SAT_DESC[k], "Ejes": SAT_EJES[k]}
                for k in SAT_DESC
            ]
            st.dataframe(pd.DataFrame(cls_data), use_container_width=True, hide_index=True)
else:
    result = st.session_state.result_df
    if result is None or result.empty:
        st.warning("No se generaron resultados. Verifica carriles, fecha y datos.")
    else:
        total = len(result)
        matches = int(result["match_valido"].sum())
        avc_only = int(((result["tipo"] == "AVC") & (~result["match_valido"])).sum())
        sat_only = int((result["tipo"] == "SAT").sum())
        err_ejes = int((result["match_valido"] & result["nota_ejes"].astype(str).str.startswith("ERROR_DETECCION", na=False)).sum())
        motos_nc = int((result["motivo_no_match"] == "moto_detectada_solo_por_avc").sum())
        base_avc = max(int((result["tipo"] != "SAT").sum()), 1)
        pct = round(matches / base_avc * 100, 1)

        st.markdown(f"### Tasa de match: `{pct}%` ({matches} / {base_avc} eventos AVC)")
        cols_m = st.columns(6)
        cols_m[0].metric("Total filas", total)
        cols_m[1].metric("Matches", matches)
        cols_m[2].metric("AVC sin SAT", avc_only)
        cols_m[3].metric("SAT sin AVC", sat_only)
        cols_m[4].metric("Error ejes", err_ejes)
        cols_m[5].metric("Motos no conc.", motos_nc)

        fig = go.Figure(go.Bar(
            x=["Match", "AVC sin SAT", "SAT sin AVC", "Error ejes"],
            y=[matches, avc_only, sat_only, err_ejes],
            marker_color=["#22c97b", "#ff7e3f", "#6b7a99", "#f5d433"],
        ))
        fig.update_layout(
            paper_bgcolor="#131720",
            plot_bgcolor="#131720",
            font_color="#e2e8f0",
            height=220,
            margin=dict(t=10, b=10, l=0, r=0),
        )
        st.plotly_chart(fig, use_container_width=True)

        tab_all, tab_match, tab_no_match, tab_sat_sin, tab_legend = st.tabs(
            ["Todos", "Match OK", "AVC Sin Match", "SAT Sin Conciliar", "Leyenda"]
        )

        display_cols = [
            "tipo", "avc_id", "avc_device", "avc_date", "Vehicle_type", "axles_avc", "clase_avc_mapeada",
            "sat_voie", "sat_date", "sat_numero", "sat_prix",
            "id_classe", "tab_id_classe", "sat_id_classe_desc",
            "comparacion_ejes_id", "comparacion_ejes_tab", "nota_ejes",
            "delta_segundos", "direccion_delta", "match_valido",
            "motivo_no_match", "observacion_auditoria", "candidatos_sat",
        ]
        show_cols = [col for col in display_cols if col in result.columns]

        with tab_all:
            render_selectable_result_table(result, show_cols, "all_results_table", "Fila seleccionada")
        with tab_match:
            render_selectable_result_table(
                result[result["match_valido"]].copy(),
                show_cols,
                "match_results_table",
                "Match seleccionado",
            )
        with tab_no_match:
            render_selectable_result_table(
                result[(result["tipo"] == "AVC") & (~result["match_valido"])].copy(),
                show_cols,
                "avc_nomatch_results_table",
                "AVC dudoso seleccionado",
            )
        with tab_sat_sin:
            render_selectable_result_table(
                result[result["tipo"] == "SAT"].copy(),
                show_cols,
                "sat_only_results_table",
                "SAT seleccionado",
            )
        with tab_legend:
            st.markdown(
                """
| Color | Descripcion |
|---|---|
| Verde | Match valido / Ejes OK |
| Azul | Motocicleta / OK_MOTO |
| Rojo | Sin match o error |
| Naranja | AVC detecto, SAT no |
| Amarillo | Match valido + error deteccion ejes AVC |
| Gris | SAT sin AVC correspondiente |
"""
            )
            cls_data = [
                {"id_classe": k, "Codigo": SAT_CODE[k], "Descripcion": SAT_DESC[k], "Ejes": SAT_EJES[k]}
                for k in SAT_DESC
            ]
            st.dataframe(pd.DataFrame(cls_data), use_container_width=True, hide_index=True)

        st.divider()
        st.markdown("### Exportar")
        e1, e2 = st.columns(2)
        fecha_str = st.session_state.get("sel_fecha") or "fecha"
        lane_str = re.sub(r"[^A-Za-z0-9_-]+", "_", str(st.session_state.get("sel_avc_lane") or "carril"))
        fname = f"Conciliacion_{lane_str}_{fecha_str}"

        with e1:
            csv_buf = result.to_csv(index=True).encode("utf-8")
            st.download_button("Descargar CSV", csv_buf, file_name=f"{fname}.csv", mime="text/csv")

        with e2:
            xlsx_buf = io.BytesIO()
            with pd.ExcelWriter(xlsx_buf, engine="xlsxwriter") as writer:
                result.to_excel(writer, sheet_name="Conciliacion", index=True)
            st.download_button(
                "Descargar Excel",
                xlsx_buf.getvalue(),
                file_name=f"{fname}.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
