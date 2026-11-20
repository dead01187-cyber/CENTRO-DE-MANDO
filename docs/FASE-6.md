# Fase 6: Pruebas y lanzamiento (v1.66.0)

## 1. Cómo se prueba ahora

| Nivel | Qué cubre | Cómo correrlo | Resultado |
|---|---|---|---|
| **Unitarias** | Política de SMS, lofty-core (DNC, litigators, CSV), escrituras de domicilios, bus de tareas, presupuesto, Vali, Cumpli, Qai, Punti, Ana, tablero y etapas | `npm test` | **57 pasan** |
| **Integración y regresión de punta a punta** | La extensión real en un Chromium aislado contra un **Lofty falso** y con **reloj fijo**. Nada sale a internet ni se manda ningún SMS real | `npm install` y luego `npm run test:e2e` | **9 pasan** |
| **Sintaxis** | Los 61 archivos `.js` | `for f in *.js; do node --check "$f"; done` | Sin errores |

**Importante:** corre `npm install` en **otra copia** del repo, no en la carpeta que tienes cargada en Chrome. Chrome no carga extensiones que traen `node_modules`. El `.gitignore` ya lo excluye.

### Escenarios de punta a punta (`tests/e2e/regresion.e2e.js`)

1. **Texi** con 4 leads. Solo le manda al que se puede; se saltan el opt-out de Lofty, la baja permanente y el número fuera de California. Queda en el registro.
2. **Texi falla cerrada:** si Lofty no contesta al revisar el opt-out, no manda, y el lead queda marcado "no pude revisar".
3. **Texi fuera de horario** (22:30 en California): no manda nada y queda el registro del bloqueo.
4. **Lofti:**
   - no sube nada solo;
   - al subir con tu OK, quita el número 800 (Vali) y el número DNC.
5. **Lofti sin bucle:** con subida automática y Lofty rechazando el lead, lo intenta **una sola vez** en 12 s. Antes eran cada ~2 s.
6. **Marki:** con SMS prendidos pide confirmación; al cancelar no manda ni mueve nada.
7. **Capi:** subir a Lofty pide tu confirmación en pantalla; si dices que no, no sube.
8. **Bus:** una tarea pedida con la página cerrada se hace sola al abrirla.
9. **Tablero:** pasar a la etapa 1 apaga a los que escriben, gastan o contactan, y deja a Capi.

### Pruebas automáticas en GitHub

`.github/workflows/pruebas.yml` corre en cada push y en cada pull request:
- la revisión de sintaxis;
- las pruebas unitarias;
- la regresión de punta a punta.

No usa llaves ni cuentas. Consume minutos de GitHub Actions de tu cuenta: si no los quieres gastar, bórralo o desactívalo en la pestaña *Actions*.

## 2. Ambiente de prueba (staging)

- **Listo, Lofty falso** (`tests/e2e/lofty-falso.js`). Simula `/leads`, `/leads/{id}`, `/members`, `/notes`, `/message/sms/send` y `/communication`. También puede simular fallas (500, 400, 401…).
- **Pendiente, cuenta de Lofty de prueba.** El último paso antes de usar datos reales es probar con una **cuenta de Lofty separada** (sandbox o una cuenta de prueba sin leads reales). Así se confirma que la API real contesta como el simulador.
  - Para hacerlo necesito que me digas si la tienes o la puedes crear.
  - Su API key **nunca** se pega en el chat: se pone dentro de la extensión, en una copia aparte de Chrome (otro perfil).

## 3. Lanzamiento gradual

En el **📊 Tablero** hay una sección nueva: **Lanzamiento gradual**. Cada robot pertenece a una etapa según sus permisos del registro:

| Etapa | Robots | Riesgo |
|---|---|---|
| **1. Solo lectura** | Radar, Termi, Propi, Chequi, Chequi 3, Owny 1–3, Wibi, Zeta, Vali, Punti, Cumpli, Qai, Ana | Ninguno en sistemas externos (solo lee) |
| **2. Escriben con tu control** | Carpi, Lofti, Acti, Limpi, Redi | Crean o cambian leads en Lofty, borradores en Gmail |
| **3. Gastan créditos** | Veri 1–3, Wibi 3, Prope, Heri | BeenVerified, skip trace, Properant |
| **4. Contacto** | Texi, Resi, Marki, Timi | SMS (con política y tu OK) y Teams |

Con **"Pasar a etapa N"**, y después de confirmar:
- se **prenden** los robots de etapa ≤ N;
- se **apagan** los de etapa > N;
- Capi siempre queda prendido.

Solo tú puedes hacerlo, con clic; Capi no.

### Plan sugerido

| Paso | Etapa | Duración mínima | Para avanzar |
|---|---|---|---|
| 1 | **Etapa 1** | 2–3 días | Qai sin fallas · Cumpli sin hallazgos graves · Vali y Punti marcan cosas que tienen sentido · nada raro en la bitácora |
| 2 | **Etapa 2** | 1 semana | Subir con Lofti **a mano**: primero "Solo 1 de prueba", luego lotes chicos. Revisar en Lofty que los leads quedaron bien, sin duplicados ni números falsos o DNC. Acti en 5–10 leads y revisar el respaldo (`acTrabajos[id].antes`). Limpi en modo "solo revisar" |
| 3 | **Etapa 3** | 1 semana | Veri y Wibi 3 con topes bajos. Revisar el gasto de créditos contra lo esperado. Wibi 3 en modo manual (`auto` apagado) |
| 4 | **Etapa 4** | continuo | Texi con **un solo número tuyo** primero, luego listas chicas (≤ 20) en horario. Cumpli cada día. Marki con SMS solo cuando lo anterior esté limpio |

**Para volver atrás:** "Pasar a etapa 1" en el tablero. Si algo sale muy mal, recarga la versión anterior desde git (`git checkout <versión>`) y restaura tu respaldo (`docs/FASE-0.md`).

## 4. Validación humana (llénala tú)

Marca cada robot cuando lo hayas visto funcionar **con tus datos reales**:

| Robot | Qué revisar | Etapa | ✔ / fecha |
|---|---|---|---|
| Qai | Sin fallas; las llaves están puestas | 1 | |
| Cumpli | Sin hallazgos graves en 30 días | 1 | |
| Vali | Lo que marca como "no sirve" de verdad no sirve | 1 | |
| Punti | El orden tiene sentido (los interesados arriba) | 1 | |
| Ana | Los números cuadran con lo que ves en Lofty | 1 | |
| Propi / Chequi | Junta domicilios de la zona; Chequi detecta los que ya están en Lofty | 1 | |
| Zeta | Encuentra los repetidos de zBuyer | 1 | |
| Lofti | "Solo 1 de prueba" crea bien el lead (nombre, teléfonos, tags, sin DNC) | 2 | |
| Acti | Actualiza sin perder teléfonos ni apellido | 2 | |
| Redi | El borrador sale bien y **no se envía solo** | 2 | |
| Limpi | En "solo revisar", la lista es correcta | 2 | |
| Veri / Owny | Lee el dueño actual (no "Previous Owner") y sus teléfonos | 3 | |
| Wibi 3 | Pide tu OK en cada cobro en dinero; respeta el tope | 3 | |
| Texi | A tu propio número: llega; fuera de 8–21 h no manda; un STOP bloquea | 4 | |
| Resi | Clasifica bien; no deja escribirle a una baja | 4 | |
| Marki | Pide confirmación; no manda a bajas ni DNC | 4 | |
| Capi | Pide confirmación para subir; los supervisores responden; el presupuesto se ve en el tablero | — | |

## 5. Pendiente

- Prueba con una **cuenta de Lofty de prueba** real (sección 2).
- **Revisión legal:**
  - flujo de herederos (HECM);
  - scraping de BeenVerified, Zillow, Redfin y Realtor;
  - consentimiento para SMS (TCPA).
- Lo que quedó de fases anteriores:
  - pasar al bus las acciones grandes (Propi, Veri, Owny, Acti, Heri, Lofti) y las misiones;
  - riesgos medios de `docs/FASE-1.md`.
