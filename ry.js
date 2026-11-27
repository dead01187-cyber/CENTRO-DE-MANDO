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
// · Fase C: "Rayo corre en" Extensión (como siempre) / Sombra (la extensión trabaja y el puente solo
//   anota lo que haría; se comparan) / Puente (el puente trabaja aunque Brave esté cerrado; aquí solo se
//   ve, se aprueba y se configura). Si el puente se apaga en modo Puente, se avisa: con un clic vuelves
//   a "Extensión".
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
let donde = "extension", timerPuente = null; // Fase C: dónde corre Rayo

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
  const { ryDonde = "extension" } = await chrome.storage.local.get("ryDonde");
  donde = ["extension", "sombra", "puente"].includes(ryDonde) ? ryDonde : "extension";
  $("donde").value = donde;
}
async function guardarCfg() {
  CAMPOS.forEach((k) => (cfg[k] = $(k).value.trim() || DEF[k])); CHECKS.forEach((k) => (cfg[k] = $(k).checked));
  await chrome.storage.local.set({ ryConfig: cfg });
  if (donde !== "extension") await enviarConfig(); // Fase C: el puente usa la misma configuración
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
  if (donde === "puente") return verPuente(); // Fase C: busca el puente; aquí solo se ve
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
  const correr = async () => {
    const { [ULT]: u = 0 } = await chrome.storage.local.get(ULT);
    let w = u + 6000 + Math.random() * 6000 - Date.now();
    const p = window.SMS && SMS.turnoCompartido ? await SMS.turnoCompartido(cuenta, Math.max(0, w)) : null; // Fase B: turno entre todos (puente)
    if (p != null) w = Math.max(w, p);
    if (w > 0) await sleep(w);
    await chrome.storage.local.set({ [ULT]: Date.now() });
  };
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
      const no = document.createElement("button"); no.textContent = "Descartar"; no.onclick = async () => {
        if (donde === "puente") { if (window.PuenteCliente) await PuenteCliente.pedir("/rayo/descartar", { method: "POST", body: { id: t.leadId } }); return verPuente(); }
        t.estado = "descartado"; t.motivo = "lo descartaste"; await guardarTarjetas(); pintar(); };
      fila.append(si, no); li.querySelector(".addr").appendChild(fila);
    }
    ul.appendChild(li);
  }
}
async function aprobar(ids, por) {
  if (donde === "puente") { // Fase C: aprueba en el puente (botón o Capi)
    const r = window.PuenteCliente ? await PuenteCliente.pedir("/rayo/aprobar", { method: "POST", body: { ids: ids.map(String), por } }) : null;
    if (!r) { decir("Rayo: el puente no contestó; no pude aprobar. Revisa el puente o cambia 'Rayo corre en' a Extensión.", "error"); return 0; }
    if (r.aprobados) decir(`Rayo (puente): ${r.aprobados} lead(s) aprobados (${por}); los contacta ya.`);
    setTimeout(verPuente, 1500);
    return r.aprobados;
  }
  let n = 0;
  for (const id of ids) { const t = tarjetas[id]; if (t && t.estado === "por aprobar") { t.estado = "aprobado"; nota(t, `aprobado por ${por}`); n++; } }
  await guardarTarjetas(); pintar();
  if (n) { decir(`Rayo: ${n} lead(s) aprobados (${por}); los contacto ya.`); await procesarAprobadas(); }
  return n;
}
$("aprobarTodas").onclick = () => aprobar(Object.values(tarjetas).filter((x) => x.estado === "por aprobar").map((x) => x.leadId), "jefe");
$("revisar").onclick = async () => {
  if (donde === "puente" && window.PuenteCliente) { await PuenteCliente.pedir("/servicios/rayo/ahora", { method: "POST", body: {} }); setTimeout(verPuente, 2000); return; }
  buscar();
};

// Capi aprueba por voz: escribe { ids, por: "Capi (voz del jefe)" } en ryAprobar; Rayo lo toma de aquí.
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.ryAprobar && ch.ryAprobar.newValue && ch.ryAprobar.newValue.ids) { const a = ch.ryAprobar.newValue; chrome.storage.local.remove("ryAprobar"); aprobar(a.ids.map(String), a.por || "Capi"); }
  if (ch.ryTarjetas && !ocupado) { tarjetas = ch.ryTarjetas.newValue || {}; pintar(); }
});

function programar() {
  clearInterval(timer); clearInterval(timerPuente); timer = timerPuente = null;
  if (donde === "puente") { timerPuente = setInterval(verPuente, 10e3); verPuente(); }
  else {
    if (cfg.activo) timer = setInterval(buscar, 60e3);
    if (donde === "sombra") { timerPuente = setInterval(verPuente, 30e3); setTimeout(verPuente, 4000); }
  }
  pintarDonde();
}
window.Rayo = { buscar, aprobar, evaluar, tarjetas: () => tarjetas, donde: () => donde, verPuente }; // para pruebas
(async () => { await cargar(); pintar(); programar(); if (cfg.activo && donde !== "puente") setTimeout(buscar, 3000); })();

// =====================================================================
// Fase C: Rayo en el puente
// =====================================================================
const PC = () => window.PuenteCliente || null;
const TXT_DONDE = {
  extension: "Rayo trabaja aquí, en la extensión: solo mientras Brave y el Centro de Mando están abiertos.",
  sombra: "Prueba: Rayo trabaja aquí como siempre y el puente revisa los mismos leads y anota lo que HARÍA, sin mandar nada. Abajo ves si deciden igual. Cuando coincidan, cámbialo a Puente.",
  puente: "Rayo trabaja en el puente de tu Mac, aunque Brave esté cerrado. Aquí ves sus leads y los apruebas (o Capi por voz); la configuración de abajo se le manda al puente.",
};
function pintarDonde() {
  $("dondeTxt").textContent = TXT_DONDE[donde];
  $("sombraCaja").hidden = donde !== "sombra";
  $("activo").disabled = donde === "puente";
}

async function politica() { try { const c = await SMS.config(); return { desde: c.desde, hasta: c.hasta }; } catch (e) { return undefined; } }
async function enviarConfig(modo = donde) {
  if (!PC()) return null;
  const { activo, ...resto } = cfg;
  const { ryUltimo = 0 } = await chrome.storage.local.get("ryUltimo"); // el puente sigue desde aquí (no redescubre leads)
  return PC().pedir("/rayo/modo", { method: "POST", body: { modo, ultimo: ryUltimo, config: { ...resto, politica: await politica() } } });
}

async function cambiarDonde(nuevo) {
  const antes = donde;
  if (nuevo === antes) return;
  const regresar = (msg) => { $("donde").value = antes; decir(msg, "error"); };
  if (nuevo === "puente") {
    const pend = Object.values(tarjetas).filter((x) => ["por aprobar", "aprobado", "programado"].includes(x.estado));
    if (antes === "extension" || antes === "sombra") {
      if (pend.length) return regresar(`Antes de pasar Rayo al puente, aprueba o descarta los ${pend.length} lead(s) que tiene pendientes aquí.`);
      if (!confirm("Rayo va a trabajar en el puente de tu Mac (aunque Brave esté cerrado) y dejará de trabajar aquí. ¿Seguro?")) { $("donde").value = antes; return; }
    }
  }
  if (nuevo === "extension") {
    // Se avisa al puente que pare. Si no contesta (apagado), igual se regresa aquí: es la salida de emergencia.
    const r = PC() ? await PC().pedir("/rayo/modo", { method: "POST", body: { modo: "extension" } }) : null;
    const e = antes === "puente" && r && PC() ? await PC().pedir("/rayo/estado") : null;
    const { ryUltimo = 0 } = await chrome.storage.local.get("ryUltimo");
    if (antes === "puente") {
      // que la extensión no vuelva a "descubrir" los leads que ya atendió el puente
      const nuevoUltimo = e && e.ultimo ? Math.max(ryUltimo, e.ultimo) : Date.now();
      await chrome.storage.local.set({ ryUltimo: nuevoUltimo });
      if (!r) decir("Rayo regresó a la extensión con el puente apagado: los leads que llegaron mientras el puente estaba caído revísalos a mano en Lofty.", "error");
    }
  } else {
    const r = await enviarConfig(nuevo);
    if (!r) return regresar("El puente no contesta, así que Rayo sigue en la extensión. Revisa el robot Puente (clave e instalar.sh).");
  }
  donde = nuevo;
  await chrome.storage.local.set({ ryDonde: donde });
  decir(`Rayo ahora corre en: ${({ extension: "la extensión", sombra: "sombra (prueba)", puente: "el puente" })[donde]}.`);
  programar(); pintar();
}
$("donde").onchange = () => cambiarDonde($("donde").value);

let verPuenteOcupado = false;
async function verPuente() {
  if (!PC() || verPuenteOcupado) return null;
  verPuenteOcupado = true;
  try {
    const e = await PC().pedir("/rayo/estado");
    if (!e) { if (donde === "puente") await avisoPuenteCaido(); return null; }
    if (donde === "puente") {
      if (e.modo !== "puente") await enviarConfig("puente"); // el puente se reinstaló o lo apagaron: se le recuerda
      tarjetas = RAYO_SOMBRA.mapa(e.tarjetas);
      await chrome.storage.local.set({ ryTarjetas: tarjetas, ryRevisado: Date.now() }); // espejo: Capi y el Mando lo leen de aquí
      await traerDelPuente(e);
      pintar();
      await bitacoraPuente(e.log || []);
      window.robot && robot.set(e.estado === "feliz" ? "idle" : e.estado === "apagado" ? "error" : e.estado, e.texto);
    } else if (donde === "sombra") {
      if (e.modo !== "sombra") await enviarConfig("sombra");
      pintarSombra(e);
    }
    return e;
  } finally { verPuenteOcupado = false; }
}

async function avisoPuenteCaido() {
  const txt = "El puente está apagado: Rayo NO está trabajando. Prende el puente (puente/instalar.sh) o cambia 'Rayo corre en' a Extensión.";
  ver(txt); window.robot && robot.set("error", txt);
  const { ryAvisoT = 0 } = await chrome.storage.local.get("ryAvisoT");
  if (Date.now() - ryAvisoT > 10 * 60e3) { await chrome.storage.local.set({ ryAvisoT: Date.now() }); window.svLog && svLog(txt, "error"); }
}

// Lo que hizo el puente también tiene que verse en la extensión: fila de Marki, Anna silenciada, registro de SMS y Cerebro
async function traerDelPuente(e) {
  if ((e.cola || []).length) {
    const { alCola = [] } = await chrome.storage.local.get("alCola");
    const ya = new Set(alCola.map((x) => String(x.leadId)));
    const nuevos = e.cola.filter((x) => !ya.has(String(x.leadId)));
    if (nuevos.length) await chrome.storage.local.set({ alCola: [...alCola, ...nuevos] });
    await PC().pedir("/rayo/cola/tomar", { method: "POST", body: { ids: e.cola.map((x) => String(x.leadId)) } });
  }
  if (e.silenciados && Object.keys(e.silenciados).length) {
    const { annaSilenciados = {} } = await chrome.storage.local.get("annaSilenciados");
    let n = 0; for (const [k, v] of Object.entries(e.silenciados)) if (!annaSilenciados[k]) { annaSilenciados[k] = v; n++; }
    if (n) await chrome.storage.local.set({ annaSilenciados });
  }
  const { ryRegistroDesde = 0 } = await chrome.storage.local.get("ryRegistroDesde");
  const r = await PC().pedir(`/rayo/registro?desde=${Math.floor(ryRegistroDesde)}`);
  if (r && (r.registro || []).length) {
    const conCandado = (fn) => (navigator.locks ? navigator.locks.request("politica-sms", fn) : fn());
    await conCandado(async () => {
      const { smsRegistro = [] } = await chrome.storage.local.get("smsRegistro");
      const ya = new Set(smsRegistro.map((x) => x.id).filter(Boolean));
      const nuevos = r.registro.filter((x) => !ya.has(x.id)).map((x) => ({ ...x, puente: true }));
      if (nuevos.length) await chrome.storage.local.set({ smsRegistro: [...smsRegistro, ...nuevos].slice(-5000) });
    });
    await chrome.storage.local.set({ ryRegistroDesde: Math.max(...r.registro.map((x) => x.t)) + 1 });
  }
  await PC().sincronizar(true); // contactos que Rayo anotó en el árbitro → Cerebro local (para el Marcador)
}

// Las líneas nuevas del log del puente van a la bitácora del Mando
async function bitacoraPuente(log) {
  if (!log.length) return;
  const { ryLogVisto = "" } = await chrome.storage.local.get("ryLogVisto");
  const i = log.lastIndexOf(ryLogVisto);
  const nuevas = i >= 0 ? log.slice(i + 1) : log.slice(-3);
  for (const l of nuevas) window.svLog && svLog("Rayo (puente): " + l.replace(/^\d\d:\d\d:\d\d\s+/, ""));
  await chrome.storage.local.set({ ryLogVisto: log[log.length - 1] });
}

function pintarSombra(e) {
  const c = RAYO_SOMBRA.comparar(tarjetas, RAYO_SOMBRA.mapa(e.tarjetas));
  $("sombraRes").textContent = c.comparables
    ? `${c.pct}% iguales: ${c.iguales} iguales · ${c.distintos} distintos · ${c.pendientes} pendientes${c.soloExt || c.soloPuente ? ` · ${c.soloExt} solo aquí · ${c.soloPuente} solo en el puente` : ""}`
    : `Todavía no hay leads para comparar (${c.pendientes} pendientes${c.soloExt || c.soloPuente ? `, ${c.soloExt} solo aquí, ${c.soloPuente} solo en el puente` : ""}).`;
  const ul = $("sombraLista"); ul.textContent = "";
  for (const f of c.filas.filter((x) => x.tipo !== "pendiente").slice(0, 40)) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="addr"><b>${esc(f.nombre)}</b> <span class="tag ${f.tipo === "igual" ? "ok" : f.tipo === "distinto" ? "bad" : "wait"}">${esc(f.tipo)}</span>
      <small>Extensión: ${esc(f.extension)}${f.motivoExt ? ` (${esc(f.motivoExt)})` : ""} · Puente: ${esc(f.puente)}${f.motivoPuente ? ` (${esc(f.motivoPuente)})` : ""}</small></div>`;
    ul.appendChild(li);
  }
  chrome.storage.local.set({ ryComparacion: { t: Date.now(), iguales: c.iguales, distintos: c.distintos, pendientes: c.pendientes, pct: c.pct } });
}
