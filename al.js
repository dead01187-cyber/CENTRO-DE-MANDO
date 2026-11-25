// Agente Lofty — panel lateral. Aquí vive el ciclo que recorre los leads.
// SMS, pipeline y tags van por la API oficial de Lofty (api.lofty.com).
// Las llamadas se hacen dando clic en la página de Lofty (content.js),
// porque la API no permite marcar.

const API = "https://api.lofty.com";
const DEFAULTS = {
  apiKey: "",
  doCalls: false,
  autoSave: true,
  doSms: true,
  skipPrimary: true,
  smsMode: "first",
  caOnly: true,
  deleteNonCA: false, // Fase 1: borrar números de Lofty ya no viene prendido
  messages: [
    { on: true, text: "Hi, this is Mark w/RRE. Are you considering selling/buying residential or commercial property? We can review listing options, compare a cash offer, or holding." },
    { on: false, text: "" },
    { on: false, text: "" },
    { on: false, text: "" },
  ],
  targetStage: "Attempted Contact",
  answeredStage: "No Active Plans",
  removeTag: "Contact verified",
  filterStage: "Cold 12 Month +",
  filterTag: "Contact verified",
  esperaRayo: true, // Fase Anna 1: cola de Rayo primero y esperar leads nuevos
  filterTipo: "", // v1.84.0: "" = todos, "1" = solo Seller, "2" = solo Buyer (tipos de Lofty)
  maxCallMin: 30,
};

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const digits = (s) => (s || "").replace(/\D/g, "");
const fmt = (p) => {
  const d = digits(p).slice(-10);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : p;
};

let cfg = { ...DEFAULTS };
let running = false;
let stopRequested = false;
let answeredFlag = false;
let skipFlag = false;
let lofftyTabId = null;
let stats = { done: 0, sms: 0, calls: 0, answered: 0, errors: 0 };

// ---------- UI ----------
function log(msg) {
  try { const m = String(msg).trim(); if (m && !/^\s/.test(String(msg))) window.svLog && svLog("Marki: " + m); } catch (e) {}
  const t = new Date().toLocaleTimeString();
  const el = $("log");
  el.textContent += `[${t}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}
function setStatus(s) { $("status").textContent = s; }
function mascotSay(text, working) {
  $("mascotSay").textContent = text;
  $("mascot").classList.toggle("working", !!working);
  window.robot && robot.set(working ? "trabajando" : "idle", text);
}
function setCounts(extra = "") {
  try { const hoy = new Date().toLocaleDateString("en-CA"); chrome.storage.local.get("alResumen").then(({ alResumen = {} }) => chrome.storage.local.set({ alResumen: { ...stats, fecha: hoy, corriendo: running } })); } catch (e) {}
  $("counts").textContent =
    `Terminados: ${stats.done} · SMS: ${stats.sms} · Llamadas: ${stats.calls} · Contestaron: ${stats.answered} · Errores: ${stats.errors}` +
    (extra ? ` · ${extra}` : "");
}
// Domicilio del lead: la propiedad "Home" (o la primera) y si no, la dirección de contacto.
function leadAddress(lead) {
  // Ignora datos que claramente no son parte de un domicilio (correos o teléfonos mal capturados).
  const clean = (v) => {
    const t = v && v !== -1 ? String(v).trim() : "";
    if (!t || t.includes("@") || /^\+?\d[\d\s()-]{6,}$/.test(t)) return "";
    return t;
  };
  const join = (o) => {
    const street = clean(o.streetAddress);
    const city = clean(o.city);
    const st = clean(o.state);
    const zipRaw = clean(o.zipCode);
    const zip = /^\d{5}(-\d{4})?$/.test(zipRaw) ? zipRaw : ""; // solo códigos postales reales
    const line2 = [city, [st, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return [street, line2].filter(Boolean).join(", ");
  };
  const props = lead.leadPropertyList || [];
  const home = props.find((p) => (p.label || "").toLowerCase() === "home" && clean(p.streetAddress)) ||
    props.find((p) => clean(p.streetAddress));
  return (home && join(home)) || join(lead) || "";
}

function setCurrent(lead) {
  if (!lead) { $("current").innerHTML = ""; return; }
  const name = `${lead.firstName || ""} ${lead.lastName || ""}`.trim();
  $("current").innerHTML =
    `<div class="name"></div><div class="addr"></div><div class="precio"></div><div class="phones"></div>`;
  $("current").querySelector(".name").textContent = name;
  $("current").querySelector(".addr").textContent = (leadAddress(lead) || "Sin domicilio en Lofty");
  pintarTels(lead);
  pintarPrecio(lead);
}
// ----- Precio actual de la propiedad (Zillow) -----
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
function leerZillow(h) {
  const n = (re) => { const m = h.match(re); return m ? Number(m[1]) : 0; };
  return { zest: n(/\\?"zestimate\\?":(\d+)/), precio: n(/\\?"price\\?":(\d+)/), renta: n(/\\?"rentZestimate\\?":(\d+)/),
    estado: ((h.match(/\\?"homeStatus\\?":\\?"([A-Z_]+)/) || [])[1]) || "" };
}
async function zillowPorPestana(url) { // si Zillow no deja leer directo, se abre la página atrás, se lee y se cierra
  const t = await chrome.tabs.create({ url, active: false });
  try {
    for (let i = 0; i < 40; i++) { await sleep(500); const x = await chrome.tabs.get(t.id); if (x.status === "complete") break; }
    await sleep(800);
    const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => document.documentElement.innerHTML });
    return leerZillow((r && r.result) || "");
  } finally { chrome.tabs.remove(t.id).catch(() => {}); }
}
async function zillowDe(direccion) {
  const k = direccion.toLowerCase().replace(/\s+/g, " ").trim();
  const { alZillow = {} } = await chrome.storage.local.get("alZillow");
  if (alZillow[k] && Date.now() - alZillow[k].t < 7 * 864e5) return alZillow[k];
  const sug = await fetch("https://www.zillowstatic.com/autocomplete/v3/suggestions?q=" + encodeURIComponent(direccion)).then((r) => r.json());
  const hit = (sug.results || []).find((x) => x.metaData && x.metaData.zpid);
  if (!hit) return { t: Date.now(), noEncontrada: true };
  const url = `https://www.zillow.com/homedetails/${hit.metaData.zpid}_zpid/`;
  let d = { zest: 0 };
  try { const h = await fetch(url, { credentials: "include" }).then((r) => (r.ok ? r.text() : "")); d = leerZillow(h); } catch (e) {}
  if (!d.zest && !d.precio) { try { d = await zillowPorPestana(url); } catch (e) {} }
  const res = { ...d, url, zpid: hit.metaData.zpid, t: Date.now() };
  if (res.zest || res.precio) { alZillow[k] = res; const ks = Object.keys(alZillow); if (ks.length > 500) delete alZillow[ks[0]]; chrome.storage.local.set({ alZillow }); }
  return res;
}
async function pintarPrecio(lead) {
  const box = $("current").querySelector(".precio"); if (!box) return;
  const dir = leadAddress(lead);
  if (!dir) { box.textContent = ""; return; }
  box.textContent = "Buscando el precio en Zillow…";
  let z; try { z = await zillowDe(dir); } catch (e) { z = { error: e.message }; }
  if (actual !== lead && actual && actual.leadId !== lead.leadId) return; // ya cambió de lead
  box.innerHTML = "";
  if (!z || z.error || z.noEncontrada || (!z.zest && !z.precio)) { box.textContent = z && z.noEncontrada ? "Zillow no encontró esta dirección" : "No pude leer el precio en Zillow"; box.classList.add("sin"); return; }
  box.classList.remove("sin");
  const venta = /FOR_SALE|PENDING/.test(z.estado) && z.precio ? ` · En venta: ${money(z.precio)}` : "";
  const a = document.createElement("a"); a.href = z.url; a.target = "_blank"; a.title = "Ver en Zillow";
  a.textContent = `${money(z.zest || z.precio)}`;
  const s2 = document.createElement("span"); s2.className = "fuente"; s2.textContent = `Zestimate${venta}${z.renta ? ` · Renta ${money(z.renta)}/mes` : ""} · Zillow`;
  box.append(a, s2);
}
// ----- Borrar un número malo del lead (en Lofty) -----
let actual = null;            // lead que se ve en pantalla
const borrados = new Set();   // números (10 dígitos) borrados del lead actual: ya no se marcan ni se les manda SMS
const d10 = (p) => digits(p).slice(-10);
function pintarTels(lead) {
  actual = lead;
  const box = $("current").querySelector(".phones"); if (!box) return;
  box.innerHTML = "";
  for (const p of lead.phones || []) {
    const quitado = borrados.has(d10(p));
    const t = document.createElement("span"); t.className = "tel" + (quitado ? " quitado" : "");
    t.textContent = fmt(p);
    if (!quitado) {
      const b = document.createElement("button"); b.type = "button"; b.className = "borrarTel"; b.title = "Borrar este número del lead en Lofty"; b.textContent = "Borrar";
      b.onclick = () => borrarTel(p);
      t.appendChild(b);
    } else t.title = "Borrado del lead";
    box.appendChild(t);
  }
}
async function borrarTel(p) {
  const lead = actual; if (!lead || !lead.leadId) return;
  const name = `${lead.firstName || ""} ${lead.lastName || ""}`.trim();
  if (!confirm(`¿Borrar el número ${fmt(p)} de ${name} en Lofty?\n\nYa no se le va a marcar ni mandar SMS a ese número.`)) return;
  try {
    const fresh = await api(`/v1.0/leads/${lead.leadId}`);
    const l = (fresh && (fresh.lead || fresh)) || {};
    const antes = l.phones || [];
    const keep = antes.filter((x) => d10(x) !== d10(p));
    if (keep.length !== antes.length) await api(`/v1.0/leads/${lead.leadId}`, { method: "PUT", body: JSON.stringify({ phones: keep }) });
    const ver = await api(`/v1.0/leads/${lead.leadId}`);
    const sigue = (((ver && (ver.lead || ver)) || {}).phones || []).some((x) => d10(x) === d10(p));
    if (sigue) throw new Error("Lofty no lo quitó");
    borrados.add(d10(p));
    log(`  Borré ${fmt(p)} de ${name} (número malo).`);
    pintarTels(lead);
  } catch (e) { stats.errors++; setCounts(); log(`  No pude borrar ${fmt(p)}: ${e.message}`); alert("No pude borrar el número: " + e.message); }
}
function setRunningUI(on) {
  mascotSay(on ? "Trabajando en tus leads…" : "¡Listo para trabajar!", on);
  $("start").disabled = on;
  $("stop").disabled = !on;
  $("answered").disabled = !on;
  $("skip").disabled = !on;
}

const FIELDS = ["apiKey", "smsMode", "targetStage", "answeredStage", "removeTag", "filterStage", "filterTag", "filterTipo", "maxCallMin"];
const CHECKS = ["doCalls", "autoSave", "caOnly", "deleteNonCA", "doSms", "skipPrimary", "esperaRayo"];

const N_MSGS = 1; // solo SMS 1
function renderMsgs() {
  const box = $("msgs");
  box.innerHTML = "";
  for (let i = 0; i < N_MSGS; i++) {
    const m = cfg.messages[i] || { on: false, text: "" };
    const d = document.createElement("div");
    d.className = "msg";
    d.innerHTML =
      `<div class="msg-head"><label><input type="checkbox" id="msgOn${i}"${N_MSGS === 1 ? ' style="display:none"' : ""}> SMS ${i + 1}</label>` +
      `<span class="muted" id="msgLen${i}"></span></div>` +
      `<textarea id="msgText${i}" placeholder="Escribe el SMS ${i + 1}"></textarea>`;
    box.appendChild(d);
    $(`msgOn${i}`).checked = !!m.on;
    $(`msgText${i}`).value = m.text || "";
    const upd = () => {
      const n = $(`msgText${i}`).value.length;
      $(`msgLen${i}`).textContent = `${n} caracteres`;
      $(`msgLen${i}`).className = n > 160 ? "muted over" : "muted";
    };
    $(`msgText${i}`).addEventListener("input", upd);
    upd();
  }
}

async function loadCfg() {
  const stored = await chrome.storage.local.get("alCfg");
  cfg = { ...DEFAULTS, ...(stored.alCfg || {}) };
  // Compatibilidad con la versión anterior (un solo mensaje).
  if (stored.alCfg && stored.alCfg.message && !stored.alCfg.messages) {
    cfg.messages = [{ on: true, text: stored.alCfg.message }, ...DEFAULTS.messages.slice(1)];
  }
  // Fase 1 (una sola vez): apagar "Borrar del lead los números que no son de California"; si lo quieres, vuelve a prenderlo a mano
  if (stored.alCfg && !stored.alCfg.fase1) { cfg.deleteNonCA = false; cfg.fase1 = true; await chrome.storage.local.set({ alCfg: cfg }); }
  cfg.fase1 = true;
  FIELDS.forEach((f) => ($(f).value = cfg[f]));
  CHECKS.forEach((f) => ($(f).checked = !!cfg[f]));
  renderMsgs();
}
async function saveCfg() {
  FIELDS.forEach((f) => (cfg[f] = $(f).value.trim()));
  CHECKS.forEach((f) => (cfg[f] = $(f).checked));
  const prev = cfg.messages || [];
  cfg.messages = [];
  for (let i = 0; i < N_MSGS; i++) {
    cfg.messages.push({ on: $(`msgOn${i}`).checked, text: $(`msgText${i}`).value.trim() });
  }
  cfg.messages[0].on = true; // SMS 1 siempre activo
  cfg.smsMode = "first";
  delete cfg.message;
  cfg.maxCallMin = Number(cfg.maxCallMin) || 30;
  await chrome.storage.local.set({ alCfg: cfg });
}

// ---------- API de Lofty ----------
async function api(path, opts = {}) {
  if (!cfg.apiKey) throw new Error("Falta la API key.");
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Authorization: "token " + cfg.apiKey,
      "Content-Type": "application/json",
      "X-Error-Status": "true",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const m = (data && (data.message || data.msg)) || text || res.statusText;
    throw new Error(`API ${res.status}: ${String(m).slice(0, 200)}`);
  }
  return data;
}

const hasTag = (lead, tag) =>
  (lead.tags || []).some((t) => (t.tagName || t).toLowerCase() === tag.toLowerCase());

// ---------- Cola de Rayo (Fase Anna 1) ----------
// Rayo deja aquí los leads nuevos que ganó (alCola = [{ leadId, t, nombre }]). Marki los atiende antes que su filtro.
async function siguienteDeCola(seen) {
  if (!cfg.esperaRayo) return null;
  if (!SMS.enHorario(await SMS.config())) return null; // nada de llamar de noche: la cola espera a las 8 am (hora de California)
  const { alCola = [] } = await chrome.storage.local.get("alCola");
  const item = alCola.find((x) => !seen.has(String(x.leadId)));
  if (!item) return null;
  await chrome.storage.local.set({ alCola: alCola.filter((x) => String(x.leadId) !== String(item.leadId)) });
  try {
    const d = await api(`/v1.0/leads/${encodeURIComponent(item.leadId)}`);
    const l = (d && (d.lead || d.data || d)) || null;
    if (!l || !l.leadId) { log(`  Cola de Rayo: no encontré el lead ${item.leadId}.`); return null; }
    log(`Cola de Rayo: ${`${l.firstName || ""} ${l.lastName || ""}`.trim() || item.leadId} (lead nuevo).`);
    return { ...l, deRayo: true };
  } catch (e) { log(`  Cola de Rayo: no pude leer el lead ${item.leadId} (${e.message}); lo dejo en la cola.`); const { alCola: c = [] } = await chrome.storage.local.get("alCola"); await chrome.storage.local.set({ alCola: [item, ...c] }); return null; }
}
async function pintarCola() { const { alCola = [] } = await chrome.storage.local.get("alCola"); const t = $("colaTxt"); if (t) t.textContent = alCola.length ? `Cola de Rayo: ${alCola.length} lead(s) esperando` : ""; }
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.alCola) pintarCola(); });
pintarCola();

// Tipo de lead en Lofty (developer.lofty.com): Seller = 1, Buyer = 2. Un lead "Buyer y Seller" entra en los dos.
const TIPO_NOMBRE = { "": "", "1": "Seller", "2": "Buyer" };
function esDelTipo(l) {
  if (!cfg.filterTipo) return true;
  const quiero = Number(cfg.filterTipo), re = quiero === 2 ? /buyer/i : /seller/i;
  const tipos = [].concat(l.leadTypes || [], l.leadType != null ? l.leadType : []);
  return tipos.some((t) => Number(t) === quiero || re.test(String(t)));
}
const pasaFiltro = (l) =>
  (!cfg.filterStage || (l.stage || "").toLowerCase() === cfg.filterStage.toLowerCase()) &&
  (!cfg.filterTag || hasTag(l, cfg.filterTag)) && esDelTipo(l);

// Trae leads que cumplen el filtro. Con tipo de lead, pasa página por página (los de otro tipo se quedan en el
// filtro de etapa/tag y llenarían la primera página); se detiene en cuanto junta `limit` o al revisar 3000.
async function fetchMatchingLeads(limit = 50, seen = null) {
  const out = []; let total = 0, revisados = 0;
  for (let offset = 0; out.length < limit && revisados < (cfg.filterTipo ? 3000 : 100); ) {
    const q = new URLSearchParams({ limit: "100", offset: String(offset) });
    if (cfg.filterStage) q.set("stage", cfg.filterStage);
    if (cfg.filterTag) q.set("allTags", cfg.filterTag);
    const data = await api("/v1.0/leads?" + q.toString());
    const leads = (data && data.leads) || [];
    if (offset === 0) total = data && data._metadata ? data._metadata.total : leads.length;
    revisados += leads.length;
    for (const l of leads) if (pasaFiltro(l) && !(seen && seen.has(String(l.leadId)))) out.push(l); // doble filtro por si la API ignora algún parámetro
    if (leads.length < 100) break;
    offset += leads.length;
  }
  return { leads: out.slice(0, limit), total, tipo: TIPO_NOMBRE[cfg.filterTipo || ""] };
}

function isToday(timeStr) {
  if (!timeStr) return false;
  const d = new Date(String(timeStr).replace("GMT", "Z"));
  if (isNaN(d)) return false;
  return d.toDateString() === new Date().toDateString();
}

// ¿El lead ya recibió hoy este mismo mensaje? (la API no dice a qué número)
async function sameMessageSentToday(leadId) {
  try {
    const data = await api(`/v1.0/communication/text?leadId=${leadId}&limit=1000`);
    const texts = (data && data.texts) || [];
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    return texts.some(
      (t) =>
        t.direction === "Outbound" &&
        isToday(t.textTime) &&
        activeMessages().some((m) => norm(t.textContent).startsWith(norm(m.text).slice(0, 60)))
    );
  } catch (e) {
    log("  No pude leer el historial de SMS: " + e.message);
    return null; // Fase 1 · falla cerrada: sin historial no se sabe si ya lo recibió, así que no se le manda
  }
}

// Registro local para nunca mandar dos veces al mismo número el mismo día.
async function alreadySentLocally(leadId, phone) {
  const key = `alSent:${new Date().toDateString()}:${leadId}:${digits(phone)}`;
  const s = await chrome.storage.local.get(key);
  return !!s[key];
}
async function markSentLocally(leadId, phone) {
  const key = `alSent:${new Date().toDateString()}:${leadId}:${digits(phone)}`;
  await chrome.storage.local.set({ [key]: Date.now() });
}

// ----- Alternar SMS -----
function activeMessages() {
  return (cfg.messages || []).map((m, i) => ({ ...m, n: i + 1 })).filter((m) => m.on && m.text);
}
let rotIndex = 0; // se guarda para seguir la rotación entre sesiones
async function loadRot() { const s = await chrome.storage.local.get("alRot"); rotIndex = s.alRot || 0; }
async function nextRot() { const v = rotIndex++; await chrome.storage.local.set({ alRot: rotIndex }); return v; }

// Elige el mensaje para este lead/número según el modo.
function pickMessage(leadSlot, phoneIdx) {
  const msgs = activeMessages();
  if (!msgs.length) return null;
  switch (cfg.smsMode) {
    case "phone": return msgs[(leadSlot + phoneIdx) % msgs.length];
    case "random": return msgs[Math.floor(Math.random() * msgs.length)];
    case "first": return msgs[0];
    default: return msgs[leadSlot % msgs.length]; // "lead"
  }
}

async function sendSms(leadId, phone, text) {
  const d = digits(phone);
  const body = {
    leadId: Number(leadId),
    content: text,
    phoneNumber: d.slice(-10),
    phoneCode: d.length > 10 ? d.slice(0, d.length - 10) : "1",
  };
  return api("/v1.0/message/sms/send", { method: "POST", body: JSON.stringify(body) });
}

async function updateLead(lead, stage) {
  const body = {};
  if (stage) body.stage = stage;
  if (cfg.removeTag) body.tagsRemove = [cfg.removeTag];
  await api(`/v1.0/leads/${lead.leadId}`, { method: "PUT", body: JSON.stringify(body) });

  // Verificar; si el tag sigue, mandar la lista completa de tags sin ese tag.
  if (cfg.removeTag) {
    const fresh = await api(`/v1.0/leads/${lead.leadId}`);
    const l = (fresh && (fresh.lead || fresh)) || {};
    if (hasTag(l, cfg.removeTag)) {
      const keep = (l.tags || [])
        .map((t) => t.tagName || t)
        .filter((n) => n.toLowerCase() !== cfg.removeTag.toLowerCase());
      await api(`/v1.0/leads/${lead.leadId}`, { method: "PUT", body: JSON.stringify({ tags: keep }) });
    }
  }
}

// ---------- Llamadas (pestaña de Lofty) ----------
async function getLoftyTab() {
  if (lofftyTabId) {
    try { await chrome.tabs.get(lofftyTabId); return lofftyTabId; } catch { lofftyTabId = null; }
  }
  const tabs = await chrome.tabs.query({ url: "https://crm.lofty.com/*" });
  if (tabs.length) { lofftyTabId = tabs[0].id; return lofftyTabId; }
  const t = await chrome.tabs.create({ url: "https://crm.lofty.com/admin/home/home/my", active: true });
  lofftyTabId = t.id;
  return lofftyTabId;
}

function waitTabLoaded(tabId) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(fn); resolve(); };
    const fn = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    chrome.tabs.onUpdated.addListener(fn);
    setTimeout(done, 20000);
  });
}

async function openLeadPage(leadId) {
  const tabId = await getLoftyTab();
  // No salir de la página con una llamada sin Save.
  try { await chrome.tabs.sendMessage(tabId, { type: "flush" }); } catch {}
  await chrome.tabs.update(tabId, { url: `https://crm.lofty.com/admin/home/detail?leadId=${leadId}&type=all`, active: true });
  await waitTabLoaded(tabId);
  await sleep(2500);
  try { await chrome.tabs.sendMessage(tabId, { type: "autosave", on: true }); } catch {}
  return tabId;
}

async function callOnPage(tabId, phone) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: "call",
      phone,
      maxCallMs: (Number(cfg.maxCallMin) || 30) * 60 * 1000,
    });
  } catch (e) {
    return { ok: false, error: "No pude hablar con la página de Lofty (recárgala): " + e.message };
  }
}

// ---------- Números de California ----------
const CA_AREA_CODES = new Set([
  "209","213","279","310","323","341","350","369","408","415","424","442","510","530",
  "559","562","619","626","628","650","657","661","669","707","714","747","760","805",
  "818","820","831","840","858","909","916","925","949","951",
]);
const isCA = (p) => CA_AREA_CODES.has(digits(p).slice(-10).slice(0, 3));

// Deja en el lead solo sus números de California.
async function removeNonCaPhones(lead, keep, drop) {
  await api(`/v1.0/leads/${lead.leadId}`, { method: "PUT", body: JSON.stringify({ phones: keep }) });
  const fresh = await api(`/v1.0/leads/${lead.leadId}`);
  const l = (fresh && (fresh.lead || fresh)) || {};
  const still = (l.phones || []).filter((p) => !isCA(p));
  if (still.length) throw new Error("Lofty no quitó: " + still.map(fmt).join(", "));
  log(`  Borrados (no son de CA): ${drop.map(fmt).join(", ")}`);
}

// ---------- Fase 1: bajas y DNC por número ----------
// phoneStatuses (mismo orden que phones): 4 = DNC Number, 5 = DNC Contact · phoneConsentStates: Do Not Text / Unsubscribed
function numerosOptOutAl(l) {
  const fuera = new Set(), phones = [].concat(l.phones || []), est = [].concat(l.phoneConsentStates || []), st = [].concat(l.phoneStatuses || []).map(Number);
  const val = (s) => String(s && typeof s === "object" ? s.state || s.name || s.value || "" : s || "");
  phones.forEach((p, i) => { if (/unsubscrib|do not (text|call)|opt.?out|dnc/i.test(val(est[i])) || st[i] === 4 || st[i] === 5) fuera.add(d10(p && typeof p === "object" ? p.phone || p.number || p.value : p)); });
  return fuera;
}
// ¿Marki usa la misma cuenta de Lofty que Texi/Resi? (así comparten las bajas por lead; las bajas por número aplican siempre)
async function cuentaSms() { const { txKey } = await chrome.storage.local.get("txKey"); return txKey && txKey === cfg.apiKey ? "tx" : "al"; }

// ---------- Ciclo principal ----------
async function processLead(lead) {
  const name = `${lead.firstName || ""} ${lead.lastName || ""}`.trim();
  const allPhones = (lead.phones || []).filter((p) => digits(p).length >= 10);
  const caPhones = allPhones.filter(isCA);
  const nonCa = allPhones.filter((p) => !isCA(p));
  const phones = cfg.caOnly ? caPhones : allPhones;
  answeredFlag = false;
  skipFlag = false;
  borrados.clear();
  setCurrent({ ...lead, phones });
  log(`▶ ${name} (${phones.length} números${nonCa.length ? `, ${nonCa.length} fuera de CA` : ""})`);
  const addr = leadAddress(lead);
  if (addr) log(`  ${addr}`);

  if (cfg.caOnly && !caPhones.length) {
    log("  ↷ No tiene números de California. Se deja sin cambios para que lo revises.");
    return "skipped";
  }
  if (cfg.deleteNonCA && nonCa.length) {
    try { await removeNonCaPhones(lead, caPhones, nonCa); }
    catch (e) { stats.errors++; log("  No pude borrar números fuera de CA: " + e.message); }
  }

  // Fase Anna 1: el Cerebro. Si una persona le escribió en 24 h o lo trabaja Anna, Marki no lo toca (falla cerrada).
  if (window.Cerebro) {
    const cb = await Cerebro.puedo({ leadId: lead.leadId, canal: "llamada", robot: "Marki", clave: cfg.apiKey, respetaAnna: !lead.deRayo });
    if (!cb.ok) { log(`  ↷ Cerebro: ${cb.motivo}. Lo salto.`); return "skipped"; }
  }
  // 1) Llamadas
  if (cfg.doCalls && lead.cannotCall) {
    log("  Lofty tiene este lead marcado como 'no llamar'. No se marca.");
  }
  if (cfg.doCalls && phones.length && !lead.cannotCall) {
    const tabId = await openLeadPage(lead.leadId);
    for (const p of phones) {
      if (stopRequested || skipFlag || answeredFlag) break;
      if (borrados.has(d10(p))) { log(`  ↷ ${fmt(p)} — lo borraste, no se marca`); continue; }
      setStatus(`Llamando a ${name}: ${fmt(p)}`);
      const r = await callOnPage(tabId, p);
      if (r && r.ok) { stats.calls++; log(`  ${fmt(p)} — guardada`); if (window.Cerebro) Cerebro.anotar({ leadId: lead.leadId, canal: "llamada", robot: "Marki", tel: d10(p) }).catch(() => {}); }
      else { log(`  ${fmt(p)} — ${r ? r.error : "sin respuesta"}`); if (!stopRequested) stats.errors++; }
      setCounts();
      await sleep(1500);
    }
  }

  if (stopRequested) { log("  ■ Detenido. Este lead se queda como estaba."); return; }
  if (skipFlag) { log("  ↷ Saltado sin cambios."); return "skipped"; }

  if (answeredFlag) {
    await updateLead(lead, cfg.answeredStage);
    stats.answered++; stats.done++;
    log(`  ✓ Contestó → ${cfg.answeredStage}${cfg.removeTag ? `, sin "${cfg.removeTag}"` : ""}`);
    setCounts();
    return;
  }

  // 2) SMS
  if (cfg.doSms && activeMessages().length && !lead.cannotText) {
    setStatus(`Mandando SMS a ${name}`);
    // Fase 1 · revisión con el lead completo (bajas, DNC, unsubscription). Si no se puede leer, NO se manda.
    let fresco = null;
    try { const f = await api(`/v1.0/leads/${lead.leadId}`); fresco = (f && (f.lead || f.data || f)) || null; } catch (e) { log(`  No pude revisar en Lofty si ${name} se dio de baja (${e.message}); no le mando SMS.`); }
    const cuenta = await cuentaSms();
    const bloqueoLead = !fresco ? "sin revisión" : (fresco.cannotText === true || fresco.unsubscription === true) ? "opt-out en Lofty" : "";
    if (fresco && bloqueoLead) await SMS.marcarBaja({ leadId: lead.leadId, cuenta, tels: phones, motivo: bloqueoLead, fuente: "Marki" });
    if (fresco && !bloqueoLead) {
      const fuera = numerosOptOutAl(fresco);
      if (fuera.size) await SMS.marcarBaja({ tels: [...fuera], motivo: "Do Not Text / DNC en Lofty", fuente: "Marki" });
      const { rsNoEscribir: n1 = {}, rcNoEscribir: n2 = {} } = cuenta === "tx" ? await chrome.storage.local.get(["rsNoEscribir", "rcNoEscribir"]) : {};
      const rsNoEscribir = { ...n1, ...n2 }; // Resi y Resi 2
      const leadSlot = await nextRot();
      const primaryDone = cfg.skipPrimary ? await sameMessageSentToday(lead.leadId) : false;
      const cbSms = window.Cerebro ? await Cerebro.puedo({ leadId: lead.leadId, canal: "sms", robot: "Marki", clave: cfg.apiKey, respetaAnna: !lead.deRayo }) : { ok: true };
      if (!cbSms.ok) log(`  Cerebro: ${cbSms.motivo}. No le mando SMS.`);
      else if (rsNoEscribir && rsNoEscribir[String(lead.leadId)]) log(`  Resi lo tiene como “${rsNoEscribir[String(lead.leadId)].motivo}”; no se le manda SMS`);
      else if (primaryDone === null) log("  Sin historial de SMS no sé si ya lo recibió hoy; no le mando (falla cerrada)");
      else for (let i = 0; i < phones.length; i++) {
        if (stopRequested) break;
        const p = phones[i];
        if (borrados.has(d10(p))) { log(`  ↷ ${fmt(p)} — lo borraste, no se le manda SMS`); continue; }
        if (fuera.has(d10(p))) { log(`  ${fmt(p)} — marcado Do Not Text / DNC en Lofty, no se le manda`); continue; }
        if (i === 0 && primaryDone) { log(`  ${fmt(p)} — ya lo recibió hoy, no se repite`); continue; }
        if (await alreadySentLocally(lead.leadId, p)) { log(`  ${fmt(p)} — ya se lo mandé hoy`); continue; }
        const pol = await SMS.puedeMandar({ tel: p, leadId: lead.leadId, cuenta, fuente: "Marki" });
        if (!pol.ok) {
          await SMS.anotar({ fuente: "Marki", leadId: lead.leadId, tel: d10(p), estado: "bloqueado", motivo: pol.motivo });
          log(`  ${fmt(p)} — no se manda: ${pol.motivo}`);
          if (pol.horario || pol.tope || /política/.test(pol.motivo)) { stopRequested = true; log(`■ Me detengo: ${pol.motivo}.`); }
          continue;
        }
        const msg = pickMessage(leadSlot, i);
        try {
          await sendSms(lead.leadId, p, msg.text);
          await markSentLocally(lead.leadId, p);
          await SMS.anotar({ fuente: "Marki", leadId: lead.leadId, tel: d10(p), estado: "enviado", texto: msg.text });
          stats.sms++;
          log(`  ${fmt(p)} — SMS ${msg.n} enviado`);
        } catch (e) {
          await SMS.devolverLugar();
          await SMS.anotar({ fuente: "Marki", leadId: lead.leadId, tel: d10(p), estado: "error", motivo: e.message });
          if (/unsubscri|opt.?out|consent|do not (text|call)|cannot text|can'?t text/i.test(e.message)) await SMS.marcarBaja({ tel: p, motivo: "Lofty rechazó por opt-out", fuente: "Marki" });
          stats.errors++;
          log(`  SMS ${fmt(p)} — ${e.message}`);
        }
        setCounts();
        await sleep(1200);
      }
    } else log(`  No se le manda SMS a ${name} (${bloqueoLead}).`);
    if (stopRequested) { log("  ■ Detenido antes de mover el pipeline."); return; }
  } else if (lead.cannotText) {
    log("  (Lead marcado como 'no enviar textos', no se manda SMS)");
  }
  if (stopRequested) { log("  ■ Detenido antes de mover el pipeline."); return; }

  // 3) Pipeline y tag
  await updateLead(lead, cfg.targetStage);
  stats.done++;
  log(`  ✓ → ${cfg.targetStage}${cfg.removeTag ? `, sin "${cfg.removeTag}"` : ""}`);
  setCounts();
}

async function run() {
  await saveCfg();
  if (!cfg.apiKey) { alert("Pega tu API key de Lofty en Conexión."); return; }
  if (cfg.doSms && !activeMessages().length) { alert("Activa al menos un SMS con texto."); return; }
  if (!cfg.removeTag && cfg.filterStage === cfg.targetStage) {
    alert("Sin quitar tag y sin cambiar de pipeline, el agente repetiría los mismos leads. Ajusta uno de los dos.");
    return;
  }
  if (cfg.doSms) {
    // Fase 1: los SMS masivos ya no arrancan con un solo clic
    let total = "?"; try { total = (await fetchMatchingLeads(1)).total; } catch (e) {}
    const pol = await SMS.config();
    const okSms = await preguntar(`Marki va a mandar SMS automáticamente, lead por lead, a los leads${cfg.filterTipo ? ` ${TIPO_NOMBRE[cfg.filterTipo]}` : ""} de “${cfg.filterStage || "todas las etapas"}”${cfg.filterTag ? ` con el tag “${cfg.filterTag}”` : ""} (Lofty dice ${total}${cfg.filterTipo ? " contando todos los tipos" : ""}).\n\nMensaje: “${activeMessages()[0].text}”\n\nSolo a números de California, de ${pol.desde}:00 a ${pol.hasta}:00 hora de California${pol.tope > 0 ? `, máximo ${pol.tope} SMS al día` : ", sin tope diario"}, y nunca a bajas ni números DNC. Un SMS mandado no se puede borrar.`, "Sí, mandar SMS", "Cancelar");
    if (!okSms) { log("Cancelado: no arranqué."); return; }
  }
  running = true; stopRequested = false;
  stats = { done: 0, sms: 0, calls: 0, answered: 0, errors: 0 };
  setRunningUI(true); setCounts();
  log("=== Inicio ===");
  const seen = new Set();

  try {
    while (!stopRequested) {
      setStatus("Buscando el siguiente lead…");
      let next = await siguienteDeCola(seen);
      if (!next) {
        const { leads, total, tipo } = await fetchMatchingLeads(1, seen);
        next = leads[0];
        setCounts(`Pendientes: ${total}${tipo ? ` (de todos los tipos; trabajo solo ${tipo})` : ""}`);
      }
      if (!next && cfg.esperaRayo) { setStatus(SMS.enHorario(await SMS.config()) ? "Esperando leads nuevos de Rayo…" : "Fuera de horario: la cola de Rayo espera a las 8 am (California)…"); await sleep(15000); continue; } // sigue vivo para la cola de Rayo
      if (!next) { log("No quedan leads con ese filtro."); break; }
      seen.add(String(next.leadId));
      try {
        await processLead(next);
      } catch (e) {
        stats.errors++;
        log("  Error: " + e.message);
        setCounts();
      }
      await sleep(800);
    }
  } catch (e) {
    log("Error: " + e.message);
  }

  // Antes de terminar, asegurar que no quede ninguna llamada sin Save.
  if (lofftyTabId) {
    try { await chrome.tabs.sendMessage(lofftyTabId, { type: "flush" }); } catch {}
  }

  running = false;
  setRunningUI(false);
  setCurrent(null);
  setStatus(stopRequested ? "Detenido" : "Terminado");
  mascotSay(stopRequested ? "Me detuve. Cuando quieras sigo." : `¡Terminé! ${stats.done} leads listos.`, false);
  log("=== Fin ===");
}

// ---------- Botones ----------

$("autoSave").addEventListener("change", async () => {
  await saveCfg();
  log($("autoSave").checked ? "Auto-Save encendido." : "Auto-Save apagado.");
});
$("save").onclick = async () => { await saveCfg(); log("Ajustes guardados."); };
$("test").onclick = async () => {
  await saveCfg();
  try {
    const { total, tipo } = await fetchMatchingLeads(1);
    log(`Conexión OK. Leads con el filtro de etapa/tag: ${total}` + (tipo ? `; Marki solo trabaja los ${tipo}.` : " (todos los tipos)."));
  } catch (e) { log("Error: " + e.message); }
};
$("preview").onclick = $("test").onclick;
$("start").onclick = () => { if (!running) run(); };
$("stop").onclick = async () => {
  stopRequested = true;
  setStatus("Deteniendo…");
  if (lofftyTabId) { try { await chrome.tabs.sendMessage(lofftyTabId, { type: "abort" }); } catch {} }
};
$("answered").onclick = () => { answeredFlag = true; log("  ← Marcado como contestó (se termina al colgar)."); };
$("skip").onclick = async () => {
  skipFlag = true;
  if (lofftyTabId) { try { await chrome.tabs.sendMessage(lofftyTabId, { type: "abort" }); } catch {} }
};

loadCfg().then(loadRot).then(() => setCounts());

// Centro de Mando: usar la misma API key que Texi (la cuenta con el número virtual de los SMS)
document.getElementById("usarTexi").onclick = async () => {
  const { txKey } = await chrome.storage.local.get("txKey");
  if (!txKey) { log("Texi todavía no tiene API key guardada."); return; }
  document.getElementById("apiKey").value = txKey; await saveCfg(); log("Listo: usaré la misma API key que Texi.");
};
