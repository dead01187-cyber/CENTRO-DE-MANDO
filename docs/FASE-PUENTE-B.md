# Fase B del puente: Cerebro y política de SMS compartidos (v1.91.0)

**Rama:** `cerebro-compartido`, hecha sobre `puente-servicios`. **No toca `main`.**

**Objetivo:** que los robots de la extensión y los que vivan en el puente vean **la misma verdad**, para que ningún lead reciba doble SMS. Eso incluye:
- quién le escribió a quién;
- las bajas (STOP);
- el turno del número de SMS.

Es lo que hace falta antes de mudar a Rayo al puente (Fase C).

## 1. Qué cambió

### El puente es el árbitro
| Archivo | Qué hace |
|---|---|
| `puente/reglas.py` | **Copia exacta en Python** de las reglas del Cerebro (máximo 1 SMS cada 24 h entre todos, persona que escribió, Anna, respuesta de Resi) y de la política de SMS (solo números de California, horario 8–21 h, palabras de baja). |
| `tests/casos/reglas.json` | **51 casos** con el resultado del JavaScript actual. Python y JavaScript se prueban con **los mismos casos** y dan exactamente lo mismo, incluido el texto del motivo. Si un día cambia una regla y alguien olvida la otra versión, las pruebas fallan. |
| `puente/arbitro.py` | La **única lista** de contactos, bajas permanentes (por teléfono y por lead) y turnos del número. Se guarda en `~/.navi/cerebro.json` con permisos 600. Detalles abajo. |
| `puente/puente.py` | Endpoints nuevos, con la misma clave, CORS y `Host` de siempre. Lista abajo. |

**El turno del número**
- Aparta el siguiente lugar con **6 a 12 s** entre SMS del mismo número, aunque varios robots pidan al mismo tiempo.
- El puente **nunca llama a Lofty**: el robot le manda lo que ya leyó (textos del lead y Anna).

**Endpoints nuevos**
- **Cerebro:** `/cerebro/resumen`, `/cerebro/contactos`, `/cerebro/anotar`, `/cerebro/revisar` y `/cerebro/importar`.
- **Bajas:** `/bajas` y `/bajas/marcar`, `/bajas/quitar`, `/bajas/revisar`.
- **Turno:** `/turno`.

### La extensión le pregunta al árbitro
- **`puente-cliente.js`:** lo cargan todas las páginas que usan el Cerebro o la política de SMS (Texi, Texi 2, Compri, Resi, Resi 2, Rayo, Marki, Limpi y el Tablero).
- **Cerebro:**
  - cada contacto se anota local **y en el puente**;
  - antes de contactar pregunta primero a la regla local y, si dice que sí, **también al puente**;
  - **manda lo más estricto**. Si el puente lo frena, el motivo dice "… (según el puente)".
- **Política de SMS:**
  - las **bajas** se marcan y se quitan también en el puente;
  - si la extensión no conoce una baja, le pregunta al puente;
  - cada SMS enviado se anota allá.
- **Turno del número:** Texi, Resi y Rayo esperan lo que diga el puente, **sin bajar nunca** de su espera local de 6–12 s.
- **Sincronizar:** cada 30 s como mucho, la extensión baja los contactos y bajas que anotó el puente (por ejemplo, de un robot que vive allá).
  - Si el puente es nuevo o estuvo apagado, le **sube** lo que tenía la extensión: contactos, bajas y último turno. No se duplica nada.
- **Si el puente está apagado** (decisión del jefe):
  - todo sigue con la copia local, como antes;
  - se avisa en la bitácora como mucho cada 10 min ("Puente apagado: … siguen con su copia local");
  - nunca se espera más de 2.5 s al puente.
- **Sin la clave del puente:** la extensión trabaja igual que antes, sin avisos.
- **Pantalla Puente:** ahora enseña también los **contactos de las últimas 24 h** y las **bajas permanentes** del Cerebro compartido.

## 2. Cómo instalar
1. **Actualiza la extensión** a la rama `cerebro-compartido` y recárgala.
2. **Reinstala el puente**, para que copie `reglas.py` y `arbitro.py`:
   ```bash
   bash ~/Desktop/CENTRO-DE-MANDO-claude-peaceful-fermi-mfgt13/puente/instalar.sh
   ```
3. **Abre Puente** en el Centro de Mando. La primera vez la extensión le sube su historial y la bitácora dice "Puente: le subí lo que tenía la extensión (N contacto(s), M baja(s))".

## 3. Cómo verificar
| # | Qué hacer | Qué debe pasar |
|---|---|---|
| 1 | Abre **Puente** | "contactos en 24 h" y "bajas permanentes" con números parecidos a lo que ya tenías |
| 2 | `curl -s -H "X-Navi-Token: $(cat ~/.navi/token)" http://127.0.0.1:8765/cerebro/resumen` | Los mismos números |
| 3 | Manda **un** SMS de prueba con Texi a tu propio número. Luego, en Resi, intenta un mensaje personalizado al mismo lead | Resi no lo manda: "ya recibió un SMS hace N min (Texi); máximo 1 cada 24 h" |
| 4 | Apaga el puente (`launchctl bootout gui/$(id -u)/com.christopher.navi`) y usa Texi | Texi sigue funcionando. En la bitácora: "Puente apagado: … siguen con su copia local". Vuelve a prenderlo con `instalar.sh` |
| 5 | Después del paso 4, abre **Puente** | Se re-sincroniza solo: lo que mandaste con el puente apagado aparece en sus contactos |

### Pruebas automáticas
- **`npm test`: 94 pasan.** Incluyen las **44 del puente en Python** (12 nuevas del árbitro y las reglas) y las nuevas en JavaScript:
  - `tests/reglas-compartidas.test.js`;
  - `tests/puente-cliente.test.js`: sin clave, puente apagado con un solo aviso, el árbitro más estricto que lo local, bajas y turno, y re-subir lo local cuando el puente vuelve.
- **`npm run test:e2e`: 33 pasan.** La nueva `tests/e2e/cerebro-compartido.e2e.js` usa Texi real con el puente real:
  - Texi salta al lead que ya contactó un robot del puente;
  - salta al número con STOP en el puente;
  - el puente se entera del SMS de Texi;
  - la baja del puente queda también en la extensión.
- **Las pruebas de antes siguen igual** (sin puente), porque en ese caso no cambia nada.

## 4. Qué falta / avisos
- **Marki:** sus SMS ya pasan por el Cerebro y las bajas compartidas, pero **todavía no pide turno al puente**. Manda pocos y espaciados (durante las llamadas). Se puede agregar si quieres.
- **Mientras el puente está apagado:** la extensión decide sola con su copia. Al volver, se juntan las dos listas.
- **Un robot del puente**, cuando exista (Rayo, en la Fase C), solo verá lo que la extensión le haya avisado al puente. Hay un hueco: si dos robots, uno en cada lado, contactan al mismo lead en el mismo minuto con el puente apagado.
- **Siguiente, Fase C:** Rayo en el puente. Funcionará aunque Brave esté cerrado, con la prueba en "sombra" y el interruptor "Rayo corre en: extensión / puente".
