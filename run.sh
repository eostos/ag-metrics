#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$DIR/.venv"
PID_FILE="$DIR/.auditec.pid"
LOG_FILE="/tmp/auditec_api.log"
PORT=8080

# ── Entorno virtual ───────────────────────────────────────
if [ ! -f "$VENV/bin/activate" ]; then
    echo "Creando entorno virtual con Python 3.8..."
    python3.8 -m venv "$VENV"
fi
source "$VENV/bin/activate"
pip install -q -r "$DIR/requirements.txt"

# ── Helpers ───────────────────────────────────────────────
is_running() {
    [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

stop_server() {
    if is_running; then
        echo "Deteniendo AUDITEC (PID $(cat "$PID_FILE"))..."
        kill "$(cat "$PID_FILE")"
        rm -f "$PID_FILE"
        echo "Servidor detenido."
    else
        echo "No hay ningún servidor corriendo."
        rm -f "$PID_FILE"
    fi
}

# ── Comandos ──────────────────────────────────────────────
MODE="${1:-help}"

case "$MODE" in

  debug)
    stop_server 2>/dev/null || true
    echo "Iniciando AUDITEC en modo DEBUG (reload automático)..."
    cd "$DIR"
    uvicorn api:app --host 0.0.0.0 --port "$PORT" --reload --log-level debug
    ;;

  prod)
    stop_server 2>/dev/null || true
    echo "Iniciando AUDITEC en modo PRODUCCIÓN (background, log: $LOG_FILE)..."
    cd "$DIR"
    nohup uvicorn api:app --host 0.0.0.0 --port "$PORT" --workers 2 --log-level warning \
        >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 2
    if is_running; then
        echo "Servidor corriendo en http://localhost:$PORT  (PID $(cat "$PID_FILE"))"
        echo "Logs: tail -f $LOG_FILE"
    else
        echo "ERROR: el servidor no arrancó. Revisa $LOG_FILE"
        exit 1
    fi
    ;;

  stop)
    stop_server
    ;;

  status)
    if is_running; then
        echo "AUDITEC corriendo (PID $(cat "$PID_FILE")) en http://localhost:$PORT"
    else
        echo "AUDITEC detenido."
    fi
    ;;

  logs)
    tail -f "$LOG_FILE"
    ;;

  *)
    echo ""
    echo "Uso: ./run.sh [comando]"
    echo ""
    echo "  debug   — servidor en primer plano con reload automático (desarrollo)"
    echo "  prod    — servidor en background con 2 workers (producción)"
    echo "  stop    — detener el servidor en background"
    echo "  status  — ver si está corriendo"
    echo "  logs    — seguir el log de producción en tiempo real"
    echo ""
    ;;
esac
