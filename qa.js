// Qai (Fase 4): QA del sistema con qa-core.js. Solo lee.
const { h, llenar, etiqueta, numero } = VISTA;
const $ = (id) => document.getElementById(id);
let corriendo = false;
async function revisar() {
  if (corriendo) return; corriendo = true; $("run").disabled = true;
  window.robot && robot.set("trabajando", "Revisando la salud del sistema…");
  try {
    const [st, bytes] = await Promise.all([chrome.storage.local.get(null), chrome.storage.local.getBytesInUse(null)]);
    const r = QA.chequeos(st, { bytes, registro: window.REGISTRO });
    llenar("nums", numero(r.resumen.ok, "bien"), numero(r.resumen.avisos, "avisos"), numero(r.resumen.fallas, "fallas"));
    const orden = { falla: 0, aviso: 1, ok: 2 };
    llenar("lista", [...r.chequeos].sort((a, b) => orden[a.estado] - orden[b.estado]).map((c) => h("li", {}, etiqueta(c.estado, c.estado === "ok" ? "bien" : c.estado), h("div", { class: "q" }, h("b", { text: c.nombre }), h("small", { text: c.detalle })))));
    await chrome.storage.local.set({ qaRes: { ...r.resumen, t: Date.now() } });
    const txt = r.resumen.fallas ? `${r.resumen.fallas} falla(s) y ${r.resumen.avisos} aviso(s): ${r.chequeos.filter((c) => c.estado === "falla").map((c) => c.nombre).join(", ")}.` : `Todo bien${r.resumen.avisos ? ` (${r.resumen.avisos} aviso(s))` : ""}.`;
    $("status").textContent = txt;
    window.robot && robot.set(r.resumen.fallas ? "error" : r.resumen.avisos ? "ayuda" : "feliz", txt);
    return txt;
  } finally { corriendo = false; $("run").disabled = false; }
}
$("run").onclick = revisar;
window.Tareas && Tareas.atender("revisar", async () => { await Tareas.esperarLibre(() => corriendo); return revisar(); });
revisar();
setInterval(() => { if (!corriendo) revisar().catch(() => {}); }, 30 * 60e3); // cada 30 min mientras el Mando esté abierto
