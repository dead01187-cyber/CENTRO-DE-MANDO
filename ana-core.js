// =====================================================================
// Ana (Fase 4) — analítica. SOLO LEE y calcula números con lo que ya guarda
// la extensión. Base del tablero de la Fase 5.
//   · SMS por día y por robot (registro de la política de SMS)
//   · respuestas: tasa de respuesta, interesados, bajas (Resi)
//   · tareas del bus por estado
//   · errores por robot (bitácora)
//   · uso de Claude de hoy
// =====================================================================
(function (g) {
  const diaCA = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(ms);
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 0);

  function metricas(st, { dias = 14, ahora = Date.now() } = {}) {
    const desde = ahora - dias * 864e5;
    // SMS
    const reg = (st.smsRegistro || []).filter((e) => e.t >= desde);
    const env = reg.filter((e) => e.estado === "enviado"), bloq = reg.filter((e) => e.estado === "bloqueado"), err = reg.filter((e) => e.estado === "error");
    const smsPorDia = {};
    for (let i = dias - 1; i >= 0; i--) smsPorDia[diaCA(ahora - i * 864e5)] = 0;
    for (const e of env) { const d = diaCA(e.t); if (d in smsPorDia) smsPorDia[d]++; }
    const smsPorRobot = {}; for (const e of env) smsPorRobot[e.fuente || "?"] = (smsPorRobot[e.fuente || "?"] || 0) + 1;
    const motivosBloqueo = {}; for (const e of bloq) { const m = String(e.motivo || "?").replace(/\(.*\)/, "").trim().slice(0, 60); motivosBloqueo[m] = (motivosBloqueo[m] || 0) + 1; }
    // Respuestas (Resi): leads a los que se les mandó vs. los que contestaron
    const casos = Object.values(st.rsCasos || {});
    const mandados = Object.keys(st.txEnviados || {}).length;
    const contestaron = casos.filter((c) => (c.conv || []).some((m) => m.dir === "in")).length;
    const porCategoria = {}; for (const c of casos) porCategoria[c.categoria || "otro"] = (porCategoria[c.categoria || "otro"] || 0) + 1;
    // Tareas
    const tareas = Object.values(st.tareas || {});
    const tareasPorEstado = {}; for (const t of tareas) tareasPorEstado[t.estado] = (tareasPorEstado[t.estado] || 0) + 1;
    const duraciones = tareas.filter((t) => t.estado === "hecha" && t.inicio && t.fin).map((t) => t.fin - t.inicio);
    // Errores por robot (bitácora: últimos 150 eventos)
    const errores = {}; for (const e of st.svEventos || []) if (e.nivel === "error") errores[e.mod] = (errores[e.mod] || 0) + 1;
    // Uso de Claude
    const uso = st.llmUso && st.llmUso.dia === diaCA(ahora) ? st.llmUso.por || {} : {};
    return {
      periodo: { dias, desde: diaCA(desde), hasta: diaCA(ahora) },
      sms: { enviados: env.length, bloqueados: bloq.length, conError: err.length, porDia: smsPorDia, porRobot: smsPorRobot, motivosBloqueo },
      respuestas: { leadsConSms: mandados, contestaron, tasaRespuesta: pct(contestaron, mandados), interesados: porCategoria.interesado || 0,
        tasaInteres: pct(porCategoria.interesado || 0, contestaron), bajas: (porCategoria.baja || 0) + (porCategoria.enojado || 0) + (porCategoria.equivocado || 0), porCategoria },
      leads: { subidosALofty: st.loftySubidos || 0, listosParaSubir: st.loftyListos || 0, domicilios: Object.keys(st.addresses || {}).length, bajasPermanentes: Object.keys((st.smsBajas || {}).tels || {}).length },
      tareas: { total: tareas.length, porEstado: tareasPorEstado, duracionPromedioSeg: duraciones.length ? Math.round(duraciones.reduce((a, b) => a + b, 0) / duraciones.length / 1000) : 0 },
      errores,
      claude: uso,
    };
  }

  g.ANA = { metricas };
  if (typeof module !== "undefined") module.exports = g.ANA;
})(globalThis);
