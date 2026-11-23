const test = require("node:test");
const assert = require("node:assert/strict");
const simular = require("./simular-chrome");
const st = simular();
const P = require("../presupuesto.js");
test.beforeEach(() => st.poner({ llmUso: {}, llmTopes: {} }));

test("dentro del tope se puede; al pasarlo, no", async () => {
  st.poner({ llmTopes: { GEO: { entrada: 1000, salida: 100 } } });
  assert.equal((await P.revisar("GEO")).ok, true);
  await P.registrar("GEO", { input_tokens: 900, output_tokens: 50 });
  assert.equal((await P.revisar("GEO")).ok, true);
  await P.registrar("GEO", { input_tokens: 200, output_tokens: 10 });
  const r = await P.revisar("GEO"); assert.equal(r.ok, false); assert.match(r.motivo, /presupuesto/);
  assert.equal((await P.revisar("CRM")).ok, true); // cada supervisor tiene el suyo
});
test("la salida también tiene tope; el caché cuenta como entrada", async () => {
  st.poner({ llmTopes: { OPS: { entrada: 10000, salida: 100 } } });
  await P.registrar("OPS", { input_tokens: 10, cache_read_input_tokens: 500, output_tokens: 100 });
  assert.equal((await P.revisar("OPS")).ok, false);
  const r = (await P.resumen()).find((x) => x.quien === "OPS");
  assert.equal(r.entrada, 510); assert.equal(r.llamadas, 1);
});
test("cambia de día: se reinicia", async () => {
  st.poner({ llmUso: { dia: "2000-01-01", por: { capi: { entrada: 1e9, salida: 1e9 } } } });
  assert.equal((await P.revisar("capi")).ok, true);
});
test("falla cerrada si no se puede leer", async () => {
  const get = chrome.storage.local.get; chrome.storage.local.get = async () => { throw new Error("roto"); };
  try { assert.equal((await P.revisar("capi")).ok, false); } finally { chrome.storage.local.get = get; }
});
test("quien no existe usa el tope de robots", async () => {
  st.poner({ llmTopes: { robots: { entrada: 1, salida: 1 } } });
  await P.registrar("raro", { input_tokens: 5, output_tokens: 5 });
  assert.equal((await P.revisar("raro")).ok, false);
});
