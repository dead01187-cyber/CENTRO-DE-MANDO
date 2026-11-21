# Agente Geo Farming · Centro de Mando

Extensión de Brave/Chrome (Manifest V3) con 30 robots de prospección inmobiliaria coordinados por **Capi** (supervisor principal). Debajo de Capi hay cuatro supervisores: **GEO**, **CRM**, **GROW** y **OPS**.

## Instalar
1. Abre `brave://extensions` (o `chrome://extensions`) y prende **Modo de desarrollador**.
2. **Cargar descomprimida** → escoge esta carpeta.

Las llaves (Lofty, Anthropic, etc.) se ponen dentro de la extensión; no van en el código.

## Documentación
- `docs/auditoria/MISION-01-auditoria.md`: auditoría técnica integral.
- `docs/FASE-0.md` … `docs/FASE-6.md` y `docs/FASE-2b.md`: qué cambió en cada fase, cómo verificarlo y qué falta.
- `docs/VIDRIO.md`: efecto Liquid Glass (liquid-glass-react + React 19) en el Tablero.

## Pruebas
- Unitarias: `npm test`.
- De punta a punta, contra un Lofty falso: `npm install` y luego `npm run test:e2e`. Hazlo en **otra copia** del repo: Chrome no carga la extensión si tiene `node_modules`.
