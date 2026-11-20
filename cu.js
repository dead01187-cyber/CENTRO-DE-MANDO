// Cumpli (Fase 4): auditoría de cumplimiento con cumpli-core.js. Solo lee.
const { h, llenar, etiqueta, numero, vacio } = VISTA;
const $ = (id) => document.getElementById(id);
let corriendo = false;
async function auditar() {
  if (corriendo) return; corriendo = true; $("run").disabled = true;
  window.robot && robot.set("trabajando", "Auditando los SMS y los ajustes…");
  try {
    const st = await chrome.storage.local.get(["smsRegistro", "smsBajas", "smsPolitica", "loftyAuto", "alCfg", "tareas"]);
    const r = CUMPLI.auditar(st, { dias: Number($("dias").value) || 30 });
    const s = r.resumen;
    llenar("nums", numero(s.smsRevisados, "SMS revisados"), numero(s.altas, "graves"), numero(s.medias, "medios"), numero(s.leves, "leves"), numero(s.bajasPorNumero, "números con baja"));
    llenar("lista", r.hallazgos.length ? r.hallazgos.map((x) => h("li", {}, etiqueta(x.gravedad, x.gravedad), h("div", { class: "q" }, h("b", { text: x.regla }), h("small", { text: [x.detalle, x.cuando].filter(Boolean).join(" · ") })))) : [vacio("Sin hallazgos. ✔")]);
    const { cuRes: antes = {} } = await chrome.storage.local.get("cuRes");
    await chrome.storage.local.set({ cuRes: { altas: s.altas, medias: s.medias, leves: s.leves, t: Date.now() } });
    const txt = s.altas || s.medias ? `Encontré ${s.altas} hallazgo(s) grave(s) y ${s.medias} medio(s) en ${s.smsRevisados} SMS de ${s.dias} días.` : `Sin problemas en ${s.smsRevisados} SMS de ${s.dias} días.`;
    $("status").textContent = txt;
    window.robot && robot.set(s.altas ? "error" : s.medias ? "ayuda" : "feliz", txt);
    if (s.altas > (antes.altas || 0)) window.svLog && svLog(`Cumpli: ${txt}`, "error"); // solo avisa a Capi si hay hallazgos graves NUEVOS
    return txt;
  } finally { corriendo = false; $("run").disabled = false; }
}
$("run").onclick = auditar; $("dias").onchange = auditar;
window.Tareas && Tareas.atender("auditar", async () => { await Tareas.esperarLibre(() => corriendo); return auditar(); });
auditar();
