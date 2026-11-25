// Resi con IA (Fase Anna 2): lógica pura
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../resi-core.js");
const NY = { en: "Would it be helpful if I checked back with you next year?", es: "¿Le serviría si le vuelvo a contactar el próximo año?" };

test("temas sensibles: legal, financiamiento y herencias/trusts (inglés y español)", () => {
  for (const t of ["Do I need a lawyer for this?", "it's in a trust", "my mom passed, it's in probate", "can you help with a mortgage?", "what's the interest rate", "hablé con mi abogado", "es una herencia de mi papá", "necesito un préstamo"]) assert.equal(R.temaSensible(t), true, t);
  for (const t of ["yes call me", "how much can I get?", "maybe next year", "who is this?"]) assert.equal(R.temaSensible(t), false, t);
});
test("prompt: usa el nombre, pide solo lo que falta y sabe si es Buyer", () => {
  const p = R.prompt({ nombre: "Christopher", tipo: "seller", calif: { cuando: "in 3 months" }, NEXT_YEAR: NY });
  assert.match(p, /Christopher with Rubio Real Estate/);
  assert.match(p, /Ya sabemos: cuándo quiere vender: in 3 months/);
  assert.doesNotMatch(p.split("Haz UNA sola pregunta")[1].split(")")[0], /cuándo quiere vender/);
  assert.match(R.prompt({ nombre: "Ana", asistente: true, tipo: "buyer", NEXT_YEAR: NY }), /Ana's assistant.*COMPRADOR/s);
});
test("leerIA: categorías válidas, calificación limpia y sin respuesta en temas sensibles", () => {
  const j = R.leerIA('ok {"categoria":"caliente","temperatura":"caliente","calif":{"cuando":"2 months","porque":"relocating","precio":"null","agente":"no"},"summary":"wants to sell soon","borrador":"Great, can I call you today?"}');
  assert.equal(j.categoria, "caliente"); assert.equal(j.urgente, true);
  assert.deepEqual(j.calif, { cuando: "2 months", porque: "relocating", precio: null, agente: "no" });
  assert.equal(R.leerIA('{"categoria":"sensible","borrador":"Sure, the rate is 6%"}').borrador, "");
  assert.equal(R.leerIA('{"categoria":"inventada"}'), null);
  assert.equal(R.leerIA("no es json"), null);
});
test("calificación: se une y se sabe cuándo está completa", () => {
  const c = R.unirCalif({ cuando: "3 months", porque: null }, { porque: "downsizing", cuando: null });
  assert.deepEqual(c, { cuando: "3 months", porque: "downsizing", precio: null, agente: null });
  assert.equal(R.califCompleta({ cuando: 1, porque: 1, precio: 1, agente: 1 }), true);
});
test("etapa propuesta: caliente → Hot, interesado → Warm, nunca baja de Hot", () => {
  assert.equal(R.etapaPropuesta({ categoria: "caliente", etapaActual: "New Leads" }), "Hot");
  assert.equal(R.etapaPropuesta({ categoria: "interesado", temperatura: "tibio", etapaActual: "New Leads" }), "Warm");
  assert.equal(R.etapaPropuesta({ categoria: "interesado", temperatura: "tibio", etapaActual: "Hot" }), "");
  assert.equal(R.etapaPropuesta({ categoria: "no", etapaActual: "New Leads" }), "");
  assert.equal(R.etapaPropuesta({ categoria: "caliente", etapaActual: "hot" }), "");
});
test("nota en inglés con la calificación", () => {
  const n = R.notaEn({ texto: "yes in 2 months", categoria: "Hot lead", summary: "wants to sell", calif: { cuando: "2 months", agente: "no" }, etapa: "Hot" });
  assert.match(n, /^Resi \(SMS\): the lead replied "yes in 2 months"\. Classified as: Hot lead\. wants to sell Qualification — Timeline: 2 months \| Agent: no\. Suggested stage: Hot\.$/);
});
