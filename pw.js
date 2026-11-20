const $ = (id) => document.getElementById(id);
const setStatus = (t) => { $("status").textContent = t; window.svLog && svLog(t); };
const zones = () => zonasDe($("zone").value); // reglas de zona en comun.js

let all = [];
function filtered() {
  const zs = zones();
  return all.filter((a) => sirve(a) && enZona(a, zs))
    .sort((a, b) => (a.city + a.street).localeCompare(b.city + b.street));
}

const line = lineaDir;

function render() {
  const rows = filtered();
  $("count").textContent = rows.length;
  const zs = zones();
  const traced = all.filter((a) => a.skipTraced && enZona(a, zs)).length;
  $("total").textContent = topeTexto || (traced ? `(${traced} descartados por skip trace)` : "");
  const ul = $("list");
  ul.innerHTML = "";
  if (!rows.length) { ul.innerHTML = '<li class="empty">Todavía no hay domicilios de esta zona.</li>'; return; }
  for (const a of rows.slice(0, 1000)) {
    const li = document.createElement("li");
    li.innerHTML = `<div>${esc(a.street)}${a.bvSearched ? ' <span class="bv">BV ✓</span>' : ""}<br><small>${esc(a.city)}, CA ${esc(a.zip)}</small></div>`;
    const btn = document.createElement("button");
    btn.className = "copy1";
    btn.textContent = "Copiar";
    btn.title = "Copiar este domicilio";
    btn.onclick = async () => {
      await navigator.clipboard.writeText(line(a));
      btn.textContent = "✓ Copiado";
      btn.classList.add("done");
      li.classList.add("copied");
      setStatus(`Copié: ${line(a)}`);
      setTimeout(() => { btn.textContent = "Copiar"; btn.classList.remove("done"); }, 1500);
    };
    li.appendChild(btn);
    ul.appendChild(li);
  }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function load() {
  const { addresses = {}, zone = "" } = await chrome.storage.local.get(["addresses", "zone"]);
  all = Object.entries(addresses).map(([k, a]) => ({ ...a, _k: k }));
  if (!$("zone").value) $("zone").value = zone;
  render();
}

chrome.storage.onChanged.addListener((ch) => { if (ch.addresses) load(); });

// ---------- Tope de propiedades ----------
// El background es el que cuenta (pwCupo): en cuanto entran N domicilios nuevos de la zona,
// ya no deja pasar más y le dice a Propwire que pare. Aquí solo se muestra el avance.
const topeValor = () => Math.max(0, parseInt($("tope").value, 10) || 0);
let topeLleno = false, topeTexto = "";
chrome.storage.onChanged.addListener((ch) => {
  const c = ch.pwCupo && ch.pwCupo.newValue;
  if (!c) return;
  topeTexto = `${c.tope - Math.max(0, c.restan)} de ${c.tope} del tope`;
  $("total").textContent = topeTexto;
  if (c.avisado && !(ch.pwCupo.oldValue || {}).avisado) { topeLleno = true; setStatus(`Listo: llegué al tope de ${c.tope} propiedades nuevas.`); }
});
$("tope").addEventListener("input", () => chrome.storage.local.set({ pwTope: topeValor() }));
chrome.storage.local.get("pwTope").then(({ pwTope }) => { if (pwTope) $("tope").value = pwTope; });
chrome.runtime.onMessage.addListener((m, sender) => {
  if (m.type !== "pwStatus") return;
  // Ya se llegó al tope: lo que siga diciendo Propwire (otra página, "Parado.") no tapa el aviso, salvo un captcha.
  if (topeLleno && !/verificación/i.test(m.text)) return;
  setStatus(m.text);
  if (/pide verificación/.test(m.text) && sender.tab) {
    chrome.tabs.update(sender.tab.id, { active: true }).then((t) => chrome.windows.update(t.windowId, { focused: true })).catch(() => {});
  }
});
$("zone").addEventListener("input", () => { chrome.storage.local.set({ zone: $("zone").value }); render(); });

// ---------- Pestaña de Propwire ----------
const isPropwire = (u) => /^https:\/\/([a-z0-9-]+\.)?propwire\.com\//i.test(u || "");

async function waitLoaded(tabId) {
  for (let i = 0; i < 60; i++) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === "complete") return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function propwireTab() {
  const [active] = await chrome.tabs.query({ active: true, windowId: await ventanaTrabajo() });
  if (active && isPropwire(active.url)) return active;
  const [other] = await chrome.tabs.query({ url: ["https://propwire.com/*", "https://*.propwire.com/*"], windowId: await ventanaTrabajo() });
  if (other) { await chrome.tabs.update(other.id, { active: true }); return other; }
  setStatus("Abriendo Propwire…");
  const t = await chrome.tabs.create({ url: "https://propwire.com/search", windowId: await ventanaTrabajo() });
  await waitLoaded(t.id);
  await new Promise((r) => setTimeout(r, 2500));
  return t;
}

async function send(tab, msg) {
  try { return await chrome.tabs.sendMessage(tab.id, msg); }
  catch (e) {
    // La pestaña estaba abierta antes de instalar la extensión: inyectar los scripts.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["hook.js"], world: "MAIN" });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["pw-content.js"] });
    return await chrome.tabs.sendMessage(tab.id, msg);
  }
}

$("run").onclick = async () => {
  const zs = zones();
  if (!zs.length) { setStatus("Escribe primero la zona (ciudad, ZIP o condado)."); $("zone").focus(); return; }
  try {
    // El cupo se arma ANTES de tocar Propwire: así cuenta todo lo que llegue, aunque sea mientras se abre la pestaña.
    topeLleno = false; topeTexto = "";
    await chrome.storage.local.set({ pwCupo: topeValor() ? { tope: topeValor(), restan: topeValor(), inicio: Date.now() } : null });
    const tab = await propwireTab();
    await chrome.storage.local.set({ propiSesion: { tab: tab.id, t: Date.now() } }); // Propi solo junta lo de SU pestaña mientras trabaja
    if (topeLleno) return; // se llenó el tope mientras se abría Propwire
    setStatus(`Buscando ${zs[0]} en Propwire…` + (topeValor() ? ` (tope: ${topeValor()} propiedades)` : ""));
    await send(tab, { cmd: "run", zone: `${zs[0]}, CA`, maxPages: Number($("pages").value) || 10 });
  } catch (e) { setStatus("No pude hablar con la pestaña de Propwire. Recárgala e intenta otra vez."); }
};

$("collect").onclick = async () => {
  topeLleno = false; topeTexto = "";
  await chrome.storage.local.set({ pwCupo: null }); // recolectar a mano no tiene tope
  try {
    const tab = await propwireTab();
    await chrome.storage.local.set({ propiSesion: { tab: tab.id, t: Date.now() } });
    setStatus("Recolectando esta página…");
    await send(tab, { cmd: "collect" });
  } catch (e) { setStatus("No pude leer la pestaña. Recarga Propwire e intenta otra vez."); }
};

$("stop").onclick = async () => {
  const tabs = await chrome.tabs.query({ url: ["https://propwire.com/*", "https://*.propwire.com/*"] });
  for (const t of tabs) chrome.tabs.sendMessage(t.id, { cmd: "stop" }).catch(() => {});
  await chrome.storage.local.set({ propiSesion: null });
  setStatus("Parando…");
};

// ---------- Salida ----------
$("copy").onclick = async () => {
  const rows = filtered();
  await navigator.clipboard.writeText(rows.map(line).join("\n"));
  setStatus(`Copié los ${rows.length} domicilios (uno por línea).`);
};

$("csv").onclick = () => {
  const rows = filtered();
  const q = (s) => `"${String(s ?? "").replace(/^([=+\-@\t\r])/, "'$1").replace(/"/g, '""')}"`; // Fase 1: sin fórmulas
  const csv = ["Street,City,State,Zip,Full Address", ...rows.map((a) =>
    [a.street, a.city, "CA", a.zip, line(a)].map(q).join(","))].join("\n");
  const name = (zones()[0] || "zona").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  chrome.downloads.download({ url, filename: `domicilios-${name}-${date}.csv` });
  setStatus(`Bajé ${rows.length} domicilios en CSV.`);
};

$("clear").onclick = async () => {
  // Fase 1: pide confirmación y solo borra la lista de Propi (antes borraba también los de Acti y las HECM de Heri, sin preguntar)
  const { addresses: antes = {} } = await chrome.storage.local.get("addresses");
  const mios = Object.values(antes).filter((a) => lineaDe(a) === "").length;
  if (!mios) { setStatus("La lista de Propi ya está vacía."); return; }
  if (!(await preguntar(`¿Borrar los ${mios} domicilios de la lista de Propi?\n\nTambién se borran sus marcas (ya buscado, ya en Lofty). Los de Acti y las HECM de Heri no se tocan.`, "Sí, borrar", "Cancelar"))) { setStatus("No borré nada."); return; }
  const r = await domicilios("borrarPropi");
  const { addresses = {} } = await chrome.storage.local.get("addresses");
  const quedan = Object.values(addresses).filter((a) => lineaDe(a) === "").length;
  setStatus(quedan ? "No se pudo borrar la lista. Recarga la extensión e intenta otra vez." : "Lista de Propi borrada." + (r.sinFondo ? " (El fondo de la extensión no contestó; la borré directo.)" : ""));
  revisarFondo();
};

// Aviso si el fondo de la extensión no está corriendo: sin él no se guarda lo que encuentra Propwire.
async function revisarFondo() {
  const vivo = await fondoVivo();
  let av = document.getElementById("avisoFondo");
  if (vivo) { if (av) av.remove(); return; }
  if (!av) {
    av = document.createElement("div"); av.id = "avisoFondo";
    av.style.cssText = "background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.5);color:#fca5a5;border-radius:12px;padding:10px 12px;font-size:12.5px";
    document.querySelector("main").prepend(av);
  }
  av.textContent = "⚠ El fondo de la extensión no está corriendo, así que no se guarda lo que encuentra Propwire. Ve a chrome://extensions, dale ↻ a Agente Geo Farming y si aparece un botón rojo de \"Errores\", mándale captura a Claude.";
}
load();
revisarFondo();
setInterval(revisarFondo, 30000);
