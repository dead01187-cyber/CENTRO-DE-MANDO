// =====================================================================
// Termi (brazo Zonas calientes): el termómetro. Con lo que juntó Radar le
// da a cada ZIP una calificación de 0 a 100 (más alta = más probabilidad de
// vendedores) y te dice por qué. Con “→ Propi” arranca una misión en esa zona.
// Cada señal se compara contra todos los ZIP (percentil), así una zona solo
// sale caliente si destaca de verdad frente a las demás.
// =====================================================================
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const { SENALES, tasa, pct } = TermiCalc;

let pesos = {}, filas = [], faltan = [];
async function cargar() {
  const { termiPesos = {} } = await chrome.storage.local.get("termiPesos");
  pesos = Object.fromEntries(SENALES.map((s) => [s.id, termiPesos[s.id] ?? s.peso]));
  $("pesos").innerHTML = SENALES.map((s) => `<label class="f">${esc(s.nombre)}<input type="number" min="0" max="100" data-p="${s.id}" value="${pesos[s.id]}"></label>`).join("");
  $("pesos").querySelectorAll("input").forEach((i) => (i.onchange = () => { pesos[i.dataset.p] = Math.max(0, +i.value || 0); chrome.storage.local.set({ termiPesos: pesos }); calificar(); }));
  await calificar();
}

async function calificar() {
  const r = await TermiCalc.calificar(pesos);
  filas = r.filas; faltan = r.res.faltan || [];
  pintar();
}

function pintar() {
  const cond = $("condado").value, q = $("buscar").value.trim().toLowerCase(), solo = $("soloCompletos").checked;
  const ls = filas.filter((f) => (!cond || f.condado === cond) && (!q || f.zip.includes(q) || ((f.info || {}).ciudad || "").toLowerCase().includes(q)) && (!solo || f.cobertura >= 0.5));
  $("nZonas").textContent = filas.length; $("nCalientes").textContent = filas.filter((f) => f.score >= 75 && f.cobertura >= 0.5).length;
  const color = (s) => (s >= 75 ? "#dc2626" : s >= 55 ? "#ea580c" : s >= 35 ? "#ca8a04" : "#64748b");
  $("tabla").innerHTML = ls.length ? ls.slice(0, 300).map((f, i) => `<li>
      <input type="checkbox" class="sel" data-zip="${esc(f.zip)}" ${window.TermiSel && TermiSel.has(f.zip) ? "checked" : ""} title="Marcar para sacar propiedades">
      <div class="rank">${i + 1}</div>
      <div class="q"><b>${esc(f.zip)}</b> ${esc((f.info || {}).ciudad || "")} <span class="hint">· ${esc(f.condado)} County</span>
        <small>${f.razones.length ? esc(f.razones.join(" · ")) : "sin señal que destaque"}${f.cobertura < 0.5 ? ` · <i>datos parciales (${Math.round(f.cobertura * 100)}%)</i>` : ""}</small></div>
      <div class="score" style="color:${color(f.score)}">${f.score}</div>
      <button class="mini propi" data-zip="${esc(f.zip)}" title="Mandar esta zona a Propi">→ Propi</button></li>`).join("")
    : `<span class="empty">${filas.length ? "Ningún ZIP con ese filtro." : "Todavía no hay datos: dale “Escanear ahora” en Radar."}</span>`;
  if (window.sacandoProp) return;
  ver(filas.length ? `${filas.length} ZIP calificados con lo que mandó Radar.${faltan.length ? ` Todavía sin datos de: ${faltan.join(", ")}.` : ""}` : "Esperando datos de Radar: dale “Escanear ahora” en Radar.");
}

// Mandar una zona a Propi: arranca una misión con Capi
async function aPropi(zip) {
  const f = filas.find((x) => x.zip === zip); if (!f) return;
  const ok = await preguntar(`¿Mando a Propi el ZIP ${zip}${(f.info || {}).ciudad ? ` (${f.info.ciudad})` : ""}? Calificación ${f.score}/100${f.razones.length ? ` · ${f.razones.join(" · ")}` : ""}.\n\nArranco una misión de ${$("meta").value || 50} leads ahí.`, "→ Mandar a Propi", "Cancelar");
  if (!ok) return;
  const meta = parseInt($("meta").value, 10) || 50;
  let r = null;
  try { const sv = window.parent && window.parent.document.getElementById("f-sv"); if (sv && sv.contentWindow && sv.contentWindow.ejecutar) r = await sv.contentWindow.ejecutar("iniciar_mision", { zona: zip, meta }); } catch (e) {}
  if (!r) { await chrome.storage.local.set({ zone: zip }); r = `Le puse la zona ${zip} a Propi (abre Propi y dale Buscar).`; }
  decir(`Termi → Propi: ${zip}. ${r}`);
}

$("tabla").addEventListener("click", (e) => { const b = e.target.closest("button.propi"); if (b) aPropi(b.dataset.zip); });
["condado", "soloCompletos"].forEach((id) => ($(id).onchange = pintar));
$("buscar").oninput = pintar;
$("run").onclick = calificar;
let t = null;
// Radar ya califica solo y deja termiRes; aquí solo repinto cuando cambia
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && (ch.radarData || ch.radarZips || (ch.termiPesos && false))) { clearTimeout(t); t = setTimeout(calificar, 1500); } });
cargar();
