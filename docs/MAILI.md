# Maili — correos desde Lofty (v1.93.0)

Maili es la pareja de Texi, pero por **correo**. Manda desde Lofty con la cuenta de **Texi 2** (la misma API key
que ya pusiste en la pestaña de Texi 2; no hay llaves nuevas ni nada en el código).

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

## Lo que falta confirmar en tu Lofty real
- Que `/v1.0/communication/email?leadId=` exista en la API de tu cuenta. Si responde 404, Maili sigue trabajando
  solo con el registro del Cerebro y lo avisa en la bitácora.
- **Prueba recomendada:** crea un lead con TU correo, mándale un correo con Maili y contéstalo. Con eso vemos
  de dónde puede leer **Remi** las respuestas (Lofty o Gmail).

## Pendiente: Remi
Remi leerá las respuestas a los correos de Maili (como Resi con los SMS): bajas, interesados y borradores de
respuesta con tu OK. Se construye después de la prueba de arriba.

## Archivos
`maili-core.js` (reglas puras), `ml.html`, `ml.js`, y pruebas en `tests/maili.test.js` y `tests/e2e/maili.e2e.js`.
