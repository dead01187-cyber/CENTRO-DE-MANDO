# Fase 1: Estabilización (v1.61.0)

Corrige los riesgos **CRÍTICOS** y **ALTOS** de la auditoría (`docs/auditoria/MISION-01-auditoria.md`). No es una reescritura: son cambios puntuales, cada uno marcado en el código con un comentario `Fase 1:`.

## Lo que cambia de comportamiento (léelo antes de usar)

| Dónde | Antes | Ahora |
|---|---|---|
| **Todos los SMS** (Texi, Resi, Marki) | Sin horario ni tope | Solo **8:00–21:00 hora de California**, máximo **200 SMS al día** entre todos, solo números de California |
| **Bajas (STOP)** | Si el lead escribía otra cosa después, dejaba de estar bloqueado | **Permanentes** por número y por lead. Se guardan en `smsBajas` |
| **Texi** | Si no podía revisar el opt-out, mandaba igual | **No manda** (falla cerrada) |
| **Marki** | "▶ Iniciar" mandaba SMS sin preguntar | Pide **confirmación**; no manda a bajas ni DNC; si no puede revisar, no manda |
| **Marki** | "Borrar números que no son de CA" venía prendido | **Apagado** (se apagó una vez en tu configuración; si lo quieres, préndelo a mano) |
| **Resi** | Se le podía escribir a una baja con un clic extra | **No se puede** |
| **Lofti** | "Subir solo a Lofty" venía prendido | **Apagado**, salvo que tú ya lo hubieras prendido. Lo que falla no se reintenta solo |
| **Lofti** | Mostraba "Vali (Veriphone)" | Se quitó: **no tenía código** |
| **Capi** | Subía a Lofty si Claude entendía un "sí" | Además sale una **ventana de confirmación** que solo tú puedes aceptar |
| **Capi** | Leía cualquier pestaña | Solo sitios de trabajo (Propwire, BeenVerified, Lofty, Properant, registro de OC, Gmail, Teams, Zillow, Redfin, Realtor) |
| **Capi** | Podía cambiar el tope de skip trace, destinatarios del reclamo, envío automático a Teams… | Esos ajustes **solo los cambias tú** |
| **Capi (voz)** | "happy", "capri", "copi" lo despertaban | Solo "Capi" y sus variantes cercanas |
| **Propi** | "Borrar lista" borraba todo sin preguntar | Pregunta y solo borra la lista de Propi |
| **Chequi / Chequi 3** | Si Lofty fallaba, el domicilio pasaba igual | Queda **sinRevisar** y no pasa (usa "Volver a revisar todos") |

### Ajustar la política de SMS

Valores por defecto: de 8 a 21, tope de 200 al día. Para cambiarlos, en la consola del Centro de Mando:

```js
chrome.storage.local.set({ smsPolitica: { desde: 9, hasta: 20, tope: 150 } })
```

`desde` y `hasta` nunca pueden salir de 8–21.

**Quitar una baja** (solo si la persona escribió START o te pidió volver a recibir mensajes):

```js
SMS.quitarBaja({ tel: "9495551234" })
```

Hay que correrlo en la consola de la pestaña de Texi o Resi, que son las que cargan `politica-sms.js`.

## Lista de cambios

**SMS y cumplimiento** (`politica-sms.js` nuevo, `tx.js`, `rs.js`, `al.js`, `li.js`):
- Política común con falla cerrada, bajas permanentes, horario, tope y registro (`smsRegistro`, últimos 5000).
- Texi también respeta `unsubscription` y las bajas permanentes.
- Detección de STOP en español: ALTO, PARA, CANCELAR, REVOKE y "no me escribas". "no me escribas" antes **no** se detectaba.
- Las bajas de Limpi alimentan la lista de bajas.
- El "envío programado de Resi" del background se quitó: nunca funcionó (no había permiso `alarms`).

**Lofty** (`lofty.js`, `lofty-core.js`, `ac.js`, `owners.js`):
- Lofti: subida automática apagada por defecto y sin bucle de reenvíos.
- La marca DNC de Wibi ya no se pierde.
- Se detecta el formato "Do Not 1 Call"; los litigators nunca pasan.
- CSV sin fórmulas (`= + - @`) en todos los archivos que se descargan.
- Acti ya no reemplaza teléfonos ni borra apellidos. Guarda un respaldo en `acTrabajos[leadId].antes`.
- Owny ya no toma "Previous/Former Owner" ni otra pestaña ajena.

**Dinero y datos** (`wb.js`, `comun.js`, `background.js`, `hr.js`, `bv.js`, `ch.js`, `ch3.js`, `pw.js`):
- Wibi 3: la firma del cobro incluye el monto; un OK de cobro en dinero sirve una vez; no corre dos veces a la vez.
- `addresses` se escribe en un solo lugar y con candado. El respaldo sin background ya no pierde HECM.
- Heri marca "brazo" solo cuando la entrega funcionó.
- Veri 3 y Wibi 3 usan el interruptor de Chequi 3.
- Veri no marca "buscado" si la búsqueda falló.
- Chequi y Chequi 3 fallan cerrados y con tope de intentos.
- Propi pregunta antes de borrar.

**Capi y estabilidad** (`sv.js`, `comun.js`):
- Confirmación en pantalla para subir a Lofty.
- Lista de sitios que se pueden leer.
- Sin ajustes sensibles.
- Palabra de activación más estricta.
- Timeouts: 30 s para Lofty (`loftyApi`) y 2 min para Claude.

## Pruebas

Corren sin Chrome y sin internet:

```bash
node --test tests/*.test.js
```

Son 27 pruebas, todas pasan:
- `tests/politica-sms.test.js`: horario (también con horario de verano), bajas, tope, falla cerrada, palabras de baja.
- `tests/lofty-core.test.js`: DNC "Do Not 1 Call", litigators, empresas, repetidos, fórmulas en CSV.
- `tests/domicilios.test.js`: respaldo sin background (HECM), borrado solo de Propi, filtros que fallan cerrados.

### Verificación manual en Chrome (antes de usar con leads reales)

1. Recarga la extensión (`chrome://extensions` → ↻) y confirma que diga **1.61.0**.
2. Abre el Centro de Mando y revisa que **Veri** muestre su pantalla (antes faltaba `bv.html`).
3. **Lofti:** "Subir solo a Lofty" debe salir **apagado** (si no lo habías prendido tú).
4. **Marki:** al dar ▶ Iniciar con SMS prendidos debe salir la ventana de confirmación. Dale **Cancelar**.
5. **Texi:** arma una lista; **no la mandes**. Fuera de 8–21 h, si mandaras, se detendría con "fuera de horario".
6. **Capi:** pídele "sube los leads" con leads listos; debe salir la ventana. Dale **No**.

## Pendiente (no se hizo en esta pasada)

Riesgos MEDIOS y BAJOS que quedan para la Fase 1b o la Fase 2:

- **Wibi:** si falla la revisión en Lofty, el error se pierde (`wibi.js:92`, puede duplicar).
- **Owny:** borra de `bvPendientes` lo que no pudo leer (`owners.js:632`).
- **Prope:** sin paginación (más de 200) y carrera en `prCasos`.
- **Marki:** paginación (`offset=0`).
- **Propwire:**
  - pausa por bloqueo no compartida (`radarPausa`/`wbPausa`);
  - throttle de Propi sin candado;
  - Propi llena la bitácora de Capi.
- **Datos personales:**
  - PII en la bitácora de Capi (`svEventos`) y en lo que se manda a Claude;
  - retención de datos de herederos;
  - `unlimitedStorage` o poda de `prCasos`/`hrCasos`/`hrVistos`.
- **Permisos y candados:**
  - reducir `<all_urls>` a los dominios usados;
  - candado entre varios paneles laterales (uno por ventana de Chrome).
- **Robots y sitios:**
  - Timi publica en Teams sin OK;
  - Limpi sin "deshacer";
  - Termi cambia la zona de Propi;
  - Redi deja abierta la ventana de redactar si falla.
- **Limpieza de código muerto:** `cp.js`, la rama vieja de `wb.js`, ~150 líneas de `hr.js`.
