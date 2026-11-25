# Fase Anna 2: Resi con IA (v1.87.0)

Resi y Resi 2 ahora platican con los leads que contestan, los califican y te avisan. Rama: `fase-anna`.

## Qué hace

- **Califica con Claude**, usando la API key de Capi:
  - **Sellers (Resi):** cuándo quiere vender, por qué, en qué precio piensa y si ya tiene agente.
  - **Buyers (Resi 2):** cuándo quiere comprar, qué busca, su presupuesto y si ya tiene agente.
  - Lo que el lead dice se va guardando en la tarjeta. En cada respuesta, Resi pregunta **una sola cosa** de lo que falta.
- **Cómo suena:** humano y corto (máximo 220 caracteres), sin emojis y sin prometer precios ni comisiones. Si el lead está caliente, propone una llamada hoy o mañana.
- **Mismo nombre siempre:** está en Ajustes, por defecto "Christopher". También se puede activar "Decir que soy su asistente".
- **Categorías nuevas:**
  - **Caliente:** quiere vender o comprar en menos de 6 meses, o acepta llamada.
  - **Para ti:** preguntó algo **legal, de financiamiento o de herencias/trusts**. Resi **no contesta**, lo marca urgente y te avisa. Lo detecta con reglas en inglés y español, y también si Claude lo detecta.
- **STOP:** baja permanente (como antes), más **`cannotText` en Lofty**, y fin de la plática. No pasa por la IA.
- **Notas en inglés** en Lofty, una por cada respuesta nueva, con la clasificación, el resumen, la calificación (Timeline, Reason, Price in mind, Agent) y la etapa sugerida.
- **Avisos con Capi:** "Jefe, X está CALIENTE…" y "X preguntó algo legal, de financiamiento o de herencia: no le contesté, te lo paso".
- **Etapas:**
  - caliente → **Hot**; interesado o tibio → **Warm**. Los nombres se cambian en Ajustes.
  - Nunca baja de Hot a Warm.
  - **No se mueven solas.** Aparecen en "Etapa sugerida" y se mueven con un clic: por lead, o con "Mover todas", que te enseña la lista antes.
  - Resi revisa que Lofty sí la cambió y deja una nota.

## "Aprobar cada respuesta" (Ajustes)

- **Prendido** (así viene): Resi deja el borrador y tú lo mandas.
- **Apagado:** Resi contesta solo a los interesados, calientes, preguntas, seguimientos y "más adelante". Siempre:
  - con el **Cerebro**, como respuesta a alguien que nos escribió; no contesta si una persona le escribió en 24 h;
  - con la **política de SMS**: bajas, horario 8–21 h y solo California;
  - a **ritmo humano**: turno de 6–12 s compartido con Texi y Compri.
- Nunca contesta "Para ti", STOP, número equivocado ni enojados.

## Archivos

- `resi-core.js` (nuevo): temas sensibles, prompt de calificación, lectura de la respuesta de Claude, etapa propuesta y nota en inglés.
- `rs.js`, `rs.html`, `rc.html`: categorías, ajustes, tarjeta con la calificación, etapas sugeridas, STOP con `cannotText`, avisos y modo automático.
- **Pruebas:**
  - `tests/resi-ia.test.js` (unitarias);
  - `tests/e2e/resi-ia.e2e.js`, con un **Claude falso** y un Lofty falso.

## Aviso legal (no es asesoría)

- La ley de bots de California (Bus. & Prof. Code §17940) pide decir que es automatizado cuando un bot busca cerrar una venta o un servicio con alguien en California.
- Con "aprobar cada respuesta", cada mensaje lo mandas tú.
- **Antes de apagarlo**, conviene que un abogado lo revise, o activar "Decir que soy su asistente".
