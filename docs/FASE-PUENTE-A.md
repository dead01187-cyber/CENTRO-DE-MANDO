# Fase A del puente: servicios que trabajan solos en tu Mac (v1.90.0)

**Rama:** `puente-servicios`, hecha sobre `navi-browser-use`. **No toca `main`.**

**Objetivo:** que el puente de Navi pueda correr robots **aunque Brave esté cerrado**. Esta fase pone la base:
- el **llavero**;
- los **servicios en segundo plano**;
- la pantalla **Puente** en el Centro de Mando.

Rayo y el Cerebro se mudan en las fases B y C.

**Decisiones del jefe que aplica esta fase:**
1. Si el puente se apaga, los robots de la extensión **siguen trabajando** y el Mando **avisa**.
2. Las llaves van en el **Llavero de macOS**.
3. La Mac **no se duerme de 8 am a 9 pm**.

## 1. Qué cambió

### En el puente (`puente/`)

| Archivo | Qué hace |
|---|---|
| `llavero.py` | Guarda en el **Llavero de macOS** (servicio `com.christopher.navi`) las llaves de Lofty que le mandas desde el Mando. Detalles abajo. |
| `servicios/__init__.py` | Base de los **servicios**: trabajos que corren solos, cada uno con interruptor, estado, texto y log. Detalles abajo. |
| `servicios/despierto.py` | **Mac despierta:** de **8 am a 9 pm** (hora de California) usa `caffeinate -i` de macOS para que la Mac no se duerma. Fuera de ese horario lo suelta. Está atado al puente: si el puente se cae, caffeinate también. |
| `servicios/lofty_salud.py` | **Salud de las llaves de Lofty:** cada 10 min revisa que las llaves del puente sirvan. **Solo lee** (pide 1 lead). Si una no sirve, avisa con un mensaje claro. |
| `puente.py` | Endpoints nuevos, con la misma clave, CORS y revisión de `Host` que los demás. Lista abajo. |
| `instalar.sh` | Copia también el llavero y los servicios a `~/.navi/puente/`. |

**`llavero.py`**
- La llave le llega a `security` **por stdin**, nunca en la línea de comandos: así no se ve en la lista de procesos.
- Solo acepta `loftyKey`, `txKey` y `t2Key`, y solo valores con forma de llave.
- **Nadie puede leer una llave por HTTP.** El puente solo dice si está puesta y sus últimos 4 caracteres.
- Fuera de la Mac (en las pruebas) usa `~/.navi/llaves.json` con permisos 600.

**`servicios/__init__.py`**
- El interruptor de cada servicio se recuerda en `~/.navi/servicios.json`.
- Un servicio que falla **no tumba al puente**.
- El puente solo carga los servicios de su lista fija.

**Endpoints nuevos de `puente.py`**
- `GET /llaves`: qué llaves hay, **sin su valor**.
- `POST /llaves`: guarda una llave. `POST /llaves/borrar`: la quita.
- `GET /servicios` y `GET /servicios/<nombre>`: estado, texto y log.
- `POST /servicios/<nombre>/prender`, `/apagar` y `/ahora`.
- `/salud` ahora dice además el estado de cada servicio y el tipo de llavero.

### En la extensión
- **Robot nuevo "Puente"** (`sp.html`, `sp.js`, `sp-core.js`), supervisor **OPS**, solo lee. **En su pantalla:**
  - cada servicio con su chip (Listo, Trabajando, OK, Error, Apagado), su texto, su **interruptor**, un botón **Ahora** y su **log**;
  - **Llaves en el puente:** botón **"Mandar al puente"** por cada llave que tenga la extensión. Se manda **solo con tu clic**. Después enseña "En el puente (…abcd)" y deja **Quitar**.
  - Usa **la misma clave del puente que Navi**: si ya la pegaste en Navi, aquí ya sirve.
- **Comportamiento:**
  - escribe en la **bitácora** cuando un servicio falla o se recupera;
  - si el puente se apaga, dice **"El puente está apagado. Corre puente/instalar.sh"**;
  - en esta fase ningún robot de la extensión depende del puente, así que nada más se detiene.
- **Centro de Mando:** estación **Puente** (fila 14, columna 6, debajo de Navi), botón en el cajón ("Calidad y operación") y el resumen ("2 servicio(s) bien" o "1 con problema de 2").
- **Capi:** puede revisar el puente (`clic sp → run`). **Nunca manda llaves.**

## 2. Cómo instalar (si ya tienes Navi)

1. **Actualiza la extensión** a la rama `puente-servicios` y recárgala en `brave://extensions`.
2. **Reinstala el puente** para que copie lo nuevo. No te vuelve a pedir el ID ni cambia la clave:
   ```bash
   bash ~/Desktop/CENTRO-DE-MANDO-claude-peaceful-fermi-mfgt13/puente/instalar.sh
   ```
3. **Abre Puente** en el Centro de Mando y dale **"Mandar al puente"** a la llave de **Lofty de Texi / Resi / Rayo**.
   - La de **Lofty principal** también la vas a necesitar en la fase C, para silenciar a Anna.
   - La primera vez macOS puede preguntar si `security` o `python3` pueden usar el Llavero: dale **Permitir siempre**.

## 3. Cómo verificar

| # | Qué hacer | Qué debe pasar |
|---|---|---|
| 1 | Abre **Puente** | Dos servicios: **Mac despierta** (de 8 am a 9 pm dice "La Mac no se duerme hasta las 9 pm") y **Salud de las llaves de Lofty** |
| 2 | **Mandar al puente** la llave de Texi | En unos segundos: **"Llaves de Lofty OK (1)."** y "En el puente (…últimos 4)" |
| 3 | Abre la app **Acceso a Llaveros** y busca `com.christopher.navi` | Aparece la llave como `Centro-de-Mando-txKey` |
| 4 | En la Terminal: `pmset -g assertions \| grep caffeinate` (en horario) | Sale un `caffeinate` del puente que evita el reposo |
| 5 | Apaga **Mac despierta** con su interruptor y vuelve a correr el paso 4 | Ya no sale. Préndelo otra vez |
| 6 | Cierra Brave por completo y espera 10 min. Abre Brave y el Mando | La salud de Lofty siguió revisando sola (el log tiene horas de cuando Brave estaba cerrado) |
| 7 | `launchctl bootout gui/$(id -u)/com.christopher.navi` y dale **Revisar ahora** | "El puente está apagado. Corre puente/instalar.sh". Vuelve a prenderlo con `instalar.sh` |

### Pruebas automáticas
- **`npm test`: 88 pasan**, incluidas las **32 del puente en Python**. Las nuevas cubren:
  - el llavero en archivo 600;
  - la llave por stdin a `security` (con un `security` falso);
  - caffeinate dentro y fuera de horario;
  - la salud de Lofty con un Lofty falso que no deja escribir;
  - interruptores que se recuerdan;
  - un servicio que truena;
  - los hilos.
  - En JavaScript: `tests/sp.test.js` (4).
- **`npm run test:e2e`: 32 pasan.** La nueva `tests/e2e/puente-servicios.e2e.js` usa la extensión real, el puente real y un Lofty falso. Revisa:
  - mandar las llaves con un clic;
  - "OK" con la llave buena y "Error" con la mala;
  - el aviso en la bitácora;
  - el interruptor;
  - la estación en el Mando;
  - el aviso de puente apagado.

## 4. Qué falta / avisos
- **Probar en tu Mac:**
  - **El Llavero real.** Aquí se probó con un `security` falso; el Llavero de verdad solo existe en macOS.
  - **caffeinate.**
- **Tapa cerrada:** una **laptop con la tapa cerrada se duerme igual** (salvo con monitor externo y corriente). caffeinate evita el reposo por inactividad, no el de la tapa.
- **Siguiente, Fase B:** el Cerebro y la política de SMS compartidos, con el puente como árbitro y las mismas reglas en JavaScript y en Python.
- **Después, Fase C:** Rayo en el puente.
