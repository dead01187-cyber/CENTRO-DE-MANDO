// =====================================================================
// Datos: respaldar, importar llaves y restaurar (v1.79.0)
// Botón "Datos" en la barra del Centro de Mando. Hace lo mismo que los
// comandos de consola de docs/FASE-0.md, pero con botones:
//   · Descargar respaldo: baja un .json con chrome.storage + localStorage.
//   · Importar llaves: de un respaldo toma SOLO las API keys (Lofty, Texi,
//     Claude, ElevenLabs, Marki, Census). No toca leads ni ajustes.
//   · Restaurar todo: REEMPLAZA los datos por los del respaldo. Antes de
//     tocar nada, baja automáticamente un respaldo de lo que hay ahora,
//     y pide confirmar escribiendo RESTAURAR.
// Los respaldos traen llaves y datos personales: no se suben a ningún lado.
// =====================================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const LLAVES = ["loftyKey", "txKey", "svKey", "elKey", "nvToken"];
  const NOMBRE_LLAVE = { loftyKey: "Lofty", txKey: "Lofty de Texi", svKey: "Claude", elKey: "ElevenLabs", nvToken: "Puente de Navi", alCfg: "Lofty de Marki", radarCfg: "Census" };

  async function armarRespaldo() {
    const storage = await chrome.storage.local.get(null);
    const local = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); local[k] = localStorage.getItem(k); }
    return { creado: new Date().toISOString(), version: chrome.runtime.getManifest().version, storage, localStorage: local };
  }
  function bajar(r, prefijo = "respaldo-geo-farming") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }));
    a.download = `${prefijo}-${r.version}-${r.creado.slice(0, 19).replace(/[:T]/g, "-")}.json`;
    ($("datosPanel") || document.body).appendChild(a); a.click(); a.remove(); // dentro del panel: así el clic no lo cierra
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function elegirArchivo() {
    return new Promise((ok) => {
      const i = document.createElement("input"); i.type = "file"; i.accept = ".json,application/json"; i.hidden = true;
      ($("datosPanel") || document.body).appendChild(i);
      i.onchange = async () => {
        try { const r = JSON.parse(await i.files[0].text()); ok(r); }
        catch (e) { aviso("Ese archivo no es un respaldo válido (" + e.message + ").", true); ok(null); }
        finally { i.remove(); }
      };
      i.click();
    });
  }
  // Acepta varias formas de respaldo: { storage: {...} } (el de este panel), el volcado directo de
  // chrome.storage ({ loftyKey, addresses, ... }) o los datos metidos en otra sección ({ data: {...} }, etc.)
  const CONOCIDAS = ["loftyKey", "txKey", "svKey", "elKey", "alCfg", "radarCfg", "addresses", "zbLeads", "txPlantillas", "smsBajas", "svEventos", "tareas", "loftyLeads", "mandoSonido", "tabActiva"];
  const esObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  const pareceStorage = (x) => esObj(x) && CONOCIDAS.some((k) => k in x);
  function datosDe(r) {
    if (!esObj(r)) return null;
    if (esObj(r.storage)) return r.storage;
    if (pareceStorage(r)) return r;
    for (const v of Object.values(r)) { if (pareceStorage(v)) return v; if (esObj(v)) for (const w of Object.values(v)) if (pareceStorage(w)) return w; }
    return null;
  }
  // Para el aviso: qué trae el archivo (solo nombres de secciones, nunca valores)
  const queTrae = (r) => esObj(r) ? Object.keys(r).slice(0, 12).join(", ") || "nada" : Array.isArray(r) ? `una lista de ${r.length}` : typeof r;
  const noReconocido = (r) => aviso(`No reconozco ese archivo como respaldo. Trae: ${queTrae(r)}. Mándale esa línea a quien te ayuda (no trae tus llaves).`, true);
  function aviso(t, malo) { const a = $("datosAviso"); a.textContent = t; a.classList.toggle("malo", !!malo); }

  // ---------- Acciones ----------
  async function descargar() {
    const r = await armarRespaldo();
    bajar(r);
    aviso(`Respaldo descargado (${Object.keys(r.storage).length} datos). Guárdalo en un lugar seguro: trae tus llaves.`);
  }

  // Solo las llaves; si el respaldo no las trae, no cambia nada
  async function importarLlaves(r) {
    const s = datosDe(r); if (!s) { noReconocido(r); return []; }
    const act = await chrome.storage.local.get(["alCfg", "radarCfg"]), poner = {}, hechas = [];
    for (const k of LLAVES) if (s[k]) { poner[k] = s[k]; hechas.push(NOMBRE_LLAVE[k]); }
    if (s.alCfg && s.alCfg.apiKey) { poner.alCfg = { ...(act.alCfg || {}), apiKey: s.alCfg.apiKey }; hechas.push(NOMBRE_LLAVE.alCfg); }
    if (s.radarCfg && s.radarCfg.censusKey) { poner.radarCfg = { ...(act.radarCfg || {}), censusKey: s.radarCfg.censusKey }; hechas.push(NOMBRE_LLAVE.radarCfg); }
    if (hechas.length) await chrome.storage.local.set(poner);
    aviso(hechas.length ? `Llaves importadas: ${hechas.join(", ")}. Recarga el Centro de Mando para que los agentes las tomen.` : "Ese respaldo no trae llaves.", !hechas.length);
    return hechas;
  }

  // Reemplaza todo. Antes baja un respaldo de lo actual (para poder regresar).
  async function restaurarTodo(r, confirmar = (t) => prompt(t)) {
    const s = datosDe(r); if (!s) { noReconocido(r); return false; }
    const cuando = r.creado ? new Date(r.creado).toLocaleString("es-MX") : "sin fecha";
    const resp = confirmar(`Vas a REEMPLAZAR todos los datos actuales por los del respaldo del ${cuando} (versión ${r.version || "?"}, ${Object.keys(s).length} datos).\n\nAntes bajo un respaldo de lo que tienes ahora.\n\nEscribe RESTAURAR para seguir:`);
    if (String(resp || "").trim().toUpperCase() !== "RESTAURAR") { aviso("No se restauró nada."); return false; }
    const actual = await armarRespaldo();
    bajar(actual, "antes-de-restaurar");
    await chrome.storage.local.clear();
    await chrome.storage.local.set(s);
    for (const [k, v] of Object.entries(r.localStorage || {})) localStorage.setItem(k, v);
    aviso("Listo: datos restaurados. Bajé \"antes-de-restaurar…json\" por si quieres regresar. Recargando…");
    setTimeout(() => location.reload(), 1500);
    return true;
  }

  // ---------- Panel ----------
  function armar() {
    const btn = $("b-datos"), pan = $("datosPanel"); if (!btn || !pan) return;
    const abrir = (si) => { pan.hidden = !si; btn.setAttribute("aria-expanded", String(si)); if (si) aviso(""); };
    btn.onclick = (e) => { e.stopPropagation(); abrir(pan.hidden); };
    document.addEventListener("click", (e) => { if (!pan.hidden && !pan.contains(e.target) && e.target !== btn) abrir(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pan.hidden) abrir(false); });
    $("datosBajar").onclick = descargar;
    $("datosLlaves").onclick = async () => { const r = await elegirArchivo(); if (r) importarLlaves(r); };
    $("datosRestaurar").onclick = async () => { const r = await elegirArchivo(); if (r) restaurarTodo(r); };
  }
  armar();
  window.Respaldo = { armarRespaldo, importarLlaves, restaurarTodo, datosDe }; // para pruebas
})();
