# Fase C del puente: Rayo en el puente (v1.92.0)

**Rama:** `rayo-puente`, hecha sobre `cerebro-compartido`. **No toca `main`.**

**Objetivo:** que Rayo llegue antes que Anna a los leads nuevos **aunque Brave esté cerrado**. Primero se prueba en **sombra** y después se cambia con un interruptor que se puede regresar.

## 1. Qué cambió

### Rayo en el puente (`puente/servicios/rayo.py`)
Es el mismo Rayo de la extensión, escrito en Python:
- **Cada 60 s** busca leads nuevos en Lofty, solo de las fuentes elegidas (zBuyer).
- **Filtros:** número de California, sin DNC / Do Not Text, sin cannotText / unsubscribe y sin duplicados.
- **A cada lead** le prepara SMS con nombre y ciudad, email y lugar en la **fila de Marki**.
- **Con tu OK**, que se da en la pantalla de Rayo o por voz con Capi, o **Automático**.
- **Carrera con Anna:**
  - si Anna ya le escribió, **ganó Anna** y Rayo no lo toca;
  - si no, Rayo **la silencia antes de contactar**; si no puede silenciarla, no contacta;
  - después vigila **30 min** por si Anna agarra el lead tarde.
- **Todo pasa por el árbitro de la Fase B** (24 h entre todos, persona que escribió, bajas) y por la política de SMS (8 am–9 pm, solo California). De noche el lead queda **programado** y sale a las 8 am. El **turno del número** lo reparte el árbitro, junto con Texi y Resi.
- **Llaves:** usa las del **Llavero** (Fase A): la de la cuenta elegida y, para Anna, la principal.
- **Estado:** se guarda en `~/.navi/rayo.json` con permisos 600.

### "Rayo corre en" (pantalla de Rayo)
| Opción | Qué pasa |
|---|---|
| **Extensión** (como siempre) | Rayo trabaja en la extensión, solo con Brave y el Centro de Mando abiertos. El puente no hace nada de Rayo. |
| **Sombra** (prueba) | La extensión trabaja **como siempre**. El puente revisa **los mismos leads** y solo anota lo que **haría**: no manda, no silencia, no llena la fila de Marki y no anota en el Cerebro. La pantalla compara lead por lead y dice el **% de iguales**. |
| **Puente** | Rayo trabaja **en tu Mac, aunque Brave esté cerrado**. La pantalla de Rayo solo **muestra**, **aprueba o descarta** (con botón o con Capi) y le **manda la configuración**. |

**En modo Puente, lo que hace el puente también se ve en la extensión:**
- las tarjetas, para que Capi y el Mando funcionen igual;
- la **fila de Marki**;
- el **registro de SMS** (para Cumpli y Ana);
- **Anna silenciada** y los **contactos del Cerebro** (para el Marcador);
- la **bitácora** ("Rayo (puente): …").

**Al pasar a Puente:**
- pide confirmación;
- pide que **no queden leads pendientes** en la extensión;
- el puente **sigue desde el último lead que vio la extensión** (no vuelve a "descubrir" los mismos) y olvida las tarjetas de prueba de la sombra.

**Si el puente se apaga en modo Puente:**
- la pantalla y la bitácora avisan fuerte: "El puente está apagado: Rayo NO está trabajando…";
- **regresar a Extensión funciona aunque el puente no conteste**. Es la salida de emergencia.
- En ese caso, los leads que llegaron mientras el puente estaba caído hay que revisarlos a mano en Lofty. La pantalla lo dice.

### Puente
- **Endpoints nuevos:** `GET /rayo/estado`, `GET /rayo/registro`, `POST /rayo/modo`, `/rayo/aprobar`, `/rayo/descartar` y `/rayo/cola/tomar`. Todos con la clave, el CORS y el `Host` de siempre.
- **`NAVI_RELOJ_MS`:** variable **solo para pruebas**, para fijar la hora. Tú no la usas.

## 2. Cómo instalar
1. **Actualiza la extensión** a la rama `rayo-puente` y recárgala.
2. **Reinstala el puente:** `bash ~/Desktop/CENTRO-DE-MANDO-claude-peaceful-fermi-mfgt13/puente/instalar.sh`.
3. **Revisa las llaves:** en **Puente**, que estén en el Llavero la de **Texi** (la cuenta de Rayo) y la **principal** (para Anna).

## 3. Plan para cambiar (recomendado)
1. **Sombra, 1 o 2 días:** en Rayo, "Rayo corre en" → **Sombra**. Trabaja como siempre y mira la caja **"Comparación de la sombra"**:
   - lo ideal es **100% iguales**;
   - si salen "distintos", mándame una captura y lo reviso.
   - **Ojo:** en **Automático** los dos revisan casi al mismo tiempo y puede salir alguna diferencia por segundos, por ejemplo que Anna escriba entre una revisión y la otra. Con **Con mi OK**, el puente decide al instante y la extensión cuando apruebas: esa diferencia es normal.
2. **Puente:** cuando coincidan, cámbialo a **Puente**.
   - Prueba **cerrando Brave**: los leads nuevos de zBuyer tienen que salir igual.
   - **Con mi OK:** las aprobaciones esperan a que abras el Mando o se lo digas a Capi.
   - **Automático:** sale solo.
3. **Si algo sale mal:** "Rayo corre en" → **Extensión**. Un clic.

## 4. Cómo verificar
| # | Qué hacer | Qué debe pasar |
|---|---|---|
| 1 | Modo **Sombra** y espera un lead nuevo de zBuyer | La comparación suma 1 "igual" |
| 2 | Modo **Puente**, **cierra Brave**, espera un lead nuevo (en Automático) y abre Brave | El lead aparece como "hecho": SMS y email enviados, y Anna silenciada |
| 3 | Abre **Marki** | El lead está en la "Cola de Rayo" para llamarlo |
| 4 | Apaga el puente (`launchctl bootout gui/$(id -u)/com.christopher.navi`) con Rayo en modo Puente | Aviso fuerte en Rayo y en la bitácora. Cambia a **Extensión** y Rayo vuelve a trabajar ahí |

### Pruebas automáticas
- **`npm test`: 96 pasan.** Incluyen **55 del puente en Python**. Las 11 de Rayo cubren:
  - con mi OK;
  - automático;
  - Anna ya escribió;
  - una persona escribió;
  - bajas;
  - 24 h con un SMS de Texi;
  - de noche → programado y sale de día;
  - vigilancia de 30 min;
  - sin llave;
  - no poder silenciar a Anna;
  - sombra sin tocar nada.
  - En JavaScript se agrega la comparación de la sombra.
- **`npm run test:e2e`: 35 pasan.** La nueva `tests/e2e/rayo-puente.e2e.js` usa la extensión real, el puente real y un Lofty falso en Python:
  - **sombra:** la extensión contacta, el puente no toca nada y la comparación sale **100% iguales**;
  - **puente:** el puente encuentra el lead; se aprueba desde la pantalla; contacta (SMS, email y Anna silenciada); la extensión recibe la fila de Marki, el registro, Anna silenciada, el Cerebro y la bitácora; al final se regresa a Extensión.

## 5. Qué falta / avisos
- **Probar con tu cuenta real**, con el plan de la sección 3. Aquí todo se probó con un Lofty falso.
- **La Mac despierta:** el servicio "Mac despierta" cuida el horario de 8 am a 9 pm. **Con la tapa cerrada una laptop se duerme** y Rayo para.
- **Lo que no cambia:** Marki (llamadas), Texi y Resi siguen en la extensión. Resi y el Marcador son la siguiente ronda, si quieres.
