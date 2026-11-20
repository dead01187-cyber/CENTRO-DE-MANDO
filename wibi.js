// =====================================================================
// Wibi (brazo Propwire): sube a Lofty los leads de Propwire con el tag de
// su ciudad + el tag "propwire" (para distinguirlos de los de BeenVerified).
//  · Opción A: el CSV de Propwire que ya trae el skip trace.
//  · Opción B: lee directo de Propwire (pestaña Owner de cada propiedad)
//    las direcciones que limpió Carpi. No da skip trace ni gasta créditos.
// Quita compañías/trusts, números DNC (opcional) y de fuera de CA (opcional),
// revisa que no estén ya en Lofty (domicilio y teléfono) y NADA se sube sin tu OK.
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const hoy = () => new Date().toLocaleDateString("en-CA");
const tc = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const LADAS_CA = new Set("209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951".split(" "));
const bonito = (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
let leads = [], corriendo = false, parar = false;

// ---------- Ajustes ----------
async function cargarCfg() {
  const { wibiCfg = {}, wibiLeads = [] } = await chrome.storage.local.get(["wibiCfg", "wibiLeads"]);
  if (wibiCfg.sinDnc != null) $("sinDnc").checked = wibiCfg.sinDnc;
  if (wibiCfg.soloCA != null) $("soloCA").checked = wibiCfg.soloCA;
  const { carpiCfg = {} } = await chrome.storage.local.get("carpiCfg");
  $("pasarTrust").checked = wibiCfg.pasarTrust != null ? !!wibiCfg.pasarTrust : !!carpiCfg.pasarTrust;
  leads = wibiLeads;
  await cargarAgentes(wibiCfg.agent);
}
function guardarCfg() { chrome.storage.local.set({ wibiCfg: { sinDnc: $("sinDnc").checked, soloCA: $("soloCA").checked, pasarTrust: $("pasarTrust").checked, agent: $("agent").value } }); }
["sinDnc", "soloCA", "pasarTrust", "agent"].forEach((id) => ($(id).onchange = guardarCfg));
async function cargarAgentes(elegido) {
  try {
    const d = await loftyApi("/members?limit=100");
    const ms = (Array.isArray(d) ? d : d.members || d.data || d.list || []).filter((m) => m && (m.userId || m.memberUserId || m.id));
    if (ms.length) {
      const idOf = (m) => String(m.userId || m.memberUserId || m.id);
      $("agent").innerHTML = ms.map((m) => `<option value="${esc(idOf(m))}">${esc(((m.firstName || "") + " " + (m.lastName || "")).trim() || m.name || m.email || idOf(m))}</option>`).join("");
    }
  } catch (e) {}
  const lofti = (() => { try { return JSON.parse(localStorage.getItem("pw2l_agent") || "null"); } catch (e) { return null; } })();
  for (const v of [elegido, lofti]) if (v && [...$("agent").options].some((o) => o.value === String(v))) { $("agent").value = String(v); break; }
}

// ---------- De filas de Propwire a leads ----------
// Trust de una persona vs. compañía (LLC, Inc, banco…). Los trusts que dejas pasar van a nombre de la persona del skip trace ("Name 1").
const RE_COMPANIA = /\b(L\.?L\.?C|L\.?L\.?P|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO\.|LTD|LIMITED|BANK|ASSN|ASSOCIATION|CHURCH|MINISTRIES|HOLDINGS?|PROPERT(?:Y|IES)|INVESTMENTS?|PARTNERS(?:HIP)?|FOUNDATION|COUNTY|CITY OF|STATE OF|UNIVERSITY|SCHOOL|DISTRICT|GROUP|VENTURES?|CAPITAL|REALTY|MANAGEMENT|MGMT|DEVELOPMENT|FUND|HOA|ENTERPRISES?|SERVICES|SOLUTIONS|AUTHORITY|AGENCY|FEDERAL|NATIONAL|MORTGAGE|LENDING|FINANCIAL|INVESTORS?|RENTALS?|ACQUISITIONS?|L\.?P)(?![A-Za-z0-9])/i;
const DUENOS = ["Owner 1 First Name", "Owner 1 Last Name", "Owner 2 First Name", "Owner 2 Last Name", "First Name", "Last Name"];
function prepararTrusts(filas, pasarTodos, pasados) {
  return filas.map((f) => {
    const n = DUENOS.map((h) => f[h] || "").join(" ");
    if (!Core.ENTITY_RE.test(n) || RE_COMPANIA.test(n)) return f;               // persona normal o compañía: igual
    const k = Core.addrKey(String(f["Address"] || "").trim(), String(f["City"] || "").trim());
    if (!pasarTodos && !pasados[k]) return f;                                   // trust que no dejaste pasar
    const persona = String(f["Name 1"] || "").trim().split(/\s+/).filter(Boolean);
    if (!persona.length) return f;                                              // sin persona del skip trace: no se puede
    return { ...f, "Owner 1 First Name": persona[0], "Owner 1 Last Name": persona.slice(1).join(" "), "Owner 2 First Name": "", "Owner 2 Last Name": "", "First Name": persona[0], "Last Name": persona.slice(1).join(" "), "Owner Type": "INDIVIDUAL" };
  });
}
function aLeads(filas, pasados = {}) {
  if (!filas.length) return [];
  filas = prepararTrusts(filas, $("pasarTrust").checked, pasados);
  const map = Core.detect(Object.keys(filas[0]));
  const recs = Core.processRows(filas, map, { excludeEntities: true, requirePhone: true, dropDnc: $("sinDnc").checked, onlyCA: true });
  return recs.map((r) => {
    let tels = r.phones;
    if ($("soloCA").checked) tels = tels.filter((p) => LADAS_CA.has(p.slice(0, 3)));
    const estado = r.status !== "ok" ? "fuera" : !tels.length ? "fuera" : "nuevo";
    const motivo = r.status !== "ok" ? r.reason : !tels.length ? "Sin teléfono de California" : "";
    return { key: Core.addrKey(r.street, r.city), first: r.first, last: r.last, street: r.street, city: r.city, state: r.state || "CA", zip: r.zip, phones: tels, emails: r.emails, estado, motivo };
  });
}

// ¿Ya está en Lofty? Por domicilio y por teléfono (los primeros 3)
async function yaEnLofty(l) {
  if (await enLoftyPorDomicilio({ street: l.street, city: l.city })) return "domicilio";
  for (const p of l.phones.slice(0, 3)) {
    const d = await loftyApi("/leads?limit=1&phone=" + encodeURIComponent(p));
    if ((d.leads || d.data || []).length) return "teléfono " + bonito(p);
  }
  return "";
}
async function revisarLofty() {
  const { wibiSubidos = {} } = await chrome.storage.local.get("wibiSubidos");
  const nuevos = leads.filter((l) => l.estado === "nuevo");
  for (let i = 0; i < nuevos.length && !parar; i += 3) {
    ver(`Revisando en Lofty que no estén ya… ${Math.min(i + 3, nuevos.length)} de ${nuevos.length}`);
    await Promise.all(nuevos.slice(i, i + 3).map(async (l) => {
      if (wibiSubidos[l.key]) { l.estado = "ya"; l.motivo = wibiSubidos[l.key].aLofti ? "Ya se lo pasé a Lofti antes" : "Ya lo subí antes"; return; }
      try { const ya = await yaEnLofty(l); if (ya) { l.estado = "ya"; l.motivo = "Ya está en Lofty (" + ya + ")"; } }
      catch (e) { if (e.sinKey) throw e; }
    }));
  }
}
async function procesar(filas, origen) {
  const { carpiPasados = {} } = await chrome.storage.local.get("carpiPasados");
  leads = aLeads(filas, carpiPasados);
  await revisarLofty();
  const { wibiRes = {} } = await chrome.storage.local.get("wibiRes");
  await chrome.storage.local.set({ wibiLeads: leads, wibiRes: { ...wibiRes, fecha: wibiRes.fecha || hoy(), porSubir: leads.filter((l) => l.estado === "nuevo").length } });
  pintar();
  const n = (e) => leads.filter((l) => l.estado === e).length;
  decir(`Wibi: leí ${leads.length} propiedades (${origen}). ${n("nuevo")} listas para subir, ${n("ya")} ya están en Lofty y ${n("fuera")} no sirven (compañías, sin teléfono o DNC). Revisa la lista y dale “Pasar a Lofti”.`);
  window.robot && robot.set(n("nuevo") ? "feliz" : "idle", `${n("nuevo")} leads listos para subir`);
}

// ---------- Opción A: archivo ----------
$("leerArchivo").onclick = async () => {
  if (corriendo) return;
  const f = $("archivo").files[0];
  if (!f) { ver("Escoge el CSV de Propwire con el skip trace."); return; }
  corriendo = true; parar = false; botones(); guardarCfg();
  window.robot && robot.set("trabajando", "Leyendo el archivo de Propwire…");
  try {
    const texto = await new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result || "")); r.onerror = () => mal(r.error); r.readAsText(f); });
    const p = Papa.parse(texto, { header: true, skipEmptyLines: true });
    if (!(p.meta.fields || []).some((h) => /phone/i.test(h))) throw new Error("ese archivo no trae teléfonos: primero hazle el skip trace en Propwire y vuelve a exportarlo");
    await procesar(p.data || [], "del archivo " + f.name);
  } catch (e) { decir("Wibi: no pude leer el archivo: " + e.message, "error"); window.robot && robot.set("error", "No pude leer el archivo"); }
  finally { corriendo = false; botones(); }
};

// ---------- Opción B: directo de Propwire ----------
// (corren DENTRO de Propwire; son las mismas que usaba Wibi antes)
async function pwAbrir(calle, ciudad, zip) {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  if (/acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)|temporarily (blocked|restricted)|unusual (traffic|activity)/i.test(document.body ? document.body.innerText : "")) return { error: "Propwire bloqueó el acceso temporalmente", bloqueo: true };
  if (/verif|captcha|challenge/i.test(document.title) || document.querySelector('iframe[src*="captcha"], iframe[src*="challenge"]')) return { error: "Propwire pide verificación (captcha)", ayuda: true };
  let inp = null;
  for (let i = 0; i < 40 && !inp; i++) { inp = [...document.querySelectorAll("input")].find((e) => /Address, city/i.test(e.placeholder || "") && visible(e)); if (!inp) await esp(300); }
  if (!inp) return { error: "no encontré la caja de búsqueda de Propwire (¿sesión abierta?)" };
  inp.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(inp, `${calle}, ${ciudad}, CA ${zip || ""}`.trim());
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  const num = (calle.match(/^\d+/) || [""])[0], pal = (calle.replace(/^\d+\s*/, "").split(/\s+/).find((w) => w.length > 2) || "").toLowerCase();
  let sug = null;
  for (let i = 0; i < 40 && !sug; i++) { await esp(300); sug = [...document.querySelectorAll("li.dropdown-option, [role=option], li")].find((e) => visible(e) && /Address\s*$/i.test(e.textContent.trim()) && e.textContent.trim().startsWith(num + " ") && e.textContent.toLowerCase().includes(pal)); }
  if (!sug) return { error: "Propwire no encontró ese domicilio", sinDatos: true };
  sug.click();
  for (let i = 0; i < 40 && !/\/realestate\/.+\/(property|owner)-details/.test(location.pathname); i++) await esp(300);
  if (!/\/realestate\//.test(location.pathname)) return { error: "no se abrió la propiedad en Propwire" };
  await esp(1200);
  if (!/owner-details/.test(location.pathname)) {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i++) { tab = [...document.querySelectorAll("nav, a, button")].find((e) => /^\s*Owner\s*$/.test(e.textContent) && visible(e)); if (!tab) await esp(300); }
    if (!tab) return { error: "no encontré la pestaña Owner" };
    tab.click();
    for (let i = 0; i < 30 && !/owner-details/.test(location.pathname); i++) await esp(300);
  }
  for (let i = 0; i < 30 && ![...document.querySelectorAll("span")].some((e) => /^\s*Full Name\s*$/.test(e.textContent)); i++) await esp(300);
  return { url: location.href };
}
function pwLeer() {
  const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const fn = [...document.querySelectorAll("span")].find((e) => /^\s*Full Name\s*$/.test(e.textContent) && visible(e));
  const nombre = fn && fn.parentElement ? fn.parentElement.innerText.replace(/^\s*Full Name\s*/i, "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || "" : "";
  const TIPO = /\b(Mobile|Cell|Wireless|Land ?Line|Landline|VoIP|Phone|Other|Unknown|Residential)\b/i;
  const RE = /^(?:(Mobile|Cell|Wireless|Land ?Line|Landline|VoIP|Phone|Other|Unknown|Residential)\s*-\s*)?\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})\b/i;
  const borroso = (e) => { for (let x = e, i = 0; x && i < 4; x = x.parentElement, i++) if (/blur/.test(String(x.className))) return true; return false; };
  const tels = [];
  for (const e of document.querySelectorAll("span, div, li, a, p")) {
    if (e.children.length || !visible(e)) continue;
    const m = e.textContent.trim().match(RE); if (!m) continue;
    const num = m[2] + m[3] + m[4], fila = e.parentElement || e;
    const t = m[1] || ((fila.textContent.replace(e.textContent, "").match(TIPO) || [])[1]) || "Phone";
    const tapado = /^9{10}$/.test(num) || borroso(e), dnc = /\bDNC\b|do not call/i.test(fila.textContent);
    if (!tels.some((x) => x.num === num)) tels.push({ num, type: t, tapado, dnc });
  }
  const emails = [];
  const et = [...document.querySelectorAll("span, div, p")].find((e) => /^\s*Email\(s\)\s*$/i.test(e.textContent) && visible(e));
  if (et) for (const m of (et.parentElement.parentElement || et.parentElement).innerText.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) { const x = m[0].toLowerCase(); if (!emails.includes(x) && !borroso(et.parentElement)) emails.push(x); }
  const bloqueo = /acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)|temporarily (blocked|restricted)|unusual (traffic|activity)/i.test(document.body.innerText);
  return { nombre, tels, emails, url: location.href, bloqueo };
}
const corre = async (tab, func, args = []) => { const [r] = await chrome.scripting.executeScript({ target: { tabId: tab }, func, args }); return r && r.result; };
async function irA(tab, url) {
  await chrome.tabs.update(tab, { url }); await sleep(800);
  for (let i = 0; i < 60; i++) { const x = await chrome.tabs.get(tab).catch(() => null); if (!x || x.status === "complete") break; await sleep(400); }
  await sleep(1500 + Math.random() * 1500);
}
async function pestana() {
  const { wibiTab } = await chrome.storage.local.get("wibiTab");
  if (wibiTab) { const t = await chrome.tabs.get(wibiTab).catch(() => null); if (t && /propwire\.com/.test(t.url || "")) return t.id; }
  const t = await abrirPestana("https://propwire.com/search"); await chrome.storage.local.set({ wibiTab: t.id }); await sleep(2500); return t.id;
}
// Propwire pone "Apellido Nombre"; para Lofty va "Nombre Apellido"
const ordenNombre = (n) => {
  const s = String(n || "").replace(/\s+/g, " ").trim().replace(/\s+(Trs?|Tte|Ttee|Et Al|Etal|Jr Tr)\.?$/i, "");
  if (!s || Core.ENTITY_RE.test(s) || /,/.test(s)) return s;
  const p = s.split(" "); if (p.length < 2 || p.length > 3) return s;
  return tc([...p.slice(1), p[0]].join(" "));
};
async function pintarCarpetas() {
  const { carpiCarpetas = [] } = await chrome.storage.local.get("carpiCarpetas");
  const vivas = carpiCarpetas.filter((c) => !c.borrada && (c.direcciones || []).length);
  $("carpeta").innerHTML = vivas.length ? vivas.map((c, i) => `<option value="${i}">${esc(c.nombre)} · ${c.direcciones.length} propiedades</option>`).join("") : '<option value="">(Carpi todavía no ha limpiado ninguna lista)</option>';
  $("run").disabled = corriendo || !vivas.length;
  return vivas;
}
$("run").onclick = async () => {
  if (corriendo) return;
  const vivas = await pintarCarpetas(); const c = vivas[+$("carpeta").value];
  if (!c) return;
  corriendo = true; parar = false; botones(); guardarCfg();
  window.robot && robot.set("trabajando", "Leyendo owners en Propwire…");
  const filas = []; let fallas = 0;
  try {
    const tab = await pestana();
    for (const [k, a] of c.direcciones.entries()) {
      if (parar) break;
      if (k) { const ms = 6000 + Math.random() * 6000; for (let t = 0; t < ms && !parar; t += 500) await sleep(500); }
      if (typeof turnoPropwire === "function" && !(await turnoPropwire({ aviso: (ms) => ver(`Esperando turno de Propwire… ${Math.ceil(ms / 1000)} s`), parar: () => parar }))) break;
      ver(`Leyendo en Propwire ${k + 1} de ${c.direcciones.length}: ${a.street}, ${a.city}`);
      await irA(tab, "https://propwire.com/search");
      const r = await corre(tab, pwAbrir, [a.street, a.city, a.zip || ""]).catch((e) => ({ error: e.message }));
      if (r && (r.bloqueo || r.ayuda)) { decir(`Wibi: ${r.error}. Me detengo; resuélvelo en Propwire y vuelve a darle “Leer de Propwire”.`, "error"); break; }
      if (!r || r.error) { fallas++; continue; }
      let o = await corre(tab, pwLeer).catch(() => null);
      if (o && !o.nombre && !o.tels.length) { await sleep(2500); o = await corre(tab, pwLeer).catch(() => null); }
      if (!o) { fallas++; continue; }
      if (o.bloqueo) { decir("Wibi: Propwire bloqueó el acceso; me detengo.", "error"); break; }
      const nom = ordenNombre(o.nombre).split(" ");
      const f = { "Address": a.street, "City": a.city, "State": a.state || "CA", "Zip": a.zip || "", "First Name": nom[0] || "", "Last Name": nom.slice(1).join(" "), "Email": (o.emails || []).join(";") };
      o.tels.filter((t) => !t.tapado).slice(0, 5).forEach((t, i) => { f[`Phone ${i + 1}`] = t.num; f[`Do Not ${i + 1} Call`] = t.dnc ? "DNC" : ""; });
      filas.push(f);
    }
    if (filas.length) await procesar(filas, `de Propwire, lista ${c.nombre}${fallas ? `; ${fallas} no las pude abrir` : ""}`);
    else decir("Wibi: no pude leer ninguna propiedad en Propwire" + (fallas ? ` (${fallas} no se abrieron)` : "") + ".", fallas ? "error" : undefined);
  } catch (e) { decir("Wibi: " + e.message, "error"); window.robot && robot.set("error", e.message); }
  finally { corriendo = false; botones(); pintarCarpetas(); }
};

// ---------- Subir a Lofty (con tu OK) ----------
function cuerpo(l) {
  const body = {
    firstName: (l.first || "").slice(0, 30), phones: l.phones.map((p) => "+1" + p), emails: l.emails,
    leadTypes: [1], source: "Propwire", tags: [...new Set([tc(l.city), "propwire"].filter(Boolean))],
    assignedUserId: Number($("agent").value), ownershipScope: "TEAM",
    cannotCall: false, cannotText: false, cannotEmail: false, welcomeEmail: false,
    property: { streetAddress: l.street, city: l.city, state: l.state || "CA", zipCode: l.zip },
  };
  if (l.last) body.lastName = l.last.slice(0, 30);
  if (!body.property.zipCode) delete body.property.zipCode;
  return body;
}
// Pasa los leads a Lofti (a su lote de Propwire). Lofti los sube a Lofty con tu OK, con el tag "propwire" y el de su ciudad.
$("subir").onclick = async () => {
  if (corriendo) return;
  const pend = leads.filter((l) => l.estado === "nuevo");
  if (!pend.length) return;
  corriendo = true; botones();
  try {
    const { lote_wb = [], wibiSubidos = {} } = await chrome.storage.local.get(["lote_wb", "wibiSubidos"]);
    const clave = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    let pasados = 0;
    for (const l of pend) {
      const address = `${l.street}, ${l.city}, ${l.state || "CA"}${l.zip ? " " + l.zip : ""}`;
      const owner = `${l.first} ${l.last}`.trim();
      const phones = l.phones.map((p) => ({ num: p, type: "Phone" }));
      const ya = lote_wb.find((x) => clave(x.address) === clave(address));
      if (ya) { for (const p of phones) if (!ya.phones.some((q) => q.num === p.num)) ya.phones.push(p); ya.emails = [...new Set([...(ya.emails || []), ...l.emails])]; ya.fuente = "propwire"; if (!ya.owner) ya.owner = owner; }
      else lote_wb.push({ owner, phones, emails: l.emails, address, url: "", fuente: "propwire" });
      l.estado = "lofti"; wibiSubidos[l.key] = { t: Date.now(), aLofti: true }; pasados++;
    }
    const { wibiRes = {} } = await chrome.storage.local.get("wibiRes");
    const n = (wibiRes.fecha === hoy() ? wibiRes.aLoftiHoy || 0 : 0) + pasados;
    await chrome.storage.local.set({ lote_wb, wibiLeads: leads, wibiSubidos, wibiRes: { fecha: hoy(), aLoftiHoy: n, porSubir: 0 } });
    decir(`Wibi: le pasé ${pasados} lead(s) a Lofti con el tag “propwire” y el de su ciudad. Ábrelo en Lofti para revisarlos y subirlos a Lofty.`);
    window.robot && robot.set("feliz", `Pasé ${pasados} a Lofti`);
  } catch (e) { decir("Wibi: no pude pasarlos a Lofti: " + e.message, "error"); }
  finally { corriendo = false; botones(); pintar(); }
};

// ---------- Pantalla ----------
// ---------- Archivo para skip trace ----------
// Los que no traen teléfono (o solo de fuera de CA / DNC): domicilio en el formato que Propwire importa
const faltaSkip = (l) => l.estado === "fuera" && /tel[eé]fono|DNC/i.test(l.motivo || "") && l.street;
$("bajarSkip").onclick = async () => {
  const ls = leads.filter(faltaSkip);
  if (!ls.length) { decir("Wibi: no hay domicilios sin teléfono para skip trace."); return; }
  const vistos = new Set(), unicos = ls.filter((l) => { const k = l.key || Core.addrKey(l.street, l.city); if (vistos.has(k)) return false; vistos.add(k); return true; });
  const celda = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const texto = ["Address,City,State,Zip,First Name,Last Name", ...unicos.map((l) => [l.street, tc(l.city), l.state || "CA", l.zip || "", l.first || "", l.last || ""].map(celda).join(","))].join("\r\n");
  const ciudades = [...new Set(unicos.map((l) => tc(l.city)).filter(Boolean))].slice(0, 2).join(", ");
  const nombre = `Wibi/${new Date().toLocaleDateString("en-CA")} ${ciudades || "domicilios"} para skip trace.csv`.replace(/[:*?"<>|]+/g, "-");
  const url = URL.createObjectURL(new Blob(["\ufeff" + texto], { type: "text/csv;charset=utf-8" }));
  try { await chrome.downloads.download({ url, filename: nombre, conflictAction: "uniquify", saveAs: false }); decir(`Wibi: bajé ${unicos.length} domicilios sin teléfono a Descargas/${nombre}. Impórtalos a Propwire y hazles skip trace; luego dale “Leer” aquí con el archivo nuevo.`); }
  catch (e) { decir("Wibi: no pude bajar el archivo: " + e.message, "error"); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
};

// ---------- Archivo limpio para descargar ----------
// Solo los que sirven (listos o ya pasados a Lofti): sin los que ya están en Lofty, los que no sirven ni los que dieron error.
$("bajarLimpio").onclick = async () => {
  const ls = leads.filter((l) => l.estado === "nuevo" || l.estado === "lofti");
  if (!ls.length) { decir("Wibi: no hay leads limpios para bajar."); return; }
  const nT = Math.max(1, ...ls.map((l) => l.phones.length)), nE = Math.max(1, ...ls.map((l) => (l.emails || []).length));
  const cab = ["First Name", "Last Name", ...Array.from({ length: nT }, (_, i) => `Phone ${i + 1}`), ...Array.from({ length: nE }, (_, i) => `Email ${i + 1}`), "Address", "City", "State", "Zip", "Tags", "Source"];
  const celda = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const filasCsv = ls.map((l) => [l.first, l.last, ...Array.from({ length: nT }, (_, i) => l.phones[i] || ""), ...Array.from({ length: nE }, (_, i) => (l.emails || [])[i] || ""), l.street, tc(l.city), l.state || "CA", l.zip || "", `${tc(l.city)}, propwire`, "Propwire"].map(celda).join(","));
  const texto = [cab.map(celda).join(","), ...filasCsv].join("\r\n");
  const ciudades = [...new Set(ls.map((l) => tc(l.city)).filter(Boolean))].slice(0, 2).join(", ");
  const nombre = `Wibi/${new Date().toLocaleDateString("en-CA")} ${ciudades || "leads"} limpio.csv`.replace(/[:*?"<>|]+/g, "-");
  const url = URL.createObjectURL(new Blob(["\ufeff" + texto], { type: "text/csv;charset=utf-8" }));
  try { await chrome.downloads.download({ url, filename: nombre, conflictAction: "uniquify", saveAs: false }); decir(`Wibi: bajé el archivo limpio con ${ls.length} leads a Descargas/${nombre}.`); }
  catch (e) { decir("Wibi: no pude bajar el archivo: " + e.message, "error"); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
};

const ETQ = { lofti: ["en Lofti ✓", "ok"], nuevo: ["listo", "ok"], ya: ["ya en Lofty", "gris"], fuera: ["no sirve", "bad"], subido: ["subido ✓", "ok"], error: ["error", "bad"] };
async function pintar() {
  const n = (e) => leads.filter((l) => l.estado === e).length;
  $("nLeidos").textContent = leads.length; $("nListos").textContent = n("nuevo"); $("nYa").textContent = n("ya");
  const { wibiRes = {} } = await chrome.storage.local.get("wibiRes");
  $("nHoy").textContent = wibiRes.fecha === hoy() ? wibiRes.aLoftiHoy || 0 : 0;
  $("subir").disabled = corriendo || !n("nuevo"); $("subir").textContent = `➡️ Pasar ${n("nuevo")} a Lofti`;
  const orden = { nuevo: 0, error: 1, lofti: 2, subido: 2, ya: 3, fuera: 4 };
  const ls = [...leads].sort((a, b) => orden[a.estado] - orden[b.estado]);
  $("lista").innerHTML = ls.length ? ls.slice(0, 500).map((l) => `<li><div class="q"><b>${esc(`${l.first} ${l.last}`.trim() || "(sin nombre)")}</b> <span class="tag ${ETQ[l.estado][1]}">${ETQ[l.estado][0]}</span>
    <small>${esc(l.street)}, ${esc(l.city)} ${esc(l.zip || "")}</small><small>${l.phones.map(bonito).join(" · ") || "sin teléfonos"}${l.estado === "nuevo" ? ` · tags: ${esc(tc(l.city))}, propwire` : ""}</small>${l.motivo ? `<small>${esc(l.motivo)}</small>` : ""}</div></li>`).join("")
    + (ls.length > 500 ? `<li class="empty">…y ${ls.length - 500} más</li>` : "") : '<span class="empty">Todavía nada.</span>';
}
function botones() { $("bajarSkip").disabled = corriendo || !leads.some(faltaSkip); $("bajarLimpio").disabled = corriendo || !leads.some((l) => l.estado === "nuevo" || l.estado === "lofti"); $("leerArchivo").disabled = corriendo; $("stopBtn").hidden = !corriendo; $("run").disabled = corriendo || !$("carpeta").value; $("subir").disabled = corriendo || !leads.some((l) => l.estado === "nuevo"); }
$("stopBtn").onclick = () => { parar = true; ver("Parando…"); };
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.carpiCarpetas && !corriendo) pintarCarpetas(); });
cargarCfg().then(() => { pintar(); pintarCarpetas(); });
