# Fase Anna 3: Marcador vs Anna (v1.88.0)

Una sección en el **Tablero** que compara a Anna (el AI Sales Agent de Lofty) contra tus robots, en los **últimos 7 o 30 días**. Rama: `fase-anna`.

## Qué mide

| Renglón | Cómo se calcula | Gana |
|---|---|---|
| Leads contactados | Leads cuyo primer contacto cae en la ventana | Más |
| Tiempo al primer contacto | Mediana de minutos desde que el lead entró a Lofty hasta el primer contacto (solo leads creados en la ventana) | Menos |
| % que contestó | Leads con al menos un SMS de respuesta después del primer contacto | Más |
| Pasaron a Warm / Hot | Leads que **hoy** están en la etapa caliente o tibia de Resi ("Hot" / "Warm") | Más |
| Citas | Leads con una cita creada después del primer contacto (`/v1.0/appts`) | Más |
| Bajas (STOP) | Leads que contestaron STOP, unsubscribe o similar después del primer contacto | Menos |

**Cada lead cuenta para quien lo contactó primero.**
- Anna: su primer SMS con `textType: "AI"`.
- Tus robots: su primer contacto en el Cerebro o en el registro de SMS.
- Lo que escribe una persona (por ejemplo, Daniel) no cuenta para ninguno.

## De dónde salen los datos

- **Qué leads entran:**
  - el pool de Anna;
  - los leads donde silenciamos a Anna;
  - los leads que tus robots contactaron en los últimos 30 días.
- **De cada lead se lee en Lofty:**
  - el lead (cuándo entró y su etapa);
  - su historial de SMS;
  - sus citas.
- Lee a ritmo seguro, con una **caché de 2 horas**. La primera vez tarda unos minutos con ~200–700 leads; después es rápido.
- **Solo lee:** no escribe nada en Lofty.

## Limitaciones

- "Warm/Hot" es la **etapa de hoy**, no el momento exacto en que cambió.
- Las **llamadas** de Anna (buzón de voz) no se cuentan como primer contacto; solo sus SMS. Tus robots sí cuentan llamadas (Marki) y emails (Rayo).
- El registro de tus robots empezó con la Fase 1. Lo de antes sale del registro de SMS.

## Archivos

- `marcador-core.js` (nuevo, puro y probado): quién llegó primero, métricas y ganador por renglón.
- `marcador.js` (nuevo): recolecta en Lofty y pinta la tabla.
- `tablero.html`: la sección "Marcador: tus robots vs Anna".
- **Pruebas:**
  - `tests/marcador.test.js`;
  - `tests/e2e/marcador.e2e.js`. El Lofty falso ahora trae citas.
