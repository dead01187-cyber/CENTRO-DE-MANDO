#!/bin/bash
# =====================================================================
# Instala el puente de Navi para que arranque solo con tu Mac (launchd).
#   1. Crea ~/.navi (solo tú puedes entrar) y ~/.navi/logs.
#   2. Genera la clave del puente (~/.navi/token, permisos 600) y te la muestra UNA vez.
#   3. Guarda el ID de la extensión en ~/.navi/config.json (para el CORS).
#   4. Copia el puente, sus recetas, el llavero y los servicios a ~/.navi/puente (macOS no deja que un servicio lea el Escritorio).
#   5. Copia el servicio a ~/Library/LaunchAgents y lo carga (o lo reinicia si ya estaba).
# Vuelve a correrlo cada vez que actualices la extensión, para copiar las recetas nuevas.
# Uso:  bash puente/instalar.sh [ID-de-la-extensión]
# =====================================================================
set -euo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAVI="$HOME/.navi"
PLIST_DESTINO="$HOME/Library/LaunchAgents/com.christopher.navi.plist"
ETIQUETA="com.christopher.navi"

PY="$(command -v python3 || true)"
if [ -z "$PY" ]; then echo "No encuentro python3. Instálalo (por ejemplo: xcode-select --install) y vuelve a correr esto."; exit 1; fi
BU="$(command -v browser-use || true)"
[ -z "$BU" ] && [ -x "$HOME/.local/bin/browser-use" ] && BU="$HOME/.local/bin/browser-use"
if [ -z "$BU" ]; then echo "Aviso: no encuentro browser-use. Instálalo con: uv tool install browser-use"; fi

mkdir -p "$NAVI/logs"
chmod 700 "$NAVI"

# --- clave ---
NUEVA=0
if [ ! -s "$NAVI/token" ]; then
  umask 077
  "$PY" -c 'import secrets; print(secrets.token_urlsafe(32))' > "$NAVI/token"
  NUEVA=1
fi
chmod 600 "$NAVI/token"

# --- ID de la extensión (para el CORS) ---
ID="${1:-}"
if [ -z "$ID" ] && [ -f "$NAVI/config.json" ]; then
  ID="$("$PY" -c 'import json,sys; print(json.load(open(sys.argv[1])).get("extension_id",""))' "$NAVI/config.json" 2>/dev/null || true)"
fi
while ! [[ "$ID" =~ ^[a-p]{32}$ ]]; do
  echo "Pega el ID de la extensión (brave://extensions → Agente Geo Farming → ID; también sale en la pantalla de Navi):"
  read -r ID
done
"$PY" - "$NAVI/config.json" "$ID" "$BU" <<'PY'
import json, sys, os
ruta, ext_id, bu = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    c = json.load(open(ruta))
except Exception:
    c = {}
c["extension_id"] = ext_id
if bu:
    c["browser_use"] = bu
c.setdefault("cdp_url", "http://127.0.0.1:9222")
c.setdefault("descargas", os.path.expanduser("~/Downloads/navi"))
json.dump(c, open(ruta, "w"), indent=2)
os.chmod(ruta, 0o600)
PY

# --- copia del puente (fuera del Escritorio) ---
mkdir -p "$NAVI/puente/recetas" "$NAVI/puente/servicios"
cp "$AQUI/puente.py" "$AQUI/llavero.py" "$NAVI/puente/"
rm -f "$NAVI/puente/recetas/"*.py "$NAVI/puente/servicios/"*.py
cp "$AQUI/recetas/"*.py "$NAVI/puente/recetas/"
cp "$AQUI/servicios/"*.py "$NAVI/puente/servicios/"

# --- servicio de launchd ---
RUTA_PATH="$(dirname "${BU:-/usr/bin/true}"):$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s#__PYTHON__#$PY#g" -e "s#__PUENTE__#$NAVI/puente/puente.py#g" -e "s#__HOME__#$HOME#g" -e "s#__PATH__#$RUTA_PATH#g" \
  "$AQUI/com.christopher.navi.plist" > "$PLIST_DESTINO"
launchctl bootout "gui/$(id -u)/$ETIQUETA" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DESTINO"
launchctl enable "gui/$(id -u)/$ETIQUETA" 2>/dev/null || true
sleep 2

echo
echo "✅ Puente de Navi instalado. Arranca solo cada vez que entras a tu Mac."
echo "   Logs: $NAVI/logs/puente.log y puente.err.log"
if [ "$NUEVA" = "1" ]; then
  echo
  echo "🔑 Clave del puente (pégala en Navi → 'Clave del puente'; no se vuelve a mostrar):"
  echo
  cat "$NAVI/token"
  echo
else
  echo "🔑 La clave ya existía. Para verla otra vez: cat ~/.navi/token"
fi
if curl -s -o /dev/null -m 3 -H "X-Navi-Token: $(cat "$NAVI/token")" http://127.0.0.1:8765/salud; then
  echo "   El puente contesta en http://127.0.0.1:8765 ✔"
else
  echo "   El puente todavía no contesta; revisa $NAVI/logs/puente.err.log"
fi
