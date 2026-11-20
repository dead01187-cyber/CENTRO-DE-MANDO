# Fase 2b: Acciones grandes y misiones por el bus (v1.67.0)

Completa lo que quedó pendiente de la Fase 2: **las acciones grandes y el motor de misiones ya no dan clics ni leen las páginas de los robots**. Todo pasa por el bus de tareas, con las mismas reglas de siempre:
- persisten aunque cierres el panel;
- no se duplican;
- solo una pestaña ejecuta cada tarea;
- las delicadas esperan tu aprobación;
- se pueden cancelar;
- se ven en el tablero.

## Acciones nuevas en el bus

| Robot | Acción | Entrada (opcional) | ¿Tu aprobación? | Al cancelar |
|---|---|---|---|---|
| Propi | `buscar` | zona, paginas, tope | No | Le da "Parar" |
| Veri, Veri 2, Veri 3 | `ciclo` | maxPestanas | No | "Parar después de esta búsqueda" |
| Owny, Owny 2, Owny 3 | `leer` | vivo, auto, cerrarLeidas | No | Detiene al fantasmita |
| Wibi | `leer` | carpeta (lista de Carpi) | No (no sube nada) | Para |
| Heri | `buscar` | dias, tope | No | Para |
| Acti | `traer` | etapa, tag, ciudad, tanda | **Sí** (cambia leads en Lofty) | Para |
| Lofti | `subir` | soloUno | **Sí** (crea leads en Lofty) | Detiene el envío |

Sin entrada, cada acción usa lo que ya está escrito en la pantalla del robot.

## Cambios que vas a notar

- **Subir a Lofty desde Capi.** Antes salía una ventana de confirmación. Ahora queda una **tarea con tarjeta Aprobar / Rechazar**, en el chat de Capi y en el tablero. Cuando la apruebas, Lofti sube sin volver a preguntar. Si la rechazas, no sube nada.
- **Acti.** Si Capi o un supervisor le piden "traer", también espera tu aprobación. Antes Capi lo podía arrancar directo.
- **Cancelación inmediata.** Cancelar una tarea en el tablero detiene al robot al momento (antes solo se marcaba).
- **Misiones:**
  - Capi pide **tareas**:
    - Propi `buscar`, con una página más en cada vuelta;
    - Veri `ciclo` cuando hay pendientes;
    - Owny `leer` en vivo.
  - Mide el avance con los **conteos guardados**, no leyendo las pantallas.
  - Al llegar a la meta sin "Subir solo a Lofty", cancela el ciclo de Veri y te pide el OK.
  - Al pausar o cancelar la misión, se cancelan las tareas que la misión pidió.
  - Si la página de un robot está cerrada, su tarea espera en fila y no se pierde.
- **Error que ya existía, ahora detectado.** Si en Chequi está **"Mandar a: Wibi"**, los domicilios de leads nuevos van a una línea de Wibi que **no está montada** en ningún lado (`wb.html` sin `?linea`), así que nadie los busca. Antes la misión no lo notaba. Ahora **se pausa y lo dice**. Mientras eso no se arregle, usa "Mandar a: Veri". La línea HECM con Wibi 3 sí funciona.

## Lo que todavía lee pantallas

`ver_estado` de Capi (la foto del flujo que le cuenta al jefe) todavía lee algunos textos de las pantallas para informar. Solo lee, no actúa. Se puede pasar a datos guardados más adelante; el tablero ya no los necesita.

## Pruebas

- **Unitarias:** 59 pasan (2 nuevas). Ahora el bus considera duplicado solo lo que tiene la misma entrada (buscar Irvine ≠ buscar Tustin). Lofti `subir` y Acti `traer` piden aprobación.
- **De punta a punta, contra el Lofty falso:** 11 pasan (3 nuevas):
  - Capi `subir_leads` deja la tarjeta; al rechazarla no sube nada.
  - Lofti `subir` aprobado sube sin volver a preguntar y quita el 800 y el DNC.
  - **La misión completa por el bus:**
    - pide Propi con zona y páginas, y Owny en vivo;
    - al llegar domicilios, pide a Veri;
    - al llegar a la meta espera tu OK y cancela a Veri;
    - al pausar, cancela lo que pidió;
    - sin errores de JavaScript.
- **No se probó** con Propwire ni con BeenVerified reales: en el ambiente de prueba no hay internet. La búsqueda de Propi y el ciclo de Veri se probaron hasta el punto de crear y cancelar sus tareas.

### Verificación manual sugerida

1. Recarga la extensión: debe decir **1.67.0**.
2. Pídele a Capi una misión chica, por ejemplo "quiero 5 propiedades de Irvine". En el **📊 Tablero** deben aparecer las tareas de Propi, Owny y Veri.
3. Cuando llegue a la meta, Capi te pide el OK: sale la tarjeta **Aprobar / Rechazar**. Aprueba solo si los 5 leads se ven bien.
