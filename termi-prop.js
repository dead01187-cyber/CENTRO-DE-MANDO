// =====================================================================
// Termi → Propwire → lista de domicilios
// Marcas ZIP en Termi, escoges tipos de seller, y Termi abre la búsqueda de
// Propwire (ritmo humano), lee las direcciones de la lista (sin exportar ni
// gastar créditos) y te deja la lista de domicilios para que tú los busques.
// =====================================================================
const TIPOS = [
  { id: "preforeclosure", nombre: "Pre-foreclosure", labels: ["Preforeclosures", "Pre-Foreclosures", "Preforeclosure"], campo: "preforeclosure" },
  { id: "preprobate", nombre: "Pre-probate", labels: ["Pre-Probates", "Pre-Probate", "Preprobates"], campo: "preprobate" },
  { id: "absentee", nombre: "Absentee", labels: ["Absentee Owners", "Absentee Owner"], campo: "absentee" },
  { id: "highEquity", nombre: "High equity", labels: ["High Equity"], campo: "highEquity" },
  { id: "vacant", nombre: "Vacantes", labels: ["Vacant Homes", "Vacant", "Vacant Properties"], campo: "vacant" },
  { id: "tired", nombre: "Tired landlords", labels: ["Tired Landlords", "Tired Landlord"] },
  { id: "freeclear", nombre: "Free & clear", labels: ["Free And Clear", "Free & Clear", "Free and Clear"] },
];
window.TermiSel = new Set();
let tiposSel = new Set(TIPOS.map((t) => t.id)), sacando = false, pararProp = false;
const dorm = (ms) => new Promise((r) => setTimeout(r, ms));
const alAzar = (a, b) => a + Math.random() * (b - a);
const urlPWT = (zip, llave) => "https://propwire.com/search?filters=" + encodeURIComponent(JSON.stringify({ locations: [{ searchType: "Z", zip, state: "CA", title: `${zip}, CA` }], ...(llave ? { lead_type: [llave] } : {}) }));

async function iniciarProp() {
  const { termiSel = [], termiTipos } = await chrome.storage.local.get(["termiSel", "termiTipos"]);
  TermiSel = new Set(termiSel); if (termiTipos) tiposSel = new Set(termiTipos);
  $("tipos").innerHTML = TIPOS.map((t) => `<label class="chk"><input type="checkbox" data-t="${t.id}" ${tiposSel.has(t.id) ? "checked" : ""}> ${esc(t.nombre)}</label>`).join("");
  $("tipos").querySelectorAll("input").forEach((i) => (i.onchange = () => { i.checked ? tiposSel.add(i.dataset.t) : tiposSel.delete(i.dataset.t); chrome.storage.local.set({ termiTipos: [...tiposSel] }); }));
  pintarSel(); pintar();
}
function guardarSel() { chrome.storage.local.set({ termiSel: [...TermiSel] }); pintarSel(); }
function pintarSel() { $("nSel").textContent = TermiSel.size; $("sacar").disabled = sacando || !TermiSel.size; $("pararProp").hidden = !sacando; }
$("tabla").addEventListener("change", (e) => { const c = e.target.closest("input.sel"); if (!c) return; c.checked ? TermiSel.add(c.dataset.zip) : TermiSel.delete(c.dataset.zip); guardarSel(); });
$("marcarCal").onclick = () => { filas.filter((f) => f.score >= 75 && f.cobertura >= 0.5).forEach((f) => TermiSel.add(f.zip)); if (!TermiSel.size) filas.slice(0, 5).forEach((f) => TermiSel.add(f.zip)); guardarSel(); pintar(); };
$("quitarSel").onclick = () => { TermiSel.clear(); guardarSel(); pintar(); };
$("pararProp").onclick = () => { pararProp = true; ver("Termi: me paro al terminar esta búsqueda…"); };

async function irAT(tab, url) {
  await chrome.tabs.update(tab, { url }); await dorm(900);
  for (let i = 0; i < 60; i++) { const x = await chrome.tabs.get(tab).catch(() => null); if (!x || x.status === "complete") break; await dorm(400); }
  await dorm(alAzar(1500, 3000));
}
async function enPW(tab, func, args = []) {
  await chrome.scripting.executeScript({ target: { tabId: tab }, files: ["pw-lector.js"] });
  const [r] = await chrome.scripting.executeScript({ target: { tabId: tab }, func, args });
  return r && r.result;
}
async function llavesT(tab, tipos, zip) {
  const { radarPwKeys = {} } = await chrome.storage.local.get("radarPwKeys");
  const llaves = {};
  for (const t of tipos) {
    let k = t.labels.map((l) => radarPwKeys[l]).find(Boolean);
    if (!k && !pararProp) {
      for (const l of t.labels) {
        ver(`Termi: aprendiendo el filtro “${l}” de Propwire…`);
        if (!(await turnoPropwire({ parar: () => pararProp }))) break;
        await irAT(tab, urlPWT(zip));
        const r = await enPW(tab, (x) => pwLlaveT(x), [l]).catch((e) => ({ error: e.message }));
        if (r && r.llaves && r.llaves.length) { k = r.llaves[r.llaves.length - 1]; radarPwKeys[l] = k; await chrome.storage.local.set({ radarPwKeys }); break; }
        await dorm(alAzar(6000, 12000));
      }
      if (!k) decir(`Termi: Propwire no tiene (o no encontré) el filtro “${t.nombre}”; lo salto.`, "error");
    }
    if (k) llaves[t.id] = k;
  }
  return llaves;
}

$("sacar").onclick = async () => {
  if (sacando || !TermiSel.size) return;
  const tipos = TIPOS.filter((t) => tiposSel.has(t.id));
  if (!tipos.length) { ver("Escoge al menos un tipo de seller."); return; }
  const maxPag = Math.min(10, Math.max(1, parseInt($("maxPag").value, 10) || 2));
  const { radarData = {} } = await chrome.storage.local.get("radarData");
  const zips = [...TermiSel];
  // trabajos: ZIP × tipo, saltando los que Radar ya sabe que tienen 0
  const trabajos = [];
  let estim = 0;
  for (const zip of zips) for (const t of tipos) {
    const n = t.campo ? ((radarData[zip] || {}).propwire || {})[t.campo] : null;
    if (n === 0) continue;
    trabajos.push({ zip, t }); if (n != null) estim += Math.min(n, maxPag * 20);
  }
  if (!trabajos.length) { ver("Radar dice que esos ZIP no tienen propiedades de esos tipos."); return; }
  const min = Math.round((trabajos.length * (maxPag * 25 + 30)) / 60);
  const ok = await preguntar(`¿Busco propiedades en Propwire?\n\n${zips.length} ZIP × ${tipos.length} tipos = ${trabajos.length} búsquedas, hasta ${maxPag} página(s) cada una${estim ? ` (≈${estim} propiedades)` : ""}.\nSolo leo la lista: no exporto ni gasto créditos. Con ritmo humano tardo ~${min} min.\n\nAl terminar te dejo la lista de domicilios aquí en Termi.`, "🔎 Buscar", "Cancelar");
  if (!ok) return;
  sacando = true; window.sacandoProp = true; pararProp = false; pintarSel();
  window.robot && robot.set("trabajando", "Leyendo propiedades en Propwire…");
  const props = new Map(); let hechas = 0, bloqueado = false;
  try {
    const tab = (await abrirPestana("https://propwire.com/search", "zonas")).id;
    await dorm(2500);
    const llaves = await llavesT(tab, tipos, zips[0]);
    for (const j of trabajos) {
      if (pararProp) break;
      const llave = llaves[j.t.id]; if (!llave) continue;
      ver(`Termi: ${j.zip} · ${j.t.nombre} (${hechas + 1} de ${trabajos.length}) · ${props.size} propiedades hasta ahora…`);
      if (!(await turnoPropwire({ aviso: (ms) => ver(`Ritmo humano: espero ${Math.ceil(ms / 1000)} s para no saturar Propwire…`), parar: () => pararProp }))) break;
      await irAT(tab, urlPWT(j.zip, llave));
      const r = await enPW(tab, (a, b, c) => pwListarT(a, b, c), [maxPag, 12000, 30000]).catch((e) => ({ error: e.message }));
      hechas++;
      if (r && r.bloqueo) {
        bloqueado = true;
        const { radarPausa = {} } = await chrome.storage.local.get("radarPausa"); radarPausa.propwire = Date.now() + 8 * 3600e3; await chrome.storage.local.set({ radarPausa });
        decir("Termi: Propwire pidió verificación o limitó el acceso. Me paro y no lo vuelvo a tocar en 8 horas.", "error"); break;
      }
      if (!r || r.error) { window.svLog && svLog(`Termi: ${j.zip} ${j.t.nombre}: ${(r && r.error) || "sin respuesta"}`); continue; }
      const f = filas.find((x) => x.zip === j.zip) || {};
      for (const it of r.items || []) {
        if (it.zip !== j.zip && !zips.includes(it.zip)) continue; // solo de las zonas marcadas
        const k = (it.street + "|" + it.zip).toUpperCase();
        const p = props.get(k) || { ...it, condado: f.condado || "", score: f.score ?? "", tipos: new Set() };
        p.tipos.add(j.t.nombre); props.set(k, p);
      }
      if (hechas < trabajos.length && !pararProp) {
        await dorm(alAzar(15000, 35000));
        if (hechas % Math.round(alAzar(10, 15)) === 0) { const ms = alAzar(3, 6) * 60000, fin = Date.now() + ms; while (!pararProp && Date.now() < fin) { ver(`Ritmo humano: descanso de Propwire · sigo en ${Math.ceil((fin - Date.now()) / 1000)} s`); await dorm(1000); } }
      }
    }
    if (!props.size) { decir(`Termi: no saqué propiedades (${hechas} búsquedas${bloqueado ? ", Propwire me frenó" : ""}).`, "error"); window.robot && robot.set("error", "Sin propiedades"); return; }
    // Archivo (mismas columnas que un export de Propwire, para que Carpi lo entienda)
    const celda = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const cab = ["Address", "City", "State", "Zip", "County", "Lead Types", "Termi Score"];
    const lista = [...props.values()].sort((a, b) => (b.score || 0) - (a.score || 0) || a.zip.localeCompare(b.zip));
    const texto = [cab.join(","), ...lista.map((p) => [p.street, p.city, "CA", p.zip, p.condado, [...p.tipos].join("; "), p.score].map(celda).join(","))].join("\r\n");
    const sello = new Date().toLocaleDateString("en-CA") + " " + new Date().toTimeString().slice(0, 5).replace(":", "-");
    const nombre = `Termi ${sello} ${zips.slice(0, 3).join(", ")}${zips.length > 3 ? "…" : ""}`.replace(/[\\/:*?"<>|]+/g, "-");
    const url = URL.createObjectURL(new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" }));
    await chrome.downloads.download({ url, filename: `Termi/${nombre}.csv`, conflictAction: "uniquify", saveAs: false }).catch(() => {});
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    doms = lista.map((p) => ({ street: p.street, city: p.city, zip: p.zip, condado: p.condado, score: p.score, tipos: [...p.tipos] }));
    await chrome.storage.local.set({ termiDoms: { t: Date.now(), nombre, doms } });
    pintarDoms();
    decir(`Termi: saqué ${lista.length} domicilios en ${hechas} búsquedas de Propwire${pararProp ? " (me paraste)" : ""}${bloqueado ? " (Propwire me frenó)" : ""}. Te dejé la lista aquí abajo y el CSV en Descargas/Termi.`);
    window.robot && robot.set("feliz", `${lista.length} domicilios listos`);
  } catch (e) { decir("Termi: no pude sacar las propiedades: " + e.message, "error"); window.robot && robot.set("error", e.message); }
  finally { sacando = false; window.sacandoProp = false; pararProp = false; pintarSel(); }
};
// ---------- Lista de domicilios ----------
let doms = [];
const lineaDom = (d) => `${d.street}, ${d.city}, CA ${d.zip}`;
function domsFiltrados() { const q = $("filtroDoms").value.trim().toLowerCase(); return q ? doms.filter((d) => (lineaDom(d) + " " + d.tipos.join(" ")).toLowerCase().includes(q)) : doms; }
function pintarDoms() {
  $("cajaDoms").hidden = !doms.length; $("nDoms").textContent = doms.length;
  const ls = domsFiltrados();
  $("doms").innerHTML = ls.slice(0, 1000).map((d, i) => `<li><div class="q"><b>${esc(d.street)}</b><small>${esc(d.city)}, CA ${esc(d.zip)} · ${esc(d.tipos.join(", "))}${d.score !== "" && d.score != null ? ` · zona ${esc(d.score)}` : ""}</small></div><button class="mini copiar" data-i="${doms.indexOf(d)}">Copiar</button></li>`).join("") || '<span class="empty">Nada con ese filtro.</span>';
}
async function copiar(texto, msg) { try { await navigator.clipboard.writeText(texto); ver(msg); } catch (e) { const t = document.createElement("textarea"); t.value = texto; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); ver(msg); } }
$("doms").addEventListener("click", (e) => { const b = e.target.closest("button.copiar"); if (!b) return; const d = doms[+b.dataset.i]; copiar(lineaDom(d), "Copié: " + lineaDom(d)); b.textContent = "✓"; });
$("copiarTodos").onclick = () => { const ls = domsFiltrados(); copiar(ls.map(lineaDom).join("\n"), `Copié ${ls.length} domicilios.`); };
$("filtroDoms").oninput = pintarDoms;
$("bajarDoms").onclick = async () => {
  const celda = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const ls = domsFiltrados();
  const texto = ["Address,City,State,Zip,County,Lead Types,Termi Score", ...ls.map((d) => [d.street, d.city, "CA", d.zip, d.condado, d.tipos.join("; "), d.score].map(celda).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + texto], { type: "text/csv;charset=utf-8" }));
  await chrome.downloads.download({ url, filename: `Termi/domicilios ${new Date().toLocaleDateString("en-CA")}.csv`, conflictAction: "uniquify", saveAs: false }).catch(() => {});
  setTimeout(() => URL.revokeObjectURL(url), 60000); ver(`Bajé ${ls.length} domicilios a Descargas/Termi.`);
};
$("borrarDoms").onclick = async () => { if (!(await preguntar("¿Borro la lista de domicilios de Termi? (el CSV en Descargas se queda)", "Borrar", "Cancelar"))) return; doms = []; await chrome.storage.local.remove("termiDoms"); pintarDoms(); };
chrome.storage.local.get("termiDoms").then(({ termiDoms }) => { doms = (termiDoms && termiDoms.doms) || []; pintarDoms(); });

iniciarProp();
