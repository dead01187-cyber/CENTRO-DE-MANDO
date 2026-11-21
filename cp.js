// =====================================================================
// Carpi: administra las listas ("carpetas") que Wibi y Wibi 3 crean en
// Propwire. Las cruza con el registro de Wibi y con My Activity, las
// agrupa por estado y borra las que ya no sirven:
//  · ya leídas (Wibi ya sacó los teléfonos) de más de N días
//  · que se quedaron sin skip trace (sus domicilios ya regresaron a Wibi)
// Nunca toca listas que no hizo Wibi ni una que Wibi esté usando.
// Borrar es para siempre: sin "Limpiar solo", pregunta antes.
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const DEF = { dias: 7, auto: false, ajenas: false, skipEnVezDeBorrar: true };
let cfg = { ...DEF }, corriendo = false;
const DE_WIBI = /^Wibi( 3)? \d{4}-\d{2}-\d{2} \d{4}(-\d+)?$/;
const EN_USO_MS = 3 * 3600e3; // una lista importada o con skip trace de hace menos de 3 h puede estar en uso

async function cargarCfg() { const { cpConfig = {} } = await chrome.storage.local.get("cpConfig"); cfg = { ...DEF, ...cpConfig }; $("dias").value = cfg.dias; $("auto").checked = !!cfg.auto; $("ajenas").checked = !!cfg.ajenas; }
function guardarCfg() { cfg = { ...cfg, dias: Math.max(0, parseInt($("dias").value, 10) || 0), auto: $("auto").checked, ajenas: $("ajenas").checked }; chrome.storage.local.set({ cpConfig: cfg }); }
["dias", "auto", "ajenas"].forEach((id) => ($(id).onchange = () => { guardarCfg(); pintar(); }));

// ---------- Corren DENTRO de Propwire ----------
function pwBloq() { return /acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)|temporarily (blocked|restricted)|unusual (traffic|activity)/i.test(document.body ? document.body.innerText : ""); }
async function pwLeerListas() {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 30 && !/Property Lists/.test(document.body.innerText); i++) await esp(300);
  await esp(800);
  if (/acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)/i.test(document.body.innerText)) return { bloqueo: true };
  if (/You haven't created any lists/i.test(document.body.innerText)) return { listas: [] };
  const listas = [];
  for (const a of document.querySelectorAll("a[href*='/property-lists/']")) {
    if (/\/import/.test(a.getAttribute("href"))) continue;
    const nombre = a.innerText.trim(); if (!nombre) continue;
    let fila = a; for (let i = 0; i < 6 && fila.parentElement && !fila.querySelector("input[type=checkbox]"); i++) fila = fila.parentElement;
    const m = fila.innerText.replace(nombre, "").match(/(\d+)\s+(\d{1,2}\/\d{1,2}\/\d{4})/);
    listas.push({ nombre, href: a.href, n: m ? +m[1] : 0, fecha: m ? m[2] : "" });
  }
  return { listas };
}
async function pwLeerActividad() {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 30 && !/My Activity/.test(document.body.innerText); i++) await esp(300);
  await esp(800);
  if (/acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)/i.test(document.body.innerText)) return { bloqueo: true };
  const L = document.body.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
  const imports = {}, lotes = [];
  L.forEach((l, i) => {
    let m = l.match(/^Import (\d+) Propert(?:y|ies) to (.+)$/i);
    if (m) { const sig = L[i + 1] || ""; imports[m[2].trim()] = { subidas: +m[1], ok: +((sig.match(/(\d+) Successfully Imported/i) || [])[1] || 0), noEncontradas: +((sig.match(/(\d+) propert(?:y|ies) not found/i) || [])[1] || 0) }; }
    m = l.match(/^Batch Skip Trace (\d+) Propert(?:y|ies) - (.+)$/i);
    if (m) lotes.push({ n: +m[1], fecha: m[2] });
  });
  return { imports, lotes };
}
async function pwBorrar(nombres) {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (e) => !!e && e.getClientRects().length > 0;
  for (let i = 0; i < 30 && !/Property Lists/.test(document.body.innerText); i++) await esp(300);
  await esp(1000);
  const marcadas = [];
  for (const nombre of nombres) {
    const a = [...document.querySelectorAll("a[href*='/property-lists/']")].find((x) => x.innerText.trim() === nombre);
    if (!a) continue;
    let fila = a; for (let i = 0; i < 6 && fila.parentElement && !fila.querySelector("input[type=checkbox]"); i++) fila = fila.parentElement;
    const cb = fila.querySelector("input[type=checkbox]"); if (!cb) continue;
    if (!cb.checked) { cb.click(); await esp(250 + Math.random() * 350); }
    if (cb.checked) marcadas.push(nombre);
  }
  if (!marcadas.length) return { borradas: [], error: "no encontré esas listas" };
  const sel = (document.body.innerText.match(/(\d+) Lists? Selected/i) || [])[1];
  if (+sel !== marcadas.length) return { error: `Propwire dice ${sel} seleccionadas y yo marqué ${marcadas.length}; no borro` };
  await esp(700 + Math.random() * 800);
  const del = [...document.querySelectorAll("button")].find((b) => visible(b) && b.innerText.trim() === "Delete");
  if (!del) return { error: "no encontré el botón Delete" };
  del.click();
  let ok = null;
  for (let i = 0; i < 20 && !ok; i++) {
    await esp(300);
    const tit = [...document.querySelectorAll("h1,h2,h3,div,span,p")].find((e) => !e.children.length && visible(e) && /^Delete Selected$/i.test(e.textContent.trim()));
    if (tit) { let caja = tit; while (caja.parentElement && !caja.querySelector("button")) caja = caja.parentElement; while (caja.parentElement && ![...caja.querySelectorAll("button")].some((b) => b.innerText.trim() === "Delete")) caja = caja.parentElement; ok = [...caja.querySelectorAll("button")].find((b) => visible(b) && b.innerText.trim() === "Delete"); }
  }
  if (!ok) return { error: "no salió la confirmación de borrar" };
  await esp(600 + Math.random() * 600);
  ok.click();
  for (let i = 0; i < 30; i++) { await esp(400); if (!marcadas.some((n) => [...document.querySelectorAll("a[href*='/property-lists/']")].some((x) => x.innerText.trim() === n))) break; }
  const quedan = marcadas.filter((n) => [...document.querySelectorAll("a[href*='/property-lists/']")].some((x) => x.innerText.trim() === n));
  return { borradas: marcadas.filter((n) => !quedan.includes(n)), quedan };
}


// =====================================================================
// SKIP TRACE A VARIAS LISTAS DE UN JALÓN (como lo haces a mano):
// marca las listas, "Skip Trace" en la barra, revisa la confirmación
// (solo créditos, nunca dinero), te pide tu OK con el número exacto,
// "Continue" → baja Propiedad + Skip Trace Results → lee el archivo en
// My Activity y manda owners y teléfonos a Lofti (mismas reglas de Wibi:
// sin compañías, sin litigators, los DNC sí pasan).
// =====================================================================
const RE_EMPRESA = /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|LP|LLP|LTD|PARTNERS(HIP)?|HOLDINGS?|PROPERTIES|INVESTMENTS?|BANK|CHURCH|ASSOCIATION|CITY OF|COUNTY OF|STATE OF|HOUSING|DEVELOPMENT)\b/i;

const creditos = (t) => {
  t = String(t || "");
  if (!/skip trace/i.test(t)) return null;
  const q = t.match(/remaining\s+([\d,]+)\s+skip/i);
  return { conCreditos: /Use Skip Trace Credits/i.test(t), quedan: q ? parseInt(q[1].replace(/,/g, ""), 10) : null, dinero: /\$\s*[\d,]*\.?\d*[1-9]/.test(t.replace(/\$\s*0+(\.0+)?(?![\d.,])/g, "")) };
};

const csvCampo = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const claveDom = (calle, zip) => `${String(calle || "").toUpperCase().replace(/[^A-Z0-9]/g, "")}|${String(zip || "").slice(0, 5)}`;
function leerCSV(texto) { // CSV con comillas
  const filas = []; let fila = [], campo = "", q = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (q) { if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') q = false; else campo += c; }
    else if (c === '"') q = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && texto[i + 1] === "\n") i++; fila.push(campo); campo = ""; if (fila.some((x) => x !== "")) filas.push(fila); fila = []; }
    else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); if (fila.some((x) => x !== "")) filas.push(fila); }
  const enc = filas.shift() || [];
  return filas.map((f) => Object.fromEntries(enc.map((h, i) => [h.trim(), (f[i] || "").trim()])));
}

async function pwLeerResultado(n, yaVistos) {
  const t = document.body.innerText;
  if (/acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)/i.test(t)) return { bloqueo: true };
  const re = new RegExp(`^Batch Skip Trace ${n} Propert(y|ies)`, "i");
  const links = [...document.querySelectorAll("a")].filter((a) => /^Download$/i.test(a.innerText.trim()));
  for (const a of links) {
    let caja = a; for (let i = 0; i < 6 && caja.parentElement && !re.test(caja.innerText.trim()); i++) caja = caja.parentElement;
    if (!re.test(caja.innerText.trim())) continue;
    if (yaVistos.includes(a.href)) continue; // uno viejo (ya leído o de otra lista): seguir buscando
    try {
      const r = await fetch(a.href, { credentials: "include" });
      const csv = await r.text();
      if (!/^Address,City/i.test(csv)) return { reintentar: true, status: r.status };
      return { csv, href: a.href };
    } catch (e) { return { reintentar: true }; }
  }
  return { noListo: true };
}

async function pwConfirmarYBajar(etiqueta) {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const b = [...document.querySelectorAll("button")].find((x) => visible(x) && x.innerText.replace(/\s+/g, " ").trim() === etiqueta);
  if (!b) return { error: `no encontré “${etiqueta}”` };
  b.click();
  let d = null;
  for (let i = 0; i < 60 && !d; i++) {
    await esp(500);
    if (/insufficient|add funds|not enough|top up/i.test(document.body.innerText)) return { sinSaldo: true };
    d = [...document.querySelectorAll("button")].find((x) => visible(x) && /^Download \d+ Propert(y|ies)$/i.test(x.innerText.trim()));
  }
  if (!d) { // en la página de listas puede no salir solo: se pide con "Download" de la barra (siguen seleccionadas)
    const bar = [...document.querySelectorAll("button")].find((x) => visible(x) && /^Download$/i.test(x.innerText.trim()));
    if (bar) { bar.click(); for (let i = 0; i < 20 && !d; i++) { await esp(400); d = [...document.querySelectorAll("button")].find((x) => visible(x) && /^Download \d+ Propert(y|ies)$/i.test(x.innerText.trim())); } }
  }
  if (!d) return { error: "no salió la ventana para bajar los resultados" };
  const lbl = [...document.querySelectorAll("label")].find((l) => /^Skip Trace Results$/i.test(l.innerText.trim()));
  const cb = lbl && (lbl.control || lbl.parentElement.querySelector("input[type=checkbox]"));
  if (cb && !cb.checked) { cb.click(); await esp(300); }
  await esp(700 + Math.random() * 900);
  d.click();
  for (let i = 0; i < 30; i++) { await esp(400); const x = [...document.querySelectorAll("button")].find((y) => visible(y) && /^Dismiss$/i.test(y.innerText.trim())); if (x) { x.click(); break; } }
  return { ok: true };
}

async function pwSeleccionarYSkip(nombres) {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (e) => !!e && e.getClientRects().length > 0;
  for (let i = 0; i < 30 && !/Property Lists/.test(document.body.innerText); i++) await esp(300);
  await esp(1000);
  if (/acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)/i.test(document.body.innerText)) return { bloqueo: true };
  const marcadas = [];
  for (const nombre of nombres) {
    const a = [...document.querySelectorAll("a[href*='/property-lists/']")].find((x) => x.innerText.trim() === nombre);
    if (!a) continue;
    let fila = a; for (let i = 0; i < 6 && fila.parentElement && !fila.querySelector("input[type=checkbox]"); i++) fila = fila.parentElement;
    const cb = fila.querySelector("input[type=checkbox]"); if (!cb) continue;
    if (!cb.checked) { cb.click(); await esp(250 + Math.random() * 350); }
    if (cb.checked) marcadas.push(nombre);
  }
  if (!marcadas.length) return { error: "no encontré las listas para marcar" };
  const sel = +((document.body.innerText.match(/(\d+) Lists? Selected/i) || [])[1] || 0);
  if (sel !== marcadas.length) return { error: `Propwire dice ${sel} seleccionadas y yo marqué ${marcadas.length}; no sigo` };
  await esp(700 + Math.random() * 800);
  const b = [...document.querySelectorAll("button")].find((x) => visible(x) && /^Skip Trace$/i.test(x.innerText.trim()));
  if (!b) return { error: "no encontré “Skip Trace” en la barra" };
  b.click();
  for (let i = 0; i < 40; i++) {
    await esp(400);
    const tit = [...document.querySelectorAll("h1, h2, h3, h4, div, span, p")].find((e) => !e.children.length && visible(e) && /^\s*Please Confirm\s*$/i.test(e.textContent));
    if (tit) {
      let caja = tit; while (caja.parentElement && !/New Credit Balance/i.test(caja.innerText)) caja = caja.parentElement;
      await esp(600);
      return { marcadas, dialogo: { texto: caja.innerText.replace(/\s+/g, " ").trim().slice(0, 500), botones: [...caja.querySelectorAll("button")].filter(visible).map((x) => x.innerText.replace(/\s+/g, " ").trim()).filter(Boolean) },
        pedidos: +((caja.innerText.match(/Total Skip Trace Requests\s*([\d,]+)/i) || [])[1] || "0").replace(/,/g, "") };
    }
  }
  return { error: "no salió la confirmación del skip trace" };
}
function pwCerrarDialogo() { const x = [...document.querySelectorAll("button")].find((b) => /^(×|x|close|cancel)$/i.test(b.innerText.trim()) || b.getAttribute("aria-label") === "Close"); if (x) x.click(); return !!x; }

async function skipVarias(nombresElegidos) {
  if (corriendo) return;
  const pz = await pausa(); if (pz) { ver("Propwire está en pausa por un bloqueo."); return; }
  const inv = (await pintar()).inv || [];
  const nombres = nombresElegidos || inv.filter((x) => x.c.skip).map((x) => x.l.nombre);
  if (!nombres.length) { ver("No hay listas pendientes de skip trace. Dale “Revisar listas” primero."); return; }
  corriendo = true; $("run").disabled = $("borrar").disabled = $("skip").disabled = true;
  window.robot && robot.set("trabajando", `Skip trace a ${nombres.length} lista(s)…`);
  try {
    if (!(await turno())) return;
    let tab = await pestana("https://propwire.com/property-lists");
    const s = await corre(tab, pwSeleccionarYSkip, [nombres]).catch((e) => ({ error: e.message }));
    if (s && s.bloqueo) { await bloqueado(); return; }
    if (!s || !s.dialogo) { decir(`No pude hacer el skip trace: ${(s && s.error) || "falló"}.`, "error"); return; }
    const cr = creditos(s.dialogo.texto);
    const pedidos = s.pedidos;
    if (!cr || !cr.conCreditos || cr.dinero) { await corre(tab, pwCerrarDialogo).catch(() => {}); decir(`Propwire quiere cobrar con dinero o sin créditos (“${s.dialogo.texto.slice(0, 140)}”). Carpi no acepta: hazlo tú si quieres.`, "error"); return; }
    if (cr.quedan !== null && cr.quedan < pedidos) { await corre(tab, pwCerrarDialogo).catch(() => {}); decir(`No alcanzan los créditos (${cr.quedan}) para ${pedidos} skip traces. No hice nada.`, "error"); return; }
    if (!(await preguntar(`Skip trace a ${s.marcadas.length} lista(s): ${pedidos} propiedades.\nUsa ${pedidos} créditos (te quedan ${cr.quedan != null ? cr.quedan.toLocaleString() : "?"}). Sin cobro de dinero.\n\n${s.marcadas.slice(0, 10).join("\n")}${s.marcadas.length > 10 ? `\n… y ${s.marcadas.length - 10} más` : ""}`, "Sí, hacer skip trace"))) {
      await corre(tab, pwCerrarDialogo).catch(() => {}); ver("No hice el skip trace."); return;
    }
    const cont = s.dialogo.botones.find((b) => /^continue$/i.test(b)) || "Continue";
    ver(`Skip trace de ${pedidos} propiedades en ${s.marcadas.length} lista(s)…`);
    const c = await corre(tab, pwConfirmarYBajar, [cont]).catch((e) => ({ error: e.message }));
    if (c && c.sinSaldo) { decir("Propwire dice que no hay saldo. No se hizo.", "error"); return; }
    if (!c || c.error) { decir(`El skip trace se mandó, pero: ${(c && c.error) || "falló al pedir el archivo"}. Revisa My Activity.`, "error"); return; }
    const { wbUso = {}, wbListas = {} } = await chrome.storage.local.get(["wbUso", "wbListas"]);
    await chrome.storage.local.set({ wbUso: { dia: new Date().toLocaleDateString("en-CA"), n: (wbUso.dia === new Date().toLocaleDateString("en-CA") ? wbUso.n || 0 : 0) + pedidos }, wbCreditos: { quedan: cr.quedan != null ? cr.quedan - pedidos : null, t: Date.now() } });
    for (const n of s.marcadas) wbListas[n] = { ...(wbListas[n] || { creada: Date.now(), linea: /^Wibi 3 /.test(n) ? "hr" : "" }), estado: "skip", t: Date.now(), porCarpi: true };
    await chrome.storage.local.set({ wbListas });
    // Esperar el archivo en My Activity y leerlo
    const { wbBajados = [] } = await chrome.storage.local.get("wbBajados");
    let res = null;
    for (let i = 0; i < 20; i++) {
      await sleep(i ? 20000 + Math.random() * 15000 : 10000);
      ver(`Esperando el archivo de resultados en My Activity (${i + 1})…`);
      if (!(await turno())) break;
      tab = await pestana("https://propwire.com/activity");
      res = await corre(tab, pwLeerResultado, [pedidos, wbBajados]).catch(() => null);
      if (res && res.bloqueo) { await bloqueado(); return; }
      if (res && res.csv) break;
    }
    if (!res || !res.csv) { decir(`El skip trace de ${pedidos} se hizo, pero Propwire no deja bajar el archivo. No se vuelve a cobrar: Wibi lee esas listas ficha por ficha en su próxima vuelta.`, "error"); return; }
    await chrome.storage.local.set({ wbBajados: [...wbBajados, res.href].slice(-50) });
    const r = await repartir(leerCSV(res.csv));
    const { wbListas: wl = {} } = await chrome.storage.local.get("wbListas");
    for (const n of s.marcadas) if (wl[n]) { wl[n].estado = "leida"; wl[n].t = Date.now(); wl[n].archivo = res.href; }
    await chrome.storage.local.set({ wbListas: wl });
    decir(`✓ Skip trace de ${pedidos} propiedades (${s.marcadas.length} listas): ${r.lofti} con teléfonos van a Lofti · ${r.empresas} compañías · ${r.litig} litigators · ${r.sinTel} sin teléfono.`);
    window.robot && robot.set("feliz", $("status").textContent);
  } catch (e) { decir(`Error en el skip trace de listas: ${e.message}`, "error"); }
  finally { corriendo = false; $("run").disabled = $("borrar").disabled = $("skip").disabled = false; }
}
// Reparte el archivo: a cada domicilio conocido lo marca y lo manda al lote de su Wibi; los que no conoce también van a Lofti
async function repartir(filas) {
  const { addresses = {}, lote_wb = [], lote_wb_hr = [] } = await chrome.storage.local.get(["addresses", "lote_wb", "lote_wb_hr"]);
  const porClave = new Map(Object.entries(addresses).map(([k, a]) => [claveDom(a.street, a.zip), { k, a }]));
  const r = { lofti: 0, empresas: 0, litig: 0, sinTel: 0 }, marcar = [];
  for (const f of filas) {
    const dom = porClave.get(claveDom(f["Address"], f["Zip"]));
    const nombre = f["Name 1"] || [f["Owner 1 First Name"], f["Owner 1 Last Name"]].filter(Boolean).join(" ");
    const bonito = nombre === nombre.toUpperCase() ? nombre.toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase()) : nombre;
    if (dom) marcar.push(dom.k);
    if (/^(COMPANY|CORPORATE|BUSINESS|GOVERNMENT)/i.test(f["Owner Type"] || "") || RE_EMPRESA.test(nombre)) { r.empresas++; continue; }
    if (f["Litigator"] && !/^(no|false|0)$/i.test(f["Litigator"])) { r.litig++; continue; }
    const phones = [];
    for (let i = 1; i <= 5; i++) {
      const num = String(f[`Phone ${i}`] || "").replace(/\D/g, "").slice(-10);
      if (num.length !== 10 || phones.some((p) => p.num === num)) continue;
      const ty = f[`Phone ${i} Type`] || "Phone";
      phones.push({ num, type: /land/i.test(ty) ? "Landline" : ty, ...(/dnc|yes|true|^1$/i.test(f[`Do Not ${i} Call`] || "") ? { dnc: true } : {}) });
    }
    if (!phones.length) { r.sinTel++; continue; }
    const tit = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase());
    const address = dom ? `${dom.a.street}, ${dom.a.city}, CA ${dom.a.zip || ""}`.trim() : `${tit(f["Address"])}, ${tit(f["City"])}, ${f["State"] || "CA"} ${f["Zip"] || ""}`.trim();
    const emails = String(f["Email"] || "").split(/[;,\s]+/).map((e) => e.toLowerCase()).filter((e) => /@/.test(e));
    const lote = dom && dom.a.origen === "hecm" ? lote_wb_hr : lote_wb;
    const ya = lote.find((x) => claveDom(x.address.split(",")[0], (x.address.match(/(\d{5})\s*$/) || [])[1]) === claveDom(f["Address"], f["Zip"]));
    if (ya) { for (const p of phones) if (!ya.phones.some((q) => q.num === p.num)) ya.phones.push(p); }
    else lote.push({ owner: bonito, phones, emails, address, url: f["Property URL"] || "", fuente: "propwire" });
    r.lofti++;
  }
  await chrome.storage.local.set({ lote_wb, lote_wb_hr });
  for (const k of marcar) await domicilios("marcar", { key: k, bvSearched: true });
  return r;
}

// Busca en My Activity el archivo de las listas que ya tienen skip trace pero Wibi no leyó, y lo reparte
async function rescatarSinLeer(tab) {
  const { wbListas = {}, addresses = {}, wbBajados = [] } = await chrome.storage.local.get(["wbListas", "addresses", "wbBajados"]);
  const pend = Object.entries(wbListas).filter(([, r]) => r.estado === "skip" && !r.borrada && r.skips && Date.now() - (r.t || 0) > 30 * 60e3);
  if (!pend.length) return;
  const vistos = [...wbBajados];
  for (const [nombre, r] of pend) {
    const claves = new Set((r.keys || []).map((k) => addresses[k]).filter(Boolean).map((a) => claveDom(a.street, a.zip)));
    let ok = null;
    for (let i = 0; i < 4 && !ok; i++) {
      const res = await corre(tab, pwLeerResultado, [r.skips, vistos]).catch(() => null);
      if (!res || !res.csv) break;
      const filas = leerCSV(res.csv);
      const coinciden = filas.filter((f) => claves.has(claveDom(f["Address"], f["Zip"]))).length;
      if (!claves.size || coinciden * 2 >= claves.size) ok = { res, filas }; else vistos.push(res.href);
    }
    if (!ok) continue;
    const rr = await repartir(ok.filas);
    const { wbListas: wl = {}, wbBajados: wb2 = [] } = await chrome.storage.local.get(["wbListas", "wbBajados"]);
    if (wl[nombre]) { wl[nombre].estado = "leida"; wl[nombre].t = Date.now(); wl[nombre].archivo = ok.res.href; wl[nombre].conTels = rr.lofti; }
    await chrome.storage.local.set({ wbListas: wl, wbBajados: [...wb2, ok.res.href].slice(-50) });
    decir(`Rescaté el archivo de la lista “${nombre}” que Wibi no alcanzó a leer: ${rr.lofti} con teléfonos van a Lofti.`);
  }
}
// Aviso en cuanto Wibi deja una lista sin skip trace (y Wibi la reusa en su próxima vuelta)
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local" || !ch.wbListas) return;
  const antes = ch.wbListas.oldValue || {}, ahora = ch.wbListas.newValue || {};
  for (const [n, r] of Object.entries(ahora)) {
    const a = antes[n] || {};
    if (r.estado === "sinSkip" && a.estado !== "sinSkip" && r.href) {
      decir(`La lista “${n}” se quedó sin skip trace (${r.motivo || "sin motivo"}). Wibi la reusa en su próxima vuelta; si prefieres, dale aquí “Skip trace a las listas pendientes”.`, "error");
      window.robot && robot.set("ayuda", `Lista “${n}” sin skip trace`);
    }
  }
});

// ---------- Pestaña de Carpi (en la ventana de Leads nuevos) ----------
const corre = async (tab, func, args = []) => { const [r] = await chrome.scripting.executeScript({ target: { tabId: tab }, func, args }); return r && r.result; };
async function pestana(url) {
  const { cpTab } = await chrome.storage.local.get("cpTab");
  const vid = await ventanaTrabajo("nuevos");
  let t = cpTab ? await chrome.tabs.get(cpTab).catch(() => null) : null;
  if (t && /propwire\.com/.test(t.url || "")) { if (t.windowId !== vid) await chrome.tabs.move(t.id, { windowId: vid, index: -1 }).catch(() => {}); await chrome.tabs.update(t.id, { url }); }
  else { t = await abrirPestana(url, "nuevos"); await chrome.storage.local.set({ cpTab: t.id }); }
  await sleep(800); for (let i = 0; i < 60; i++) { const x = await chrome.tabs.get(t.id).catch(() => null); if (!x || x.status === "complete") break; await sleep(400); }
  await sleep(1500 + Math.random() * 1500);
  return t.id;
}
const turno = () => turnoPropwire({ aviso: (ms) => ver(`Esperando turno de Propwire (otro agente la está usando)… ${Math.ceil(ms / 1000)} s`), parar: () => false });
async function pausa() { const { wbPausa = 0 } = await chrome.storage.local.get("wbPausa"); return wbPausa > Date.now() ? wbPausa : 0; }
async function bloqueado() { const hasta = Date.now() + 3 * 3600e3; await chrome.storage.local.set({ wbPausa: hasta }); decir(`Propwire bloqueó el acceso: Carpi (y Wibi) no tocan Propwire hasta las ${new Date(hasta).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`, "error"); }

// ---------- Clasificar ----------
const fechaDe = (mdy) => { const [m, d, y] = String(mdy || "").split("/"); return y ? new Date(+y, m - 1, +d).getTime() : 0; };
function clasificar(l, reg, imp) {
  if (!/^Wibi\b/i.test(l.nombre)) return { estado: "ajena", borrar: false, skip: !!cfg.ajenas, por: cfg.ajenas ? "no la hizo Wibi (entra al skip trace)" : "no la hizo Wibi" };
  const r = reg[l.nombre];
  if (!r) return DE_WIBI.test(l.nombre) ? { estado: "sinRegistro", borrar: false, skip: true, por: "parece de Wibi pero no está en su registro (entra al skip trace)" } : { estado: "prueba", borrar: false, por: "lista de prueba" };
  const edad = Date.now() - (r.t || r.creada || 0);
  if (r.estado === "leida") {
    const dias = (Date.now() - (r.t || 0)) / 864e5;
    return { estado: "leida", borrar: dias >= cfg.dias, por: dias >= cfg.dias ? `leída hace ${Math.floor(dias)} día(s)` : `leída; se borra a los ${cfg.dias} días` };
  }
  if (r.estado === "sinSkip") return { estado: "sinSkip", borrar: !cfg.skipEnVezDeBorrar, skip: true, por: r.motivo || "se quedó sin skip trace" };
  if (edad < EN_USO_MS) return { estado: "enUso", borrar: false, por: r.estado === "skip" ? "Wibi está esperando el archivo" : "Wibi la está usando" };
  return { estado: r.estado === "skip" ? "sinLeer" : "sinSkip", borrar: r.estado !== "skip" && !cfg.skipEnVezDeBorrar, skip: r.estado !== "skip", por: r.estado === "skip" ? "skip trace hecho pero Wibi no leyó el archivo: bájalo en My Activity" : "se quedó sin skip trace" };
}

// ---------- Trabajo ----------
async function revisar(aMano) {
  if (corriendo) return null;
  const pz = await pausa();
  if (pz) { ver(`Propwire en pausa hasta las ${new Date(pz).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} por un bloqueo.`); return null; }
  corriendo = true; $("run").disabled = $("borrar").disabled = $("skip").disabled = true;
  window.robot && robot.set("trabajando", "Revisando las listas de Propwire…");
  try {
    if (!(await turno())) return null;
    ver("Leyendo tus listas en Propwire…");
    let tab = await pestana("https://propwire.com/property-lists");
    const L = await corre(tab, pwLeerListas).catch((e) => ({ error: e.message }));
    if (L && L.bloqueo) { await bloqueado(); return null; }
    if (!L || L.error) { decir(`No pude leer las listas: ${(L && L.error) || "falló"}.`, "error"); return null; }
    if (!(await turno())) return null;
    ver("Revisando My Activity…");
    tab = await pestana("https://propwire.com/activity");
    const A = await corre(tab, pwLeerActividad).catch(() => ({ imports: {}, lotes: [] }));
    if (A && A.bloqueo) { await bloqueado(); return null; }
    await chrome.storage.local.set({ cpInv: { listas: L.listas, imports: (A && A.imports) || {}, t: Date.now() } });
    await rescatarSinLeer(tab); // listas con skip trace hecho que Wibi no alcanzó a leer: se leen aquí (no cuesta nada)
    const { inv } = await pintar();
    const nb = inv.filter((x) => x.c.borrar).length;
    decir(`Revisé ${L.listas.length} lista(s) en Propwire: ${inv.filter((x) => x.c.estado !== "ajena").length} de Wibi, ${nb} para borrar.`);
    window.robot && robot.set("idle", $("status").textContent);
    return inv;
  } finally { corriendo = false; $("run").disabled = $("borrar").disabled = $("skip").disabled = false; }
}
async function borrar(aMano) {
  const inv = await revisar(aMano);
  if (!inv) return;
  const objetivo = inv.filter((x) => x.c.borrar).map((x) => x.l.nombre);
  if (!objetivo.length) { ver("No hay listas para borrar."); return; }
  if (aMano || !cfg.auto) {
    if (!aMano) { decir(`Carpi tiene ${objetivo.length} lista(s) de Propwire para borrar; espero tu OK en su pestaña.`); return; }
    if (!(await preguntar(`¿Borrar en Propwire ${objetivo.length} lista(s)? No se puede deshacer.\n\n${objetivo.slice(0, 12).join("\n")}${objetivo.length > 12 ? `\n… y ${objetivo.length - 12} más` : ""}`, "Borrar"))) { ver("No borré nada."); return; }
  }
  corriendo = true; $("run").disabled = $("borrar").disabled = true;
  window.robot && robot.set("trabajando", `Borrando ${objetivo.length} lista(s)…`);
  try {
    if (!(await turno())) return;
    const tab = await pestana("https://propwire.com/property-lists");
    if (await corre(tab, pwBloq).catch(() => false)) { await bloqueado(); return; }
    let r = await corre(tab, pwBorrar, [objetivo]).catch((e) => ({ error: e.message }));
    if (!r || (r.error && !/no encontré esas|seleccionadas|no salió la confirmación|no encontré el botón/.test(r.error))) {
      // la página se recargó al borrar (o no contestó): se revisa qué listas siguen ahí
      await sleep(2500);
      const v = await corre(tab, pwLeerListas).catch(() => null);
      if (v && v.listas) { const vivos = new Set(v.listas.map((x) => x.nombre)); r = { borradas: objetivo.filter((n) => !vivos.has(n)), quedan: objetivo.filter((n) => vivos.has(n)) }; }
    }
    if (!r || r.error || !r.borradas) { decir(`No borré: ${(r && r.error) || "falló"}.`, "error"); return; }
    const { wbListas = {} } = await chrome.storage.local.get("wbListas");
    for (const n of r.borradas) if (wbListas[n]) wbListas[n].borrada = Date.now();
    await chrome.storage.local.set({ wbListas });
    decir(`Borré ${r.borradas.length} lista(s) de Propwire${r.quedan && r.quedan.length ? `; no pude con ${r.quedan.length}` : ""}.`);
  } finally { corriendo = false; $("run").disabled = $("borrar").disabled = false; await revisar(false); }
}

// ---------- Pantalla ----------
const GRUPO = { enUso: ["Wibi la está usando", "#e0f2fe", "#075985"], sinLeer: ["Skip trace hecho, sin leer", "#fef3c7", "#92400e"], sinSkip: ["Sin skip trace", "#fee2e2", "#b91c1c"],
  leida: ["Leídas", "#dcfce7", "#166534"], sinRegistro: ["De Wibi sin registro", "#ede9fe", "#5b21b6"], prueba: ["Prueba", "#e2e8f0", "#475569"], ajena: ["Otras (no las toco)", "#f1f5f9", "#475569"] };
async function pintar() {
  const { cpInv, wbListas = {} } = await chrome.storage.local.get(["cpInv", "wbListas"]);
  if (!cpInv) return { inv: [] };
  const inv = cpInv.listas.map((l) => ({ l, r: wbListas[l.nombre], imp: cpInv.imports[l.nombre], c: clasificar(l, wbListas, cpInv.imports[l.nombre]) }));
  $("nWibi").textContent = inv.filter((x) => x.c.estado !== "ajena").length;
  $("nLeidas").textContent = inv.filter((x) => x.c.estado === "leida").length;
  $("nBorrar").textContent = inv.filter((x) => x.c.borrar).length;
  $("nSkip").textContent = inv.filter((x) => x.c.skip).length;
  $("nAjenas").textContent = inv.filter((x) => x.c.estado === "ajena").length;
  chrome.storage.local.get("cpResumen").then(({ cpResumen = {} }) => { const r = { wibi: inv.filter((x) => x.c.estado !== "ajena").length, borrar: inv.filter((x) => x.c.borrar).length }; if (r.wibi !== cpResumen.wibi || r.borrar !== cpResumen.borrar) chrome.storage.local.set({ cpResumen: r }); });
  const html = Object.entries(GRUPO).map(([k, [tit, bg, fg]]) => {
    const xs = inv.filter((x) => x.c.estado === k).sort((a, b) => (b.r ? b.r.creada : fechaDe(b.l.fecha)) - (a.r ? a.r.creada : fechaDe(a.l.fecha)));
    if (!xs.length) return "";
    return `<h4>${tit} · ${xs.length}</h4><ul>${xs.map((x) => `<li><span class="txt"><b>${esc(x.l.nombre)}</b> ${x.c.borrar ? '<span class="tag" style="background:#fee2e2;color:#b91c1c">se borra</span>' : ""}${x.c.skip ? '<span class="tag" style="background:#ffedd5;color:#c2410c">skip trace pendiente</span>' : ""}
      <small>${x.l.n} propiedad(es)${x.imp && x.imp.noEncontradas ? ` · ${x.imp.noEncontradas} no las encontró Propwire` : ""}${x.r && x.r.zona ? ` · ${esc(x.r.zona)}` : ""}${x.r && x.r.conTels != null ? ` · ${x.r.conTels} con teléfonos a Lofti` : ""}</small>
      <small>${esc(x.c.por)}</small></span><span class="tag" style="background:${bg};color:${fg}">${x.l.fecha || ""}</span></li>`).join("")}</ul>`;
  }).join("");
  $("grupos").innerHTML = html || '<span class="empty">No hay listas en Propwire.</span>';
  return { inv };
}
$("run").onclick = () => revisar(true);
$("borrar").onclick = () => borrar(true);
$("skip").onclick = async () => { await revisar(true); skipVarias(); };
chrome.storage.onChanged.addListener((ch, a) => { if (a === "local" && (ch.cpInv || ch.wbListas)) pintar(); });
window.cpRevisar = revisar;
setInterval(async () => { if (!cfg.auto) return; const { cpUltima = 0 } = await chrome.storage.local.get("cpUltima"); if (Date.now() - cpUltima > 6 * 3600e3) { await chrome.storage.local.set({ cpUltima: Date.now() }); borrar(false); } }, 10 * 60 * 1000);
(async () => { await cargarCfg(); await pintar(); })();
