// node tests/politica-sms.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const simular = require("./simular-chrome");

const st = simular();
const SMS = require("../politica-sms.js");
const RealDate = Date;
// Fija la hora "ahora" en California (PST = UTC-8 en enero)
function horaFija(isoUtc) { const t = RealDate.parse(isoUtc); globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } }; }
const enHorarioCA = () => horaFija("2026-01-15T18:00:00Z"); // 10:00 en California

test.beforeEach(() => { st.poner({ smsBajas: { tels: {}, leads: {} }, smsConteo: {}, smsPolitica: {}, smsRegistro: [] }); enHorarioCA(); });
test.after(() => { globalThis.Date = RealDate; });

test("manda a un número de CA en horario", async () => {
  assert.deepEqual(await SMS.puedeMandar({ tel: "(949) 555-1234", leadId: 1 }), { ok: true });
});
test("número que no es de CA: no se manda", async () => {
  const r = await SMS.puedeMandar({ tel: "212-555-1234", leadId: 1 });
  assert.equal(r.ok, false); assert.match(r.motivo, /California/);
});
test("número inválido: no se manda", async () => {
  assert.equal((await SMS.puedeMandar({ tel: "555-1234" })).ok, false);
});
test("fuera de horario (7:59 y 21:00 en California): no se manda", async () => {
  horaFija("2026-01-15T15:59:00Z"); // 7:59 PST
  assert.equal((await SMS.puedeMandar({ tel: "9495551234" })).horario, true);
  horaFija("2026-01-16T05:00:00Z"); // 21:00 PST
  assert.equal((await SMS.puedeMandar({ tel: "9495551234" })).horario, true);
  horaFija("2026-07-15T15:30:00Z"); // 8:30 PDT (verano)
  assert.equal((await SMS.puedeMandar({ tel: "9495551234" })).ok, true);
});
test("el horario configurado nunca sale de 8–21", async () => {
  st.poner({ smsPolitica: { desde: 5, hasta: 23 } });
  const c = await SMS.config(); assert.equal(c.desde, 8); assert.equal(c.hasta, 21);
});
test("baja por número bloquea en cualquier cuenta y queda permanente", async () => {
  await SMS.marcarBaja({ tel: "+1 949 555 1234", motivo: "baja", fuente: "Resi" });
  for (const cuenta of ["tx", "al", "lofty"]) {
    const r = await SMS.puedeMandar({ tel: "9495551234", leadId: 99, cuenta });
    assert.equal(r.ok, false); assert.equal(r.baja, true);
  }
  await SMS.marcarBaja({ tel: "9495551234", motivo: "otro", fuente: "Texi" }); // no se sobrescribe
  assert.equal(st.datos().smsBajas.tels["9495551234"].motivo, "baja");
});
test("baja por lead bloquea todos sus números en esa cuenta", async () => {
  await SMS.marcarBaja({ leadId: 7, cuenta: "tx", motivo: "enojado" });
  assert.equal((await SMS.puedeMandar({ tel: "7145550000", leadId: 7, cuenta: "tx" })).baja, true);
  assert.equal((await SMS.puedeMandar({ tel: "7145550000", leadId: 7, cuenta: "al" })).ok, true); // otra cuenta = otro lead
});
test("quitarBaja solo cuando se pide", async () => {
  await SMS.marcarBaja({ tel: "9495551234", motivo: "baja" });
  await SMS.quitarBaja({ tel: "9495551234" });
  assert.equal((await SMS.puedeMandar({ tel: "9495551234" })).ok, true);
});
test("tope diario compartido; devolverLugar regresa el lugar", async () => {
  st.poner({ smsPolitica: { tope: 2 } });
  assert.equal((await SMS.puedeMandar({ tel: "9495551231" })).ok, true);
  assert.equal((await SMS.puedeMandar({ tel: "9495551232" })).ok, true);
  assert.equal((await SMS.puedeMandar({ tel: "9495551233" })).tope, true);
  await SMS.devolverLugar();
  assert.equal((await SMS.puedeMandar({ tel: "9495551233" })).ok, true);
});
test("falla cerrada: si storage falla, no se manda", async () => {
  const get = chrome.storage.local.get; chrome.storage.local.get = async () => { throw new Error("storage roto"); };
  try { const r = await SMS.puedeMandar({ tel: "9495551234" }); assert.equal(r.ok, false); assert.match(r.motivo, /no se manda/); }
  finally { chrome.storage.local.get = get; }
});
test("registro de comunicaciones", async () => {
  await SMS.anotar({ fuente: "Texi", tel: "9495551234", estado: "enviado" });
  assert.equal(st.datos().smsRegistro.length, 1);
});
test("palabras de baja en inglés y español", () => {
  for (const t of ["STOP", "stop all", "Unsubscribe", "ALTO", "Para", "pare.", "cancelar", "REVOKE", "no me escribas", "Bórrame", "quit"]) assert.ok(SMS.RE_BAJA.test(t), t);
  for (const t of ["Para mañana está bien?", "How much would you offer?", "Sí me interesa"]) assert.ok(!SMS.RE_BAJA.test(t), t);
});
