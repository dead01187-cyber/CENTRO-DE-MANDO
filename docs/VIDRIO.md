# Efecto vidrio: Liquid Glass (v1.68.0)

El Tablero usa **[liquid-glass-react](https://github.com/rdev/liquid-glass-react)** (MIT, © 2025 Max Rovensky), el efecto "Liquid Glass" de Apple, con **React 19**.

## Dónde se ve

En el **📊 Tablero**, en tres bloques:
- el encabezado (semáforo);
- "Esperando tu aprobación";
- "Misión".

El botón **✨ Vidrio** lo prende y lo apaga. Viene prendido y tu elección se guarda.

- Los botones que quedan dentro del vidrio (Aprobar, Rechazar, Actualizar) funcionan igual.
- Al apagarlo, todo regresa exactamente a como estaba.
- La extensión usa solo el tema **n8n** (fondo gris plano), así que el efecto es discreto: la refracción necesita algo detrás para verse.

## Cómo está armado (y por qué no tienes que compilar)

La extensión **no** usa React en sus demás páginas. Por eso el efecto se empaqueta en **un solo archivo ya compilado**, que va dentro del repositorio:

| Archivo | Qué es |
|---|---|
| `vidrio/fuente/vidrio.jsx` | El puente: `Vidrio.envolver(elemento, opciones)` mete un elemento que ya existe dentro de un `<LiquidGlass>` sin volver a dibujarlo, y `.quitar()` lo regresa. También devuelve la letra de la página, porque la librería fija la suya (20 px) |
| `vidrio/vidrio.js` | **Lo que carga la extensión.** Compilado con esbuild (React y la librería adentro, modo producción, ~240 KB). No se edita a mano |
| `vidrio/LICENCIAS.txt` | Licencias MIT de liquid-glass-react, React, React DOM y scheduler |
| `scripts/construir-vidrio.mjs` | El script que compila |

**Para usar la extensión no necesitas compilar nada:** `vidrio/vidrio.js` ya viene listo. Solo hay que compilar si cambias `vidrio/fuente/vidrio.jsx`:

```bash
npm install
```

```bash
npm run build:vidrio
```

Hazlo en **otra copia** del repo, no en la carpeta que tienes cargada en Chrome, porque Chrome no carga extensiones con `node_modules`. Después copia `vidrio/vidrio.js` y `vidrio/LICENCIAS.txt` a la extensión.

## Versiones fijas y revisión de seguridad

| Paquete | Versión |
|---|---|
| liquid-glass-react | 1.1.1 |
| react | 19.1.0 |
| react-dom | 19.1.0 |
| esbuild | 0.24.2 (solo para compilar) |

La versión publicada en npm de liquid-glass-react pide **React 19**, aunque el código de GitHub dice 18.

Antes de meterla a la extensión, que tiene acceso a tus pestañas y a tus llaves, se revisó el paquete que se publica en npm:
- **no** hace llamadas a internet;
- **no** usa `eval` ni `new Function`;
- **no** toca `chrome.*`, cookies ni almacenamiento;
- solo trae 3 imágenes incrustadas (sus mapas de distorsión).

El archivo compilado tampoco usa `eval`, y funciona con las reglas de seguridad (CSP) de Manifest V3.

**Compilación reproducible:** compilar dos veces da exactamente el mismo archivo. Por eso **GitHub Actions** vuelve a compilar en cada push y falla si `vidrio/vidrio.js` no coincide con su fuente; así nadie puede cambiar el archivo compilado sin que se note.

## Pruebas

- **De punta a punta** (`tests/e2e/regresion.e2e.js`, ahora son 12), en un Chromium aislado:
  - el Tablero carga el vidrio y envuelve los 3 bloques;
  - **Rechazar** dentro del vidrio sigue funcionando;
  - al apagar, no queda rastro y la elección se guarda;
  - sin errores de JavaScript.
- Revisión visual con capturas: se corrigió que la librería agrandaba la letra.
- **No se probó** en tu Mac: la verificación es recargar la extensión (1.68.0), abrir el Tablero y probar ✨ Vidrio.

## Si lo quieres en más pantallas

Cualquier página puede usarlo cargando `vidrio/vidrio.js` y llamando `Vidrio.envolver(elemento)`. Úsalo con medida:
- cada vidrio agrega filtros SVG y sigue al ratón;
- en el panel lateral de Chrome y con muchos robots abiertos, demasiados vidrios pueden hacer lento el Centro de Mando.
