// =====================================================================
// Heri: ejecuciones de hipotecas inversas (HECM) en Orange County.
// Paso 1 · Registro del condado (cr.occlerkrecorder.gov): saca los avisos
//   (Notice of Default, Notice of Trustee Sale, Notice of Sale) de los
//   últimos N días y busca a cada dueño por nombre. Es HECM si tiene un
//   trust deed a favor de HUD ("U S A HOUSING & URBAN DEV") o de un lender
//   de hipotecas inversas, sin reconveyance después. Un trust deed suelto a
//   "Secretary of HUD" reciente es ayuda de FHA (partial claim): no cuenta.
// Paso 2 · BeenVerified: busca a cada dueño por nombre y saca el domicilio
//   de su casa en Orange County ("Owned Asset"); queda confirmado cuando la
//   fecha de transferencia es la misma que la del trust deed de la HECM.
//   (La lista de Propwire no trae el nombre del dueño, por eso no se usa.)
// Paso 3 · Las HECM pasan al brazo HECM: Chequi 3 → Veri 3 / Wibi 3 → Owny 3
//   → Lofti (tags preforeclosure + celink, nota con los números de
//   documento). NO se suben solas: Capi avisa y espera tu "súbelo".
// Todo a ritmo humano; si Propwire bloquea, pausa compartida con Wibi.
// Paso 1c · Properant: Prope deja en prCasos las HECM en ejecución que saca de
//   Properant (ya con domicilio y señales de herederos). Heri las revisa en el
//   registro (¿HECM sin pagar? ¿Celink?) y las mete a su lista; el domicilio de
//   Properant se respeta (BeenVerified solo se usa para los herederos).
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const hoy = () => new Date().toLocaleDateString("en-CA");
const PAUSA_BLOQUEO = 3 * 60 * 60 * 1000;
const POR_HORA = 25; // fichas de Propwire por hora como máximo
const ZONA = "Orange County";
const REC_URL = "https://cr.occlerkrecorder.gov/RecorderWorksInternet/";
// Documentos de muerte/sucesión: el dueño murió y la hipoteca inversa venció, aunque todavía no haya NOD (llegar antes que todos)
const TIPOS_MUERTE = [[34, "AFFIDAVIT", "MUERTE"], [489, "LETTERS REP", "MUERTE"], [488, "LETTER ADMN", "MUERTE"], [313, "DEATH REPORT", "MUERTE"]];
const TIPOS_AVISO = [[19, "NOTICE DEFAULT", "NOD"], [210, "NT TRUSTEE SALE", "NTS"], [87, "NOTICE SALE", "NTS"]];
const REC_VIGENCIA = 30 * 864e5; // un dueño ya revisado en el registro no se vuelve a buscar en 30 días
let cfg = { dias: 60, tope: 20, auto: false, soloCelink: false, herederos: true, maxParientes: 3, muertes: true, diasMuertes: 30 }, corriendo = false, parar = false;

async function cargarCfg() {
  const { hrConfig = {} } = await chrome.storage.local.get("hrConfig");
  cfg = { ...cfg, ...hrConfig };
  if (!hrConfig.soloCelinkFijo) { cfg.soloCelink = true; chrome.storage.local.set({ hrConfig: { ...hrConfig, soloCelink: true, soloCelinkFijo: true } }); } // el jefe quiere solo Celink
  $("dias").value = cfg.dias || 60; $("tope").value = cfg.tope || 20; $("auto").checked = !!cfg.auto; $("soloCelink").checked = !!cfg.soloCelink;
  $("herederos").checked = cfg.herederos !== false; $("maxParientes").value = cfg.maxParientes || 3;
  $("muertes").checked = cfg.muertes !== false; $("diasMuertes").value = cfg.diasMuertes || 30;
}
function guardarCfg() {
  cfg = { dias: Math.max(1, Math.min(365, parseInt($("dias").value, 10) || 60)), tope: Math.max(1, Math.min(200, parseInt($("tope").value, 10) || 20)),
    auto: $("auto").checked, soloCelinkFijo: true, soloCelink: $("soloCelink").checked, herederos: $("herederos").checked, maxParientes: Math.max(1, Math.min(6, parseInt($("maxParientes").value, 10) || 3)),
    muertes: $("muertes").checked, diasMuertes: Math.max(7, Math.min(180, parseInt($("diasMuertes").value, 10) || 30)) };
  $("dias").value = cfg.dias; $("tope").value = cfg.tope;
  chrome.storage.local.set({ hrConfig: cfg });
}
["dias", "tope", "auto", "soloCelink", "herederos", "maxParientes", "muertes", "diasMuertes"].forEach((id) => ($(id).onchange = () => { guardarCfg(); pintar(); }));

// ---------- Corre en la página del registro (mundo de la página): una consulta y sus filas ----------
async function hrRecPedir(body) {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const listo = () => typeof global !== "undefined" && global && typeof global.SendAjaxRequest === "function";
  for (let i = 0; i < 50 && !listo(); i++) await esp(300);
  if (!listo()) return { error: "no cargó el buscador del registro" };
  if (!window.__hrRecListo) { // la página se recarga sola por inactividad; aquí no
    window.__hrRecListo = true;
    try { global.RefreshPage = function () {}; } catch (e) {}
    const hi = setTimeout(() => {}, 0); for (let i = 0; i <= hi; i++) { clearTimeout(i); clearInterval(i); }
  }
  const h = await new Promise((res) => {
    let ok = false; setTimeout(() => { if (!ok) res(null); }, 30000);
    try { global.SendAjaxRequest("POST", "Presentors/AjaxPresentor.aspx", body, (m) => { ok = true; res(String(m)); }); } catch (e) { res(null); }
  });
  if (h == null) return { error: "el registro no respondió" };
  const d = new DOMParser().parseFromString(h, "text/html");
  const txt = (e) => (e ? e.textContent.replace(/\s+/g, " ").trim() : "");
  const filas = [...d.querySelectorAll("tr")].filter((r) => r.cells.length > 3 && /^\d{13}$/.test(txt(r.cells[1]))).map((r) => ({
    doc: txt(r.cells[1]),
    gr: [...r.cells[2].querySelectorAll(".GrtContainer p")].map(txt).filter(Boolean),
    ge: [...r.cells[2].querySelectorAll(".GrteeContainer p")].map(txt).filter(Boolean),
    ty: [...r.cells[2].querySelectorAll(".DocTypeContainer p")].map(txt).filter(Boolean).join("/"),
    dt: txt(r.cells[3]) }));
  return { filas };
}

// ---------- Clasificar lo que salió del registro para un dueño ----------
const HUD = /HOUSING\s*&?\s*URBAN|URBAN DEV|\bHUD\b|SECRETARY OF HOUSING/i;
const HUD_HECM = /\bU\s*S\s*A\s+HOUSING/i; // así indexa el registro el 2º trust deed de una HECM (beneficiario HUD)
const REV = /REVERSE|AMERICAN ADVISORS|LONGBRIDGE|LIBERTY HOME EQUITY|URBAN FINANCIAL|GENERATION MORTGAGE|MUTUAL OF OMAHA MORTGAGE|SECURITY ONE LENDING|HIGHLANDS RESIDENTIAL|SENIOR LENDING|CELINK|COMPU[\s-]*LINK/i;
const fecha = (s) => { const [m, d, y] = String(s).split("/"); return new Date(+y, m - 1, +d); };
const tokens = (s) => String(s || "").toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter((t) => t.length > 1);
const EMPRESA = /\b(LLC|INC|CORP|CORPORATION|COMPANY|CO|BANK|N A|NA|ASSN|ASSOCIATION|ASSOC|SERVICES|SERVICING|TRUSTEE|FINANCIAL|MORTGAGE|LENDING|FUND|PARTNERS|LP|LTD|HOA|HOMEOWNERS|COUNTY|CITY|STATE)\b/i;
function nombreDueno(gr) {
  const p = (gr || []).find((g) => !EMPRESA.test(g)) || "";
  return p.replace(/\s+(TR|TRS|TRUSTEE|TRUST|ETAL|ET AL|EST OF.*|ESTATE OF.*)$/i, "").replace(/\s+/g, " ").trim();
}
function esDe(dueno, nombres) { // "JOHNSON ANNA L" ~ "JOHNSON ANNA L" / "JOHNSON ANNA LOUISE"
  const [ap, nom] = tokens(dueno);
  return (nombres || []).some((n) => { const t = tokens(n); return t[0] === ap && (!nom || t[1] === nom); });
}
// ---------- Probate / herederos con lo que ya trae el registro (gratis) ----------
// Tipos del registro de OC: LETTER ADMN / LETTERS REP (cartas de administrador o representante del probate),
// ORDER (órdenes de la corte), AFFIDAVIT (p. ej. muerte de joint tenant o de trustee), NT DEATH/TR CTF,
// CTF OF TRUSTEE (certificación de trust), APPOINT TRUSTEE (nombramiento de sucesor).
const RE_PROBATE = /^(LETTER ADMN|LETTERS REP|ORDER|AMEND ORDER|NOTICE OF ORDER|AFFIDAVIT$|AFFIDAVIT\/|NT DEATH|DEATH REPORT|CTF OF TRUSTEE|APPOINT TRUSTEE|RESIGN TRUSTEE)/;
const RE_REPRESENTANTE = /^(LETTER ADMN|LETTERS REP|CTF OF TRUSTEE|APPOINT TRUSTEE|NT DEATH|AFFIDAVIT)/;
function probateDe(dueno, filas) {
  const [ap, nom] = tokens(dueno);
  if (!ap) return { docs: [], representantes: [], familia: [], abierto: false };
  const esDueno = (n) => { const t = tokens(n); return t[0] === ap && (!nom || t[1] === nom); };
  const persona = (n) => n && !EMPRESA.test(n) && !HUD.test(n) && !REV.test(n);
  const mio = (x) => [...x.gr, ...x.ge].some((n) => tokens(n)[0] === ap);
  const docs = filas.filter((x) => RE_PROBATE.test(x.ty) && mio(x)).sort((a, b) => fecha(b.dt) - fecha(a.dt));
  const representantes = [...new Set(docs.filter((x) => RE_REPRESENTANTE.test(x.ty)).flatMap((x) => [...x.gr, ...x.ge]).filter((n) => persona(n) && !esDueno(n)))].slice(0, 6);
  // Familia: otras personas con el mismo apellido que firman documentos con el dueño (últimos 15 años)
  const desde = new Date(); desde.setFullYear(desde.getFullYear() - 15);
  // Segundos nombres del propio dueño ("GERSTMEIER FRANCES TIFFANY" → TIFFANY): "GERSTMEIER TIFFANY" es ella misma, no un familiar
  const propios = new Set(filas.flatMap((x) => [...x.gr, ...x.ge]).filter(esDueno).flatMap((n) => tokens(n).slice(2)));
  const esOtra = (n) => { const t = tokens(n); return !propios.has(t[1]) && !(nom && t[1] && nom.startsWith(t[1]) && t[1].length === 1); };
  const familia = [...new Set(filas.filter((x) => fecha(x.dt) >= desde && [...x.gr, ...x.ge].some(esDueno)).flatMap((x) => [...x.gr, ...x.ge])
    .filter((n) => persona(n) && tokens(n)[0] === ap && !esDueno(n) && esOtra(n) && !/\bEST(ATE)?\b/.test(n)))].filter((n) => !representantes.includes(n)).slice(0, 6);
  return { docs: docs.slice(0, 6).map((x) => ({ doc: x.doc, ty: x.ty, dt: x.dt, partes: [...x.gr, ...x.ge].filter((n) => !esDueno(n)).slice(0, 4) })),
    representantes, familia, abierto: docs.some((x) => /^(LETTER ADMN|LETTERS REP)/.test(x.ty) || (/ORDER/.test(x.ty) && [...x.gr, ...x.ge].some((n) => /\bEST(ATE)?\b/.test(n)))),
    estado: filas.some((x) => [...x.gr, ...x.ge].some((n) => tokens(n)[0] === ap && /\bEST(ATE)?( OF)?\b/.test(n))) };
}
function clasificar(dueno, filas) {
  const td = filas.filter((x) => /^TRUST DEED/.test(x.ty) && esDe(dueno, x.gr));
  const hud = td.filter((x) => x.ge.some((g) => HUD_HECM.test(g)));
  const rev = td.filter((x) => x.ge.some((g) => REV.test(g)));
  const hecm = [...hud, ...rev].sort((a, b) => fecha(b.dt) - fecha(a.dt));
  if (!hecm.length) return null;
  const ultima = fecha(hecm[0].dt);
  const recon = filas.filter((x) => /RECONVEY/.test(x.ty) && fecha(x.dt) > ultima && (esDe(dueno, x.ge) || !x.ge.length));
  const asgt = filas.filter((x) => /ASGT TRUST DEED/.test(x.ty) && x.ge.some((g) => HUD.test(g)) && fecha(x.dt) >= ultima);
  const subst = filas.filter((x) => /SUBSTITUTION/.test(x.ty) && fecha(x.dt) >= ultima);
  const celink = filas.filter((x) => [...x.gr, ...x.ge].some((g) => RE_HECM.test(g)));
  const lender = (rev[0] && rev[0].ge.find((g) => REV.test(g))) || "HECM (beneficiario HUD)";
  return { origen: hecm[hecm.length - 1].dt, fechasHecm: [...new Set(hecm.map((x) => x.dt))], lender: lender.replace(/\s+BFC$/, ""), docHecm: hecm.map((x) => x.doc),
    asignadaHud: asgt.length ? asgt[0].dt : "", recon: recon.map((x) => x.dt), subst: subst.map((x) => `${x.doc} (${x.dt})`),
    celink: celink.length > 0, celinkDocs: celink.map((x) => `${x.doc} ${x.ty}`).slice(0, 3), probate: probateDe(dueno, filas) };
}
// ---------- Corre en la página de Propwire (mundo de la página): escuchar la respuesta de la búsqueda ----------
function hrEscuchar() {
  if (window.__hrHook) { window.__hrCap = []; return true; }
  window.__hrHook = true; window.__hrCap = [];
  const guardar = (u, t) => { if (/search-results/.test(String(u))) try { window.__hrCap.push(JSON.parse(t)); } catch (e) {} };
  const of = window.fetch;
  window.fetch = async function (...a) { const r = await of.apply(this, a); try { const u = a[0] && (a[0].url || a[0]); r.clone().text().then((t) => guardar(u, t)); } catch (e) {} return r; };
  const ox = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__hrU = u; return ox.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () { this.addEventListener("load", () => guardar(this.__hrU, this.responseText)); return os.apply(this, arguments); };
  return true;
}
// Escribe la zona, escoge la sugerencia y regresa la lista (todas las páginas del resultado)
async function hrBuscar(zona) {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (e) => !!e && e.getClientRects().length > 0;
  const BLOQ = /acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)|temporarily (blocked|restricted)|unusual (traffic|activity)/i;
  if (BLOQ.test(document.body.innerText)) return { bloqueo: true };
  let inp = null;
  for (let i = 0; i < 40 && !inp; i++) { inp = [...document.querySelectorAll("input")].find((e) => /Address, city/i.test(e.placeholder || "") && visible(e)); if (!inp) await esp(300); }
  if (!inp) return { error: "no encontré la caja de búsqueda de Propwire (¿sesión abierta?)" };
  window.__hrCap = [];
  inp.focus();
  const escribir = /\bcounty\b|\bcondado\b/i.test(zona) ? zona.replace(/,?\s*(ca|california)\s*$/i, "").replace(/\b(county|condado( de)?)\b/gi, "").replace(/\s+/g, " ").trim() : zona;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(inp, escribir);
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  const limpio = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  // "Orange County" → Propwire lo llama "Orange, CACounty": se escribe "Orange" y se escoge la opción de condado
  const condado = /\bcounty\b|\bcondado\b/i.test(zona);
  const z = limpio(zona.replace(/,?\s*(ca|california)\s*$/i, "").replace(/\b(county|condado( de)?)\b/gi, ""));
  // Propwire escribe la sugerencia pegada: "Santa Ana, CACity" / "Orange County, CACounty" / "92703, CAZip"
  const deCA = (t) => /,\s*CA(?![a-z])/.test(t);
  const lugar = (t) => limpio(String(t).split(",")[0]);
  let sug = null;
  for (let i = 0; i < 30 && !sug; i++) {
    await esp(300);
    const ops = [...document.querySelectorAll("li.dropdown-option")].filter(visible).filter((e) => deCA(e.textContent)).filter((e) => !condado || /County\s*$/i.test(e.textContent));
    sug = ops.find((e) => lugar(e.textContent) === z) || ops.find((e) => lugar(e.textContent).startsWith(z)) || ops.find((e) => limpio(e.textContent).includes(z));
  }
  if (!sug) return { error: `Propwire no reconoció la zona “${zona}”` };
  sug.click();
  let res = null;
  for (let i = 0; i < 60 && !res; i++) { await esp(500); res = (window.__hrCap || []).filter((j) => j && Array.isArray(j.response)).pop(); }
  if (!res) return { error: "Propwire no regresó resultados" };
  const items = [...res.response];
  // Si Propwire dio menos de los que hay, pedir el resto con el rango de resultados
  const total = res.record_count || items.length;
  if (items.length < total) {
    const fin = [...document.querySelectorAll("input")].find((i) => i.getAttribute("aria-label") === "Results range end");
    const btn = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Change Result Range");
    if (fin && btn) {
      window.__hrCap = [];
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(fin, String(Math.min(total, 1000)));
      fin.dispatchEvent(new Event("input", { bubbles: true })); fin.dispatchEvent(new Event("change", { bubbles: true }));
      await esp(400); btn.click();
      for (let i = 0; i < 40; i++) { await esp(500); const r2 = (window.__hrCap || []).filter((j) => j && Array.isArray(j.response)).pop(); if (r2) { for (const p of r2.response) if (!items.some((x) => x.id === p.id)) items.push(p); break; } }
    }
  }
  return { total, items: items.filter((p) => p && p.id && p.address && /^(ca|california)$/i.test(p.address.state || "CA"))
    .map((p) => ({ id: p.id, street: p.address.address, city: p.address.city, zip: p.address.zip, owner: p.owner_name || "",
      preprobate: !!(p.lead_type && p.lead_type.preprobate), // dueño probablemente fallecido → herederos
      empresa: !!(p.company_owned || p.government_owned) && !p.individual_owned && !p.trust_owned })) };
}
// Lee la ficha: "Foreclosure Details" y "Open Mortgages"
async function hrFicha() {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const BLOQ = /acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)|temporarily (blocked|restricted)|unusual (traffic|activity)/i;
  for (let i = 0; i < 40 && !/Foreclosure Details|Open Mortgages|Public Facts/.test(document.body.innerText); i++) { if (BLOQ.test(document.body.innerText)) break; await esp(400); }
  const t = document.body.innerText;
  if (BLOQ.test(t)) return { bloqueo: true };
  if (!/Foreclosure Details|Open Mortgages|Public Facts/.test(t)) return { error: "no cargó la ficha" };
  const lineas = t.split("\n").map((s) => s.trim());
  // Foreclosure Details: etiqueta en una línea y el valor en la siguiente
  const ETQ = ["Document Number", "Document Type", "Document Recording Date", "Unpaid Amount", "Lender Name", "Auction Date", "Opening Bid", "Trustee Adress", "Trustee Address", "Trustee Phone", "Trustee/Attorney Name", "Trustee Sale/Case Number"];
  const fc = {};
  const i0 = lineas.indexOf("Foreclosure Details");
  if (i0 >= 0) {
    for (let i = i0 + 1; i < Math.min(lineas.length, i0 + 40); i++) {
      if (ETQ.includes(lineas[i])) { const v = lineas[i + 1]; fc[lineas[i]] = v && !ETQ.includes(v) ? v : ""; }
      else if (/^(Building Details|Public Facts|Property Characteristics|Land Information|Tax Information)$/.test(lineas[i])) break;
    }
  }
  // Open Mortgages: encabezados y luego filas separadas por tabuladores
  const hipotecas = [];
  const m0 = t.indexOf("Open Mortgages");
  if (m0 >= 0) {
    const bloque = t.slice(m0, t.indexOf("Public Facts", m0) > m0 ? t.indexOf("Public Facts", m0) : m0 + 3000).split("\n");
    const enc = bloque.slice(1).map((s) => s.trim()).filter((s) => s && !/\t/.test(s) && !/^\$/.test(s)).slice(0, 12);
    for (const l of bloque) if ((l.match(/\t/g) || []).length >= 2 && /\$/.test(l)) {
      const c = l.split("\t").map((s) => s.trim()); const h = {};
      enc.forEach((n, k) => (h[n] = c[k] || ""));
      hipotecas.push({ lender: h["Lender Name"] || "", tipo: h["Loan Type"] || "", monto: h["Loan Amount"] || "", fecha: h["Recording Date"] || "", posicion: h["Loan Position"] || "" });
    }
  }
  return { fc, hipotecas, url: location.href };
}

// ---------- Pestaña de Propwire de Heri (en la ventana del brazo HECM) ----------
async function pestanaHR(url) {
  const { hrTab } = await chrome.storage.local.get("hrTab");
  const vid = await ventanaTrabajo("hecm");
  let id = null;
  if (hrTab) { const t = await chrome.tabs.get(hrTab).catch(() => null); if (t && /propwire\.com/.test(t.url || "")) { if (t.windowId !== vid) await chrome.tabs.move(t.id, { windowId: vid, index: -1 }).catch(() => {}); id = t.id; } }
  if (!id) { const t = await abrirPestana(url, "hecm"); await chrome.storage.local.set({ hrTab: t.id }); await sleep(2500); return t.id; }
  await chrome.tabs.update(id, { url });
  await sleep(700);
  for (let i = 0; i < 60; i++) { const x = await chrome.tabs.get(id).catch(() => null); if (!x || x.status === "complete") break; await sleep(400); }
  await sleep(1800);
  return id;
}
// Pone la pestaña (y su ventana) al frente mientras trabaja: si la ventana queda detrás, Chrome casi no deja
// avanzar a la página (la lista de sugerencias no sale). Al terminar regresa la ventana que tenías.
async function alFrente(tabId) {
  const t = await chrome.tabs.get(tabId);
  const [antes] = await chrome.tabs.query({ active: true, windowId: t.windowId });
  const winFoco = await chrome.windows.getLastFocused().catch(() => null);
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
  await sleep(800);
  return async () => {
    if (antes && antes.id !== tabId) await chrome.tabs.update(antes.id, { active: true }).catch(() => {});
    if (winFoco && winFoco.id !== t.windowId) await chrome.windows.update(winFoco.id, { focused: true }).catch(() => {});
  };
}
const corre = async (tab, func, args = [], world = "ISOLATED") => {
  const [r] = await chrome.scripting.executeScript({ target: { tabId: tab }, func, args, world });
  return r && r.result;
};
const slug = (p) => `${p.street} ${p.city} CA ${p.zip || ""}`.trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---------- Pausas compartidas con Wibi (misma cuenta de Propwire) ----------
async function pausaHasta() { const { wbPausa = 0 } = await chrome.storage.local.get("wbPausa"); return wbPausa > Date.now() ? wbPausa : 0; }
async function bloqueado() {
  const hasta = Date.now() + PAUSA_BLOQUEO;
  await chrome.storage.local.set({ wbPausa: hasta });
  decir(`Propwire bloqueó el acceso temporalmente. Heri (y Wibi) no tocan Propwire hasta las ${new Date(hasta).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`, "error");
}
async function fichasUltimaHora() { const { hrHora = [] } = await chrome.storage.local.get("hrHora"); return hrHora.filter((t) => t > Date.now() - 3600e3); }
async function marcarHora() { const h = await fichasUltimaHora(); h.push(Date.now()); await chrome.storage.local.set({ hrHora: h }); }
async function esperar(ms, texto) { const fin = Date.now() + ms; while (Date.now() < fin && !parar) { ver(`${texto} (${Math.ceil((fin - Date.now()) / 1000)} s)…`); await sleep(Math.min(1000, fin - Date.now())); } }

// ¿Lo administra Celink / Compu-Link (es la misma empresa)?
//  · aparece en un documento del registro → confirmado
//  · la HECM pasó a HUD → Celink es el administrador oficial de las HECM de HUD (desde 2022)
//  · lender Finance of America / Mutual of Omaha → Celink les administra sus préstamos (probable)
const CLIENTES_CELINK = /FINANCE OF AMERICA|MUTUAL OF OMAHA/i;
function celinkDe(res) {
  if (!res) return { celink: false, celinkMotivo: "" };
  if (res.celinkDocs && res.celinkDocs.length) return { celink: true, celinkMotivo: "Compu-Link/Celink aparece en el registro" };
  if (res.asignadaHud) return { celink: true, celinkMotivo: `pasó a HUD (${res.asignadaHud}): Celink administra las HECM de HUD` };
  if (CLIENTES_CELINK.test(res.lender || "")) return { celink: true, probable: true, celinkMotivo: `lender ${res.lender}: Celink le administra sus préstamos (probable)` };
  return { celink: false, celinkMotivo: "servicer sin confirmar" };
}

// ---------- Pestaña del registro (en la ventana del brazo HECM) ----------
async function pestanaRec() {
  const { hrRecTab } = await chrome.storage.local.get("hrRecTab");
  const vid = await ventanaTrabajo("hecm");
  if (hrRecTab) {
    const t = await chrome.tabs.get(hrRecTab).catch(() => null);
    if (t) {
      if (t.windowId !== vid) await chrome.tabs.move(t.id, { windowId: vid, index: -1 }).catch(() => {});
      if (/cr\.occlerkrecorder\.gov\/RecorderWorksInternet/i.test(t.url || "")) return t.id;
      await chrome.tabs.update(t.id, { url: REC_URL }); // se le acabó la sesión: se vuelve a abrir
      await sleep(700); for (let i = 0; i < 60; i++) { const x = await chrome.tabs.get(t.id).catch(() => null); if (!x || x.status === "complete") break; await sleep(400); }
      await sleep(1500); return t.id;
    }
  }
  const t = await abrirPestana(REC_URL, "hecm");
  await chrome.storage.local.set({ hrRecTab: t.id }); await sleep(2000);
  return t.id;
}
async function recPedir(body) {
  for (let intento = 0; intento < 2; intento++) {
    const tab = await pestanaRec();
    const r = await corre(tab, hrRecPedir, [body], "MAIN").catch((e) => ({ error: e.message }));
    if (r && r.filas) return r.filas;
    await sleep(4000);
  }
  throw new Error("el registro del condado no responde");
}
const mdy = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
const pausaRec = () => esperar(3000 + Math.random() * 3000, "Pausa en el registro (ritmo humano)");

// Paso 1a: avisos de los últimos N días
async function avisosRecientes(desde, hasta, tipos = TIPOS_AVISO) {
  const avisos = [];
  for (const [id, nombre, corto] of tipos) {
    const base = `&FromDate=${desde}&ToDate=${hasta}&DocumentTypes=${id},&DocumentNames=${nombre},&ERetrievalGroup=1&SearchMode=3`;
    const vistos = new Set();
    for (let p = 1; p <= 60 && !parar; p++) {
      ver(`Paso 1 · Registro: leyendo ${corto === "NOD" ? "Notice of Default" : corto === "MUERTE" ? "documentos de muerte (" + nombre + ")" : "avisos de remate (" + nombre + ")"}, página ${p}…`);
      const filas = await recPedir(p === 1 ? base + "&IsNewSearch=true" : `PageNum=${p}` + base);
      const nuevas = filas.filter((f) => !vistos.has(f.doc));
      nuevas.forEach((f) => { vistos.add(f.doc); avisos.push({ ...f, tipo: corto }); });
      await chrome.storage.local.set({ hrPasos: { ...(await pasos()), avisos: avisos.length } });
      if (nuevas.length < 20) break;
      await pausaRec();
    }
    if (parar) break;
    await pausaRec();
  }
  return avisos;
}
// Paso 1b: buscar al dueño por nombre (hasta 5 páginas)
async function historialDe(dueno, hasta) {
  const filas = [];
  let grande = false;
  for (let p = 1; p <= 5 && !parar; p++) {
    const base = `&PartyType=0&NameForSearch=${encodeURIComponent(dueno)}&AllowPartial=true&FromDate=01/01/1995&ToDate=${hasta}&ERetrievalGroup=1&SearchMode=1`;
    const r = await recPedir(p === 1 ? base + "&IsNewSearch=true" : `PageNum=${p}` + base);
    filas.push(...r);
    if (r.length < 20) break;
    if (p === 5) grande = true;
    await pausaRec();
  }
  return { filas, grande };
}
async function pasos() { const { hrPasos = {} } = await chrome.storage.local.get("hrPasos"); return hrPasos; }
async function ponerPasos(cambios) { await chrome.storage.local.set({ hrPasos: { ...(await pasos()), ...cambios, t: Date.now() } }); }

// Cruce de nombres registro ↔ Propwire ("JOHNSON ANNA L" ↔ "Anna L Johnson")
function mismoDueno(rec, pw) {
  const [ap, nom] = tokens(rec); const t = new Set(tokens(pw));
  return !!ap && t.has(ap) && (!nom || t.has(nom));
}

// ---------- Paso 2: BeenVerified por nombre (domicilio del dueño) ----------
const BV_DASH = "https://www.beenverified.com/rf/dashboard";
const CIUDADES_OC = /\b(aliso viejo|anaheim|brea|buena park|costa mesa|cypress|dana point|fountain valley|fullerton|garden grove|huntington beach|irvine|la habra|la palma|laguna beach|laguna hills|laguna niguel|laguna woods|lake forest|los alamitos|mission viejo|newport beach|newport coast|corona del mar|orange|placentia|rancho santa margarita|san clemente|san juan capistrano|capistrano beach|santa ana|seal beach|stanton|tustin|villa park|westminster|yorba linda|ladera ranch|trabuco canyon|coto de caza|foothill ranch|midway city|rossmoor|silverado|sunset beach|modjeska|el toro|las flores)\b/i;
const zipOC = (z) => /^(92[6-8]\d\d|9062[0-9]|9063[01]|90680|90720|90740|9074[23])$/.test(String(z || "").trim());
// Corre en la página de BeenVerified: escribe "Nombre Apellido in CA", busca y regresa las tarjetas
async function hrBvBuscar(q) {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  if (/\/login/.test(location.pathname) || /Sign In with Google/i.test(document.body.innerText)) return { login: true };
  if (/captcha|verify you are human|unusual activity/i.test(document.body.innerText)) return { captcha: true };
  let inp = null;
  for (let i = 0; i < 40 && !inp; i++) { inp = [...document.querySelectorAll("input")].find((e) => /John Smith/i.test(e.placeholder || "") && e.getClientRects().length); if (!inp) await esp(300); }
  if (!inp) return { error: "no encontré la búsqueda de personas de BeenVerified" };
  inp.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(inp, q);
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  await esp(600 + Math.random() * 600);
  const btn = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Search" && b.getClientRects().length);
  if (!btn) return { error: "no encontré el botón Search" };
  btn.click();
  const VR = (b) => /view report/i.test((b.innerText || "") + " " + (b.getAttribute("aria-label") || ""));
  let vr = [];
  for (let i = 0; i < 50; i++) {
    await esp(500);
    vr = [...document.querySelectorAll("button,a")].filter(VR);
    if (vr.length || /No results|0 exact match(es)? and 0/i.test(document.body.innerText)) break;
  }
  await esp(800);
  vr = [...document.querySelectorAll("button,a")].filter(VR);
  return { tarjetas: vr.slice(0, 60).map((b, i) => {
    let c = b; while (c.parentElement && [...c.parentElement.querySelectorAll("button,a")].filter(VR).length === 1) c = c.parentElement;
    return { i, texto: c.innerText.replace(/\s*\n+\s*/g, " | ").slice(0, 600) };
  }) };
}
// Corre en la página (mundo de la página): abre el reporte i de la lista y regresa su link
async function hrBvAbrir(i) {
  const VR = (b) => /view report/i.test((b.innerText || "") + " " + (b.getAttribute("aria-label") || ""));
  const b = [...document.querySelectorAll("button,a")].filter(VR)[i];
  if (!b) return { error: "no encontré el reporte" };
  const abre = []; const ow = window.open;
  window.open = function (u) { abre.push(String(u)); return null; };
  if (b.tagName === "A" && b.href) abre.push(b.href);
  else b.click();
  await new Promise((r) => setTimeout(r, 2500));
  window.open = ow;
  return abre[0] ? { url: new URL(abre[0], location.href).href } : { error: "el reporte no abrió" };
}
// Corre en el reporte de persona: domicilios (con "Owned Asset" y fecha de transferencia)
async function hrBvReporte() {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 50 && !/Address History/.test(document.body.innerText); i++) await esp(400);
  const t = document.body.innerText;
  if (!/Address History/.test(t)) return { error: "no cargó el reporte" };
  const nombre = (t.split("\n").map((s) => s.trim()).find((s, k, a) => a[k - 1] && /^Date Updated/.test(a[k - 1])) || "");
  const fallecido = /\nDeceased\n/.test(t.slice(0, 800));
  const bloque = t.slice(t.indexOf("Address History"), t.indexOf("WARNING", t.indexOf("Address History")) > 0 ? t.indexOf("WARNING", t.indexOf("Address History")) : undefined);
  const L = bloque.split("\n").map((s) => s.trim()).filter(Boolean);
  const doms = [];
  for (let k = 1; k < L.length; k++) {
    const m = (L[k] || "").match(/^(.+?),\s*([A-Z]{2}),\s*(\d{5})/);
    if (m && /,$/.test(L[k - 1])) {
      const d = { street: L[k - 1].replace(/,$/, ""), city: m[1], state: m[2], zip: m[3], propia: false, transfer: "", periodo: "" };
      for (let j = k + 1; j < Math.min(L.length, k + 9) && !/,$/.test(L[j]); j++) {
        if (/^Owned Asset$/i.test(L[j])) d.propia = true;
        const tr = L[j].match(/^Transfer Date:\s*(\d{4}-\d{2}-\d{2})/); if (tr) d.transfer = tr[1];
        if (/^[A-Z][a-z]{2} \d{4}( - [A-Z][a-z]{2} \d{4})?$/.test(L[j])) d.periodo = d.periodo || L[j];
      }
      if (!doms.some((x) => x.street === d.street && x.zip === d.zip)) doms.push(d);
    }
  }
  return { nombre, fallecido, doms, url: location.href };
}
// ---------- Familiares del dueño fallecido (BeenVerified, sección "Possible Relatives") ----------
// Corre en el reporte del dueño: lista de familiares con parentesco, edad y ciudad
async function hrBvParientes() {
  const h = [...document.querySelectorAll("h2,h3")].find((x) => /^Possible Relatives$/i.test(x.innerText.trim()));
  if (!h) return { lista: [] };
  let sec = h;
  while (sec.parentElement && sec.parentElement !== document.body && !/Possible relative:/.test(sec.innerText) && !/No possible relatives/i.test(sec.innerText)) sec = sec.parentElement;
  const lista = [];
  for (const v of [...sec.querySelectorAll("a,button")].filter((b) => /^View$/i.test(b.innerText.trim()))) {
    let card = v;
    while (card.parentElement && !/Possible relative:/.test(card.innerText)) card = card.parentElement;
    if ((card.innerText.match(/Possible relative:/g) || []).length !== 1) continue; // tarjeta de un solo familiar
    const L = card.innerText.split("\n").map((x) => x.trim()).filter(Boolean);
    const k = L.findIndex((x) => /^Possible relative:/i.test(x));
    if (k < 1) continue;
    const nombre = L[k - 1], rel = L[k].replace(/^Possible relative:\s*/i, "");
    const edad = parseInt(((L.find((x) => /^Age:/i.test(x)) || "").match(/\d+/) || [])[0], 10) || 0;
    const ciudad = ((L.find((x) => /^Lives in:/i.test(x)) || "").replace(/^Lives in:\s*/i, ""));
    if (!lista.some((x) => x.nombre === nombre)) lista.push({ nombre, rel, edad, ciudad });
  }
  return { lista };
}
// Corre en el reporte del dueño (mundo de la página): abre el reporte de un familiar por su nombre
async function hrBvAbrirPariente(nombre) {
  const h = [...document.querySelectorAll("h2,h3")].find((x) => /^Possible Relatives$/i.test(x.innerText.trim()));
  if (!h) return { error: "no está la sección de familiares" };
  let sec = h; while (sec.parentElement && sec.parentElement !== document.body && !/Possible relative:/.test(sec.innerText)) sec = sec.parentElement;
  const v = [...sec.querySelectorAll("a,button")].find((b) => {
    if (!/^View$/i.test(b.innerText.trim())) return false;
    let c = b; while (c.parentElement && !/Possible relative:/.test(c.innerText)) c = c.parentElement;
    return (c.innerText.match(/Possible relative:/g) || []).length === 1 && c.innerText.split("\n").map((x) => x.trim()).includes(nombre);
  });
  if (!v) return { error: "no encontré a " + nombre };
  const abre = []; const ow = window.open;
  window.open = function (u) { abre.push(String(u)); return null; };
  if (v.tagName === "A" && v.href) abre.push(v.href); else v.click();
  await new Promise((r) => setTimeout(r, 2500));
  window.open = ow;
  return abre[0] ? { url: new URL(abre[0], location.href).href } : { error: "el reporte no abrió" };
}
// Corre en el reporte de un familiar: si vive, sus teléfonos y su domicilio actual
async function hrBvContacto() {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 50 && !/Address History|Possible Phone Numbers/.test(document.body.innerText); i++) await esp(400);
  const t = document.body.innerText;
  if (!/Address History|Possible Phone Numbers/.test(t)) return { error: "no cargó el reporte" };
  const fallecido = /\nDeceased\n/.test(t.slice(0, 1500));
  const a = t.indexOf("Possible Phone Numbers");
  const fin = [t.indexOf("Possible Email", a), t.indexOf("WARNING", a)].filter((x) => x > a).sort((x, y) => x - y)[0] || a + 1500;
  const L = a >= 0 ? t.slice(a, fin).split("\n").map((x) => x.trim()).filter(Boolean) : [];
  const tels = [];
  L.forEach((x, k) => { const m = x.match(/^\((\d{3})\)\s*(\d{3})-(\d{4})$/); if (m) tels.push({ num: m[1] + m[2] + m[3], tipo: /^(Mobile|Residential|Landline|Business|VoIP|Wireless|Cell)/i.test(L[k + 1] || "") ? L[k + 1] : "", periodo: /\d{4}/.test(L[k + 2] || "") ? L[k + 2] : "" }); });
  let dom = "";
  const b = t.indexOf("Address History");
  if (b >= 0) { const A = t.slice(b, b + 1500).split("\n").map((x) => x.trim()).filter(Boolean); for (let k = 1; k < A.length && !dom; k++) if (/,$/.test(A[k - 1]) && /^.+?,\s*[A-Z]{2},\s*\d{5}/.test(A[k])) dom = A[k - 1].replace(/,$/, "") + ", " + A[k]; }
  return { fallecido, tels: tels.slice(0, 5), dom, url: location.href };
}
// Orden que pidió el jefe: cónyuge vivo → hijos (el mayor primero) → hermanos → nietos → otros
const PRIO_PARIENTE = (r) => /spouse/i.test(r) && !/widow/i.test(r) ? 0 : /child|son|daughter/i.test(r) && !/grand/i.test(r) ? 1 : /sibling|brother|sister/i.test(r) ? 2 : /grand/i.test(r) ? 3 : /in-law|niece|nephew|aunt|uncle|cousin/i.test(r) ? 4 : /other/i.test(r) ? 5 : /parent/i.test(r) ? 6 : /widow/i.test(r) ? 7 : 5;
const REL_ES = (r) => /spouse/i.test(r) ? (/widow/i.test(r) ? "Cónyuge (viudez)" : "Cónyuge") : /adult child|child/i.test(r) && !/grand/i.test(r) ? "Hijo/a" : /grand/i.test(r) ? "Nieto/a" : /sibling/i.test(r) ? "Hermano/a" : /parent/i.test(r) ? "Padre/Madre" : /other/i.test(r) ? "Otro familiar" : r;
function ordenarParientes(lista) {
  return (lista || []).filter((p) => !p.edad || p.edad < 100) // más de 100 años: casi seguro ya falleció
    .sort((a, b) => PRIO_PARIENTE(a.rel) - PRIO_PARIENTE(b.rel) || (b.edad || 0) - (a.edad || 0));
}
async function contactarParientes(c, reporte, lista) {
  const orden = ordenarParientes(lista).slice(0, cfg.maxParientes || 3);
  const out = [];
  for (const [k, p] of orden.entries()) {
    if (parar) break;
    if (k) await esperar(10000 + Math.random() * 10000, "Pausa en BeenVerified (ritmo humano)");
    ver(`Paso 2 · Familiares de ${c.dueno}: abriendo el reporte de ${p.nombre} (${REL_ES(p.rel)})…`);
    let tab = await pestanaBV(reporte);
    for (let i = 0; i < 60; i++) { const z = await chrome.tabs.get(tab).catch(() => null); if (!z || z.status === "complete") break; await sleep(400); }
    await sleep(1500);
    const a = await corre(tab, hrBvAbrirPariente, [p.nombre], "MAIN").catch((e) => ({ error: e.message }));
    if (!a || !a.url) { out.push({ ...p, error: (a && a.error) || "no abrió" }); continue; }
    await chrome.tabs.update(tab, { url: a.url }); await sleep(1500);
    for (let i = 0; i < 60; i++) { const z = await chrome.tabs.get(tab).catch(() => null); if (!z || z.status === "complete") break; await sleep(400); }
    const r = await corre(tab, hrBvContacto).catch((e) => ({ error: e.message }));
    out.push({ ...p, relEs: REL_ES(p.rel), vivo: r && !r.error ? !r.fallecido : null, tels: (r && r.tels) || [], dom: (r && r.dom) || "", reporte: (r && r.url) || "" });
  }
  return { contactados: out, resto: ordenarParientes(lista).slice(orden.length).map((p) => ({ ...p, relEs: REL_ES(p.rel) })) };
}
async function pestanaBV(url) {
  const { hrBvTab } = await chrome.storage.local.get("hrBvTab");
  const vid = await ventanaTrabajo("hecm");
  if (hrBvTab) {
    const t = await chrome.tabs.get(hrBvTab).catch(() => null);
    if (t && /beenverified\.com/.test(t.url || "")) {
      if (t.windowId !== vid) await chrome.tabs.move(t.id, { windowId: vid, index: -1 }).catch(() => {});
      await chrome.tabs.update(t.id, { url }); await sleep(700);
      for (let i = 0; i < 60; i++) { const x = await chrome.tabs.get(t.id).catch(() => null); if (!x || x.status === "complete") break; await sleep(400); }
      await sleep(1500); return t.id;
    }
  }
  const t = await abrirPestana(url, "hecm");
  await chrome.storage.local.set({ hrBvTab: t.id }); await sleep(2500);
  return t.id;
}
const isoDe = (mdy) => { const [m, d, y] = String(mdy).split("/"); return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
const cerca = (a, b) => Math.abs(new Date(a) - new Date(b)) <= 5 * 864e5; // la transferencia y el trust deed se registran el mismo día (± unos días)
function puntuar(c, t) {
  const tx = t.toUpperCase();
  const [ap, nom, ...resto] = tokens(c.dueno);
  if (!tx.includes(ap)) return -1;
  let p = 0;
  if (nom && tx.includes(nom)) p += 3;
  const mid = resto[0];
  if (mid && new RegExp(`\\b${nom} ${mid[0]}`).test(tx)) p += 2;
  const loc = (t.split("| Locations |")[1] || "").split("| Possible")[0];
  if (CIUDADES_OC.test(loc)) p += 4;
  const edad = +((t.match(/,\s*(\d{2,3})\s*\|/) || [])[1] || 0);
  if (edad >= 62) p += 2; else if (edad && edad < 55) p -= 3;
  if (/\|\s*Deceased\s*\|/i.test(t)) p += 1;
  return p;
}
// Búsquedas por nombre: el dueño (con y sin segundo nombre) y los co-dueños del aviso (p. ej. el cónyuge, que suele vivir en la misma casa)
function consultasDe(c) {
  const cap = (x) => x.charAt(0) + x.slice(1).toLowerCase();
  const out = [];
  const add = (dueno, q) => { if (q && !out.some((x) => x.q === q)) out.push({ dueno, q }); };
  const crudo = (n) => String(n || "").toUpperCase().replace(/\s+(TR|TRS|TRUSTEE|TRUST|ETAL|ET AL|EST OF.*|ESTATE OF.*)$/i, "").replace(/[^A-Z ]/g, " ").split(/\s+/).filter(Boolean);
  const [ap, nom, mid] = crudo(c.dueno);
  if (ap && nom) {
    add(c.dueno, `${cap(nom)} ${cap(ap)} in CA`);
    if (mid) add(c.dueno, `${cap(nom)} ${mid.length > 1 ? cap(mid) : mid} ${cap(ap)} in CA`);
  }
  for (const n of c.todos || []) {
    if (EMPRESA.test(n) || HUD.test(n) || REV.test(n)) continue;
    const [a2, n2] = crudo(n);
    if (!a2 || !n2 || n2.length < 2 || (a2 === ap && n2 === nom)) continue;
    add(`${a2} ${n2}`, `${cap(n2)} ${cap(a2)} in CA`);
  }
  return out.slice(0, 4);
}
// Busca al dueño en BeenVerified y regresa el domicilio de la casa con la HECM.
// Si no sale un domicilio de Orange County pero sí la persona, regresa la persona (porNombre) para sacar teléfonos o familiares.
async function ubicarEnBV(c) {
  const consultas = consultasDe(c);
  if (!consultas.length) return { error: "el nombre del registro no sirve para buscar" };
  const fechas = (c.fechasHecm || [c.origen]).filter(Boolean).map(isoDe);
  const casa = c.prop && c.street ? c.street : ""; // el domicilio ya viene de Properant
  let mejor = null, persona = null, total = 0, primera = true;
  const vistos = new Set();
  for (const cq of consultas) {
    if (parar) break;
    if (!primera) await esperar(12000 + Math.random() * 10000, `Pausa en BeenVerified; ahora busco “${cq.q}”`);
    primera = false;
    let tab = await pestanaBV(BV_DASH);
    const r = await corre(tab, hrBvBuscar, [cq.q]).catch((e) => ({ error: e.message }));
    if (r.login) return { alto: "BeenVerified pide iniciar sesión en la ventana HECM" };
    if (r.captcha) return { alto: "BeenVerified pide verificación (captcha) en la ventana HECM" };
    if (r.error) continue;
    total += r.tarjetas.length;
    const cand = r.tarjetas.map((x) => ({ ...x, p: puntuar({ dueno: cq.dueno }, x.texto) })).filter((x) => x.p >= 3).sort((a, b) => b.p - a.p).slice(0, 3);
    for (const [k, x] of cand.entries()) {
      if (parar) break;
      if (k) { await esperar(12000 + Math.random() * 10000, "Pausa en BeenVerified (ritmo humano)"); tab = await pestanaBV(BV_DASH); await corre(tab, hrBvBuscar, [cq.q]).catch(() => {}); }
      const a = await corre(tab, hrBvAbrir, [x.i], "MAIN").catch((e) => ({ error: e.message }));
      if (!a || !a.url || vistos.has(a.url)) continue;
      vistos.add(a.url);
      await chrome.tabs.update(tab, { url: a.url }); await sleep(1500);
      for (let i = 0; i < 60; i++) { const z = await chrome.tabs.get(tab).catch(() => null); if (!z || z.status === "complete") break; await sleep(400); }
      const rep = await corre(tab, hrBvReporte).catch((e) => ({ error: e.message }));
      if (!rep || rep.error) continue;
      const oc = rep.doms.filter((d) => d.state === "CA" && !/\bP\.?\s*O\.?\s*Box\b/i.test(d.street) && (zipOC(d.zip) || CIUDADES_OC.test(d.city)));
      const esa = casa ? rep.doms.find((d) => mismaCasa(d.street, casa)) : null;
      if (casa && !esa) continue; // otra persona con el mismo nombre: no tiene esa casa entre sus domicilios
      const exacta = esa || oc.find((d) => d.propia && d.transfer && fechas.some((f) => cerca(f, d.transfer)));
      const fam = rep.fallecido ? ((await corre(tab, hrBvParientes).catch(() => null)) || {}).lista || [] : [];
      const extra = cq.dueno !== c.dueno ? { porCoDueno: cq.dueno } : {};
      if (exacta) return { dom: exacta, confirmado: true, nombre: rep.nombre, fallecido: rep.fallecido, reporte: rep.url, parientes: fam, ...extra };
      const propia = oc.find((d) => d.propia);
      if (!mejor && (propia || oc[0])) mejor = { dom: propia || oc[0], confirmado: false, nombre: rep.nombre, fallecido: rep.fallecido, reporte: rep.url, parientes: fam, ...extra };
      if (!persona || x.p > persona.p) persona = { p: x.p, nombre: rep.nombre, fallecido: rep.fallecido, reporte: rep.url, parientes: fam, doms: rep.doms, quien: cq.dueno };
    }
    if (mejor) return mejor; // ya hay un domicilio en Orange County: no hace falta seguir buscando
  }
  if (mejor) return mejor;
  if (persona && persona.p >= 5) return { porNombre: true, persona };
  return { error: total ? `no salió nadie que encaje en BeenVerified (${consultas.length} búsqueda(s) por nombre)` : "BeenVerified no dio resultados para ningún nombre" };
}

// ---------- Paso 1c: casos que Prope sacó de Properant ----------
// Misma casa = mismo número y misma primera palabra de la calle ("20581 Sycamore Dr" = "20581 SYCAMORE DR")
const mismaCasa = (a, b) => { const n = (x) => String(x || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean); const x = n(a), y = n(b); return !!x[0] && x[0] === y[0] && (x[1] || "") === (y[1] || ""); };
async function traerDeProperant(hasta) {
  const { prCasos = {}, prConfig = {} } = await chrome.storage.local.get(["prCasos", "prConfig"]);
  const nuevos = Object.values(prCasos).filter((p) => p.activo !== false && (p.hecm || prConfig.conRuido) && !p.pasadoAHeri && p.dueno && p.street);
  if (!nuevos.length) return 0;
  await ponerPasos({ paso: 1 });
  svLog && svLog(`Heri: Prope me pasó ${nuevos.length} caso(s) de Properant. Los reviso en el registro.`);
  const { hrRec = {} } = await chrome.storage.local.get("hrRec");
  let n = 0, i = 0;
  const refrescar = []; // ya estaban en el brazo: solo se les actualiza la ficha (no se vuelven a buscar)
  for (const p of nuevos) {
    if (parar) break;
    i++;
    const prev = hrRec[p.dueno];
    let res = prev && Date.now() - prev.t < REC_VIGENCIA && !(prev.res && prev.res.probate === undefined) ? prev.res : undefined;
    if (res === undefined && tokens(p.dueno).length >= 2) {
      ver(`Paso 1c · Registro: revisando a ${p.dueno} (Properant, ${i} de ${nuevos.length})…`);
      window.robot && robot.set("trabajando", `Paso 1c: revisando en el registro a ${p.dueno} (de Properant)…`);
      try { const h = await historialDe(p.dueno, hasta); res = clasificar(p.dueno, h.filas); hrRec[p.dueno] = { t: Date.now(), res }; await chrome.storage.local.set({ hrRec }); }
      catch (e) { res = null; }
      await pausaRec();
    }
    const { prCasos: pc = {} } = await chrome.storage.local.get("prCasos");
    const pp = pc[p.id] || p;
    const { hrCasos = {} } = await chrome.storage.local.get("hrCasos");
    // ¿Ya tengo este caso? Con el mismo nombre, o con el mismo apellido y nombre (y la misma casa, si ya la sé)
    const llaves = Object.keys(hrCasos);
    const llave = hrCasos[p.dueno] ? p.dueno
      : llaves.find((k) => esDe(k, [p.dueno]) && esDe(p.dueno, [k]) && (!hrCasos[k].street || mismaCasa(hrCasos[k].street, p.street))) || p.dueno;
    const c = hrCasos[llave] || { t: Date.now(), estado: "registro" };
    // El mismo caso guardado antes con otro nombre (p. ej. el del Estate en vez del nombre del aviso): se junta y se borra el repetido
    for (const k of llaves) {
      const x = hrCasos[k];
      if (k === llave || !x.prop || x.prop.id !== p.id) continue;
      if (x.estado === "brazo") c.estado = "brazo";
      delete hrCasos[k];
      svLog && svLog(`Heri: “${k}” y “${llave}” son el mismo caso (${p.street}); lo dejo como ${llave}.`);
    }
    if (res && res.recon && res.recon.length) { // el registro dice que esa hipoteca inversa ya se pagó
      pp.pasadoAHeri = Date.now(); pp.heriNota = "pagada en el registro (reconveyance)"; pc[p.id] = pp;
      await chrome.storage.local.set({ prCasos: pc, hrCasos }); continue;
    }
    const base = res || (c.origen ? c : null); // lo que diga el registro, de ahora o de antes
    // Lender: el del registro; si no, el de la hipoteca inversa en Properant (el "foreclosing lender" a veces es el trustee)
    const revLender = ((p.hipotecas || []).find((h) => /reverse|hecm/i.test(h.tipo) && h.lender && !/HOUSING|\bHUD\b|COMMISSIONER|UNITED STATES/i.test(h.lender)) || {}).lender || "";
    const lender = (base && base.lender) || revLender || p.fcLender || "HECM (Properant)";
    let cl = celinkDe(base || { lender });
    if (!cl.celink && p.pasoAHud) cl = { celink: true, celinkMotivo: "pasó a HUD (Properant): Celink administra las HECM de HUD" };
    const etapaNts = /auction|sale|trustee/i.test(p.etapa || "");
    // ¿BeenVerified dijo que falleció? (en lo guardado antes de esta versión solo se sabe si se buscó a sus familiares)
    const bv = c.fallecidoBV !== undefined ? !!c.fallecidoBV : (c.prop ? c.parientes !== undefined && !!c.fallecido : !!c.fallecido);
    Object.assign(c, { dueno: llave, todos: [...new Set([...(c.todos || []), ...(p.todos || [])])].slice(0, 6), ...(res || {}), lender, celink: cl.celink, celinkProbable: !!cl.probable, celinkMotivo: cl.celinkMotivo,
      nod: /^\d/.test(c.nod || "") ? c.nod : (p.avisoMdy && !etapaNts ? `Properant (${p.avisoMdy})` : c.nod || ""),
      nts: /^\d/.test(c.nts || "") ? c.nts : (etapaNts ? `Properant (${p.subastaMdy ? "remate " + p.subastaMdy : p.avisoMdy})` : c.nts || ""),
      aviso: c.aviso || p.avisoMdy || "", subasta: p.subastaMdy || c.subasta || "", monto: c.monto || (p.saldo ? `$${Math.round(p.saldo).toLocaleString("en-US")}` : ""),
      prop: { id: p.id, etapa: p.etapa, trustee: p.trustee, trusteeTel: p.trusteeTel, herederos: p.herederos || [], senalesEn: p.senalesEn || [], motivo: p.motivo, publicAdmin: !!p.publicAdmin, valor: p.valor || "", saldo: p.saldo || "", puja: p.puja || "", subastaPasada: !!p.subastaPasada },
      fallecidoProp: !!p.fallecido, fallecidoPor: p.fallecidoPor || "", fallecidoBV: bv, fallecido: bv || !!p.fallecido });
    // Domicilio: Properant tiene la casa con la hipoteca inversa y el aviso; gana sobre uno de BeenVerified sin confirmar
    if (!c.street || (!c.domConfirmado && !mismaCasa(c.street, p.street))) {
      if (c.street && c.estado === "brazo") { svLog && svLog(`Heri: ${llave}: BeenVerified me había dado ${c.dir}, pero la hipoteca inversa está en ${p.street}, ${p.city} (Properant). Mando el domicilio correcto.`); c.estado = "ubicada"; }
      Object.assign(c, { street: p.street, city: p.city, zip: p.zip, dir: `${p.street}, ${p.city}, CA ${p.zip}` });
    }
    if (mismaCasa(c.street, p.street)) c.domConfirmado = true;
    if (c.estado === "brazo") refrescar.push(c);
    else c.estado = (!cfg.soloCelink || c.celink) && cfg.herederos !== false && !c.bvIntento ? "registro" : "ubicada"; // Celink: una pasada por BeenVerified en ESA casa (¿vive el dueño? familia); lo demás no gasta BeenVerified
    hrCasos[llave] = c;
    await chrome.storage.local.set({ hrCasos });
    pp.pasadoAHeri = Date.now(); pp.heriNota = res ? "HECM en el registro" : "sin trust deed de HECM a ese nombre en el registro (se queda por Properant)";
    pc[p.id] = pp; await chrome.storage.local.set({ prCasos: pc });
    n++;
    decir(`De Properant: ${llave} · ${p.street}, ${p.city} · ${lender} · ${cl.celink ? "Celink: " : ""}${cl.celinkMotivo}${p.fallecido ? " · sucesión: " + (p.herederos || []).join(", ") : ""}.`);
    pintar();
  }
  if (refrescar.length) await domicilios("hecmInfo", { items: refrescar.map(itemDe) });
  return n;
}

// ---------- Paso 3: al brazo HECM (se llama cada vez que una queda lista) ----------
function itemDe(c) {
  const lender = c.celink ? `Celink / Compu-Link${c.celinkProbable ? " (probable)" : ""}` : c.lender;
  return { street: c.street, city: c.city, zip: c.zip, county: "Orange", hecm: { lender, fecha: c.aviso, monto: c.monto || "", subasta: c.subasta || "", pwId: c.pwId,
    dueno: c.dueno, nod: c.nod, nts: c.nts, subst: c.subst, asignadaHud: c.asignadaHud, origen: c.origen, celink: !!c.celink, celinkMotivo: c.celinkMotivo || "",
    fallecido: !!c.fallecido, ...(c.fallecidoBV !== undefined ? { fallecidoBV: !!c.fallecidoBV } : {}), fallecidoPor: c.fallecidoPor || "",
    domConfirmado: !!c.domConfirmado, probate: c.probate || null, parientes: c.parientes || [], parientesResto: c.parientesResto || [], parientesNota: c.parientesNota || "",
    properant: c.prop ? { id: c.prop.id, etapa: c.prop.etapa, trustee: c.prop.trustee, trusteeTel: c.prop.trusteeTel, herederos: c.prop.herederos, senalesEn: c.prop.senalesEn || [], publicAdmin: !!c.prop.publicAdmin, valor: c.prop.valor || "", saldo: c.prop.saldo || "", puja: c.prop.puja || "", subastaPasada: !!c.prop.subastaPasada } : null,
    avisoOtro: c.avisoOtro || "", preNod: !!c.preNod, muerte: c.muerte || "" } };
}
async function mandarAlBrazo() {
  const { hrCasos = {}, hrVistos = {} } = await chrome.storage.local.get(["hrCasos", "hrVistos"]);
  const listas = Object.values(hrCasos).filter((c) => c.estado === "ubicada" && c.street && (!cfg.soloCelink || c.celink));
  const items = listas.map((c) => itemDe(c));
  if (!items.length) return 0;
  // Fase 1: primero se entregan al brazo y SOLO si se pudo se marcan "brazo" (antes se marcaban antes y, si fallaba, se perdían)
  try { await domicilios("hecm", { items }); }
  catch (e) { svLog && svLog(`Heri: no pude pasar ${items.length} HECM al brazo (${e.message}); se quedan como “ubicada” para el siguiente intento.`, "error"); return 0; }
  const fresco = (await chrome.storage.local.get("hrCasos")).hrCasos || hrCasos; // releer: otro paso pudo cambiarlo mientras tanto
  listas.forEach((c, i) => {
    const it = items[i];
    fresco[c.dueno] = { ...(fresco[c.dueno] || c), estado: "brazo" };
    hrVistos[c.dueno] = { t: Date.now(), dir: c.dir, lender: it.hecm.lender, hecm: true, doc: c.nod ? "NOD" : "NTS", fecha: c.aviso, monto: c.monto || "", subasta: c.subasta || "", owner: c.dueno, url: c.url || "" };
  });
  await chrome.storage.local.set({ hrCasos: fresco, hrVistos });
  if (items.length) svLog && svLog(`Heri: mandé ${items.length} HECM al brazo (Chequi 3): ${items.map((x) => x.hecm.dueno).join(", ")}.`);
  return items.length;
}

// ---------- Paso 2a: la casa en Properant (por nombre), antes que BeenVerified ----------
// Properant busca por nombre del dueño y da la casa con la hipoteca inversa: sin el riesgo de la casa de otra persona con el mismo nombre.
async function hrPestanaPR() {
  const { prTab } = await chrome.storage.local.get("prTab");
  if (prTab) {
    const t = await chrome.tabs.get(prTab).catch(() => null);
    if (t && /properant\.com/.test(t.url || "")) { const vid = await ventanaTrabajo("hecm"); if (t.windowId !== vid) await chrome.tabs.move(t.id, { windowId: vid, index: -1 }).catch(() => {}); return t.id; }
  }
  const t = await abrirPestana("https://properant.com/dashboard", "hecm");
  await chrome.storage.local.set({ prTab: t.id }); await sleep(2500);
  return t.id;
}
async function ubicarEnProperant() {
  if (!window.PR) return 0;
  const { hrCasos = {} } = await chrome.storage.local.get("hrCasos");
  const lista = Object.values(hrCasos).filter((c) => !c.street && (!cfg.soloCelink || c.celink) && tokens(c.dueno).length >= 2 && !(c.prIntento && Date.now() - c.prIntento < 7 * 864e5));
  if (!lista.length) return 0;
  let tab; try { tab = await hrPestanaPR(); } catch (e) { return 0; }
  const { prCasos = {} } = await chrome.storage.local.get("prCasos");
  let n = 0;
  for (const c of lista) {
    if (parar) break;
    ver(`Paso 2 · Properant: buscando la casa de ${c.dueno}…`);
    window.robot && robot.set("trabajando", `Paso 2: buscando en Properant la casa de ${c.dueno}…`);
    const r = await corre(tab, PR.buscarNombre, [c.dueno], "MAIN").catch(() => null);
    if (!r || r.sesion || r.lento) { decir(r && r.sesion ? "Properant no me dejó entrar (sesión o prueba vencida): sigo con BeenVerified." : "Properant no respondió: sigo con BeenVerified.", "error"); break; }
    const cand = (r.lista || []).filter((x) => esDe(c.dueno, String(x.owner).split(/\s*&\s*/))).slice(0, 3);
    let hallado = null;
    for (const x of cand) {
      await sleep(2000 + Math.random() * 1500);
      const f = await corre(tab, PR.leerFicha, [x.id], "MAIN").catch(() => null);
      if (f && f.item && PR.tieneHecm(f.item)) { hallado = f.item; break; }
    }
    const { hrCasos: hc = {} } = await chrome.storage.local.get("hrCasos");
    if (hc[c.dueno]) { hc[c.dueno].prIntento = Date.now(); await chrome.storage.local.set({ hrCasos: hc }); }
    if (hallado) {
      const caso = PR.armarCaso(hallado);
      prCasos[caso.id] = { ...(prCasos[caso.id] || {}), ...caso, dueno: c.dueno, hecm: true, v: 2, leida: Date.now(), activo: true, deHeri: true };
      delete prCasos[caso.id].pasadoAHeri;
      n++;
      svLog && svLog(`Heri: Properant tiene la casa de ${c.dueno}: ${hallado.street}, ${hallado.city}.`);
    } else svLog && svLog(`Heri: Properant no tiene una casa con hipoteca inversa a nombre de ${c.dueno}; la busco en BeenVerified.`);
    await sleep(2000 + Math.random() * 1500);
  }
  await chrome.storage.local.set({ prCasos });
  return n;
}
// Si Properant dice que el remate es de OTRO préstamo (p. ej. un HELOC), el caso no es de Celink aunque haya hipoteca inversa
async function marcarOtroPrestamo() {
  const { prCasos = {}, hrCasos = {} } = await chrome.storage.local.get(["prCasos", "hrCasos"]);
  const refrescar = [];
  for (const p of Object.values(prCasos)) {
    if (p.activo === false || p.hecm !== false || !p.dueno) continue;
    const k = Object.keys(hrCasos).find((x) => esDe(x, [p.dueno]) && esDe(p.dueno, [x]) && (!hrCasos[x].street || mismaCasa(hrCasos[x].street, p.street)));
    const c = k && hrCasos[k];
    if (!c || c.avisoOtro) continue;
    c.avisoOtro = `el remate es de otro préstamo (${p.fcLender || "otro acreedor"}), no de la hipoteca inversa`;
    c.celink = false; c.celinkProbable = false; c.celinkMotivo = c.avisoOtro;
    if (c.estado === "brazo") refrescar.push(c);
    svLog && svLog(`Heri: ${k}: ${c.avisoOtro}. No es de Celink; le quito la marca.`);
  }
  await chrome.storage.local.set({ hrCasos });
  if (refrescar.length) await domicilios("hecmInfo", { items: refrescar.map(itemDe) });
}

// ---------- Trabajo ----------
async function trabajar(aMano, opts = {}) {
  if (corriendo) { if (opts.soloProp) chrome.storage.local.set({ prPideHeri: Date.now() }); return; }
  guardarCfg();
  corriendo = true; parar = false; $("run").disabled = true;
  window.robot && robot.set("trabajando", "Paso 1: revisando el registro de Orange County…");
  let tabPw = null, volver = null, alBrazoN = 0;
  try {
    const hastaD = new Date(), desdeD = new Date(Date.now() - cfg.dias * 864e5);
    const desde = mdy(desdeD), hasta = mdy(hastaD);
    if (!opts.soloProp) await chrome.storage.local.set({ hrDia: hoy() });
    await chrome.storage.local.remove("prPideHeri");
    await ponerPasos({ dias: cfg.dias, avisos: 0, duenos: 0, revisados: 0, hecm: 0, conDomicilio: 0, celink: 0, alBrazo: 0, paso: 1, inicio: Date.now() });
    // ---- Paso 1: registro ----
    const avisos = opts.soloProp ? [] : await avisosRecientes(desde, hasta);
    if (!opts.soloProp && cfg.muertes !== false && !parar) { // Paso 1b: muertes recientes (antes del NOD)
      const m = await avisosRecientes(mdy(new Date(Date.now() - (cfg.diasMuertes || 30) * 864e5)), hasta, TIPOS_MUERTE);
      avisos.push(...m);
      svLog && svLog(`Heri: en el registro hay ${m.length} documento(s) de muerte/sucesión de los últimos ${cfg.diasMuertes || 30} días; reviso si esas personas tienen hipoteca inversa.`);
    }
    if (parar) { decir("Detenido en el paso 1."); return; }
    const duenos = new Map();
    for (const a of avisos) {
      const n = nombreDueno(a.gr); if (!n || tokens(n).length < 2) continue;
      const prev = duenos.get(n);
      if (!prev) duenos.set(n, { dueno: n, todos: a.gr, avisos: [a] }); else prev.avisos.push(a);
    }
    await ponerPasos({ duenos: duenos.size });
    svLog && svLog(`Heri: en el registro hay ${avisos.length} aviso(s) de ejecución de los últimos ${cfg.dias} días (${duenos.size} dueños). Reviso a cada uno.`);
    const { hrRec = {} } = await chrome.storage.local.get("hrRec");
    let revisados = 0, hecmN = 0;
    for (const w of duenos.values()) {
      if (parar) break;
      revisados++;
      const prev = hrRec[w.dueno];
      let res = prev && Date.now() - prev.t < REC_VIGENCIA && !(prev.res && prev.res.probate === undefined) ? prev.res : undefined; // los viejos sin probate se vuelven a leer
      if (res === undefined) {
        ver(`Paso 1 · Registro: revisando a ${w.dueno} (${revisados} de ${duenos.size})…`);
        const h = await historialDe(w.dueno, hasta);
        res = clasificar(w.dueno, h.filas);
        hrRec[w.dueno] = { t: Date.now(), res };
        const ks = Object.keys(hrRec); if (ks.length > 4000) ks.sort((a, b) => hrRec[a].t - hrRec[b].t).slice(0, ks.length - 4000).forEach((k) => delete hrRec[k]);
        await chrome.storage.local.set({ hrRec });
        await pausaRec();
      }
      if (res && !res.recon.length) {
        hecmN++;
        const { hrCasos = {} } = await chrome.storage.local.get("hrCasos");
        const nod = w.avisos.find((a) => a.tipo === "NOD"), nts = w.avisos.find((a) => a.tipo === "NTS"), mu = w.avisos.find((a) => a.tipo === "MUERTE");
        const c = hrCasos[w.dueno] || { t: Date.now(), estado: "registro" };
        const cl = celinkDe(res);
        Object.assign(c, { dueno: w.dueno, todos: w.todos, ...res, celink: cl.celink, celinkProbable: !!cl.probable, celinkMotivo: cl.celinkMotivo,
          nod: nod ? `${nod.doc} (${nod.dt})` : c.nod || "", nts: nts ? `${nts.doc} (${nts.dt})` : c.nts || "", aviso: (nod || nts || w.avisos[0]).dt,
          ...(mu ? { muerte: `${mu.ty} ${mu.doc} (${mu.dt})`, preNod: !nod && !nts && !c.nod && !c.nts } : {}) });
        hrCasos[w.dueno] = c;
        await chrome.storage.local.set({ hrCasos });
        decir(`Hipoteca inversa en el registro${c.preNod ? " (todavía SIN aviso de ejecución: el dueño murió)" : ""}: ${w.dueno} · ${res.lender}${res.asignadaHud ? ` · pasó a HUD ${res.asignadaHud}` : ""} · ${cl.celink ? "Celink: " : ""}${cl.celinkMotivo}.`);
      }
      await ponerPasos({ revisados, hecm: hecmN });
      pintar();
    }
    if (parar) { decir(`Detenido en el paso 1 (revisé ${revisados} de ${duenos.size} dueños; ${hecmN} con hipoteca inversa).`); return; }

    // ---- Paso 1c: lo que Prope sacó de Properant ----
    const deProp = await traerDeProperant(hasta);
    if (deProp) hecmN += deProp;
    alBrazoN += await mandarAlBrazo(); // los que ya tienen domicilio no esperan a BeenVerified
    if (parar) { decir(`Detenido en el paso 1 (Properant).`); return; }

    { // los casos guardados antes de la regla de Celink se vuelven a evaluar
      const { hrCasos = {} } = await chrome.storage.local.get("hrCasos");
      for (const c of Object.values(hrCasos)) if (c.celinkMotivo === undefined) { const cl = celinkDe(c); c.celink = cl.celink; c.celinkProbable = !!cl.probable; c.celinkMotivo = cl.celinkMotivo; }
      await chrome.storage.local.set({ hrCasos });
    }
    await marcarOtroPrestamo();
    // ---- Paso 2a: la casa en Properant ----
    await ponerPasos({ paso: 2 });
    if (await ubicarEnProperant()) { await traerDeProperant(hasta); alBrazoN += await mandarAlBrazo(); }
    // ---- Paso 2: BeenVerified (en la casa ya conocida, o por nombre si nadie la tiene) ----
    const { hrCasos: casos0 = {} } = await chrome.storage.local.get("hrCasos");
    const porUbicar = Object.values(casos0).filter((c) => (c.estado === "registro" || (c.estado === "sinDomicilio" && !c.bvAmpliado)) && (!cfg.soloCelink || c.celink)); // solo Celink gasta BeenVerified
    let buscadas = 0;
    for (const c of porUbicar) {
      if (parar) break;
      if (buscadas >= cfg.tope) { decir(`Busqué ${cfg.tope} dueños en BeenVerified en esta vuelta; los demás quedan para la próxima.`); break; }
      if (buscadas) await esperar(20000 + Math.random() * 20000, "Pausa entre búsquedas de BeenVerified (ritmo humano)");
      if (parar) break;
      buscadas++;
      window.robot && robot.set("trabajando", `Paso 2: buscando a ${c.dueno} en BeenVerified…`);
      ver(`Paso 2 · BeenVerified: buscando el domicilio de ${c.dueno} (${buscadas} de ${Math.min(porUbicar.length, cfg.tope)})…`);
      const u = await ubicarEnBV(c);
      const { hrCasos = {} } = await chrome.storage.local.get("hrCasos");
      const cc = hrCasos[c.dueno]; if (!cc) continue;
      cc.bvIntento = Date.now(); cc.bvAmpliado = Date.now();
      if (u.alto) { decir(`${u.alto}. Resuélvelo y dale otra vez a Heri.`, "error"); await chrome.storage.local.set({ hrCasos }); break; }
      if (u.dom) {
        if (cc.prop && cc.street) Object.assign(cc, { fallecido: !!u.fallecido || !!cc.fallecidoProp, fallecidoBV: !!u.fallecido, bvNombre: u.nombre, bvReporte: u.reporte, estado: "ubicada" }); // el domicilio de Properant se queda
        else Object.assign(cc, { street: u.dom.street, city: u.dom.city, zip: u.dom.zip, dir: `${u.dom.street}, ${u.dom.city}, CA ${u.dom.zip}`,
          domConfirmado: u.confirmado, fallecido: !!u.fallecido, fallecidoBV: !!u.fallecido, bvNombre: u.nombre, bvReporte: u.reporte, estado: "ubicada" });
        svLog && svLog(`Heri: ${c.dueno} → ${cc.dir}${u.confirmado ? " (la casa se compró/transfirió el mismo día que la HECM: confirmado)" : " (sin confirmar con la fecha de la HECM)"}${u.fallecido ? " · el dueño aparece como fallecido" : ""}.`);
        if (u.fallecido && cfg.herederos !== false && !parar) {
          if (!(u.parientes || []).length) { cc.parientes = []; cc.parientesNota = "BeenVerified no muestra familiares; quedan los que viven en la casa (Veri 3) y el obituario"; }
          else {
            await esperar(8000 + Math.random() * 8000, "Pausa antes de buscar a los familiares");
            const f = await contactarParientes(cc, u.reporte, u.parientes);
            cc.parientes = f.contactados; cc.parientesResto = f.resto;
            const conTel = f.contactados.filter((p) => p.vivo !== false && p.tels.length);
            svLog && svLog(`Heri: familiares de ${c.dueno}: ${f.contactados.map((p) => `${p.nombre} (${p.relEs}${p.edad ? ", " + p.edad : ""}${p.vivo === false ? ", fallecido" : ""}${p.tels.length ? `, ${p.tels.length} tel.` : ""})`).join(" · ") || "ninguno vivo"}${conTel.length ? "" : " · sin teléfonos"}.`);
          }
        }
      } else if (u.porNombre) {
        // Sin domicilio en Orange County, pero sí encontré a la persona: teléfonos (si vive) o familiares (si falleció)
        const p = u.persona;
        Object.assign(cc, { estado: "porNombre", bvNombre: p.nombre, bvReporte: p.reporte, fallecido: !!p.fallecido || !!cc.fallecidoProp, fallecidoBV: !!p.fallecido, porNombreDe: p.quien,
          otrosDoms: (p.doms || []).filter((d) => d.state === "CA").slice(0, 3).map((d) => `${d.street}, ${d.city}, CA ${d.zip}`) });
        if (p.fallecido && cfg.herederos !== false && (p.parientes || []).length && !parar) {
          await esperar(8000 + Math.random() * 8000, "Pausa antes de buscar a los familiares");
          const f = await contactarParientes(cc, p.reporte, p.parientes);
          cc.parientes = f.contactados; cc.parientesResto = f.resto;
        } else if (!p.fallecido && !parar) {
          const tab = await pestanaBV(p.reporte);
          const r = await corre(tab, hrBvContacto).catch(() => null);
          cc.telsDueno = (r && r.tels) || [];
        }
        if (cc.prop && cc.street) cc.estado = "ubicada"; // ya tiene domicilio (Properant): sigue al brazo con lo que se encontró
        const n = (cc.telsDueno || []).length + (cc.parientes || []).filter((x) => x.vivo !== false && x.tels.length).length;
        svLog && svLog(`Heri: ${c.dueno}: BeenVerified no da el domicilio de la casa, pero lo encontré por nombre (${p.nombre}${p.fallecido ? ", fallecido" : ""}${p.quien !== c.dueno ? `, buscando a ${p.quien}` : ""}): ${n ? `${n} contacto(s) con teléfono` : "sin teléfonos"}.`);
      } else if (cc.prop && cc.street) { cc.estado = "ubicada"; cc.bvError = u.error || ""; } // BeenVerified no lo encontró, pero Properant ya dio el domicilio
      else { cc.estado = "sinDomicilio"; cc.bvError = u.error || ""; }
      hrCasos[c.dueno] = cc;
      await chrome.storage.local.set({ hrCasos }); pintar();
      if (cc.estado === "ubicada") alBrazoN += await mandarAlBrazo(); // en cuanto queda lista, a Chequi 3
    }

    // ---- Paso 3: al brazo HECM ----
    await ponerPasos({ paso: 3 });
    alBrazoN += await mandarAlBrazo();
    const { hrCasos = {} } = await chrome.storage.local.get("hrCasos");
    const todos = Object.values(hrCasos);
    await ponerPasos({ paso: 0, conDomicilio: todos.filter((c) => c.street).length, celink: todos.filter((c) => c.celink).length, alBrazo: todos.filter((c) => c.estado === "brazo").length, fin: Date.now() });
    const sinDom = todos.filter((c) => c.estado === "sinDomicilio").length;
    const porNom = todos.filter((c) => c.estado === "porNombre" && ((c.telsDueno || []).length || (c.parientes || []).some((p) => p.vivo !== false && p.tels.length))).length;
    const txt = `${parar ? "Detenido. " : "Listo: "}${hecmN} hipoteca(s) inversa(s) en el registro; ${alBrazoN} nueva(s) al brazo HECM (Chequi 3 → herederos → Lofti, que espera tu OK).` +
      (porNom ? ` ${porNom} sin domicilio de la casa pero con teléfonos encontrados por nombre (están en la lista de Heri).` : "") +
      (sinDom ? ` ${sinDom} sin domicilio en BeenVerified (salen en la lista para que las veas).` : "") + (cfg.soloCelink ? " Solo paso las que tienen Celink/Compu-Link confirmado." : "");
    decir(txt);
    window.robot && robot.set(alBrazoN ? "feliz" : "idle", txt);
  } catch (e) {
    decir(`Heri falló: ${e.message}`, "error");
  } finally {
    corriendo = false; $("run").disabled = false;
    if (volver) await volver();
    pintar();
    if (!parar) chrome.storage.local.get("prPideHeri").then(({ prPideHeri }) => { if (prPideHeri) setTimeout(() => { if (!corriendo) trabajar(true, { soloProp: true }); }, 5000); }); // Prope dejó casos mientras trabajaba
  }
}

// ---------- Pantalla ----------
const ETIQ = { registro: "por buscar en BeenVerified", sinDomicilio: "sin domicilio en BeenVerified", porNombre: "sin domicilio · contactos por nombre", porFicha: "ubicada", ubicada: "ubicada", brazo: "en el brazo HECM" };
async function pintar() {
  const { hrCasos = {}, hrPasos = {}, addresses = {} } = await chrome.storage.local.get(["hrCasos", "hrPasos", "addresses"]);
  const c = Object.values(hrCasos).sort((a, b) => fecha(b.aviso || "1/1/2000") - fecha(a.aviso || "1/1/2000"));
  $("nAvisos").textContent = hrPasos.avisos || 0;
  $("nRev").textContent = `${hrPasos.revisados || 0}/${hrPasos.duenos || 0}`;
  $("nHecm").textContent = c.length;
  $("nDom").textContent = c.filter((x) => x.street).length;
  $("nCelink").textContent = c.filter((x) => x.celink).length;
  $("nBrazo").textContent = c.filter((x) => x.estado === "brazo").length;
  document.querySelectorAll("[data-paso]").forEach((e) => e.classList.toggle("activo", corriendo && String(hrPasos.paso) === e.dataset.paso));
  if (!c.length) { $("lista").innerHTML = `<li class="empty">Aquí salen las hipotecas inversas con aviso de ejecución que encuentre.</li>`; return; }
  const enBrazo = (x) => {
    if (!x.street) return "";
    const a = Object.values(addresses).find((d) => d.origen === "hecm" && `${d.street}|${d.city}`.toLowerCase() === `${x.street}|${x.city}`.toLowerCase());
    if (!a) return "";
    if (a.lofty === "si") return " · ya estaba en Lofty";
    return a.bvSearched ? " · herederos buscados" : a.lofty === "no" ? (a.via === "wb" ? " · con Wibi 3" : " · con Veri 3") : " · en Chequi 3";
  };
  $("lista").innerHTML = c.map((x) => `<li><b>${esc(x.dueno)}</b> ${x.preNod ? `<span class="tag" title="${esc(x.muerte || "")}">antes del NOD</span> ` : ""}${x.prop ? `<span class="tag gris" title="${esc((x.prop.herederos || []).join(" · ") || "de Properant")}">Properant</span> ` : ""}${x.celink ? `<span class="tag" title="${esc(x.celinkMotivo || "")}">Celink${x.celinkProbable ? "?" : ""}</span>` : `<span class="tag gris" title="servicer sin confirmar">${esc(corto(x.lender))}</span>`}
    <small>${x.dir ? esc(x.dir) : "<i>sin domicilio todavía</i>"}${x.dir ? (x.domConfirmado ? " ✓" : " (sin confirmar)") : ""}${x.fallecido ? " · dueño fallecido" : ""}${x.probate && x.probate.abierto ? " · probate en el registro" : x.probate && (x.probate.representantes.length || x.probate.docs.length) ? " · docs de sucesión" : ""}${x.probate && x.probate.familia.length ? ` · familia: ${esc(x.probate.familia.slice(0, 2).join(", "))}` : ""}${(x.telsDueno || []).length ? ` · ${esc(x.telsDueno.map((t) => `(${t.num.slice(0, 3)}) ${t.num.slice(3, 6)}-${t.num.slice(6)}${t.tipo ? " " + t.tipo : ""}`).join(", "))}` : ""}${x.estado === "porNombre" && (x.otrosDoms || []).length ? ` · otros domicilios en CA: ${esc(x.otrosDoms.join(" / "))}` : ""}${(x.parientes || []).length ? ` · ${esc(x.parientes.filter((p) => p.vivo !== false).map((p) => `${p.nombre.split(" ")[0]} (${p.relEs}${p.tels.length ? " " : ""})`).join(", ") || "familiares fallecidos")}` : ""} · ${esc(ETIQ[x.estado] || x.estado)}${esc(enBrazo(x))}</small>
    <small>${esc([x.nod && `NOD ${x.nod}`, x.nts && `NTS ${x.nts}`, x.origen && `HECM desde ${x.origen}`, x.asignadaHud && `pasó a HUD ${x.asignadaHud}`, x.subst && x.subst.length && `Substitution ${x.subst.join(", ")}`, x.monto && `debe ${x.monto}`].filter(Boolean).join(" · "))}</small></li>`).join("");
}
$("run").onclick = () => trabajar(true);
$("stop").onclick = () => { parar = true; ver("Parando…"); };
$("olvidar").onclick = async () => {
  await chrome.storage.local.set({ hrRec: {} });
  ver("Listo: la próxima vuelta busco otra vez en el registro a todos los dueños.");
};
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && (ch.hrCasos || ch.addresses || ch.hrPasos)) pintar(); });
window.hrTrabajar = trabajar; // Capi
// Una vez al día, si "Buscar solo" está prendido
setInterval(async () => { const { hrDia } = await chrome.storage.local.get("hrDia"); if (cfg.auto && hrDia !== hoy() && !corriendo) trabajar(false); }, 30 * 60 * 1000);
(async () => {
  await cargarCfg();
  await pintar();
  const { hrDia } = await chrome.storage.local.get("hrDia");
  if (cfg.auto && hrDia !== hoy()) setTimeout(() => trabajar(false), 8000);
  const { prPideHeri } = await chrome.storage.local.get("prPideHeri"); // Prope dejó casos mientras Heri estaba cerrado u ocupado
  if (prPideHeri) setTimeout(() => trabajar(true, { soloProp: true }), 15000);
})();
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.prPideHeri && ch.prPideHeri.newValue && !corriendo) setTimeout(() => { if (!corriendo) trabajar(true, { soloProp: true }); }, 3000); });

// ---------- Fase 2b: acciones grandes por el bus de tareas (registro.js). Sin entrada, usan lo que ya está escrito en la pantalla. ----------
window.Tareas && Tareas.atender("buscar", async ({ dias, tope } = {}) => {
  await Tareas.esperarLibre(() => corriendo);
  if (dias) $("dias").value = String(dias);
  if (tope) $("tope").value = String(tope);
  await trabajar(true);
  return $("status").textContent.trim() || "Vuelta terminada.";
}, { alCancelar: () => { parar = true; } });
