// =====================================================================
// Limpi: limpia TODO el CRM (todas las etapas; sellers y buyers) y pasa a
// "No Active Plans" a los que cumplen CUALQUIERA de:
//   a) dijeron STOP / unsubscribe en un SMS recibido, o Lofty los tiene
//      marcados (unsubscription, cannotText, phoneConsentStates Do Not Text/Call)
//   b) no tienen propiedad (SOLO sellers [1]; a los buyers no se les aplica)
//   c) no tienen teléfono (phones vacío)
// Incremental: SMS de las últimas ~26 h + leads de la etapa creados en los
// últimos ~2 días (ordenados por CreateTime, más nuevos primero).
// Excepciones (no se mueven, quedan para revisar): "Zapier", "Prueba", "HOT" en el nombre.
// En Ajustes se puede limitar a una sola etapa.
// No cambia tags ni borra nada.
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const hoy = () => new Date().toLocaleDateString("en-CA");
const tc = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const D = 864e5, H = 36e5;

const DEF = { v: 3, cuenta: "lofty", etapa: "", destino: "No Active Plans", horas: 0, dias: 0, auto: true, hora: 8, soloRevisar: false };
const MOTIVO = { stop: "STOP / unsubscribe", sinProp: "sin propiedad", sinNum: "sin número" };
let cfg = { ...DEF }, corriendo = false, parar = false;

// ---------- API de Lofty ----------
async function api(path, opts = {}) {
  const k = cfg.cuenta === "tx" ? "txKey" : "loftyKey";
  const key = (await chrome.storage.local.get(k))[k];
  if (!key) throw Object.assign(new Error(cfg.cuenta === "tx" ? "Falta la API key de la cuenta de Texi (pestaña Texi, 🔑)." : "Falta la API key de Lofty (pestaña Lofty)."), { sinKey: true });
  let r;
  for (let intento = 0; ; intento++) {
    r = await fetch("https://api.lofty.com" + path, {
      method: opts.method || "GET",
      headers: { Authorization: "token " + key, "X-Error-Status": "true", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });
    if ((r.status !== 429 && r.status !== 503) || intento >= 4) break;
    const ra = parseInt(r.headers.get("Retry-After") || "", 10);
    await sleep((ra > 0 ? ra * 1000 : 2000 * 2 ** intento) + Math.random() * 400);
  }
  const cuerpo = await r.text();
  let d = {}; try { d = cuerpo ? JSON.parse(cuerpo) : {}; } catch (e) { d = { message: cuerpo }; }
  if (!r.ok) throw Object.assign(new Error(`Lofty respondió ${r.status}` + (d.message ? `: ${String(d.message).slice(0, 140)}` : "")), { status: r.status });
  return d;
}
const filas = (d) => (Array.isArray(d) ? d : d.leads || d.data || d.texts || d.list || d.items || d.communications || []);
const tiempo = (s) => {
  if (typeof s === "number") return s < 1e12 ? s * 1000 : s;
  const t = String(s || "").trim(); if (!t) return 0;
  if (/^\d+$/.test(t)) return tiempo(Number(t));
  return Date.parse(t.replace(/GMT$/, "Z")) || Date.parse(t.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? "" : "Z")) || 0;
};
const entra = (x) => /^\s*in/i.test(String(x.direction || x.textDirection || ""));
const textoDe = (x) => String(x.textContent || x.content || x.body || x.message || x.text || "").trim();
const idDe = (l) => String(l.leadId || l.id || "");
const nombreDe = (l) => tc(`${l.firstName || ""} ${l.lastName || ""}`.trim()) || `Lead ${idDe(l)}`;
async function leerLead(id) { const d = await api(`/v1.0/leads/${encodeURIComponent(id)}`); return d.lead || d.data || d; }

// ---------- Reglas ----------
// Tipos: 1 = Seller, 2 = Buyer. Solo cuenta si es EXACTAMENTE [1].
function tipos(l) {
  const crudo = l.leadTypes != null ? [].concat(l.leadTypes) : l.leadType != null ? [].concat(l.leadType) : [];
  return crudo.map((t) => {
    const v = t && typeof t === "object" ? t.id ?? t.typeId ?? t.name ?? t.typeName : t;
    if (/^\d+$/.test(String(v))) return Number(v);
    if (/seller/i.test(String(v))) return 1; if (/buyer/i.test(String(v))) return 2; return String(v);
  });
}
const soloSeller = (l) => { const t = [...new Set(tipos(l))]; return t.length === 1 && t[0] === 1; };
const marcadoBaja = (l) => l.unsubscription === true || l.cannotText === true ||
  [].concat(l.phoneConsentStates || []).some((s) => /unsubscrib|do not (text|call)/i.test(String(s && typeof s === "object" ? s.state || s.name || "" : s)));
const sinPropiedad = (l) => !(l.leadPropertyList || []).some((p) => p && String(p.streetAddress || "").trim()) && !String(l.streetAddress || "").trim();
const sinNumero = (l) => ![].concat(l.phones || []).filter((p) => p && String(typeof p === "object" ? p.phone || p.number || p.value || "" : p).trim()).length;
const enAlcance = (l) => norm(l.stage) !== norm(cfg.destino) && (!cfg.etapa || norm(l.stage) === norm(cfg.etapa));
const excepcion = (l) => { const n = `${l.firstName || ""} ${l.lastName || ""}`; return /zapier|prueba/i.test(n) || /\bhot\b/i.test(n); };

// STOP claro → se mueve. "stop" suelto en otra frase (ej. "stop by the house") → revisar a mano.
const limpio = (t) => String(t || "").toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z\s']/g, " ").replace(/\s+/g, " ").trim();
const STOP_SOLO = /^(please )?(stop|stopall|stop all|unsubscribe|quit|cancel|end|remove|remove me|stop texting( me)?|stop it|stop please|stop now)( please| thanks| thank you)?$/;
const STOP_FRASE = /\b(unsubscribe|stop ?all|stop (texting|messaging|contacting|sending|calling)|remove me|take me off|opt ?out|do ?n'?t (text|contact|message) me|no more (texts|messages))\b/;
function esStop(texto) {
  const s = limpio(texto); if (!s) return null;
  if (STOP_SOLO.test(s) || STOP_FRASE.test(s)) return "si";
  if (/\b(stop|unsubscribe)\b/.test(s)) return "revisar";
  return null;
}

// ---------- Configuración ----------
async function cargar() {
  const { liConfig = {} } = await chrome.storage.local.get("liConfig");
  cfg = { ...DEF, ...liConfig };
  if (!liConfig.v) cfg.etapa = ""; // ahora limpia todo el CRM
  if ((liConfig.v || 0) < 3) { cfg.horas = 0; cfg.dias = 0; cfg.v = 3; chrome.storage.local.set({ liConfig: cfg }); } // 0 = sin límite de fecha
  const h = $("hora");
  if (!h.options.length) for (let i = 0; i < 24; i++) h.add(new Option(`${String(i).padStart(2, "0")}:00`, String(i)));
  $("cuenta").value = cfg.cuenta; $("hora").value = String(cfg.hora); $("etapa").value = cfg.etapa; $("destino").value = cfg.destino;
  $("horas").value = cfg.horas; $("dias").value = cfg.dias; $("auto").checked = !!cfg.auto; $("soloRevisar").checked = !!cfg.soloRevisar;
}
function guardarCfg() {
  cfg = { ...cfg, cuenta: $("cuenta").value, hora: parseInt($("hora").value, 10) || 0,
    etapa: $("etapa").value.trim(), destino: $("destino").value.trim() || DEF.destino,
    horas: Math.max(0, parseInt($("horas").value, 10) || 0), dias: Math.max(0, parseInt($("dias").value, 10) || 0),
    auto: $("auto").checked, soloRevisar: $("soloRevisar").checked };
  chrome.storage.local.set({ liConfig: cfg });
}
["cuenta", "hora", "etapa", "destino", "horas", "dias", "auto", "soloRevisar"].forEach((id) => ($(id).onchange = guardarCfg));

// ---------- 1) SMS recibidos con STOP ----------
async function smsStop(rep, todo) {
  const fin = Date.now(), ini = todo || !cfg.horas ? 0 : fin - cfg.horas * H;
  const porLead = new Map(); // leadId → [textos]
  // Lofty solo deja pedir ~90 días por consulta: se va hacia atrás en ventanas de 89 días.
  // Sin límite (ini = 0) se para cuando 4 ventanas seguidas (~1 año) ya no traen ningún texto.
  const VENT = 89 * D;
  let hasta = fin, vacias = 0, ventanas = 0;
  while (hasta > ini && !parar && ventanas < 80) {
    const desde = Math.max(ini, hasta - VENT);
    let cursor = "", paginas = 0, enVentana = 0;
    ver(`Leyendo SMS recibidos… hasta ${new Date(hasta).toLocaleDateString("es-MX", { month: "short", year: "numeric" })} · ${porLead.size} leads con respuesta`);
    do {
      if (parar) return new Map();
      const d = await api(`/v2.0/communication/agent?type=TEXT&startTime=${Math.floor(desde)}&endTime=${Math.floor(hasta)}&limit=1000` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""));
      const fs = filas(d); enVentana += fs.length;
      for (const x of fs) if (entra(x) && x.leadId) {
        const id = String(x.leadId); if (!porLead.has(id)) porLead.set(id, []);
        const t = textoDe(x); if (t) porLead.get(id).push(t);
      }
      cursor = d.nextCursor || d.cursor || ""; paginas++;
      if (cursor) await sleep(300);
    } while (cursor && paginas < 200);
    vacias = enVentana ? 0 : vacias + 1; ventanas++;
    if (!ini && vacias >= 4) break;
    hasta = desde; await sleep(300);
  }
  rep.smsLeads = porLead.size;
  const stops = new Map(); let i = 0;
  for (const [id, textos] of porLead) {
    if (parar) break;
    i++; if (i % 10 === 0) ver(`Leyendo SMS recibidos… ${i}/${porLead.size}`);
    let lista = textos;
    if (!lista.length) { // el texto no vino en el resultado: abrir la conversación del lead
      try {
        const d = await api(`/v1.0/communication/text?leadId=${encodeURIComponent(id)}&limit=40`);
        lista = filas(d).filter((x) => entra(x) && tiempo(x.textTime || x.communicationTime || x.createTime) >= ini).map(textoDe).filter(Boolean);
        await sleep(250);
      } catch (e) { lista = []; }
    }
    const veredictos = lista.map((t) => [esStop(t), t]);
    const si = veredictos.find(([v]) => v === "si"), duda = veredictos.find(([v]) => v === "revisar");
    if (si) stops.set(id, si[1]);
    else if (duda) rep.dudasSms.push({ id, texto: duda[1] });
  }
  return stops;
}

// ---------- Evaluar un lead ----------
function evaluar(l, rep, stopTxt) {
  const id = idDe(l); if (id && rep.vistos) rep.vistos.add(id);
  if (!id || rep.decididos.has(id)) return;
  if (!enAlcance(l)) return; // ya está en la etapa destino o fuera de la etapa elegida
  const motivos = [];
  if (stopTxt || marcadoBaja(l)) motivos.push("stop");
  if (soloSeller(l) && sinPropiedad(l)) motivos.push("sinProp"); // a los buyers no: casi nunca tienen propiedad
  if (sinNumero(l)) motivos.push("sinNum");
  if (!motivos.length) return;
  const nombre = nombreDe(l), motivo = motivos[0];
  rep.decididos.add(id);
  if (excepcion(l)) { rep.revisar.push({ id, nombre, por: `excepción por nombre · cumplía: ${MOTIVO[motivo]}`, texto: stopTxt || "" }); return; }
  rep.mover.push({ id, nombre, motivo, texto: stopTxt || "" });
}

// ---------- Corrida ----------
async function correr({ completa = false } = {}) {
  if (corriendo) return;
  guardarCfg();
  await navigator.locks.request("limpi-correr", { ifAvailable: true }, async (lock) => {
    if (!lock) { ver("Ya hay otra limpieza corriendo en otra pestaña."); return; }
    corriendo = true; parar = false; botones();
    window.robot && robot.set("trabajando", "Limpiando " + (cfg.etapa || "el CRM") + "…");
    const rep = { t: Date.now(), completa, revisados: 0, smsLeads: 0, mover: [], movidos: [], revisar: [], dudasSms: [], pendientes: [], fallidos: [], decididos: new Set(), vistos: new Set(), ignoradosNoSeller: 0, paginas: 0 };
    try {
      // 1) SMS con STOP
      const todoSms = completa || !cfg.horas;
      decir(`Limpi: leyendo SMS recibidos ${todoSms ? "de todo el historial" : `de las últimas ${cfg.horas} h`}…`);
      let stops = new Map();
      try { stops = await smsStop(rep, todoSms); } catch (e) { if (e.sinKey) throw e; rep.errSms = e.message; decir("Limpi: no pude leer los SMS (" + e.message + "). Sigo con los leads.", "error"); }
      for (const [id, txt] of stops) {
        if (parar) break;
        try { const l = await leerLead(id); evaluar(l, rep, txt); await sleep(250); } catch (e) { rep.fallidos.push({ id, nombre: `Lead ${id}`, por: "no pude abrirlo: " + e.message }); }
      }
      for (const d of rep.dudasSms) if (!rep.decididos.has(d.id)) {
        try { const l = await leerLead(d.id); if (enAlcance(l)) { rep.decididos.add(d.id); rep.revisar.push({ id: d.id, nombre: nombreDe(l), por: "SMS ambiguo (dice stop pero no queda claro)", texto: d.texto }); } await sleep(250); } catch (e) {}
      }
      // 2) Leads de la etapa, más nuevos primero
      const todosLeads = completa || !cfg.dias;
      const corte = Date.now() - cfg.dias * D; let offset = 0, conSort = true;
      while (!parar) {
        ver(`Revisando ${cfg.etapa || "todo el CRM"}… ${rep.vistos.size} leads (${rep.mover.length} para mover)`);
        const q = `/v1.0/leads?` + (cfg.etapa ? `stage=${encodeURIComponent(cfg.etapa)}&` : "") + `limit=100&offset=${offset}` + (conSort ? "&sort=CreateTime&desc=true" : "");
        let d;
        try { d = await api(q); } catch (e) { if (conSort && e.status === 400) { conSort = false; continue; } throw e; }
        const leads = filas(d); rep.paginas++;
        for (const l of leads) evaluar(l, rep, "");
        rep.revisados = rep.vistos.size;
        if (!todosLeads && leads.length && leads.every((l) => tiempo(l.createTime) < corte)) break; // ya son leads viejos
        if (!todosLeads && !conSort && rep.paginas >= 5) { rep.nota = "Lofty no aceptó el orden por fecha: revisé solo 5 páginas."; break; }
        if (leads.length < 100) break;
        offset += 100; await sleep(todosLeads ? 1000 : 600);
      }
      // 3) Mover (confirmando cada uno con el lead completo)
      if (cfg.soloRevisar) rep.pendientes = rep.mover.slice();
      else await mover(rep.mover, rep);
      // 4) Verificar
      if (rep.movidos.length) await verificar(rep);
    } catch (e) {
      rep.error = e.message; decir("Limpi: " + e.message, "error");
    } finally {
      rep.revisados = Math.max(rep.revisados, rep.vistos.size);
      corriendo = false; botones();
      await guardarReporte(rep);
    }
  });
}

async function mover(lista, rep) {
  let i = 0;
  for (const c of lista) {
    if (parar) { rep.pendientes.push(c); continue; }
    i++; ver(`Moviendo a ${cfg.destino}… ${i}/${lista.length}`);
    try {
      // revisar con el lead completo antes de moverlo (la lista a veces viene recortada)
      const l = await leerLead(c.id);
      const tmp = { decididos: new Set(), mover: [], revisar: [], ignoradosNoSeller: 0 };
      evaluar(l, tmp, c.texto);
      if (!tmp.mover.length) { if (tmp.revisar.length) rep.revisar.push(tmp.revisar[0]); continue; }
      await api(`/v1.0/leads/${encodeURIComponent(c.id)}`, { method: "PUT", body: { stage: cfg.destino } });
      rep.movidos.push({ ...c, motivo: tmp.mover[0].motivo });
    } catch (e) { rep.fallidos.push({ ...c, por: e.message }); }
    await sleep(400);
  }
}
async function verificar(rep) {
  ver("Verificando que ya estén en " + cfg.destino + "…");
  for (const c of rep.movidos) {
    try { const l = await leerLead(c.id); c.ok = norm(l.stage) === norm(cfg.destino); } catch (e) { c.ok = false; }
    await sleep(250);
  }
  const malos = rep.movidos.filter((c) => !c.ok);
  for (const c of malos) rep.fallidos.push({ ...c, por: "Lofty no reflejó el cambio de etapa" });
  rep.movidos = rep.movidos.filter((c) => c.ok);
}

// ---------- Reporte ----------
function textoReporte(r) {
  const n = (m) => r.movidos.filter((c) => c.motivo === m).length;
  const stopN = r.movidos.filter((c) => c.motivo === "stop").map((c) => c.nombre);
  let t = `Revisé ${r.revisados} leads${cfg.etapa ? " de " + cfg.etapa : " del CRM"}${r.completa ? " (revisión completa)" : ""}. ` +
    (cfg.soloRevisar && r.pendientes.length ? `Dejé ${r.pendientes.length} listos para mover (modo solo revisar). ` :
      `Moví ${r.movidos.length} a ${cfg.destino}: ${n("stop")} por STOP/unsubscribe, ${n("sinProp")} sin propiedad, ${n("sinNum")} sin número.`);
  if (stopN.length) t += ` Por STOP: ${stopN.slice(0, 8).join(", ")}${stopN.length > 8 ? "…" : ""}.`;
  if (r.revisar.length) t += ` ${r.revisar.length} para revisar a mano.`;
  if (r.fallidos.length) t += ` ${r.fallidos.length} no se pudieron mover.`;
  if (r.pendientes.length && !cfg.soloRevisar) t += ` Me paraste: ${r.pendientes.length} quedaron pendientes.`;
  if (r.nota) t += " " + r.nota;
  if (r.error) t += " Se detuvo: " + r.error;
  return t;
}
async function guardarReporte(rep) {
  const r = { ...rep, decididos: undefined, vistos: undefined, fecha: hoy(), texto: textoReporte(rep) };
  const { liHistorial = [], liResumen = {} } = await chrome.storage.local.get(["liHistorial", "liResumen"]);
  const mismoDia = liResumen.fecha === r.fecha;
  const resumen = { fecha: r.fecha, ultimaT: r.t, revisadosHoy: (mismoDia ? liResumen.revisadosHoy || 0 : 0) + r.revisados,
    movidosHoy: (mismoDia ? liResumen.movidosHoy || 0 : 0) + r.movidos.length, revisar: r.revisar.length, pendientes: r.pendientes.length };
  if (!r.error || r.revisados || /API key/i.test(r.error)) resumen.corridaDia = r.fecha; // la diaria ya se hizo hoy (si falló por red, se reintenta en 5 min)
  else resumen.corridaDia = liResumen.corridaDia;
  liHistorial.unshift({ t: r.t, texto: r.texto });
  // Registro de lo que Limpi ya limpió (Resi lo quita de su lista)
  const { liLimpiados = {} } = await chrome.storage.local.get("liLimpiados");
  const cuenta = cfg.cuenta === "tx" ? "tx" : "lofty";
  for (const c of r.movidos || []) liLimpiados[`${cuenta}:${c.id}`] = { t: r.t, motivo: c.motivo, nombre: c.nombre || "", cuenta };
  const ks = Object.keys(liLimpiados); if (ks.length > 5000) ks.sort((x, y) => liLimpiados[x].t - liLimpiados[y].t).slice(0, ks.length - 5000).forEach((k) => delete liLimpiados[k]);
  await chrome.storage.local.set({ liUltimo: r, liHistorial: liHistorial.slice(0, 30), liResumen: resumen, liPendientes: r.pendientes, liLimpiados });
  decir("Limpi: " + r.texto, r.error ? "error" : "info");
  window.robot && robot.set(r.error ? "error" : "feliz", r.error ? "Se detuvo: " + r.error : `¡Terminé! Moví ${r.movidos.length}.`);
  pintar();
}

// ---------- Pintar ----------
const urlLead = (id) => `https://crm.lofty.com/admin/home/detail?leadId=${encodeURIComponent(id)}`;
function fila(c, etiqueta, cls) {
  return `<li><div class="q"><a href="${urlLead(c.id)}" target="_blank">${esc(c.nombre)}</a>` +
    `<small>${esc(c.por || MOTIVO[c.motivo] || "")}${c.texto ? " · “" + esc(c.texto.slice(0, 120)) + "”" : ""}</small></div><span class="tag ${cls}">${esc(etiqueta)}</span></li>`;
}
async function pintar() {
  const { liUltimo: r, liHistorial = [], liPendientes = [] } = await chrome.storage.local.get(["liUltimo", "liHistorial", "liPendientes"]);
  if (r) {
    const n = (m) => (r.movidos || []).filter((c) => c.motivo === m).length;
    $("nRev").textContent = r.revisados || 0; $("nStop").textContent = n("stop"); $("nProp").textContent = n("sinProp"); $("nNum").textContent = n("sinNum");
    $("movidos").innerHTML = (r.movidos || []).length ? r.movidos.map((c) => fila(c, MOTIVO[c.motivo], c.motivo === "stop" ? "bad" : "gris")).join("") : '<span class="empty">No se movió ninguno.</span>';
    const rev = [...(r.revisar || []).map((c) => [c, "revisar", "wait"]), ...(r.fallidos || []).map((c) => [c, "no se movió", "bad"])];
    $("revisar").innerHTML = rev.length ? rev.map(([c, e, k]) => fila(c, e, k)).join("") : '<span class="empty">Nada pendiente.</span>';
    if (!corriendo) ver(new Date(r.t).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + " · " + r.texto);
  }
  $("moverPend").hidden = !liPendientes.length || corriendo;
  $("moverPend").textContent = `Mover ${liPendientes.length} pendientes`;
  $("historial").innerHTML = liHistorial.map((h) => `<li><div class="q"><small>${new Date(h.t).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small>${esc(h.texto)}</div></li>`).join("") || '<span class="empty">Sin corridas.</span>';
}
function botones() {
  $("run").disabled = corriendo; $("completa").disabled = corriendo; $("stopBtn").hidden = !corriendo;
  if (corriendo) $("moverPend").hidden = true;
}

// ---------- Botones ----------
$("run").onclick = () => correr();
$("completa").onclick = () => { if (confirm("La revisión completa recorre TODOS los leads " + (cfg.etapa ? "de " + cfg.etapa : "del CRM (todas las etapas, ~20,000)") + " y tarda bastante. ¿Seguir?")) correr({ completa: true }); };
$("stopBtn").onclick = () => { parar = true; ver("Parando…"); };
$("moverPend").onclick = async () => {
  const { liPendientes = [], liUltimo } = await chrome.storage.local.get(["liPendientes", "liUltimo"]);
  if (!liPendientes.length || corriendo) return;
  if (!confirm(`¿Mover ${liPendientes.length} leads a ${cfg.destino}?`)) return;
  corriendo = true; parar = false; botones();
  const rep = { ...(liUltimo || {}), t: Date.now(), revisados: 0, completa: false, mover: liPendientes, movidos: [], revisar: [], pendientes: [], fallidos: [], decididos: new Set(), ignoradosNoSeller: 0 };
  const antes = cfg.soloRevisar; cfg.soloRevisar = false;
  try { await mover(liPendientes, rep); if (rep.movidos.length) await verificar(rep); } catch (e) { rep.error = e.message; }
  cfg.soloRevisar = antes; corriendo = false; botones();
  await guardarReporte(rep);
};

// ---------- Automático: una vez al día ----------
async function revisarHora() {
  if (corriendo || !cfg.auto) return;
  if (new Date().getHours() < cfg.hora) return;
  const { liResumen = {} } = await chrome.storage.local.get("liResumen");
  if (liResumen.corridaDia === hoy()) return;
  correr();
}

chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.liConfig && !corriendo) cargar(); });
cargar().then(() => { pintar(); botones(); setTimeout(revisarHora, 20000); setInterval(revisarHora, 5 * 60000); });
