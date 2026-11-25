// =====================================================================
// Rayo (Fase Anna 1): llega antes que Anna a los leads nuevos.
// · Cada 60 s busca en Lofty los leads creados desde la última vez (solo de las fuentes elegidas,
//   por defecto zBuyer, para no tocar los que suben tus propios robots).
// · Filtros: número de California, sin DNC, sin cannotText / unsubscribe, sin duplicados.
// · A cada lead que pasa le prepara: SMS personalizado (nombre y ciudad), email de presentación
//   y lugar en la cola de Marki para llamarlo.
// · "Con mi OK" (por defecto): espera tu clic (o que se lo digas a Capi). "Automático": sale solo.
// · Carrera con Anna, justo antes de contactar:
//     - si Anna YA le escribió (SMS con textType "AI") → ganó Anna: Rayo no lo toca (sin doble contacto);
//     - si no → Rayo gana: silencia a Anna en ese lead (si está en su pool) y luego contacta.
//   Anna a veces mete al lead a su pool unos minutos después: Rayo vigila 30 min los que ganó y la silencia.
// · Todo pasa por el Cerebro (24 h entre todos, una persona le escribió) y la política de SMS
//   (bajas, horario 8–21 h California, solo CA). Nada sale de noche: se queda "programado".
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const tc = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const tiempo = (s) => Date.parse(String(s || "").replace(/GMT$/, "Z").replace(/P[SD]T$/, "")) || 0;
const fecha = (ms) => ms ? new Date(ms).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const d10 = (t) => { let d = String(t || "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d.length === 10 ? d : ""; };
const bonito = (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
const VIGILAR_MS = 30 * 60e3;

const DEF = {
  activo: true, modo: "ok", cuenta: "txKey", fuentes: "zBuyer", sms: true, email: true, marki: true,
  smsSeller: "Hi {nombre}, this is Mark with Rubio Real Estate. I saw your request about your home in {ciudad}. When's a good time for a quick call about its value? Reply STOP to opt out.",
  smsBuyer: "Hi {nombre}, this is Mark with Rubio Real Estate. I saw you're looking for a home in {ciudad}. What are you looking for? I can send you the best options. Reply STOP to opt out.",
  emailAsunto: "Your home in {ciudad}",
  emailCuerpo: "Hi {nombre},\n\nThanks for reaching out about your home in {ciudad}. I'm Mark with Rubio Real Estate. I'd be glad to prepare a free, no-obligation estimate of what your home could sell for in today's market and walk you through your options.\n\nWhat's a good time for a quick call?\n\nBest,\nMark\nRubio Real Estate",
};
let cfg = { ...DEF }, tarjetas = {}, ocupado = false, timer = null;

// ---------- API de Lofty con la cuenta elegida ----------
async function api(path, opts = {}) {
  const st = await chrome.storage.local.get([cfg.cuenta]);
  const key = st[cfg.cuenta];
  if (!key) throw Object.assign(new Error(`Falta la API key de la cuenta elegida (${cfg.cuenta === "txKey" ? "la de Texi" : "la principal, de Lofti"}).`), { sinKey: true });
  let r;
  for (let i = 0; ; i++) {
    r = await fetch("https://api.lofty.com" + path, { method: opts.method || "GET", headers: { Authorization: "token " + key, "X-Error-Status": "true", ...(opts.body ? { "Content-Type": "application/json" } : {}) }, ...(opts.body ? { body: JSON.stringify(opts.body) } : {}) });
    if (r.status !== 429 || i >= 3) break;
    await sleep((parseInt(r.headers.get("X-RateLimit-Reset") || "", 10) || 2000 * 2 ** i) + 200);
  }
  const txt = await r.text(); let d = {}; try { d = txt ? JSON.parse(txt) : {}; } catch (e) { d = {}; }
  if (!r.ok) throw Object.assign(new Error(`Lofty respondió ${r.status}${d.message ? ": " + String(d.message).slice(0, 140) : ""}`), { status: r.status });
  return d;
}

// ---------- Configuración ----------
const CAMPOS = ["modo", "cuenta", "fuentes", "smsSeller", "smsBuyer", "emailAsunto", "emailCuerpo"];
const CHECKS = ["activo", "sms", "email", "marki"];
async function cargar() {
  const { ryConfig = {}, ryTarjetas = {} } = await chrome.storage.local.get(["ryConfig", "ryTarjetas"]);
  cfg = { ...DEF, ...ryConfig }; tarjetas = ryTarjetas;
  // Ahora se presenta como Mark (antes Christopher): actualiza los textos guardados
  let cambio = false;
  for (const k of ["smsSeller", "smsBuyer", "emailCuerpo"]) { const v = String(cfg[k] || "").replace(/Christopher Rubio-Novack/g, "Mark").replace(/\bChristopher\b/g, "Mark"); if (v !== cfg[k]) { cfg[k] = v; cambio = true; } }
  if (cambio) await chrome.storage.local.set({ ryConfig: cfg });
  CAMPOS.forEach((k) => ($(k).value = cfg[k])); CHECKS.forEach((k) => ($(k).checked = !!cfg[k]));
}
async function guardarCfg() {
  CAMPOS.forEach((k) => (cfg[k] = $(k).value.trim() || DEF[k])); CHECKS.forEach((k) => (cfg[k] = $(k).checked));
  await chrome.storage.local.set({ ryConfig: cfg });
}
[...CAMPOS, ...CHECKS].forEach((k) => ($(k).onchange = async () => { await guardarCfg(); pintar(); programar(); }));
const guardarTarjetas = async () => {
  const ks = Object.keys(tarjetas); if (ks.length > 500) ks.sort((a, b) => tarjetas[a].creado - tarjetas[b].creado).slice(0, ks.length - 500).forEach((k) => delete tarjetas[k]);
  await chrome.storage.local.set({ ryTarjetas: tarjetas });
};

// ---------- Datos del lead ----------
const OPTOUT = /unsubscrib|do not (text|call)|opt.?out|dnc/i;
function evaluar(l) {
  const id = String(l.leadId || l.id);
  const tipos = [].concat(l.leadTypes || [], l.leadType != null ? l.leadType : []).map(Number);
  const phones = [].concat(l.phones || []).map((p) => d10(p && typeof p === "object" ? p.phone || p.number : p));
  const st = [].concat(l.phoneStatuses || []).map(Number), cons = [].concat(l.phoneConsentStates || []);
  const tels = [...new Set(phones.filter((p, i) => p && SMS.esCA(p) && st[i] !== 4 && st[i] !== 5 && !OPTOUT.test(String(cons[i] || ""))))];
  const props = l.leadPropertyList || [];
  const p = props.find((x) => /home/i.test(x.label || "") && x.city) || props.find((x) => x.city) || l;
  const t = { leadId: id, nombre: tc(l.firstName || "").split(" ")[0] || "there", apellido: tc(l.lastName || ""), ciudad: tc(p.city || ""), calle: tc(p.streetAddress || ""),
    tels, email: [].concat(l.emails || [])[0] || "", fuente: l.source || "", comprador: tipos.includes(2) && !tipos.includes(1),
    creado: tiempo(l.createTime) || Date.now(), visto: Date.now(), estado: "por aprobar", motivo: "", log: [] };
  if (l.cannotText === true || l.unsubscription === true) return { ...t, estado: "descartado", motivo: "Lofty dice que no recibe textos (cannotText / unsubscribe)" };
  if (!phones.some(Boolean)) return { ...t, estado: "descartado", motivo: "no tiene teléfono" };
  if (!tels.length) return { ...t, estado: "descartado", motivo: phones.some((x) => x && !SMS.esCA(x)) ? "sus números no son de California" : "sus números están como DNC / Do Not Text" };
  return t;
}
const rellenar = (txt, t) => String(txt || "").replace(/\{nombre\}/gi, t.nombre).replace(/\{apellido\}/gi, t.apellido).replace(/\{ciudad\}/gi, t.ciudad || "your area").replace(/\{direccion\}/gi, t.calle || "your home").trim();
const smsDe = (t) => rellenar(t.comprador ? cfg.smsBuyer : cfg.smsSeller, t);

// ¿Ya existe otro lead con el mismo teléfono o correo? (duplicado, como revisa Chequi)
async function duplicado(t) {
  for (const tel of t.tels) {
    const d = await api(`/v1.0/leads?limit=5&phone=${encodeURIComponent(tel)}`);
    const otro = (d.leads || []).find((x) => String(x.leadId) !== t.leadId);
    if (otro) return `ya existe otro lead con el ${bonito(tel)} (${tc(otro.firstName || "")} ${tc(otro.lastName || "")}, id ${otro.leadId})`;
    await sleep(250);
  }
  return "";
}

// ---------- 1) Buscar leads nuevos ----------
async function buscar() {
  if (ocupado || !cfg.activo) return;
  ocupado = true;
  try {
    let { ryUltimo } = await chrome.storage.local.get("ryUltimo");
    if (!ryUltimo) ryUltimo = Date.now() - 15 * 60e3; // la primera vez: solo los de los últimos 15 min
    const d = await api("/v1.0/leads?limit=50&offset=0");
    const fuentes = cfg.fuentes.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const nuevos = (d.leads || []).filter((l) => tiempo(l.createTime) > ryUltimo && !tarjetas[String(l.leadId)]);
    let maxT = ryUltimo;
    for (const l of nuevos.sort((a, b) => tiempo(a.createTime) - tiempo(b.createTime))) {
      maxT = Math.max(maxT, tiempo(l.createTime));
      if (fuentes.length && !fuentes.includes(String(l.source || "").toLowerCase())) continue; // otra fuente: no es de Rayo
      let t = evaluar(l);
      if (t.estado !== "descartado") { const dup = await duplicado(t).catch((e) => `no pude revisar duplicados (${e.message}); por seguridad no lo toco`); if (dup) t = { ...t, estado: "descartado", motivo: dup }; }
      if (t.estado !== "descartado") { t.sms = smsDe(t); t.emailAsunto = rellenar(cfg.emailAsunto, t); t.emailCuerpo = rellenar(cfg.emailCuerpo, t); }
      tarjetas[t.leadId] = t;
      decir(t.estado === "descartado" ? `Rayo: lead nuevo ${t.nombre} ${t.apellido} descartado: ${t.motivo}.` : `Rayo: lead nuevo ${t.nombre} ${t.apellido} (${t.ciudad || "sin ciudad"}) ${cfg.modo === "auto" ? "— lo contacto ya" : "— esperando tu OK"}.`);
      if (t.estado === "por aprobar" && cfg.modo === "auto") t.estado = "aprobado";
    }
    await chrome.storage.local.set({ ryUltimo: maxT, ryRevisado: Date.now() });
    await guardarTarjetas(); pintar();
    await procesarAprobadas();
    await vigilarAnna();
    window.robot && robot.set(Object.values(tarjetas).some((x) => x.estado === "por aprobar") ? "ayuda" : "idle", resumen());
  } catch (e) {
    decir(e.sinKey ? e.message : `Rayo no pudo revisar Lofty: ${e.message}`, "error");
    window.robot && robot.set("error", "No pude revisar Lofty");
  } finally { ocupado = false; }
}
const resumen = () => { const v = Object.values(tarjetas), n = (e) => v.filter((x) => x.estado === e).length; return `${n("por aprobar")} por aprobar · ${n("hecho")} contactados · ${n("ganó Anna")} ganó Anna`; };

// ---------- 2) Contactar (aprobado por ti, por Capi o en automático) ----------
async function procesarAprobadas() {
  for (const t of Object.values(tarjetas).filter((x) => x.estado === "aprobado" || x.estado === "programado")) {
    if (!cfg.activo) break;
    await contactar(t);
    await guardarTarjetas(); pintar();
  }
}
const nota = (t, s) => { t.log = [...(t.log || []), `${fecha(Date.now())} ${s}`].slice(-12); };

async function contactar(t) {
  const enHora = SMS.enHorario(await SMS.config());
  if (!enHora && cfg.sms) { if (t.estado !== "programado") { t.estado = "programado"; nota(t, "fuera de horario: sale a las 8 am (California)"); } return; }
  t.estado = "contactando"; pintar();
  try {
    // a) Carrera con Anna: ¿ya le escribió? (historial fresco de Lofty)
    const filas = await api(`/v1.0/communication/text?leadId=${encodeURIComponent(t.leadId)}&limit=40`);
    const textos = (filas.texts || filas.data || []).map(CEREBRO_CORE.deLofty);
    if (CEREBRO_CORE.annaYaEscribio(textos)) { t.estado = "ganó Anna"; nota(t, "Anna ya le había escrito: no lo toco para no dar doble contacto"); decir(`Rayo: Anna llegó primero con ${t.nombre} ${t.apellido}.`); return; }
    // b) Cerebro: 24 h entre todos y "una persona le escribió" (Anna la resuelve Rayo aquí mismo)
    const cb = await Cerebro.puedo({ leadId: t.leadId, canal: "sms", robot: "Rayo", llave: cfg.cuenta, respetaAnna: false });
    if (!cb.ok) { t.estado = cb.codigo === "error" ? "error" : "saltado"; t.motivo = cb.motivo; nota(t, "Cerebro: " + cb.motivo); return; }
    // c) Rayo gana: silenciar a Anna ANTES de contactar (si no se puede, no contacta: evitar doble contacto)
    const an = await Cerebro.anna(t.leadId);
    if (an.enPool && !an.silenciado) {
      const ok = await Cerebro.silenciarAnna(t.leadId, "Rayo llegó primero", "Rayo");
      if (!ok) { t.estado = "error"; t.motivo = "no pude silenciar a Anna; no lo contacto para no dar doble contacto"; nota(t, t.motivo); return; }
      nota(t, "silencié a Anna en este lead");
    } else { const { ryVigilar = {} } = await chrome.storage.local.get("ryVigilar"); ryVigilar[t.leadId] = Date.now(); await chrome.storage.local.set({ ryVigilar }); }
    // d) Cola de Marki (llamada)
    if (cfg.marki) {
      const { alCola = [] } = await chrome.storage.local.get("alCola");
      if (!alCola.some((x) => String(x.leadId) === t.leadId)) { alCola.push({ leadId: t.leadId, t: Date.now(), nombre: `${t.nombre} ${t.apellido}`.trim() }); await chrome.storage.local.set({ alCola }); }
      nota(t, "en la cola de Marki para llamarlo");
    }
    // e) SMS (política: bajas, horario, CA; ritmo humano compartido con Texi si es la misma cuenta)
    let smsOk = false;
    if (cfg.sms && t.sms) {
      const num = t.tels[0];
      const pol = await SMS.puedeMandar({ tel: num, leadId: t.leadId, cuenta: cfg.cuenta === "txKey" ? "tx" : "lofty", fuente: "Rayo" });
      if (!pol.ok) { await SMS.anotar({ fuente: "Rayo", leadId: t.leadId, tel: num, estado: "bloqueado", motivo: pol.motivo }); nota(t, "SMS no: " + pol.motivo); }
      else {
        await turno(cfg.cuenta === "txKey" ? "tx" : "lofty");
        try { await api("/v1.0/message/sms/send", { method: "POST", body: { leadId: Number(t.leadId), content: t.sms, phoneNumber: num, phoneCode: "1" } });
          await SMS.anotar({ fuente: "Rayo", leadId: t.leadId, tel: num, estado: "enviado", texto: t.sms }); smsOk = true; nota(t, `SMS a ${bonito(num)}`); }
        catch (e) { await SMS.devolverLugar(); await SMS.anotar({ fuente: "Rayo", leadId: t.leadId, tel: num, estado: "error", motivo: e.message }); nota(t, "SMS falló: " + e.message); }
      }
    }
    // f) Email de presentación
    if (cfg.email && t.email && t.emailAsunto) {
      const cbE = await Cerebro.puedo({ leadId: t.leadId, canal: "email", robot: "Rayo", llave: cfg.cuenta, respetaAnna: false });
      if (!cbE.ok) nota(t, "email no: " + cbE.motivo);
      else try { await api("/v1.0/message/email/send", { method: "POST", body: { leadId: Number(t.leadId), subject: t.emailAsunto, content: t.emailCuerpo.replace(/\n/g, "<br>") } });
        await Cerebro.anotar({ leadId: t.leadId, canal: "email", robot: "Rayo" }); nota(t, "email enviado"); }
      catch (e) { nota(t, "email falló: " + e.message); }
    }
    t.estado = smsOk || !cfg.sms ? "hecho" : "error"; t.contactado = Date.now();
    t.segundos = Math.round((t.contactado - t.creado) / 1000);
    decir(`Rayo contactó a ${t.nombre} ${t.apellido} ${Math.round(t.segundos / 60)} min después de que entró a Lofty.`);
  } catch (e) {
    t.estado = "error"; t.motivo = e.message; nota(t, "error: " + e.message);
    decir(`Rayo no pudo contactar a ${t.nombre} ${t.apellido}: ${e.message}`, "error");
  }
}
// Ritmo humano: un SMS cada 6–12 s por número (mismo candado que Texi y Compri)
async function turno(cuenta) {
  const ULT = cuenta === "tx" ? "smsUltimoTx" : "smsUltimo_" + cuenta;
  const correr = async () => { const { [ULT]: u = 0 } = await chrome.storage.local.get(ULT); const w = u + 6000 + Math.random() * 6000 - Date.now(); if (w > 0) await sleep(w); await chrome.storage.local.set({ [ULT]: Date.now() }); };
  return navigator.locks ? navigator.locks.request("sms-numero-" + cuenta, correr) : correr();
}

// ---------- 3) Vigilar 30 min: si Anna mete al lead a su pool después, silenciarla ----------
async function vigilarAnna() {
  const { ryVigilar = {} } = await chrome.storage.local.get("ryVigilar");
  const ids = Object.keys(ryVigilar).filter((k) => Date.now() - ryVigilar[k] < VIGILAR_MS);
  if (ids.length) {
    const pool = new Set((await Cerebro.poolAnna(true).catch(() => [])).map((x) => x.leadId));
    for (const id of ids.filter((k) => pool.has(k))) {
      const ok = await Cerebro.silenciarAnna(id, "Rayo llegó primero (entró al pool después)", "Rayo").catch(() => false);
      if (ok) { delete ryVigilar[id]; const t = tarjetas[id]; if (t) nota(t, "Anna lo metió a su pool después: la silencié"); }
    }
  }
  for (const k of Object.keys(ryVigilar)) if (Date.now() - ryVigilar[k] >= VIGILAR_MS) delete ryVigilar[k];
  await chrome.storage.local.set({ ryVigilar });
}

// ---------- Pantalla ----------
const ETQ = { "por aprobar": "wait", aprobado: "wait", programado: "wait", contactando: "wait", hecho: "ok", "ganó Anna": "bad", saltado: "wait", descartado: "", error: "bad" };
function pintar() {
  const v = Object.values(tarjetas).sort((a, b) => b.creado - a.creado);
  const pend = v.filter((x) => x.estado === "por aprobar");
  $("nPend").textContent = pend.length; $("nHechos").textContent = v.filter((x) => x.estado === "hecho").length; $("nAnna").textContent = v.filter((x) => x.estado === "ganó Anna").length;
  const prom = v.filter((x) => x.segundos != null); $("nTiempo").textContent = prom.length ? Math.round(prom.reduce((s, x) => s + x.segundos, 0) / prom.length / 60) + " min" : "—";
  $("aprobarTodas").hidden = !pend.length;
  $("modoTxt").textContent = cfg.modo === "auto" ? "Automático: contacta solo, sin esperar tu OK." : "Con mi OK: espera tu clic (o que se lo digas a Capi). Para ganarle a Anna, aprueba en menos de ~10 min.";
  const ul = $("lista"); ul.textContent = "";
  if (!v.length) { ul.innerHTML = `<li class="empty">Todavía no llegan leads nuevos de ${esc(cfg.fuentes || "ninguna fuente")}. Reviso Lofty cada 60 segundos.</li>`; return; }
  for (const t of v.slice(0, 80)) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="addr"><b>${esc(`${t.nombre === "there" ? "" : t.nombre} ${t.apellido}`.trim() || "(sin nombre)")}</b> <span class="tag ${ETQ[t.estado] || ""}">${esc(t.estado)}</span>
      <small>${esc([t.ciudad, t.fuente, t.comprador ? "Buyer" : "Seller", t.tels.map(bonito).join(" · "), "entró " + fecha(t.creado)].filter(Boolean).join(" · "))}</small>
      ${t.motivo ? `<small>${esc(t.motivo)}</small>` : ""}
      ${t.sms && t.estado !== "descartado" ? `<div class="sms">${esc(t.sms)}</div>` : ""}
      ${t.log && t.log.length ? `<small>${t.log.map(esc).join("<br>")}</small>` : ""}</div>`;
    if (t.estado === "por aprobar") {
      const fila = document.createElement("div"); fila.className = "row";
      const si = document.createElement("button"); si.className = "primary"; si.textContent = "Aprobar y contactar"; si.onclick = () => aprobar([t.leadId], "jefe");
      const no = document.createElement("button"); no.textContent = "Descartar"; no.onclick = async () => { t.estado = "descartado"; t.motivo = "lo descartaste"; await guardarTarjetas(); pintar(); };
      fila.append(si, no); li.querySelector(".addr").appendChild(fila);
    }
    ul.appendChild(li);
  }
}
async function aprobar(ids, por) {
  let n = 0;
  for (const id of ids) { const t = tarjetas[id]; if (t && t.estado === "por aprobar") { t.estado = "aprobado"; nota(t, `aprobado por ${por}`); n++; } }
  await guardarTarjetas(); pintar();
  if (n) { decir(`Rayo: ${n} lead(s) aprobados (${por}); los contacto ya.`); await procesarAprobadas(); }
  return n;
}
$("aprobarTodas").onclick = () => aprobar(Object.values(tarjetas).filter((x) => x.estado === "por aprobar").map((x) => x.leadId), "jefe");
$("revisar").onclick = () => buscar();

// Capi aprueba por voz: escribe { ids, por: "Capi (voz del jefe)" } en ryAprobar; Rayo lo toma de aquí.
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.ryAprobar && ch.ryAprobar.newValue && ch.ryAprobar.newValue.ids) { const a = ch.ryAprobar.newValue; chrome.storage.local.remove("ryAprobar"); aprobar(a.ids.map(String), a.por || "Capi"); }
  if (ch.ryTarjetas && !ocupado) { tarjetas = ch.ryTarjetas.newValue || {}; pintar(); }
});

function programar() { clearInterval(timer); if (cfg.activo) timer = setInterval(buscar, 60e3); }
window.Rayo = { buscar, aprobar, evaluar, tarjetas: () => tarjetas }; // para pruebas
(async () => { await cargar(); pintar(); programar(); if (cfg.activo) setTimeout(buscar, 3000); })();
