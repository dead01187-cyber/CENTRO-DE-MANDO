// =====================================================================
// Maili: manda CORREOS desde Lofty a los leads que escojas (etapa, tag y tipo), con la cuenta de Texi 2 ("t2Key").
// · Primero arma la lista y te enseña a quién y qué le va a mandar. Nada sale sin tu OK.
// · Uno por uno, con pausa de 20–45 s (ritmo humano) y tope diario (50 por defecto).
// · No le escribe a: quien Lofty marca cannotEmail / unsubscribe, bajas de correo (Remi), quien ya recibió
//   un correo de un robot o de una persona en los últimos 7 días (maili-core.js), ni si una persona del
//   equipo le escribió en las últimas 24 h (Cerebro). Justo antes de mandar vuelve a leer el lead en Lofty.
// · Cada correo lleva al final el pie legal (CAN-SPAM): quién manda, dirección postal y cómo darse de baja.
// · API de Lofty: POST /v1.0/message/email/send { leadId, subject, content }.
// · Cada correo se anota en el Cerebro (canal "email", robot "Maili") y en emailRegistro.
// =====================================================================
const M = window.MAILI_CORE;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const hoy = () => new Date().toLocaleDateString("en-CA");
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const creadoLofty = (s) => Date.parse(String(s || "").replace(/GMT$/, "Z")) || 0;
const fecha = (ms) => new Date(ms).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const LLAVE = "t2Key", CUENTA = "t2", NOMBRE = "Maili", DIAS = 7;
const EJEMPLO = { id: "p1", nombre: "Presentación", asunto: "Your home in {ciudad}",
  texto: "Hi {nombre},\n\nThis is Mark with Rubio Real Estate. I work with buyers in {ciudad} and wanted to see if you'd like a free, no-obligation estimate of what your home could sell for today.\n\nWhat's a good time for a quick call?\n\nBest,\nMark" };
const DEF = { etapa: "", tag: "", tipo: "", orden: "viejos", plantilla: "p1", tope: 50, remitente: "", direccion: "" };
let cfg = { ...DEF }, plantillas = [], lista = [], corriendo = false, parar = false, vista = "faltan", sinHistorial = false;

// ---------- API de Lofty (cuenta de Texi 2) ----------
async function api(path, opts = {}) {
  const key = (await chrome.storage.local.get(LLAVE))[LLAVE];
  if (!key) throw Object.assign(new Error("Falta la API key de la cuenta de Texi 2: ponla en la pestaña de Texi 2 (Cuenta de Lofty para los SMS)."), { sinKey: true });
  let r;
  for (let i = 0; ; i++) {
    r = await fetch("https://api.lofty.com/v1.0" + path, { method: opts.method || "GET",
      headers: { Authorization: "token " + key, "X-Error-Status": "true", ...(opts.body ? { "Content-Type": "application/json" } : {}) }, ...(opts.body ? { body: JSON.stringify(opts.body) } : {}) });
    if (r.status !== 429 || i >= 4) break;
    const ra = parseInt(r.headers.get("Retry-After") || "", 10);
    ver(`Lofty pidió ir más lento; espero ${ra > 0 ? ra : 2 * 2 ** i} s…`);
    await sleep(ra > 0 ? ra * 1000 : 2000 * 2 ** i);
  }
  const cuerpo = await r.text(); let d = {}; try { d = cuerpo ? JSON.parse(cuerpo) : {}; } catch (e) { d = { message: cuerpo }; }
  if (!r.ok) throw Object.assign(new Error(`Lofty respondió ${r.status}` + (d.message ? `: ${String(d.message).slice(0, 140)}` : "")), { status: r.status });
  return d;
}

// ---------- Configuración y plantillas ----------
async function cargar() {
  const st = await chrome.storage.local.get(["mlConfig", "mlPlantillas", "mlLista", LLAVE]);
  cfg = { ...DEF, ...(st.mlConfig || {}) };
  plantillas = Array.isArray(st.mlPlantillas) && st.mlPlantillas.length ? st.mlPlantillas : [{ ...EJEMPLO }];
  if (!plantillas.some((p) => p.id === cfg.plantilla)) cfg.plantilla = plantillas[0].id;
  lista = Array.isArray(st.mlLista) ? st.mlLista.map((x) => (x.estado === "mandando" ? { ...x, estado: "" } : x)) : [];
  for (const k of ["etapa", "tag", "tipo", "orden", "remitente", "direccion", "tope"]) $(k).value = cfg[k];
  $("cuentaTxt").textContent = st[LLAVE] ? "· conectada" : "· falta la API key (ponla en la pestaña de Texi 2)";
  pintarPlantillas(); pintarPie(); pintarLista();
}
function guardarCfg() {
  cfg = { ...cfg, etapa: $("etapa").value.trim(), tag: $("tag").value.trim(), tipo: $("tipo").value, orden: $("orden").value,
    remitente: $("remitente").value.trim(), direccion: $("direccion").value.trim(), tope: Math.min(300, Math.max(1, parseInt($("tope").value, 10) || 50)) };
  chrome.storage.local.set({ mlConfig: cfg });
}
const plantilla = () => plantillas.find((p) => p.id === cfg.plantilla) || plantillas[0];
const guardarPlantillas = () => chrome.storage.local.set({ mlPlantillas: plantillas });
function pintarPlantillas() {
  $("plantilla").innerHTML = plantillas.map((p) => `<option value="${esc(p.id)}"${p.id === cfg.plantilla ? " selected" : ""}>${esc(p.nombre || "(sin nombre)")}</option>`).join("");
  const p = plantilla(); $("plNombre").value = p.nombre; $("plAsunto").value = p.asunto; $("plTexto").value = p.texto; pintarErrores();
}
const errores = () => M.revisarPlantilla(plantilla(), cfg);
function pintarErrores() { $("plErrores").textContent = errores().join(" "); }
function pintarPie() {
  const falta = !cfg.remitente || String(cfg.direccion).length < 10;
  $("pieTxt").textContent = falta ? "· falta llenarlo" : `· ${cfg.remitente}`;
  if (falta) $("pieCaja").open = true;
}
$("plantilla").onchange = () => { cfg.plantilla = $("plantilla").value; guardarCfg(); pintarPlantillas(); pintarLista(); };
$("plNombre").oninput = () => { plantilla().nombre = $("plNombre").value; guardarPlantillas(); $("plantilla").selectedOptions[0].textContent = $("plNombre").value || "(sin nombre)"; };
$("plAsunto").oninput = () => { plantilla().asunto = $("plAsunto").value; guardarPlantillas(); pintarErrores(); pintarLista(); };
$("plTexto").oninput = () => { plantilla().texto = $("plTexto").value; guardarPlantillas(); pintarErrores(); pintarLista(); };
$("nueva").onclick = () => { const p = { id: "p" + Date.now(), nombre: `Plantilla ${plantillas.length + 1}`, asunto: "", texto: "" }; plantillas.push(p); cfg.plantilla = p.id; guardarPlantillas(); guardarCfg(); pintarPlantillas(); $("plAsunto").focus(); };
$("borrarPl").onclick = () => {
  if (plantillas.length < 2) { ver("Debe quedar al menos una plantilla."); return; }
  plantillas = plantillas.filter((p) => p.id !== cfg.plantilla); cfg.plantilla = plantillas[0].id; guardarPlantillas(); guardarCfg(); pintarPlantillas(); pintarLista();
};
["etapa", "tag", "tipo", "remitente", "direccion", "tope"].forEach((id) => ($(id).onchange = () => { guardarCfg(); pintarErrores(); pintarPie(); pintarLista(); }));
function ordenar() { const nuevos = $("orden").value === "nuevos"; lista.sort((a, b) => (!a.creado) - (!b.creado) || (nuevos ? b.creado - a.creado : a.creado - b.creado)); }
$("orden").onchange = () => { guardarCfg(); ordenar(); guardarLista(); pintarLista(); };
const guardarLista = () => chrome.storage.local.set({ mlLista: lista });

// ---------- 1) Buscar leads ----------
const esDelTipo = (l, tipo) => !tipo || [].concat(l.leadTypes || [], l.leadType != null ? l.leadType : []).map(Number).includes(Number(tipo));
async function buscar() {
  if (corriendo) return;
  guardarCfg();
  if (!cfg.etapa && !cfg.tag) { ver("Escribe una etapa del pipeline o un tag."); $("etapa").focus(); return; }
  corriendo = true; parar = false; $("buscar").disabled = true; $("mandar").disabled = true; $("confirma").hidden = true;
  window.robot && robot.set("trabajando", "Buscando leads en Lofty…");
  const { mlEnviados = {}, emailBajas = {}, cerebroContactos = [] } = await chrome.storage.local.get(["mlEnviados", "emailBajas", "cerebroContactos"]);
  const bajaCorreo = emailBajas.correos || {}, bajaLead = emailBajas.leads || {};
  const encontrados = []; let revisados = 0, otroTipo = 0, sinMail = 0, optOut = 0, bajas = 0, recientes = 0;
  try {
    for (let offset = 0; offset < 20000 && !parar; ) {
      ver(`Buscando en Lofty${cfg.etapa ? ` la etapa “${cfg.etapa}”` : ""}${cfg.tag ? ` con el tag “${cfg.tag}”` : ""}… (${revisados} revisados, ${encontrados.length} encontrados)`);
      const d = await api(`/leads?limit=100&offset=${offset}` + (cfg.etapa ? `&stage=${encodeURIComponent(cfg.etapa)}` : ""));
      const leads = d.leads || d.data || [];
      if (!leads.length) break;
      for (const l of leads) {
        revisados++;
        if (cfg.etapa && norm(l.stage) !== norm(cfg.etapa)) continue;
        if (cfg.tag && !(l.tags || []).some((t) => norm(t.tagName || t.name || t) === norm(cfg.tag))) continue;
        if (!esDelTipo(l, cfg.tipo)) { otroTipo++; continue; }
        const x = M.datosDe(l), motivo = M.sinCorreo(l);
        if (motivo) { /no tiene correo/.test(motivo) ? sinMail++ : optOut++; continue; }
        if (bajaCorreo[x.correo.toLowerCase()] || bajaLead[`${CUENTA}:${x.leadId}`]) { bajas++; continue; }
        const r = M.puede({ leadId: x.leadId, contactos: cerebroContactos, dias: DIAS }); // con lo que ya sabe el Cerebro (antes de mandar se revisa Lofty)
        const env = mlEnviados[x.leadId];
        if (!r.ok) recientes++;
        encontrados.push({ ...x, id: x.leadId, creado: creadoLofty(l.createTime), etapa: l.stage || "", antes: env ? env.t : 0, marcado: r.ok, estado: "", detalle: r.ok ? "" : r.motivo });
      }
      offset += leads.length;
      if (leads.length < 100) break;
    }
    lista = encontrados; ordenar(); await guardarLista(); pintarLista();
    const salte = [otroTipo ? `${otroTipo} de otro tipo` : "", sinMail ? `${sinMail} sin correo` : "", optOut ? `${optOut} que Lofty marca “no correos”` : "", bajas ? `${bajas} que pidieron baja de correos` : ""].filter(Boolean).join(", ");
    if (!lista.length) decir(`No encontré leads con correo${cfg.etapa ? ` en “${cfg.etapa}”` : ""}${cfg.tag ? ` con el tag “${cfg.tag}”` : ""}` + (salte ? ` (salté ${salte})` : "") + ".");
    else decir(`Encontré ${lista.length} lead(s) con correo` + (salte ? ` (salté ${salte})` : "") + (recientes ? `; ${recientes} ya recibieron un correo en los últimos ${DIAS} días (no los marqué)` : "") + ". Revisa la lista y el correo; cuando estés listo dale “Revisar y mandar”.");
    window.robot && robot.set(lista.length ? "feliz" : "idle", lista.length ? `${lista.length} leads listos para revisar` : "Sin leads");
  } catch (e) {
    decir(e.sinKey ? e.message : `No pude traer los leads: ${e.message}`, "error");
    window.robot && robot.set("error", "No pude traer los leads");
  } finally { corriendo = false; $("buscar").disabled = false; contar(); }
}

// ---------- Lista ----------
const grupo = (x) => (x.estado === "enviado" ? "mandados" : x.estado === "error" || x.estado === "saltado" ? "problema" : "faltan");
function pintarLista() {
  const n = { faltan: 0, mandados: 0, problema: 0 }; for (const x of lista) n[grupo(x)]++;
  $("vFaltan").textContent = `Faltan (${n.faltan})`; $("vMandados").textContent = `Ya mandados (${n.mandados})`; $("vProblema").textContent = `Saltados / error (${n.problema})`;
  for (const [id, v] of [["vFaltan", "faltan"], ["vMandados", "mandados"], ["vProblema", "problema"]]) $(id).classList.toggle("on", vista === v);
  $("marcarTodos").hidden = $("desmarcar").hidden = vista !== "faltan";
  const ul = $("lista");
  if (!lista.length) { ul.innerHTML = `<li class="empty">Escribe una etapa o un tag y dale “Buscar leads”. Te enseño a quién le voy a mandar y qué dice el correo antes de mandar nada.</li>`; contar(); return; }
  const idx = lista.map((x, i) => i).filter((i) => grupo(lista[i]) === vista);
  if (!idx.length) { ul.innerHTML = `<li class="empty">${vista === "faltan" ? "Ya no falta nadie de esta lista." : vista === "mandados" ? "Todavía no se le ha mandado a ninguno de esta lista." : "Ninguno saltado ni con error."}</li>`; contar(); return; }
  const p = plantilla();
  ul.innerHTML = idx.slice(0, 300).map((i) => { const x = lista[i], c = M.armar(p, x, cfg);
    const est = x.estado === "enviado" ? `<span class="tag ok">enviado</span>` : x.estado === "error" ? `<span class="tag bad">error</span>` : x.estado === "mandando" ? `<span class="tag wait">mandando…</span>` : x.estado === "saltado" ? `<span class="tag wait">saltado</span>` : "";
    return `<li data-id="${esc(x.id)}"><input type="checkbox" data-i="${i}" ${x.marcado && !x.estado ? "checked" : ""} ${x.estado ? "disabled" : ""}>
      <div class="addr"><b>${esc(`${x.nombre === "there" ? "" : x.nombre} ${x.apellido}`.trim() || "(sin nombre)")}</b> ${est}
      <small>${esc(x.correo)}${x.ciudad ? ` · ${esc(x.ciudad)}` : ""}${x.etapa ? ` · ${esc(x.etapa)}` : ""}</small>
      ${x.antes ? `<small>Ya le mandé un correo el ${fecha(x.antes)}</small>` : ""}
      ${x.detalle ? `<small style="color:${x.estado === "error" ? "#b91c1c" : "#854d0e"}">${esc(x.detalle)}</small>` : ""}
      <div class="sms"><b>${esc(c.asunto)}</b>${esc(c.texto)}</div></div></li>`;
  }).join("") + (idx.length > 300 ? `<li class="empty">…y ${idx.length - 300} más (enseño los primeros 300).</li>` : "");
  ul.querySelectorAll("input[type=checkbox]").forEach((c) => (c.onchange = () => { lista[+c.dataset.i].marcado = c.checked; guardarLista(); contar(); }));
  contar();
}
const porMandar = () => lista.filter((x) => x.marcado && !x.estado);
async function hechosHoy() { const { mlHoy = {} } = await chrome.storage.local.get("mlHoy"); return mlHoy.dia === hoy() ? mlHoy.n || 0 : 0; }
async function contar() {
  $("nLista").textContent = lista.filter((x) => grupo(x) === "faltan").length; $("nMarcados").textContent = porMandar().length;
  $("nHoy").textContent = await hechosHoy();
  $("mandar").disabled = corriendo || !porMandar().length;
}
$("marcarTodos").onclick = () => { lista.forEach((x) => { if (!x.estado && !x.detalle) x.marcado = true; }); guardarLista(); pintarLista(); };
$("desmarcar").onclick = () => { lista.forEach((x) => { if (!x.estado) x.marcado = false; }); guardarLista(); pintarLista(); };
["vFaltan", "vMandados", "vProblema"].forEach((id) => ($(id).onclick = () => { vista = { vFaltan: "faltan", vMandados: "mandados", vProblema: "problema" }[id]; pintarLista(); }));

// ---------- 2) Revisar y dar el OK ----------
$("mandar").onclick = async () => {
  const m = porMandar(); if (!m.length) return;
  guardarCfg();
  const errs = errores();
  if (errs.length) { pintarErrores(); pintarPie(); decir("No puedo mandar todavía: " + errs.join(" "), "error"); return; }
  const hechos = await hechosHoy(), cupo = Math.max(0, cfg.tope - hechos);
  if (!cupo) { decir(`Ya se mandaron ${hechos} correos hoy: se llegó al tope de ${cfg.tope} por día.`); return; }
  const c = M.armar(plantilla(), m[0], cfg);
  $("confTxt").innerHTML = `Vas a mandar <b>${Math.min(m.length, cupo)} correo(s)</b>${m.length > cupo ? ` (de ${m.length} marcados; hoy solo caben ${cupo} por el tope de ${cfg.tope})` : ""} con la plantilla <b>${esc(plantilla().nombre)}</b>, desde la cuenta de Lofty de <b>Texi 2</b>.<br>
    Ejemplo para ${esc(m[0].correo)}:<div class="sms"><b>${esc(c.asunto)}</b>${esc(c.texto)}</div>
    <span class="hint">Un correo mandado ya no se puede borrar. Mando uno cada 20–45 segundos y antes de cada uno reviso en Lofty que se le pueda escribir.</span>`;
  $("confirma").hidden = false; $("confirma").scrollIntoView({ block: "nearest" });
};
$("no").onclick = () => { $("confirma").hidden = true; ver("Cancelado: no mandé nada."); };
$("si").onclick = () => { $("confirma").hidden = true; mandar(); };
$("stop").onclick = () => { parar = true; ver("Parando…"); };

// ---------- 3) Mandar ----------
async function anotarRegistro(ev) {
  const fn = async () => { const { emailRegistro = [] } = await chrome.storage.local.get("emailRegistro"); emailRegistro.push({ t: Date.now(), fuente: NOMBRE, ...ev }); await chrome.storage.local.set({ emailRegistro: emailRegistro.slice(-5000) }); };
  try { await (navigator.locks ? navigator.locks.request("email-registro", fn) : fn()); } catch (e) {}
}
// Historial de correos del lead en Lofty. Si Lofty no tiene ese servicio (404), se sigue solo con el registro del Cerebro.
async function correosDe(id) {
  if (sinHistorial) return [];
  try { const d = await api(`/communication/email?leadId=${encodeURIComponent(id)}&limit=40`); return (d.emails || d.data || d.list || (Array.isArray(d) ? d : [])).map(M.deLofty).filter((e) => e.t); }
  catch (e) { if (e.status === 404) { sinHistorial = true; window.svLog && svLog("Maili: Lofty no me dio el historial de correos (404); reviso solo con el registro del Cerebro."); return []; } throw e; }
}
async function revisarAntes(x) {
  const d = await api(`/leads/${encodeURIComponent(x.id)}`), l = d.lead || d.data || d;
  const motivo = M.sinCorreo(l);
  if (motivo) return { ok: false, motivo };
  const correo = M.correoDe(l);
  const { emailBajas = {}, cerebroContactos = [] } = await chrome.storage.local.get(["emailBajas", "cerebroContactos"]);
  if ((emailBajas.correos || {})[correo.toLowerCase()] || (emailBajas.leads || {})[`${CUENTA}:${x.id}`]) return { ok: false, motivo: "pidió baja de correos" };
  // Cerebro (y el árbitro del puente si está): una persona le escribió por SMS en 24 h, etc. Anna es de la otra cuenta.
  if (window.Cerebro) { const cb = await Cerebro.puedo({ leadId: x.id, canal: "email", robot: NOMBRE, llave: LLAVE, respetaAnna: false }); if (!cb.ok) return { ok: false, motivo: "Cerebro: " + cb.motivo, error: cb.codigo === "error" }; }
  const r = M.puede({ leadId: x.id, contactos: (await chrome.storage.local.get("cerebroContactos")).cerebroContactos || cerebroContactos, correos: await correosDe(x.id), dias: DIAS });
  return r.ok ? { ok: true, correo } : { ok: false, motivo: r.motivo };
}
async function mandar() {
  if (corriendo) return;
  corriendo = true; parar = false; $("mandar").disabled = true; $("buscar").disabled = true;
  const p = plantilla(); let enviados = 0, saltados = 0, fallas = 0, seguidas = 0;
  window.robot && robot.set("trabajando", "Mandando correos…");
  try {
    const cola = porMandar();
    for (let n = 0; n < cola.length && !parar; n++) {
      const x = cola[n];
      if ((await hechosHoy()) >= cfg.tope) { decir(`Me detengo: se llegó al tope de ${cfg.tope} correos por día. Mañana sigo con los que faltan.`); break; }
      x.estado = "mandando"; pintarLista();
      try {
        const rev = await revisarAntes(x);
        if (!rev.ok) { x.estado = rev.error ? "error" : "saltado"; x.detalle = rev.motivo; x.marcado = false; saltados++; await anotarRegistro({ leadId: x.id, correo: x.correo, estado: "bloqueado", motivo: rev.motivo }); await guardarLista(); pintarLista(); continue; }
        const c = M.armar(p, { ...x, correo: rev.correo }, cfg);
        await api("/message/email/send", { method: "POST", body: { leadId: Number(x.id), subject: c.asunto, content: c.html } });
        x.estado = "enviado"; x.detalle = ""; x.antes = Date.now(); enviados++; seguidas = 0;
        if (window.Cerebro) await Cerebro.anotar({ leadId: x.id, canal: "email", robot: NOMBRE });
        await anotarRegistro({ leadId: x.id, correo: rev.correo, estado: "enviado", asunto: c.asunto, plantilla: p.nombre });
        const st = await chrome.storage.local.get(["mlEnviados", "mlHoy"]);
        const env = st.mlEnviados || {}; env[x.id] = { t: Date.now(), asunto: c.asunto, correo: rev.correo };
        await chrome.storage.local.set({ mlEnviados: env, mlHoy: { dia: hoy(), n: ((st.mlHoy || {}).dia === hoy() ? st.mlHoy.n || 0 : 0) + 1 } });
        ver(`Correo ${enviados} enviado a ${x.nombre} ${x.apellido}. Faltan ${cola.length - n - 1}.`);
      } catch (e) {
        x.estado = "error"; x.detalle = e.message; fallas++; seguidas++;
        await anotarRegistro({ leadId: x.id, correo: x.correo, estado: "error", motivo: e.message });
        if (e.sinKey || e.status === 401 || e.status === 403 || seguidas >= 3) { decir(`Me detengo: ${e.sinKey || e.status === 401 || e.status === 403 ? e.message : "Lofty falló 3 veces seguidas (" + e.message + ")"}.`, "error"); await guardarLista(); pintarLista(); break; }
      }
      await guardarLista(); pintarLista();
      if (n < cola.length - 1 && !parar && x.estado === "enviado") { const ms = M.pausaMs(); for (let t = 0; t < ms && !parar; t += 500) await sleep(Math.min(500, ms - t)); }
    }
    const txt = `${parar ? "Detenido" : "Listo"}: mandé ${enviados} correo(s)` + (saltados ? `, salté ${saltados}` : "") + (fallas ? `, ${fallas} con error` : "") + ".";
    decir(txt, fallas && !enviados ? "error" : undefined);
    window.robot && robot.set(fallas && !enviados ? "error" : "feliz", txt);
    await chrome.storage.local.set({ mlRes: { t: Date.now(), enviados, saltados, fallas } });
  } finally { corriendo = false; $("buscar").disabled = false; contar(); }
}

$("buscar").onclick = buscar;
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch[LLAVE]) $("cuentaTxt").textContent = ch[LLAVE].newValue ? "· conectada" : "· falta la API key (ponla en la pestaña de Texi 2)"; });
// Si Remi anota una baja mientras Maili tiene la lista abierta, se respeta al mandar (revisarAntes lee emailBajas)
window.Maili = { buscar, mandar, lista: () => lista }; // para pruebas
cargar();
