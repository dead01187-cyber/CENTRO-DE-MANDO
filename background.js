// Agente Geo Farming — background.
// Abre el panel al dar clic al ícono y es el ÚNICO que escribe la lista de domicilios
// ("addresses"), los leads de zBuyer ("zbLeads") y la bitácora ("svEventos"). Todo pasa por una sola fila, en orden.
importScripts("comun.js");

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

let fila = Promise.resolve();
const enFila = (fn) => (fila = fila.then(fn).catch(() => {}));

// ---------- Limpieza: domicilios ya trabajados hace más de 60 días se archivan ----------
// La lista "addresses" se reescribe completa en cada cambio; si crece sin fin, todo se vuelve lento.
// Se quitan solo los que ya se terminaron (buscados, ya en Lofty o con skip trace) y que llegaron hace más de 60 días.
async function podar() {
  const { addresses = {}, podaDia } = await chrome.storage.local.get(["addresses", "podaDia"]);
  const hoy = new Date().toLocaleDateString("en-CA");
  if (podaDia === hoy) return;
  const limite = Date.now() - 60 * 864e5;
  let quitados = 0;
  for (const [k, a] of Object.entries(addresses))
    if (a.found && a.found < limite && (a.bvSearched || a.lofty === "si" || a.skipTraced)) { delete addresses[k]; quitados++; }
  await chrome.storage.local.set(quitados ? { addresses, podaDia: hoy } : { podaDia: hoy });
  if (quitados) await anotar({ t: Date.now(), mod: "sv", nivel: "info", texto: `Limpieza: archivé ${quitados} domicilio(s) ya trabajados de hace más de 60 días (la lista va más rápida).` });
}
setTimeout(() => enFila(podar), 5000);

chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
  if (!msg) return;
  if (msg.type === "ping") { responder({ pong: true, version: chrome.runtime.getManifest().version }); return; }
  if (msg.type === "svLog" && msg.ev) { enFila(() => anotar(msg.ev)); return; }
  if (msg.type === "found") { // lo que ve Wibi en su pestaña de Propwire (dueños con más propiedades) no entra a la lista de Propi
    // Propi solo junta domicilios de la pestaña donde ÉL está buscando (y solo mientras trabaja, prendido).
    // Lo que ves tú en Propwire, o lo que abren Radar, Termi, Wibi o Heri, ya no entra a su lista.
    chrome.storage.local.get(["propiSesion", "robotsApagados"]).then(async ({ propiSesion, robotsApagados = {} }) => {
      const tabId = _sender.tab && _sender.tab.id;
      if (robotsApagados.pw || !propiSesion || tabId !== propiSesion.tab || Date.now() - propiSesion.t > 20 * 60000) return;
      await chrome.storage.local.set({ propiSesion: { ...propiSesion, t: Date.now() } }); // sigue trabajando: se extiende la sesión
      enFila(() => guardarEncontrados(msg.items || []));
    });
    return;
  }
  if (msg.type === "domicilios") { enFila(() => cambiar(msg).then(() => responder({ ok: true }))); return true; }
  if (msg.type === "zbLeads") { enFila(() => zbCambiar(msg).then(() => responder({ ok: true }))); return true; }
});

// ---------- Bitácora para Capi ----------
async function anotar(ev) {
  const { svEventos = [] } = await chrome.storage.local.get("svEventos");
  svEventos.push(ev);
  await chrome.storage.local.set({ svEventos: svEventos.slice(-150) });
}

// ---------- Domicilios que manda Propwire (sin duplicados, respetando el tope de Propi) ----------
async function guardarEncontrados(items) {
  const { addresses = {}, pwCupo = null } = await chrome.storage.local.get(["addresses", "pwCupo"]);
  let cambio = false, lleno = false;
  for (const a of items) {
    if (!a.street || !a.city) continue;
    const k = keyOf(a), prev = addresses[k];
    if (prev) {
      // Si alguna fuente dice que ya tiene skip trace, se queda marcado.
      if (a.skipTraced && !prev.skipTraced) { prev.skipTraced = true; cambio = true; }
      if (a.empresa && !prev.empresa) { prev.empresa = true; cambio = true; }
      continue;
    }
    // El tope cuenta TODO domicilio nuevo que sirve (CA y sin skip trace), sin importar la zona escrita:
    // así no se puede brincar si la zona del campo no coincide con lo que manda Propwire.
    if (pwCupo && sirve(a)) {
      if (pwCupo.restan <= 0) { lleno = true; continue; } // ya se llegó al tope: no entra
      pwCupo.restan--;
      if (pwCupo.restan <= 0) lleno = true;
    }
    addresses[k] = { ...a, skipTraced: !!a.skipTraced, found: Date.now() };
    cambio = true;
  }
  if (lleno && pwCupo && !pwCupo.avisado) {
    pwCupo.avisado = true;
    await anotar({ t: Date.now(), mod: "pw", nivel: "info", texto: `Listo: llegué al tope de ${pwCupo.tope} propiedades nuevas.` });
    const tabs = await chrome.tabs.query({ url: ["https://propwire.com/*", "https://*.propwire.com/*"] });
    for (const t of tabs) chrome.tabs.sendMessage(t.id, { cmd: "stop" }).catch(() => {});
  }
  await chrome.storage.local.set(cambio ? { addresses, ...(pwCupo ? { pwCupo } : {}) } : (pwCupo ? { pwCupo } : {}));
}

// ---------- Cambios que piden las pestañas ----------
async function cambiar(msg) {
  if (msg.accion === "borrar") return chrome.storage.local.set({ addresses: {}, pwCupo: null });
  if (msg.accion === "actualizar") {
    const { addresses = {} } = await chrome.storage.local.get("addresses");
    for (const a of msg.items || []) addresses[keyOf(a)] = paraActualizar(a, addresses[keyOf(a)]);
    return chrome.storage.local.set({ addresses });
  }
  if (msg.accion === "lofty") {
    const { addresses = {} } = await chrome.storage.local.get("addresses");
    for (const p of msg.pares || []) if (addresses[p.key]) { if (p.valor) addresses[p.key].lofty = p.valor; else delete addresses[p.key].lofty; if (p.via) addresses[p.key].via = p.via; }
    return chrome.storage.local.set({ addresses });
  }
  if (msg.accion === "hecm") { // domicilios que Heri encontró con HECM (pasan por Chequi → Veri → Owny → Lofti)
    const { addresses = {} } = await chrome.storage.local.get("addresses");
    for (const a of msg.items || []) {
      const k = keyOf(a), prev = addresses[k] || {};
      if (prev.bvSearched && prev.hecm) continue; // ya se buscó
      addresses[k] = { ...prev, street: a.street, city: a.city, zip: a.zip || prev.zip || "", state: "CA", county: prev.county || a.county || "",
        skipTraced: false, found: prev.found || Date.now(), origen: "hecm", hecm: a.hecm }; // Chequi 3 decide si va a Veri 3 o a Wibi 3
    }
    return chrome.storage.local.set({ addresses });
  }
  if (msg.accion === "hecmInfo") { // Heri corrigió los datos de una HECM que ya está en el brazo: se actualiza su ficha, no se vuelve a buscar
    const { addresses = {} } = await chrome.storage.local.get("addresses");
    for (const a of msg.items || []) { const k = keyOf(a); if (addresses[k] && addresses[k].origen === "hecm") addresses[k].hecm = { ...(addresses[k].hecm || {}), ...a.hecm }; }
    return chrome.storage.local.set({ addresses });
  }
  if (msg.accion === "hecmQuitar") { // Heri ahora solo acepta Celink / Compu-Link: se quitan las HECM de otro lender que aún no se buscan
    const { addresses = {} } = await chrome.storage.local.get("addresses");
    for (const [k, a] of Object.entries(addresses)) if (a.origen === "hecm" && !a.bvSearched && !/compu[\s-]*link|celink/i.test((a.hecm && a.hecm.lender) || "")) delete addresses[k];
    return chrome.storage.local.set({ addresses });
  }
  if (msg.accion === "marcar") {
    const { addresses = {} } = await chrome.storage.local.get("addresses");
    if (!addresses[msg.key]) return;
    addresses[msg.key].bvSearched = !!msg.bvSearched;
    return chrome.storage.local.set({ addresses });
  }
}

// ---------- Leads de zBuyer: Zeta, Redi y Timi escriben a la vez; aquí se mezclan en orden para que nadie pise al otro ----------
// msg.cambios = { idDelLead: { campo: valor, … } } · msg.crear = dar de alta el lead si no existe · accion "vaciar" = olvidar la lista
async function zbCambiar(msg) {
  if (msg.accion === "vaciar") return chrome.storage.local.set({ zbLeads: {}, zbVistos: [] });
  const { zbLeads = {} } = await chrome.storage.local.get("zbLeads");
  for (const [id, datos] of Object.entries(msg.cambios || {})) {
    if (!zbLeads[id] && !msg.crear) continue;
    zbLeads[id] = { ...(zbLeads[id] || {}), ...datos };
  }
  return chrome.storage.local.set({ zbLeads });
}


// ---------- Resi: envío programado ----------
// Resi guarda la hora en rsConfig.prog. A esa hora, si la pestaña de Resi no está abierta, la abre (en segundo plano);
// Resi revisa las respuestas y manda los borradores. Si ya está abierta, ella sola lo hace.
function proximaHoraResi(prog) {
  if (!prog || !prog.activo || !(prog.dias || []).length) return null;
  const [h, m] = String(prog.hora || "10:00").split(":").map(Number), ahora = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(ahora); d.setDate(d.getDate() + i); d.setHours(h, m || 0, 0, 0);
    if (d > ahora && prog.dias.includes(d.getDay())) return d.getTime();
  }
  return null;
}
async function programarResi() {
  if (!chrome.alarms) return;
  const { rsConfig = {} } = await chrome.storage.local.get("rsConfig");
  await chrome.alarms.clear("rsProg");
  const t = proximaHoraResi(rsConfig.prog);
  if (t) chrome.alarms.create("rsProg", { when: t + 30e3 });
}
if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener(async (al) => {
    if (al.name !== "rsProg") return;
    const url = chrome.runtime.getURL("rs.html");
    const abiertas = await chrome.tabs.query({ url });
    if (!abiertas.length) await chrome.tabs.create({ url, active: false });
    await anotar({ t: Date.now(), mod: "rs", nivel: "info", texto: "Resi: es la hora del envío programado de SMS." });
    programarResi();
  });
  chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.type === "rsProg") programarResi(); });
  chrome.runtime.onStartup.addListener(programarResi);
  setTimeout(programarResi, 3000);
}

// Si se cierra la pestaña de Propi, su sesión termina (ya no junta nada de Propwire)
chrome.tabs.onRemoved.addListener((tabId) => { chrome.storage.local.get("propiSesion").then(({ propiSesion }) => { if (propiSesion && propiSesion.tab === tabId) chrome.storage.local.set({ propiSesion: null }); }); });
