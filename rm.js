// =====================================================================
// Remi: revisa en Lofty qué pasó con los correos que mandó Maili (cuenta de Texi 2, "t2Key").
// · SOLO LEE correos. No manda nada.
// · Por cada lead al que Maili le escribió (mlEnviados, últimos N días) pide el historial de correos a Lofty y
//   saca: respondió / abrió (cuántas veces) / sin abrir / se dio de baja (remi-core.js).
// · Las bajas se guardan en emailBajas para que Maili no vuelva a escribirles.
// · Opcional (apagado por defecto): deja una nota en Lofty, en inglés, cuando responde, se da de baja o abre 2+ veces.
// · Lofty no entrega el texto de la respuesta por su API: Remi dice quién respondió y abre su ficha en Lofty.
// · Ritmo humano: una consulta cada 0.4–1.2 s.
// =====================================================================
const M = window.MAILI_CORE, R = window.REMI_CORE;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const fecha = (ms) => new Date(ms).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const LLAVE = "t2Key", CUENTA = "t2", DIA = 864e5;
const NOMBRES = { respondio: "respondió", abrio: "abrió", sin_abrir: "sin abrir", baja: "baja" };
let cfg = { dias: 30, notas: false }, lista = [], corriendo = false, parar = false, vista = "todos";

async function api(path, opts = {}) {
  const key = (await chrome.storage.local.get(LLAVE))[LLAVE];
  if (!key) throw Object.assign(new Error("Falta la API key de la cuenta de Texi 2: ponla en la pestaña de Texi 2."), { sinKey: true });
  let r;
  for (let i = 0; ; i++) {
    r = await fetch("https://api.lofty.com/v1.0" + path, { method: opts.method || "GET",
      headers: { Authorization: "token " + key, "X-Error-Status": "true", ...(opts.body ? { "Content-Type": "application/json" } : {}) }, ...(opts.body ? { body: JSON.stringify(opts.body) } : {}) });
    if (r.status !== 429 || i >= 4) break;
    const ra = parseInt(r.headers.get("Retry-After") || "", 10);
    await sleep(ra > 0 ? ra * 1000 : 2000 * 2 ** i);
  }
  const cuerpo = await r.text(); let d = {}; try { d = cuerpo ? JSON.parse(cuerpo) : {}; } catch (e) { d = { message: cuerpo }; }
  if (!r.ok) throw Object.assign(new Error(`Lofty respondió ${r.status}` + (d.message ? `: ${String(d.message).slice(0, 140)}` : "")), { status: r.status });
  return d;
}

async function cargar() {
  const st = await chrome.storage.local.get(["rmConfig", "rmLista", "rmRes", LLAVE]);
  cfg = { ...cfg, ...(st.rmConfig || {}) }; lista = st.rmLista || [];
  $("dias").value = cfg.dias; $("notas").checked = !!cfg.notas;
  $("cuentaTxt").textContent = st[LLAVE] ? "· conectada" : "· falta la API key (ponla en la pestaña de Texi 2)";
  if (st.rmRes) $("ultima").textContent = `Última revisión: ${fecha(st.rmRes.t)}`;
  pintar();
}
function guardarCfg() { cfg = { dias: Math.min(90, Math.max(1, parseInt($("dias").value, 10) || 30)), notas: $("notas").checked }; chrome.storage.local.set({ rmConfig: cfg }); }
$("dias").onchange = guardarCfg; $("notas").onchange = guardarCfg;

function pintar() {
  const n = { respondio: 0, abrio: 0, sin_abrir: 0, baja: 0 }; for (const x of lista) n[x.estado]++;
  $("nResp").textContent = n.respondio; $("nAbrio").textContent = n.abrio; $("nSin").textContent = n.sin_abrir; $("nBaja").textContent = n.baja;
  document.querySelectorAll(".vistas button").forEach((b) => b.classList.toggle("on", b.dataset.v === vista));
  const ver = lista.filter((x) => vista === "todos" || x.estado === vista);
  $("lista").innerHTML = ver.length ? ver.slice(0, 300).map((x) => {
    const tag = x.estado === "respondio" ? "ok" : x.estado === "baja" ? "bad" : x.estado === "abrio" ? "wait" : "";
    const det = x.estado === "respondio" ? `Respondió el ${fecha(x.respondioT)}. Lee su respuesta en Lofty.` : x.estado === "abrio" ? `Lo abrió ${x.abiertos} vez/veces${x.clics ? ` y dio ${x.clics} clic(s)` : ""} · último ${fecha(x.ultimoT)}` : x.estado === "baja" ? "Se dio de baja de correos: Maili ya no le escribe." : `Sin abrir · hace ${x.dias} día(s)`;
    return `<li><div class="addr"><b>${esc(x.nombre || "(sin nombre)")}</b> <span class="tag ${tag}">${NOMBRES[x.estado]}</span>
      <small>${esc(x.correo || "")} · “${esc(x.asunto || "")}” · enviado ${fecha(x.enviadoT)}</small><small>${esc(det)}</small>
      <a class="hint" target="_blank" rel="noopener" href="https://crm.lofty.com/admin/home/detail?leadId=${encodeURIComponent(x.id)}">Abrir en Lofty</a></div></li>`;
  }).join("") : `<li class="empty">${lista.length ? "Nadie en este grupo." : "Todavía no hay nada que revisar: primero manda correos con Maili y luego dale “Revisar”."}</li>`;
}
document.querySelectorAll(".vistas button").forEach((b) => (b.onclick = () => { vista = b.dataset.v; pintar(); }));

async function revisar() {
  if (corriendo) return;
  corriendo = true; parar = false; $("run").disabled = true; guardarCfg();
  window.robot && robot.set("trabajando", "Revisando los correos de Maili…");
  try {
    const st = await chrome.storage.local.get(["mlEnviados", "emailBajas", "rmNotas"]);
    const env = st.mlEnviados || {}, bajas = { correos: {}, leads: {}, ...(st.emailBajas || {}) }, notas = st.rmNotas || {};
    const ids = Object.keys(env).filter((id) => Date.now() - env[id].t < cfg.dias * DIA).sort((a, b) => env[b].t - env[a].t);
    if (!ids.length) { lista = []; await chrome.storage.local.set({ rmLista: [], rmRes: { t: Date.now(), revisados: 0, respondieron: 0, abrieron: 0, bajas: 0 } }); pintar(); decir(`Maili no ha mandado correos en los últimos ${cfg.dias} días: no hay nada que revisar.`); window.robot && robot.set("idle", "Sin correos que revisar"); return; }
    const nueva = []; let fallas = 0, seguidas = 0, nuevasResp = 0, nuevasBajas = 0, notasPuestas = 0;
    const antes = Object.fromEntries(lista.map((x) => [x.id, x.estado]));
    for (let i = 0; i < ids.length && !parar; i++) {
      const id = ids[i]; ver(`Revisando ${i + 1} de ${ids.length}…`);
      try {
        const dl = await api(`/leads/${encodeURIComponent(id)}`), lead = dl.lead || dl.data || dl;
        const de = await api(`/communication/email?leadId=${encodeURIComponent(id)}&limit=100`);
        const correos = (de.emails || de.data || de.list || (Array.isArray(de) ? de : [])).map(M.deLofty).filter((e) => e.t);
        const x = { id, nombre: `${lead.firstName || ""} ${lead.lastName || ""}`.trim(), correo: env[id].correo || M.correoDe(lead), asunto: env[id].asunto || "", enviadoT: env[id].t,
          ...R.resumir({ enviado: env[id], correos, lead }) };
        nueva.push(x); seguidas = 0;
        if (x.estado === "respondio" && antes[id] !== "respondio") nuevasResp++;
        if (x.estado === "baja") { if (!bajas.leads[`${CUENTA}:${id}`]) nuevasBajas++; bajas.leads[`${CUENTA}:${id}`] = bajas.leads[`${CUENTA}:${id}`] || Date.now(); if (x.correo) bajas.correos[x.correo.toLowerCase()] = bajas.correos[x.correo.toLowerCase()] || Date.now(); }
        if (cfg.notas && R.merece(x) && notas[id] !== R.huella(x)) {
          try { await api("/notes", { method: "POST", body: { leadId: Number(id), content: R.nota(x) } }); notas[id] = R.huella(x); notasPuestas++; } catch (e) { window.svLog && svLog(`Remi: no pude dejar la nota del lead ${id}: ${e.message}`, "error"); }
        }
      } catch (e) {
        fallas++; seguidas++;
        const viejo = lista.find((x) => x.id === id); if (viejo) nueva.push(viejo);
        if (e.sinKey || e.status === 401 || e.status === 403 || seguidas >= 3) { decir(`Me detengo: ${e.message}`, "error"); window.robot && robot.set("error", "No pude leer Lofty"); parar = true; break; }
      }
      if (i < ids.length - 1) await sleep(400 + Math.random() * 800);
    }
    // los que no se alcanzaron a revisar conservan lo que ya se sabía
    const vistos = new Set(nueva.map((x) => x.id)); for (const x of lista) if (!vistos.has(x.id) && env[x.id]) nueva.push(x);
    lista = R.ordenar(nueva);
    const n = { respondio: 0, abrio: 0, sin_abrir: 0, baja: 0 }; for (const x of lista) n[x.estado]++;
    await chrome.storage.local.set({ rmLista: lista, emailBajas: bajas, rmNotas: notas, rmRes: { t: Date.now(), revisados: lista.length, respondieron: n.respondio, abrieron: n.abrio, bajas: n.baja } });
    pintar(); $("ultima").textContent = `Última revisión: ${fecha(Date.now())}`;
    if (seguidas >= 3 || (fallas && !nueva.length)) return;
    const txt = `${parar ? "Detenido" : "Listo"}: revisé ${lista.length} correo(s) de Maili — ${n.respondio} respondieron, ${n.abrio} abrieron, ${n.sin_abrir} sin abrir, ${n.baja} baja(s)` + (nuevasResp ? ` · ${nuevasResp} respuesta(s) NUEVA(S)` : "") + (notasPuestas ? ` · ${notasPuestas} nota(s) en Lofty` : "") + (fallas ? ` · ${fallas} no se pudieron leer` : "") + ".";
    decir(txt, nuevasResp ? "ok" : undefined);
    window.robot && robot.set(nuevasResp ? "ayuda" : "feliz", nuevasResp ? `${nuevasResp} lead(s) respondieron por correo: léelos en Lofty` : `${n.abrio} abrieron · ${n.respondio} respondieron`);
  } finally { corriendo = false; $("run").disabled = false; }
}
$("run").onclick = revisar;
$("stop").onclick = () => { parar = true; };
window.Tareas && Tareas.atender("revisar", async () => { await Tareas.esperarLibre(() => corriendo); await revisar(); return $("status").textContent.trim() || "Revisión terminada."; });
cargar();
