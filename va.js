// Vali (Fase 4): revisa los lotes listos para Lofti con vali-core.js. Solo lee.
const { h, llenar, etiqueta, numero, vacio } = VISTA;
const $ = (id) => document.getElementById(id);
const LOTES = ["lote", "lote_wb", "lote_hr", "lote_wb_hr", "lote_ac"];
let corriendo = false;
async function revisar() {
  if (corriendo) return; corriendo = true; $("run").disabled = true;
  window.robot && robot.set("trabajando", "Revisando teléfonos y datos…");
  try {
    const st = await chrome.storage.local.get(LOTES);
    const r = VALI.lote(st[$("lote").value] || []);
    const s = r.resumen;
    llenar("nums", numero(s.leads, "leads"), numero(s.ok, "bien"), numero(s.dudosos, "revisar"), numero(s.malos, "no sirven"), numero(s.telefonosMalos, "teléfonos falsos"), numero(s.compartidos, "números repetidos"));
    const malos = r.filas.filter((f) => f.nivel !== "ok");
    llenar("lista", malos.length ? malos.map((f) => h("li", {}, etiqueta(f.nivel, f.nivel === "malo" ? "no sirve" : "revisar"),
      h("div", { class: "q" }, h("b", { text: f.owner || "(sin nombre)" }), " · ", f.address || "(sin domicilio)",
        h("small", { text: [...f.problemas, ...f.telefonos.filter((t) => t.nivel !== "ok").map((t) => `${t.num}: ${t.problemas.join(", ")}`)].join(" · ") })))) : [vacio("Todo bien en este lote.")]);
    // Resumen de TODOS los lotes para el Centro de Mando y Capi
    const total = LOTES.map((k) => VALI.lote(st[k] || []).resumen).reduce((a, x) => ({ leads: a.leads + x.leads, malos: a.malos + x.malos, dudosos: a.dudosos + x.dudosos, telefonosMalos: a.telefonosMalos + x.telefonosMalos }), { leads: 0, malos: 0, dudosos: 0, telefonosMalos: 0 });
    await chrome.storage.local.set({ vaRes: { ...total, t: Date.now() } });
    const txt = `Revisé ${s.leads} lead(s): ${s.ok} bien, ${s.dudosos} por revisar, ${s.malos} que no sirven; ${s.telefonosMalos} teléfono(s) falsos.`;
    $("status").textContent = txt; window.robot && robot.set(s.malos ? "ayuda" : "feliz", txt);
    return txt;
  } finally { corriendo = false; $("run").disabled = false; }
}
$("run").onclick = revisar;
$("lote").onchange = revisar;
window.Tareas && Tareas.atender("revisar", async () => { await Tareas.esperarLibre(() => corriendo); return revisar(); });
revisar();
