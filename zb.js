// =====================================================================
// Zeta: lee en Gmail los correos de leads de zBuyer (lead@zbuyer.com),
// busca cada lead en Lofty (teléfono, correo, domicilio y nombre) y
// compara fechas. Si el lead ya estaba en Lofty ANTES del correo y su fuente
// (Source) es zBuyer, lo marca "repetido" y Redi le hace el borrador de
// reclamo a zBuyer. Si ya estaba pero venía de otra fuente, no se reclama.
// Usa tu Gmail ya abierto en Chrome (sin contraseñas ni permisos extra).
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const dig = (s) => String(s || "").replace(/\D/g, "");
const fecha = (ms) => ms ? new Date(ms).toLocaleString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const DEF = { cuenta: "rubioteamcaller01@gmail.com", dias: 3, auto: true, cadaMin: 10, margenMin: 10 };
let cfg = { ...DEF }, corriendo = false, parar = false;

// ---------- Config ----------
async function cargarCfg() {
  const { zbConfig = {} } = await chrome.storage.local.get("zbConfig");
  cfg = { ...DEF, ...zbConfig };
  $("cuenta").value = cfg.cuenta; $("dias").value = cfg.dias; $("cadaMin").value = cfg.cadaMin; $("margenMin").value = cfg.margenMin; $("auto").checked = cfg.auto;
}
function guardarCfg() {
  cfg = { cuenta: $("cuenta").value.trim() || DEF.cuenta, dias: Math.max(1, parseInt($("dias").value, 10) || DEF.dias),
    cadaMin: Math.max(2, parseInt($("cadaMin").value, 10) || DEF.cadaMin), margenMin: Math.max(0, parseInt($("margenMin").value, 10) || 0), auto: $("auto").checked };
  chrome.storage.local.set({ zbConfig: cfg });
}
["cuenta", "dias", "cadaMin", "margenMin", "auto"].forEach((id) => ($(id).onchange = () => { guardarCfg(); programar(); }));

// ---------- Leer un correo de zBuyer (texto del mensaje original) ----------
function textoPlano(raw) {
  // Saca la parte text/plain del mensaje (puede venir en base64 o quoted-printable)
  const i = raw.search(/Content-Type:\s*text\/plain/i);
  let parte = i >= 0 ? raw.slice(i) : raw;
  const fin = parte.search(/\r?\n--[^\r\n]+/);
  const cab = parte.slice(0, parte.search(/\r?\n\r?\n/) + 1);
  let cuerpo = parte.slice(cab.length, fin > cab.length ? fin : undefined).trim();
  const cte = (cab.match(/Content-Transfer-Encoding:\s*([\w-]+)/i) || [])[1] || "";
  if (/base64/i.test(cte)) { try { cuerpo = new TextDecoder().decode(Uint8Array.from(atob(cuerpo.replace(/\s+/g, "")), (c) => c.charCodeAt(0))); } catch (e) {} }
  if (/quoted-printable/i.test(cte)) cuerpo = cuerpo.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return cuerpo;
}
function leerCorreo(raw, hilo) {
  if (!/lead@zbuyer\.com/i.test(raw.slice(0, 6000)) || !/\[LeadID\]/.test(raw)) return null;
  const txt = textoPlano(raw);
  const f = {};
  for (const m of txt.matchAll(/^\[([^\]]+)\]:[ \t]*(.*)$/gm)) f[m[1].trim()] = m[2].trim();
  const na = (v) => (!v || /^n\/?a$/i.test(v) ? "" : v);
  const dir = na(f["Property Address"]);
  const [calle = "", resto = ""] = dir.split(";").map((s) => s.trim());
  const mr = resto.match(/^(.*?),\s*([A-Z]{2})\s*(\d{5})?/) || [];
  const fechaCab = (raw.match(/^Date:\s*(.+)$/m) || [])[1];
  return {
    hilo, leadIdZb: na(f["LeadID"]), tipo: na(f["Lead Type"]), nombre: na(f["Contact Name"]), correo: na(f["Contact Email"]).toLowerCase(),
    tel: na(f["Primary Phone"]), tel2: na(f["Secondary Phone"]), calle, ciudad: (mr[1] || "").trim(), estadoUS: mr[2] || "", zip: mr[3] || "",
    direccion: dir.replace(/;\s*/, ", "), fechaCorreo: Date.parse(fechaCab) || Date.now(),
  };
}

// Corre DENTRO de la pestaña de Gmail (mundo de la página): busca los correos de zBuyer y trae los nuevos.
async function enGmail(dias, vistos) {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40 && !(window.GLOBALS && window.GLOBALS[9]); i++) await espera(500);
  if (!(window.GLOBALS && window.GLOBALS[9])) return { error: "Gmail no terminó de cargar (¿sesión abierta?)" };
  const ik = window.GLOBALS[9], base = location.pathname.replace(/\/+$/, "/");
  const busca = "#search/" + encodeURIComponent(`from:lead@zbuyer.com newer_than:${dias}d`);
  if (location.hash !== busca) { location.hash = busca; await espera(2500); }
  let ids = [], antes = -1;
  for (let i = 0; i < 30; i++) { // espera a que la lista se quede quieta
    ids = [...new Set([...document.querySelectorAll("[data-legacy-thread-id]")].filter((e) => e.offsetParent !== null).map((e) => e.getAttribute("data-legacy-thread-id")))];
    if (ids.length && ids.length === antes) break;
    antes = ids.length; await espera(700);
  }
  const nuevos = ids.filter((id) => /^[0-9a-f]+$/i.test(id) && !vistos.includes(id)).slice(0, 40);
  const out = [];
  for (const id of nuevos) {
    try {
      const r = await fetch(`${base}?ik=${ik}&view=om&permmsgid=msg-f:${BigInt("0x" + id)}`, { credentials: "include" });
      const h = await r.text();
      const pre = (h.match(/<pre[^>]*id="raw_message_text"[^>]*>([\s\S]*?)<\/pre>/) || [])[1] || "";
      const raw = pre.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
      out.push({ id, raw });
    } catch (e) { out.push({ id, error: String(e.message || e) }); }
  }
  return { base, total: ids.length, out, cuenta: document.title };
}

// Pestaña de Gmail del robot (una sola, en segundo plano)
async function pestanaGmail() {
  const { zbTab } = await chrome.storage.local.get("zbTab");
  if (zbTab) {
    const t = await chrome.tabs.get(zbTab).catch(() => null);
    if (t && /^https:\/\/mail\.google\.com\//.test(t.url || "") && await enSuVentana(t.id)) return t.id;
  }
  const t = await abrirPestana(`https://mail.google.com/mail/?authuser=${encodeURIComponent(cfg.cuenta)}#inbox`);
  await chrome.storage.local.set({ zbTab: t.id });
  return t.id;
}

// ---------- Analizar los teléfonos del lead ----------
const LADAS_CA = new Set("209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951".split(" "));
const GRATIS = /^(800|833|844|855|866|877|888)$/;
function analizarTel(t) {
  let n = dig(t);
  if (!n) return null;
  if (n.length === 11 && n[0] === "1") n = n.slice(1);
  const p = [];
  if (n.length !== 10) p.push(n.length < 10 ? "le faltan dígitos" : "tiene dígitos de más");
  else {
    const a = n.slice(0, 3), e = n.slice(3, 6), l = n.slice(6), siete = n.slice(3);
    if (/^[01]/.test(a) || a[1] === "9") p.push("lada que no existe");
    else if (GRATIS.test(a)) p.push("es un 800 (no es personal)");
    if (/^[01]/.test(e)) p.push("número que no existe");
    if (e === "555" && /^01/.test(l)) p.push("número ficticio (555-01xx)");
    if (/^(\d)\1+$/.test(siete) || /^(\d)\1+$/.test(n)) p.push("dígitos repetidos");
    else if ("0123456789".includes(siete) || "9876543210".includes(siete)) p.push("números en secuencia");
    if (l === "0000" && !p.length) p.push("termina en 0000 (sospechoso)");
  }
  return { tel: n, problemas: p, fueraCA: n.length === 10 && !LADAS_CA.has(n.slice(0, 3)), deOtro: "" };
}
const apellido = (s) => norm(s).split(" ").filter(Boolean).pop() || "";
const fmtTel = (n) => n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : n;
// Resumen corto: "📵 (714) 555-0101: número ficticio (555) · 📞 (949) 222-3333: en Lofty es de Juan Pérez"
function resumenTels(ta) {
  return (ta || []).map((x) => {
    const malos = [...x.problemas, x.deOtro ? `en Lofty es de ${x.deOtro}` : "", x.fueraCA && !x.problemas.length ? "lada fuera de California" : ""].filter(Boolean);
    return malos.length ? `${x.problemas.length ? "📵" : "⚠"} ${fmtTel(x.tel)}: ${malos.join(", ")}` : "";
  }).filter(Boolean).join(" · ");
}

// ---------- Buscar en Lofty y comparar fechas ----------
const sinTipo2 = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ")
  .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|circle|cir|boulevard|blvd|way|place|pl|terrace|ter|parkway|pkwy|highway|hwy|trail|trl|north|south|east|west|n|s|e|w|unit|apt)\b/g, " ")
  .replace(/\s+/g, " ").trim();
function mismoDomicilio(z, l) {
  const num = (z.calle.match(/^\d+/) || [])[0]; if (!num) return false;
  const nombreCalle = sinTipo2(z.calle.replace(/^\d+\s*/, "")).split(" ").filter(Boolean);
  return [...(l.leadPropertyList || []), l].some((p) => {
    if (!p || !p.streetAddress) return false;
    const todo = sinTipo2(`${p.streetAddress} ${p.city || ""}`);
    const pal = todo.split(" ");
    return pal[0] === num && nombreCalle.every((w) => pal.includes(w));
  });
}
const creadoLofty = (s) => Date.parse(String(s || "").replace(/GMT$/, "Z")) || 0;
const leads = (d) => d.leads || d.data || [];

async function buscarEnLofty(z) {
  const cand = new Map();
  const add = (ls, por, ok) => { for (const l of ls) if (ok(l)) {
    const k = String(l.leadId || l.id); if (!cand.has(k)) cand.set(k, { l, por: new Set() }); cand.get(k).por.add(por); } };
  const ta = [z.tel, z.tel2].map(analizarTel).filter(Boolean).filter((x, i, a) => a.findIndex((y) => y.tel === x.tel) === i);
  const tels = ta.filter((x) => x.tel.length === 10).map((x) => x.tel); // también los raros: si zBuyer ya lo mandó con ese número, se detecta
  for (const t of tels) {
    const ls = leads(await loftyApi(`/leads?limit=25&phone=${t}`)).filter((l) => (l.phones || []).some((p) => dig(p).slice(-10) === t));
    add(ls, "teléfono", () => true);
    // ¿El número ya está en Lofty con otra persona (otro apellido y otro domicilio)?
    const otro = ls.find((l) => apellido(`${l.firstName} ${l.lastName}`) && apellido(z.nombre) && apellido(`${l.firstName} ${l.lastName}`) !== apellido(z.nombre) && !mismoDomicilio(z, l));
    if (otro) ta.find((x) => x.tel === t).deOtro = `${otro.firstName || ""} ${otro.lastName || ""}`.trim();
  }
  if (z.correo) add(leads(await loftyApi(`/leads?limit=25&email=${encodeURIComponent(z.correo)}`)), "correo", (l) => (l.emails || []).some((e) => String(e).toLowerCase() === z.correo));
  if (z.calle) add(leads(await loftyApi(`/leads?limit=25&key=${encodeURIComponent(z.calle.split(/\s+/).slice(0, 2).join(" "))}`)), "domicilio", (l) => mismoDomicilio(z, l));
  if (z.nombre) add(leads(await loftyApi(`/leads?limit=25&key=${encodeURIComponent(z.nombre)}`)), "nombre", (l) => norm(`${l.firstName} ${l.lastName}`) === norm(z.nombre));
  const margen = cfg.margenMin * 60000;
  const todos = [...cand.values()].map(({ l, por }) => ({ l, por: [...por], creado: creadoLofty(l.createTime), zb: deZbuyer(l.source) }));
  // "Ya lo teníamos" = lead creado antes del correo (con margen: zBuyer mete el suyo a Lofty segundos después de mandarlo)
  const viejos = todos.filter((c) => c.creado && c.creado < z.fechaCorreo - margen).sort((a, b) => a.creado - b.creado);
  const fuerte = (c) => c.por.some((p) => p !== "nombre");
  const rep = viejos.find((c) => c.zb && fuerte(c));  // ya lo teníamos y venía de zBuyer → se reclama
  const dud = viejos.find((c) => c.zb);               // solo coincide el nombre con un lead viejo de zBuyer → lo revisas tú
  const otra = viejos.find(fuerte);                   // ya lo teníamos, pero de otra fuente → no se reclama
  const elegido = rep || dud || otra || todos.find((c) => !viejos.includes(c)) || todos[0];
  return {
    telAnalisis: ta, telMalo: !ta.length || ta.every((x) => x.problemas.length), telAviso: resumenTels(ta),
    estado: rep ? "repetido" : dud ? "revisar" : otra ? "otrafuente" : "nuevo",
    coincide: elegido ? elegido.por : [],
    loftyId: elegido ? String(elegido.l.leadId || elegido.l.id) : "", loftyCreado: elegido ? elegido.creado : 0,
    loftyEtapa: elegido ? elegido.l.stage || "" : "", loftyFuente: elegido ? elegido.l.source || "" : "",
    loftyNombre: elegido ? `${elegido.l.firstName || ""} ${elegido.l.lastName || ""}`.trim() : "",
  };
}

// Lo que se anota en la bitácora de cada lead ya comparado
function avisar(l, nota = "") {
  if (l.telAviso) nota += ` Teléfonos: ${l.telAviso}.` + (l.telMalo ? " Ningún teléfono sirve: zBuyer suele reponer leads con contacto inválido." : "");
  if (l.estado === "repetido") decir(`⚠ ${l.nombre} (${l.direccion}) ya estaba en Lofty desde ${fecha(l.loftyCreado)} con fuente zBuyer (coincide: ${(l.coincide || []).join(", ")}). zBuyer lo volvió a mandar el ${fecha(l.fechaCorreo)}: lo paso a Redi.${nota}`);
  else if (l.estado === "otrafuente") decir(`↷ ${l.nombre} ya estaba en Lofty desde ${fecha(l.loftyCreado)}, pero venía de “${l.loftyFuente || "otra fuente"}” y no de zBuyer: no se reclama.${nota}`);
  else if (l.estado === "revisar") decir(`? ${l.nombre}: en Lofty solo coincide el nombre con un lead viejo de zBuyer. Revísalo tú.${nota}`);
  else svLog && svLog(`✓ ${l.nombre} es lead nuevo de zBuyer.${nota}`);
}

// ---------- Regla: solo se reclama lo que ya teníamos CON FUENTE zBuyer ----------
// Lo que se clasificó antes de esta regla ("ya lo teníamos" de cualquier fuente) sale de la fila de Redi
// en cuanto abre esta pestaña, y queda marcado para volver a compararlo con Lofty en la siguiente revisión.
async function aplicarRegla() {
  const { zbLeads = {} } = await chrome.storage.local.get("zbLeads");
  const cambios = {};
  for (const l of Object.values(zbLeads)) if (!l.telAnalisis) { // leads leídos antes del análisis de teléfonos
    const ta = [l.tel, l.tel2].map(analizarTel).filter(Boolean).filter((x, i, a) => a.findIndex((y) => y.tel === x.tel) === i);
    cambios[l.leadIdZb] = { telAnalisis: ta, telMalo: !ta.length || ta.every((x) => x.problemas.length), telAviso: resumenTels(ta) };
  }
  for (const l of Object.values(zbLeads)) {
    if (l.aMano || deZbuyer(l.loftyFuente) || (l.estado !== "repetido" && l.estado !== "revisar")) continue;
    cambios[l.leadIdZb] = { estado: l.estado === "repetido" ? "otrafuente" : "nuevo", recheck: true };
  }
  if (Object.keys(cambios).length) await zbPoner(cambios);
}
// Vuelve a comparar con Lofty lo que marcó aplicarRegla (por si hay otro lead viejo que sí es de zBuyer)
async function recomparar() {
  const { zbLeads = {} } = await chrome.storage.local.get("zbLeads");
  for (const l of Object.values(zbLeads).filter((x) => x.recheck)) {
    if (parar) return;
    ver(`Comparando otra vez con Lofty: ${l.nombre}…`);
    let r;
    try { r = await buscarEnLofty(l); } catch (e) { if (e.sinKey) return; continue; } // se reintenta en la próxima vuelta
    const { zbLeads: zl = {} } = await chrome.storage.local.get("zbLeads");
    const act = zl[l.leadIdZb];
    if (!act || !act.recheck) continue;
    const datos = { ...r, recheck: false };
    let nota = "";
    if (act.borrador === "hecho" && r.estado !== "repetido") nota = " Hay un borrador de antes en Gmail (se hizo con la regla anterior): bórralo.";
    if (act.borrador && r.estado === "repetido" && r.loftyId !== act.loftyId) { // el borrador de antes citaba otro lead de Lofty
      datos.borrador = null;
      if (act.borrador === "hecho") nota = " El borrador de antes citaba otro lead de Lofty: bórralo, Redi hace uno nuevo.";
    }
    await zbPoner({ [l.leadIdZb]: datos });
    avisar({ ...act, ...datos }, nota);
  }
}

// ---------- Ciclo ----------
async function revisar(aMano) {
  if (corriendo) return;
  corriendo = true; parar = false; $("run").disabled = true;
  try {
    guardarCfg();
    const { loftyKey } = await chrome.storage.local.get("loftyKey");
    if (!loftyKey) { decir("Falta la API key de Lofty (pégala en la pestaña Lofty). Sin ella no puedo comparar fechas.", "error"); return; }
    await recomparar(); // lo que venía clasificado con la regla anterior
    window.robot && robot.set("trabajando", "Abriendo Gmail…");
    ver("Abriendo tu Gmail en segundo plano…");
    const tab = await pestanaGmail();
    const { zbVistos = [] } = await chrome.storage.local.get("zbVistos");
    ver(`Buscando correos de zBuyer de los últimos ${cfg.dias} días…`);
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab }, world: "MAIN", func: enGmail, args: [cfg.dias, zbVistos] });
    const r = res && res.result;
    if (!r || r.error) { decir(`No pude leer Gmail: ${(r && r.error) || "la pestaña no respondió"}. Revisa que estés con la sesión de ${cfg.cuenta}.`, "error"); return; }
    if (!String(r.cuenta || "").toLowerCase().includes(cfg.cuenta.toLowerCase()))
      decir(`Ojo: la pestaña de Gmail no parece ser de ${cfg.cuenta} (${String(r.cuenta).slice(0, 60)}).`, "error");
    if (/^\/mail\/u\/\d+\/$/.test(r.base)) await chrome.storage.local.set({ zbBase: r.base });
    const vistos = new Set(zbVistos);
    let nuevos = 0, rep = 0, rev = 0, otra = 0;
    for (const m of r.out) {
      if (parar) break;
      if (m.error) continue; // se reintenta en la próxima vuelta
      vistos.add(m.id);
      const z = leerCorreo(m.raw, m.id);
      if (!z || !z.leadIdZb) continue;
      const { zbLeads = {} } = await chrome.storage.local.get("zbLeads");
      if (zbLeads[z.leadIdZb]) continue;
      window.robot && robot.set("trabajando", `Buscando en Lofty: ${z.nombre}…`);
      ver(`Comparando con Lofty: ${z.nombre} · ${z.direccion}`);
      let res2;
      try { res2 = await buscarEnLofty(z); }
      catch (e) { vistos.delete(m.id); decir(`No pude buscar a ${z.nombre} en Lofty (${e.message}). Lo reintento después.`, "error"); if (e.sinKey) break; continue; }
      const item = { ...z, ...res2, t: Date.now() };
      await zbPoner({ [z.leadIdZb]: item }, true);
      nuevos++;
      if (item.estado === "repetido") rep++; else if (item.estado === "revisar") rev++; else if (item.estado === "otrafuente") otra++;
      avisar(item);
    }
    await chrome.storage.local.set({ zbVistos: [...vistos].slice(-3000), zbUltima: Date.now() });
    if (nuevos) decir(`Listo: revisé ${nuevos} lead(s) de zBuyer · ${rep} repetido(s) de zBuyer · ${otra} ya en Lofty de otra fuente · ${rev} por revisar · ${nuevos - rep - rev - otra} nuevo(s).`);
    else ver(`Sin correos nuevos de zBuyer (${r.total} en los últimos ${cfg.dias} días, ya revisados). Última revisión: ${fecha(Date.now())}.`);
    window.robot && robot.set(nuevos ? "feliz" : "idle", $("status").textContent);
  } catch (e) {
    decir(`Error revisando zBuyer: ${e.message}`, "error");
  } finally {
    corriendo = false; $("run").disabled = false; pintar();
  }
}

let reloj = null;
function programar() {
  clearInterval(reloj);
  if (cfg.auto) reloj = setInterval(() => revisar(false), cfg.cadaMin * 60000);
}

// ---------- Pantalla ----------
const ETQ = { repetido: ["Ya lo teníamos · zBuyer", "#fee2e2", "#b91c1c"], otrafuente: ["Ya lo teníamos · otra fuente", "#e0e7ff", "#3730a3"], revisar: ["Revisar", "#fef3c7", "#92400e"], nuevo: ["Nuevo", "#dcfce7", "#166534"], descartado: ["Descartado", "#e2e8f0", "#475569"] };
async function pintar() {
  const { zbLeads = {}, zbUltima } = await chrome.storage.local.get(["zbLeads", "zbUltima"]);
  const ls = Object.values(zbLeads).sort((a, b) => b.fechaCorreo - a.fechaCorreo);
  const filtro = $("filtro").value;
  $("nTot").textContent = ls.length;
  $("nNue").textContent = ls.filter((l) => l.estado === "nuevo").length;
  $("nRep").textContent = ls.filter(reclamable).length;
  $("nOtr").textContent = ls.filter((l) => l.estado === "otrafuente").length;
  $("nRev").textContent = ls.filter((l) => l.estado === "revisar").length;
  $("nTel").textContent = ls.filter((l) => l.telMalo).length;
  if (zbUltima && !corriendo && /^(Listo\.|Última revisión)/.test($("status").textContent)) ver(`Última revisión: ${fecha(zbUltima)}.`);
  const ul = $("list"); ul.innerHTML = "";
  const vis = ls.filter((l) => filtro === "todos" || (filtro === "telmalo" ? l.telMalo : filtro === "telaviso" ? !!l.telAviso : l.estado === filtro));
  if (!vis.length) { ul.innerHTML = '<li class="empty">Nada por aquí todavía.</li>'; return; }
  for (const l of vis.slice(0, 200)) {
    const [t, bg, fg] = l.estado === "repetido" && l.aMano && !deZbuyer(l.loftyFuente) ? ["Reclamar · a mano", "#fee2e2", "#b91c1c"] : ETQ[l.estado] || [l.estado, "#e2e8f0", "#334155"];
    const li = document.createElement("li");
    const loft = l.loftyCreado ? `<small>Lofty: ${esc(l.loftyNombre || "lead")} · fuente ${esc(l.loftyFuente || "—")} · desde ${fecha(l.loftyCreado)} · ${esc(l.loftyEtapa)}${l.coincide && l.coincide.length ? " · coincide " + esc(l.coincide.join(", ")) : ""}${l.recheck ? " · por recomparar" : ""}</small>` : "";
    const bor = l.borrador !== "hecho" ? "" : l.estado === "repetido" ? ' <span class="tag" style="background:#ede9fe;color:#5b21b6">✉ borrador</span>'
      : ' <span class="tag" style="background:#ffedd5;color:#9a3412" title="Este borrador se hizo antes, con la regla anterior. Bórralo en Gmail para no mandarlo.">✉ borrador de antes: bórralo</span>';
    const telTag = l.telMalo ? ' <span class="tag" style="background:#fee2e2;color:#b91c1c" title="Ningún teléfono del lead sirve">📵 tel. inválido</span>' : l.telAviso ? ' <span class="tag" style="background:#fef3c7;color:#92400e">⚠ teléfono</span>' : "";
    li.innerHTML = `<div class="addr"><b>${esc(l.nombre)}</b> <span class="tag" style="background:${bg};color:${fg}">${t}</span>${telTag}${bor}
      <small>${esc(l.direccion)} · ${esc(l.tel)}${l.correo ? " · " + esc(l.correo) : ""}</small>
      <small>zBuyer: ${fecha(l.fechaCorreo)} · ID ${esc(l.leadIdZb)}</small>${loft}${l.telAviso ? `<small style="color:${l.telMalo ? "#b91c1c" : "#92400e"}">${esc(l.telAviso)}${l.telMalo ? " · ningún teléfono sirve" : ""}</small>` : ""}</div>`;
    const acc = document.createElement("div"); acc.className = "acc";
    const boton = (txt, fn, title) => { const b = document.createElement("button"); b.className = "mini"; b.textContent = txt; b.title = title || ""; b.onclick = fn; acc.appendChild(b); };
    if (["revisar", "nuevo", "otrafuente"].includes(l.estado)) boton("Reclamar", () => cambiar(l.leadIdZb, { estado: "repetido", aMano: true }),
      l.estado === "otrafuente" ? "Reclamarlo de todos modos, aunque no venía de zBuyer" : "Pasarlo a Redi para hacer el borrador a zBuyer");
    if (l.estado === "revisar" || (l.estado === "repetido" && l.borrador !== "hecho")) boton("Descartar", () => cambiar(l.leadIdZb, { estado: "descartado" }), "No reclamar este lead");
    li.appendChild(acc); ul.appendChild(li);
  }
}
async function cambiar(id, datos) {
  const { zbLeads = {} } = await chrome.storage.local.get("zbLeads");
  if (!zbLeads[id]) return;
  await zbPoner({ [id]: datos });
  svLog && svLog(datos.estado === "repetido" ? `${zbLeads[id].nombre}: lo mandé a Redi para reclamarlo a zBuyer.` : `${zbLeads[id].nombre}: descartado (no se reclama).`);
}

$("run").onclick = () => revisar(true);
$("stop").onclick = () => { parar = true; ver("Detenido."); };
$("filtro").onchange = pintar;
$("olvidar").onclick = async () => {
  if (!(await preguntar("¿Olvidar la lista? (no toca Gmail ni Lofty; los correos se vuelven a revisar en la próxima vuelta)", "Olvidar"))) return;
  await zbVaciar(); pintar();
};
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.zbLeads) pintar(); });

window.zbRevisar = revisar; // Capi
(async () => {
  await cargarCfg(); await aplicarRegla(); await pintar(); programar();
  if (cfg.auto) setTimeout(() => revisar(false), 4000);
})();
