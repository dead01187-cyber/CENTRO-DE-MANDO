# Maili y Remi — correos desde Lofty (v1.94.0)

Maili es la pareja de Texi, pero por **correo**. Manda desde Lofty con la cuenta de **Texi 2** (la misma API key
que ya pusiste en la pestaña de Texi 2; no hay llaves nuevas ni nada en el código).

> **Maili y Remi son exclusivos de The Irvine Realtors.** La plantilla de ejemplo y el pie ya vienen con esa marca,
> y si un correo o el pie mencionan “Rubio Real Estate”, Maili no deja mandar.

## Cómo se usa
1. Abre **Maili** en el Centro de Mando (grupo *Lofty CRM*).
2. Llena una sola vez el **pie de los correos**: tu nombre/empresa y tu dirección postal. Sin eso Maili no manda
   (lo pide la ley CAN-SPAM). El pie también dice cómo darse de baja: *reply "unsubscribe"*.
3. Escoge **etapa** y/o **tag**, el tipo de lead y la **plantilla** (asunto + texto; puedes usar `{nombre}`,
   `{apellido}`, `{ciudad}` y `{direccion}`).
4. **Buscar leads**: arma la lista y te enseña el correo exacto de cada uno. No manda nada.
5. **Revisar y mandar** → te enseña un ejemplo y cuántos van → **Sí, mandar**.

## Reglas que Maili siempre respeta
- Nada sale sin tu OK en pantalla. Capi solo puede pedirle *buscar*.
- No le escribe a quien Lofty marca `cannotEmail` / unsubscribe, ni a quien no tiene correo válido.
- Máximo **1 correo por lead cada 7 días** (cuenta los de Maili y los que mande una persona; los automáticos de
  Lofty —reportes de mercado, drips— no cuentan).
- Si una persona del equipo le escribió por correo en las últimas 24 h, no lo toca.
- Antes de cada correo vuelve a leer el lead en Lofty. Si Lofty falla, **no manda** (falla cerrada).
- Ritmo humano: un correo cada 20–45 segundos. Tope diario: 50 (lo puedes cambiar).
- Si la plantilla tiene llaves raras (el error de “Hi Sam}”), no deja mandar.
- Cada correo queda anotado en el Cerebro (canal `email`, robot `Maili`) y en `emailRegistro`.

## Remi — qué pasó con los correos
Remi es la pareja de Maili (como Resi con Texi). Le das **Revisar los correos de Maili** y, por cada lead al que
Maili le escribió en los últimos 30 días, le pregunta a Lofty y te dice:

| Estado | Qué significa |
|---|---|
| **respondió** | Entró un correo del lead después del de Maili. Remi te abre su ficha en Lofty para leerlo. |
| **abrió** | Abrió el correo (y cuántas veces / clics). Buen momento para llamarle. |
| **sin abrir** | Todavía no lo abre. |
| **baja** | Se dio de baja en Lofty. Remi lo guarda y Maili ya no le escribe nunca. |

- Remi **solo lee**: no manda correos ni SMS.
- Opcional (apagado): dejar una nota en Lofty, **en inglés**, cuando responde, se da de baja o abre 2 veces o más.
  No repite la nota.
- Capi puede pedirle a Remi que revise (no necesita aprobación porque no manda nada).

### Límite que encontré en tu Lofty real
La API de Lofty **no entrega el texto** de las respuestas de correo; solo los eventos (enviado, abierto, recibido)
con su asunto y hora. Por eso Remi no redacta contestaciones como Resi: te dice *quién* contestó.
Si más adelante quieres que Remi lea el texto y proponga un borrador, se puede conectar al buzón (Gmail) donde
llegan esas respuestas; dime a qué correo llegan.

También vi que Lofty guarda las aperturas ("Opened") como si fueran correos de salida. Maili ya las ignora para
no bloquear de más.

## Prueba de 5 minutos (recomendada antes de usarlo en serio)
1. En la cuenta de Texi 2 crea un lead con **tu propio correo** y un tag, por ejemplo `prueba-maili`.
2. En Maili: llena el pie, escribe el tag `prueba-maili`, **Buscar**, **Revisar y mandar**.
3. Abre el correo en tu buzón y contéstalo.
4. En Remi: **Revisar**. Debe salir como *abrió* o *respondió*. Si sale *sin abrir* aunque sí lo abriste, avísame
   (significaría que tu cuenta de Lofty no registra esos eventos y hay que ir por Gmail).

## Archivos
Maili: `maili-core.js` (reglas puras), `ml.html`, `ml.js`. Remi: `remi-core.js`, `rm.html`, `rm.js`.
Pruebas: `tests/maili.test.js`, `tests/remi.test.js` y `tests/e2e/maili.e2e.js`.
