// Bus de tareas (tareas.js) con el registro central (registro.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const simular = require("./simular-chrome");
const st = simular();
require("../registro.js");
const BUS = require("../tareas.js");

test.beforeEach(() => st.poner({ tareas: {} }));

test("solo acepta robots y acciones del registro", async () => {
  await assert.rejects(BUS.crear({ robot: "xx", accion: "revisar" }), /registro/);
  await assert.rejects(BUS.crear({ robot: "tx", accion: "mandar" }), /no tiene la acción/); // Texi NO tiene acciones en el bus (SMS solo con el jefe)
});
test("ciclo normal: pendiente → corriendo → hecha", async () => {
  const t = await BUS.crear({ robot: "ch", accion: "revisar" });
  assert.equal(t.estado, "pendiente");
  const r = await BUS.reclamar("ch", "pestañaA");
  assert.equal(r.id, t.id); assert.equal(r.estado, "corriendo");
  assert.equal(await BUS.reclamar("ch", "pestañaB"), null); // otra pestaña no la vuelve a tomar
  assert.deepEqual(await BUS.latido(t.id, "pestañaA"), { seguir: true });
  const h = await BUS.terminar(t.id, "pestañaA", { ok: true, resultado: "Listo: 3 revisados" });
  assert.equal(h.estado, "hecha"); assert.equal(h.resultado, "Listo: 3 revisados");
});
test("no duplica: misma acción viva o misma clave idem", async () => {
  const a = await BUS.crear({ robot: "zb", accion: "revisar" });
  const b = await BUS.crear({ robot: "zb", accion: "revisar" });
  assert.equal(b.id, a.id); assert.equal(b.repetida, true);
});
test("acción con aprobación: Capi la deja esperando; el jefe aprueba o rechaza", async () => {
  const t = await BUS.crear({ robot: "li", accion: "limpiar", origen: "capi" });
  assert.equal(t.estado, "aprobacion");
  assert.equal(await BUS.reclamar("li", "x"), null); // nadie la puede correr sin aprobación
  assert.equal((await BUS.decidir(t.id, true)).estado, "pendiente");
  assert.equal((await BUS.reclamar("li", "x")).id, t.id);
  const t2 = await BUS.crear({ robot: "li", accion: "limpiar", origen: "capi", idem: "otra" });
  assert.equal(t2.id, t.id); // sigue viva la anterior
});
test("si el jefe la crea, no necesita aprobación", async () => {
  assert.equal((await BUS.crear({ robot: "li", accion: "limpiar", origen: "jefe" })).estado, "pendiente");
});
test("rechazar", async () => {
  const t = await BUS.crear({ robot: "li", accion: "limpiar" });
  assert.equal((await BUS.decidir(t.id, false)).estado, "rechazada");
  await assert.rejects(BUS.decidir(t.id, true), /ya no espera/);
});
test("falla: se reintenta una vez y luego queda fallida", async () => {
  const t = await BUS.crear({ robot: "rs", accion: "revisar" });
  await BUS.reclamar("rs", "a"); assert.equal((await BUS.terminar(t.id, "a", { ok: false, error: "Lofty 500" })).estado, "pendiente");
  await BUS.reclamar("rs", "a"); assert.equal((await BUS.terminar(t.id, "a", { ok: false, error: "Lofty 500" })).estado, "fallida");
});
test("solo el dueño puede terminarla", async () => {
  const t = await BUS.crear({ robot: "ch", accion: "revisar" });
  await BUS.reclamar("ch", "a");
  await BUS.terminar(t.id, "b", { ok: true });
  assert.equal((await BUS.listar())[0].estado, "corriendo");
});
test("cancelar: pendiente se cancela; corriendo se pide y se cancela al terminar", async () => {
  const t = await BUS.crear({ robot: "ch", accion: "revisar" });
  assert.equal((await BUS.cancelar(t.id)).estado, "cancelada");
  const u = await BUS.crear({ robot: "ch", accion: "revisar" });
  await BUS.reclamar("ch", "a"); await BUS.cancelar(u.id);
  assert.deepEqual(await BUS.latido(u.id, "a"), { seguir: false });
  assert.equal((await BUS.terminar(u.id, "a", { ok: true })).estado, "cancelada");
});
test("vigía: robot sin latido suelta la tarea; aprobación vieja vence", async () => {
  const t = await BUS.crear({ robot: "ch", accion: "revisar" });
  await BUS.reclamar("ch", "a");
  assert.equal(await BUS.vigilar(Date.now() + BUS.LATIDO_MAX + 1000), 1);
  assert.equal((await BUS.listar())[0].estado, "pendiente");
  const ap = await BUS.crear({ robot: "li", accion: "limpiar" });
  await BUS.vigilar(Date.now() + 25 * 3600e3);
  assert.equal((await BUS.listar()).find((x) => x.id === ap.id).estado, "cancelada");
});
test("registro: cada robot tiene supervisor válido y página", () => {
  const R = globalThis.REGISTRO;
  for (const [id, r] of Object.entries(R.ROBOTS)) { assert.ok(R.SUPERVISORES[r.supervisor], id); assert.ok(r.pagina, id); }
  assert.ok(!R.acciones().some((a) => a.robot === "tx" || a.robot === "al")); // ningún SMS por el bus
});
