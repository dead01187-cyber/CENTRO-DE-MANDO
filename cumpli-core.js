// =====================================================================
// Cumpli (Fase 4) — auditoría de cumplimiento. SOLO LEE. Revisa lo que ya
// pasó (registro de SMS) y la configuración actual contra las reglas:
//   · ningún SMS a un número/lead DESPUÉS de que pidió baja
//   · solo de 8:00 a 21:00 hora de California
//   · solo números de California
//   · no más del tope diario
//   · un mismo número no recibe más de un SMS por día
//   · ajustes riesgosos prendidos (subida automática, borrar números, SMS de Marki…)
// Cada hallazgo: { gravedad: "alta" | "media" | "baja", regla, detalle, cuando }
// =====================================================================
(function (g) {
  const LADAS_CA = new Set("209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951".split(" "));
  const d10 = (t) => { let d = String(t || "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d; };
  const fmt = (d) => (d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d);
  const diaCA = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(ms);
  function horaCA(ms) {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(ms);
    const v = (k) => Number((p.find((x) => x.type === k) || {}).value);
    return v("hour") + v("minute") / 60;
  }
  const cuando = (ms) => new Date(ms).toLocaleString("es-MX", { timeZone: "America/Los_Angeles", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  // st = { smsRegistro, smsBajas, smsPolitica, loftyAuto, alCfg, txKey, tareas }
  function auditar(st, { dias = 30, ahora = Date.now() } = {}) {
    const h = [];
    const add = (gravedad, regla, detalle, t) => h.push({ gravedad, regla, detalle, cuando: t ? cuando(t) : "", t: t || 0 });
    const pol = { desde: 8, hasta: 21, tope: 0, ...(st.smsPolitica || {}) };
    const bajas = st.smsBajas || { tels: {}, leads: {} };
    const enviados = (st.smsRegistro || []).filter((e) => e.estado === "enviado" && e.t >= ahora - dias * 864e5);
    const porDiaTel = new Map(), porDia = new Map();
    for (const e of enviados) {
      const d = d10(e.tel), quien = `${e.fuente || "?"} → ${fmt(d)}`;
      const bt = bajas.tels && bajas.tels[d];
      const bl = e.leadId != null && bajas.leads && (bajas.leads[`tx:${e.leadId}`] || bajas.leads[`t2:${e.leadId}`] || bajas.leads[`al:${e.leadId}`] || bajas.leads[`lofty:${e.leadId}`]);
      const b = [bt, bl].filter((x) => x && x.t && x.t < e.t).sort((a, c) => a.t - c.t)[0];
      if (b) add("alta", "SMS a una baja", `${quien}: se mandó después de la baja (${b.motivo}, ${cuando(b.t)})`, e.t);
      const hr = horaCA(e.t);
      if (hr < 8 || hr >= 21) add("alta", "Fuera de horario", `${quien}: ${cuando(e.t)} (permitido de 8:00 a 21:00 hora de California)`, e.t);
      if (d.length === 10 && !LADAS_CA.has(d.slice(0, 3))) add("media", "Número fuera de California", `${quien}`, e.t);
      const k = diaCA(e.t) + "|" + d; porDiaTel.set(k, (porDiaTel.get(k) || 0) + 1);
      porDia.set(diaCA(e.t), (porDia.get(diaCA(e.t)) || 0) + 1);
    }
    for (const [k, n] of porDiaTel) if (n > 1) { const [dia, d] = k.split("|"); add("media", "Varios SMS el mismo día", `${fmt(d)} recibió ${n} SMS el ${dia}`); }
    for (const [dia, n] of porDia) if (pol.tope > 0 && n > pol.tope) add("alta", "Se pasó el tope diario", `${dia}: ${n} SMS (tope ${pol.tope})`);
    // Ajustes actuales
    if (st.loftyAuto === true) add("baja", "Subida automática a Lofty prendida", "Lofti crea leads sin pedir OK; revisa que sea lo que quieres.");
    const al = st.alCfg || {};
    if (al.deleteNonCA) add("media", "Marki borra números", "“Borrar del lead los números que no son de California” está prendido en Marki.");
    if (al.doSms && !al.caOnly) add("media", "Marki: SMS a cualquier lada", "Marki tiene SMS prendido y “Solo números de California” apagado (la política de SMS igual los bloquea).");
    if (pol.sinHorario === true) add("alta", "Horario de SMS APAGADO", "El jefe apagó el horario 8:00–21:00 (botón 'Horario SMS' del Centro de Mando): los robots pueden mandar SMS de noche. Riesgo legal (TCPA).");
    if (pol.desde < 8 || pol.hasta > 21) add("alta", "Horario de SMS fuera de 8–21", `La política dice ${pol.desde}–${pol.hasta} (politica-sms.js lo limita a 8–21).`);
    if (pol.tope > 500) add("baja", "Tope diario alto", `El tope de SMS es ${pol.tope} al día.`);
    const vivas = Object.values(st.tareas || {}).filter((t) => t.estado === "aprobacion");
    if (vivas.length) add("baja", "Tareas esperando tu aprobación", vivas.map((t) => `${t.robot}:${t.accion}`).join(", "));
    const orden = { alta: 0, media: 1, baja: 2 };
    h.sort((a, b) => orden[a.gravedad] - orden[b.gravedad] || b.t - a.t);
    return {
      hallazgos: h,
      resumen: { smsRevisados: enviados.length, dias, bajasPorNumero: Object.keys(bajas.tels || {}).length, bajasPorLead: Object.keys(bajas.leads || {}).length,
        altas: h.filter((x) => x.gravedad === "alta").length, medias: h.filter((x) => x.gravedad === "media").length, leves: h.filter((x) => x.gravedad === "baja").length },
    };
  }

  g.CUMPLI = { auditar, horaCA, diaCA };
  if (typeof module !== "undefined") module.exports = g.CUMPLI;
})(globalThis);
