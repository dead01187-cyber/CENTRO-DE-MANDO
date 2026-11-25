// =====================================================================
// Cerebro (Fase Anna 1) — reglas puras, sin Chrome ni Lofty, para poder probarlas.
// Decide si un robot puede contactar a un lead AHORA, con lo que ya se sabe:
//   · contactos: lo que hicieron nuestros robots  [{ t, leadId, canal: "sms"|"llamada"|"email", robot }]
//   · textos:    el historial de SMS del lead en Lofty [{ t, direccion: "out"|"in", tipo: "AI"|"Manual"|"Auto", agentId }]
//   · anna:      { enPool, silenciado }  (Anna = AI Sales Agent de Lofty)
// Reglas:
//   1) Máximo 1 SMS por lead cada 24 h entre TODOS (robots, personas y Anna).
//      Excepción: una respuesta de Resi a un lead que nos escribió después de nuestro último SMS.
//   2) Nada (ni SMS, ni llamada, ni email) si una PERSONA le escribió en las últimas 24 h:
//      un SMS "Manual" en Lofty que no coincide con uno de nuestros robots (±5 min).
//   3) Si el lead está con Anna (en su pool y no silenciado), los robots normales no lo tocan.
//      Rayo no usa esta regla: él compite con Anna (ver annaYaEscribio).
// =====================================================================
(function (g) {
  const H24 = 24 * 3600e3, EMPAREJE = 5 * 60e3;
  const ROBOTS_SMS = ["Texi", "Compri", "Texi 2", "Resi", "Resi 2", "Marki", "Rayo"];

  // ¿Este SMS saliente de Lofty lo mandó uno de nuestros robots? (Lofty los marca "Manual" igual que a una persona)
  const esDeRobot = (x, contactos, leadId) =>
    contactos.some((c) => String(c.leadId) === String(leadId) && c.canal === "sms" && Math.abs(c.t - x.t) <= EMPAREJE);

  function personaEscribio(textos, contactos, leadId, ahora) {
    return textos.find((x) => x.direccion === "out" && ahora - x.t < H24 && String(x.tipo).toLowerCase() === "manual" && !esDeRobot(x, contactos, leadId)) || null;
  }
  const annaYaEscribio = (textos) => textos.some((x) => x.direccion === "out" && String(x.tipo).toUpperCase() === "AI");

  function revisar({ ahora = Date.now(), leadId, canal = "sms", contactos = [], textos = [], anna = {}, respetaAnna = true, esRespuesta = false }) {
    const mios = contactos.filter((c) => String(c.leadId) === String(leadId));
    // 2) una persona le escribió → nadie lo toca 24 h
    const p = personaEscribio(textos, contactos, leadId, ahora);
    if (p) return { ok: false, codigo: "persona", motivo: `una persona le escribió hace ${Math.round((ahora - p.t) / 60e3)} min (agente ${p.agentId || "?"}); no lo toco en 24 h` };
    // 3) está con Anna
    if (respetaAnna && anna.enPool && !anna.silenciado) return { ok: false, codigo: "anna", motivo: "está con Anna (AI Sales Agent de Lofty); no lo toco" };
    if (canal === "sms") {
      const ultimoIn = Math.max(0, ...textos.filter((x) => x.direccion === "in").map((x) => x.t));
      const salidas = [...mios.filter((c) => c.canal === "sms").map((c) => c.t), ...textos.filter((x) => x.direccion === "out").map((x) => x.t)];
      const ultimoOut = Math.max(0, ...salidas);
      if (esRespuesta && ultimoIn > ultimoOut) return { ok: true, codigo: "respuesta" }; // contestar a quien nos escribió
      // 1) máximo 1 SMS por lead cada 24 h entre todos
      if (ultimoOut && ahora - ultimoOut < H24) {
        const quien = (textos.find((x) => x.direccion === "out" && x.t === ultimoOut) || {}).tipo === "AI" ? "Anna" : (mios.find((c) => c.t === ultimoOut) || {}).robot || "alguien";
        return { ok: false, codigo: "24h", motivo: `ya recibió un SMS hace ${Math.round((ahora - ultimoOut) / 60e3)} min (${quien}); máximo 1 cada 24 h` };
      }
    }
    return { ok: true, codigo: "ok" };
  }

  // Convierte un SMS de la API de Lofty (/v1.0/communication/text) al formato del Cerebro
  const tiempo = (s) => Date.parse(String(s || "").replace(/GMT$/, "Z")) || 0;
  const deLofty = (x) => ({ t: tiempo(x.textTime || x.communicationTime || x.createTime), direccion: /in/i.test(String(x.direction || "")) && !/out/i.test(String(x.direction || "")) ? "in" : "out",
    tipo: x.textType || "", agentId: x.agentId || null });

  g.CEREBRO_CORE = { revisar, personaEscribio, annaYaEscribio, esDeRobot, deLofty, H24, ROBOTS_SMS };
  if (typeof module !== "undefined") module.exports = g.CEREBRO_CORE;
})(globalThis);
