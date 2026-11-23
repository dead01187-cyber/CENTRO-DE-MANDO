// Punti (Fase 4): puntaje de leads con punti-core.js. Solo lee y sugiere.
const { h, llenar, etiqueta, numero, vacio } = VISTA;
const $ = (id) => document.getElementById(id);
const clave = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
let corriendo = false;
async function zonas() { // puntaje de cada ZIP según Termi (lo recalcula con lo que juntó Radar)
  try { const { filas = [] } = await TermiCalc.calificar(undefined, { guardar: false }); return Object.fromEntries(filas.map((f) => [f.zip, f.score])); } catch (e) { return {}; }
}
async function calificar() {
  if (corriendo) return; corriendo = true; $("run").disabled = true;
  window.robot && robot.set("trabajando", "Calificando leads…");
  try {
    const st = await chrome.storage.local.get(["lote", "lote_wb", "lote_hr", "lote_wb_hr", "addresses", "rsCasos", "rcCasos"]);
    const hecmPorDir = {}; // domicilio → datos HECM de Heri
    for (const a of Object.values(st.addresses || {})) if (a.origen === "hecm" && a.hecm) hecmPorDir[clave(a.street) + "|" + clave(a.city)] = a.hecm;
    const fuente = $("fuente").value, leads = [];
    if (fuente !== "resi") for (const [k, nombre] of [["lote", "Owny"], ["lote_wb", "Wibi"], ["lote_hr", "Owny 3"], ["lote_wb_hr", "Wibi 3"]]) for (const l of st[k] || []) {
      const [calle, ciudad] = String(l.address || "").split(",").map((x) => x.trim());
      leads.push({ ...l, origen: `por subir (${nombre})`, hecm: hecmPorDir[clave(calle) + "|" + clave(ciudad)] || null });
    }
    if (fuente !== "lotes") for (const c of [...Object.values(st.rsCasos || {}), ...Object.values(st.rcCasos || {})]) if (!["descartado", "limpiado"].includes(c.estado))
      leads.push({ owner: `${c.nombre || ""} ${c.apellido || ""}`.trim(), address: [c.calle, c.ciudad].filter(Boolean).join(", "), phones: (c.tels || []).map((n) => ({ num: n })), categoria: c.categoria, origen: "contestó SMS (Resi)" });
    const r = PUNTI.ordenar(leads, { zonas: await zonas(), vali: VALI });
    const n = (nv) => r.filter((x) => x.nivel === nv).length;
    llenar("nums", numero(r.length, "leads"), numero(n("alto"), "prioridad alta"), numero(n("medio"), "media"), numero(n("bajo"), "baja"));
    llenar("lista", r.length ? r.slice(0, 150).map((x) => h("li", {}, etiqueta(x.nivel, String(x.score)), h("div", { class: "q" }, h("b", { text: x.owner || "(sin nombre)" }), " · ", x.address || "",
      h("small", { text: `${x.origen} · ${x.razones.join(" · ")}` })))) : [vacio("No hay leads por calificar.")]);
    await chrome.storage.local.set({ puRes: { total: r.length, altos: n("alto"), top: r[0] ? { owner: r[0].owner, score: r[0].score } : null, t: Date.now() } });
    const txt = `Califiqué ${r.length} lead(s): ${n("alto")} de prioridad alta${r[0] ? `; el primero es ${r[0].owner || "(sin nombre)"} con ${r[0].score}` : ""}.`;
    $("status").textContent = txt; window.robot && robot.set("feliz", txt);
    return txt;
  } finally { corriendo = false; $("run").disabled = false; }
}
$("run").onclick = calificar; $("fuente").onchange = calificar;
window.Tareas && Tareas.atender("puntuar", async () => { await Tareas.esperarLibre(() => corriendo); return calificar(); });
calificar();
