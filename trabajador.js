// =====================================================================
// Trabajador del bus de tareas (Fase 2). Va en cada página de robot y en Capi.
//
// · Lado robot: Tareas.atender("revisar", async (entrada) => "resultado") registra lo que
//   ese robot sabe hacer. Cuando aparece una tarea pendiente para él, la reclama (solo una
//   pestaña la obtiene), manda latidos cada 30 s y al final reporta hecha o fallida.
//   Si la página está cerrada, la tarea espera: la toma cuando la página vuelve a abrir.
// · Lado cliente (Capi, Centro de Mando): Tareas.crear / listar / esperar / cancelar / aprobar.
// · Un robot apagado con su interruptor no toma tareas.
// =====================================================================
(function () {
  if (!window.chrome || !chrome.runtime || !chrome.storage) return;
  const MOD = (document.documentElement && document.documentElement.dataset.mod) || "";
  const instancia = `${MOD || "pagina"}:${Math.random().toString(36).slice(2, 9)}`;
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const manejadores = {}, alCancelar = {};
  let ocupado = false, actual = null; // actual = tarea que este robot está haciendo ahora

  async function pedir(msg) {
    const r = await chrome.runtime.sendMessage({ type: "tarea", ...msg });
    if (!r || !r.ok) throw new Error((r && r.error) || "el bus de tareas no contestó");
    return r.r;
  }

  async function atenderPendientes() {
    if (ocupado || !MOD || !Object.keys(manejadores).length) return;
    const { robotsApagados = {} } = await chrome.storage.local.get("robotsApagados");
    if (robotsApagados[MOD]) return;
    ocupado = true;
    try {
      for (;;) {
        const t = await pedir({ op: "reclamar", robot: MOD, instancia });
        if (!t) break;
        const fn = manejadores[t.accion];
        if (!fn) { await pedir({ op: "terminar", id: t.id, instancia, ok: false, error: `este robot no sabe hacer “${t.accion}”` }); continue; }
        window.svLog && svLog(`Tarea del bus: ${t.accion}${t.origen ? ` (la pidió ${t.origen === "capi" ? "Capi" : t.origen})` : ""}.`);
        actual = t;
        // Latido cada 10 s; si el jefe/Capi canceló la tarea, se le avisa al robot para que se detenga
        const latidos = setInterval(() => pedir({ op: "latido", id: t.id, instancia }).then((r) => { if (r && r.seguir === false) cancelarActual(); }).catch(() => {}), 10e3);
        try {
          const res = await fn(t.entrada || {}, t);
          await pedir({ op: "terminar", id: t.id, instancia, ok: true, resultado: String(res == null ? "" : res) });
        } catch (e) {
          await pedir({ op: "terminar", id: t.id, instancia, ok: false, error: String((e && e.message) || e) }).catch(() => {});
        } finally { clearInterval(latidos); actual = null; }
      }
    } catch (e) { /* el bus no contestó: se intenta en el siguiente cambio */ }
    finally { ocupado = false; }
  }

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local" || !Object.keys(manejadores).length) return;
    if (ch.tareas && Object.values(ch.tareas.newValue || {}).some((t) => t.robot === MOD && t.estado === "pendiente")) atenderPendientes();
    if (ch.tareas && actual && ((ch.tareas.newValue || {})[actual.id] || {}).cancelarPedido) cancelarActual(); // cancelación inmediata
    if (ch.robotsApagados) atenderPendientes();
  });

  let cancelado = null;
  function cancelarActual() {
    if (!actual || cancelado === actual.id) return;
    cancelado = actual.id;
    const f = alCancelar[actual.accion];
    window.svLog && svLog(`Tarea del bus cancelada: ${actual.accion}. Me detengo.`);
    try { f && f(); } catch (e) {}
  }
  // Espera a que aparezca en la bitácora un mensaje de este robot que diga que terminó (máx. ms). Regresa el evento o null.
  async function esperarEvento(re, desde, ms = 60 * 60e3) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const { svEventos = [] } = await chrome.storage.local.get("svEventos");
      const ev = svEventos.find((e) => e.mod === MOD && e.t >= desde && re.test(e.texto));
      if (ev) return ev;
      if (actual && cancelado === actual.id) return { texto: "cancelada" };
      await espera(2000);
    }
    return null;
  }

  // Espera a que el robot termine lo que ya estaba haciendo (máx. 10 min) antes de empezar la tarea
  async function esperarLibre(estaOcupado, ms = 10 * 60e3) {
    const t0 = Date.now();
    while (estaOcupado() && Date.now() - t0 < ms) await espera(2000);
    if (estaOcupado()) throw new Error("el robot siguió ocupado más de 10 minutos");
  }

  // Cliente: Capi y el Centro de Mando
  async function esperar(id, ms = 90e3) {
    const t0 = Date.now();
    for (;;) {
      const t = (await pedir({ op: "listar", limite: 400 })).find((x) => x.id === id);
      if (!t || !["pendiente", "corriendo"].includes(t.estado) || Date.now() - t0 > ms) return t || null;
      await espera(1500);
    }
  }

  window.Tareas = {
    instancia,
    // opts.alCancelar: qué hacer si cancelan la tarea a medio camino (por ejemplo, darle "Parar" al robot)
    atender(accion, fn, opts = {}) { manejadores[accion] = fn; if (opts.alCancelar) alCancelar[accion] = opts.alCancelar; setTimeout(atenderPendientes, 800); },
    esperarLibre, esperarEvento,
    crear: (robot, accion, opts = {}) => pedir({ op: "crear", robot, accion, ...opts }),
    listar: (opts = {}) => pedir({ op: "listar", ...opts }),
    cancelar: (id, por) => pedir({ op: "cancelar", id, por }),
    // Aprobar/rechazar: SOLO desde un clic del jefe en pantalla (Capi no tiene herramienta para esto)
    aprobar: (id) => pedir({ op: "aprobar", id, por: "jefe" }),
    rechazar: (id) => pedir({ op: "rechazar", id, por: "jefe" }),
    esperar,
  };
})();
