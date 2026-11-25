// =====================================================================
// Resi: lee las respuestas a los SMS de Texi y les da seguimiento.
// · Usa la MISMA cuenta de Lofty que Texi (su API key, "txKey").
// · Cada N minutos busca textos que entraron (GET /v2.0/communication/agent?type=TEXT)
//   y lee la conversación de cada lead (GET /v1.0/communication/text?leadId=).
// · Clasifica la respuesta (interesado, pregunta, más adelante, no, baja, número
//   equivocado, enojado) con reglas y, si Capi tiene API key, con Claude.
// · Escribe un borrador de respuesta. NADA se manda sin tu OK.
// · Deja una nota en Lofty con lo que contestó (si está prendido) y avisa a Capi
//   cuando alguien está interesado.
// · Las bajas y números equivocados se le pasan a Texi para que no les vuelva a escribir.
// · Seguimiento: si le contestaste y no volvió a escribir en N días, te lo pone en
//   “Seguimiento” con un borrador; los de “más adelante” vuelven en ~90 días.
// =====================================================================
// ---------- Resi o Resi 2 (v1.82.0) ----------
// Resi (rs.html) atiende las respuestas a los SMS de Texi (Seller); Resi 2 (rc.html) las de Compri (Buyer).
// Es el mismo código: en Resi 2 cada dato "rs…" se guarda como "rc…" y "txEnviados" se lee de "cbEnviados".
// Cada lead tiene un solo dueño (ver duenoDe): el agente que le escribió más reciente; si ninguno, su tipo en Lofty.
const YO = document.documentElement.dataset.mod === "rc" ? "rc" : "rs";
const MI_AGENTE = YO === "rc" ? "cb" : "tx", NOMBRE = YO === "rc" ? "Resi 2" : "Resi", AGENTE_SMS = YO === "rc" ? "Compri" : "Texi";
const RENOMBRA = (k) => (YO !== "rc" ? k : /^rs[A-Z]/.test(k) ? "rc" + k.slice(2) : k === "txEnviados" ? "cbEnviados" : k);
const VUELVE = (k) => (YO !== "rc" ? k : /^rc[A-Z]/.test(k) ? "rs" + k.slice(2) : /^rs[A-Z]/.test(k) ? "otro:" + k : k === "cbEnviados" ? "txEnviados" : k === "txEnviados" ? "otro:txEnviados" : k);
const almacen = {
  async get(keys) {
    const r = await chrome.storage.local.get([].concat(keys).map(RENOMBRA));
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [VUELVE(k), v]));
  },
  set: (obj) => chrome.storage.local.set(Object.fromEntries(Object.entries(obj).map(([k, v]) => [RENOMBRA(k), v]))),
};
const cambiosMios = (ch) => Object.fromEntries(Object.entries(ch).map(([k, v]) => [VUELVE(k), v]));
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const hoy = () => new Date().toLocaleDateString("en-CA");
const fecha = (ms) => ms ? new Date(ms).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const tc = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const D = 864e5, H = 36e5;

const LADAS_CA = new Set("209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951".split(" "));
const digitos = (t) => { let d = String(t || "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d; };
const esCA = (t) => { const d = digitos(t); return d.length === 10 && LADAS_CA.has(d.slice(0, 3)); };
const bonito = (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;

const DEF = { auto: true, cadaMin: 10, ia: true, notas: true, diasSeg: 3, horasAviso: 2, etapaBaja: "No Active Plans", verNumero: false };
const CAT = {
  interesado: { txt: "Interesado", cls: "ok", orden: 0 },
  pregunta: { txt: "Pregunta", cls: "wait", orden: 1 },
  seguimiento: { txt: "Seguimiento", cls: "seg", orden: 2 },
  mas_tarde: { txt: "Más adelante", cls: "seg", orden: 3 },
  otro: { txt: "Revisar", cls: "wait", orden: 4 },
  no: { txt: "No interesado", cls: "gris", orden: 5 },
  equivocado: { txt: "Número equivocado", cls: "gris", orden: 6 },
  enojado: { txt: "Enojado", cls: "bad", orden: 7 },
  baja: { txt: "Baja (STOP)", cls: "bad", orden: 8 },
};
const CAT_EN = { interesado: "Interested", pregunta: "Question", seguimiento: "Follow-up", mas_tarde: "Maybe later", otro: "Needs review", no: "Not interested", equivocado: "Wrong number", enojado: "Upset", baja: "Opt-out (STOP)" }; // para la nota en Lofty (en inglés)
const SIN_RESPUESTA = new Set(["equivocado", "enojado", "baja"]); // a estos no se les escribe
// A los que dicen "No", "No thanks" o "Not right now": se les pregunta si se les puede contactar el próximo año
const NEXT_YEAR = { en: "Would it be helpful if I checked back with you next year?", es: "¿Le serviría si le vuelvo a contactar el próximo año?" };
let cfg = { ...DEF }, casos = {}, corriendo = false, filtro = "abiertos", timer = null;

// ---------- API de Lofty (cuenta de Texi) ----------
async function api(path, opts = {}) {
  const { txKey } = await almacen.get("txKey");
  if (!txKey) throw Object.assign(new Error("Falta la API key de la cuenta de Texi (ponla en la pestaña de Texi, en )."), { sinKey: true });
  let r;
  for (let intento = 0; ; intento++) {
    r = await fetch("https://api.lofty.com" + path, {
      method: opts.method || "GET",
      headers: { Authorization: "token " + txKey, "X-Error-Status": "true", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });
    if (r.status !== 429 || intento >= 4) break;
    const ra = parseInt(r.headers.get("Retry-After") || "", 10);
    await sleep(ra > 0 ? ra * 1000 : 2000 * 2 ** intento);
  }
  const cuerpo = await r.text();
  let d = {}; try { d = cuerpo ? JSON.parse(cuerpo) : {}; } catch (e) { d = { message: cuerpo }; }
  if (!r.ok) throw Object.assign(new Error(`Lofty respondió ${r.status}` + (d.message ? `: ${String(d.message).slice(0, 140)}` : "")), { status: r.status });
  return d;
}
const filas = (d) => (Array.isArray(d) ? d : d.data || d.texts || d.list || d.items || d.communications || []);
const tiempo = (s) => {
  if (typeof s === "number") return s < 1e12 ? s * 1000 : s;
  const t = String(s || "").trim(); if (!t) return 0;
  if (/^\d+$/.test(t)) return tiempo(Number(t));
  return Date.parse(t.replace(/GMT$/, "Z")) || Date.parse(t.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? "" : "Z")) || 0;
};
const entra = (x) => /^\s*in/i.test(String(x.direction || x.textDirection || ""));

// ---------- Configuración ----------
async function cargar() {
  const { rsConfig = {}, rsCasos = {} } = await almacen.get(["rsConfig", "rsCasos"]);
  cfg = { ...DEF, ...rsConfig }; casos = rsCasos;
  // v1.59: ver el número abría Lofty y cambiaba de lead sin que lo pidieras → ahora viene apagado (solo con el botón de cada lead)
  if (!rsConfig.verNumeroV2) { cfg.verNumero = false; cfg.verNumeroV2 = true; almacen.set({ rsConfig: cfg }); }
  // Los "No" que antes quedaban sin borrador: ahora llevan la pregunta del próximo año (solo si no les has contestado)
  let mig = false;
  for (const c of Object.values(casos)) if (["no", "mas_tarde"].includes(c.categoria) && ["atender", "abierto"].includes(c.estado) && !c.enviado && !c.nextYear) {
    c.borrador = enEspanol(c.ultimo || "") ? NEXT_YEAR.es : NEXT_YEAR.en; c.estado = "abierto"; c.nextYear = true; mig = true;
  }
  if (mig) almacen.set({ rsCasos: casos });
  $("auto").checked = !!cfg.auto; $("cadaMin").value = cfg.cadaMin; $("ia").checked = !!cfg.ia; $("notas").checked = !!cfg.notas;
  $("diasSeg").value = cfg.diasSeg; $("etapaBaja").value = cfg.etapaBaja || ""; $("verNumero").checked = cfg.verNumero === true;
}
function guardarCfg() {
  cfg = { ...cfg, auto: $("auto").checked, ia: $("ia").checked, notas: $("notas").checked,
    cadaMin: Math.max(5, Math.min(240, parseInt($("cadaMin").value, 10) || 10)), diasSeg: Math.max(1, Math.min(30, parseInt($("diasSeg").value, 10) || 3)),
    etapaBaja: $("etapaBaja").value.trim(), verNumero: $("verNumero").checked, verNumeroV2: true };
  almacen.set({ rsConfig: cfg }); programar();
}
["auto", "cadaMin", "ia", "notas", "diasSeg", "etapaBaja", "verNumero"].forEach((id) => ($(id).onchange = guardarCfg));
const guardarCasos = () => almacen.set({ rsCasos: casos });

// ---------- Clasificar ----------
const RE = {
  baja: /\b(stop|stop all|unsubscribe|remove me|take me off|opt[ -]?out|do ?n[o']?t (text|contact|message)|no (more )?(texts|messages)|no me (escrib\w*|mand\w*|contact\w*)|d[eé]jame de (escribir|mandar)|b[oó]rrame|baja)\b|^\s*(stop|quit|end|cancel)\s*\.?\s*$/i,
  enojado: /\b(f+u+c+k|scam(mer)?|harass|report(ing)? you|lawyer|attorney|police|leave me alone|go away|piss off|estaf|acoso|abogado|polic[ií]a)/i,
  equivocado: /\b(wrong (number|person)|not the owner|i'?m not (the owner|\w+)|don'?t own|never owned|sold (it|the house|that) (years|a while)|no soy (el|la) (due[nñ]o|propietari)|n[uú]mero equivocado|ya no (es|vivo)|doesn'?t live here)\b/i,
  mas_tarde: /\b(maybe|not (right )?now|not yet|later|next year|in a (few|couple) (months|years)|someday|thinking about it|tal vez|quiz[aá]s|m[aá]s adelante|despu[eé]s|el pr[oó]ximo a[nñ]o|ahorita no)\b/i,
  no: /\b(not interested|no interest|no thanks?|no thank you|not selling|not for sale|never selling|won'?t sell|no estoy interesad|no me interesa|no gracias|no vendo|no est[aá] a la venta)\b|^\s*(no|nope|nah)\s*[.!]*\s*$/i,
  interesado: /\b(yes|yeah|yep|sure|ok(ay)?|interested|how much|what'?s (the|your) offer|make (me )?an offer|offer|price|cash|call me|give me a call|text me|depends|s[ií]|me interesa|cu[aá]nto|ll[aá]mame|h[aá]game una oferta|oferta|precio)\b/i,
  pregunta: /\?|\b(who is this|who'?s this|how did you get|qui[eé]n (es|eres|habla)|c[oó]mo (consigui|obtuvi))/i,
};
function porReglas(texto) {
  if (window.SMS && SMS.RE_BAJA.test(texto)) return "baja"; // Fase 1: también ALTO, PARA, CANCELAR, REVOKE, STOPALL…
  for (const k of ["baja", "enojado", "equivocado", "mas_tarde", "no", "interesado", "pregunta"]) if (RE[k].test(texto)) return k;
  return "otro";
}
const enEspanol = (t) => /[áéíóúñ¿¡]|\b(hola|gracias|s[ií]|cu[aá]nto|qui[eé]n|tal vez|me interesa|ll[aá]mame|buenas)\b/i.test(t);
function borradorBase(cat, c, texto) {
  const es = enEspanol(texto), n = c.nombre || (es ? "" : "there"), calle = c.calle || (es ? "su propiedad" : "your property"), ciudad = c.ciudad || (es ? "la zona" : "the area");
  if (es) return ({
    interesado: `¡Gracias ${n}! ¿Tiene unos minutos hoy o mañana para una llamada rápida? Le explico cuánto podría valer ${calle} y lo que tengo en mente.`,
    pregunta: `Hola ${n}, soy Christopher de Rubio Real Estate. Trabajo con compradores en ${ciudad} y quería saber si consideraría una oferta por ${calle}. ¿Le puedo llamar un momento?`,
    mas_tarde: NEXT_YEAR.es,
    no: NEXT_YEAR.es,
    otro: `Gracias por contestar, ${n}. ¿Le puedo llamar un momento para platicar sobre ${calle}?`,
    seguimiento: `Hola ${n}, solo dando seguimiento a mi mensaje sobre ${calle}. ¿Le queda bien una llamada rápida esta semana?`,
  }[cat] || "").replace(/\s+,/g, ",").replace(/  +/g, " ");
  return ({
    interesado: `Thanks ${n}! Do you have a few minutes today or tomorrow for a quick call? I can walk you through what ${calle} could sell for and what I have in mind.`,
    pregunta: `Hi ${n}, this is Christopher with Rubio Real Estate. I work with buyers in ${ciudad} and wanted to see if you'd consider an offer on ${calle}. Is now a good time for a quick call?`,
    mas_tarde: NEXT_YEAR.en,
    no: NEXT_YEAR.en,
    otro: `Thanks for getting back to me, ${n}. Would you have a minute for a quick call about ${calle}?`,
    seguimiento: `Hi ${n}, just following up on my message about ${calle}. Would a quick call this week work for you?`,
  }[cat] || "");
}
async function conIA(c, conv) {
  const { svKey, svModelo } = await almacen.get(["svKey", "svModelo"]);
  if (!cfg.ia || !svKey) return null;
  const historia = conv.slice(-12).map((m) => `${m.dir === "in" ? "LEAD" : "NOSOTROS"} (${new Date(m.t).toISOString().slice(0, 16)}): ${m.texto}`).join("\n");
  const sistema = `Eres Resi, asistente de Christopher (Rubio Real Estate / The Irvine Realtors, California). Christopher le manda SMS a dueños de casas (leads Seller) para ver si venderían.
Lee la conversación y clasifica la ÚLTIMA respuesta del lead. Categorías: interesado (quiere oferta, precio, llamada, dice que sí o "depende"), pregunta (pregunta quién es, de dónde sacó el número, etc.), mas_tarde (tal vez, más adelante, ahorita no), no (no le interesa, no vende), baja (pide que no le escriban: STOP, remove, unsubscribe), equivocado (no es el dueño, número equivocado, ya vendió hace tiempo), enojado (insultos, amenazas, dice que es estafa), otro.
Escribe un borrador de respuesta SMS: en el mismo idioma del lead, máximo 280 caracteres, tono humano y amable, firma implícita de Christopher, sin prometer precios ni cifras, con el objetivo de conseguir una llamada. Si la categoría es "no" o "mas_tarde", el borrador es EXACTAMENTE: "${NEXT_YEAR.en}" (o, si el lead escribe en español, "${NEXT_YEAR.es}"). Si la categoría es baja, equivocado o enojado, el borrador va vacío.
Contesta SOLO con JSON: {"categoria":"...","resumen":"una línea en español","summary":"the same summary in English (one line)","borrador":"...","urgente":true|false,"seguimientoDias":número o null}`;
  const usuario = `Lead: ${c.nombre} ${c.apellido}${c.calle ? `, dueño de ${c.calle}${c.ciudad ? `, ${c.ciudad}` : ""}` : ""}. Etapa en Lofty: ${c.etapa || "?"}.\n\nConversación:\n${historia}`;
  try {
    if (window.PRESUPUESTO) { const pr = await PRESUPUESTO.revisar("resi"); if (!pr.ok) return null; } // Fase 3: tope diario (queda la clasificación por reglas)
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": svKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: svModelo || "claude-haiku-5-5", max_tokens: 500, system: sistema, messages: [{ role: "user", content: usuario }] }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return null;
    if (window.PRESUPUESTO) await PRESUPUESTO.registrar("resi", d.usage);
    const txt = (d.content || []).map((b) => b.text || "").join("");
    const j = JSON.parse((txt.match(/\{[\s\S]*\}/) || ["{}"])[0]);
    if (!CAT[j.categoria]) return null;
    return { categoria: j.categoria, resumen: String(j.resumen || "").slice(0, 200), summary: String(j.summary || "").slice(0, 200), borrador: SIN_RESPUESTA.has(j.categoria) ? "" : ["no", "mas_tarde"].includes(j.categoria) ? null : String(j.borrador || "").slice(0, 320), urgente: !!j.urgente, seguimientoDias: Number(j.seguimientoDias) || null };
  } catch (e) { return null; }
}

// ---------- Leer Lofty ----------
async function leadsConEntrantes(desde) {
  const { rsVistos = [] } = await almacen.get("rsVistos");
  const vistos = new Set(rsVistos), ids = new Set();
  const fin = Date.now();
  let cursor = "", paginas = 0;
  for (let ini = desde; ini < fin; ini += 89 * D) { // la API acepta hasta 90 días por consulta
    const hasta = Math.min(fin, ini + 89 * D);
    do {
      const d = await api(`/v2.0/communication/agent?type=TEXT&startTime=${Math.floor(ini)}&endTime=${Math.floor(hasta)}&limit=1000` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""));
      for (const x of filas(d)) if (entra(x) && x.leadId && !vistos.has(String(x.id))) ids.add(String(x.leadId));
      cursor = d.nextCursor || ""; paginas++;
    } while (cursor && paginas < 20);
  }
  return [...ids];
}
async function conversacion(leadId) {
  const d = await api(`/v1.0/communication/text?leadId=${encodeURIComponent(leadId)}&limit=40`);
  return filas(d).map((x) => ({ id: String(x.id), dir: entra(x) ? "in" : "out", texto: String(x.textContent || x.content || x.body || "").trim(), t: tiempo(x.textTime || x.communicationTime || x.createTime) }))
    .filter((m) => m.texto || m.dir === "out").sort((a, b) => a.t - b.t);
}
async function datosLead(id) {
  const d = await api(`/v1.0/leads/${encodeURIComponent(id)}`);
  const l = d.lead || d.data || d;
  const props = l.leadPropertyList || [];
  const p = props.find((x) => /home/i.test(x.label || "") && x.streetAddress) || props.find((x) => x.streetAddress) || (l.streetAddress ? l : {});
  const tels = [...new Set([...(l.phones || []), l.phone, l.mobilePhone, l.homePhone, l.workPhone].filter(Boolean)
    .map((x) => digitos(x && typeof x === "object" ? x.phone || x.number || x.value : x)).filter((x) => x.length === 10))];
  return { nombre: tc(l.firstName || "").split(" ")[0], apellido: tc(l.lastName || ""), etapa: l.stage || "", tels: tels.filter(esCA), telsTodos: tels, calle: tc(p.streetAddress || ""), ciudad: tc(p.city || "") };
}

// ---------- ¿De qué número contestó? ----------
// El API de Lofty no lo dice, pero la línea de tiempo de la página del lead sí:
// "[Manual Text] Bruce/Maria (+1 6268259462) texted Daniel (+1 3103070391) with virtual number" y abajo el mensaje.
function rsLeerNumeros() { // corre en la página del lead en crm.lofty.com
  if (/\/login|sign\s*in/i.test(location.pathname + " " + document.title)) return { login: true };
  const L = document.body.innerText.split("\n").map((x) => x.trim()).filter(Boolean);
  const out = [];
  L.forEach((l, i) => {
    const m = l.match(/^\[[^\]]*Text\]\s*(.+?)\s*\(\+1\s*(\d{10})\)\s*texted\s*(.+?)\s*\(\+1\s*(\d{10})\)/i);
    if (m) out.push({ de: m[1], deNum: m[2], a: m[3], aNum: m[4], texto: L[i + 1] || "" });
  });
  return { lineas: out };
}
// Solo reusa la pestaña que Resi abrió EN ESTA SESIÓN (en memoria): nunca toma una pestaña de Lofty tuya
let rsTabPropia = null;
async function pestanaLofty(url) {
  const t = rsTabPropia ? await chrome.tabs.get(rsTabPropia).catch(() => null) : null;
  let id;
  if (t && /lofty\.com/.test(t.url || "")) { id = t.id; await chrome.tabs.update(id, { url, active: false }); await sleep(800); }
  else { const n = await abrirPestana(url, "nuevos"); id = n.id; rsTabPropia = id; }
  for (let i = 0; i < 60; i++) { const x = await chrome.tabs.get(id).catch(() => null); if (!x || x.status === "complete") break; await sleep(400); }
  return id;
}
const norma = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 40);
async function numeroQueContesto(c) {
  const ent = (c.conv || []).filter((m) => m.dir === "in" && m.texto);
  const ult = ent[ent.length - 1];
  if (!ult) return null;
  const tab = await pestanaLofty(`https://crm.lofty.com/admin/home/detail?leadId=${encodeURIComponent(c.leadId)}`);
  const suyos = new Set([...(c.telsTodos || []), ...(c.tels || [])]);
  for (let i = 0; i < 20; i++) { // la línea de tiempo tarda en pintarse
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab }, func: rsLeerNumeros }).catch(() => [null]);
    const v = r && r.result;
    if (v && v.login) return { login: true };
    const ls = (v && v.lineas) || [];
    if (ls.length) {
      const entrantes = ls.filter((x) => suyos.size ? suyos.has(x.deNum) : !suyos.has(x.aNum));
      const hit = entrantes.find((x) => norma(x.texto) === norma(ult.texto)) || entrantes.find((x) => norma(ult.texto).startsWith(norma(x.texto).slice(0, 15)));
      if (hit) return { num: hit.deNum, id: ult.id };
      if (i > 6) return null; // ya cargó y no está ese mensaje
    }
    await sleep(1000);
  }
  return null;
}
let buscandoNum = false, colaNum = [];
// Fila de leads para ver de qué número contestaron: "alFrente" = el que pediste con el botón
async function completarNumeros(ids, alFrente) {
  if (cfg.verNumero === false && !alFrente) return;
  if (alFrente) colaNum = [...ids, ...colaNum.filter((x) => !ids.includes(x))];
  else for (const x of ids) if (!colaNum.includes(x)) colaNum.push(x);
  if (buscandoNum) { if (alFrente) ver("Lo puse al frente: es el siguiente que reviso en Lofty."); return; }
  buscandoNum = true;
  let n = 0, hechos = 0;
  try {
    while (colaNum.length) {
      const id = colaNum.shift();
      const c = casos[id]; if (!c) continue;
      ver(`Viendo en Lofty de qué número contestó ${`${c.nombre} ${c.apellido}`.trim()}…${colaNum.length ? ` (faltan ${colaNum.length})` : ""}`);
      const r = await numeroQueContesto(c).catch(() => null);
      if (r && r.login) { ver("Para ver de qué número contestan, inicia sesión en Lofty (crm.lofty.com) en este navegador."); colaNum = []; break; }
      if (r && r.num) { c.telResp = r.num; c.telRespId = r.id; c.telRespNo = false; n++; }
      else { c.telRespId = (c.conv || []).filter((m) => m.dir === "in").map((m) => m.id).pop() || ""; c.telRespNo = true; } // no se pudo: no lo vuelvo a intentar solo con el mismo mensaje
      hechos++;
      await guardarCasos(); pintar(); // se ve en cuanto lo encuentra
      if (colaNum.length) await sleep(2000 + Math.random() * 2000);
    }
    if (hechos > 1) ver(`Listo: vi de qué número contestaron ${n} de ${hechos} lead(s).`);
  } finally { buscandoNum = false; }
}

// ---------- Revisar ----------
// ¿De quién es este lead: de Texi ("tx", lo atiende Resi) o de Compri ("cb", lo atiende Resi 2)?
// 1) el que le escribió más reciente; 2) si ninguno, su tipo en Lofty (Buyer sin Seller → Compri); se guarda en smsDueno.
async function duenoDe(id) {
  const { txEnviados = {}, cbEnviados = {}, smsDueno = {} } = await chrome.storage.local.get(["txEnviados", "cbEnviados", "smsDueno"]);
  const t1 = (txEnviados[id] || {}).t || 0, t2 = (cbEnviados[id] || {}).t || 0;
  if (t1 || t2) return t2 > t1 ? "cb" : "tx";
  if (smsDueno[id]) return smsDueno[id];
  let d = "tx";
  try {
    const r = await api(`/v1.0/leads/${encodeURIComponent(id)}`), l = r.lead || r.data || r;
    const tipos = [].concat(l.leadTypes || [], l.leadType != null ? l.leadType : []).map(Number);
    d = tipos.includes(2) && !tipos.includes(1) ? "cb" : "tx";
  } catch (e) { if (e.status === 401 || e.status === 403) throw e; return "tx"; }
  const { smsDueno: act = {} } = await chrome.storage.local.get("smsDueno"); act[id] = d;
  const ks = Object.keys(act); if (ks.length > 8000) ks.slice(0, ks.length - 8000).forEach((k) => delete act[k]);
  await chrome.storage.local.set({ smsDueno: act });
  return d;
}
// Un caso que ya no es mío (el lead es del otro agente) se pasa a la lista del otro Resi
async function traspasar(id) {
  const otra = YO === "rc" ? "rsCasos" : "rcCasos";
  const { [otra]: suyos = {} } = await chrome.storage.local.get(otra);
  if (!suyos[id]) suyos[id] = casos[id];
  await chrome.storage.local.set({ [otra]: suyos });
  delete casos[id]; await guardarCasos();
}

async function revisar(aMano) {
  if (corriendo) return;
  corriendo = true; $("run").disabled = true;
  window.robot && robot.set("trabajando", "Leyendo las respuestas a los SMS…");
  const { rsUltimo, txEnviados = {} } = await almacen.get(["rsUltimo", "txEnviados"]);
  const ahora = Date.now(), desde = rsUltimo ? rsUltimo - 15 * 60e3 : ahora - 14 * D;
  let ids = [], via = "agente", nuevos = 0, avisar = [];
  try {
    try { ids = await leadsConEntrantes(desde); }
    catch (e) {
      if (e.sinKey || e.status === 401 || e.status === 403) throw e;
      // Plan B: revisar uno por uno los leads a los que Texi les escribió en las últimas 2 semanas
      via = "texi";
      ids = Object.entries(txEnviados).filter(([, v]) => ahora - (v.t || 0) < 14 * D).map(([k]) => k);
    }
    // Casos abiertos: también se releen (para ver si ya les contestaste o volvieron a escribir)
    for (const [k, c] of Object.entries(casos)) if (!["descartado"].includes(c.estado) && ahora - (c.t || 0) < 30 * D && !ids.includes(k)) ids.push(k);
    // Solo los leads de mi agente (Texi → Resi, Compri → Resi 2); los casos del otro se le pasan
    { const mios = []; for (const id of ids) { const d = await duenoDe(id); if (d === MI_AGENTE) mios.push(id); else if (casos[id]) await traspasar(id); } ids = mios; }
    // Fase Anna 1: los leads que trabaja Anna (en su pool y sin silenciar) los atiende ella, no Resi
    if (window.Cerebro) {
      let pool = null; try { pool = new Set((await Cerebro.poolAnna()).map((x) => x.leadId)); } catch (e) { pool = null; }
      if (pool) { const libres = []; for (const id of ids) { if (pool.has(String(id)) && !(await Cerebro.muteado(String(id)).catch(() => false))) continue; libres.push(id); } ids = libres; }
    }
    const { rsVistos = [] } = await almacen.get("rsVistos");
    const vistos = new Set(rsVistos);
    let i = 0;
    for (const id of ids) {
      i++; ver(`Leyendo conversaciones de Lofty… (${i} de ${ids.length})`);
      let conv;
      try { conv = await conversacion(id); } catch (e) { if (e.status === 401 || e.status === 403) throw e; continue; }
      await sleep(via === "texi" ? 700 : 250);
      const ent = conv.filter((m) => m.dir === "in" && m.texto);
      if (!ent.length) continue;
      const ultIn = ent[ent.length - 1], ultOut = [...conv].reverse().find((m) => m.dir === "out");
      const c = casos[id] || { leadId: id, creado: ahora, estado: "abierto" };
      const nuevaEntrada = !c.ultimoId || c.ultimoId !== ultIn.id;
      // ¿Ya le contestaste (desde Lofty o desde aquí) después de su último mensaje?
      const contestado = ultOut && ultOut.t > ultIn.t;
      if (nuevaEntrada) {
        if (!c.nombre) Object.assign(c, await datosLead(id).catch(() => ({ nombre: "", apellido: "", tels: [], calle: "", ciudad: "", etapa: "" })));
        const desdeUlt = ent.filter((m) => !c.ultimoT || m.t > c.ultimoT);
        const texto = desdeUlt.map((m) => m.texto).join(" · ") || ultIn.texto;
        let cat = porReglas(texto), res = null;
        if (!["baja"].includes(cat)) res = await conIA(c, conv); // una baja clara no necesita IA
        if (res) cat = res.categoria;
        Object.assign(c, { ultimoId: ultIn.id, ultimoT: ultIn.t, ultimo: texto, categoria: cat, resumen: res ? res.resumen : "", summary: res ? res.summary : "", urgente: res ? res.urgente : cat === "interesado",
          borrador: res && res.borrador != null ? res.borrador : borradorBase(cat, c, texto), conIA: !!res, t: ahora, estado: contestado ? "respondido" : (SIN_RESPUESTA.has(cat) ? "atender" : "abierto"),
          proximo: cat === "mas_tarde" ? ultIn.t + ((res && res.seguimientoDias) || 90) * D : 0, avisado: false, texi: !!txEnviados[id] });
        c.conv = conv.slice(-8);
        // Fase 1: baja PERMANENTE. Aunque después escriba otra cosa, ya no se le vuelve a mandar SMS.
        if (["baja", "equivocado", "enojado"].includes(cat)) {
          c.bajaPermanente = c.bajaPermanente || cat;
          try { await SMS.marcarBaja({ leadId: id, cuenta: "tx", tels: c.telResp ? [c.telResp] : (c.tels || []), motivo: cat, fuente: NOMBRE }); }
          catch (e) { decir(`No pude guardar la baja de ${c.nombre || id}: ${e.message}`, "error"); }
        }
        if (["no", "mas_tarde"].includes(cat)) c.nextYear = true;
        nuevos++;
        for (const m of desdeUlt) vistos.add(m.id);
        if (cfg.notas && !c.nota) {
          try { await api("/v1.0/notes", { method: "POST", body: { leadId: Number(id), content: `Resi (SMS): the lead replied “${texto.slice(0, 300)}”. Classified as: ${CAT_EN[cat] || cat}.${c.summary ? " " + c.summary : ""}` } }); c.nota = ultIn.id; }
          catch (e) { /* la nota es opcional */ }
        }
        if (cat === "interesado" || cat === "pregunta") avisar.push(c);
      } else {
        c.conv = conv.slice(-8);
        if (contestado && c.estado === "abierto") { c.estado = "respondido"; c.respondidoT = ultOut.t; }
      }
      // Seguimiento: le contestamos y no ha vuelto a escribir en N días
      if (c.estado === "respondido" && !SIN_RESPUESTA.has(c.categoria) && c.categoria !== "mas_tarde" && ultOut && ultOut.t > ultIn.t && ahora - ultOut.t > cfg.diasSeg * D && !c.seguido) {
        c.estado = "abierto"; c.categoria = "seguimiento"; c.seguido = ahora; c.borrador = borradorBase("seguimiento", c, c.ultimo || ""); c.t = ahora;
      }
      if (c.categoria === "mas_tarde" && c.proximo && ahora > c.proximo && c.estado !== "descartado" && c.estado !== "limpiado" && !c.seguido) {
        c.estado = "abierto"; c.categoria = "seguimiento"; c.seguido = ahora; c.borrador = borradorBase("seguimiento", c, c.ultimo || ""); c.t = ahora;
      }
      casos[id] = c;
    }
    await almacen.set({ rsUltimo: ahora, rsVistos: [...vistos].slice(-5000) });
    // De qué número contestó: primero los nuevos, luego los que ya estaban sin ese dato
    const faltan = Object.values(casos).filter((c) => c.estado !== "descartado" && (c.conv || []).some((m) => m.dir === "in") &&
      c.telRespId !== ((c.conv || []).filter((m) => m.dir === "in").map((m) => m.id).pop())).sort((a, b) => (b.ultimoT || 0) - (a.ultimoT || 0)).map((c) => c.leadId);
    if (faltan.length) setTimeout(() => completarNumeros(faltan), 1000); // sigue en segundo plano con todos los que faltan
    await pasarBajasATexi();
    await guardarCasos();
    pintar();
    const ab = Object.values(casos).filter((c) => c.estado === "abierto" || c.estado === "atender");
    const txt = nuevos ? `Encontré ${nuevos} respuesta(s) nueva(s)${avisar.length ? `: ${avisar.length} interesado(s) o con pregunta` : ""}. Tienes ${ab.length} por atender.` : (aMano ? `Sin respuestas nuevas. Tienes ${ab.length} por atender.` : "");
    if (txt) decir(txt);
    if (avisar.length) {
      const nombres = avisar.slice(0, 3).map((c) => `${c.nombre} ${c.apellido}`.trim() || "un lead").join(", ");
      await almacen.set({ rsAviso: { t: ahora, n: avisar.length, texto: `Jefe, ${nombres}${avisar.length > 3 ? ` y ${avisar.length - 3} más` : ""} contestaron el SMS y ${avisar.length > 1 ? "están" : "está"} interesado${avisar.length > 1 ? "s" : ""} o con pregunta. Tengo el borrador listo en Resi; ¿lo revisas?` } });
    }
    window.robot && robot.set(ab.length ? "ayuda" : "feliz", ab.length ? `${ab.length} respuesta(s) por atender` : "Todo al día");
  } catch (e) {
    decir(e.sinKey ? e.message : `No pude leer las respuestas: ${e.message}`, "error");
    window.robot && robot.set("error", "No pude leer Lofty");
  } finally { corriendo = false; $("run").disabled = false; resumen(); quitarLimpiados(); }
}
// ---------- Lo que Limpi ya limpió (STOP, sin número, sin propiedad) se quita de Resi ----------
// No se borra: queda como "limpiado" (oculto) para que Texi siga sin escribirle a las bajas.
// Si el lead vuelve a escribir DESPUÉS de la limpieza, regresa a "por atender".
const normNombre = (s) => String(s || "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
async function quitarLimpiados() {
  if (corriendo) return;
  const { liLimpiados = {}, liUltimo, liConfig = {} } = await almacen.get(["liLimpiados", "liUltimo", "liConfig"]);
  const reg = { ...liLimpiados };
  const ctaLi = liConfig.cuenta === "tx" ? "tx" : "lofty"; // limpiezas de antes de esta versión
  for (const c of (liUltimo && liUltimo.movidos) || []) { const k = `${ctaLi}:${c.id}`; if (!reg[k]) reg[k] = { t: liUltimo.t, motivo: c.motivo, nombre: c.nombre || "", cuenta: ctaLi }; }
  const otros = Object.values(reg).filter((x) => x.cuenta !== "tx" && x.nombre);
  let n = 0;
  for (const [id, c] of Object.entries(casos)) {
    if (c.estado === "limpiado") continue;
    // misma cuenta que Resi (la de Texi): por id; si Limpi limpió la otra cuenta: por nombre, y solo bajas/equivocados/enojados
    const x = reg[`tx:${id}`] || (SIN_RESPUESTA.has(c.categoria) && otros.find((l) => normNombre(l.nombre) && normNombre(l.nombre) === normNombre(`${c.nombre || ""} ${c.apellido || ""}`)));
    if (!x || (c.ultimoT || 0) > x.t) continue; // escribió después de la limpieza: se queda
    c.estado = "limpiado"; c.limpiadoT = x.t; c.limpiadoPor = x.motivo; n++;
  }
  if (n) { await guardarCasos(); pintar(); ver(`Quité ${n} conversación(es) que Limpi ya limpió (STOP, sin número o sin propiedad).`); }
}
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && (ch.liLimpiados || ch.liUltimo)) quitarLimpiados(); });

// Bajas, números equivocados y enojados: Texi ya no les vuelve a escribir
async function pasarBajasATexi() {
  // Fase 1: las bajas que ya existían antes de esta versión también quedan permanentes
  for (const [k, c] of Object.entries(casos)) if (["baja", "equivocado", "enojado"].includes(c.categoria) && !c.bajaPermanente) {
    c.bajaPermanente = c.categoria;
    try { await SMS.marcarBaja({ leadId: k, cuenta: "tx", tels: c.telResp ? [c.telResp] : (c.tels || []), motivo: c.categoria, fuente: NOMBRE }); } catch (e) {}
  }
  const no = {};
  for (const [k, c] of Object.entries(casos)) if (["baja", "equivocado", "enojado"].includes(c.categoria) || c.bajaPermanente) no[k] = { t: c.ultimoT || c.t, motivo: c.bajaPermanente || c.categoria };
  const respondieron = Object.fromEntries(Object.entries(casos).map(([k, c]) => [k, { t: c.ultimoT || c.t, categoria: c.categoria }]));
  await almacen.set({ rsNoEscribir: no, rsRespondieron: respondieron });
}
// Aviso a los X horas si alguien interesado sigue sin respuesta
async function vigilar() {
  const ahora = Date.now(); let cambio = false; const tarde = [];
  for (const c of Object.values(casos)) {
    if (c.estado === "abierto" && ["interesado", "pregunta"].includes(c.categoria) && !c.avisado && ahora - (c.ultimoT || c.t) > cfg.horasAviso * H) { c.avisado = true; cambio = true; tarde.push(c); }
  }
  if (tarde.length) {
    decir(`${tarde.map((c) => `${c.nombre} ${c.apellido}`.trim()).join(", ")} te contestó hace más de ${cfg.horasAviso} h y sigue sin respuesta.`, "error");
    await almacen.set({ rsAviso: { t: ahora, n: tarde.length, texto: `Jefe, ${tarde.length} lead(s) interesados llevan más de ${cfg.horasAviso} horas esperando respuesta por SMS. Están en Resi.` } });
  }
  if (cambio) guardarCasos();
}

// ---------- Acciones (todas con tu OK) ----------
// Fase Anna 1: el Cerebro antes de mandar (24 h entre todos, una persona le escribió, está con Anna). Falla cerrada.
async function cerebroDeja(id, esRespuesta) {
  if (!window.Cerebro) return true;
  const cb = await Cerebro.puedo({ leadId: id, canal: "sms", robot: NOMBRE, llave: "txKey", esRespuesta });
  if (!cb.ok) { await SMS.anotar({ fuente: NOMBRE, leadId: id, estado: "bloqueado", motivo: "Cerebro: " + cb.motivo }); decir(`No mandé el SMS. Cerebro: ${cb.motivo}.`, cb.codigo === "error" ? "error" : undefined); }
  return cb.ok;
}
async function mandar(id) {
  const c = casos[id]; if (!c) return;
  const li = document.querySelector(`li[data-id="${CSS.escape(id)}"]`);
  const texto = personalizar(li.querySelector("textarea").value, c), num = li.querySelector("select") ? li.querySelector("select").value : (c.tels || [])[0];
  if (!texto) { ver("El mensaje está vacío."); return; }
  if (!num || !esCA(num)) { ver("Este lead no tiene número de California para contestarle."); return; }
  if (SIN_RESPUESTA.has(c.categoria) && !(await preguntar(`${c.nombre} está marcado como “${CAT[c.categoria].txt}”. ¿Seguro que le quieres escribir?`, "Sí, escribirle", "No"))) return;
  { const b = await SMS.bajaDe({ tel: num, leadId: id, cuenta: "tx" }); if (b || c.bajaPermanente) { ver(`No se puede: ${c.nombre || "este lead"} tiene baja permanente (${(b && b.motivo) || c.bajaPermanente}). No le mandé nada.`); return; } }
  if (!(await preguntar(`Mandar este SMS a ${`${c.nombre} ${c.apellido}`.trim()} · ${bonito(num)}:\n\n“${texto}”\n\nUn SMS mandado ya no se puede borrar.`, "Mandar", "Cancelar"))) { ver("No mandé nada."); return; }
  if (!(await cerebroDeja(id, true))) return;
  const pol = await SMS.puedeMandar({ tel: num, leadId: id, cuenta: "tx", fuente: NOMBRE });
  if (!pol.ok) { await SMS.anotar({ fuente: NOMBRE, leadId: id, tel: num, estado: "bloqueado", motivo: pol.motivo }); decir(`No mandé el SMS: ${pol.motivo}.`, "error"); return; }
  try {
    try { await api("/v1.0/message/sms/send", { method: "POST", body: { leadId: Number(id), content: texto, phoneNumber: num, phoneCode: "1" } }); }
    catch (e) { await SMS.devolverLugar(); await SMS.anotar({ fuente: NOMBRE, leadId: id, tel: num, estado: "error", motivo: e.message }); throw e; }
    await SMS.anotar({ fuente: NOMBRE, leadId: id, tel: num, estado: "enviado", texto });
    Object.assign(c, { estado: "respondido", respondidoT: Date.now(), enviado: texto, borrador: "", seguido: c.categoria === "seguimiento" ? c.seguido : 0 });
    if (c.categoria === "seguimiento") c.categoria = "otro";
    const { rsHoy = {} } = await almacen.get("rsHoy");
    await almacen.set({ rsHoy: { dia: hoy(), n: (rsHoy.dia === hoy() ? rsHoy.n || 0 : 0) + 1 } });
    await guardarCasos(); pintar();
    decir(`Le contesté a ${`${c.nombre} ${c.apellido}`.trim()} (${bonito(num)}). Si no vuelve a escribir en ${cfg.diasSeg} días, te lo pongo en Seguimiento.`);
  } catch (e) { decir(`No se pudo mandar: ${e.message}`, "error"); }
}
async function moverBaja(id) {
  const c = casos[id]; if (!c || !cfg.etapaBaja) { ver("Escribe arriba la etapa para las bajas."); return; }
  if (!(await preguntar(`Mover a ${`${c.nombre} ${c.apellido}`.trim()} a la etapa “${cfg.etapaBaja}” en Lofty (cuenta de Texi y Compri)?`, "Mover", "Cancelar"))) return;
  try {
    await api(`/v1.0/leads/${encodeURIComponent(id)}`, { method: "PUT", body: { stage: cfg.etapaBaja } });
    Object.assign(c, { estado: "descartado", etapa: cfg.etapaBaja, movido: Date.now() }); await guardarCasos(); pintar();
    decir(`Moví a ${`${c.nombre} ${c.apellido}`.trim()} a “${cfg.etapaBaja}”. Ni Texi ni Compri le vuelven a escribir.`);
  } catch (e) { decir(`Lofty no dejó mover la etapa: ${e.message}. Muévelo a mano desde Lofty.`, "error"); }
}
async function cerrar(id) { const c = casos[id]; if (!c) return; c.estado = "descartado"; await guardarCasos(); pintar(); ver(`Listo: ${c.nombre || "el lead"} ya no aparece en “por atender”.`); }
async function reabrir(id) { const c = casos[id]; if (!c) return; c.estado = "abierto"; if (!c.borrador && !SIN_RESPUESTA.has(c.categoria)) c.borrador = borradorBase(c.categoria, c, c.ultimo || ""); await guardarCasos(); pintar(); }

// ---------- Pintar ----------
function resumen() {
  const v = Object.values(casos);
  const ab = v.filter((c) => (c.estado === "abierto" || c.estado === "atender") && !SIN_RESPUESTA.has(c.categoria)); // STOP, equivocados y enojados no se atienden
  $("nAbiertos").textContent = ab.length;
  $("nInteresados").textContent = v.filter((c) => c.estado !== "descartado" && c.categoria === "interesado").length;
  $("nSeg").textContent = v.filter((c) => c.estado === "abierto" && c.categoria === "seguimiento").length;
  $("nBajas").textContent = v.filter((c) => c.estado !== "limpiado" && ["baja", "equivocado", "enojado"].includes(c.categoria)).length;
  almacen.set({ rsResumen: { abiertos: ab.filter((c) => c.estado === "abierto").length, interesados: Number($("nInteresados").textContent), bajas: Number($("nBajas").textContent), t: Date.now() } });
}
function pintar() {
  resumen();
  // No se muestran: lo que Limpi ya limpió, ni las conversaciones de STOP/unsubscribe, número equivocado o enojados
  // (siguen guardadas para que Texi nunca les vuelva a escribir)
  const todos = Object.values(casos).filter((c) => c.estado !== "limpiado" && !SIN_RESPUESTA.has(c.categoria));
  const ver_ = todos.filter((c) => filtro === "todos" ? true : filtro === "abiertos" ? (c.estado === "abierto" || c.estado === "atender") : filtro === "respondidos" ? c.estado === "respondido" : c.estado === "descartado")
    .sort((a, b) => (CAT[a.categoria] || CAT.otro).orden - (CAT[b.categoria] || CAT.otro).orden || (b.ultimoT || 0) - (a.ultimoT || 0));
  document.querySelectorAll("[data-f]").forEach((b) => b.classList.toggle("sel", b.dataset.f === filtro));
  if (!ver_.length) { $("lista").innerHTML = `<li class="empty">${filtro === "abiertos" ? "Nadie esperando respuesta. Reviso solo cada " + cfg.cadaMin + " minutos (o dale “Revisar respuestas”)." : "Nada aquí."}</li>`; return; }
  $("lista").innerHTML = ver_.map((c) => {
    const cat = CAT[c.categoria] || CAT.otro, tels0 = (c.tels || []);
    const tels = c.telResp && tels0.includes(c.telResp) ? [c.telResp, ...tels0.filter((t) => t !== c.telResp)] : tels0; // el número que contestó va primero
    const conv = (c.conv || []).slice(-4).map((m) => `<div class="b ${m.dir}">${m.dir === "in" && c.telResp && m.id === c.telRespId ? `<span class="num">${bonito(c.telResp)}</span>` : ""}${esc(m.texto || "(sin texto)")}<small>${fecha(m.t)}</small></div>`).join("");
    const abierto = c.estado === "abierto" || c.estado === "atender";
    return `<li data-id="${esc(c.leadId)}"><div class="addr">
      <div class="cab"><b>${esc(`${c.nombre} ${c.apellido}`.trim() || "(sin nombre)")}</b> <span class="tag ${cat.cls}">${cat.txt}</span>${c.urgente && abierto ? ` <span class="tag bad">urgente</span>` : ""}${c.conIA ? ` <span class="tag ia" title="Clasificado con Claude">IA</span>` : ""}
        <span class="hint">${fecha(c.ultimoT)}</span></div>
      <small>${tels.map(bonito).join(" · ") || "sin número de CA"}${c.calle ? ` · ${esc(c.calle)}${c.ciudad ? ", " + esc(c.ciudad) : ""}` : ""}${c.etapa ? ` · ${esc(c.etapa)}` : ""}${c.texi ? " · le escribió Texi" : ""}</small>
      ${c.resumen ? `<small>${esc(c.resumen)}</small>` : ""}
      <div class="conv">${conv}</div>
      ${abierto && !SIN_RESPUESTA.has(c.categoria) ? `<textarea>${esc(c.borrador || "")}</textarea>
        <div class="row">${tels.length > 1 ? `<select>${tels.map((t) => `<option value="${t}">${bonito(t)}</option>`).join("")}</select>` : ""}
        <button class="mini primary" data-a="mandar">Mandar (te pregunto antes)</button><button class="mini" data-a="cerrar">Ya lo atendí</button></div>` : ""}
      ${abierto && SIN_RESPUESTA.has(c.categoria) ? `<div class="row"><span class="hint">No le escribo. Ni Texi ni Compri le vuelven a mandar.</span>${cfg.etapaBaja ? `<button class="mini" data-a="baja">Mover a “${esc(cfg.etapaBaja)}”</button>` : ""}<button class="mini" data-a="cerrar">Listo</button></div>` : ""}
      ${!abierto ? `<div class="row">${c.enviado ? `<small>Le contestaste: “${esc(c.enviado.slice(0, 120))}”</small>` : ""}<button class="mini" data-a="reabrir">Volver a abrir</button></div>` : ""}
      ${!abierto || SIN_RESPUESTA.has(c.categoria) ? `<div class="barra">${c.categoria === "baja" ? `<small class="aviso">Pidió STOP: escribirle otra vez puede ir contra las reglas de SMS. Hazlo solo si él te lo pidió.</small>` : ""}
        <textarea class="sms" placeholder="Escríbele un SMS personalizado… (puedes usar {nombre}, {direccion}, {ciudad})">${esc(c.borrador || "")}</textarea>
        <div class="row">${tels.length > 1 ? `<select>${tels.map((t) => `<option value="${t}">${bonito(t)}</option>`).join("")}</select>` : ""}<button class="mini primary" data-a="mandar">Mandar (te pregunto antes)</button></div></div>` : ""}
      <div class="row"><a class="hint" target="_blank" href="https://crm.lofty.com/admin/home/detail?leadId=${encodeURIComponent(c.leadId)}">Abrir en Lofty ↗</a>${!c.telResp && (c.conv || []).some((m) => m.dir === "in") ? `<button class="mini" data-a="numero">¿De qué número contestó?</button>${c.telRespNo ? `<span class="hint">(no lo encontré en Lofty)</span>` : ""}` : ""}</div>
    </div></li>`;
  }).join("");
  $("lista").querySelectorAll("textarea").forEach((t) => (t.oninput = () => { const id = t.closest("li").dataset.id; if (casos[id]) { casos[id].borrador = t.value; guardarCasos(); } }));
  $("lista").querySelectorAll("button[data-a]").forEach((b) => (b.onclick = () => {
    const id = b.closest("li").dataset.id;
    ({ mandar, cerrar, reabrir, baja: moverBaja, numero: async (x) => { b.disabled = true; b.textContent = "Buscando…"; await completarNumeros([x], true); } })[b.dataset.a](id);
  }));
}
document.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { filtro = b.dataset.f; pintar(); }));

// ---------- SMS personalizado a cualquier lead (cuenta de Texi) ----------
let elegido = null;
async function buscarLeads() {
  const q = $("qLead").value.trim();
  if (q.length < 3) { ver("Escribe al menos 3 letras o números para buscar."); return; }
  $("buscarLead").disabled = true; ver(`Buscando “${q}” en Lofty…`);
  try {
    const clave = /\d/.test(q) && digitos(q).length >= 7 ? digitos(q) : q;
    const d = await api(`/v1.0/leads?limit=10&key=${encodeURIComponent(clave)}`);
    const ls = (d.leads || d.data || []).slice(0, 10);
    $("resLeads").innerHTML = ls.length ? ls.map((l, i) => {
      const tels = telsDe(l);
      return `<li data-i="${i}" style="cursor:pointer"><div class="addr"><b>${esc(`${l.firstName || ""} ${l.lastName || ""}`.trim() || "(sin nombre)")}</b>
        <small>${esc(l.stage || "")}${tels.length ? " · " + tels.map(bonito).join(" · ") : " · sin número de CA"}</small></div></li>`;
    }).join("") : `<li class="empty">No encontré leads con “${esc(q)}” en la cuenta de Texi y Compri.</li>`;
    $("resLeads").querySelectorAll("li[data-i]").forEach((li) => (li.onclick = () => elegir(ls[+li.dataset.i])));
    ver(ls.length ? `Encontré ${ls.length} lead(s). Toca uno para escribirle.` : "Sin resultados.");
  } catch (e) { decir(e.sinKey ? e.message : `No pude buscar en Lofty: ${e.message}`, "error"); }
  finally { $("buscarLead").disabled = false; }
}
function telsDe(l) {
  return [...new Set([...(l.phones || []), l.phone, l.mobilePhone, l.homePhone, l.workPhone].filter(Boolean)
    .map((x) => digitos(x && typeof x === "object" ? x.phone || x.number || x.value : x)).filter((x) => x.length === 10))].filter(esCA);
}
function elegir(l) {
  const props = l.leadPropertyList || [];
  const p = props.find((x) => /home/i.test(x.label || "") && x.streetAddress) || props.find((x) => x.streetAddress) || (l.streetAddress ? l : {});
  elegido = { id: String(l.leadId || l.id), nombre: tc(l.firstName || "").split(" ")[0], apellido: tc(l.lastName || ""), calle: tc(p.streetAddress || ""), ciudad: tc(p.city || ""), etapa: l.stage || "", tels: telsDe(l) };
  $("compo").hidden = false;
  $("compoLead").innerHTML = `Para: <b>${esc(`${elegido.nombre} ${elegido.apellido}`.trim())}</b>${elegido.calle ? ` · ${esc(elegido.calle)}${elegido.ciudad ? ", " + esc(elegido.ciudad) : ""}` : ""}${elegido.etapa ? ` · ${esc(elegido.etapa)}` : ""}`;
  $("compoTel").innerHTML = elegido.tels.length ? elegido.tels.map((t) => `<option value="${t}">${bonito(t)}</option>`).join("") : `<option value="">Sin número de California</option>`;
  $("compoMandar").disabled = !elegido.tels.length;
  vista(); $("compoTxt").focus();
}
const personalizar = (t, x) => String(t || "").replace(/\{nombre\}/gi, x.nombre || "there").replace(/\{apellido\}/gi, x.apellido || "")
  .replace(/\{direccion\}/gi, x.calle || "your property").replace(/\{ciudad\}/gi, x.ciudad || "your area").trim();
function vista() {
  const t = elegido ? personalizar($("compoTxt").value, elegido) : "";
  $("compoVista").textContent = t ? `Así le llega: ${t}` : "";
  $("compoLargo").textContent = t ? `${t.length} caracteres${t.length > 160 ? " (puede llegar en 2 partes)" : ""}` : "";
}
async function mandarPersonalizado() {
  if (!elegido) return;
  const num = $("compoTel").value, texto = personalizar($("compoTxt").value, elegido);
  if (!texto) { ver("Escribe el mensaje."); return; }
  if (!num || !esCA(num)) { ver("Este lead no tiene número de California."); return; }
  // Fase 1: a una baja ya no se le puede escribir (antes bastaba un clic extra)
  const { rsNoEscribir = {} } = await almacen.get("rsNoEscribir");
  const b = await SMS.bajaDe({ tel: num, leadId: elegido.id, cuenta: "tx" });
  if (b || rsNoEscribir[elegido.id]) { ver(`No se puede: ${elegido.nombre || "este lead"} tiene baja (${(b && b.motivo) || rsNoEscribir[elegido.id].motivo}). No le mandé nada.`); return; }
  if (!(await preguntar(`Mandar este SMS a ${`${elegido.nombre} ${elegido.apellido}`.trim()} · ${bonito(num)}:\n\n“${texto}”\n\nUn SMS mandado ya no se puede borrar.`, "Mandar", "Cancelar"))) { ver("No mandé nada."); return; }
  if (!(await cerebroDeja(elegido.id, false))) return;
  const pol = await SMS.puedeMandar({ tel: num, leadId: elegido.id, cuenta: "tx", fuente: NOMBRE });
  if (!pol.ok) { await SMS.anotar({ fuente: NOMBRE, leadId: elegido.id, tel: num, estado: "bloqueado", motivo: pol.motivo }); decir(`No mandé el SMS: ${pol.motivo}.`, "error"); return; }
  $("compoMandar").disabled = true;
  try {
    try { await api("/v1.0/message/sms/send", { method: "POST", body: { leadId: Number(elegido.id), content: texto, phoneNumber: num, phoneCode: "1" } }); }
    catch (e) { await SMS.devolverLugar(); await SMS.anotar({ fuente: NOMBRE, leadId: elegido.id, tel: num, estado: "error", motivo: e.message }); throw e; }
    await SMS.anotar({ fuente: NOMBRE, leadId: elegido.id, tel: num, estado: "enviado", texto });
    const ahora = Date.now();
    const { rsHoy = {}, txEnviados = {} } = await almacen.get(["rsHoy", "txEnviados"]);
    txEnviados[elegido.id] = { ...(txEnviados[elegido.id] || {}), t: ahora, plantilla: "personalizado (Resi)", n: 1 }; // así Resi revisa si contesta
    await almacen.set({ rsHoy: { dia: hoy(), n: (rsHoy.dia === hoy() ? rsHoy.n || 0 : 0) + 1 }, txEnviados });
    if (casos[elegido.id]) { Object.assign(casos[elegido.id], { estado: "respondido", respondidoT: ahora, enviado: texto, borrador: "" }); await guardarCasos(); pintar(); }
    decir(`Mandé un SMS personalizado a ${`${elegido.nombre} ${elegido.apellido}`.trim()} (${bonito(num)}). Si contesta, aparece aquí.`);
    $("compoTxt").value = ""; vista();
  } catch (e) { decir(`No se pudo mandar: ${e.message}`, "error"); }
  finally { $("compoMandar").disabled = !elegido || !elegido.tels.length; }
}
$("buscarLead").onclick = buscarLeads;
$("qLead").onkeydown = (e) => { if (e.key === "Enter") buscarLeads(); };
$("compoTxt").oninput = vista;
$("compoMandar").onclick = mandarPersonalizado;
$("compoCerrar").onclick = () => { elegido = null; $("compo").hidden = true; $("resLeads").innerHTML = ""; };

// ---------- Ritmo ----------
function programar() {
  clearInterval(timer);
  if (cfg.auto) timer = setInterval(() => revisar(false), cfg.cadaMin * 60e3);
}
setInterval(vigilar, 5 * 60e3);
$("run").onclick = () => revisar(true);
// ---------- Fase 2: acciones que se pueden pedir por el bus de tareas (registro.js) ----------
window.Tareas && Tareas.atender("revisar", async () => {
  await Tareas.esperarLibre(() => corriendo);
  await revisar(true);
  return $("status").textContent.trim() || "Revisión terminada.";
});
chrome.storage.onChanged.addListener((ch0, area) => { const ch = cambiosMios(ch0); if (area === "local" && ch.rsCasos && !corriendo) { casos = ch.rsCasos.newValue || {}; pintar(); } });
(async () => {
  await cargar(); pintar(); programar(); quitarLimpiados();
  const { txKey, rsUltimo } = await almacen.get(["txKey", "rsUltimo"]);
  if (!txKey) ver("Uso la misma cuenta de Lofty que Texi y Compri: pon su API key en la pestaña de Texi o de Compri.");
  else if (cfg.auto && (!rsUltimo || Date.now() - rsUltimo > cfg.cadaMin * 60e3)) setTimeout(() => revisar(false), 4000);
})();
