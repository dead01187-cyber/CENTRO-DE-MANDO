// Fase C: comparación de la sombra de Rayo (extensión vs puente)
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../ry-sombra.js");

test("decisiones: extensión y puente se traducen a lo mismo", () => {
  assert.equal(S.decisionExt({ estado: "hecho" }), "contactar");
  assert.equal(S.decisionExt({ estado: "saltado" }), "saltar");
  assert.equal(S.decisionExt({ estado: "por aprobar" }), "pendiente");
  assert.equal(S.decisionPuente({ estado: "descartado" }), "descartado");
  assert.equal(S.decisionPuente({ estado: "por aprobar", haria: "ganó Anna" }), "ganó Anna");
  assert.equal(S.decisionPuente({ estado: "por aprobar" }), "pendiente");
});

test("comparar: iguales, distintos, pendientes y los que solo vio uno", () => {
  const local = { 1: { leadId: "1", nombre: "Ana", apellido: "Uno", estado: "hecho" }, 2: { leadId: "2", nombre: "Bea", estado: "ganó Anna" }, 3: { leadId: "3", nombre: "Cris", estado: "por aprobar" },
    4: { leadId: "4", nombre: "Dan", estado: "descartado", motivo: "no son de California" }, 6: { leadId: "6", nombre: "Fer", estado: "hecho" } };
  const puente = S.mapa([{ leadId: "1", estado: "por aprobar", haria: "contactar" }, { leadId: 2, estado: "por aprobar", haria: "contactar", motivo: "SMS" }, { leadId: "3", estado: "por aprobar", haria: "contactar" },
    { leadId: "4", estado: "descartado" }, { leadId: "5", nombre: "Eva", estado: "por aprobar", haria: "saltar" }]);
  const c = S.comparar(local, puente);
  assert.deepEqual([c.iguales, c.distintos, c.pendientes, c.soloExt, c.soloPuente, c.comparables, c.pct], [2, 1, 1, 1, 1, 3, 67]);
  assert.equal(c.filas[0].tipo, "distinto", "los distintos van primero");
  assert.equal(c.filas[0].leadId, "2");
  assert.equal(c.filas.find((f) => f.leadId === "1").nombre, "Ana Uno");
  assert.equal(S.comparar({}, {}).pct, null);
});
