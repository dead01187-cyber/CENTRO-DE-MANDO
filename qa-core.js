// =====================================================================
// Qai (Fase 4) — QA del sistema. SOLO LEE. Revisa la salud de la extensión:
// almacenamiento, tareas atoradas, registro de robots, llaves (solo si
// existen, nunca su valor), política de SMS, errores recientes y robots apagados.
// Cada chequeo: { estado: "ok" | "aviso" | "falla", nombre, detalle }
// =====================================================================
(function (g) {
  const CUOTA = 100 * 1024 * 1024; // con "unlimitedStorage" ya no hay tope de 10 MB; arriba de 100 MB la extensión se pone lenta

  // st = toda la storage (chrome.storage.local.get(null)); bytes = getBytesInUse(null); registro = REGISTRO
  function chequeos(st, { bytes = 0, registro = null, ahora = Date.now() } = {}) {
    const c = [];
    const add = (estado, nombre, detalle) => c.push({ estado, nombre, detalle });
    // 1) Almacenamiento
    const pct = Math.round((bytes / CUOTA) * 100);
    add(pct >= 85 ? "falla" : pct >= 60 ? "aviso" : "ok", "Almacenamiento", `${(bytes / 1048576).toFixed(1)} MB (${pct}% de los 100 MB recomendados)${pct >= 60 ? ". Conviene limpiar listas viejas: con tanta memoria la extensión se pone lenta." : ""}`);
    const grandes = Object.entries(st).map(([k, v]) => [k, JSON.stringify(v === undefined ? null : v).length]).sort((a, b) => b[1] - a[1]).slice(0, 5);
    add("ok", "Lo que más ocupa", grandes.map(([k, n]) => `${k} ${(n / 1024).toFixed(0)} KB`).join(" · "));
    // 2) Bus de tareas
    const ts = Object.values(st.tareas || {});
    const atoradas = ts.filter((t) => t.estado === "corriendo" && ahora - (t.latido || t.inicio || 0) > 5 * 60e3);
    const fallidas = ts.filter((t) => t.estado === "fallida" && ahora - t.actualizada < 24 * 3600e3);
    const enFila = ts.filter((t) => t.estado === "pendiente" && ahora - t.creada > 60 * 60e3);
    add(atoradas.length ? "falla" : "ok", "Tareas atoradas", atoradas.length ? atoradas.map((t) => `${t.robot}:${t.accion}`).join(", ") : "ninguna");
    add(fallidas.length ? "aviso" : "ok", "Tareas fallidas (24 h)", fallidas.length ? fallidas.map((t) => `${t.robot}:${t.accion} (${t.error || "?"})`).join("; ") : "ninguna");
    add(enFila.length ? "aviso" : "ok", "Tareas en fila hace más de 1 h", enFila.length ? enFila.map((t) => `${t.robot}:${t.accion} — ¿su página está cerrada o el agente apagado?`).join("; ") : "ninguna");
    // 3) Registro de robots
    if (registro) {
      const malos = Object.entries(registro.ROBOTS).filter(([, r]) => !registro.SUPERVISORES[r.supervisor] || !r.pagina).map(([id]) => id);
      add(malos.length ? "falla" : "ok", "Registro de agentes", malos.length ? `sin supervisor o página: ${malos.join(", ")}` : `${Object.keys(registro.ROBOTS).length} agentes, todos con supervisor y página`);
    }
    // 4) Llaves (solo si existen)
    const llaves = { "Lofty (Chequi, Lofti, Acti…)": st.loftyKey, "Lofty de Texi/Resi": st.txKey, "Anthropic (Capi)": st.svKey };
    const faltan = Object.entries(llaves).filter(([, v]) => !v).map(([k]) => k);
    add(faltan.length ? "aviso" : "ok", "API keys", faltan.length ? `faltan: ${faltan.join(", ")}` : "las 3 principales están puestas");
    // 5) Política de SMS
    const pol = { desde: 8, hasta: 21, tope: 0, ...(st.smsPolitica || {}) };
    if (pol.sinHorario === true) add("aviso", "Horario de SMS", "APAGADO por el jefe: se puede mandar a cualquier hora (riesgo legal TCPA)");
    add(pol.desde < 8 || pol.hasta > 21 ? "falla" : "ok", "Política de SMS", `de ${pol.desde}:00 a ${pol.hasta}:00 (California), ${pol.tope > 0 ? `tope ${pol.tope}/día` : "sin tope diario"}; ${Object.keys((st.smsBajas || {}).tels || {}).length} números con baja permanente`);
    // 6) Errores recientes por robot
    const errs = (st.svEventos || []).filter((e) => e.nivel === "error" && ahora - e.t < 3600e3);
    const porRobot = {}; for (const e of errs) porRobot[e.mod] = (porRobot[e.mod] || 0) + 1;
    const nombre = (m) => (registro && registro.nombre ? registro.nombre(m) : m);
    add(errs.length >= 10 ? "falla" : errs.length ? "aviso" : "ok", "Errores en la última hora", errs.length ? Object.entries(porRobot).map(([m, n]) => `${nombre(m)} ${n}`).join(", ") : "ninguno");
    const codigo = errs.filter((e) => /Error de código/.test(e.texto));
    if (codigo.length) add("falla", "Errores de código", codigo.slice(-3).map((e) => `${nombre(e.mod)}: ${e.texto.slice(0, 120)}`).join(" · "));
    // 7) Robots apagados
    const ap = Object.keys(st.robotsApagados || {}).filter((k) => st.robotsApagados[k]);
    add("ok", "Agentes apagados", ap.length ? ap.map(nombre).join(", ") : "ninguno");
    // 8) Crecimiento sin tope conocido
    const n = (k) => Object.keys(st[k] || {}).length;
    const crecen = [["addresses", n("addresses"), 20000], ["prCasos", n("prCasos"), 3000], ["hrCasos", n("hrCasos"), 3000], ["hrVistos", n("hrVistos"), 5000], ["lote", (st.lote || []).length, 2000]].filter(([, v, max]) => v > max);
    add(crecen.length ? "aviso" : "ok", "Listas muy grandes", crecen.length ? crecen.map(([k, v]) => `${k}: ${v}`).join(", ") : "dentro de lo normal");
    // 9) Presupuesto de Claude
    const uso = st.llmUso && st.llmUso.por ? Object.entries(st.llmUso.por) : [];
    add("ok", "Uso de Claude hoy", uso.length ? uso.map(([k, u]) => `${k} ${u.llamadas || 0} llamadas`).join(", ") : "sin llamadas registradas hoy");
    const resumen = { ok: c.filter((x) => x.estado === "ok").length, avisos: c.filter((x) => x.estado === "aviso").length, fallas: c.filter((x) => x.estado === "falla").length };
    return { chequeos: c, resumen };
  }

  g.QA = { chequeos, CUOTA };
  if (typeof module !== "undefined") module.exports = g.QA;
})(globalThis);
