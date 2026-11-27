# Agente Geo Farming · Centro de Mando

Extensión de Brave/Chrome (Manifest V3) con más de 30 robots de prospección inmobiliaria coordinados por **Capi** (supervisor principal). Debajo de Capi hay cuatro supervisores: **GEO**, **CRM**, **GROW** y **OPS**.

## Instalar
1. Abre `brave://extensions` (o `chrome://extensions`) y prende **Modo de desarrollador**.
2. **Cargar descomprimida** → escoge esta carpeta.

Las llaves (Lofty, Anthropic, etc.) se ponen dentro de la extensión; no van en el código.

## Documentación
- `docs/auditoria/MISION-01-auditoria.md`: auditoría técnica integral.
- `docs/FASE-0.md` … `docs/FASE-6.md`, `docs/FASE-2b.md`, `docs/FASE-ANNA-*.md`, `docs/FASE-7-navi.md`, `docs/FASE-PUENTE-A.md` y `docs/FASE-PUENTE-B.md`: qué cambió en cada fase, cómo verificarlo y qué falta.

## Navi (Browser Use)
**Navi** maneja tu Brave con [Browser Use](https://github.com/browser-use/browser-use) a través de un puente local (`puente/`, solo Python estándar, en `127.0.0.1:8765`). Solo corre recetas fijas: `fotos_listing` (fotos y datos de un listing de Homes.com) y `listings_agente` (listings activos de un agente en CSV). Pide clave (`~/.navi/token`), acepta solo a la extensión y se detiene si sale un CAPTCHA.
1. `uv tool install browser-use` y abre Brave con el puerto 9222 (`brave-ia` o la app Centro de Mando).
2. `bash puente/instalar.sh` (te pide el ID de la extensión y te da la clave).
3. Pega la clave en Navi. Detalles en `docs/FASE-7-navi.md`.

El mismo puente corre **servicios** que trabajan solos aunque Brave esté cerrado (robot **Puente**): la Mac despierta de 8 am a 9 pm y la salud de las llaves de Lofty, que se guardan en el Llavero de macOS. Ver `docs/FASE-PUENTE-A.md`. El puente también es el **árbitro** del Cerebro y de los SMS (contactos, bajas y turno del número) para todos los robots: `docs/FASE-PUENTE-B.md`.

## Pruebas
- Unitarias: `npm test` (incluye las del puente de Navi en Python).
- De punta a punta, contra un Lofty falso: `npm install` y luego `npm run test:e2e`. Hazlo en **otra copia** del repo: Chrome no carga la extensión si tiene `node_modules`.
