// =====================================================================
// Punti (Fase 4) — puntaje de leads de 0 a 100 para decidir a quién atender
// primero. SOLO LEE y sugiere: no cambia nada en Lofty ni manda nada.
// Señales (todas salen de datos que la extensión ya tiene):
//   + zona caliente (puntaje del ZIP según Termi)
//   + hipoteca inversa en ejecución / herederos (Heri)
//   + teléfonos que sirven (Vali) y correo
//   + respuesta del lead por SMS (Resi): interesado, pregunta…
//   − dueño empresa/trust, sin teléfonos que sirvan, baja/enojado/equivocado
// Cada resultado trae las razones, para que el jefe vea por qué.
// =====================================================================
(function (g) {
  const PESOS = { zona: 25, hecm: 20, herederos: 10, telefonos: 15, correo: 5, interesado: 55, pregunta: 30, mas_tarde: 5 }; // quien contestó "interesado" siempre queda en prioridad alta
  const zipDe = (dir) => (String(dir || "").match(/\b(\d{5})(?:-\d{4})?\s*$/) || String(dir || "").match(/\b(\d{5})\b/) || [])[1] || "";

  // lead = { address, owner, phones:[{num}], emails, hecm?, categoria? (Resi) }
  // ctx = { zonas: { "92618": 87 }, vali: VALI }
  function puntuar(l, ctx = {}) {
    let s = 0; const razones = [];
    const suma = (n, r) => { s += n; razones.push(`${n > 0 ? "+" : ""}${n} ${r}`); };
    const zip = l.zip || zipDe(l.address);
    const z = zip && ctx.zonas ? ctx.zonas[zip] : null;
    if (z != null) suma(Math.round((PESOS.zona * z) / 100), `zona ${zip} (Termi ${z}/100)`);
    if (l.hecm) { suma(PESOS.hecm, "hipoteca inversa en ejecución"); if ((l.hecm.parientes || []).length || l.hecm.fallecido) suma(PESOS.herederos, "herederos / sucesión"); }
    const tels = ctx.vali ? (l.phones || []).map((p) => ctx.vali.telefono(p && typeof p === "object" ? p.num : p)) : (l.phones || []).map(() => ({ nivel: "ok" }));
    const buenos = tels.filter((t) => t.nivel !== "malo").length;
    if (buenos) suma(Math.min(PESOS.telefonos, 5 * buenos), `${buenos} teléfono(s) que sirven`); else suma(-30, "sin teléfonos que sirvan");
    if ((l.emails || []).length) suma(PESOS.correo, "tiene correo");
    if (l.categoria === "interesado") suma(PESOS.interesado, "contestó interesado");
    else if (l.categoria === "pregunta") suma(PESOS.pregunta, "contestó con una pregunta");
    else if (l.categoria === "mas_tarde") suma(PESOS.mas_tarde, "dijo “más adelante”");
    else if (["baja", "enojado", "equivocado"].includes(l.categoria)) suma(-100, `respondió: ${l.categoria} (no contactar)`);
    else if (l.categoria === "no") suma(-20, "dijo que no");
    if (/\b(LLC|INC|CORP|TRUST|ESTATE|BANK|HOLDINGS?)\b/i.test(l.owner || "")) suma(-25, "el dueño parece empresa/trust");
    const score = Math.max(0, Math.min(100, s));
    return { score, nivel: score >= 60 ? "alto" : score >= 35 ? "medio" : "bajo", razones };
  }

  function ordenar(leads, ctx) {
    return (leads || []).map((l) => ({ ...l, ...puntuar(l, ctx) })).sort((a, b) => b.score - a.score);
  }

  g.PUNTI = { puntuar, ordenar, zipDe, PESOS };
  if (typeof module !== "undefined") module.exports = g.PUNTI;
})(globalThis);
