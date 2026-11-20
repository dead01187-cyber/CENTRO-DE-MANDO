// =====================================================================
// Bus de tareas (Fase 2) — núcleo. Lo corre el service worker (background.js).
// Una tarea es un encargo a un robot: { robot, accion, entrada }. Vive en
// chrome.storage ("tareas"), así que sobrevive si se cierra el panel: cuando la
// página del robot vuelve a abrir, la toma y la termina.
//
// Estados:  aprobacion → pendiente → corriendo → hecha
//                    ↘ rechazada       ↘ fallida (o vuelve a pendiente si quedan intentos)
//           (cualquiera sin terminar) → cancelada
//
// Reglas:
//   · Solo se aceptan robots y acciones del registro central (registro.js).
//   · Acción con aprobacion:true → espera "aprobacion" del jefe (Capi no tiene cómo aprobar).
//   · No duplica: si ya hay una tarea viva del mismo robot y acción (o con la misma clave "idem"), regresa esa.
//   · Un robot que deja de dar señales de vida por 2 min suelta su tarea (se reintenta o falla).
// =====================================================================
(function (g) {
  const VIVAS = ["aprobacion", "pendiente", "corriendo"];
  const LATIDO_MAX = 2 * 60e3;          // sin latido en 2 min = robot perdido
  const APROBACION_MAX = 24 * 3600e3;   // una aprobación sin respuesta vence en 24 h
  const GUARDAR_TERMINADAS = 300;       // historial de tareas terminadas que se conserva

  const conCandado = (fn) => (typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request("bus-tareas", fn) : fn());
  const nuevaId = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const leer = async () => (await chrome.storage.local.get("tareas")).tareas || {};
  async function guardar(tareas) {
    const term = Object.values(tareas).filter((t) => !VIVAS.includes(t.estado)).sort((a, b) => b.actualizada - a.actualizada);
    for (const t of term.slice(GUARDAR_TERMINADAS)) delete tareas[t.id];
    await chrome.storage.local.set({ tareas });
  }
  const cambiar = (t, estado, extra = {}) => Object.assign(t, extra, { estado, actualizada: Date.now() });
  const error = (msg) => { throw Object.assign(new Error(msg), { bus: true }); };

  async function crear({ robot, accion, entrada = {}, origen = "capi", idem = "", motivo = "" }) {
    const reg = g.REGISTRO;
    if (!reg || !reg.ROBOTS[robot]) error(`El robot “${robot}” no está en el registro.`);
    const acc = reg.accion(robot, accion);
    if (!acc) error(`${reg.nombre(robot)} no tiene la acción “${accion}” en el registro.`);
    return conCandado(async () => {
      const tareas = await leer();
      const viva = Object.values(tareas).find((t) => VIVAS.includes(t.estado) && ((idem && t.idem === idem) || (t.robot === robot && t.accion === accion)));
      if (viva) return { ...viva, repetida: true };
      const ahora = Date.now();
      const t = { id: nuevaId(), robot, accion, entrada, origen, motivo: String(motivo || "").slice(0, 300), idem: String(idem || ""),
        estado: acc.aprobacion && origen !== "jefe" ? "aprobacion" : "pendiente", intentos: 0, maxIntentos: 2, creada: ahora, actualizada: ahora };
      tareas[t.id] = t;
      await guardar(tareas);
      return t;
    });
  }

  // Aprobar o rechazar: solo desde la pantalla, con un clic del jefe (Capi no tiene esta herramienta)
  async function decidir(id, aprobar, por = "jefe") {
    return conCandado(async () => {
      const tareas = await leer(), t = tareas[id];
      if (!t) error("No existe esa tarea.");
      if (t.estado !== "aprobacion") error(`La tarea ya no espera aprobación (está “${t.estado}”).`);
      cambiar(t, aprobar ? "pendiente" : "rechazada", aprobar ? { aprobadaPor: por, aprobadaEn: Date.now() } : { error: "el jefe no la aprobó" });
      await guardar(tareas);
      return t;
    });
  }

  async function cancelar(id, por = "") {
    return conCandado(async () => {
      const tareas = await leer(), t = tareas[id];
      if (!t) error("No existe esa tarea.");
      if (!VIVAS.includes(t.estado)) return t;
      if (t.estado === "corriendo") t.cancelarPedido = true; // el robot lo ve en su siguiente latido
      else cambiar(t, "cancelada", { error: "cancelada" + (por ? " por " + por : "") });
      await guardar(tareas);
      return t;
    });
  }

  // El robot pide su siguiente tarea (la más vieja pendiente). Solo uno la obtiene, aunque haya dos pestañas.
  async function reclamar(robot, instancia) {
    return conCandado(async () => {
      const tareas = await leer();
      const t = Object.values(tareas).filter((x) => x.robot === robot && x.estado === "pendiente").sort((a, b) => a.creada - b.creada)[0];
      if (!t) return null;
      cambiar(t, "corriendo", { dueno: instancia, inicio: Date.now(), latido: Date.now(), intentos: t.intentos + 1 });
      await guardar(tareas);
      return t;
    });
  }

  async function latido(id, instancia) {
    return conCandado(async () => {
      const tareas = await leer(), t = tareas[id];
      if (!t || t.estado !== "corriendo" || t.dueno !== instancia) return { seguir: false };
      t.latido = Date.now();
      await chrome.storage.local.set({ tareas });
      return { seguir: !t.cancelarPedido };
    });
  }

  async function terminar(id, instancia, { ok, resultado = "", error: err = "" }) {
    return conCandado(async () => {
      const tareas = await leer(), t = tareas[id];
      if (!t || t.estado !== "corriendo" || t.dueno !== instancia) return t || null; // otro ya la tomó o se venció
      if (t.cancelarPedido) cambiar(t, "cancelada", { resultado: String(resultado).slice(0, 1000), error: "cancelada a medio camino", fin: Date.now() });
      else if (ok) cambiar(t, "hecha", { resultado: String(resultado).slice(0, 1000), fin: Date.now(), error: "" });
      else if (t.intentos < t.maxIntentos) cambiar(t, "pendiente", { error: String(err).slice(0, 300), dueno: null });
      else cambiar(t, "fallida", { error: String(err).slice(0, 300), fin: Date.now() });
      await guardar(tareas);
      return t;
    });
  }

  // Vigía (cada minuto, con chrome.alarms): robots que dejaron de dar señales y aprobaciones vencidas
  async function vigilar(ahora = Date.now()) {
    return conCandado(async () => {
      const tareas = await leer(); let n = 0;
      for (const t of Object.values(tareas)) {
        if (t.estado === "corriendo" && ahora - (t.latido || t.inicio || 0) > LATIDO_MAX) {
          n++;
          if (t.cancelarPedido) cambiar(t, "cancelada", { error: "cancelada (el robot dejó de responder)" });
          else if (t.intentos < t.maxIntentos) cambiar(t, "pendiente", { error: "el robot dejó de responder; se reintenta", dueno: null });
          else cambiar(t, "fallida", { error: "el robot dejó de responder", fin: ahora });
        } else if (t.estado === "aprobacion" && ahora - t.creada > APROBACION_MAX) {
          n++; cambiar(t, "cancelada", { error: "nadie la aprobó en 24 h" });
        }
      }
      if (n) await guardar(tareas);
      return n;
    });
  }

  async function listar({ vivas = false, robot = "", limite = 50 } = {}) {
    const ts = Object.values(await leer()).filter((t) => (!vivas || VIVAS.includes(t.estado)) && (!robot || t.robot === robot));
    return ts.sort((a, b) => b.actualizada - a.actualizada).slice(0, limite);
  }

  // Punto de entrada para los mensajes { type: "tarea", op, ... } que recibe el background
  async function atenderMensaje(msg) {
    switch (msg.op) {
      case "crear": return crear(msg);
      case "aprobar": return decidir(msg.id, true, msg.por);
      case "rechazar": return decidir(msg.id, false, msg.por);
      case "cancelar": return cancelar(msg.id, msg.por);
      case "reclamar": return reclamar(msg.robot, msg.instancia);
      case "latido": return latido(msg.id, msg.instancia);
      case "terminar": return terminar(msg.id, msg.instancia, msg);
      case "listar": return listar(msg);
      default: error("Operación desconocida del bus: " + msg.op);
    }
  }

  g.BUS = { crear, decidir, cancelar, reclamar, latido, terminar, vigilar, listar, atenderMensaje, VIVAS, LATIDO_MAX };
  if (typeof module !== "undefined") module.exports = g.BUS;
})(globalThis);
