#!/bin/bash
# Quita el servicio del puente de Navi. NO borra ~/.navi (clave, config, historial) ni tus descargas.
set -uo pipefail
ETIQUETA="com.christopher.navi"
PLIST="$HOME/Library/LaunchAgents/com.christopher.navi.plist"
launchctl bootout "gui/$(id -u)/$ETIQUETA" 2>/dev/null || true
if [ -f "$PLIST" ]; then rm "$PLIST"; fi
echo "Puente de Navi detenido y quitado del arranque."
echo "Tu clave y configuración siguen en ~/.navi y tus descargas en ~/Downloads/navi."
echo "Si quieres borrarlas también, hazlo tú a mano:  rm -r ~/.navi"
