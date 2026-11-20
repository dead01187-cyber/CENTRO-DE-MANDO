// =====================================================================
// Presupuesto de uso de Claude (Fase 3). Cada quien que llama a Claude tiene
// un tope DIARIO de tokens (entrada y salida), en hora de California:
//   capi · GEO · CRM · GROW · OPS · robots (cerebros delegados) · resi (clasificador)
// Antes solo se contaban los tokens de la sesión y no había ningún tope.
// Falla cerrada: si no se puede leer el presupuesto, no se llama a Claude.
// Los topes se ajustan con chrome.storage.local "llmTopes" (mismo formato que DEF).
// Se cuentan tokens, no dólares: el precio depende del modelo y cambia.
// =====================================================================
(function (g) {
  const DEF = {
    capi: { entrada: 2000000, salida: 150000 },
    GEO: { entrada: 400000, salida: 40000 },
    CRM: { entrada: 400000, salida: 40000 },
    GROW: { entrada: 400000, salida: 40000 },
    OPS: { entrada: 300000, salida: 30000 },
    robots: { entrada: 600000, salida: 60000 },
    resi: { entrada: 300000, salida: 30000 },
  };
  const diaCA = (ms = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(ms);
  const conCandado = (fn) => (typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request("presupuesto-llm", fn) : fn());

  async function topes() {
    const { llmTopes = {} } = await chrome.storage.local.get("llmTopes");
    const t = {};
    for (const k of Object.keys(DEF)) t[k] = { ...DEF[k], ...(llmTopes[k] || {}) };
    return t;
  }
  async function usoHoy() {
    const { llmUso = {} } = await chrome.storage.local.get("llmUso");
    return llmUso.dia === diaCA() ? llmUso : { dia: diaCA(), por: {} };
  }

  // ¿Puede llamar a Claude? { ok } o { ok:false, motivo }
  async function revisar(quien) {
    try {
      const [tp, uso] = await Promise.all([topes(), usoHoy()]);
      const tope = tp[quien] || tp.robots, u = uso.por[quien] || { entrada: 0, salida: 0 };
      if (u.entrada >= tope.entrada || u.salida >= tope.salida)
        return { ok: false, motivo: `${quien} ya usó su presupuesto de Claude de hoy (${u.entrada.toLocaleString()} de ${tope.entrada.toLocaleString()} tokens de entrada, ${u.salida.toLocaleString()} de ${tope.salida.toLocaleString()} de salida). Se reinicia a medianoche (hora de California) o el jefe puede subir el tope.` };
      return { ok: true };
    } catch (e) {
      return { ok: false, motivo: "no pude revisar el presupuesto de Claude (" + ((e && e.message) || e) + "); por seguridad no llamo" };
    }
  }

  async function registrar(quien, usage) {
    if (!usage) return;
    try {
      await conCandado(async () => {
        const uso = await usoHoy();
        const u = uso.por[quien] || { entrada: 0, salida: 0, llamadas: 0 };
        u.entrada += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
        u.salida += usage.output_tokens || 0;
        u.llamadas = (u.llamadas || 0) + 1;
        uso.por[quien] = u;
        await chrome.storage.local.set({ llmUso: uso });
      });
    } catch (e) { /* el conteo nunca debe tumbar a Capi */ }
  }

  async function resumen() {
    const [tp, uso] = await Promise.all([topes(), usoHoy()]);
    return Object.keys(tp).map((k) => {
      const u = uso.por[k] || { entrada: 0, salida: 0, llamadas: 0 };
      return { quien: k, llamadas: u.llamadas || 0, entrada: u.entrada, topeEntrada: tp[k].entrada, salida: u.salida, topeSalida: tp[k].salida,
        porciento: Math.round(100 * Math.max(u.entrada / tp[k].entrada, u.salida / tp[k].salida)) };
    });
  }

  g.PRESUPUESTO = { DEF, diaCA, topes, revisar, registrar, resumen };
  if (typeof module !== "undefined") module.exports = g.PRESUPUESTO;
})(globalThis);
