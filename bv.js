const $ = (id) => document.getElementById(id);
const DEFAULT_START = "https://www.beenverified.com/rf/dashboard";
const line = lineaDir; // norm, keyOf, zonasDe, enZona… vienen de comun.js
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setStatus = (t) => { $("status").textContent = t; window.svLog && svLog(t); };

let fromPropwire = [], enFiltro = 0;
let pwZone = "";
let state = { done: {}, manual: [], startUrl: DEFAULT_START, template: "", onlyZone: true, hideDone: false, current: "", directo: true, humano: true };

// Link directo al reporte de propiedad (así lo arma BeenVerified al escoger la sugerencia)
const linkDirecto = (a) => "https://www.beenverified.com/rf/report/property?address=" + encodeURIComponent(a.street) +
  "&city=" + encodeURIComponent(a.city) + "&state=CA" + (a.zip ? "&zipcode=" + a.zip : "") + "&report_flags=%5B%22include_ca_data%22%5D";

// ---------- Domicilios de la pestaña Propwire (mismo storage) ----------
async function sync() {
  const { addresses = {}, zone = "", chActivo, loftyKey, [K("chDestino")]: chDestino } = await chrome.storage.local.get(["addresses", "zone", "chActivo", "loftyKey", K("chDestino")]);
  const utiles = Object.entries(addresses).filter(([, a]) => sirve(a));
  // Solo llegan los que Chequi (filtro de Lofty) ya dejó pasar
  enFiltro = LINEA === "ac" ? 0 : utiles.filter(([, a]) => lineaDe(a) === LINEA && !a.lofty && !pasaFiltro(a, { chActivo, loftyKey })).length;
  fromPropwire = utiles
    .filter(([, a]) => lineaDe(a) === LINEA) // cada Veri solo su línea: normal, Acti (ac) o HECM (hr)
    .filter(([, a]) => LINEA === "ac" || !paraWibi(a, chDestino)) // los que Chequi mandó a Wibi no los busca Veri
    .filter(([, a]) => pasaFiltro(a, { chActivo, loftyKey }))
    .map(([key, a]) => ({ key, street: a.street, city: a.city, state: "CA", zip: a.zip, county: a.county || "", bvSearched: !!a.bvSearched,
      origen: a.origen || "", leadId: a.leadId || "" }));
  pwZone = zone;
  setTimeout(autoHecm, 0);
  const enZona = fromPropwire.filter(inZone).length;
  $("conn").textContent = fromPropwire.length
    ? `${enZona} domicilios aprobados por Chequi` + (enZona < fromPropwire.length ? ` (${fromPropwire.length - enZona} de otras zonas)` : "") + (enFiltro ? ` · ${enFiltro} esperando revisión de Lofty` : "")
    : enFiltro ? `Chequi está revisando ${enFiltro} domicilio(s) en Lofty…`
    : "Todavía no hay domicilios de Propwire. Búscalos en la pestaña Propwire o pégalos abajo.";
  render();
}

const zones = () => zonasDe(pwZone);
const inZone = (a) => a.origen === "lofty" || a.origen === "hecm" || !state.onlyZone || enZona(a, zones()); // los de Acti y Heri son de cualquier ciudad

function items() {
  const map = new Map();
  for (const a of [...fromPropwire.filter(inZone), ...state.manual]) {
    const k = a.key || keyOf(a);
    if (!map.has(k)) map.set(k, { ...a, key: k });
  }
  return [...map.values()]
    .map((a) => ({ ...a, isDone: a.origen === "lofty" ? !!a.bvSearched : !!state.done[a.key] || !!a.bvSearched }))
    .sort((a, b) => (a.city + a.street).localeCompare(b.city + b.street));
}

async function save() { await chrome.storage.local.set({ [K("bvState")]: state }); }

function render() {
  const zs = zones();
  $("zoneLbl").textContent = zs.length ? `Solo la zona actual de Propwire (${zs.join(", ")})` : "Solo la zona actual de Propwire";
  const list = items();
  const pending = list.filter((a) => !a.isDone);
  $("count").textContent = pending.length;
  const doneN = list.length - pending.length;
  $("done").textContent = doneN ? `${doneN} ya buscados` : "";
  const rows = state.hideDone ? pending : list;
  const ul = $("list");
  ul.innerHTML = "";
  if (!rows.length) { ul.innerHTML = '<li class="empty">No hay domicilios por buscar.</li>'; return; }
  for (const a of rows.slice(0, 1000)) {
    const li = document.createElement("li");
    if (a.isDone) li.classList.add("done");
    if (a.key === state.current) li.classList.add("current");
    li.innerHTML = `<div class="addr">${esc(a.street)} ${a.isDone ? '<span class="tag">✓ buscado</span>' : ""}<br><small>${esc(a.city)}, CA ${esc(a.zip)}</small></div>`;
    const b1 = document.createElement("button");
    b1.className = "mini"; b1.textContent = "Buscar";
    b1.onclick = () => searchOne(a);
    const b2 = document.createElement("button");
    b2.className = "mini"; b2.textContent = "Copiar";
    b2.onclick = async () => { await navigator.clipboard.writeText(line(a)); b2.textContent = "✓"; setTimeout(() => (b2.textContent = "Copiar"), 1200); };
    const b3 = document.createElement("button");
    b3.className = "mini"; b3.textContent = a.isDone ? "↺" : "✓";
    b3.title = a.isDone ? "Marcar como no buscado" : "Marcar como buscado";
    b3.onclick = () => markDone(a, !a.isDone);
    li.append(b1, b2, b3);
    ul.appendChild(li);
  }
}

async function markDone(a, value) {
  if (value) state.done[a.key] = true; else delete state.done[a.key];
  const pw = fromPropwire.find((x) => x.key === a.key);
  if (pw) {
    pw.bvSearched = value;
    await domicilios("marcar", { key: a.key, bvSearched: value });
  }
  await save();
  render();
}

// ---------- Pasar resultados a la pestaña Owners ----------
// Cada pestaña con resultado se anota en bvPendientes; Owners la lee con el fantasmita.
async function sendResult(tabId, a) {
  const { [K("bvPendientes")]: bvPendientes = [] } = await chrome.storage.local.get(K("bvPendientes"));
  const lista = bvPendientes.filter((p) => p.tabId !== tabId);
  lista.push({ tabId, key: a.key, address: line(a), at: Date.now(), ...(a.leadId ? { leadId: a.leadId } : {}) });
  await chrome.storage.local.set({ [K("bvPendientes")]: lista });
  return true;
}
const cycleDone = () => chrome.storage.local.set({ [K("bvCicloTermino")]: Date.now() });

// ---------- BeenVerified ----------
const isBV = (u) => /^https:\/\/([a-z0-9-]+\.)?beenverified\.com\//i.test(u || "");

async function waitLoaded(tabId) {
  for (let i = 0; i < 60; i++) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === "complete") return;
    await sleep(500);
  }
}

async function checkLogin(tabId) {
  const t = await chrome.tabs.get(tabId);
  if (/\/(login|sign_?in)/i.test(t.url || "")) {
    setStatus("BeenVerified pide iniciar sesión. Entra con tu cuenta en esa pestaña y vuelve a darle ▶.");
    throw new Error("login");
  }
}

async function bvTab() {
  // Cada Veri trabaja SOLO en su propia pestaña. Nunca toma una pestaña de la otra línea ni una que
  // esté esperando (o siendo leída por) un Owny: si no tiene la suya libre, abre una nueva.
  const LINEAS = ["", "ac", "hr"], k = (b, l) => (l ? b + "_" + l : b);
  const s = await chrome.storage.local.get([...LINEAS.flatMap((l) => [k("bvPendientes", l), k("bvTabActual", l)]), K("bvTabMio")]);
  const otras = LINEAS.filter((l) => l !== LINEA).map((l) => s[k("bvTabActual", l)]).filter(Boolean);
  const ocupadas = new Set(LINEAS.flatMap((l) => s[k("bvPendientes", l)] || []).map((p) => p.tabId).concat(otras));
  const mia = s[K("bvTabMio")];
  if (mia && !ocupadas.has(mia)) {
    const t = await chrome.tabs.get(mia).catch(() => null);
    if (t && isBV(t.url)) return t;
  }
  setStatus("Abriendo una pestaña de BeenVerified para mí…");
  const t = await chrome.tabs.create({ url: state.startUrl || DEFAULT_START, windowId: await ventanaTrabajo(), active: false });
  await chrome.storage.local.set({ [K("bvTabMio")]: t.id });
  await waitLoaded(t.id);
  await sleep(2000);
  await checkLogin(t.id);
  return t;
}

async function sendSearch(tab, address) {
  try { return await chrome.tabs.sendMessage(tab.id, { cmd: "search", address }); }
  catch (e) {
    const m = String(e && e.message || e);
    // La página cambió justo al darle Search: eso significa que sí buscó.
    if (/message channel closed|back\/forward cache|page.*unload/i.test(m)) return { ok: true };
    // La pestaña estaba abierta antes de instalar la extensión: inyectar y reintentar.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["bv-content.js"] });
    return await chrome.tabs.sendMessage(tab.id, { cmd: "search", address });
  }
}

// Busca un domicilio en una pestaña de BeenVerified ya abierta. Regresa true si lo lanzó.
async function searchInTab(tab, a) {
  const address = line(a);
  state.current = a.key;
  render();
  if (state.template && state.template.includes("{address}")) {
    await chrome.tabs.update(tab.id, { url: state.template.replace("{address}", encodeURIComponent(address)) });
    return true;
  }
  if (state.directo !== false && a.street && a.city) {
    setStatus(`Abriendo el reporte de ${address}…`);
    await chrome.tabs.update(tab.id, { url: linkDirecto(a) });
    return true;
  }
  let res = await sendSearch(tab, address).catch(() => null);
  if (!res || !res.ok) {
    setStatus("Regresando a la búsqueda de BeenVerified…");
    await chrome.tabs.update(tab.id, { url: state.startUrl || DEFAULT_START });
    await sleep(800);
    await waitLoaded(tab.id);
    await sleep(2000);
    res = await sendSearch(tab, address).catch(() => null);
  }
  if (!res || !res.ok) {
    await navigator.clipboard.writeText(address).catch(() => {});
    setStatus(`No pude escribir en BeenVerified. Te copié “${address}”: pégalo en la búsqueda de Property.`);
    return false;
  }
  return true;
}

// ---------- Captcha / verificación: no se resuelve solo; se le pide a Christopher ----------
async function hayVerificacion(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const t = ((document.body && document.body.innerText) || "").slice(0, 6000);
      const texto = /verify (that )?you(['’]re| are) (a )?human|are you a robot|i['’]?m not a robot|captcha|unusual (activity|traffic)|press (and|&) hold|security check|checking your browser|confirm you are human|access denied/i.test(t) ||
        /just a moment|attention required/i.test(document.title);
      const marco = [...document.querySelectorAll("iframe")].some((f) => /recaptcha|hcaptcha|challenges\.cloudflare|turnstile|arkoselabs|funcaptcha|px-captcha|captcha-delivery|datadome/i.test(f.src || ""));
      const caja = !!document.querySelector("#px-captcha, .g-recaptcha, .h-captcha, .cf-turnstile, #challenge-form, [data-sitekey]");
      return texto || marco || caja;
    } });
    return !!(r && r.result);
  } catch (e) { return false; }
}

// Pone la pestaña al frente, avisa (voz + robot en rojo) y espera a que la resuelvas. Regresa true si ya quedó.
async function esperarVerificacion(tabId) {
  if (!(await hayVerificacion(tabId))) return true;
  const t = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
  if (t) chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
  setStatus("BeenVerified pide verificación (captcha). Resuélvela en la pestaña que te puse al frente; yo sigo solo cuando termines.");
  const inicio = Date.now();
  let ultimoAviso = 0;
  while (!stopFlag && Date.now() - inicio < 15 * 60e3) {
    await sleep(3000);
    if (!(await hayVerificacion(tabId))) { setStatus("¡Gracias! La verificación quedó. Sigo con el ciclo."); await sleep(2500); return true; }
    const s = Math.round((Date.now() - inicio) / 1000);
    if (s - ultimoAviso >= 30) { ultimoAviso = s; setStatus(`Esperando que resuelvas la verificación de BeenVerified (${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")})…`); }
  }
  return false;
}

// ---------- Ritmo humano: esperas al azar y pausas para que no salten captchas ----------
let proximaPausa = 8 + Math.floor(Math.random() * 5);
async function pausaHumana(hechos) {
  if (state.humano === false || stopFlag) return;
  let ms = 2500 + Math.random() * 6000;
  if (hechos >= proximaPausa) {
    proximaPausa = hechos + 8 + Math.floor(Math.random() * 5);
    ms = 40000 + Math.random() * 50000;
    const fin = Date.now() + ms;
    while (!stopFlag && Date.now() < fin) {
      setStatus(`Tomando una pausa para no parecer robot (${Math.ceil((fin - Date.now()) / 1000)} s)…`);
      await sleep(Math.min(10000, fin - Date.now()));
    }
    return;
  }
  await sleep(ms);
}

// Espera a que BeenVerified termine de cargar el resultado de la búsqueda
// Espera a que BeenVerified termine de cargar el resultado. Ya no espera un tiempo fijo:
// en cuanto el reporte trae datos (o sale "Search Results", captcha o login) sigue. "Espera" = máximo.
async function waitResult(tabId, prevUrl) {
  let changed = false;
  for (let i = 0; i < 50 && !stopFlag; i++) {           // hasta ~25 s a que cambie y cargue la página
    await sleep(500);
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) return;
    if (t.url !== prevUrl) changed = true;
    if (changed && t.status === "complete") break;
  }
  const fin = Date.now() + Math.max(2, Number($("wait").value) || 6) * 1000;
  while (!stopFlag && Date.now() < fin) {
    if (await reporteListo(tabId)) { await sleep(400); return; }
    await sleep(400);
  }
}
async function reporteListo(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const t = (document.body && document.body.innerText) || "";
      return /Possible Residents/i.test(t) || /(^|\n)\s*Ownership\s*(\n|$)/i.test(t) || /we have found \d+ records?/i.test(t) ||
        /no results found|we couldn.?t find|0 records/i.test(t) ||
        /captcha|verify (that )?you(.re| are) (a )?human|unusual (activity|traffic)/i.test(t) || /\/(login|sign_?in)/i.test(location.pathname);
    } });
    return !!(r && r.result);
  } catch (e) { return false; }
}

async function searchOne(a) {
  try {
    const tab = await bvTab();
    const prevUrl = (await chrome.tabs.get(tab.id)).url;
    if (await searchInTab(tab, a)) {
      setStatus(`Buscando ${line(a)}…`);
      await markDone(a, true);
      await waitResult(tab.id, prevUrl);
      if (await hayVerificacion(tab.id)) {
        if (!(await esperarVerificacion(tab.id))) return;
        const p2 = (await chrome.tabs.get(tab.id)).url;
        await searchInTab(tab, a); await waitResult(tab.id, p2);
      }
      await sendResult(tab.id, a);
      setStatus(`Listo ${line(a)} · ya está en la pestaña Owners para leerlo.`);
    }
  } catch (e) {
    if (String(e && e.message) !== "login") setStatus("No pude usar la pestaña de BeenVerified. Recárgala e intenta otra vez.");
  }
}

// ---------- Ciclo: buscar → clonar pestaña → buscar el siguiente ----------
let stopFlag = false;
let running = false;

async function runCycle() {
  if (running) return;
  running = true; stopFlag = false;
  $("cycle").disabled = true;
  const max = Math.max(1, Number($("maxTabs").value) || 10);
  let done = 0;
  let sent = 0;
  try {
    let tab = await bvTab();
    const usar = (t) => chrome.storage.local.set({ [K("bvTabActual")]: t ? t.id : null, ...(t ? { [K("bvTabMio")]: t.id } : {}) });
    await usar(tab);
    while (!stopFlag && done < max) {
      const next = items().find((x) => !x.isDone);
      if (!next) { setStatus(`Listo: ya no hay domicilios pendientes (${done} buscados).`); break; }
      if (!tab) { tab = await bvTab(); await usar(tab); }

      await checkLogin(tab.id);
      if (!(await esperarVerificacion(tab.id))) { setStatus("La verificación no se resolvió. Cuando esté lista, dale ▶ para seguir."); break; }
      const prevUrl = (await chrome.tabs.get(tab.id)).url;
      setStatus(`(${done + 1}/${max}) Seleccionando Property y buscando ${line(next)}…`);
      const ok = await searchInTab(tab, next);
      await markDone(next, true);
      if (!ok) break;
      done++;

      await waitResult(tab.id, prevUrl);
      // ¿Salió captcha? Esperar a que lo resuelvas y volver a abrir el mismo domicilio
      if (await hayVerificacion(tab.id)) {
        if (!(await esperarVerificacion(tab.id))) { setStatus("La verificación no se resolvió. Cuando esté lista, dale ▶ para seguir."); break; }
        const p2 = (await chrome.tabs.get(tab.id)).url;
        await searchInTab(tab, next);
        await waitResult(tab.id, p2);
      }
      // Esta pestaña se queda con el resultado. Se le pasa a Owny DESPUÉS de clonarla,
      // porque Owny la lee en vivo y puede cerrarla.
      const conResultado = { tabId: tab.id, a: next };
      const pasar = async () => { if (await sendResult(conResultado.tabId, conResultado.a)) sent++; };
      if (stopFlag || done >= max) { await pasar(); break; }
      // Ya no hay pendientes por ahora: esta pestaña es de Owny; si llegan más domicilios se usa otra.
      if (!items().some((x) => !x.isDone)) { await pasar(); tab = null; continue; }

      await pausaHumana(done);
      if (stopFlag) { await pasar(); break; }
      // El resultado se queda en esta pestaña y se sigue en otra. Con link directo basta una pestaña en blanco:
      // clonarla (como antes) volvía a cargar el reporte y BeenVerified lo contaba como otra visita.
      const directo = !(state.template && state.template.includes("{address}")) && state.directo !== false;
      setStatus(directo ? "Abriendo otra pestaña para el siguiente domicilio…" : "Clonando la pestaña para el siguiente domicilio…");
      const clone = directo
        ? await chrome.tabs.create({ url: "about:blank", windowId: tab.windowId, index: tab.index + 1, active: false })
        : await chrome.tabs.duplicate(tab.id);
      await pasar();
      await sleep(600);
      await waitLoaded(clone.id);
      await sleep(800);
      tab = clone; await usar(tab);
    }
    if (stopFlag) setStatus(`Parado. Busqué ${done} domicilios.`);
    else if (done >= max) setStatus(`Listo: busqué ${done} domicilios (llegué al máximo de pestañas). Dale ▶ otra vez para seguir.`);
  } catch (e) {
    if (String(e && e.message) !== "login") setStatus("Se interrumpió el ciclo (¿cerraste la pestaña?). Dale ▶ para seguir.");
  }
  if (sent) {
    await cycleDone();
    setStatus(`${$("status").textContent} · Pasé ${sent} resultado(s) a la pestaña Owners.`);
  }
  running = false;
  $("cycle").disabled = false;
  chrome.storage.local.set({ [K("bvTabActual")]: null });
}

$("cycle").onclick = () => { paradoAMano = false; runCycle(); };
$("stop").onclick = () => { stopFlag = true; paradoAMano = true; setStatus("Parando después de esta búsqueda…"); };

// ---------- Veri 3 (línea HECM): arranca solo cuando Chequi 3 le pasa casos ----------
// (Veri de leads nuevos lo arranca Capi en sus misiones; a Veri 3 nadie le daba "Ciclo".)
let autoTimer = null, paradoAMano = false, pendAntes = 0;
function autoHecm() {
  if (LINEA !== "hr") return;
  const pend = items().filter((a) => !a.isDone).length;
  if (pend > pendAntes) paradoAMano = false; // llegaron casos nuevos: si lo habías parado, vuelve a arrancar
  pendAntes = pend;
  if (running || paradoAMano || !pend) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    if (running || paradoAMano || !items().some((a) => !a.isDone)) return;
    setStatus(`Chequi 3 me pasó ${items().filter((a) => !a.isDone).length} HECM: empiezo a buscar solo…`);
    const antes = items().filter((a) => !a.isDone).length;
    runCycle().finally(() => {
      const despues = items().filter((a) => !a.isDone).length;
      if (despues >= antes) { paradoAMano = true; pendAntes = despues; setStatus(`${$("status").textContent} · No avancé en esta vuelta (¿BeenVerified pide iniciar sesión?). Me detengo; dale “Ciclo” cuando esté listo.`); return; }
      setTimeout(autoHecm, 3000); // si quedaron más (tope de pestañas), sigue
    });
  }, 5000);
}
$("maxTabs").onchange = (e) => { state.maxTabs = Number(e.target.value) || 10; save(); };
$("wait").onchange = (e) => { state.wait = Number(e.target.value) || 6; save(); };

$("next").onclick = () => {
  const next = items().find((a) => !a.isDone);
  if (!next) { setStatus("Ya buscaste todos los domicilios de la lista."); return; }
  searchOne(next);
};
$("sync").onclick = () => sync().then(() => setStatus("Lista actualizada."));
$("onlyZone").onchange = (e) => { state.onlyZone = e.target.checked; save(); sync(); };
$("hideDone").onchange = (e) => { state.hideDone = e.target.checked; save(); render(); };
$("startUrl").onchange = (e) => { state.startUrl = e.target.value.trim() || DEFAULT_START; save(); };
$("template").onchange = (e) => { state.template = e.target.value.trim(); save(); };
$("directo").onchange = (e) => { state.directo = e.target.checked; save(); };
$("humano").onchange = (e) => { state.humano = e.target.checked; save(); };
$("resetDone").onclick = async () => {
  for (const a of items()) if (a.isDone) await markDone(a, false);
  setStatus("Todos quedaron como no buscados.");
};

// Domicilios pegados a mano: "123 Main St, Irvine, CA 92618" (uno por renglón)
$("addManual").onclick = async () => {
  const re = /^\s*(\d+[^,]+),\s*([^,]+),\s*CA,?\s*(\d{5})?/i;
  let n = 0;
  for (const l of $("manual").value.split("\n")) {
    const m = l.match(re);
    if (!m) continue;
    const a = { street: m[1].trim(), city: m[2].trim(), state: "CA", zip: m[3] || "", county: "", manual: true };
    a.key = keyOf(a);
    if (!state.manual.some((x) => x.key === a.key)) { state.manual.push(a); n++; }
  }
  $("manual").value = "";
  await save();
  render();
  setStatus(`Agregué ${n} domicilios.`);
};
$("clearManual").onclick = async () => { state.manual = []; await save(); render(); };

chrome.runtime.onMessage.addListener((m) => { if (m.type === "bvStatus") setStatus(m.text); });

(async () => {
  const g = await chrome.storage.local.get([K("bvState"), "bvState"]);
  const bvState = g[K("bvState")] || (LINEA && g.bvState ? { ...g.bvState, done: {}, manual: [], current: "" } : null); // el clon arranca con los ajustes de Veri
  if (bvState) state = { ...state, ...bvState };
  if (state.startUrl === "https://www.beenverified.com/") state.startUrl = DEFAULT_START;
  $("onlyZone").checked = state.onlyZone;
  $("hideDone").checked = state.hideDone;
  $("startUrl").value = state.startUrl;
  $("template").value = state.template;
  $("directo").checked = state.directo !== false;
  $("humano").checked = state.humano !== false;
  delete state.enLofty; delete state.revisarLofty; // eso ahora lo lleva Chequi
  if (state.maxTabs) $("maxTabs").value = state.maxTabs;
  if (state.wait) $("wait").value = state.wait;
  await sync();
  // va jalando lo nuevo que encuentre la pestaña Propwire
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && (ch.addresses || ch.zone || ch.chActivo || ch.loftyKey || ch.chDestino)) sync(); });
})();
