// =====================================================================
// Puente (Fase A): pantalla de los servicios que corren solos en tu Mac (puente/servicios).
// · Usa la misma clave del puente que Navi (nvToken en chrome.storage.local).
// · Cada 10 s lee GET /servicios: estado, texto, interruptor y log de cada uno.
// · Llaves: copia al puente (Llavero de macOS) la llave de Lofty SOLO con tu clic.
// · Escribe en la bitácora cuando un servicio falla o se recupera, y deja spRes para el Mando.
// =====================================================================
const N = window.NAVI_CORE, S = window.SP_CORE;
const $ = (id) => document.getElementById(id);
const MASCARA = "••••••••••••";
let token = "", antes = {}, abiertos = new Set(), ocupado = false;

const ver = (t) => { $("status").textContent = t; };
const bitacora = (t, nivel) => window.svLog && svLog(t, nivel);

async function api(ruta, { method = "GET", body } = {}) {
  if (!token) throw Object.assign(new Error(N.MSG.sinClave), { sinClave: true });
  let r;
  try { r = await fetch(N.PUENTE + ruta, { method, cache: "no-store", headers: { "X-Navi-Token": token, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { throw Object.assign(new Error(N.MSG.apagado), { red: true }); }
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!r.ok) throw Object.assign(new Error(r.status === 400 && j && j.error ? j.error : N.diagnostico({ status: r.status }).texto), { status: r.status });
  return j;
}

// ---------- Revisar ----------
async function revisar() {
  if (ocupado) return; ocupado = true;
  try {
    const { servicios = [] } = await api("/servicios");
    pintarServicios(servicios);
    for (const c of S.cambios(antes, servicios)) bitacora(c.texto, c.nivel);
    antes = S.mapa(servicios);
    const r = S.resumen(servicios);
    ver(r.texto); window.robot && robot.set(r.estado, r.texto);
    await chrome.storage.local.set({ spRes: { t: Date.now(), ok: true, estado: r.estado, cuenta: r.cuenta, texto: r.texto, servicios: servicios.map((s) => ({ nombre: s.nombre, estado: s.estado, texto: s.texto, activo: s.activo })) } });
    await pintarLlaves();
    return r.texto;
  } catch (e) {
    // Decisión del jefe (Fase A): si el puente se apaga, los robots de la extensión siguen y aquí se avisa
    const txt = e.message;
    ver(txt); window.robot && robot.set("error", txt);
    if (!antes.__caido) { bitacora(`Puente: ${txt}`, "error"); antes = { __caido: { estado: "error" } }; }
    await chrome.storage.local.set({ spRes: { t: Date.now(), ok: false, estado: "error", cuenta: e.red ? "puente apagado" : e.sinClave ? "falta la clave" : "revisar puente", texto: txt, servicios: [] } });
    $("servicios").textContent = ""; $("llaves").textContent = "";
    return txt;
  } finally { ocupado = false; }
}

function pintarServicios(lista) {
  const caja = $("servicios"); caja.textContent = "";
  const n = (e) => lista.filter((s) => s.estado === e).length;
  $("nums").innerHTML = `<div class="card"><div class="count">${lista.filter((s) => s.activo).length}</div><small>prendidos</small></div>` +
    `<div class="card"><div class="count">${n("error") + n("ayuda")}</div><small>con problema</small></div>`;
  for (const s of lista) {
    const c = document.createElement("div"); c.className = "card srv"; c.dataset.servicio = s.nombre;
    const cab = document.createElement("div"); cab.className = "cab";
    const t = document.createElement("b"); t.textContent = s.titulo;
    const chip = document.createElement("span"); chip.className = "chip " + s.estado; chip.textContent = S.CHIP[s.estado] || s.estado;
    const sw = document.createElement("label"); sw.className = "sw";
    const chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = !!s.activo; chk.dataset.a = "interruptor";
    chk.onchange = async () => { try { await api(`/servicios/${s.nombre}/${chk.checked ? "prender" : "apagar"}`, { method: "POST", body: {} }); bitacora(`Puente · ${s.titulo}: ${chk.checked ? "prendido" : "apagado"} por el jefe.`); } catch (e) { ver(e.message); } revisar(); };
    sw.append(chk, document.createTextNode("prendido"));
    const ya = document.createElement("button"); ya.textContent = "Ahora"; ya.dataset.a = "ahora"; ya.disabled = !s.activo;
    ya.onclick = async () => { try { await api(`/servicios/${s.nombre}/ahora`, { method: "POST", body: {} }); } catch (e) { ver(e.message); } setTimeout(revisar, 1500); };
    cab.append(t, chip, sw, ya);
    const txt = document.createElement("div"); txt.textContent = s.texto;
    const desc = document.createElement("small"); desc.className = "hint"; desc.textContent = `${s.descripcion} Cada ${s.intervalo >= 60 ? Math.round(s.intervalo / 60) + " min" : s.intervalo + " s"}.`;
    const det = document.createElement("details"); det.open = abiertos.has(s.nombre);
    det.ontoggle = () => (det.open ? abiertos.add(s.nombre) : abiertos.delete(s.nombre));
    const sum = document.createElement("summary"); sum.textContent = "Log"; sum.className = "hint";
    const pre = document.createElement("pre"); pre.textContent = (s.log || []).join("\n") || "(vacío)";
    det.append(sum, pre);
    c.append(cab, txt, desc, det);
    caja.appendChild(c);
  }
}

// ---------- Llaves ----------
async function pintarLlaves() {
  const { llaves = {} } = await api("/llaves");
  const st = await chrome.storage.local.get(Object.keys(S.LLAVES));
  const caja = $("llaves"); caja.textContent = "";
  for (const k of S.llavesPorMandar(st, llaves)) {
    const fila = document.createElement("div"); fila.className = "llave"; fila.dataset.llave = k.nombre;
    const q = document.createElement("div"); q.className = "q";
    const b = document.createElement("b"); b.textContent = k.descripcion;
    const sm = document.createElement("small");
    sm.textContent = k.enPuente ? `En el puente (${k.pistaPuente})${k.enExtension && !k.igual ? " · la de la extensión es distinta" : ""}` : k.enExtension ? "Todavía no está en el puente" : "La extensión no la tiene (ponla en su robot)";
    q.append(b, sm);
    fila.appendChild(q);
    if (k.enExtension && !k.igual) {
      const m = document.createElement("button"); m.className = "primary"; m.style.flex = "0 0 auto"; m.dataset.a = "mandar";
      m.textContent = k.enPuente ? "Actualizar en el puente" : "Mandar al puente";
      m.onclick = () => mandarLlave(k.nombre);
      fila.appendChild(m);
    }
    if (k.enPuente) {
      const x = document.createElement("button"); x.textContent = "Quitar"; x.dataset.a = "quitar";
      x.onclick = async () => { if (!confirm(`¿Quitar del puente la llave “${k.descripcion}”? (La extensión la conserva.)`)) return; try { await api("/llaves/borrar", { method: "POST", body: { nombre: k.nombre } }); bitacora(`Puente: quité del Llavero la llave ${k.descripcion}.`); } catch (e) { ver(e.message); } pintarLlaves(); };
      fila.appendChild(x);
    }
    caja.appendChild(fila);
  }
}

async function mandarLlave(nombre) {
  const st = await chrome.storage.local.get(nombre);
  const valor = String(st[nombre] || "").trim();
  if (!valor) { ver("La extensión no tiene esa llave."); return; }
  try {
    await api("/llaves", { method: "POST", body: { nombre, valor } });
    ver(`Listo: la llave ${S.LLAVES[nombre]} quedó en el Llavero de macOS del puente.`);
    bitacora(`Puente: guardé en el Llavero la llave ${S.LLAVES[nombre]}.`);
  } catch (e) { ver("No pude mandar la llave: " + e.message); bitacora("Puente: no pude mandar la llave: " + e.message, "error"); }
  setTimeout(revisar, 2500); // el puente revisa la llave nueva en cuanto llega
  pintarLlaves().catch(() => {});
}

// ---------- Botones y arranque ----------
$("run").onclick = revisar;
$("token").onchange = async () => {
  const v = $("token").value.trim(); if (v.startsWith("•")) return;
  token = v; await chrome.storage.local.set({ nvToken: v }); $("token").value = v ? MASCARA : ""; revisar();
};
chrome.storage.onChanged.addListener((ch, area) => { // si pegan la clave en Navi, aquí también sirve
  if (area === "local" && ch.nvToken) { token = ch.nvToken.newValue || ""; $("token").value = token ? MASCARA : ""; revisar(); }
});
window.Tareas && Tareas.atender("revisar", async () => { await Tareas.esperarLibre(() => ocupado); return revisar(); });
(async () => {
  const { nvToken = "" } = await chrome.storage.local.get("nvToken");
  token = nvToken; if (token) $("token").value = MASCARA;
  revisar();
  setInterval(revisar, 10e3);
})();
