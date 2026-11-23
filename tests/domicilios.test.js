// Escrituras de "addresses" (comun.cambiarDomicilios y el respaldo de domicilios())
const test = require("node:test");
const assert = require("node:assert/strict");
const simular = require("./simular-chrome");
const st = simular();
globalThis.chrome.runtime = { sendMessage: () => Promise.reject(new Error("sin background")) }; // background caído
require("../comun.js");
const { domicilios, keyOf } = globalThis;

const dir = (street, extra = {}) => ({ street, city: "Irvine", zip: "92618", state: "CA", ...extra });
test.beforeEach(() => st.poner({ addresses: {
  [keyOf(dir("1 A St"))]: dir("1 A St"),
  [keyOf(dir("2 B St"))]: dir("2 B St", { origen: "lofty", leadId: "9" }),
  [keyOf(dir("3 C St"))]: dir("3 C St", { origen: "hecm", hecm: { lender: "Celink" } }),
} }));

test("sin background, 'hecm' sí escribe (antes se perdía en silencio)", async () => {
  const r = await domicilios("hecm", { items: [dir("4 D St", { hecm: { lender: "Celink", dueno: "X" } })] });
  assert.equal(r.sinFondo, true);
  const a = st.datos().addresses[keyOf(dir("4 D St"))];
  assert.equal(a.origen, "hecm"); assert.equal(a.hecm.dueno, "X");
});
test("sin background, 'hecmInfo' actualiza la ficha", async () => {
  await domicilios("hecmInfo", { items: [dir("3 C St", { hecm: { monto: "100" } })] });
  assert.equal(st.datos().addresses[keyOf(dir("3 C St"))].hecm.monto, "100");
});
test("'borrarPropi' solo borra la línea de Propi", async () => {
  await domicilios("borrarPropi");
  const ks = Object.values(st.datos().addresses).map((a) => a.street).sort();
  assert.deepEqual(ks, ["2 B St", "3 C St"]);
});
test("acción desconocida: error (antes respondía ok)", async () => {
  await assert.rejects(domicilios("inventada"));
});
test("pasaFiltro: sin revisar no pasa; 'sinRevisar' no pasa", () => {
  const { pasaFiltro } = globalThis, cfg = { chActivo: true, loftyKey: "k" };
  assert.equal(pasaFiltro({}, cfg), false);
  assert.equal(pasaFiltro({ lofty: "sinRevisar" }, cfg), false);
  assert.equal(pasaFiltro({ lofty: "no" }, cfg), true);
});
test("filtroDe: la línea HECM usa el interruptor de Chequi 3", () => {
  const { filtroDe } = globalThis;
  assert.equal(filtroDe("hr", { chActivo: false, ch3Config: {}, loftyKey: "k" }).chActivo, true);
  assert.equal(filtroDe("hr", { chActivo: true, ch3Config: { activo: false } }).chActivo, false);
  assert.equal(filtroDe("", { chActivo: false }).chActivo, false);
});
