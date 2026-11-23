# Fase 0: Protección

En esta fase **no se cambia ninguna función de la extensión**. Solo se protege lo que ya existe antes de empezar la Fase 1 (estabilización).

## Estado

| Paso | Qué es | Estado |
|---|---|---|
| 0.1 | Etiqueta de línea base en git | ⚠️ Creada solo en la copia de trabajo; GitHub rechazó subir la etiqueta. La línea base es el commit `79493f0` (hoy es `main`). Para fijarla en GitHub: *Releases → Draft a new release → tag* `v1.60.0-baseline` *→ Target:* `main` |
| 0.2 | Huella SHA-256 de los 92 archivos de la línea base | ✅ `docs/auditoria/linea-base-sha256.txt` |
| 0.3 | Informe de auditoría guardado en el repo | ✅ `docs/auditoria/MISION-01-auditoria.md` |
| 0.4 | Evitar que un respaldo con llaves se suba a git por accidente | ✅ `.gitignore` → `respaldo-*.json` |
| 0.5 | **Recuperar `bv.html`** (Veri, Veri 2 y Veri 3) | ✅ Agregado desde la instalación local del propietario; tiene los 22 `id` que usa `bv.js` |
| 0.6 | **Respaldo de los datos guardados** (`chrome.storage`) | ⏳ **Lo tienes que hacer tú** (ver abajo) |
| 0.7 | Confirmar qué versión tienes instalada | ⏳ **Lo tienes que hacer tú** (ver abajo) |

Los pasos 0.5, 0.6 y 0.7 se hacen en tu Mac. Desde la nube no se puede entrar a tu Chrome ni a tu carpeta de la extensión.

---

## 0.5 Recuperar `bv.html`

`panel.html` y `mando.html` cargan `bv.html`, pero ese archivo **no está en el repositorio**. Sin él, Veri, Veri 2, Veri 3 y Acti no funcionan con este código.

1. Abre la carpeta de la extensión que tienes cargada en Chrome (en `chrome://extensions` → Agente Geo Farming → "Detalles" sale la ruta).
2. Busca `bv.html`:
   - **Si está:** súbelo al repo, en la raíz, junto a `bv.js`. Puede ser desde github.com → *Add file → Upload files* en la rama `claude/peaceful-fermi-mfgt13`, o pásamelo y lo subo yo.
   - **Si no está:** revisa la carpeta `respaldo-original/` (está en `.gitignore`, así que puede existir solo en tu Mac).
   - **Si no aparece en ningún lado:** hay que reconstruirlo a partir de los `id` que usa `bv.js` (`cycle`, `stop`, `next`, `sync`, `maxTabs`, `wait`, `startUrl`, `template`, `directo`, `humano`, `onlyZone`, `hideDone`, `status`, `count`, `done`, `list`…). Eso ya sería trabajo de la Fase 1 y necesita tu autorización.

## 0.6 Respaldo de los datos guardados (`chrome.storage`)

En `chrome.storage.local` viven los domicilios, los lotes, los casos HECM, los leads de zBuyer, las bajas de SMS (`rsNoEscribir`), los envíos de Texi (`txEnviados`), la configuración de cada robot **y las API keys**. El historial de Lofti vive aparte, en `localStorage` (`pw2l_hist`).

**Este archivo de respaldo contiene API keys y datos personales:**
- Guárdalo en un lugar seguro (por ejemplo, un disco cifrado).
- **No lo subas a GitHub.** El `.gitignore` ya ignora los `respaldo-*.json`.
- No lo compartas por chat ni por correo.

### Cómo hacerlo (solo lee, no cambia nada)

1. Abre el **Centro de Mando**, que es la página `mando.html` de la extensión.
2. Clic derecho → **Inspeccionar** → pestaña **Console**.
3. Pega esto y da Enter:

```js
(async () => {
  const storage = await chrome.storage.local.get(null);
  const local = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); local[k] = localStorage.getItem(k); }
  const respaldo = { creado: new Date().toISOString(), version: chrome.runtime.getManifest().version, storage, localStorage: local };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(respaldo, null, 2)], { type: "application/json" }));
  a.download = `respaldo-geo-farming-${respaldo.version}-${Date.now()}.json`;
  a.click();
  console.log("Respaldo listo:", Object.keys(storage).length, "claves de storage,", Object.keys(local).length, "de localStorage");
})();
```

4. Se descarga `respaldo-geo-farming-<versión>-<fecha>.json`. Muévelo a tu lugar seguro.

> **Si prefieres un respaldo sin llaves** (para poder compartirlo con quien te ayude a depurar), cambia la primera línea dentro de la función por esta:
> ```js
> const storage = await chrome.storage.local.get(null); for (const k of ["loftyKey", "txKey", "svKey", "elKey"]) delete storage[k]; if (storage.alCfg) delete storage.alCfg.apiKey; if (storage.radarCfg) delete storage.radarCfg.censusKey;
> ```
> Aun así ese archivo **sigue teniendo datos personales** (nombres, teléfonos y domicilios).

Lo que **no** queda en este respaldo: las capturas de Redi y Timi (IndexedDB `geo-farming-fotos`, se borran solas a los 45 días) y los archivos de Carpi en `Descargas/Carpi`.

### Cómo restaurar (solo si hiciera falta)

En la misma consola, cargando tu archivo:

```js
// ⚠️ Esto REEMPLAZA los datos actuales. Úsalo solo para volver atrás.
// 1) Copia el contenido del .json y pégalo así:  const r = { ...contenido del archivo... };
// 2) Luego:
await chrome.storage.local.clear(); await chrome.storage.local.set(r.storage);
for (const [k, v] of Object.entries(r.localStorage || {})) localStorage.setItem(k, v);
```

## 0.7 Confirmar la versión instalada

En `chrome://extensions` → Agente Geo Farming, revisa qué versión dice:
- **1.60.0:** coincide con el repo y con la auditoría.
- **Otra (por ejemplo, 1.47.0):** dime. Tu copia local no es la misma que el repo, y antes de cambiar código hay que subir la que de verdad usas.

---

## Dependencias críticas (no tocar sin pruebas)

| # | Componente | Por qué es crítico | Quién lo usa |
|---|---|---|---|
| 1 | `comun.js` | Reglas compartidas, cliente de Lofty, turnos de Propwire, ventanas, conteos | Casi todas las páginas y el background |
| 2 | `background.js` | **Único** que escribe en orden `addresses`, `zbLeads` y `svEventos` | Todos los robots |
| 3 | `chrome.storage.local` | Es el "bus" entre robots: unas 150 claves sin esquema ni versión | Todos |
| 4 | `lofty-core.js` | Limpieza, DNC, empresas y CSV antes de crear leads | Lofti, Wibi, Carpi |
| 5 | `sv.js` ↔ los `id` de cada HTML | Capi opera a los robots por `id` de botones y campos. Cambiar un `id` rompe a Capi sin aviso | Capi |
| 6 | `manifest.json` | Permisos y content scripts (Propwire, BeenVerified, Lofty) | Toda la extensión |
| 7 | `linea.js` + parámetro `?linea=` | Separa las claves de los clones (`_ac`, `_hr`) | Veri, Owny, Chequi 3, Wibi 3 |
| 8 | `bv.html` | **Falta.** Interfaz de Veri, Veri 2 y Veri 3 | Línea de leads nuevos, Acti, HECM |
| 9 | Sesiones web de terceros | Propwire, BeenVerified, Gmail, Teams, Properant, crm.lofty.com, registro de OC | Casi todos los robots de scraping |
| 10 | API keys en storage | `loftyKey`, `txKey`, `svKey`, `elKey`, `alCfg.apiKey`, `radarCfg.censusKey` | Lofty, Texi/Resi/Limpi, Capi, voz, Marki, Radar |

## Cómo volver a la línea base

```bash
git checkout 79493f0   # línea base (o v1.60.0-baseline si ya creaste la etiqueta)
```

Para verificar que ningún archivo de la línea base cambió:

```bash
sha256sum -c docs/auditoria/linea-base-sha256.txt
```

En la rama de trabajo, `.gitignore` sale como **FAILED**: es esperado, porque en la Fase 0 se le agregó `respaldo-*.json`. Los otros 91 archivos deben salir **OK**.

## Siguiente paso

Con 0.5, 0.6 y 0.7 completos, la Fase 1 empieza por el cambio más pequeño y de mayor impacto: que **Texi no envíe si falla la revisión de opt-out** (`tx.js:268`). Ese paso necesita tu autorización.
