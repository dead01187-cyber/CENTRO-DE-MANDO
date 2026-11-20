// =====================================================================
// Acti: actualiza leads que YA están en Lofty. Como Propi, pero la fuente
// es Lofty: trae leads de una etapa (sin el tag), manda sus domicilios a
// Veri → Owny, y con lo que lee Owny les actualiza owner, teléfonos y tag.
// trabajos (storage "acTrabajos"): leadId → { leadId, key, direccion, nombre,
//   estado: "buscando" | "actualizado" | "cambio" | "sin datos" | "error", detalle, t }
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const digitos = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };

let trabajos = {}, trayendo = false, parar = false, procesando = false;
const vistoBuscado = new Map(); // leadId → cuándo vi que Veri ya lo buscó (para detectar "sin datos")

const cfg = () => ({ etapa: $("etapa").value.trim(), ciudad: $("ciudad").value.trim(), tag: $("tag").value.trim() || "Actualizado",
  tanda: Math.max(1, Math.min(200, parseInt($("tanda").value, 10) || 20)) });
async function guardarCfg() { await chrome.storage.local.set({ acConfig: { ...cfg(), veriSolo: $("veriSolo").checked } }); }
async function guardarTrabajos() { await chrome.storage.local.set({ acTrabajos: trabajos }); }

// Domicilio del lead: la propiedad "Home" (o la primera con calle) y si no, la dirección de contacto
function direccionDe(l) {
  const ok = (p) => p && p.streetAddress && /^\d/.test(String(p.streetAddress).trim()) && p.city && (!p.state || /^(ca|california)$/i.test(p.state));
  const props = l.leadPropertyList || [];
  const p = props.find((x) => /home/i.test(x.label || "") && ok(x)) || props.find(ok) || (ok(l) ? l : null);
  if (!p) return null;
  return { street: String(p.streetAddress).trim(), city: String(p.city).trim(), zip: /^\d{5}/.test(p.zipCode || "") ? String(p.zipCode).slice(0, 5) : "", state: "CA" };
}
const tieneTag = (l, tag) => (l.tags || []).some((t) => norm(t.tagName || t) === norm(tag));

// ---------- 1) Traer leads de Lofty y mandarlos a Veri ----------
async function traer() {
  if (trayendo) return;
  const c = cfg();
  if (!c.etapa) { ver("Escribe la etapa del pipeline (ej. Cold 12 Month +)."); $("etapa").focus(); return; }
  await guardarCfg();
  trayendo = true; parar = false; $("traer").disabled = true;
  window.robot && robot.set("trabajando", `Trayendo leads de “${c.etapa}”…`);
  try {
    const nuevos = []; let offset = 0, revisados = 0, sinDir = 0;
    while (!parar && nuevos.length < c.tanda && offset < 5000) {
      ver(`Buscando en Lofty leads de “${c.etapa}” sin el tag “${c.tag}”… (${revisados} revisados)`);
      const d = await loftyApi(`/leads?limit=100&offset=${offset}&stage=${encodeURIComponent(c.etapa)}`);
      const leads = d.leads || d.data || [];
      if (!leads.length) break;
      for (const l of leads) {
        revisados++;
        if (norm(l.stage) !== norm(c.etapa) || tieneTag(l, c.tag)) continue;
        const id = String(l.leadId);
        if (trabajos[id] && trabajos[id].estado !== "error") continue; // ya se trabajó o se está trabajando
        const dir = direccionDe(l);
        if (!dir) { sinDir++; continue; }
        if (c.ciudad && norm(dir.city) !== norm(c.ciudad)) continue;
        nuevos.push({ l, dir });
        if (nuevos.length >= c.tanda) break;
      }
      offset += leads.length;
      if (leads.length < 100) break;
    }
    if (parar) { decir("Parado."); return; }
    if (!nuevos.length) { decir(`No encontré leads de “${c.etapa}” por actualizar` + (sinDir ? ` (${sinDir} sin domicilio en Lofty)` : "") + "."); return; }
    const items = nuevos.map(({ l, dir }) => ({ ...dir, leadId: String(l.leadId) }));
    await domicilios("actualizar", { items });
    for (const { l, dir } of nuevos) {
      trabajos[String(l.leadId)] = { leadId: String(l.leadId), key: keyOf(dir), direccion: lineaDir(dir),
        nombre: `${l.firstName || ""} ${l.lastName || ""}`.trim(), estado: "buscando", t: Date.now() };
    }
    await guardarTrabajos(); pintar();
    decir(`Traje ${nuevos.length} lead(s) de “${c.etapa}” para actualizar. Se los pasé a Veri.` + (sinDir ? ` (${sinDir} no tienen domicilio en Lofty)` : ""));
    if ($("veriSolo").checked) arrancarVeri();
  } catch (e) {
    decir(e.sinKey ? "Falta la API key de Lofty (pégala en la pestaña Lofty)." : `No pude traer leads de Lofty: ${e.message}`, "error");
  } finally {
    trayendo = false; $("traer").disabled = false;
  }
}
// Darle ▶ a Veri (la pestaña vive junto a esta, en el panel o en el Centro de Mando)
function arrancarVeri(espera = 1500) {
  try {
    const d = parent.document.getElementById("f-bv2").contentDocument;
    const b = d.getElementById("cycle");
    setTimeout(() => { if (b && !b.disabled) b.click(); }, espera);
  } catch (e) {}
}
// Veri se detiene al llegar a su máximo de pestañas por ciclo: si quedan leads de Acti sin buscar, se le da ▶ otra vez
const veriLibre = () => { try { const b = parent.document.getElementById("f-bv2").contentDocument.getElementById("cycle"); return b && !b.disabled; } catch (e) { return false; } };

// ---------- 2) Cuando Owny lee el reporte, actualizar el lead ----------
function nombreDe(n) {
  n = String(n || "").trim();
  if (n.includes(",")) { const [ap, resto] = n.split(",").map((s) => s.trim()); return { first: (resto || "").split(" ")[0] || "", last: ap }; }
  const p = n.split(/\s+/).filter(Boolean);
  return p.length === 1 ? { first: p[0], last: "" } : { first: p[0] || "", last: p[p.length - 1] || "" };
}
function mismoDueno(lead, nuevo) {
  const a = [norm(lead.firstName), norm(lead.lastName)].filter(Boolean), b = [norm(nuevo.first), norm(nuevo.last)].filter(Boolean);
  if (!a.length || !b.length) return true; // si el lead no tenía nombre, no lo cuento como cambio
  return (norm(lead.lastName) && norm(lead.lastName) === norm(nuevo.last)) || a.some((x) => b.includes(x) && x.length > 2);
}
async function actualizarLead(f) {
  const t = trabajos[f.leadId];
  const d = await loftyApi(`/leads/${f.leadId}`);
  const lead = d.lead || d;
  const nuevo = nombreDe(f.owner);
  const telNuevos = (f.phones || []).map((p) => digitos(p.num)).filter((x) => x.length === 10);
  const telViejos = (lead.phones || []).map(digitos).filter((x) => x.length === 10);
  const mismo = mismoDueno(lead, nuevo);
  // Fase 1: los teléfonos que ya tenía el lead NUNCA se borran ni se cambian de lugar (así sus estados DNC/Bad Number
  // siguen en el mismo orden); los nuevos se agregan al final. Antes, si cambiaba el dueño, se reemplazaban todos.
  const phones = [...new Set([...telViejos, ...telNuevos])].slice(0, Math.max(10, telViejos.length));
  const tags = [...new Set([...(lead.tags || []).map((x) => x.tagName || x), cfg().tag])];
  const cuerpo = { phones, tags };
  if (nuevo.first) { cuerpo.firstName = nuevo.first.slice(0, 30); if (nuevo.last) cuerpo.lastName = nuevo.last.slice(0, 30); } // sin apellido nuevo, se queda el que había
  // Respaldo de lo que tenía el lead antes del cambio (se guarda con el trabajo, por si hay que regresarlo a mano)
  t.antes = { firstName: lead.firstName || "", lastName: lead.lastName || "", phones: lead.phones || [], t: Date.now() };
  await loftyApi(`/leads/${f.leadId}`, { method: "PUT", body: cuerpo });
  const agregados = telNuevos.filter((x) => !telViejos.includes(x)).length;
  t.estado = mismo ? "actualizado" : "cambio";
  t.detalle = mismo
    ? `${nuevo.first} ${nuevo.last}`.trim() + ` · +${agregados} teléfono(s)`
    : `Antes: ${t.nombre || "(sin nombre)"} → ahora: ${`${nuevo.first} ${nuevo.last}`.trim()} · +${agregados} teléfono(s) (los de antes se conservan)`;
  t.t = Date.now();
  decir(`✔ Actualicé ${t.direccion}: ${t.detalle}. Tag “${cfg().tag}”.`);
}
async function procesar() {
  if (procesando) return;
  procesando = true;
  try {
    // Acti tiene su propia línea: Veri 2 y Owny 2 (bvPendientes_ac y lote_ac)
    const { lote_ac: lote = [], addresses = {}, bvPendientes_ac: bvPendientes = [] } = await chrome.storage.local.get(["lote_ac", "addresses", "bvPendientes_ac"]);
    // a) los que Owny ya leyó
    for (const f of lote) {
      const t = f.leadId && trabajos[f.leadId];
      if (!t || t.estado !== "buscando") continue;
      window.robot && robot.set("trabajando", `Actualizando ${t.direccion}…`);
      try { await actualizarLead(f); }
      catch (e) { t.estado = "error"; t.detalle = e.message; decir(`No pude actualizar ${t.direccion} en Lofty: ${e.message}`, "error"); }
      await guardarTrabajos(); pintar();
    }
    // b) ¿quedan leads de Acti sin buscar y Veri está parado? Que siga.
    if ($("veriSolo").checked && veriLibre() && Object.values(trabajos).some((t) => t.estado === "buscando" && addresses[t.key] && !addresses[t.key].bvSearched)) arrancarVeri(500);
    // c) los que Veri ya buscó pero Owny no sacó nada (sin owner o solo compañía)
    for (const t of Object.values(trabajos)) {
      if (t.estado !== "buscando") continue;
      const a = addresses[t.key];
      const pendiente = bvPendientes.some((p) => p.key === t.key);
      if (a && a.bvSearched && !pendiente && !lote.some((f) => f.leadId === t.leadId)) {
        if (!vistoBuscado.has(t.leadId)) vistoBuscado.set(t.leadId, Date.now());
        else if (Date.now() - vistoBuscado.get(t.leadId) > 90e3) {
          t.estado = "sin datos"; t.detalle = "BeenVerified no dio owner persona ni teléfonos"; t.t = Date.now();
          decir(`↷ ${t.direccion}: BeenVerified no dio datos; lo dejo sin cambios.`);
          await guardarTrabajos(); pintar();
        }
      }
    }
  } finally { procesando = false; }
}

// ---------- Pantalla ----------
const ETQ = { buscando: ["buscando", "#e0e7ff", "#3730a3"], actualizado: ["actualizado", "#dcfce7", "#166534"], cambio: ["dueño cambió", "#ffedd5", "#9a3412"],
  "sin datos": ["sin datos", "#f1f5f9", "#475569"], error: ["error", "#fee2e2", "#991b1b"] };
function pintar() {
  const L = Object.values(trabajos).sort((a, b) => b.t - a.t);
  const n = (e) => L.filter((x) => x.estado === e).length;
  $("nBus").textContent = n("buscando"); $("nAct").textContent = n("actualizado"); $("nCam").textContent = n("cambio"); $("nSin").textContent = n("sin datos") + n("error");
  const ul = $("list"); ul.innerHTML = "";
  if (!L.length) { ul.innerHTML = '<li class="empty">Todavía no actualizo ningún lead.</li>'; return; }
  for (const t of L.slice(0, 300)) {
    const [txt, bg, fg] = ETQ[t.estado] || ETQ.buscando;
    const li = document.createElement("li");
    li.innerHTML = `<div class="addr">${esc(t.direccion)}<small>${esc(t.detalle || t.nombre || "")}</small></div><span class="tag" style="background:${bg};color:${fg}">${txt}</span>`;
    ul.appendChild(li);
  }
}

$("traer").onclick = traer;
$("parar").onclick = () => { parar = true; ver("Parando…"); };
$("limpiar").onclick = async () => { for (const k of Object.keys(trabajos)) if (trabajos[k].estado !== "buscando") delete trabajos[k]; await guardarTrabajos(); pintar(); ver("Lista limpia."); };
["etapa", "ciudad", "tag", "tanda", "veriSolo"].forEach((id) => $(id).addEventListener("change", guardarCfg));
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.acTrabajos && !procesando) { trabajos = ch.acTrabajos.newValue || {}; pintar(); }
  if (ch.lote_ac || ch.addresses || ch.bvPendientes_ac) procesar();
});
setInterval(procesar, 15e3);
(async () => {
  const { acConfig = {}, acTrabajos = {} } = await chrome.storage.local.get(["acConfig", "acTrabajos"]);
  $("etapa").value = acConfig.etapa || ""; $("ciudad").value = acConfig.ciudad || ""; $("tag").value = acConfig.tag || "Actualizado";
  if (acConfig.tanda) $("tanda").value = acConfig.tanda;
  $("veriSolo").checked = acConfig.veriSolo !== false;
  trabajos = acTrabajos; pintar(); procesar();
})();

// ---------- Fase 2b: acciones grandes por el bus de tareas (registro.js). Sin entrada, usan lo que ya está escrito en la pantalla. ----------
// "traer" termina cambiando leads en Lofty (owner y teléfonos): el bus pide la aprobación del jefe
window.Tareas && Tareas.atender("traer", async ({ etapa, tag, ciudad, tanda } = {}) => {
  await Tareas.esperarLibre(() => trayendo);
  for (const [id, v] of [["etapa", etapa], ["tag", tag], ["ciudad", ciudad], ["tanda", tanda]]) if (v != null && v !== "") $(id).value = String(v);
  await traer();
  return $("status").textContent.trim() || "Listo.";
}, { alCancelar: () => { parar = true; } });
