// =====================================================================
// Navi (Fase 7): le pide al puente local (puente/puente.py) que corra recetas de Browser Use.
// · La clave del puente se guarda en chrome.storage.local (nvToken), igual que las otras llaves.
// · Lee las recetas de GET /recetas y arma el formulario de sus parámetros.
// · Arrancar → POST /tarea; log en vivo cada 2 s (GET /tarea/<id>); Cancelar → POST /tarea/<id>/cancelar.
// · Estados del robot: Trabajando, ¡Terminé!, Error y Necesito ayuda (CAPTCHA). Escribe en la bitácora.
// · Capi puede pedirle recetas por el bus de tareas (acción "receta"), solo de la lista del puente.
// =====================================================================
const C = window.NAVI_CORE;
const $ = (id) => document.getElementById(id);
const MASCARA = "••••••••••••";
let token = "", recetas = [], actual = null, vistas = 0, timer = null, terminar = null, ultimaSalud = null;

const estado = (est, texto) => { $("status").textContent = texto; window.robot && robot.set(est, texto); };
const bitacora = (texto, nivel) => window.svLog && svLog(texto, nivel);

// ---------- Hablar con el puente ----------
async function api(ruta, { method = "GET", body } = {}) {
  if (!token) { const e = new Error(C.MSG.sinClave); e.sinClave = true; throw e; }
  let r;
  try {
    r = await fetch(C.PUENTE + ruta, { method, headers: { "X-Navi-Token": token, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  } catch (e) { const err = new Error(C.MSG.apagado); err.red = true; throw err; }
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!r.ok) { const d = C.diagnostico({ status: r.status }); const err = new Error((j && j.error && r.status === 400) ? j.error : d.texto); err.status = r.status; throw err; }
  return j;
}

async function revisarPuente(silencioso = false) {
  if (!token) { pintarPuente({ ok: false, estado: "error", texto: C.MSG.sinClave }); return false; }
  let d;
  try { ultimaSalud = await api("/salud"); d = C.diagnostico({ salud: ultimaSalud }); }
  catch (e) { d = e.red ? C.diagnostico({ error: true }) : e.status ? C.diagnostico({ status: e.status }) : { ok: false, estado: "error", texto: e.message }; }
  pintarPuente(d);
  if (!silencioso || !d.ok) { if (!actual) estado(d.ok ? "idle" : d.estado, d.texto); }
  if (d.ok || d.clave === "brave") await cargarRecetas();
  await chrome.storage.local.set({ nvPuente: { ok: d.ok, texto: d.texto, t: Date.now() } });
  return d.ok;
}
function pintarPuente(d) {
  const el = $("puente");
  el.textContent = d.texto;
  el.className = "estado-puente " + (d.ok ? "ok" : d.estado === "ayuda" ? "ayuda" : "mal");
  $("arrancar").disabled = !d.ok || !!actual;
}

async function cargarRecetas() {
  try { recetas = (await api("/recetas")).recetas || []; } catch (e) { return; }
  // para Capi: solo puede pedir recetas de esta lista
  await chrome.storage.local.set({ nvRecetas: recetas.map((r) => ({ nombre: r.nombre, titulo: r.titulo, params: Object.fromEntries(Object.entries(r.params).map(([k, p]) => [k, { tipo: p.tipo, requerido: !!p.requerido, etiqueta: p.etiqueta || k }])) })) });
  const sel = $("receta"), antes = sel.value || localStorage.getItem("nvReceta") || "";
  sel.innerHTML = recetas.map((r) => `<option value="${r.nombre}">${r.titulo}</option>`).join("") || `<option value="">(el puente no tiene recetas)</option>`;
  if (recetas.some((r) => r.nombre === antes)) sel.value = antes;
  pintarForm();
}

// ---------- Formulario de parámetros ----------
const receta = () => recetas.find((r) => r.nombre === $("receta").value) || null;
function pintarForm() {
  const r = receta(), caja = $("params");
  caja.textContent = "";
  $("descReceta").textContent = r ? r.descripcion : "";
  if (!r) return;
  let guardados = {}; try { guardados = JSON.parse(localStorage.getItem("nvParams_" + r.nombre) || "{}"); } catch (e) {}
  for (const [n, p] of Object.entries(r.params)) {
    if (p.tipo === "bool") {
      const l = document.createElement("label"); l.className = "chk";
      const i = document.createElement("input"); i.type = "checkbox"; i.dataset.p = n; i.checked = guardados[n] != null ? !!guardados[n] : !!p.defecto;
      l.append(i, document.createTextNode(p.etiqueta || n)); caja.appendChild(l);
    } else {
      const l = document.createElement("label"); l.className = "f"; l.textContent = (p.etiqueta || n) + (p.requerido ? " *" : "");
      const i = document.createElement("input"); i.dataset.p = n;
      i.type = p.tipo === "int" ? "number" : "text";
      if (p.tipo === "int") { if (p.min != null) i.min = p.min; if (p.max != null) i.max = p.max; }
      i.placeholder = p.ejemplo || ""; i.value = guardados[n] != null ? guardados[n] : (p.defecto != null && p.tipo !== "url" ? p.defecto : "");
      l.appendChild(i); caja.appendChild(l);
    }
  }
}
function leerForm() {
  const out = {};
  for (const i of $("params").querySelectorAll("[data-p]")) out[i.dataset.p] = i.type === "checkbox" ? i.checked : i.value.trim();
  return out;
}

// ---------- Tareas ----------
async function arrancar(nombre, params, origen = "jefe") {
  if (actual) throw new Error("Ya hay una tarea corriendo; espera a que termine o cancélala.");
  const r = recetas.find((x) => x.nombre === nombre);
  if (!r) throw new Error(`No existe la receta “${nombre}”. Las que hay: ${recetas.map((x) => x.nombre).join(", ") || "ninguna (revisa el puente)"}.`);
  const v = C.validar(r, params);
  if (!v.ok) throw new Error(v.error);
  if (!(await revisarPuente(true))) throw new Error($("puente").textContent);
  const t = await api("/tarea", { method: "POST", body: { receta: nombre, params: v.params } });
  actual = { id: t.id, receta: nombre, origen }; vistas = 0;
  await chrome.storage.local.set({ nvActual: { ...actual, t: Date.now() } });
  $("log").textContent = ""; $("resultado").hidden = true;
  $("arrancar").disabled = true; $("cancelar").disabled = false;
  estado("trabajando", `Arranqué ${r.titulo}.`);
  bitacora(`Arranqué la receta ${nombre}${origen !== "jefe" ? ` (la pidió ${origen})` : ""}.`);
  seguir();
  return t.id;
}

function seguir() {
  clearInterval(timer);
  timer = setInterval(revisarTarea, 2000);
  revisarTarea();
}

async function revisarTarea() {
  if (!actual) return;
  let t;
  try { t = await api(`/tarea/${actual.id}`); }
  catch (e) {
    if (e.status === 404) { fin({ estado: "error", error: "el puente se reinició y perdió la tarea" }); return; }
    estado("error", e.message); return; // el puente se apagó a medio camino: se sigue intentando
  }
  const nuevas = C.nuevas(vistas, t.log || []);
  vistas = (t.log || []).length;
  if (nuevas.length) {
    const pre = $("log"); pre.textContent += nuevas.join("\n") + "\n"; pre.scrollTop = pre.scrollHeight;
    for (const l of nuevas) { const b = C.paraBitacora(l); if (b) bitacora(b); }
  }
  const e = C.estadoTarea(t);
  if (C.VIVOS.includes(t.estado)) { $("status").textContent = e.texto; window.robot && robot.set("trabajando", e.texto); return; }
  fin(t);
}

async function fin(t) {
  clearInterval(timer); timer = null;
  const e = C.estadoTarea(t);
  estado(e.estado, e.texto);
  bitacora(e.texto, e.estado === "error" ? "error" : undefined);
  const r = t.resultado || {};
  if (t.estado === "terminado") pintarResultado(t);
  await chrome.storage.local.set({ nvRes: { t: Date.now(), estado: t.estado, receta: actual && actual.receta, texto: e.texto, fotos: r.fotos, total: r.total, carpeta: r.carpeta || "" } });
  await chrome.storage.local.remove("nvActual");
  const quien = actual; actual = null;
  $("cancelar").disabled = true; $("arrancar").disabled = !(ultimaSalud && ultimaSalud.brave);
  if (terminar && quien) { const f = terminar; terminar = null; f({ ok: t.estado === "terminado", texto: e.texto, estado: t.estado }); }
}

function pintarResultado(t) {
  const r = t.resultado || {}, caja = $("resultado");
  caja.textContent = "";
  const p = document.createElement("div");
  p.innerHTML = `<b>${C.resumen(t.receta, r).replace(/</g, "&lt;")}</b>`;
  const ruta = document.createElement("div"); ruta.className = "hint";
  ruta.append("Carpeta: "); const code = document.createElement("code"); code.textContent = r.carpeta || "(sin carpeta)"; ruta.appendChild(code);
  if (r.csv) { ruta.append(" · CSV: "); const c2 = document.createElement("code"); c2.textContent = String(r.csv).split("/").pop(); ruta.appendChild(c2); }
  const fila = document.createElement("div"); fila.className = "row";
  const abrir = document.createElement("button"); abrir.textContent = "Abrir la carpeta en Finder"; abrir.className = "primary";
  const idTarea = t.id;
  abrir.onclick = async () => { try { await api(`/tarea/${idTarea}/abrir`, { method: "POST", body: {} }); } catch (e) { $("status").textContent = "No pude abrir la carpeta: " + e.message; } };
  fila.appendChild(abrir);
  caja.append(p, ruta, fila); caja.hidden = false;
}

async function cancelar() {
  if (!actual) return;
  try { await api(`/tarea/${actual.id}/cancelar`, { method: "POST", body: {} }); estado("pausa", "Cancelando…"); bitacora("Detenido: cancelé la tarea."); }
  catch (e) { estado("error", "No pude cancelar: " + e.message); }
}

// ---------- Botones ----------
$("receta").onchange = () => { try { localStorage.setItem("nvReceta", $("receta").value); } catch (e) {} pintarForm(); };
$("revisar").onclick = () => revisarPuente();
$("cancelar").onclick = cancelar;
$("arrancar").onclick = async () => {
  const r = receta(); if (!r) return;
  const params = leerForm();
  try { localStorage.setItem("nvParams_" + r.nombre, JSON.stringify(params)); } catch (e) {}
  try { await arrancar(r.nombre, params, "jefe"); } catch (e) { estado("error", e.message); bitacora("No pude arrancar: " + e.message, "error"); }
};
$("token").onchange = async () => {
  const v = $("token").value.trim();
  if (v.startsWith("•")) return;
  token = v;
  await chrome.storage.local.set({ nvToken: v });
  $("token").value = v ? MASCARA : "";
  revisarPuente();
};

// ---------- Bus de tareas: Capi le pide recetas (solo de la lista del puente) ----------
window.Tareas && Tareas.atender("receta", async (entrada = {}) => {
  if (!recetas.length) await revisarPuente(true);
  await Tareas.esperarLibre(() => !!actual);
  const res = new Promise((ok) => { terminar = ok; });
  try { await arrancar(String(entrada.receta || ""), entrada.params || {}, "Capi"); }
  catch (e) { terminar = null; throw e; }
  const r = await res;
  if (!r.ok) throw new Error(r.texto);
  return r.texto;
}, { alCancelar: cancelar });

// ---------- Al abrir ----------
try { $("extId").textContent = chrome.runtime.id; } catch (e) {}
(async () => {
  const { nvToken = "", nvActual = null } = await chrome.storage.local.get(["nvToken", "nvActual"]);
  token = nvToken;
  if (token) $("token").value = MASCARA;
  await revisarPuente(true);
  if (nvActual && nvActual.id) { // la página se recargó con una tarea corriendo: se sigue su log
    actual = { id: nvActual.id, receta: nvActual.receta, origen: nvActual.origen || "jefe" };
    $("arrancar").disabled = true; $("cancelar").disabled = false;
    seguir();
  }
  setInterval(() => { if (!actual) revisarPuente(true); }, 60e3); // revisa el puente cada minuto
})();
