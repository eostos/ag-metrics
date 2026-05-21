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
    local pid
    pid="$(server_pid)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

server_pid() {
    if [ -f "$PID_FILE" ]; then
        local saved_pid
        saved_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
        if [ -n "$saved_pid" ] && kill -0 "$saved_pid" 2>/dev/null; then
            echo "$saved_pid"
            return
        fi
    fi
    pgrep -f "uvicorn api:app --host 0.0.0.0 --port $PORT" | head -n 1
}

stop_server() {
    if is_running; then
        local pid
        pid="$(server_pid)"
        echo "Deteniendo AG-metrics (PID $pid)..."
        kill "$pid"
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
    echo "Iniciando AG-metrics en modo DEBUG (reload automático)..."
    cd "$DIR"
    uvicorn api:app --host 0.0.0.0 --port "$PORT" --reload --log-level debug
    ;;

  prod)
    stop_server 2>/dev/null || true
    echo "Iniciando AG-metrics en modo PRODUCCIÓN (background, log: $LOG_FILE)..."
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
        echo "AG-metrics corriendo (PID $(server_pid)) en http://localhost:$PORT"
    else
        echo "AG-metrics detenido."
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
