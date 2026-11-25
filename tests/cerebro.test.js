// Cerebro (Fase Anna 1): reglas puras de contacto
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../cerebro-core.js");

const AHORA = Date.parse("2026-11-25T18:00:00Z"), MIN = 60e3, H = 3600e3;
const out = (minAntes, tipo = "Manual", agentId = 1) => ({ t: AHORA - minAntes * MIN, direccion: "out", tipo, agentId });
const inn = (minAntes) => ({ t: AHORA - minAntes * MIN, direccion: "in", tipo: "", agentId: null });

test("sin historial: sí puede", () => {
  assert.equal(C.revisar({ ahora: AHORA, leadId: "1" }).ok, true);
});
test("máximo 1 SMS cada 24 h entre todos (incluye a Anna y a otros robots)", () => {
  const r1 = C.revisar({ ahora: AHORA, leadId: "1", contactos: [{ t: AHORA - 2 * H, leadId: "1", canal: "sms", robot: "Texi" }] });
  assert.equal(r1.ok, false); assert.equal(r1.codigo, "24h"); assert.match(r1.motivo, /Texi/);
  const r2 = C.revisar({ ahora: AHORA, leadId: "1", textos: [out(30, "AI")] });
  assert.equal(r2.ok, false); assert.match(r2.motivo, /Anna/);
  assert.equal(C.revisar({ ahora: AHORA, leadId: "1", contactos: [{ t: AHORA - 25 * H, leadId: "1", canal: "sms", robot: "Texi" }] }).ok, true);
});
test("una persona le escribió en 24 h (SMS Manual que no es de un robot): nada, ni llamada", () => {
  const r = C.revisar({ ahora: AHORA, leadId: "1", canal: "llamada", textos: [out(40, "Manual", 347)] });
  assert.equal(r.ok, false); assert.equal(r.codigo, "persona"); assert.match(r.motivo, /347/);
});
test("un SMS Manual que coincide con uno de nuestros robots (±5 min) NO cuenta como persona", () => {
  const contactos = [{ t: AHORA - 40 * MIN + 30e3, leadId: "1", canal: "sms", robot: "Texi" }];
  const r = C.revisar({ ahora: AHORA, leadId: "1", canal: "llamada", contactos, textos: [out(40)] });
  assert.equal(r.ok, true);
});
test("Anna: si está en su pool y no silenciado, los robots normales no lo tocan; Rayo sí puede revisar", () => {
  assert.equal(C.revisar({ ahora: AHORA, leadId: "1", anna: { enPool: true, silenciado: false } }).codigo, "anna");
  assert.equal(C.revisar({ ahora: AHORA, leadId: "1", anna: { enPool: true, silenciado: true } }).ok, true);
  assert.equal(C.revisar({ ahora: AHORA, leadId: "1", anna: { enPool: true }, respetaAnna: false }).ok, true);
});
test("Resi puede contestar a quien nos escribió después de nuestro último SMS, aunque sea en las mismas 24 h", () => {
  const contactos = [{ t: AHORA - 3 * H, leadId: "1", canal: "sms", robot: "Texi" }];
  const textos = [out(180), inn(20)];
  assert.equal(C.revisar({ ahora: AHORA, leadId: "1", contactos, textos, esRespuesta: true }).ok, true);
  assert.equal(C.revisar({ ahora: AHORA, leadId: "1", contactos, textos }).ok, false); // sin ser respuesta: no
});
test("annaYaEscribio y conversión desde la API de Lofty", () => {
  assert.equal(C.annaYaEscribio([out(5, "AI")]), true);
  assert.equal(C.annaYaEscribio([out(5, "Manual")]), false);
  const x = C.deLofty({ direction: "Outbound", textType: "AI", agentId: 9, textTime: "2026-11-23T23:49:57GMT" });
  assert.deepEqual(x, { t: Date.parse("2026-11-23T23:49:57Z"), direccion: "out", tipo: "AI", agentId: 9 });
  assert.equal(C.deLofty({ direction: "Inbound", textTime: "2026-11-23T23:49:57GMT" }).direccion, "in");
});
