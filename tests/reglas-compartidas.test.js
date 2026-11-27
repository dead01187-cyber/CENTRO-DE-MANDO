// Fase B: el JavaScript sigue dando EXACTAMENTE lo que dicen tests/casos/reglas.json (los mismos casos que
// prueba Python en tests/puente/test_arbitro.py). Si cambias una regla, corre `node tests/casos/generar-reglas.js`
// y cambia también puente/reglas.py.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../cerebro-core.js");
const SMS = require("../politica-sms.js");
const CASOS = require("./casos/reglas.json");

test("Cerebro: mismos resultados que los casos compartidos con Python", () => {
  for (const c of CASOS.cerebro) {
    const r = C.revisar(c.entrada);
    assert.deepEqual({ ok: r.ok, codigo: r.codigo, motivo: r.motivo || "" }, c.salida, c.nombre);
  }
});
test("Política de SMS: d10, solo California, horario y palabras de baja", () => {
  for (const c of CASOS.d10) assert.equal(SMS.d10(c.entrada), c.salida, JSON.stringify(c));
  for (const c of CASOS.esCA) assert.equal(SMS.esCA(c.entrada), c.salida, JSON.stringify(c));
  for (const c of CASOS.enHorario) assert.equal(SMS.enHorario(c.entrada.cfg, c.entrada.ms), c.salida, JSON.stringify(c));
  for (const c of CASOS.baja) assert.equal(SMS.RE_BAJA.test(c.entrada), c.salida, JSON.stringify(c));
});
