# Fase 4: Robots nuevos (v1.64.0)

Se agregaron **5 robots nuevos**. Todos son de **solo lectura**: no escriben en Lofty, no mandan SMS ni correos y no gastan créditos. Usan datos que la extensión ya guarda; no hace falta ningún servicio ni llave nueva.

| Robot | Supervisor | Qué hace | Archivos |
|---|---|---|---|
| **Vali** | CRM | **Validación de datos.** Revisa los lotes listos para Lofti: números imposibles (lada o central con 0/1, x11), de mentira (555-01xx, todos iguales, en secuencia), 800/900, repetidos entre leads distintos, fuera de California, sin nombre, dueño empresa, sin ciudad o código postal. **Lofti ya quita solo los números "malos" al procesar** (sale como "Números falsos quitados (Vali)") | `vali-core.js`, `va.html`, `va.js` |
| **Punti** | GROW | **Lead scoring de 0 a 100**, con las razones de cada puntaje. Señales: zona caliente (Termi), hipoteca inversa y herederos (Heri), teléfonos que sirven (Vali), correo y la respuesta al SMS (Resi). Quien contestó "interesado" siempre queda en prioridad alta; las bajas quedan en 0 | `punti-core.js`, `pu.html`, `pu.js` |
| **Cumpli** | OPS | **Auditoría de cumplimiento.** Revisa el registro de SMS de los últimos 7, 30 o 90 días. Detecta SMS después de una baja, fuera de 8–21 h de California, fuera de California, más de uno al día al mismo número y por encima del tope. También detecta ajustes riesgosos prendidos: subida automática, Marki borrando números, aprobaciones pendientes. Avisa a Capi solo si aparecen hallazgos graves **nuevos** | `cumpli-core.js`, `cu.html`, `cu.js` |
| **Qai** | OPS | **QA del sistema.** Revisa almacenamiento (de 10 MB), tareas atoradas, fallidas o en fila, registro de robots, llaves (solo si existen, nunca su valor), política de SMS, errores de la última hora y errores de código, robots apagados, listas muy grandes y uso de Claude. Se repite cada 30 min mientras el Mando está abierto | `qa-core.js`, `qa.html`, `qa.js` |
| **Ana** | OPS | **Analítica.** SMS por día y por robot, motivos de bloqueo, tasa de respuesta e interés, bajas, leads subidos, tareas del bus por estado y duración, errores por robot y Claude de hoy. Es la base del tablero de la Fase 5 | `ana-core.js`, `an.html`, `an.js` |

Además:
- **Centro de Mando:** nueva fila "Calidad y operación" con las 5 estaciones y su resumen, y su grupo en el menú del cajón.
- **Bus de tareas:** cada robot tiene una acción sin aprobación:
  - `va revisar`
  - `pu puntuar`
  - `cu auditar`
  - `qa revisar`
  - `an calcular`

  Capi las pide con `clic` y los supervisores con su área: CRM a Vali, GROW a Punti, OPS a Cumpli, Qai y Ana.
- **Capi** conoce a los robots nuevos. Responde "¿cómo vamos?", "¿a quién le hablo primero?" y "¿estamos cumpliendo?".
- `fase4.css` y `vista.js`: estilo y ayudas de pantalla compartidas. Todo el texto entra con `textContent`, nunca `innerHTML` con datos.
- `termi-calc.js`: `calificar()` acepta `{ guardar: false }` para que Punti calcule sin tocar el resumen de Termi.

## No se hicieron (necesitan una decisión tuya)

| Robot del plan | Por qué no | Qué haría falta |
|---|---|---|
| **Validación celular/fijo y línea activa** | No se puede saber sin un servicio de pago | Elegir proveedor (Veriphone, Twilio Lookup, etc.) y poner su llave. Vali ya tiene el lugar donde conectarlo |
| **Inteligencia de mercado** | Termi y Radar ya califican zonas. Algo más profundo requiere una fuente de datos de mercado que hoy no existe en la extensión | Decidir la fuente: scraping de Redfin/Zillow (riesgo de términos de uso), un API de pago (ATTOM, etc.) o el MLS |
| **CMA** (análisis comparativo) | Necesita ventas comparables reales. Inventarlas sería peligroso | La misma fuente de datos de arriba |
| **Nurturing** (seguimiento automático) | Implica **mandar mensajes**. Resi ya deja borradores de seguimiento que tú apruebas, y cualquier envío automático tendría que pasar por la política de SMS y por tu aprobación | Definir secuencia, ritmo y textos. Se haría como tareas del bus **con aprobación** |

## Pruebas

- **Pruebas automáticas:** `node --test tests/*.test.js` corre **51 pruebas**, todas pasan. Las nuevas están en `tests/robots-fase4.test.js` (7 pruebas) y una más en `tests/lofty-core.test.js`, para Lofti con Vali.
- **Prueba en un Chromium aislado** con datos de ejemplo inventados, sin cuentas ni internet:
  - **Vali** marcó 1 lead que no sirve y 2 por revisar, y encontró 1 teléfono falso (el 800).
  - **Cumpli** detectó el SMS mandado después de una baja (grave).
  - **Qai:** todo bien, con 2 avisos (faltan llaves).
  - **Punti** calificó 4 leads.
  - **Ana:** 50% de respuesta.
  - **Lofti** mostró "1 Números falsos quitados (Vali)".
  - **Capi** pidió la auditoría por el bus.
  - El Centro de Mando mostró las 5 estaciones.
  - Sin errores de JavaScript.
- **Con tus datos reales no se probó.**

### Verificación manual sugerida

1. Recarga la extensión: debe decir **1.64.0**.
2. En el Centro de Mando, baja hasta la fila "Calidad y operación" y abre **Cumpli**. Si sale algo grave, revísalo antes de mandar más SMS.
3. Abre **Vali** y **Punti**, y revisa que lo que marcan tenga sentido con tus leads.
