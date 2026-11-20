// node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../lofty-core.js");

const fila = (o) => ({ "First Name": "Ana", "Last Name": "Ruiz", "Address": "1 Oak St", "City": "Irvine", "State": "CA", "Zip": "92618", ...o });
const correr = (filas, opts = {}) => { const h = Object.keys(filas[0]); return C.processRows(filas, C.detect(h), { dropDnc: true, excludeEntities: true, requirePhone: true, ...opts }); };

test("DNC con el formato de Propwire/Wibi 'Do Not 1 Call'", () => {
  const [r] = correr([fila({ "Phone 1": "9495551234", "Do Not 1 Call": "DNC", "Phone 2": "7145550000", "Do Not 2 Call": "" })]);
  assert.deepEqual(r.phones, ["7145550000"]); assert.equal(r.dncDropped, 1);
});
test("DNC con el formato 'Phone 1 DNC' (el que arma Lofti desde el lote)", () => {
  const [r] = correr([fila({ "Phone 1": "9495551234", "Phone 1 DNC": "DNC" })]);
  assert.equal(r.status, "excluded"); assert.match(r.reason, /DNC/);
});
test("DNC dentro del número", () => {
  const [r] = correr([fila({ "Phone 1": "9495551234 DNC", "Phone 2": "7145550000" })]);
  assert.deepEqual(r.phones, ["7145550000"]);
});
test("si apagas 'quitar DNC' el número pasa (decisión del usuario)", () => {
  const [r] = correr([fila({ "Phone 1": "9495551234", "Do Not 1 Call": "DNC" })], { dropDnc: false });
  assert.deepEqual(r.phones, ["9495551234"]);
});
test("litigators nunca pasan", () => {
  const [r] = correr([fila({ "Phone 1": "9495551234", "Litigator": "Yes" })]);
  assert.equal(r.status, "excluded"); assert.match(r.reason, /Litigator/);
  const [r2] = correr([fila({ "Phone 1": "9495551234", "Litigator": "No" })]);
  assert.equal(r2.status, "ok");
});
test("empresas y trusts se excluyen", () => {
  const [r] = correr([fila({ "First Name": "", "Last Name": "", "Owner Name": "SMITH FAMILY TRUST", "Phone 1": "9495551234" })]);
  assert.equal(r.status, "excluded");
});
test("repetidos en el lote se unen (St = Street)", () => {
  const rs = correr([fila({ "Phone 1": "9495551234" }), fila({ "Address": "1 Oak Street", "Phone 1": "7145550000" })]);
  assert.equal(rs.filter((r) => r.status === "ok").length, 1);
  assert.deepEqual(rs[0].phones, ["9495551234", "7145550000"]);
});
test("CSV: neutraliza fórmulas (= + - @)", () => {
  for (const v of ["=cmd|x", "+1+2", "-2+3", "@sum(A1)"]) assert.equal(C.csvCell(v)[0] === "'" || C.csvCell(v).startsWith("\"'"), true, v);
  assert.equal(C.csvCell("Ana"), "Ana");
  const csv = C.buildCsv([{ first: "=HYPERLINK(\"x\")", last: "", phones: ["9495551234"], emails: [], street: "1 Oak", city: "Irvine", state: "CA", zip: "92618", status: "ok" }], { tag1: "t" });
  assert.ok(!/(^|,)=HYPERLINK/.test(csv.split("\r\n")[1]));
});
test("teléfonos: 10 dígitos y lada que no empieza con 0/1", () => {
  const [r] = correr([fila({ "Phone 1": "0123456789", "Phone 2": "1 (949) 555-1234" })]);
  assert.deepEqual(r.phones, ["9495551234"]);
});
test("Fase 4: con Vali, los números imposibles o de mentira no pasan", () => {
  const VALI = require("../vali-core.js");
  const filas = [fila({ "Phone 1": "800-372-8811", "Phone 2": "949-555-0123", "Phone 3": "949-372-8811" })];
  const [r] = C.processRows(filas, C.detect(Object.keys(filas[0])), { dropDnc: true, requirePhone: true, validarTel: VALI.telefono });
  assert.deepEqual(r.phones, ["9493728811"]); assert.equal(r.falsosDropped, 2);
});
