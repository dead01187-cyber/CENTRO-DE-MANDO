# Fase 7: Navi + puente de Browser Use (v1.89.0)

**Navi** es un robot nuevo del Centro de Mando (supervisor **OPS**). Maneja **tu Brave** con **Browser Use** a través de un **puente** que corre en tu Mac. Solo corre **recetas fijas**; las dos primeras bajan fotos y datos de Homes.com.

Rama: `navi-browser-use`, hecha sobre `fase-anna`. **No toca `main`.**

```
Navi (extensión)  ──HTTP + clave──▶  puente.py (127.0.0.1:8765)  ──stdin──▶  browser-use  ──CDP 9222──▶  Brave
```

## 1. Qué cambió

### Puente local (`puente/`)

| Archivo | Qué es |
|---|---|
| `puente.py` | Servidor HTTP **solo con la librería estándar de Python**; no hay que instalar nada. Escucha **solo en 127.0.0.1:8765**. |
| `recetas/_comun.py` | Funciones que usan todas las recetas: pausas, detector de CAPTCHA, descargas y la lógica de fotos de Homes.com. |
| `recetas/fotos_listing.py` | Receta 1: fotos y datos de un listing. |
| `recetas/listings_agente.py` | Receta 2: listings activos de un agente (opcional: con fotos). |
| `com.christopher.navi.plist` | Plantilla del servicio de **launchd**: arranca solo, se reinicia si se cae y deja logs en `~/.navi/logs/`. |
| `instalar.sh` / `desinstalar.sh` | Instalan o quitan el servicio. |

**Seguridad del puente**

- **Clave:** cada petición necesita el header `X-Navi-Token`.
  - La clave se crea la primera vez en `~/.navi/token`, con permisos 600.
  - La extensión la guarda en `chrome.storage.local` (`nvToken`), igual que las otras llaves.
  - Nunca va en el código ni en el repo.
- **CORS:** solo para `chrome-extension://<ID>`, el ID que está en `~/.navi/config.json`. Cualquier otra página recibe 403.
- **Nombre con el que lo llaman:** además revisa el header `Host`. Solo acepta `127.0.0.1:8765` o `localhost:8765`, para que una página web no pueda usar un truco de DNS ("DNS rebinding").
- **No ejecuta código que le manden.** Solo corre recetas de `puente/recetas/*.py` por nombre.
  - El puente lee el `META` de cada receta **sin ejecutarla** (con `ast`).
  - Valida los parámetros: tipo, https, dominio `homes.com`, forma de la ruta y que no haya parámetros de más.
  - Los parámetros llegan a la receta en la variable `NAVI_PARAMS` (JSON). **Nunca se pegan dentro del código.**
- **Una tarea a la vez**, en fila. Cada receta tiene un tiempo máximo (10 min para fotos, 2 h para un perfil completo).
- **Privacidad:** apaga la telemetría de `browser-use` (`BH_TELEMETRY=0`), para que no mande el script ni lo que imprime.

**Endpoints**

| Método y ruta | Qué hace |
|---|---|
| `GET /salud` | Estado del puente, si Brave responde en el 9222 y si encuentra `browser-use`. |
| `GET /recetas` | Recetas con sus parámetros. |
| `POST /tarea {receta, params}` | Arranca la tarea y regresa su `id`. |
| `GET /tarea/<id>` | Estado (`en_cola`, `trabajando`, `terminado`, `error`, `ayuda`, `cancelado`), log línea por línea y resultado. |
| `POST /tarea/<id>/cancelar` | Cancela la tarea. |
| `POST /tarea/<id>/abrir` | Abre en Finder la carpeta del resultado. Solo funciona con carpetas que creó el puente. |

**Cómo trabajan las recetas**

- **Pausas:** espera de 1.5 a 4 s entre páginas.
- **CAPTCHA:** si la página pide CAPTCHA o verificación, la receta se detiene con estado **"ayuda"**. Nunca lo intenta resolver.
- **Descargas:** van a `~/Downloads/navi/<receta>/<fecha>/`.

### Las dos recetas

**`fotos_listing`** (la URL de una propiedad de Homes.com)
- Abre la galería y junta las URLs de todas las fotos del listing.
- Baja las fotos numeradas (`01.jpg`, `02.jpg`…) en el **tamaño más grande**:
  - la primera vez prueba los tamaños con la primera foto;
  - recuerda el mejor en `~/.navi/homes_tamano.json`.
- Guarda `datos.json` con: precio, dirección, ciudad, beds, baths, sq ft, garage, highlights, descripción, agente (con teléfono y correo), brokerage, **DRE** y MLS.
- Regresa la carpeta y el número de fotos.

**`listings_agente`** (la URL del perfil de un agente)
- Junta los listings **activos**: URL, dirección, precio y estado. Los vendidos no entran; los "Open House" quedan como activos, con la nota.
- Guarda `listings.csv` y `resumen.json`. El CSV se guarda **antes** de bajar fotos, para no perderlo si sale un CAPTCHA a medio camino.
- Con **fotos = sí**, corre `fotos_listing` para cada uno, en una sub-carpeta por listing.

### Robot Navi en la extensión

- **Archivos:** `navi.html`, `navi.js` y `navi-core.js` (lógica pura, con pruebas). Mismo estilo que los demás (`tema.css`).
- **Pantalla:**
  - **campo para la clave del puente**;
  - **selector de receta** con su formulario, que lee de `GET /recetas`;
  - **Arrancar** y **Cancelar**;
  - **log en vivo**, revisando cada 2 s;
  - **resultado** con botón **"Abrir la carpeta en Finder"**;
  - el **ID de la extensión**, que te pide `instalar.sh`.
- **Estados:** Trabajando, ¡Terminé!, Error y Necesito ayuda (CAPTCHA). Escribe en la **bitácora** del Mando.
- **Mensajes claros:**
  - si el puente no responde: **"El puente está apagado. Corre puente/instalar.sh"**;
  - si Brave no tiene el 9222: **"Abre Brave con brave-ia"**;
  - también avisa si la clave no coincide o si el puente no reconoce la extensión.
- **Conexiones con el resto:**
  - **Registro:** `nv`, "Navi", supervisor **OPS**, permiso `lee_web`, acción del bus `receta`.
  - **Mando:** estación en la fila 13, columna 6, con su color (morado) y su ícono (brújula); botón en el cajón ("Calidad y operación").
  - **Capi:** la herramienta nueva `navi_receta` le pide tareas a Navi **solo con recetas de la lista** que el puente le dio a Navi. Solo el jefe; nunca un aviso automático ni otro robot.
  - **Respaldo:** la clave del puente se respalda con las otras llaves.
- **Permisos:** `manifest.json` **no necesitó cambios**. `host_permissions: <all_urls>` ya cubre `http://127.0.0.1:8765`; la prueba de punta a punta lo confirma con la extensión real.

### Centro de Mando.app con Brave

`Centro de Mando.app/Contents/MacOS/CentroDeMando` ahora abre **Brave**:

- **Brave cerrado:** lo abre con `--remote-debugging-port=9222` y revisa que el puerto sí quedó abierto.
- **Brave abierto con el 9222:** solo abre la ventana del Mando.
- **Brave abierto sin el 9222:** **avisa y pregunta** si abres el Mando sin Navi. **Nunca lo cierra a la fuerza.**
- **Variable `DATOS`:** si tu alias `brave-ia` usa otro perfil (`--user-data-dir=…`), pon esa ruta en `DATOS`.
  - Las versiones nuevas de Chromium ignoran el 9222 con el perfil normal.
  - Si eso pasa, la app te avisa que uses `brave-ia`.

## 2. Cómo instalar

1. **Actualiza la extensión** a esta rama (comando abajo) y recárgala en `brave://extensions`.
2. Abre **Navi** en el Centro de Mando y copia el **ID de la extensión** que sale abajo.
3. En la Terminal:
   ```bash
   bash ~/Desktop/CENTRO-DE-MANDO-claude-peaceful-fermi-mfgt13/puente/instalar.sh
   ```
   - Te pide el ID: pégalo.
   - Te muestra la **clave** una sola vez. Cópiala.
   - Copia el puente a `~/.navi/puente/`: macOS no deja que un servicio lea el Escritorio.
4. En Navi, pega la clave en **"Clave del puente"**. Debe decir **"Puente listo · Brave/… en el 9222"**.

**Cada vez que actualices la extensión**, vuelve a correr `instalar.sh`. Así copia las recetas nuevas y reinicia el puente. No te vuelve a pedir el ID ni cambia la clave.

**Para quitar el puente:** `bash puente/desinstalar.sh`. No borra `~/.navi` ni tus descargas; si quieres borrarlas, hazlo a mano.

## 3. Cómo verificar, paso a paso

| # | Qué hacer | Qué debe pasar |
|---|---|---|
| 1 | `curl -s -H "X-Navi-Token: $(cat ~/.navi/token)" http://127.0.0.1:8765/salud` | JSON con `"ok": true` y `"brave": true` (con Brave abierto con `brave-ia`) |
| 2 | Lo mismo **sin** el header | `{"error": "falta la clave del puente…"}` (401) |
| 3 | En Navi: receta **Fotos y datos de un listing**, URL `https://www.homes.com/property/12352-elmwood-st-garden-grove-ca/sp9g4fw1ndpwt/` → **Arrancar** | Se abre una pestaña en Brave y el log avanza. Termina en **¡Terminé!** |
| 4 | **Abrir la carpeta en Finder** | `01.jpg…` y `datos.json` en `~/Downloads/navi/fotos_listing/<fecha>/`. En `datos.json`: precio 1,000,000, 4 beds, 2 baths, 1,477 sq ft, DRE 01959226 |
| 5 | Receta **Listings activos de un agente** con `https://www.homes.com/real-estate-agents/christopher-rubio-novack/rpbcje3/` (sin fotos) | `listings.csv` con tus listings activos y sus precios |
| 6 | Apaga el puente (`launchctl bootout gui/$(id -u)/com.christopher.navi`) y dale **Revisar puente** | "El puente está apagado. Corre puente/instalar.sh". Vuelve a prenderlo con `instalar.sh` |
| 7 | Pídele a Capi: "Navi, baja las fotos de 12352 Elmwood" | Capi usa `navi_receta` y Navi trabaja igual que en el paso 3 |

### Pruebas automáticas

- **`npm test`: 84 pasan.** Ahora incluye:
  - `tests/navi.test.js` (7);
  - las **22 del puente en Python** (`tests/puente/test_puente.py`, corridas desde `tests/puente.test.js`). Cubren params, clave, CORS, Host, recetas inexistentes, recetas que no se ejecutan al leerlas, fila, cancelar, CAPTCHA y Brave apagado, con un `browser-use` falso.
- **`npm run test:e2e`: 31 pasan.** La nueva `tests/e2e/navi.e2e.js` usa la extensión real + el puente real + un `browser-use` falso. Revisa:
  - mensaje de puente apagado y de clave mala;
  - recetas;
  - URL mala;
  - fotos con log, "¡Terminé!" y bitácora;
  - CAPTCHA → "Necesito ayuda";
  - tareas de Capi por el bus;
  - receta inventada rechazada.
- **Probado también con el `browser-use` 1.0.8 real y Chromium**, contra copias locales de las páginas reales de Homes.com:
  - **datos de Elmwood:** salen completos;
  - **perfil:** 13 listings activos, con precio;
  - **Homes.com real:** este servidor está bloqueado, y Navi se detuvo en **"Necesito ayuda"** en vez de insistir, que es lo correcto.
- **GitHub Actions:** revisa además la sintaxis del puente (Python y shell).

## 4. Qué falta / avisos

- **Probar las fotos en tu Mac.** Desde el servidor de pruebas, Homes.com y sus imágenes contestan "Access Denied". La lectura de la página está probada; **la descarga de fotos y el código de tamaño más grande solo se pueden confirmar en tu Mac.**
  - Si Homes.com cambia su página, hay que ajustar los selectores en `_comun.py` (`JS_DATOS`, `JS_ABRIR_GALERIA`) y `listings_agente.py`.
- **Permisos de macOS:** la primera vez puede salir **"python3 quiere acceder a la carpeta Descargas"**. Dale **Permitir**.
  - Si no sale y falla con *Operation not permitted*, ve a Ajustes del Sistema → Privacidad y seguridad → Archivos y carpetas (o Acceso total al disco) y dale permiso a `python3`.
  - También puedes cambiar `"descargas"` en `~/.navi/config.json`.
- **Brave y el 9222:** si `brave-ia` usa un perfil aparte (`--user-data-dir`), la extensión tiene que estar cargada en **ese** perfil, y la app necesita esa ruta en `DATOS`.
- **ID de Brave:** el `ID` del script de la app es el de Chrome. Si en Brave sale otro (`brave://extensions`), cámbialo ahí.
- **Recetas nuevas:** se agregan como `puente/recetas/<nombre>.py`, con su `META` (parámetros y sus reglas). Después se corre `instalar.sh` y Navi y Capi las ven solas.
