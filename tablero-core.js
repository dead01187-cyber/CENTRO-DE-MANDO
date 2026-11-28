// =====================================================================
// Tablero (Fase 5) — núcleo. Junta en un solo objeto todo lo que muestra el
// tablero, leyendo SOLO chrome.storage (bus de tareas, registro de SMS,
// bitácora, uso de Claude, resultados de Cumpli/Qai/Ana y el estado que cada
// robot guarda). Nunca lee las páginas de los robots (el DOM).
// Costos: se muestran tokens. Dólares SOLO si el jefe guardó sus precios en
// "llmPrecios" = { entrada: <US$ por millón de tokens>, salida: <US$ por millón> }.
// =====================================================================
(function (g) {
  const VIVAS = ["aprobacion", "pendiente", "corriendo"];
  const H24 = 24 * 3600e3;
  const diaCA = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(ms);

  function construir(st, registro, { ahora = Date.now() } = {}) {
    const R = registro.ROBOTS, ids = registro.ids();
    const apagados = st.robotsApagados || {};
    const tareas = Object.values(st.tareas || {});
    const eventos = st.svEventos || [];
    const errores24 = eventos.filter((e) => e.nivel === "error" && ahora - e.t < H24);

    // ---- Robots ----
    const robots = ids.map((id) => {
      const est = st["rbEstado_" + id] || null;
      const vivo = est && ahora - est.t < 10 * 60e3;
      const ts = tareas.filter((t) => t.robot === id);
      const hechas = ts.filter((t) => t.estado === "hecha"), fallidas = ts.filter((t) => t.estado === "fallida");
      const dur = hechas.filter((t) => t.inicio && t.fin).map((t) => t.fin - t.inicio);
      let estado = apagados[id] ? "apagado" : !est ? "sin datos" : est.estado;
      if (estado === "trabajando" && !vivo) estado = "sin señal"; // dijo "trabajando" pero lleva 10 min sin moverse
      return {
        id, nombre: R[id].nombre, supervisor: R[id].supervisor, permisos: R[id].permisos || [], estado, texto: (est && est.texto) || "", hace: est ? ahora - est.t : null,
        errores24: errores24.filter((e) => e.mod === id).length, tareasVivas: ts.filter((t) => VIVAS.includes(t.estado)).length,
        tareasHechas: hechas.length, tareasFallidas: fallidas.length, exito: hechas.length + fallidas.length ? Math.round((100 * hechas.length) / (hechas.length + fallidas.length)) : null,
        duracionSeg: dur.length ? Math.round(dur.reduce((a, b) => a + b, 0) / dur.length / 1000) : null,
      };
    });

    // ---- Costos (Claude de hoy) ----
    const uso = st.llmUso && st.llmUso.dia === diaCA(ahora) ? st.llmUso.por || {} : {};
    const topes = st.llmTopes || {};
    const DEF = (g.PRESUPUESTO && g.PRESUPUESTO.DEF) || {};
    const precio = st.llmPrecios && Number(st.llmPrecios.entrada) >= 0 && Number(st.llmPrecios.salida) >= 0 ? st.llmPrecios : null;
    const dolares = (u) => (precio ? Math.round(((u.entrada * precio.entrada + u.salida * precio.salida) / 1e6) * 100) / 100 : null);
    const quienes = [...new Set([...Object.keys(DEF), ...Object.keys(uso)])];
    const costos = quienes.map((q) => {
      const u = uso[q] || { entrada: 0, salida: 0, llamadas: 0 };
      const tp = { ...(DEF[q] || DEF.robots || { entrada: 0, salida: 0 }), ...(topes[q] || {}) };
      const pct = tp.entrada ? Math.round(100 * Math.max(u.entrada / tp.entrada, tp.salida ? u.salida / tp.salida : 0)) : 0;
      return { quien: q, llamadas: u.llamadas || 0, entrada: u.entrada || 0, salida: u.salida || 0, porciento: pct, dolares: dolares(u) };
    });
    const totalTok = costos.reduce((a, c) => ({ entrada: a.entrada + c.entrada, salida: a.salida + c.salida, llamadas: a.llamadas + c.llamadas }), { entrada: 0, salida: 0, llamadas: 0 });

    // ---- Supervisores ----
    const supervisores = ["GEO", "CRM", "GROW", "OPS"].map((s) => {
      const mios = robots.filter((r) => r.supervisor === s);
      const c = costos.find((x) => x.quien === s) || { porciento: 0, llamadas: 0 };
      return { id: s, rol: registro.SUPERVISORES[s].rol, robots: mios.length, trabajando: mios.filter((r) => r.estado === "trabajando").length,
        conProblema: mios.filter((r) => ["error", "ayuda", "sin señal"].includes(r.estado)).length, apagados: mios.filter((r) => r.estado === "apagado").length,
        errores24: mios.reduce((a, r) => a + r.errores24, 0), tareasVivas: mios.reduce((a, r) => a + r.tareasVivas, 0), presupuesto: c.porciento, llamadas: c.llamadas };
    });

    // ---- Tareas ----
    const porEstado = {}; for (const t of tareas) porEstado[t.estado] = (porEstado[t.estado] || 0) + 1;
    const tareasLista = tareas.sort((a, b) => (VIVAS.includes(b.estado) - VIVAS.includes(a.estado)) || b.actualizada - a.actualizada).slice(0, 40)
      .map((t) => ({ id: t.id, robot: t.robot, nombre: (R[t.robot] || {}).nombre || t.robot, accion: t.accion, estado: t.estado, origen: t.origen, resultado: t.resultado || "", error: t.error || "", hace: ahora - t.actualizada, viva: VIVAS.includes(t.estado) }));

    // ---- Leads y SMS ----
    const sms = (st.smsRegistro || []).filter((e) => diaCA(e.t) === diaCA(ahora));
    const casos = [...Object.values(st.rsCasos || {}), ...Object.values(st.rcCasos || {})]; // Resi (Texi) + Resi 2 (Compri)
    const leads = {
      domicilios: Object.keys(st.addresses || {}).length, listosParaSubir: st.loftyListos || 0, subidosTotal: st.loftySubidos || 0,
      enLotes: ["lote", "lote_wb", "lote_hr", "lote_wb_hr", "lote_ac"].reduce((a, k) => a + (st[k] || []).length, 0),
      smsHoy: sms.filter((e) => e.estado === "enviado").length, smsBloqueadosHoy: sms.filter((e) => e.estado === "bloqueado").length,
      porAtender: casos.filter((c) => ["abierto", "atender"].includes(c.estado)).length, interesados: casos.filter((c) => c.categoria === "interesado" && !["descartado", "limpiado"].includes(c.estado)).length,
      zbRepetidos: Object.values(st.zbLeads || {}).filter((l) => l.estado === "repetido").length,
      vali: st.vaRes || null, punti: st.puRes || null,
    };

    // ---- Errores ----
    const errores = { ultimas24h: errores24.length, porRobot: Object.entries(errores24.reduce((m, e) => ((m[e.mod] = (m[e.mod] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, nombre: (R[id] || {}).nombre || id, n })),
      recientes: errores24.slice(-8).reverse().map((e) => ({ nombre: (R[e.mod] || {}).nombre || e.mod, texto: e.texto, hace: ahora - e.t })), bitacoraLimite: eventos.length >= 150 };

    // ---- Seguridad y cumplimiento ----
    const conPermiso = (p) => robots.filter((r) => r.permisos.includes(p)).map((r) => r.nombre);
    const seguridad = {
      cumpli: st.cuRes || null, qai: st.qaRes || null,
      aprobacionesPendientes: tareas.filter((t) => t.estado === "aprobacion").length,
      bajasPermanentes: Object.keys((st.smsBajas || {}).tels || {}).length,
      politicaSms: { desde: 8, hasta: 21, tope: 0, ...(st.smsPolitica || {}) },
      subidaAutomatica: st.loftyAuto === true, markiBorraNumeros: !!(st.alCfg || {}).deleteNonCA,
      escribenCrm: conPermiso("escribe_crm"), mandanSms: conPermiso("envia_sms"), mandanCorreo: conPermiso("envia_correo"), gastan: conPermiso("gasta"), publican: conPermiso("publica"),
    };

    // ---- Misión ----
    const m = st.mision;
    const mision = m && ["corriendo", "esperando_ok", "pausada"].includes(m.estado) ? { zona: m.zona, meta: m.meta, estado: m.estado, fase: m.fase, listos: (st.loftyListos || 0) + Math.max(0, (st.loftySubidos || 0) - (m.subidosBase || 0)), desde: ahora - (m.inicio || ahora) } : null;

    // ---- Semáforo general ----
    const rojo = (seguridad.cumpli && seguridad.cumpli.altas) || (seguridad.qai && seguridad.qai.fallas) || robots.some((r) => r.estado === "error");
    const amarillo = seguridad.aprobacionesPendientes || errores.ultimas24h || robots.some((r) => ["ayuda", "sin señal"].includes(r.estado)) || costos.some((c) => c.porciento >= 80);
    return { generado: ahora, semaforo: rojo ? "rojo" : amarillo ? "amarillo" : "verde", robots, supervisores, mision, tareas: { porEstado, lista: tareasLista }, leads, errores,
      costos: { porQuien: costos, total: { ...totalTok, dolares: precio ? Math.round(costos.reduce((a, c) => a + (c.dolares || 0), 0) * 100) / 100 : null }, conPrecios: !!precio }, seguridad };
  }

  // ---- Fase 6: lanzamiento gradual por etapas (según los permisos del registro) ----
  const NIVEL = { lee_web: 1, lee_crm: 1, lee_correo: 1, escribe_correo: 2, escribe_crm: 2, borra: 2, gasta: 3, envia_sms: 4, envia_correo: 4, publica: 4 };
  const ETAPAS = [
    { n: 1, nombre: "Solo lectura", desc: "Agentes que solo leen: zonas (Radar, Termi), Propwire (Propi), Lofty (Chequi), Gmail (Zeta), reportes ya abiertos (Owny), Wibi sin cobrar y los de calidad. No cambian nada en ningún sistema." },
    { n: 2, nombre: "Escriben con tu control", desc: "Además: crean o cambian leads en Lofty (Lofti, Acti, Limpi), borradores en Gmail (Redi) y limpieza de archivos (Carpi)." },
    { n: 3, nombre: "Gastan créditos", desc: "Además: BeenVerified, skip trace de Propwire, Properant y Heri (consultas con tope o con costo)." },
    { n: 4, nombre: "Contacto", desc: "Además: SMS (Texi, Resi, Marki; siempre con la política de SMS y tu OK) y publicar en Teams (Timi)." },
  ];
  const etapaDe = (permisos = []) => Math.max(1, ...permisos.map((p) => NIVEL[p] || 1));
  function lanzamiento(st, registro) {
    const apagados = st.robotsApagados || {};
    const robots = registro.ids().map((id) => ({ id, nombre: registro.nombre(id), etapa: etapaDe(registro.ROBOTS[id].permisos), prendido: !apagados[id] }));
    const prendidos = robots.filter((r) => r.prendido);
    const actual = prendidos.length ? Math.max(...prendidos.map((r) => r.etapa)) : 0;
    return { etapas: ETAPAS.map((e) => ({ ...e, robots: robots.filter((r) => r.etapa === e.n) })), actual, robots };
  }
  // Qué cambia si el jefe elige la etapa n: se prenden los de etapa ≤ n y se apagan los de etapa > n (Capi nunca se apaga)
  function planEtapa(st, registro, n) {
    const l = lanzamiento(st, registro);
    return { prender: l.robots.filter((r) => r.etapa <= n && !r.prendido), apagar: l.robots.filter((r) => r.etapa > n && r.prendido) };
  }

  g.TABLERO = { construir, lanzamiento, planEtapa, etapaDe, ETAPAS };
  if (typeof module !== "undefined") module.exports = g.TABLERO;
})(globalThis);
