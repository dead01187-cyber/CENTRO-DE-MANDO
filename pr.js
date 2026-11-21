// =====================================================================
// Prope: hipotecas inversas en ejecución en Orange County, desde Properant.
// · Usa la sesión de Properant que ya está abierta en el navegador (no crea
//   cuentas ni mete contraseñas). Búsqueda: county Orange + foreclosure activo
//   + primer préstamo Reverse mortgage. NUNCA usa el skip trace de Properant.
// · Properant cuenta cada propiedad que entrega (lista y ficha) contra un tope
//   de consultas: las fichas ya leídas no se vuelven a abrir hasta que toca
//   (con remate, cada día; las demás, cada semana) y Prope se detiene si el
//   tope está por acabarse.
// · ¿La ejecución es de la hipoteca inversa? Si es el único préstamo abierto,
//   sí, aunque el aviso salga a nombre de un banco o del trustee (suele ser el
//   lender original o el fideicomiso que la compró). Solo se quita cuando hay
//   OTRO préstamo abierto y el aviso es de ese otro acreedor, o es del HOA.
// · Dueño = el nombre del AVISO (borrower): así lo indexa el registro del
//   condado (APELLIDO NOMBRE). El título puede estar ya a nombre de otra
//   persona, de un trust o del Public Administrator.
// · Sucesión: solo cuentan los documentos de muerte POSTERIORES a la hipoteca
//   inversa (los anteriores o del mismo día son del cónyuge que murió antes de
//   que el dueño actual la sacara) y el título a nombre de Estate / Public
//   Administrator. Si en el "Affidavit of Death" el que queda es el mismo
//   dueño, murió un co-dueño, no él.
// · Guarda en prCasos y le pide a Heri que los procese (registro → Celink →
//   herederos → brazo HECM). Heri es el único que escribe hrCasos.
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const PR_URL = "https://properant.com/dashboard";
const FILTROS = { prefc: "any", loan_type: "reverse", county: ["06059"] }; // 06059 = Orange County
const LECTURA = 2;       // versión de la lectura/clasificación: al subirla, cada ficha se vuelve a leer una vez
const CADA_DIAS = 3;     // "Buscar solo": Properant va semanas atrás del registro; diario no aporta y gasta consultas
const CUPO_MINIMO = 150; // si a Properant le quedan menos consultas que esto, Prope ya no abre fichas
const HORA = 3600e3;
let cfg = { max: 100, pausa: 3, pasarHeri: true, conRuido: false, auto: false }, corriendo = false, parar = false;

async function cargarCfg() {
  const { prConfig = {} } = await chrome.storage.local.get("prConfig");
  cfg = { ...cfg, ...prConfig };
  $("max").value = cfg.max; $("pausa").value = cfg.pausa; $("pasarHeri").checked = cfg.pasarHeri !== false; $("conRuido").checked = !!cfg.conRuido; $("auto").checked = !!cfg.auto;
}
function guardarCfg() {
  cfg = { max: Math.max(1, Math.min(200, parseInt($("max").value, 10) || 100)), pausa: Math.max(1, Math.min(30, parseInt($("pausa").value, 10) || 3)),
    pasarHeri: $("pasarHeri").checked, conRuido: $("conRuido").checked, auto: $("auto").checked };
  $("max").value = cfg.max; $("pausa").value = cfg.pausa;
  chrome.storage.local.set({ prConfig: cfg });
}
["max", "pausa", "pasarHeri", "conRuido", "auto"].forEach((id) => ($(id).onchange = () => { guardarCfg(); pintar(); }));

// ---------- Corre en la página de Properant (mundo de la página): búsqueda + fichas ----------
async function prBuscar(filtros, pmin, pmax, max, saltar, cupoMinimo) {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  if (!/properant\.com$/i.test(location.hostname)) return { error: "la pestaña no está en Properant" };
  const esJson = (r) => /json/i.test(r.headers.get("content-type") || "");
  let r;
  try { r = await fetch("/api/properties/filter", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filters: filtros, limit: 200 }) }); }
  catch (e) { return { error: "Properant no respondió" }; }
  if (r.status === 401 || r.status === 403 || /login/i.test(r.url) || !esJson(r)) return { sesion: true };
  if (r.status === 429) return { lento: true };
  if (!r.ok) return { error: `Properant respondió ${r.status}` };
  const j = await r.json();
  const lista = j.properties || [];
  const cupo = j.budget && typeof j.budget.remaining === "number" ? { usadas: j.budget.used, tope: j.budget.cap, quedan: j.budget.remaining } : null;
  const items = [];
  let leidas = 0, sinCupo = false, lento = false;
  for (const p of lista) {
    if (window.__prParar) break;
    if (leidas >= max) break;
    if (saltar.includes(String(p.property_id))) continue; // ficha leída hace poco
    if (cupo && cupo.quedan - leidas < cupoMinimo) { sinCupo = true; break; }
    if (leidas) await esp(pmin + Math.random() * (pmax - pmin));
    leidas++;
    window.__prAvance = { leidas, total: lista.length, dir: p.address };
    let d = null;
    try { const x = await fetch("/api/properties/" + encodeURIComponent(p.property_id), { credentials: "include" }); if (x.status === 429) { lento = true; break; } if (x.ok && esJson(x)) d = await x.json(); } catch (e) {}
    if (!d || !d.property) { items.push({ id: String(p.property_id), street: p.address, city: p.city, zip: p.zip, owner: p.owner_name || "", error: true }); continue; }
    const P = d.property, fc = d.foreclosure || {}, o = P.owner || {};
    const liens = P.liens || {}, sh = P.sales_history || {};
    items.push({
      id: String(P.property_id), apn: P.apn || "", street: P.address, city: P.city, zip: P.zip,
      owner: o.name || P.owner_name || "", owner2: o.name2 || "", borrower: fc.borrower_name || "",
      ocupada: o.owner_occupied !== false, ausente: !!o.is_absentee, vacante: !!P.vacant,
      etapa: fc.stage_label || "", nod: fc.nod_recording_date || "", aviso: fc.recording_date || fc.nod_recording_date || "",
      subasta: fc.auction_date || "", subastaPasada: !!fc.auction_date_passed, estadoRemate: fc.sale_status || "", fcLender: fc.current_lender || fc.original_lender || "",
      trustee: fc.trustee_name || "", trusteeTel: fc.trustee_phone || "", trusteeNum: fc.trustee_sale_number || "",
      saldo: fc.unpaid_balance || "", puja: fc.auction_min_bid || "",
      hipotecas: (liens.mortgages || []).filter((m) => !m.released).map((m) => ({ pos: m.position, lender: m.lender || "", actual: m.current_lender || "", tipo: m.loanType || "", monto: m.amount || "", fecha: m.recordingDate || "" })),
      docs: (sh.transactions || []).slice(0, 40).map((t) => ({ fecha: t.date || "", tipo: t.type || "", grantee: t.grantee || "" })),
      valor: P.estimated_value || "",
    });
  }
  return { total: lista.length, enLista: lista.map((p) => String(p.property_id)), items, cupo, sinCupo, lento, leidas };
}

const { esHecmReal, sucesionDe, duenoDe, duenoActualDe, pasoAHud, mismoNombre, isoAmdy } = window.PR; // pr-clasif.js
// Cada cuánto se vuelve a abrir una ficha: con remate programado, cada día; las demás, cada semana
const frescura = (c) => (c.subasta && !c.subastaPasada ? 20 * HORA : 7 * 24 * HORA);

// ---------- Pestaña de Properant (ventana del brazo HECM) ----------
const corre = async (tab, func, args = [], world = "MAIN") => { const [r] = await chrome.scripting.executeScript({ target: { tabId: tab }, func, args, world }); return r && r.result; };
async function pestanaPR() {
  const { prTab } = await chrome.storage.local.get("prTab");
  if (prTab) {
    const t = await chrome.tabs.get(prTab).catch(() => null);
    if (t && /properant\.com/.test(t.url || "")) {
      const vid = await ventanaTrabajo("hecm");
      if (t.windowId !== vid) await chrome.tabs.move(t.id, { windowId: vid, index: -1 }).catch(() => {});
      return t.id;
    }
  }
  const t = await abrirPestana(PR_URL, "hecm");
  await chrome.storage.local.set({ prTab: t.id }); await sleep(2500);
  return t.id;
}

// ---------- Trabajo ----------
async function trabajar(aMano) {
  if (corriendo) return;
  guardarCfg();
  corriendo = true; parar = false; $("run").disabled = true;
  window.robot && robot.set("trabajando", "Buscando hipotecas inversas en ejecución en Properant…");
  let mirar = null;
  try {
    await chrome.storage.local.set({ prUltima: Date.now() });
    const tab = await pestanaPR();
    const { prCasos = {} } = await chrome.storage.local.get("prCasos");
    const saltar = Object.values(prCasos).filter((c) => c.v === LECTURA && c.leida && Date.now() - c.leida < frescura(c)).map((c) => c.id);
    ver("Leyendo la búsqueda de Properant (Orange · foreclosure activo · Reverse mortgage)…");
    await corre(tab, () => { window.__prParar = false; window.__prAvance = null; });
    mirar = setInterval(async () => {
      if (parar) await corre(tab, () => { window.__prParar = true; }).catch(() => {});
      const a = await corre(tab, () => window.__prAvance).catch(() => null);
      if (a) ver(`Leyendo fichas de Properant: ${a.leidas} · ${a.dir}…`);
    }, 1500);
    const r = await corre(tab, prBuscar, [FILTROS, cfg.pausa * 1000, cfg.pausa * 2000, cfg.max, saltar, CUPO_MINIMO]);
    clearInterval(mirar); mirar = null;
    if (!r) throw new Error("no pude correr en la pestaña de Properant");
    if (r.sesion) { decir("Properant no me dejó entrar: inicia sesión en properant.com en la ventana HECM (o revisa si ya se acabó la prueba gratis) y dale otra vez a Prope.", "error"); window.robot && robot.set("error", "Properant pide iniciar sesión"); return; }
    if (r.error) throw new Error(r.error);
    for (const p of r.items || []) {
      if (p.error) continue;
      const c = prCasos[p.id] || { t: Date.now() };
      const h = esHecmReal(p), su = sucesionDe(p), dueno = duenoDe(p);
      const cambio = c.v !== LECTURA || c.etapa !== p.etapa || c.aviso !== p.aviso || c.subasta !== p.subasta || c.dueno !== dueno || c.hecm !== h.ok || !!c.fallecido !== su.fallecido;
      Object.assign(c, p, { v: LECTURA, leida: Date.now(), activo: true, dueno, duenoActual: duenoActualDe(p), todos: [...new Set([p.borrower, p.owner, p.owner2].filter(Boolean))],
        hecm: h.ok, dudoso: !!h.dudoso, motivo: h.motivo, herederos: su.es, senalesEn: su.en, fallecido: su.fallecido, fallecidoPor: su.fallecido ? su.en[0] || "" : "", publicAdmin: su.pa,
        pasoAHud: pasoAHud(p), avisoMdy: isoAmdy(p.aviso), subastaMdy: isoAmdy(p.subasta) });
      if (cambio) delete c.pasadoAHeri; // algo cambió (o es la lectura nueva): Heri lo vuelve a ver
      prCasos[p.id] = c;
    }
    // Lo que ya no sale en la búsqueda dejó de estar en ejecución (se pagó, se canceló o se vendió)
    if (r.enLista && r.enLista.length) for (const c of Object.values(prCasos)) c.activo = r.enLista.includes(c.id);
    const todos = Object.values(prCasos).filter((c) => c.activo !== false);
    const hecm = todos.filter((c) => c.hecm).length, her = todos.filter((c) => c.hecm && c.fallecido).length, ruido = todos.filter((c) => !c.hecm).length;
    await chrome.storage.local.set({ prCasos, prResumen: { t: Date.now(), total: r.total || 0, leidas: r.leidas || 0, hecm, herederos: her, ruido, cupo: r.cupo ? { ...r.cupo, quedan: r.cupo.quedan - (r.leidas || 0) } : null } });
    const nuevosHeri = Object.values(prCasos).filter((c) => c.activo !== false && (c.hecm || cfg.conRuido) && !c.pasadoAHeri).length;
    let txt = `${parar ? "Detenido. " : "Listo: "}Properant tiene ${r.total || 0} en Orange con foreclosure activo y Reverse mortgage (abrí ${r.leidas || 0} ficha(s)). ${hecm} son de la hipoteca inversa (${her} con señal de sucesión) y ${ruido} las ejecuta otro acreedor.`;
    if (r.lento) txt += " Properant pidió ir más lento: paré ahí; súbele la pausa entre fichas.";
    if (r.sinCupo) txt += ` A Properant le quedan pocas consultas (${r.cupo ? r.cupo.quedan : "?"}): ya no abrí más fichas.`;
    if (nuevosHeri) txt += cfg.pasarHeri ? ` Le paso ${nuevosHeri} a Heri.` : ` ${nuevosHeri} esperando a Heri (dale a Heri o prende "pasar a Heri").`;
    decir(txt, r.lento || r.sinCupo ? "error" : undefined);
    window.robot && robot.set(hecm ? "feliz" : "idle", txt);
    if (nuevosHeri && cfg.pasarHeri && !parar) pasarAHeri();
  } catch (e) {
    decir(`Prope falló: ${e.message}`, "error");
    window.robot && robot.set("error", e.message);
  } finally {
    if (mirar) clearInterval(mirar);
    corriendo = false; $("run").disabled = false;
    pintar();
  }
}
// Heri vive en otro marco (Centro de Mando o panel lateral): se le pide que procese solo lo de Properant
function pasarAHeri() {
  try {
    const f = window.parent && window.parent.document.getElementById("f-hr");
    const w = f && f.contentWindow;
    if (w && typeof w.hrTrabajar === "function") { w.hrTrabajar(true, { soloProp: true }); return true; }
  } catch (e) {}
  chrome.storage.local.set({ prPideHeri: Date.now() }); // si Heri no está a la mano, lo toma al abrirse
  return false;
}

// ---------- Pantalla ----------
const miles = (n) => `$${Math.round(n / 1000).toLocaleString("en-US")}K`;
async function pintar() {
  const { prCasos = {}, prResumen = {} } = await chrome.storage.local.get(["prCasos", "prResumen"]);
  const c = Object.values(prCasos).filter((x) => x.activo !== false)
    .sort((a, b) => (b.hecm - a.hecm) || (!!b.fallecido - !!a.fallecido) || String(b.aviso).localeCompare(String(a.aviso)));
  $("nTotal").textContent = prResumen.total || 0;
  $("nRev").textContent = c.length;
  $("nHecm").textContent = c.filter((x) => x.hecm).length;
  $("nHer").textContent = c.filter((x) => x.hecm && x.fallecido).length;
  $("nRuido").textContent = c.filter((x) => !x.hecm).length;
  $("nHeri").textContent = c.filter((x) => x.pasadoAHeri).length;
  const q = prResumen.cupo;
  $("cupo").textContent = q ? `Consultas de Properant: quedan ${q.quedan} de ${q.tope} (cada propiedad de la lista y cada ficha cuenta una).` : "";
  if (!c.length) { $("lista").innerHTML = `<li class="empty">Aquí salen las hipotecas inversas en ejecución que encuentre en Properant.</li>`; return; }
  $("lista").innerHTML = c.map((x) => {
    const debe = +x.saldo || +x.puja || 0, queda = debe && +x.valor ? +x.valor - debe : null;
    return `<li style="${x.hecm ? "" : "opacity:.55"}"><b>${esc(x.street)}, ${esc(x.city)}</b> ${x.hecm ? (x.dudoso ? `<span class="tag gris">revisar</span>` : `<span class="tag">hipoteca inversa</span>`) : `<span class="tag gris">otro acreedor</span>`}${x.fallecido ? ` <span class="tag">sucesión</span>` : ""}${x.pasoAHud ? ` <span class="tag" title="la HECM pasó a HUD: Celink administra las de HUD">HUD → Celink</span>` : ""}${x.pasadoAHeri ? ` <span class="tag gris">con Heri</span>` : ""}
    <small>${esc(x.dueno || x.owner)}${x.duenoActual && x.dueno && !mismoNombre(x.duenoActual, x.dueno) ? ` (título: ${esc(x.owner)})` : ""} · ${esc(x.etapa)}${x.avisoMdy ? " " + esc(x.avisoMdy) : ""}${x.subastaMdy ? ` · remate ${esc(x.subastaMdy)}${x.subastaPasada ? " (ya pasó: revisar si se vendió)" : ""}` : ""} · ${esc(x.motivo)}</small>
    <small>${esc([x.trustee && `Trustee ${x.trustee}${x.trusteeTel ? " " + x.trusteeTel : ""}`, (x.herederos || []).join(" · "), debe ? `debe ${miles(debe)}${queda != null ? ` · vale ${miles(+x.valor)} · ${queda >= 0 ? "le quedarían " + miles(queda) : "debe " + miles(-queda) + " más de lo que vale"}` : ""}` : ""].filter(Boolean).join(" · "))}</small></li>`;
  }).join("");
}
$("run").onclick = () => trabajar(true);
$("stop").onclick = () => { parar = true; ver("Parando…"); };
$("olvidar").onclick = async () => {
  const { prCasos = {} } = await chrome.storage.local.get("prCasos");
  for (const c of Object.values(prCasos)) delete c.pasadoAHeri;
  await chrome.storage.local.set({ prCasos });
  ver("Listo: la próxima vez Heri vuelve a ver todas las de Properant."); pintar();
};
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && (ch.prCasos || ch.prResumen)) pintar(); });
window.prTrabajar = trabajar; // Capi
const tocaAuto = async () => { const { prUltima = 0 } = await chrome.storage.local.get("prUltima"); return cfg.auto && !corriendo && Date.now() - prUltima > CADA_DIAS * 24 * HORA; };
setInterval(async () => { if (await tocaAuto()) trabajar(false); }, 30 * 60 * 1000);
(async () => {
  await cargarCfg();
  await pintar();
  if (await tocaAuto()) setTimeout(() => trabajar(false), 12000);
})();
