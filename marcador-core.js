// =====================================================================
// Marcador vs Anna (Fase Anna 3) — cálculo puro, sin Chrome ni Lofty, para poder probarlo.
// Cada lead cuenta para QUIEN LO CONTACTÓ PRIMERO (Anna o tus robots), así nadie se cuenta dos veces.
//
// Entrada por lead:
//   { leadId, creado (ms), etapa, textos: [{ t, direccion: "in"|"out", tipo: "AI"|"Manual"|..., texto }],
//     contactos: [{ t, canal, robot }]   (los de tus robots, del Cerebro),  citas: [{ creado }] }
// Métricas por bando, en una ventana de N días (por la fecha del primer contacto):
//   contactados · minutos al primer contacto (mediana, solo leads creados en la ventana) · % que contestó ·
//   pasaron a Warm/Hot · citas · bajas (STOP)
// =====================================================================
(function (g) {
  const RE_BAJA = /\b(stop|stop ?all|unsubscribe|remove me|take me off|opt[ -]?out|revoke|do ?n[o']?t (text|contact|message)|no (more )?(texts|messages)|no me (escrib\w*|mand\w*|contact\w*)|baja)\b|^\s*(stop|quit|end|cancel|alto|para|cancelar|basta)\s*[.!]*\s*$/i;

  function primeros(l) {
    const anna = (l.textos || []).filter((x) => x.direccion === "out" && String(x.tipo).toUpperCase() === "AI").map((x) => x.t);
    const robots = (l.contactos || []).map((c) => c.t);
    return { anna: anna.length ? Math.min(...anna) : 0, robots: robots.length ? Math.min(...robots) : 0 };
  }
  // ¿De quién es este lead? El que llegó primero.
  function duenoDe(l) {
    const p = primeros(l);
    if (!p.anna && !p.robots) return null;
    if (p.anna && (!p.robots || p.anna <= p.robots)) return { bando: "anna", primero: p.anna };
    return { bando: "robots", primero: p.robots };
  }
  const mediana = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const vacio = () => ({ contactados: 0, minutos: [], contestaron: 0, warmHot: 0, citas: 0, bajas: 0 });

  function marcador(leads, { ahora = Date.now(), dias = 7, etapasBuenas = ["warm", "hot"] } = {}) {
    const desde = ahora - dias * 864e5, buenas = etapasBuenas.map((s) => String(s).toLowerCase());
    const B = { anna: vacio(), robots: vacio() };
    for (const l of leads) {
      const d = duenoDe(l);
      if (!d || d.primero < desde || d.primero > ahora) continue;
      const b = B[d.bando];
      b.contactados++;
      if (l.creado && l.creado >= desde && d.primero >= l.creado) b.minutos.push((d.primero - l.creado) / 60e3);
      const respuestas = (l.textos || []).filter((x) => x.direccion === "in" && x.t > d.primero);
      if (respuestas.length) b.contestaron++;
      if (respuestas.some((x) => RE_BAJA.test(String(x.texto || "")))) b.bajas++;
      if (buenas.includes(String(l.etapa || "").toLowerCase())) b.warmHot++;
      if ((l.citas || []).some((c) => c.creado >= d.primero)) b.citas++;
    }
    const fin = (b) => ({ contactados: b.contactados, minutosMediana: b.minutos.length ? Math.round(mediana(b.minutos) * 10) / 10 : null, conTiempo: b.minutos.length,
      contestaron: b.contestaron, pctContesto: b.contactados ? Math.round((b.contestaron / b.contactados) * 1000) / 10 : null,
      warmHot: b.warmHot, citas: b.citas, bajas: b.bajas, pctBajas: b.contactados ? Math.round((b.bajas / b.contactados) * 1000) / 10 : null });
    const anna = fin(B.anna), robots = fin(B.robots);
    // Quién gana cada renglón (más es mejor, salvo tiempo y bajas)
    const gana = (a, r, menosEsMejor = false) => (a == null || r == null || a === r ? "empate" : (menosEsMejor ? r < a : r > a) ? "robots" : "anna");
    const ganador = { contactados: gana(anna.contactados, robots.contactados), minutosMediana: gana(anna.minutosMediana, robots.minutosMediana, true),
      pctContesto: gana(anna.pctContesto, robots.pctContesto), warmHot: gana(anna.warmHot, robots.warmHot), citas: gana(anna.citas, robots.citas), pctBajas: gana(anna.pctBajas, robots.pctBajas, true) };
    return { dias, anna, robots, ganador };
  }

  // Convierte un SMS de la API de Lofty (con su texto)
  const tiempo = (s) => Date.parse(String(s || "").replace(/GMT$/, "Z")) || 0;
  const textoDeLofty = (x) => ({ t: tiempo(x.textTime || x.communicationTime || x.createTime), direccion: /^\s*in/i.test(String(x.direction || "")) ? "in" : "out", tipo: x.textType || "", texto: String(x.textContent || x.content || "") });

  g.MARCADOR_CORE = { marcador, duenoDe, primeros, mediana, textoDeLofty, tiempo, RE_BAJA };
  if (typeof module !== "undefined") module.exports = g.MARCADOR_CORE;
})(globalThis);
