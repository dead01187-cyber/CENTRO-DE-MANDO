# Fase 5: Tablero (v1.65.0)

En el Centro de Mando hay un botón nuevo, **📊 Tablero**. También está en el menú del cajón, junto a Capi. Capi lo abre si le dices "enséñame el tablero".

**El tablero lee solo los datos guardados** (bus de tareas, registro de SMS, bitácora, uso de Claude, resultados de Cumpli, Qai, Vali y Punti, y el estado que cada robot guarda). **Nunca lee las páginas de los robots.** Se actualiza solo cada vez que algo cambia, y además cada 30 segundos.

## Qué muestra

| Sección | Contenido |
|---|---|
| **Semáforo** | Verde, amarillo o rojo. **Rojo** si Cumpli tiene hallazgos graves, Qai tiene fallas o un robot está en error. **Amarillo** si hay aprobaciones pendientes, errores en 24 h, robots que piden ayuda o están sin señal, o un presupuesto de Claude por encima del 80% |
| **Números** | Robots trabajando, con problema y apagados; tareas vivas; tareas que esperan tu OK; errores 24 h; SMS de hoy; Claude de hoy |
| **Esperando tu aprobación** | Botones **Aprobar** (con confirmación) y **Rechazar**. Es la misma aprobación que la tarjeta del chat de Capi |
| **Misión** | Zona, meta, estado, fase y avance |
| **Supervisores** | GEO, CRM, GROW y OPS: sus robots, cuántos trabajan, cuántos tienen problema, tareas vivas, errores y uso de su presupuesto de Claude |
| **Robots** | Los 30 robots con su estado, último mensaje y hace cuánto, errores 24 h, tareas hechas y fallidas, % de éxito y duración promedio. Un robot que dijo "trabajando" y lleva 10 minutos sin moverse sale como **sin señal** |
| **Tareas del bus** | Las últimas 25, con resultado o error. **Cancelar** para las que siguen vivas |
| **Leads y SMS de hoy** | Domicilios, lotes, listos para Lofty, subidos, SMS enviados y bloqueados hoy, respuestas por atender, interesados, repetidos de zBuyer, "no sirven" (Vali) y prioridad alta (Punti) |
| **Costos de Claude hoy** | Llamadas, tokens de entrada y salida, y uso del tope, por Capi, cada supervisor, robots y Resi |
| **Errores (24 h)** | Los más recientes por robot |
| **Seguridad y cumplimiento** | Cumpli, Qai, política de SMS, bajas permanentes, subida automática, Marki borrando números, aprobaciones pendientes, y qué robots pueden escribir en Lofty, mandar SMS, gastar créditos o publicar |

### Costos en dólares (opcional)

Por defecto el tablero muestra **tokens**, porque el precio depende del modelo y cambia. Para ver dólares, guarda **tus** precios en US$ por millón de tokens. En la consola del Centro de Mando:

```js
chrome.storage.local.set({ llmPrecios: { entrada: 3, salida: 15 } })   // ← pon los precios vigentes de tu modelo
```

El tablero no trae precios propios a propósito, para no mostrar cifras viejas o inventadas.

## Cambios técnicos

- **`tablero-core.js`:** junta todo en un objeto. Es código puro y se puede probar sin Chrome.
- **`tablero.html` y `tablero.js`:** la pantalla. Todo el texto entra con `textContent`. Lo único que escribe son las aprobaciones, rechazos y cancelaciones, y siempre con tu clic.
- **`robot.js`:** cada robot guarda su estado en `rbEstado_<robot>` (como mucho una vez cada 2 s). Así el tablero ya no necesita leer las páginas.
- **`fase4.css`:** las tablas usan los colores del tema (se leen en neón y en n8n) y ya no ensanchan la página.
- **Centro de Mando:** botón 📊 Tablero, iframe y entrada en el menú.
- **Capi:** `mostrar_modulo` acepta `tb`.

## Pruebas

- **Pruebas automáticas:** `node --test tests/*.test.js` corre **55 pruebas**, todas pasan. 4 son nuevas, en `tests/tablero.test.js`: estados, sin señal, apagado, rendimiento, supervisores, tareas, errores, misión, costos con y sin precios, y semáforo.
- **Prueba en un Chromium aislado** con datos de ejemplo inventados, sin cuentas ni internet:
  - salió el semáforo;
  - aparecieron la tarjeta de aprobación y los 30 robots;
  - **Aprobar → confirmar** dejó la tarea de Limpi en `pendiente`;
  - en el cajón del Centro de Mando el contenido cabe (459 px de 459);
  - sin errores de JavaScript.
- Con las capturas se corrigieron dos cosas antes de cerrar:
  - tablas ilegibles en el tema oscuro;
  - contenido que se salía del cajón.
- **No se probó con tus datos reales.**

### Verificación manual sugerida

1. Recarga la extensión: debe decir **1.65.0**.
2. En el Centro de Mando, dale **📊 Tablero**. Revisa el semáforo y la sección "Seguridad y cumplimiento".
3. Deja trabajar a un robot y mira cómo cambia su estado en la tabla de Robots.

## Límites conocidos

- **Los errores salen de la bitácora**, que guarda solo los últimos 150 eventos. Si hubo muchos, el conteo de 24 h se queda corto (el tablero lo avisa).
- **Si un robot nunca ha trabajado desde esta versión, sale "sin datos".**
- **Los robots que todavía no usan el bus** (Propi, Veri, Owny, Acti, Heri, Lofti) no muestran éxito ni duración de tareas. Eso llega cuando se migren al bus.
