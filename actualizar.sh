#!/bin/bash
# =====================================================================
# Actualiza el Centro de Mando con un solo comando:
#   bash ~/Desktop/CENTRO-DE-MANDO-claude-peaceful-fermi-mfgt13/actualizar.sh [rama]
#
#   1. Baja la versión de GitHub (rama por defecto: la de abajo).
#   2. La copia a ESTA carpeta (la que tienes cargada en Brave) y borra los archivos que ya no existen
#      en la versión nueva. Antes te enseña qué va a borrar y te pide confirmar.
#      Nunca toca tus respaldos (respaldo-*.json), node_modules ni .DS_Store.
#   3. Si el puente está instalado, lo reinstala (recetas y servicios nuevos; misma clave, mismo ID).
#   4. Te dice la versión nueva. Luego recarga la extensión en brave://extensions.
#
# Opciones: --si (no pregunta: acepta borrar lo viejo).
# =====================================================================
set -euo pipefail

RAMA_DEFECTO="rayo-puente"   # cuando todo esté en main, esto cambia a main
REPO="dead01187-cyber/CENTRO-DE-MANDO"

# Este script se copia a sí mismo antes de trabajar: así no se rompe al actualizarse a sí mismo
if [ -z "${CENTRO_COPIA:-}" ]; then
  export CENTRO_DESTINO="${CENTRO_DESTINO:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
  COPIA="$(mktemp -t centro-actualizar.XXXXXX)"
  cp "${BASH_SOURCE[0]}" "$COPIA"
  CENTRO_COPIA="$COPIA" exec bash "$COPIA" "$@"
fi
# Carpeta temporal propia (nombre único; nunca se borra una variable del sistema como TMP)
CENTRO_TEMP=""
trap 'rm -f "$CENTRO_COPIA"; if [ -n "$CENTRO_TEMP" ] && [ -d "$CENTRO_TEMP" ]; then rm -rf "$CENTRO_TEMP"; fi' EXIT

SI=0; RAMA="$RAMA_DEFECTO"
for a in "$@"; do
  case "$a" in
    --si) SI=1 ;;
    -*) echo "Opción desconocida: $a"; exit 1 ;;
    *) RAMA="$a" ;;
  esac
done
if ! [[ "$RAMA" =~ ^[A-Za-z0-9._/-]{1,80}$ ]]; then echo "Nombre de rama raro: $RAMA"; exit 1; fi

DESTINO="$CENTRO_DESTINO"
if ! grep -q '"manifest_version"' "$DESTINO/manifest.json" 2>/dev/null; then
  echo "No encuentro la extensión en $DESTINO (falta manifest.json). No hago nada."; exit 1
fi
for p in unzip find comm cp; do command -v "$p" >/dev/null || { echo "Falta el programa $p."; exit 1; }; done
ANTES="$(grep -m1 '"version"' "$DESTINO/manifest.json" | sed 's/[^0-9.]//g')"

# --- 1. bajar ---
CENTRO_TEMP="$(mktemp -d -t centro-nuevo.XXXXXX)"
if [ -n "${CENTRO_ZIP:-}" ]; then   # solo para pruebas: un zip local en vez de GitHub
  cp "$CENTRO_ZIP" "$CENTRO_TEMP/nuevo.zip"
else
  echo "Bajando la rama $RAMA de GitHub…"
  curl -fsSL -o "$CENTRO_TEMP/nuevo.zip" "https://codeload.github.com/$REPO/zip/refs/heads/$RAMA" || { echo "No pude bajar la rama $RAMA (¿existe? ¿hay internet?)."; exit 1; }
fi
unzip -q "$CENTRO_TEMP/nuevo.zip" -d "$CENTRO_TEMP/x"
FUENTE="$(find "$CENTRO_TEMP/x" -mindepth 1 -maxdepth 1 -type d | head -1)"
if [ -z "$FUENTE" ] || ! grep -q '"manifest_version"' "$FUENTE/manifest.json" 2>/dev/null; then
  echo "Lo que bajé no parece la extensión. No toqué nada."; exit 1
fi
NUEVA="$(grep -m1 '"version"' "$FUENTE/manifest.json" | sed 's/[^0-9.]//g')"

# --- 2. copiar (con lo que se borra a la vista) ---
# Sin rsync (en las Mac nuevas cambió): solo find, comm y cp, que trae toda Mac.
protegido() { case "$1" in respaldo-*.json|respaldo-original/*|node_modules/*|.git/*|test-results/*|*.DS_Store) return 0 ;; esac; return 1; }
listar() { (cd "$1" && find . -type f | sed 's|^\./||' | LC_ALL=C sort); }
BORRA="$(LC_ALL=C comm -23 <(listar "$DESTINO") <(listar "$FUENTE") | while IFS= read -r f; do protegido "$f" || printf '%s\n' "$f"; done)"
if [ -n "$BORRA" ]; then
  echo
  echo "Estos archivos ya no existen en la versión nueva y se van a BORRAR de tu carpeta:"
  printf '%s\n' "$BORRA" | sed 's/^/   - /'
  if [ "$SI" != "1" ]; then
    if [ -t 0 ] || [ -n "${CENTRO_PREGUNTAR:-}" ]; then
      printf "¿Los borro? (s/n): "; read -r r
      case "$r" in s|S|si|sí|SI|Sí) ;; *) echo "No actualicé nada."; exit 1 ;; esac
    else
      echo "No los borro sin preguntarte. Corre el comando en la Terminal (o con --si)."; exit 1
    fi
  fi
fi
cp -R "$FUENTE/." "$DESTINO/"
if [ -n "$BORRA" ]; then
  printf '%s\n' "$BORRA" | while IFS= read -r f; do
    rm -f "$DESTINO/$f"
    d="$(dirname "$f")"   # carpetas que quedaron vacías y ya no existen en la versión nueva
    while [ "$d" != "." ] && [ ! -d "$FUENTE/$d" ] && rmdir "$DESTINO/$d" 2>/dev/null; do d="$(dirname "$d")"; done
  done
fi
echo
echo "✅ Extensión actualizada: $ANTES → $NUEVA (rama $RAMA)"

# --- 3. puente ---
PLIST="${HOME}/Library/LaunchAgents/com.christopher.navi.plist"
if [ -f "$PLIST" ] || [ -f "${HOME}/.navi/config.json" ]; then
  echo
  echo "Reinstalando el puente (recetas y servicios nuevos; tu clave y el ID no cambian)…"
  bash "$DESTINO/puente/instalar.sh"
else
  echo "(El puente no está instalado: me lo salto. Para instalarlo: bash \"$DESTINO/puente/instalar.sh\")"
fi

# --- 4. listo ---
echo
echo "👉 Último paso: abre brave://extensions y dale RECARGAR (la flechita) al Agente Geo Farming."
