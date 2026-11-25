# Fase Anna 1: Cerebro, Rayo y reglas para Anna (v1.86.0)

Objetivo: que los robots le ganen a Anna (el AI Sales Agent de Lofty) en velocidad, calidad y control,
sin dar doble contacto. Rama: `fase-anna`.

## Cerebro (`cerebro-core.js` + `cerebro.js`)

Un registro compartido de cada contacto que hacen los robots (`cerebroContactos`: lead, canal, robot y hora).
Antes de contactar, cada robot le pregunta al Cerebro. Reglas:

1. **Máximo 1 SMS por lead cada 24 h entre todos**: robots, personas y Anna.
   La excepción es Resi cuando contesta a un lead que nos escribió.
2. **Nada si una persona le escribió en las últimas 24 h** (por ejemplo, Daniel).
   - Lofty marca igual, como `Manual`, los SMS de una persona y los de nuestros robots.
   - Por eso el Cerebro cuenta como "persona" un SMS `Manual` que no coincide (±5 min) con uno de nuestros robots.
3. **Leads de Anna**: si el lead está en el pool de Anna y no está silenciado, Texi, Compri, Resi y Marki no lo tocan.
   - Texi 2 no aplica esta regla, porque usa otra cuenta.
   - Los SMS de Anna vienen con `textType: "AI"`. Lo confirmé en la cuenta real; la documentación de Lofty no lo menciona.
4. **Falla cerrada**: si no puede revisar Lofty, no deja contactar.

Lo consultan Texi, Compri, Texi 2, Resi, Resi 2, Marki (llamadas y SMS) y Rayo.
Cada SMS que sale queda anotado solo, desde la política de SMS.

**Nota sobre Texi:** manda a todos los números de California de un lead en la misma tanda.
El Cerebro revisa una vez por lead, antes de la tanda.

## Rayo (`ry.html` + `ry.js`)

- **Revisión:** cada 60 s busca leads nuevos en Lofty.
  - La extensión no puede recibir webhooks (necesitan una dirección pública), por eso revisa en vez de esperar avisos.
  - Solo de las **fuentes elegidas**, por defecto `zBuyer`, para no tocar los que suben tus robots (Lofti y Propwire).
- **Filtros:** número de California, sin DNC ni Do Not Text, sin `cannotText` ni `unsubscription`, y sin duplicados (otro lead con el mismo teléfono).
- **Qué prepara por cada lead:**
  - SMS con nombre y ciudad, con una plantilla para Seller y otra para Buyer;
  - email de presentación;
  - un lugar en la **cola de Marki**.
- **Modo "Con mi OK"** (por defecto): apruebas con un clic, o con Capi por voz (ver abajo).
- **Modo "Automático"**: contacta solo.
- **Carrera con Anna**, justo antes de contactar:
  - si Anna **ya le escribió** (SMS `AI`), ganó Anna: Rayo no lo toca;
  - si no, Rayo gana: **silencia a Anna** en ese lead y luego contacta. Si no logra silenciarla, no contacta, para evitar el doble contacto.
- **Vigilancia de 30 min:** Anna a veces mete al lead a su pool unos minutos después. Rayo vigila sus leads ganados durante 30 minutos y la silencia si aparece.
- **Horario:** no manda SMS de 9 pm a 8 am (hora de California). El lead queda "programado" y sale a las 8 am.
- **Medición:** guarda cuánto tardó en contactar a cada lead (minutos desde que entró a Lofty). Lo usará el marcador de la Fase 3.

## Cola de Marki (`al.js`)

- Marki atiende primero la cola de Rayo y luego su filtro de etapa, tag y tipo.
- Con "seguir esperando leads de Rayo" no se detiene al acabar la lista.
- **La cola solo se atiende de 8 am a 9 pm**, hora de California, para no llamar de noche.

## Capi aprueba por voz (`sv.js`)

- Hay dos herramientas: `rayo_pendientes` (lee la lista) y `rayo_aprobar`.
- Candados:
  - solo el jefe, nunca un aviso automático ni otro robot;
  - solo leads que Capi le **leyó** al jefe en los últimos 5 minutos.

## Reglas para Anna en Limpi (`li.js`)

- Cuando Limpi mueve un lead a No Active Plans y Lofty lo confirma, también lo **silencia en Anna**.
- **Botón "Anna: números fuera de California":** lee el pool de Anna, te enseña la lista y solo silencia con tu OK.

## API de Lofty usada

| Para qué | Endpoint |
|---|---|
| Historial de SMS (con `textType`) | `GET /v1.0/communication/text?leadId=` |
| Pool de Anna | `GET /v2.0/working-leads` |
| Silenciar a Anna | `PUT /v2.0/sales-agents/working-lead/{id}/mute` |
| Ver si está silenciada | `GET /v2.0/sales-agent/lead/mute-status?leadId=` |
| Mandar email | `POST /v1.0/message/email/send` (`leadId`, `subject`, `content`) |
| Mandar SMS | `POST /v1.0/message/sms/send` |

Anna se consulta con la llave principal (`loftyKey`).

## Pruebas

- **Unitarias** (`tests/cerebro.test.js`): las reglas del Cerebro.
- **De punta a punta** (`tests/e2e/fase-anna.e2e.js`), con un Lofty falso que ahora trae historial de SMS, pool de Anna, silencio y email:
  - Rayo con tu OK: ignora otras fuentes, descarta fuera de CA, silencia a Anna, manda SMS y email, y llena la cola de Marki;
  - Rayo pierde contra Anna, o salta a un lead al que le escribió una persona;
  - Texi no incluye leads de Anna y salta al lead de una persona;
  - Limpi silencia fuera de CA solo con tu OK.

## Para que Rayo le gane a Anna

- **Chrome y el Centro de Mando abiertos**, con la Mac despierta. Anna corre 24/7 en Lofty.
- **"Automático"**, o aprobar en menos de ~10 min, que es lo que tarda Anna.
- **Marki corriendo**, para llamar a los de la cola.
