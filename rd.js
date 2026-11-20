// =====================================================================
// Redi: hace el BORRADOR del correo de reclamo a zBuyer para cada lead que
// Zeta marcó "ya lo teníamos" con fuente zBuyer. Abre la ventana de redactar de Gmail con
// todo lleno, Gmail lo guarda en Borradores y Redi cierra la pestaña.
// NUNCA envía: tú revisas el borrador y lo mandas. Con el borrador listo le toma
// una captura completa (la ventana de redactar) para que Timi la mande a Teams.
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const fechaCorta = (ms) => ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

// Plantilla del reclamo, con la redacción que pidió el jefe. En el texto va PRIMERO la fecha vieja (el Reg Date
// de Lofty, "Date Original") y DESPUÉS la nueva (la del correo de zBuyer). {origen} pone
// "Z Buyer (or Z Buyer Prospecting sheets)"; {capturas} es donde se pegan las dos imágenes.
const PLANTILLA = 3; // súbelo cuando cambie esta plantilla de fábrica: reemplaza UNA vez al asunto y al mensaje guardados
const DEF = {
  para: "achesney@zbuyer.com",
  cc: "rubio.realestate@gmail.com",
  asunto: "ZBuyer Lead Replacement: {nombre}",
  cuerpo: "Hi Z Buyer Lead Replacement team,\n\nI'm requesting a replacement for a duplicate lead received. We had this lead from {origen} on {fechaLofty} (Date Original). This lead re-inquired on {fechaCorreo}. Since we already had this lead, we need a refund. see snapshot below.\n\n{capturas}\n\n--\nChristopher Rubio, MBA\nReal Estate Advisor\nBroker / Paralegal / TV\nDirector- Northern & Southern CA\nC: (310) 467-7189 So Cal\nC: (415) 799-6522 Nor Cal\nDRE #01959226",
  auto: true,
  capturas: true,
  plantilla: PLANTILLA,
};
let cfg = { ...DEF }, corriendo = false, parar = false;

async function cargarCfg() {
  const { rdConfig = {} } = await chrome.storage.local.get("rdConfig");
  cfg = { ...DEF, ...rdConfig };
  // Plantilla de fábrica nueva: reemplaza una sola vez al asunto y al mensaje que estaban guardados (después, tus cambios se quedan)
  if (rdConfig.plantilla !== PLANTILLA) { cfg.asunto = DEF.asunto; cfg.cuerpo = DEF.cuerpo; cfg.plantilla = PLANTILLA; chrome.storage.local.set({ rdConfig: cfg }); }
  for (const k of ["para", "cc", "asunto", "cuerpo"]) $(k).value = cfg[k];
  $("auto").checked = cfg.auto; $("capturas").checked = cfg.capturas !== false;
}
function guardarCfg() {
  cfg = { para: $("para").value.trim(), cc: $("cc").value.trim(), asunto: $("asunto").value, cuerpo: $("cuerpo").value, auto: $("auto").checked, capturas: $("capturas").checked, plantilla: PLANTILLA };
  chrome.storage.local.set({ rdConfig: cfg });
}
["para", "cc", "asunto", "cuerpo", "auto", "capturas"].forEach((id) => ($(id).onchange = () => { guardarCfg(); if (cfg.auto) hacer(false); }));
$("restaurar").onclick = async () => { if (!(await preguntar("¿Regresar el asunto y el mensaje a la plantilla original del reclamo?", "Regresar"))) return; for (const k of ["asunto", "cuerpo"]) $(k).value = DEF[k]; guardarCfg(); vista(); };

const MARCA = "[[CAPTURAS]]";
// {campo} → dato del lead. Si ya hay capturas, las fechas y la fuente son las que SE VEN en ellas (fechaLoftyTxt…)
function llenar(t, l) {
  const fuente = l.fuenteTxt || l.loftyFuente || "";
  const deZb = deZbuyer(fuente);
  const v = {
    nombre: l.nombre, telefono: l.tel, telefono2: l.tel2, correo: l.correo, direccion: l.direccion, calle: l.calle, ciudad: l.ciudad, zip: l.zip,
    leadIdZb: l.leadIdZb, fechaCorreo: l.fechaCorreoTxt || fechaCorta(l.fechaCorreo), fechaLofty: l.fechaLoftyTxt || fechaCorta(l.loftyCreado),
    etapaLofty: l.loftyEtapa, fuenteLofty: fuente || "our CRM", nombreLofty: l.loftyNombre, coincide: (l.coincide || []).join(", "),
    origen: deZb ? "Z Buyer (or Z Buyer Prospecting sheets)" : fuente || "our CRM",   // de dónde venía el lead que ya teníamos
    capturas: cfg.capturas ? MARCA : "",
  };
  return String(t || "").replace(/\{(\w+)\}/g, (m, k) => (k in v ? (v[k] || "") : m));
}
const aFecha = (txt) => Date.parse(String(txt || "").replace(/[\u202f\u00a0]/g, " ")) || 0;

// Corre dentro de la ventana de redactar: espera a que Gmail guarde el borrador
async function esperarGuardado() {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 50; i++) {
    const cuerpo = document.querySelector('div[aria-label="Message Body"], div[aria-label="Cuerpo del mensaje"], div[g_editable="true"]');
    const guardado = [...document.querySelectorAll("span,div")].some((e) => !e.children.length && /^(Draft saved|Saved|Borrador guardado|Guardado)$/i.test((e.textContent || "").trim()));
    if (cuerpo && guardado) return { ok: true, texto: cuerpo.innerText.slice(0, 80) };
    if (/accounts\.google\.com/.test(location.host)) return { ok: false, motivo: "Gmail pide iniciar sesión" };
    await espera(400);
  }
  return { ok: false, motivo: "no vi que Gmail guardara el borrador" };
}

// Ruta de tu cuenta en Gmail (ej. /mail/u/1/). Gmail solo guarda el borrador si se abre con esa ruta directa.
async function baseGmail() {
  const { zbBase, zbConfig = {} } = await chrome.storage.local.get(["zbBase", "zbConfig"]);
  if (zbBase) return zbBase;
  const cuenta = zbConfig.cuenta || "rubioteamcaller01@gmail.com";
  const t = await abrirPestana(`https://mail.google.com/mail/?authuser=${encodeURIComponent(cuenta)}#inbox`);
  await sleep(1500);
  const x = await chrome.tabs.get(t.id).catch(() => null);
  await chrome.tabs.remove(t.id).catch(() => {});
  const m = ((x && x.url) || "").match(/^https:\/\/mail\.google\.com(\/mail\/u\/\d+\/)/);
  if (!m) throw new Error("no pude abrir tu Gmail (¿sesión abierta?)");
  await chrome.storage.local.set({ zbBase: m[1] });
  return m[1];
}
async function unBorrador(l) {
  const base = await baseGmail();
  const d = { ...l }; // el lead, con las fechas y la fuente tal como se ven en las capturas
  // 1) Capturas (ficha de Lofty + correo de zBuyer) antes de redactar, para que el texto diga lo mismo que se ve
  let caps = null;
  if (cfg.capturas) {
    ver(`Tomando capturas de ${l.nombre} (Lofty y el correo de zBuyer)…`);
    caps = await capturasDe(l, base).catch((e) => ({ errores: [e.message] }));
    if (caps.errores && caps.errores.length) svLog && svLog(`Capturas de ${l.nombre}: ${caps.errores.join(" · ")}. Hago el borrador con lo que sí salió.`, "error");
    if (caps.lofty && aFecha(caps.lofty.regDate)) d.fechaLoftyTxt = caps.lofty.regDate;
    if (caps.lofty && caps.lofty.fuente) d.fuenteTxt = caps.lofty.fuente;
    if (caps.correo && aFecha(caps.correo.fecha)) d.fechaCorreoTxt = fechaCorta(aFecha(caps.correo.fecha));
    // Solo se reclama si el lead que ya teníamos venía de zBuyer (a menos que tú le hayas dado "Reclamar" a mano)
    if (d.fuenteTxt && !deZbuyer(d.fuenteTxt) && !l.aMano)
      return { ok: false, noConcuerda: true, motivo: `en Lofty la fuente (Source) de este lead dice “${d.fuenteTxt}”, no zBuyer` };
    // ¿Concuerdan? El Reg Date que se ve en Lofty tiene que ser anterior a la fecha del correo de zBuyer
    const a = aFecha(d.fechaLoftyTxt), b = aFecha(d.fechaCorreoTxt);
    if (a && b && new Date(a).setHours(0, 0, 0, 0) > new Date(b).setHours(0, 0, 0, 0))
      return { ok: false, noConcuerda: true, motivo: `las fechas no concuerdan: Lofty muestra Reg Date ${d.fechaLoftyTxt} y el correo de zBuyer es del ${d.fechaCorreoTxt}` };
    if (d.fechaLoftyTxt && l.loftyCreado && Math.abs(a - l.loftyCreado) > 36 * 3600000)
      svLog && svLog(`${l.nombre}: Lofty muestra Reg Date ${d.fechaLoftyTxt} (yo tenía ${fechaCorta(l.loftyCreado)}). Uso la fecha que se ve en la captura.`);
  }
  // 2) Ventana de redactar
  ver(`Redactando el borrador para ${l.nombre}…`);
  const q = new URLSearchParams({ view: "cm", fs: "1", tf: "1", to: cfg.para, su: llenar(cfg.asunto, d), body: llenar(cfg.cuerpo, d) });
  if (cfg.cc) q.set("cc", cfg.cc);
  const t = await abrirPestana(`https://mail.google.com${base}?${q}`);
  await sleep(1500);
  let res;
  if (cfg.capturas) {
    // 3) Pegar las capturas donde va {capturas} (o quitar la marca si no salieron) y esperar a que Gmail guarde
    const { html, cuantas } = htmlCapturas(caps);
    const [p] = await chrome.scripting.executeScript({ target: { tabId: t.id }, world: "MAIN", func: pegarEnBorrador, args: [html, MARCA, cuantas] })
      .catch((e) => [{ result: { ok: false, motivo: e.message } }]);
    res = (p && p.result) || { ok: false, motivo: "la pestaña no respondió" };
  } else {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: esperarGuardado }).catch((e) => [{ result: { ok: false, motivo: e.message } }]);
    res = (r && r.result) || { ok: false, motivo: "la pestaña no respondió" };
  }
  // 4) Con el borrador ya guardado: la captura completa para Teams (si Timi está prendido)
  let fotoRes = null;
  if (res.ok) {
    const { tiConfig = {} } = await chrome.storage.local.get("tiConfig");
    if (tiConfig.activo !== false) {
      ver(`Tomando la captura del borrador de ${l.nombre} para Teams…`);
      const f = await fotoBorrador(t.id);
      if (f && !f.error) fotoRes = await fotoGuardar(l.leadIdZb, f.url).then(() => ({ ok: true }), (e) => ({ error: "no pude guardar la captura: " + e.message }));
      else fotoRes = { error: (f && f.error) || "falló" };
    }
    await sleep(1200); await chrome.tabs.remove(t.id).catch(() => {});
  }
  return { ...res, tabId: t.id, fotoRes, fechaLofty: d.fechaLoftyTxt || "", fechaCorreo: d.fechaCorreoTxt || "", faltaron: caps ? caps.errores || [] : [] };
}

const marcar = (id, datos) => zbPoner({ [id]: datos }); // lo escribe el background, en fila con Zeta y Timi
const porHacer = (zbLeads) => Object.values(zbLeads).filter((l) => reclamable(l) && !l.borrador && !l.realizado).sort((a, b) => a.fechaCorreo - b.fechaCorreo);

async function hacer(aMano) {
  if (corriendo) return;
  guardarCfg();
  if (!cfg.para) { ver("Pon el correo de zBuyer en “Para”."); return; }
  const { zbLeads = {} } = await chrome.storage.local.get("zbLeads");
  const lista = porHacer(zbLeads);
  if (!lista.length) { if (aMano) ver("No hay leads repetidos pendientes de borrador."); return; }
  corriendo = true; parar = false; $("run").disabled = true;
  let hechos = 0;
  try {
    for (const l of lista) {
      if (parar) break;
      window.robot && robot.set("trabajando", `Redactando reclamo de ${l.nombre}…`);
      ver(`Redactando el borrador para ${l.nombre}…`);
      const r = await unBorrador(l).catch((e) => ({ ok: false, sinVentana: true, motivo: e.message }));
      if (r.ok) {
        hechos++;
        // Para Teams: si ya se había mandado la de este lead (lo estás rehaciendo), no se manda otra vez sola
        const { zbLeads: zAhora = {} } = await chrome.storage.local.get("zbLeads");
        const yaEnTeams = (zAhora[l.leadIdZb] || {}).teams === "enviado";
        const paraTeams = !r.fotoRes ? {} : r.fotoRes.ok ? { teams: yaEnTeams ? "enviado" : "pendiente", teamsError: "", fotoT: Date.now() }
          : { teams: yaEnTeams ? "enviado" : "error", teamsError: "no salió la captura del borrador: " + r.fotoRes.error };
        await marcar(l.leadIdZb, { borrador: "hecho", borradorT: Date.now(), nCapturas: r.imagenes || 0, ...paraTeams });
        svLog && svLog(`✉ Borrador listo en Gmail: reclamo de ${l.nombre} a zBuyer${r.imagenes ? ` con ${r.imagenes} captura(s)` : ""} (sin enviar).`);
        if (r.fotoRes && r.fotoRes.error) svLog && svLog(`No pude tomar la captura del borrador de ${l.nombre} para Teams: ${r.fotoRes.error}.`, "error");
      } else {
        await marcar(l.leadIdZb, { borrador: "error", borradorError: r.motivo });
        if (r.noConcuerda) decir(`No hice el borrador de ${l.nombre}: ${r.motivo}. Revísalo tú en Lofty.`, "error");
        else decir(`No pude dejar el borrador de ${l.nombre}: ${r.motivo}.${r.sinVentana ? "" : " Dejé la ventana abierta para que la revises."}`, "error");
        if (/sesión/.test(r.motivo)) break;
      }
      await sleep(1500);
    }
  } finally {
    corriendo = false; $("run").disabled = false;
    if (hechos) decir(`Listo: dejé ${hechos} borrador(es) en tu Gmail para zBuyer. Revísalos y envíalos tú.`);
    pintar();
    const { zbLeads: z2 = {} } = await chrome.storage.local.get("zbLeads");
    if (cfg.auto && !parar && porHacer(z2).length) setTimeout(() => hacer(false), 3000); // llegaron más mientras tanto
  }
}

// ---------- Pantalla ----------
async function vista() {
  const { zbLeads = {} } = await chrome.storage.local.get("zbLeads");
  const ej = porHacer(zbLeads)[0] || Object.values(zbLeads).find(reclamable) || {
    nombre: "Jane Doe", tel: "(714) 555-0100", direccion: "123 Main St, Irvine, CA 92618", leadIdZb: "000000-0000000",
    fechaCorreo: Date.now(), loftyCreado: Date.now() - 86400000 * 200, loftyFuente: "zBuyer", coincide: ["teléfono"] };
  $("vista").textContent = `Para: ${$("para").value}${$("cc").value ? "\nCC: " + $("cc").value : ""}\nAsunto: ${llenar($("asunto").value, ej)}\n\n${llenar($("cuerpo").value, ej).replace(MARCA, $("capturas").checked ? "📷 [aquí van las capturas: primero la ficha de Lofty y debajo el correo de zBuyer]" : "")}`;
}
["asunto", "cuerpo", "para", "cc"].forEach((id) => $(id).addEventListener("input", vista));
$("capturas").addEventListener("change", vista);

async function pintar() {
  const { zbLeads = {} } = await chrome.storage.local.get("zbLeads");
  const rep = Object.values(zbLeads).filter(reclamable); // ya los teníamos con fuente zBuyer (o los mandaste tú con "Reclamar")
  $("nPen").textContent = rep.filter((l) => !l.borrador && !l.realizado).length;
  $("nHec").textContent = rep.filter((l) => l.borrador === "hecho" && !l.realizado).length;
  $("nErr").textContent = rep.filter((l) => l.borrador === "error" && !l.realizado).length;
  $("nReal").textContent = rep.filter((l) => l.realizado).length;
  $("todosReal").disabled = !rep.some((l) => l.borrador === "hecho" && !l.realizado);
  const verRep = $("ocultarReal").checked ? rep.filter((l) => !l.realizado) : rep;
  const ul = $("list"); ul.innerHTML = "";
  if (!rep.length) { ul.innerHTML = '<li class="empty">Cuando Zeta encuentre un lead que ya teníamos con fuente zBuyer, aquí aparece.</li>'; vista(); return; }
  if (!verRep.length) { ul.innerHTML = '<li class="empty">Todos ya están marcados como realizados. Quita “Ocultar los ya realizados” para verlos.</li>'; vista(); return; }
  for (const l of verRep.sort((a, b) => (!!a.realizado - !!b.realizado) || b.fechaCorreo - a.fechaCorreo).slice(0, 300)) {
    const li = document.createElement("li");
    if (l.realizado) li.style.opacity = ".6";
    const est = l.realizado ? `<span class="tag" style="background:#dcfce7;color:#15803d">✔ realizado ${fechaCorta(l.realizadoT)}</span>` : l.borrador === "hecho" ? `<span class="tag" style="background:#ede9fe;color:#5b21b6">✉ borrador listo${l.nCapturas ? " · 📷 " + l.nCapturas : ""}</span>`
      : l.borrador === "error" ? `<span class="tag" style="background:#fee2e2;color:#b91c1c" title="${esc(l.borradorError)}">falló</span>` : '<span class="tag" style="background:#fef3c7;color:#92400e">pendiente</span>';
    li.innerHTML = `<div class="addr"><b>${esc(l.nombre)}</b> ${est}<small>${esc(l.direccion)} · en Lofty (${esc(l.loftyFuente || "—")}) desde ${fechaCorta(l.loftyCreado)} · zBuyer ${fechaCorta(l.fechaCorreo)}${l.aMano ? " · a mano" : ""}</small></div>`;
    const r = document.createElement("button"); r.className = "mini";
    r.textContent = l.realizado ? "↩ Desmarcar" : "✔ Realizado";
    r.title = l.realizado ? "Regresarlo a la lista de pendientes" : "Marcar este reclamo como ya realizado (ya lo enviaste o ya se resolvió)";
    r.onclick = async () => { await marcar(l.leadIdZb, l.realizado ? { realizado: false, realizadoT: null } : { realizado: true, realizadoT: Date.now() }); pintar(); };
    li.appendChild(r);
    if (l.borrador && !l.realizado) {
      const b = document.createElement("button"); b.className = "mini"; b.textContent = "Rehacer";
      b.title = "Hacer otro borrador (por ejemplo después de cambiar la plantilla)";
      b.onclick = async () => { await marcar(l.leadIdZb, { borrador: null }); if (cfg.auto) hacer(false); else pintar(); };
      li.appendChild(b);
    }
    ul.appendChild(li);
  }
  vista();
}

$("ocultarReal").onchange = () => { chrome.storage.local.set({ rdOcultarReal: $("ocultarReal").checked }); pintar(); };
$("todosReal").onclick = async () => {
  const { zbLeads = {} } = await chrome.storage.local.get("zbLeads");
  const ls = Object.values(zbLeads).filter((l) => reclamable(l) && l.borrador === "hecho" && !l.realizado);
  if (!ls.length) return;
  if (!(await preguntar(`¿Marco como realizados los ${ls.length} reclamos que ya tienen borrador listo?`, "✔ Marcar", "Cancelar"))) return;
  await zbPoner(Object.fromEntries(ls.map((l) => [l.leadIdZb, { realizado: true, realizadoT: Date.now() }])));
  decir(`Redi: marqué ${ls.length} reclamo(s) como realizados.`); pintar();
};
$("run").onclick = () => hacer(true);
$("stop").onclick = () => { parar = true; ver("Detenido."); };
$("borradores").onclick = async () => {
  const { zbConfig = {} } = await chrome.storage.local.get("zbConfig");
  chrome.tabs.create({ url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(zbConfig.cuenta || "rubioteamcaller01@gmail.com")}#drafts` });
};
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local" || !ch.zbLeads) return;
  pintar();
  if (cfg.auto && porHacer(ch.zbLeads.newValue || {}).length) setTimeout(() => hacer(false), 1500);
});

window.rdHacer = hacer; // Capi
(async () => { const { rdOcultarReal } = await chrome.storage.local.get("rdOcultarReal"); if (rdOcultarReal === false) $("ocultarReal").checked = false; await cargarCfg(); await pintar(); if (cfg.auto) setTimeout(() => hacer(false), 6000); })();
