// Ana (Fase 4): analítica con ana-core.js. Solo lee.
const { h, llenar, numero } = VISTA;
const $ = (id) => document.getElementById(id);
let corriendo = false;
const filas = (obj, fmt = (v) => v) => Object.entries(obj || {}).sort((a, b) => (b[1] > a[1] ? 1 : -1)).map(([k, v]) => `${REGISTRO.nombre(k) || k}: ${fmt(v)}`).join(" · ") || "—";
async function calcular() {
  if (corriendo) return; corriendo = true; $("run").disabled = true;
  try {
    const st = await chrome.storage.local.get(["smsRegistro", "rsCasos", "rcCasos", "txEnviados", "tareas", "svEventos", "llmUso", "loftySubidos", "loftyListos", "addresses", "smsBajas"]);
    const m = ANA.metricas(st, { dias: Number($("dias").value) || 14 });
    llenar("nums", numero(m.sms.enviados, "SMS enviados"), numero(m.sms.bloqueados, "SMS bloqueados"), numero(m.respuestas.tasaRespuesta + "%", "contestaron"), numero(m.respuestas.interesados, "interesados"), numero(m.leads.subidosALofty, "subidos a Lofty"), numero(m.tareas.total, "tareas del bus"));
    const max = Math.max(1, ...Object.values(m.sms.porDia));
    llenar("porDia", h("tr", {}, h("th", { text: "Día" }), h("th", { text: "SMS" }), h("th", { text: "" })),
      Object.entries(m.sms.porDia).map(([d, n]) => h("tr", {}, h("td", { text: d }), h("td", { text: String(n) }), h("td", {}, h("div", { class: "barra", style: `width:${Math.round((100 * n) / max)}%` })))));
    const det = [
      ["SMS por agente", filas(m.sms.porRobot)], ["Por qué se bloquearon SMS", filas(m.sms.motivosBloqueo)],
      ["Respuestas por tipo (Resi)", filas(m.respuestas.porCategoria)], ["Interés entre los que contestaron", m.respuestas.tasaInteres + "%"],
      ["Bajas / enojados / equivocados", String(m.respuestas.bajas)], ["Números con baja permanente", String(m.leads.bajasPermanentes)],
      ["Leads listos para subir", String(m.leads.listosParaSubir)], ["Domicilios guardados", String(m.leads.domicilios)],
      ["Tareas por estado", filas(m.tareas.porEstado)], ["Duración promedio de una tarea", m.tareas.duracionPromedioSeg + " s"],
      ["Errores por agente (bitácora)", filas(m.errores)], ["Claude hoy (llamadas)", filas(m.claude, (u) => `${u.llamadas || 0}`)],
    ];
    llenar("detalle", det.map(([k, v]) => h("tr", {}, h("th", { text: k }), h("td", { text: v }))));
    await chrome.storage.local.set({ anRes: { sms: m.sms.enviados, respuesta: m.respuestas.tasaRespuesta, interesados: m.respuestas.interesados, t: Date.now() } });
    const txt = `${m.periodo.dias} días: ${m.sms.enviados} SMS enviados (${m.sms.bloqueados} bloqueados), ${m.respuestas.tasaRespuesta}% contestó, ${m.respuestas.interesados} interesado(s), ${m.leads.subidosALofty} leads subidos a Lofty en total.`;
    $("status").textContent = txt; window.robot && robot.set("idle", txt);
    return txt;
  } finally { corriendo = false; $("run").disabled = false; }
}
$("run").onclick = calcular; $("dias").onchange = calcular;
window.Tareas && Tareas.atender("calcular", async () => { await Tareas.esperarLibre(() => corriendo); return calcular(); });
calcular();
