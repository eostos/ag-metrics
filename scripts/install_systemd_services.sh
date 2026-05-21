#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_USER="${SUDO_USER:-$(id -un)}"
PROJECT_GROUP="$(id -gn "$PROJECT_USER")"
PROJECT_HOME="$(getent passwd "$PROJECT_USER" | cut -d: -f6)"
VENV="$PROJECT_DIR/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"
PORT="${AUDITEC_PORT:-8080}"
WORKERS="${AUDITEC_WORKERS:-2}"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: ejecuta este instalador con sudo:"
  echo "  sudo $0"
  exit 1
fi

echo "Instalando servicios AUDITEC"
echo "  Proyecto: $PROJECT_DIR"
echo "  Usuario:  $PROJECT_USER:$PROJECT_GROUP"
echo "  Home:     $PROJECT_HOME"
echo "  Puerto:   $PORT"
echo "  Workers:  $WORKERS"

if [ ! -d "$VENV" ]; then
  sudo -u "$PROJECT_USER" "$PYTHON_BIN" -m venv "$VENV"
fi

sudo -u "$PROJECT_USER" "$VENV/bin/pip" install -q -r "$PROJECT_DIR/requirements.txt"

install -d -o "$PROJECT_USER" -g "$PROJECT_GROUP" "$PROJECT_HOME/sat_merged"

cat >/etc/systemd/system/auditec.service <<UNIT
[Unit]
Description=AUDITEC AVC/SAT FastAPI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$PROJECT_USER
Group=$PROJECT_GROUP
WorkingDirectory=$PROJECT_DIR
Environment=PYTHONUNBUFFERED=1
ExecStart=$VENV/bin/uvicorn api:app --host 0.0.0.0 --port $PORT --workers $WORKERS --log-level warning
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/auditec-sat-watcher.service <<UNIT
[Unit]
Description=AUDITEC SAT JSON watcher
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$PROJECT_USER
Group=$PROJECT_GROUP
WorkingDirectory=$PROJECT_DIR
Environment=PYTHONUNBUFFERED=1
ExecStart=$VENV/bin/python sat_watcher.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable auditec.service auditec-sat-watcher.service
systemctl restart auditec.service auditec-sat-watcher.service

echo ""
echo "Servicios instalados y arrancados."
echo "Verificacion:"
echo "  systemctl status auditec.service --no-pager"
echo "  systemctl status auditec-sat-watcher.service --no-pager"
echo "  journalctl -u auditec.service -f"
echo "  journalctl -u auditec-sat-watcher.service -f"
