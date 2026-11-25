// =====================================================================
// Resi con IA (Fase Anna 2) — lógica pura, sin Chrome ni Lofty, para poder probarla.
//   · temaSensible(texto): legal, financiamiento, herencias/trusts → Resi NO contesta y te pasa el lead.
//   · prompt({...}): instrucciones para Claude: califica (cuándo, por qué, precio, agente), corto y humano.
//   · leerIA(texto): convierte la respuesta de Claude en un objeto seguro.
//   · etapaPropuesta({...}): a qué etapa del pipeline proponer mover (solo hacia adelante).
// =====================================================================
(function (g) {
  // Legal, financiamiento, herencias / trusts (inglés y español)
  const RE_SENSIBLE = /\b(lawyers?|attorneys?|legal(ly)?|lawsuit|sue|court|probate|trusts?|trustee|estate (plan|attorney|sale)|inherit\w*|heirs?|will and testament|executor|power of attorney|divorce|bankrupt\w*|lien|tax(es)? (lien|question)|capital gains|mortgage|loan|refinanc\w*|heloc|interest rate|pre-?approv\w*|credit score|financ\w*|reverse mortgage|abogad\w*|legal|demanda|corte|juicio|herencia|hereder\w*|testamento|fideicomiso|sucesi[oó]n|albacea|divorcio|bancarrota|quiebra|gravamen|impuestos?|hipoteca|pr[eé]stamo|refinanci\w*|financiamiento|cr[eé]dito|tasa de inter[eé]s|pre-?aprobaci[oó]n)\b/i;
  const temaSensible = (t) => RE_SENSIBLE.test(String(t || ""));

  const CALIF = ["cuando", "porque", "precio", "agente"];
  const ETIQ = {
    seller: { cuando: "cuándo quiere vender", porque: "por qué vende", precio: "en qué precio piensa", agente: "si ya tiene agente" },
    buyer: { cuando: "cuándo quiere comprar", porque: "qué busca y por qué", precio: "su presupuesto", agente: "si ya tiene agente" },
  };

  function prompt({ nombre = "Mark", asistente = false, tipo = "seller", calif = {}, NEXT_YEAR }) {
    const yo = asistente ? `${nombre}'s assistant at Rubio Real Estate` : `${nombre} with Rubio Real Estate`;
    const e = ETIQ[tipo] || ETIQ.seller;
    const faltan = CALIF.filter((k) => !calif[k]).map((k) => e[k]);
    const sabemos = CALIF.filter((k) => calif[k]).map((k) => `${e[k]}: ${calif[k]}`).join("; ") || "nada todavía";
    return `Eres Resi y escribes los SMS de ${yo} (Rubio Real Estate / The Irvine Realtors, Los Angeles y Orange County, California). El lead es un ${tipo === "buyer" ? "COMPRADOR (Buyer)" : "DUEÑO que podría vender (Seller)"}.
Lee la conversación y:
1) Clasifica la ÚLTIMA respuesta del lead: interesado, caliente (quiere vender/comprar pronto, acepta llamada o cita), pregunta, mas_tarde, no, baja (STOP, remove, unsubscribe, no me escribas), equivocado, enojado, sensible (pregunta algo legal, de financiamiento/hipoteca/préstamo, o de herencias/trusts/probate), otro.
2) Califica con lo que el lead haya dicho (no inventes): ${CALIF.map((k) => `${k} = ${e[k]}`).join(", ")}. Ya sabemos: ${sabemos}.
3) Escribe UNA respuesta SMS para seguir la plática: en el idioma del lead, máximo 220 caracteres, natural y cálida, como la escribiría una persona, sin emojis, sin prometer precios ni cifras ni comisiones. Haz UNA sola pregunta para conocer lo que falta (${faltan.join(", ") || "ya está calificado: propone una llamada corta"}). Si es caliente, propone una llamada hoy o mañana.
Reglas: si la categoría es sensible, baja, equivocado o enojado, la respuesta va VACÍA (no contestes temas legales, de financiamiento ni de herencias: eso lo atiende ${nombre}). Si es "no" o "mas_tarde", la respuesta es EXACTAMENTE "${NEXT_YEAR.en}" (o en español "${NEXT_YEAR.es}").
Temperatura: caliente (quiere en menos de 6 meses o acepta llamada), tibio (interesado pero sin prisa), frio.
Contesta SOLO con JSON: {"categoria":"...","temperatura":"caliente|tibio|frio","calif":{"cuando":"...o null","porque":"...o null","precio":"...o null","agente":"...o null"},"resumen":"una línea en español","summary":"one-line summary in English","borrador":"...","urgente":true|false,"seguimientoDias":número o null}`;
  }

  const CATS = ["interesado", "caliente", "pregunta", "mas_tarde", "no", "baja", "equivocado", "enojado", "sensible", "otro"];
  const SIN_RESPUESTA = ["baja", "equivocado", "enojado", "sensible"];
  function leerIA(texto) {
    let j; try { j = JSON.parse((String(texto || "").match(/\{[\s\S]*\}/) || ["{}"])[0]); } catch (e) { return null; }
    if (!CATS.includes(j.categoria)) return null;
    const limpio = (v) => (v == null || /^(null|none|n\/a|unknown|desconocido)$/i.test(String(v).trim()) ? null : String(v).slice(0, 80));
    const calif = Object.fromEntries(CALIF.map((k) => [k, limpio((j.calif || {})[k])]));
    const temp = ["caliente", "tibio", "frio"].includes(j.temperatura) ? j.temperatura : j.categoria === "caliente" ? "caliente" : null;
    return { categoria: j.categoria, temperatura: temp, calif, resumen: String(j.resumen || "").slice(0, 200), summary: String(j.summary || "").slice(0, 200),
      borrador: SIN_RESPUESTA.includes(j.categoria) ? "" : String(j.borrador || "").slice(0, 320), urgente: !!j.urgente || j.categoria === "caliente", seguimientoDias: Number(j.seguimientoDias) || null };
  }

  // Une lo que ya sabíamos con lo nuevo (lo nuevo gana solo si trae algo)
  const unirCalif = (viejo = {}, nuevo = {}) => Object.fromEntries(CALIF.map((k) => [k, nuevo[k] || viejo[k] || null]));
  const califCompleta = (c = {}) => CALIF.every((k) => c[k]);

  // Etapa a proponer: caliente → etapa caliente; tibio/interesado → etapa tibia. Nunca baja de Hot a Warm.
  function etapaPropuesta({ categoria, temperatura, etapaActual = "", etapaCaliente = "Hot", etapaTibio = "Warm" }) {
    const n = (s) => String(s || "").trim().toLowerCase();
    const caliente = temperatura === "caliente" || categoria === "caliente";
    const tibio = !caliente && (temperatura === "tibio" || categoria === "interesado");
    const destino = caliente ? etapaCaliente : tibio ? etapaTibio : "";
    if (!destino || n(destino) === n(etapaActual)) return "";
    if (tibio && n(etapaActual) === n(etapaCaliente)) return ""; // no bajar de caliente a tibio
    return destino;
  }

  // Nota en inglés para Lofty
  function notaEn({ texto, categoria, summary, calif = {}, etapa = "", tipo = "seller" }) {
    const L = tipo === "buyer" ? { cuando: "Timeline", porque: "Looking for", precio: "Budget", agente: "Agent" } : { cuando: "Timeline", porque: "Reason", precio: "Price in mind", agente: "Agent" };
    const q = CALIF.filter((k) => calif[k]).map((k) => `${L[k]}: ${calif[k]}`).join(" | ");
    return `Resi (SMS): the lead replied "${String(texto || "").slice(0, 300)}". Classified as: ${categoria}.${summary ? " " + summary : ""}${q ? ` Qualification — ${q}.` : ""}${etapa ? ` Suggested stage: ${etapa}.` : ""}`;
  }

  g.RESI_CORE = { temaSensible, prompt, leerIA, unirCalif, califCompleta, etapaPropuesta, notaEn, CALIF, CATS, SIN_RESPUESTA };
  if (typeof module !== "undefined") module.exports = g.RESI_CORE;
})(globalThis);
