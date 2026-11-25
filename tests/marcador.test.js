// Marcador vs Anna (Fase Anna 3): cálculo puro
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../marcador-core.js");
const AHORA = Date.parse("2026-11-25T20:00:00Z"), MIN = 60e3, DIA = 864e5;
const out = (t, tipo = "Manual") => ({ t, direccion: "out", tipo, texto: "hi" });
const inn = (t, texto = "yes") => ({ t, direccion: "in", tipo: "", texto });

test("cada lead cuenta para quien lo contactó primero", () => {
  assert.deepEqual(M.duenoDe({ textos: [out(AHORA - 10 * MIN, "AI")], contactos: [{ t: AHORA - 5 * MIN }] }), { bando: "anna", primero: AHORA - 10 * MIN });
  assert.deepEqual(M.duenoDe({ textos: [out(AHORA - 3 * MIN, "AI")], contactos: [{ t: AHORA - 5 * MIN }] }), { bando: "robots", primero: AHORA - 5 * MIN });
  assert.equal(M.duenoDe({ textos: [out(AHORA, "Manual")], contactos: [] }), null); // una persona no es ni Anna ni robot
});

test("marcador de 7 días: contactados, minutos (mediana), % contestó, Warm/Hot, citas y bajas", () => {
  const creado = AHORA - 2 * DIA;
  const leads = [
    // Anna: tardó 10 y 20 min; uno contestó STOP
    { creado, etapa: "New Leads", textos: [out(creado + 10 * MIN, "AI"), inn(creado + 60 * MIN, "STOP")] },
    { creado, etapa: "Warm", textos: [out(creado + 20 * MIN, "AI")] },
    // Robots: 1 y 3 min; uno contestó, está Hot y con cita
    { creado, etapa: "Hot", contactos: [{ t: creado + 1 * MIN }], textos: [inn(creado + 30 * MIN, "yes call me")], citas: [{ creado: creado + 2 * 60 * MIN }] },
    { creado, etapa: "New Leads", contactos: [{ t: creado + 3 * MIN }] },
    // fuera de la ventana de 7 días
    { creado: AHORA - 20 * DIA, contactos: [{ t: AHORA - 20 * DIA }] },
  ];
  const r = M.marcador(leads, { ahora: AHORA, dias: 7 });
  assert.equal(r.anna.contactados, 2); assert.equal(r.robots.contactados, 2);
  assert.equal(r.anna.minutosMediana, 15); assert.equal(r.robots.minutosMediana, 2);
  assert.equal(r.anna.pctContesto, 50); assert.equal(r.robots.pctContesto, 50);
  assert.equal(r.anna.warmHot, 1); assert.equal(r.robots.warmHot, 1);
  assert.equal(r.robots.citas, 1); assert.equal(r.anna.citas, 0);
  assert.equal(r.anna.bajas, 1); assert.equal(r.robots.bajas, 0);
  assert.deepEqual(r.ganador, { contactados: "empate", minutosMediana: "robots", pctContesto: "empate", warmHot: "empate", citas: "robots", pctBajas: "robots" });
  assert.equal(M.marcador(leads, { ahora: AHORA, dias: 30 }).robots.contactados, 3);
});

test("SMS de Lofty → formato del marcador (con el texto, para detectar STOP)", () => {
  assert.deepEqual(M.textoDeLofty({ direction: "Inbound", textTime: "2026-11-23T23:49:57GMT", textContent: "STOP" }), { t: Date.parse("2026-11-23T23:49:57Z"), direccion: "in", tipo: "", texto: "STOP" });
  assert.equal(M.RE_BAJA.test("Please remove me"), true); assert.equal(M.RE_BAJA.test("yes interested"), false);
});
