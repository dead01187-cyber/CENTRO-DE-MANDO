// =====================================================================
// Texi y Compri (v1.81.0): mandan SMS a los leads que escojas (por etapa del pipeline y/o tag)
// desde OTRA cuenta de Lofty (su propia API key, "txKey", la MISMA para los dos).
// · Texi (tx.html): solo leads Seller (Lofty leadTypes 1).
// · Compri (cb.html): solo leads Buyer (Lofty leadTypes 2).
//   Tipos según developer.lofty.com: Other -1, Seller 1, Buyer 2, Renter 5, Investor 6, Agent 7, Homeowner 8, Landlord 9.
// · Comparten: la llave, las bajas (cuenta "tx"), las respuestas de Resi, el ritmo del número
//   (un SMS cada 6–12 s entre los dos) y no le mandan dos veces el mismo día al mismo número.
// · Cada uno tiene sus plantillas, su lista, su registro de enviados y su contador del día.
// · Primero arma la lista y te enseña a quién y qué le va a mandar.
// · Nada sale sin tu OK (un solo OK para todos los marcados).
// · Solo manda a números de California.
// · Usa la API de Lofty: POST /v1.0/message/sms/send { leadId, content, phoneNumber, phoneCode }.
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const hoy = () => new Date().toLocaleDateString("en-CA");
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const creadoLofty = (s) => Date.parse(String(s || "").replace(/GMT$/, "Z")) || 0;
const dia = (ms) => ms ? new Date(ms).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "";
const fecha = (ms) => new Date(ms).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// Claves de área de California
const LADAS_CA = new Set("209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951".split(" "));
const digitos = (t) => { let d = String(t || "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d; };
const esCA = (t) => { const d = digitos(t); return d.length === 10 && LADAS_CA.has(d.slice(0, 3)); };
const bonito = (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;

const PLANTILLA_EJEMPLO = { id: "p1", nombre: "Saludo", texto: "Hi {nombre}, this is Christopher with Rubio Real Estate. Are you still the owner of {direccion}? I have a buyer interested in the area." };
// ¿Texi o Compri? Lo dice la página (data-mod="tx" o "cb")
const AGENTES = {
  tx: { nombre: "Texi", tipo: "Seller", codigo: 1, re: /seller/i, ejemplo: PLANTILLA_EJEMPLO },
  cb: { nombre: "Compri", tipo: "Buyer", codigo: 2, re: /buyer/i,
    ejemplo: { id: "p1", nombre: "Compradores", texto: "Hi {nombre}, this is Christopher with Rubio Real Estate. Are you still looking for a home in {ciudad}? I can send you new listings that match what you want." } },
};
const YO = document.documentElement.dataset.mod === "cb" ? "cb" : "tx", A = AGENTES[YO];
const K = (s) => YO + s; // llaves propias de cada agente: tx… / cb… (Config, Plantillas, Lista, Enviados, Hoy)
let plantillas = [], selId = "", lista = [], corriendo = false, parar = false;

// ---------- API de Lofty de la OTRA cuenta ----------
async function api(path, opts = {}) {
  const { txKey } = await chrome.storage.local.get("txKey");
  if (!txKey) throw Object.assign(new Error(`Falta la API key de la cuenta de Lofty de ${A.nombre} (arriba, en “Cuenta de Lofty para los SMS”).`), { sinKey: true });
  let r;
  for (let intento = 0; ; intento++) { // 429 = Lofty pide ir más lento (no procesó nada): esperar y reintentar
    r = await fetch("https://api.lofty.com/v1.0" + path, {
      method: opts.method || "GET",
      headers: { Authorization: "token " + txKey, "X-Error-Status": "true", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    });
    if (r.status !== 429 || intento >= 4) break;
    const ra = parseInt(r.headers.get("Retry-After") || "", 10);
    ver(`Lofty pidió ir más lento; espero ${ra > 0 ? ra : 2 * 2 ** intento} s…`);
    await sleep(ra > 0 ? ra * 1000 : 2000 * 2 ** intento);
  }
  const cuerpo = await r.text();
  let d = {}; try { d = cuerpo ? JSON.parse(cuerpo) : {}; } catch (e) { d = { message: cuerpo }; }
  if (!r.ok) throw Object.assign(new Error(`Lofty respondió ${r.status}` + (d.message ? `: ${String(d.message).slice(0, 140)}` : "")), { status: r.status });
  return d;
}

// ---------- Configuración ----------
async function cargar() {
  const st = await chrome.storage.local.get([K("Config"), K("Plantillas"), "txKey"]), txConfig = st[K("Config")] || {}, txPlantillas = st[K("Plantillas")], txKey = st.txKey;
  plantillas = Array.isArray(txPlantillas) && txPlantillas.length ? txPlantillas : [A.ejemplo];
  selId = plantillas.some((p) => p.id === txConfig.plantilla) ? txConfig.plantilla : plantillas[0].id;
  $("etapa").value = txConfig.etapa || ""; $("tag").value = txConfig.tag || ""; $("orden").value = txConfig.orden === "nuevos" ? "nuevos" : "viejos";
  $("cuentaTxt").textContent = txKey ? "· conectada" : "· falta la API key";
  if (!txKey) $("cuenta").open = true;
  pintarPlantillas();
}
const plantilla = () => plantillas.find((p) => p.id === selId) || plantillas[0];
function guardarCfg() { chrome.storage.local.set({ [K("Config")]: { etapa: $("etapa").value.trim(), tag: $("tag").value.trim(), plantilla: selId, orden: $("orden").value } }); }
function guardarPlantillas() { chrome.storage.local.set({ [K("Plantillas")]: plantillas }); }
function pintarPlantillas() {
  $("plantilla").innerHTML = plantillas.map((p) => `<option value="${esc(p.id)}"${p.id === selId ? " selected" : ""}>${esc(p.nombre || "(sin nombre)")}</option>`).join("");
  const p = plantilla(); $("plNombre").value = p.nombre; $("plTexto").value = p.texto; largo();
}
function largo() { const n = $("plTexto").value.length; $("largo").textContent = `${n} caracteres` + (n > 160 ? " (más de 160: puede llegar en 2 partes)" : ""); $("largo").className = n > 320 ? "mal" : ""; }
$("plantilla").onchange = () => { selId = $("plantilla").value; guardarCfg(); pintarPlantillas(); pintarLista(); };
$("plNombre").oninput = () => { plantilla().nombre = $("plNombre").value; guardarPlantillas(); $("plantilla").selectedOptions[0].textContent = $("plNombre").value || "(sin nombre)"; };
$("plTexto").oninput = () => { plantilla().texto = $("plTexto").value; guardarPlantillas(); largo(); pintarLista(); };
$("nueva").onclick = () => { const p = { id: "p" + Date.now(), nombre: `Plantilla ${plantillas.length + 1}`, texto: "" }; plantillas.push(p); selId = p.id; guardarPlantillas(); guardarCfg(); pintarPlantillas(); $("plTexto").focus(); };
$("borrarPl").onclick = () => {
  if (plantillas.length < 2) { ver("Debe quedar al menos una plantilla."); return; }
  plantillas = plantillas.filter((p) => p.id !== selId); selId = plantillas[0].id; guardarPlantillas(); guardarCfg(); pintarPlantillas(); pintarLista();
};
["etapa", "tag"].forEach((id) => ($(id).onchange = () => guardarCfg()));
// Orden: por fecha en que se creó el lead en Lofty (los que no traen fecha van al final)
function ordenar() {
  const nuevos = $("orden").value === "nuevos";
  lista.sort((a, b) => (!a.creado) - (!b.creado) || (nuevos ? b.creado - a.creado : a.creado - b.creado));
}
$("orden").onchange = () => { guardarCfg(); ordenar(); chrome.storage.local.set({ [K("Lista")]: lista }); pintarLista(); };
$("guardarKey").onclick = async () => {
  const k = $("key").value.trim();
  if (!k) { ver("Pega primero la API key."); return; }
  await chrome.storage.local.set({ txKey: k }); $("key").value = "";
  ver("Probando la API key…");
  try { await api("/leads?limit=1"); $("cuentaTxt").textContent = "· conectada"; decir(`Listo: la cuenta de Lofty de ${A.nombre} responde bien (es la misma de Texi y Compri).`); $("cuenta").open = false; }
  catch (e) { $("cuentaTxt").textContent = "· la API key no funcionó"; decir(`La API key no funcionó: ${e.message}`, "error"); }
};
$("quitarKey").onclick = async () => { await chrome.storage.local.remove("txKey"); $("cuentaTxt").textContent = "· falta la API key"; ver("Quité la API key (Texi y Compri usan la misma)."); };

// ---------- Mensaje para cada lead ----------
function calleDe(l) {
  const props = l.leadPropertyList || [];
  const p = props.find((x) => /home/i.test(x.label || "") && x.streetAddress) || props.find((x) => x.streetAddress) || (l.streetAddress ? l : null);
  return p ? { calle: String(p.streetAddress || "").trim(), ciudad: String(p.city || "").trim() } : { calle: "", ciudad: "" };
}
const tc = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
function mensaje(x) {
  return (plantilla().texto || "").replace(/\{nombre\}/gi, x.nombre).replace(/\{apellido\}/gi, x.apellido)
    .replace(/\{direccion\}/gi, x.calle || "your property").replace(/\{ciudad\}/gi, x.ciudad || "your area").trim();
}
const destinos = (x) => x.ca; // a TODOS sus números de California

// Solo leads del tipo de este agente (Texi: Seller = 1; Compri: Buyer = 2); a veces viene como texto
function esDelTipo(l) {
  const tipos = [].concat(l.leadTypes || [], l.leadType != null ? l.leadType : [], l.type != null ? l.type : []);
  return tipos.some((t) => {
    const v = t && typeof t === "object" ? t.id ?? t.typeId ?? t.name ?? t.typeName : t;
    return Number(v) === A.codigo || A.re.test(String(v));
  });
}

// ---------- 1) Buscar leads (etapa y/o tag) ----------
// ---------- Opt-out: Lofty dice que el lead (o ese número) no recibe textos ----------
const OPTOUT = /unsubscrib|do not (text|call)|opt.?out|dnc/i;
const consentDe = (s) => String(s && typeof s === "object" ? s.state || s.name || s.value || "" : s || "");
// Números (10 dígitos) que Lofty tiene marcados como opt-out (phoneConsentStates va en el mismo orden que phones)
function numerosOptOut(l) {
  const fuera = new Set(), phones = [].concat(l.phones || []), est = [].concat(l.phoneConsentStates || []);
  const st = estadosTel(l);
  phones.forEach((p, i) => { if (OPTOUT.test(consentDe(est[i])) || st[i] === 4 || st[i] === 5) fuera.add(digitos(p && typeof p === "object" ? p.phone || p.number || p.value : p)); });
  return fuera;
}
const leadOptOut = (l) => l.cannotText === true || l.unsubscription === true; // Fase 1: también "unsubscription" (como Limpi)
// phoneStatuses (mismo orden que phones): 1 = Bad Number, 2 = Valid Number, 3 = Talked, 4 = DNC Number, 5 = DNC Contact
const estadosTel = (l) => [].concat(l.phoneStatuses || []).map(Number);
const telDe = (p) => digitos(p && typeof p === "object" ? p.phone || p.number || p.value : p);
// Si un número al que vamos a mandar está como "Bad Number", lo cambia a "Valid Number" en Lofty (y lo verifica)
async function validarNumeros(x, lf) {
  const phones = [].concat(lf.phones || []), est = estadosTel(lf);
  const malos = phones.map((p, i) => i).filter((i) => est[i] === 1 && x.ca.includes(telDe(phones[i])));
  if (!malos.length) return "";
  const nuevo = phones.map((p, i) => (malos.includes(i) ? 2 : est[i] || 2));
  try {
    await api(`/leads/${encodeURIComponent(x.id)}`, { method: "PUT", body: { phones, phoneStatuses: nuevo } });
    const dl = await api(`/leads/${encodeURIComponent(x.id)}`); const ver2 = estadosTel(dl.lead || dl.data || dl);
    const ok = malos.every((i) => ver2[i] === 2);
    return ok ? `cambié ${malos.length} “Bad Number” a “Valid Number”` : "no pude cambiar el “Bad Number” en Lofty";
  } catch (e) { return "no pude cambiar el “Bad Number”: " + e.message; }
}
const errorEsOptOut = (m) => /unsubscri|opt.?out|consent|do not (text|call)|cannot text|can'?t text|not allowed to (text|send)|permission to (text|contact)|blocked/i.test(String(m || ""));

async function buscar() {
  if (corriendo) return;
  const etapa = $("etapa").value.trim(), tag = $("tag").value.trim();
  if (!etapa && !tag) { ver("Escribe una etapa del pipeline o un tag."); $("etapa").focus(); return; }
  guardarCfg();
  corriendo = true; parar = false; $("buscar").disabled = true; $("mandar").disabled = true; $("confirma").hidden = true;
  window.robot && robot.set("trabajando", "Buscando leads en Lofty…");
  const st0 = await chrome.storage.local.get([K("Enviados"), "rsNoEscribir", "rsRespondieron", "rsNoEntregados", "smsBajas"]);
  const { rsNoEscribir = {}, rsRespondieron = {}, rsNoEntregados = {}, smsBajas = {} } = st0, txEnviados = st0[K("Enviados")] || {};
  const bajaTel = (smsBajas.tels || {}), bajaLead = (smsBajas.leads || {});
  const encontrados = []; let revisados = 0, sinCA = 0, noSeller = 0, bajas = 0, noEntrega = 0, optOut = 0;
  try {
    for (let offset = 0; offset < 20000 && !parar; ) {
      ver(`Buscando en Lofty${etapa ? ` la etapa “${etapa}”` : ""}${tag ? ` con el tag “${tag}”` : ""}… (${revisados} revisados, ${encontrados.length} encontrados)`);
      const d = await api(`/leads?limit=100&offset=${offset}` + (etapa ? `&stage=${encodeURIComponent(etapa)}` : ""));
      const leads = d.leads || d.data || [];
      if (!leads.length) break;
      for (const l of leads) {
        revisados++;
        if (etapa && norm(l.stage) !== norm(etapa)) continue;
        if (tag && !(l.tags || []).some((t) => norm(t.tagName || t.name || t) === norm(tag))) continue;
        if (!esDelTipo(l)) { noSeller++; continue; } // solo los de su tipo (Seller o Buyer)
        if (rsNoEscribir[String(l.leadId || l.id)] || bajaLead[`tx:${l.leadId || l.id}`]) { bajas++; continue; } // Resi / baja permanente: pidió que no le escribieran, número equivocado o enojado
        if (leadOptOut(l)) { optOut++; continue; } // Lofty: no se le pueden mandar textos (opt-out)
        const fueraOpt = numerosOptOut(l);
        const tels = [...new Set([...(l.phones || []), l.phone, l.mobilePhone, l.homePhone, l.workPhone].filter(Boolean).map((p) => digitos(p && typeof p === "object" ? p.phone || p.number || p.value : p)).filter((x) => x.length === 10))];
        const id = String(l.leadId || l.id);
        let ca = tels.filter(esCA);
        if (!ca.length) { sinCA++; continue; }
        if (fueraOpt.size) { ca = ca.filter((n) => !fueraOpt.has(n)); if (!ca.length) { optOut++; continue; } } // números marcados Do Not Text / Unsubscribed
        if (ca.some((n) => bajaTel[n])) { ca = ca.filter((n) => !bajaTel[n]); if (!ca.length) { bajas++; continue; } } // bajas permanentes por número
        // Resi: números que ya fallaron 2+ veces (Undelivered) no se vuelven a usar
        const ne = rsNoEntregados[id];
        if (ne) { ca = ne.todos ? [] : ca.filter((n) => !(ne.nums || []).includes(n)); if (!ca.length) { noEntrega++; continue; } }
        const { calle, ciudad } = calleDe(l);
        const env = txEnviados[id], resp = rsRespondieron[id];
        encontrados.push({ id, nombre: tc(l.firstName || "").split(" ")[0] || "there", apellido: tc(l.lastName || ""), calle: tc(calle), ciudad: tc(ciudad),
          ca, fuera: tels.filter((n) => !esCA(n)).length, tipo: YO, seller: YO === "tx", creado: creadoLofty(l.createTime || l.createdTime || l.createDate), etapa: l.stage || "", antes: env ? env.t : 0,
          marcado: !(env && Date.now() - env.t < 7 * 864e5) && !resp, respondio: resp ? resp.t : 0, estado: "", detalle: "" });
      }
      offset += leads.length;
      if (leads.length < 100) break;
    }
    lista = encontrados; ordenar();
    await chrome.storage.local.set({ [K("Lista")]: lista.map((x) => ({ ...x })) });
    pintarLista();
    const salte = [noSeller ? `${noSeller} que no son ${A.tipo}` : "", sinCA ? `${sinCA} sin número de CA` : "", bajas ? `${bajas} que pidieron no recibir SMS (Resi)` : "", optOut ? `${optOut} opt-out en Lofty (no reciben textos)` : "", noEntrega ? `${noEntrega} cuyos números no reciben SMS (Resi)` : ""].filter(Boolean).join(", ");
    if (!lista.length) decir(`No encontré leads ${A.tipo}${etapa ? ` en “${etapa}”` : ""}${tag ? ` con el tag “${tag}”` : ""} con teléfono de California` + (salte ? ` (salté ${salte})` : "") + ".");
    else decir(`Encontré ${lista.length} lead(s) ${A.tipo} con teléfono de California` + (salte ? ` (salté ${salte})` : "") + `. Revisa la lista y el mensaje; cuando estés listo dale “Revisar y mandar”.`);
    window.robot && robot.set(lista.length ? "feliz" : "idle", lista.length ? `${lista.length} leads listos para revisar` : "Sin leads");
  } catch (e) {
    decir(e.sinKey ? e.message : `No pude traer los leads: ${e.message}`, "error");
    window.robot && robot.set("error", "No pude traer los leads");
  } finally { corriendo = false; $("buscar").disabled = false; contar(); }
}

// ---------- Lista: separada en "Faltan", "Ya mandados" y "Opt-out / error" ----------
let vista = "faltan";
const grupo = (x) => (x.estado === "enviado" || (x.antes && x.estado !== "mandando") ? "mandados" : x.estado === "error" || x.estado === "saltado" ? "problema" : "faltan");
function pintarVistas() {
  const n = { faltan: 0, mandados: 0, problema: 0 }; for (const x of lista) n[grupo(x)]++;
  $("vFaltan").textContent = `Faltan (${n.faltan.toLocaleString()})`; $("vMandados").textContent = `Ya mandados (${n.mandados.toLocaleString()})`; $("vProblema").textContent = `Opt-out / error (${n.problema.toLocaleString()})`;
  for (const [id, v] of [["vFaltan", "faltan"], ["vMandados", "mandados"], ["vProblema", "problema"]]) $(id).classList.toggle("on", vista === v);
  $("marcarTodos").hidden = $("desmarcar").hidden = vista !== "faltan";
}
function pintarLista() {
  pintarVistas();
  if (!lista.length) { $("lista").innerHTML = `<li class="empty">Escribe una etapa o un tag y dale “Buscar leads”. Te enseño a quién le voy a mandar y qué dice el mensaje antes de mandar nada.</li>`; contar(); return; }
  const idx = lista.map((x, i) => i).filter((i) => grupo(lista[i]) === vista);
  const MAX = 500; // con miles de leads se enseñan los primeros 500 (el envío sí toma todos los marcados)
  if (!idx.length) { $("lista").innerHTML = `<li class="empty">${vista === "faltan" ? "Ya no falta nadie: a todos los de la lista ya se les mandó." : vista === "mandados" ? "Todavía no se le ha mandado a ninguno de esta lista." : "Ninguno con opt-out o error."}</li>`; contar(); return; }
  $("lista").innerHTML = idx.slice(0, MAX).map((i) => { const x = lista[i];
    const est = x.estado === "enviado" ? `<span class="tag ok">enviado</span>` : x.estado === "error" ? `<span class="tag bad" title="${esc(x.detalle)}">error</span>` : x.estado === "mandando" ? `<span class="tag wait">mandando…</span>` : x.estado === "saltado" ? `<span class="tag wait" title="${esc(x.detalle)}">opt-out</span>` : "";
    return `<li><input type="checkbox" data-i="${i}" ${x.marcado && grupo(x) === "faltan" ? "checked" : ""} ${grupo(x) !== "faltan" || x.estado ? "disabled" : ""}>
      <div class="addr"><b>${esc(`${x.nombre === "there" ? "" : x.nombre} ${x.apellido}`.trim() || "(sin nombre)")}</b> ${est}
      <small>${x.creado ? `En Lofty desde ${dia(x.creado)} · ` : ""}${destinos(x).map(bonito).join(" · ")}${x.fuera ? ` · ${x.fuera} de fuera de CA (no se manda)` : ""}${x.calle ? ` · ${esc(x.calle)}` : ""}</small>
      ${x.antes ? `<small>Ya le mandé un SMS el ${fecha(x.antes)}</small>` : ""}
      ${x.respondio ? `<small>Ya contestó un SMS el ${fecha(x.respondio)}: síguelo en Resi (no lo marqué)</small>` : ""}
      ${x.estado === "error" ? `<small style="color:#b91c1c">${esc(x.detalle)}</small>` : x.estado === "saltado" ? `<small style="color:#854d0e">${esc(x.detalle)}</small>` : x.estado === "enviado" && x.detalle ? `<small style="color:#166534">${esc(x.detalle)}</small>` : ""}
      <div class="sms">${esc(mensaje(x))}</div></div></li>`;
  }).join("") + (idx.length > MAX ? `<li class="empty">…y ${(idx.length - MAX).toLocaleString()} más (enseño los primeros ${MAX}).</li>` : "");
  $("lista").querySelectorAll("input[type=checkbox]").forEach((c) => (c.onchange = () => { lista[+c.dataset.i].marcado = c.checked; chrome.storage.local.set({ [K("Lista")]: lista }); contar(); }));
  contar();
}
const porMandar = () => lista.filter((x) => x.marcado && !x.estado && grupo(x) === "faltan"); // a los que ya se les mandó no se les vuelve a mandar
async function contar() {
  const txHoy = (await chrome.storage.local.get(K("Hoy")))[K("Hoy")] || {};
  $("nLista").textContent = lista.filter((x) => grupo(x) === "faltan").length.toLocaleString(); $("nMarcados").textContent = porMandar().length.toLocaleString();
  $("nHoy").textContent = txHoy.dia === hoy() ? txHoy.n || 0 : 0;
  $("mandar").disabled = corriendo || !porMandar().length;
}
$("marcarTodos").onclick = () => { lista.forEach((x) => { if (!x.estado && grupo(x) === "faltan") x.marcado = true; }); chrome.storage.local.set({ [K("Lista")]: lista }); pintarLista(); };
["vFaltan", "vMandados", "vProblema"].forEach((id) => ($(id).onclick = () => { vista = { vFaltan: "faltan", vMandados: "mandados", vProblema: "problema" }[id]; pintarLista(); }));
$("desmarcar").onclick = () => { lista.forEach((x) => { if (!x.estado && grupo(x) === "faltan") x.marcado = false; }); chrome.storage.local.set({ [K("Lista")]: lista }); pintarLista(); };

// ---------- 2) Revisar y dar el OK ----------
$("mandar").onclick = () => {
  const m = porMandar(); if (!m.length) return;
  const n = m.reduce((s, x) => s + destinos(x).length, 0);
  if (!plantilla().texto.trim()) { ver("La plantilla está vacía."); return; }
  $("confTxt").innerHTML = `Vas a mandar <b>${n} SMS</b> a <b>${m.length} lead(s)</b> con la plantilla <b>${esc(plantilla().nombre)}</b>, desde la cuenta de Lofty de Texi y Compri, en orden de <b>${$("orden").value === "nuevos" ? "más nuevos a más viejos" : "más viejos a más nuevos"}</b>.<br>
    Ejemplo: <i>${esc(mensaje(m[0]))}</i><br><span class="hint">Un SMS mandado ya no se puede borrar. Mando uno cada 6–12 segundos (turnándome con ${YO === "cb" ? "Texi" : "Compri"} si los dos están mandando); puedes parar cuando quieras.</span>`;
  $("confirma").hidden = false; $("confirma").scrollIntoView({ block: "nearest" });
};
$("no").onclick = () => { $("confirma").hidden = true; ver("Cancelado: no mandé nada."); };
$("si").onclick = () => { $("confirma").hidden = true; mandar(); };

// ---------- Turno del número (compartido entre Texi y Compri) ----------
// Los dos mandan desde el mismo número virtual de Lofty. Con un candado entre pestañas, nunca sale más de
// un SMS cada 6–12 s entre los dos, y ninguno le manda a un número que ya recibió un SMS de Texi o Compri hoy
// (día de California). Regresa "ok", "yaHoy" o "parado".
const diaCA = (ms = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(ms);
async function turnoNumero(num, parado) {
  const correr = async () => {
    const { smsUltimoTx = 0, smsRegistro = [] } = await chrome.storage.local.get(["smsUltimoTx", "smsRegistro"]);
    const hoyCA = diaCA();
    if (smsRegistro.some((e) => e && e.estado === "enviado" && e.tel === num && (e.fuente === "Texi" || e.fuente === "Compri") && diaCA(e.t) === hoyCA)) return "yaHoy";
    const espera = smsUltimoTx + 6000 + Math.random() * 6000 - Date.now();
    for (let t = 0; t < espera; t += 500) { if (parado()) return "parado"; await sleep(Math.min(500, espera - t)); }
    await chrome.storage.local.set({ smsUltimoTx: Date.now() });
    return "ok";
  };
  return typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request("sms-numero-tx", correr) : correr();
}

// ---------- 3) Mandar ----------
async function mandar() {
  if (corriendo) return;
  const m = porMandar(); if (!m.length) return;
  corriendo = true; parar = false; $("buscar").disabled = true; $("mandar").disabled = true;
  let ok = 0, mal = 0, sms = 0, primerError = "", saltados = 0, validados = 0;
  try {
    for (const x of m) {
      if (parar) break;
      let notaTel = "";
      // Justo antes de mandar: revisar en Lofty que no se haya dado de baja (STOP) desde que se armó la lista
      try {
        const { rsNoEscribir: noEsc = {} } = await chrome.storage.local.get("rsNoEscribir");
        const dl = await api(`/leads/${encodeURIComponent(x.id)}`); const lf = dl.lead || dl.data || dl;
        const fueraOpt = numerosOptOut(lf);
        if (noEsc[x.id] || leadOptOut(lf)) {
          await SMS.marcarBaja({ leadId: x.id, cuenta: "tx", tels: x.ca, motivo: "opt-out en Lofty", fuente: A.nombre });
          x.estado = "saltado"; x.detalle = "opt-out: Lofty dice que ya no recibe textos"; saltados++; pintarLista(); continue;
        }
        if (fueraOpt.size) await SMS.marcarBaja({ tels: [...fueraOpt], motivo: "Do Not Text / DNC en Lofty", fuente: A.nombre });
        if (fueraOpt.size) { x.ca = x.ca.filter((n) => !fueraOpt.has(n)); if (!x.ca.length) { x.estado = "saltado"; x.detalle = "opt-out: sus números están marcados Do Not Text / DNC"; saltados++; pintarLista(); continue; } }
        notaTel = await validarNumeros(x, lf); if (notaTel) { if (/^cambié/.test(notaTel)) validados++; ver(`${x.nombre} ${x.apellido}: ${notaTel}`); }
      } catch (e) {
        // Fase 1 · falla cerrada: si no se pudo confirmar en Lofty que no se dio de baja, NO se manda
        x.estado = "error"; x.detalle = "no pude revisar en Lofty si se dio de baja; no le mandé nada (" + e.message + ")"; mal++;
        if (!primerError) primerError = `${x.nombre} ${x.apellido} → no pude revisar opt-out: ${e.message}`;
        if (e.status === 401 || e.status === 403) parar = true;
        await chrome.storage.local.set({ [K("Lista")]: lista }); pintarLista();
        if (mal >= 3 && !ok) { decir(`No pude revisar el opt-out de los primeros 3 leads; me detengo. Lofty dijo: ${primerError}`, "error"); break; }
        continue;
      }
      x.estado = "mandando"; pintarLista();
      window.robot && robot.set("trabajando", `Mandando SMS a ${x.nombre} ${x.apellido}…`);
      const contenido = mensaje(x);
      const errores = [], optNums = []; let enviados = 0;
      for (const num of destinos(x)) {
        if (parar) break;
        if (!esCA(num)) continue; // doble seguro
        // Fase 1: política común de SMS (bajas permanentes, horario 8–21 h de California; falla cerrada)
        const pol = await SMS.puedeMandar({ tel: num, leadId: x.id, cuenta: "tx", fuente: A.nombre });
        if (!pol.ok) {
          await SMS.anotar({ fuente: A.nombre, leadId: x.id, tel: num, estado: "bloqueado", motivo: pol.motivo });
          if (pol.baja) { optNums.push(`${bonito(num)}: ${pol.motivo}`); continue; }
          errores.push(`${bonito(num)}: ${pol.motivo}`); if (!primerError) primerError = pol.motivo;
          if (pol.horario || pol.tope || /política/.test(pol.motivo)) { parar = true; decir(`Me detengo: ${pol.motivo}.`, "error"); break; }
          continue;
        }
        // Turno del número (compartido con el otro agente) y "ya recibió hoy" de Texi o Compri
        const turno = await turnoNumero(num, () => parar);
        if (turno === "parado") { await SMS.devolverLugar(); break; }
        if (turno === "yaHoy") { await SMS.devolverLugar(); await SMS.anotar({ fuente: A.nombre, leadId: x.id, tel: num, estado: "bloqueado", motivo: "ya recibió un SMS hoy de Texi o Compri" }); errores.push(`${bonito(num)}: ya recibió un SMS hoy de Texi o Compri`); continue; }
        ver(`Mandando SMS a ${x.nombre} ${x.apellido} · ${bonito(num)}… (${ok + mal + 1} de ${m.length})`);
        try { await api("/message/sms/send", { method: "POST", body: { leadId: Number(x.id), content: contenido, phoneNumber: num, phoneCode: "1" } }); sms++; enviados++;
          await SMS.anotar({ fuente: A.nombre, leadId: x.id, tel: num, estado: "enviado", plantilla: plantilla().nombre, texto: contenido }); }
        catch (e) {
          await SMS.devolverLugar();
          await SMS.anotar({ fuente: A.nombre, leadId: x.id, tel: num, estado: "error", motivo: e.message });
          if (errorEsOptOut(e.message)) { await SMS.marcarBaja({ tel: num, motivo: "Lofty rechazó por opt-out", fuente: A.nombre }); optNums.push(`${bonito(num)}: ${e.message}`); continue; }
          errores.push(`${bonito(num)}: ${e.message}`); if (!primerError) primerError = `${x.nombre} ${x.apellido} ${bonito(num)} → ${e.message}`; if (e.status === 401 || e.status === 403) parar = true; }
      }
      if (enviados) {
        x.estado = "enviado"; x.detalle = [notaTel, ...errores].filter(Boolean).join(" · "); ok++;
        const st1 = await chrome.storage.local.get([K("Enviados"), K("Hoy")]), txEnviados = st1[K("Enviados")] || {}, txHoy = st1[K("Hoy")] || {};
        txEnviados[x.id] = { t: Date.now(), plantilla: plantilla().nombre, n: enviados };
        const ks = Object.keys(txEnviados); if (ks.length > 3000) ks.sort((a, b) => txEnviados[a].t - txEnviados[b].t).slice(0, ks.length - 3000).forEach((k) => delete txEnviados[k]);
        await chrome.storage.local.set({ [K("Enviados")]: txEnviados, [K("Hoy")]: { dia: hoy(), n: (txHoy.dia === hoy() ? txHoy.n || 0 : 0) + enviados } });
      } else if (errores.length) { x.estado = "error"; x.detalle = [notaTel, ...errores].filter(Boolean).join(" · "); mal++; }
      else if (optNums.length) { x.estado = "saltado"; x.detalle = "opt-out según Lofty · " + optNums.join(" · "); saltados++; }
      else x.estado = ""; // no se alcanzó a mandar (se paró antes)
      await chrome.storage.local.set({ [K("Lista")]: lista });
      pintarLista();
      if (mal >= 3 && !ok) { decir(`Fallaron los primeros 3 SMS; me detengo para que revises. Lofty dijo: ${primerError}`, "error"); break; }
    }
    const txt = `${parar ? "Detenido. " : "Listo: "}mandé ${sms} SMS a ${ok} lead(s)` + (validados ? `; cambié ${validados} de “Bad Number” a “Valid Number”` : "") + (saltados ? `; salté ${saltados} opt-out` : "") + (mal ? `; ${mal} con error. Primer error: ${primerError}` : "") + ".";
    decir(txt, mal && !ok ? "error" : undefined);
    window.robot && robot.set(mal && !ok ? "error" : "feliz", txt);
  } finally { corriendo = false; $("buscar").disabled = false; await chrome.storage.local.set({ [K("Lista")]: lista }); pintarLista(); }
}
$("buscar").onclick = buscar;
$("stop").onclick = () => { parar = true; ver("Parando…"); };

chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && (ch[K("Hoy")] || ch.txKey)) { contar(); if (ch.txKey) $("cuentaTxt").textContent = ch.txKey.newValue ? "· conectada" : "· falta la API key"; } });
(async () => {
  await cargar();
  const txLista = (await chrome.storage.local.get(K("Lista")))[K("Lista")] || [];
  lista = txLista.filter((x) => (x.tipo || (x.seller ? "tx" : "")) === YO).map((x) => ({ ...x, estado: x.estado === "mandando" ? "" : x.estado })); // listas viejas sin el filtro Seller se descartan
  { const txEnviados = (await chrome.storage.local.get(K("Enviados")))[K("Enviados")] || {}; for (const x of lista) if (!x.antes && txEnviados[x.id] && x.estado !== "enviado") x.antes = txEnviados[x.id].t; }
  ordenar();
  pintarLista();
})();
