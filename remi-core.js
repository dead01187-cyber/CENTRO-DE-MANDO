// =====================================================================
// Remi (seguimiento de los correos de Maili) — reglas puras, para poder probarlas.
// Lofty NO entrega el texto de las respuestas por su API; sí dice, por cada lead, qué correos se mandaron,
// cuáles ABRIÓ el lead (evento "Opened"/"Clicked") y si entró un correo suyo (direction "Inbound").
//   · resumir({ enviado, correos, lead, ahora })  → { estado, abiertos, clics, respondioT, ultimoT, dias }
//        estado: "baja" | "respondio" | "abrio" | "sin_abrir"
//   · ordenar(lista)        primero los que respondieron, luego los que más abrieron
//   · nota(x)               nota en INGLÉS para Lofty
// correos: historial de Lofty ya convertido con MAILI_CORE.deLofty → { t, direccion, tipo, evento, asunto }
// =====================================================================
(function (g) {
  const DIA = 864e5, MARGEN = 2 * 60e3;
  const igual = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  const PESO = { respondio: 0, abrio: 1, sin_abrir: 2, baja: 3 };

  function resumir({ enviado = {}, correos = [], lead = {}, ahora = Date.now() }) {
    const desde = (enviado.t || 0) - MARGEN;
    const despues = correos.filter((e) => e.t >= desde);
    // aperturas y clics SOLO del correo de Maili (mismo asunto); así no cuentan los reportes automáticos de Lofty
    const mios = despues.filter((e) => e.direccion === "out" && igual(e.asunto, enviado.asunto));
    const abiertos = mios.filter((e) => /^opened/i.test(e.evento)).length, clics = mios.filter((e) => /^clicked/i.test(e.evento)).length;
    const entradas = despues.filter((e) => e.direccion === "in" && e.t > (enviado.t || 0));
    const respondioT = entradas.length ? Math.min(...entradas.map((e) => e.t)) : 0;
    const baja = lead.cannotEmail === true || lead.unsubscription === true;
    const ultimoT = Math.max(0, ...mios.map((e) => e.t), ...entradas.map((e) => e.t));
    const estado = baja ? "baja" : respondioT ? "respondio" : abiertos + clics ? "abrio" : "sin_abrir";
    return { estado, abiertos, clics, respondioT, ultimoT, dias: enviado.t ? Math.floor((ahora - enviado.t) / DIA) : 0 };
  }

  const ordenar = (lista) => [...lista].sort((a, b) => PESO[a.estado] - PESO[b.estado] || (b.abiertos + b.clics) - (a.abiertos + a.clics) || (b.ultimoT || 0) - (a.ultimoT || 0));

  const fecha = (t) => new Date(t).toISOString().slice(0, 10);
  function nota(x) {
    const s = `"${String(x.asunto || "").slice(0, 80)}" (sent ${fecha(x.enviadoT)})`;
    if (x.estado === "respondio") return `Remi: the lead REPLIED by email to ${s}. Read the reply in Lofty and follow up.`;
    if (x.estado === "baja") return `Remi: the lead unsubscribed from emails after ${s}. Do not email.`;
    if (x.estado === "abrio") return `Remi: the lead opened the email ${s} ${x.abiertos} time(s)${x.clics ? ` and clicked ${x.clics} time(s)` : ""}. Good moment for a call.`;
    return "";
  }
  // ¿Vale la pena dejar nota? Respuesta y baja siempre; apertura solo si abrió 2 veces o más (interés real)
  const merece = (x) => x.estado === "respondio" || x.estado === "baja" || (x.estado === "abrio" && x.abiertos + x.clics >= 2);
  const huella = (x) => `${x.estado}:${x.estado === "abrio" ? Math.min(x.abiertos + x.clics, 2) : ""}:${x.enviadoT}`;

  g.REMI_CORE = { resumir, ordenar, nota, merece, huella };
  if (typeof module !== "undefined") module.exports = g.REMI_CORE;
})(globalThis);
