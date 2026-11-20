// =====================================================================
// Registro central de robots (Fase 2). ÚNICA fuente de: nombre, rol,
// supervisor (GEO / CRM / GROW / OPS), página, permisos y acciones que se
// pueden pedir por el bus de tareas. Antes esto estaba copiado en 6 lugares
// (robot.js, sv.js ×4, mando.js, apagado.js) y ya no coincidía.
//
// Permisos (qué puede tocar un robot):
//   lee_web       lee páginas de terceros (Propwire, BeenVerified, Zillow…)
//   lee_crm       lee Lofty
//   lee_correo    lee Gmail
//   escribe_crm   crea o cambia leads, etapas, notas o teléfonos en Lofty
//   escribe_correo crea borradores en Gmail (nunca envía)
//   publica       publica en otro sistema (Teams)
//   envia_sms     manda SMS (siempre pasa además por politica-sms.js)
//   gasta         gasta créditos o dinero (skip trace, reportes, consultas con tope)
//   borra         borra archivos o listas
//
// Acciones del bus: { id, desc, aprobacion } — aprobacion:true = el bus la deja
// en "esperando aprobación" hasta que el jefe la apruebe en pantalla (Capi no puede).
// =====================================================================
(function (g) {
  const SUPERVISORES = {
    capi: { nombre: "Capi", rol: "Supervisor principal: habla con el jefe, planea y pide aprobaciones" },
    GEO: { nombre: "GEO", rol: "Investigación territorial y prospección" },
    CRM: { nombre: "CRM", rol: "Calidad, organización y sincronización de leads" },
    GROW: { nombre: "GROW", rol: "Seguimiento comercial, SMS y oportunidades" },
    OPS: { nombre: "OPS", rol: "Operaciones, seguridad, pruebas y supervisión técnica" },
  };

  const R = (nombre, rol, supervisor, pagina, permisos, acciones = []) => ({ nombre, rol, supervisor, pagina, permisos, acciones });
  const ROBOTS = {
    // ---- GEO: dónde buscar y qué propiedades ----
    ra: R("Radar", "Junta señales de venta por ZIP (OC y LA) con ritmo humano", "GEO", "radar.html", ["lee_web"]),
    te: R("Termi", "Califica las zonas de 0 a 100", "GEO", "termi.html", ["lee_web"]),
    pw: R("Propi", "Busca domicilios en Propwire", "GEO", "pw.html", ["lee_web"]),
    pr: R("Prope", "Saca de Properant las HECM en ejecución (herederos)", "GEO", "pr.html", ["lee_web", "gasta"]),
    hr: R("Heri", "Busca HECM (Celink / HUD) con Notice of Default", "GEO", "hr.html", ["lee_web", "gasta"]),
    // ---- CRM: filtrar, enriquecer, subir y limpiar leads ----
    ch: R("Chequi", "Revisa que no estén ya en Lofty", "CRM", "ch.html", ["lee_crm"],
      [{ id: "revisar", desc: "Revisar ahora en Lofty los domicilios pendientes", aprobacion: false, boton: "run" }]),
    ch3: R("Chequi 3", "Revisa en Lofty las HECM de Heri", "CRM", "ch3.html?linea=hr", ["lee_crm"],
      [{ id: "revisar", desc: "Revisar ahora en Lofty las HECM pendientes", aprobacion: false, boton: "run" }]),
    bv: R("Veri", "Busca los dueños en BeenVerified", "CRM", "bv.html", ["lee_web", "gasta"]),
    bv2: R("Veri 2", "Busca en BeenVerified los leads de Acti", "CRM", "bv.html?linea=ac", ["lee_web", "gasta"]),
    bv3: R("Veri 3", "Busca en BeenVerified a los herederos (HECM)", "CRM", "bv.html?linea=hr", ["lee_web", "gasta"]),
    ow: R("Owny", "Saca owner y teléfonos", "CRM", "owners.html", ["lee_web"]),
    ow2: R("Owny 2", "Lee los reportes de los leads de Acti", "CRM", "owners.html?linea=ac", ["lee_web"]),
    ow3: R("Owny 3", "Lee los reportes de las HECM", "CRM", "owners.html?linea=hr", ["lee_web"]),
    wb: R("Wibi", "Pasa a Lofti los leads de Propwire (tag ciudad + propwire)", "CRM", "wibi.html", ["lee_web", "lee_crm"]),
    wb3: R("Wibi 3", "Skip trace en Propwire de las HECM", "CRM", "wb.html?linea=hr", ["lee_web", "gasta"]),
    cp: R("Carpi", "Limpia el CSV de Propwire y te da el archivo para importar", "CRM", "carpi.html", ["lee_crm", "borra"]),
    lf: R("Lofti", "Limpia y sube los leads a Lofty", "CRM", "lofty.html", ["lee_crm", "escribe_crm"]),
    ac: R("Acti", "Actualiza leads que ya están en Lofty", "CRM", "ac.html", ["lee_crm", "escribe_crm"]),
    li: R("Limpi", "Limpia todo el CRM (sellers y buyers)", "CRM", "li.html", ["lee_crm", "escribe_crm"],
      [{ id: "limpiar", desc: "Correr la limpieza del CRM (mueve a No Active Plans los que cumplen)", aprobacion: true, boton: "run" }]),
    zb: R("Zeta", "Lee los leads de zBuyer en Gmail y los compara con Lofty", "CRM", "zb.html", ["lee_correo", "lee_crm"],
      [{ id: "revisar", desc: "Revisar ahora los correos de zBuyer y compararlos con Lofty", aprobacion: false, boton: "run" }]),
    rd: R("Redi", "Redacta el borrador de reclamo a zBuyer", "CRM", "rd.html", ["lee_crm", "escribe_correo"]),
    // ---- GROW: contacto y seguimiento ----
    tx: R("Texi", "Manda SMS a los leads Seller que escojas", "GROW", "tx.html", ["lee_crm", "escribe_crm", "envia_sms"]),
    rs: R("Resi", "Lee las respuestas a los SMS y da seguimiento", "GROW", "rs.html", ["lee_crm", "escribe_crm", "envia_sms"],
      [{ id: "revisar", desc: "Revisar las respuestas a los SMS (no manda nada; deja notas en Lofty si están prendidas)", aprobacion: false, boton: "run" }]),
    al: R("Marki", "Agente Lofty: marca a los leads, manda SMS y mueve el pipeline", "GROW", "al.html", ["lee_crm", "escribe_crm", "envia_sms"]),
    ti: R("Timi", "Manda a Teams la captura del reclamo", "GROW", "ti.html", ["publica"]),
    // ---- Fase 4: robots nuevos (todos SOLO LEEN; ninguno escribe en Lofty ni manda nada) ----
    va: R("Vali", "Valida teléfonos y datos de los leads antes de subirlos", "CRM", "va.html", [],
      [{ id: "revisar", desc: "Revisar los lotes listos para Lofti (números falsos, repetidos, datos faltantes)", aprobacion: false, boton: "run" }]),
    pu: R("Punti", "Califica de 0 a 100 a qué leads atender primero", "GROW", "pu.html", [],
      [{ id: "puntuar", desc: "Calificar los leads por subir y los que contestaron SMS", aprobacion: false, boton: "run" }]),
    cu: R("Cumpli", "Audita el cumplimiento de los SMS y los ajustes riesgosos", "OPS", "cu.html", [],
      [{ id: "auditar", desc: "Auditar los SMS de los últimos días y los ajustes actuales", aprobacion: false, boton: "run" }]),
    qa: R("Qai", "Revisa la salud técnica de la extensión", "OPS", "qa.html", [],
      [{ id: "revisar", desc: "Revisar almacenamiento, tareas, llaves, errores y robots", aprobacion: false, boton: "run" }]),
    an: R("Ana", "Saca los números: SMS, respuestas, leads, tareas y errores", "OPS", "an.html", [],
      [{ id: "calcular", desc: "Calcular las métricas de los últimos días", aprobacion: false, boton: "run" }]),
    // ---- Supervisor principal ----
    sv: R("Capi", "Coordina a los robots y te habla", "capi", "sv.html", []),
  };

  const nombre = (id) => (ROBOTS[id] && ROBOTS[id].nombre) || id;
  const accion = (robot, id) => ((ROBOTS[robot] && ROBOTS[robot].acciones) || []).find((a) => a.id === id) || null;
  const deSupervisor = (s) => Object.keys(ROBOTS).filter((id) => ROBOTS[id].supervisor === s);
  const ids = (sinCapi = true) => Object.keys(ROBOTS).filter((id) => !sinCapi || id !== "sv");
  const acciones = () => ids().flatMap((r) => (ROBOTS[r].acciones || []).map((a) => ({ robot: r, ...a })));

  g.REGISTRO = { SUPERVISORES, ROBOTS, nombre, accion, deSupervisor, ids, acciones };
  if (typeof module !== "undefined") module.exports = g.REGISTRO;
})(globalThis);
