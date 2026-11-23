// Núcleos de los robots de la Fase 4: Vali, Cumpli, Qai, Punti y Ana
const test = require("node:test");
const assert = require("node:assert/strict");
const VALI = require("../vali-core.js"), CUMPLI = require("../cumpli-core.js"), QA = require("../qa-core.js"), PUNTI = require("../punti-core.js"), ANA = require("../ana-core.js");
const REGISTRO = require("../registro.js");

test("Vali: teléfonos buenos, dudosos y malos", () => {
  assert.equal(VALI.telefono("(949) 555-1234").nivel, "dudoso");      // 555 casi nunca es real
  assert.equal(VALI.telefono("949-372-8811").nivel, "ok");
  assert.equal(VALI.telefono("+1 212 372 8811").nivel, "dudoso");     // fuera de CA
  for (const t of ["0123456789", "9491234567".replace("949", "149"), "800-372-8811", "949-911-1234", "5555555555", "2345678901", "949-555-0123", "949-0123", "900-372-8811"])
    assert.equal(VALI.telefono(t).nivel, "malo", t);
});
test("Vali: lote detecta números compartidos, sin nombre, empresa y sin CP", () => {
  const r = VALI.lote([
    { owner: "Ana Ruiz", address: "1 Oak St, Irvine, CA 92618", phones: [{ num: "(949) 372-8811" }] },
    { owner: "Luis Paz", address: "2 Elm St, Irvine, CA 92618", phones: [{ num: "(949) 372-8811" }, { num: "8003728811" }] },
    { owner: "", address: "3 Pine St", phones: [{ num: "7143728811" }] },
    { owner: "OAK HOLDINGS LLC", address: "4 Ash St, Irvine, CA 92618", phones: [] },
  ]);
  assert.equal(r.resumen.compartidos, 1);
  assert.equal(r.filas[0].nivel, "dudoso");
  assert.equal(r.filas[1].telefonos[1].nivel, "malo");
  assert.equal(r.filas[2].nivel, "malo"); assert.ok(r.filas[2].problemas.includes("domicilio sin código postal"));
  assert.equal(r.filas[3].nivel, "malo");
});
test("Cumpli: SMS a baja, fuera de horario, repetidos y tope", () => {
  const t0 = Date.parse("2026-01-15T18:00:00Z"); // 10:00 en California
  const st = {
    smsBajas: { tels: { "9493728811": { t: t0 - 3600e3, motivo: "baja" } }, leads: {} },
    smsPolitica: { tope: 1 },
    smsRegistro: [
      { t: t0, estado: "enviado", fuente: "Texi", tel: "9493728811" },               // después de la baja
      { t: t0 + 60e3, estado: "enviado", fuente: "Texi", tel: "9493728811" },        // mismo día
      { t: Date.parse("2026-01-16T06:30:00Z"), estado: "enviado", fuente: "Marki", tel: "7143728811" }, // 22:30 California
      { t: t0, estado: "bloqueado", fuente: "Texi", tel: "1" },
    ],
    loftyAuto: true, alCfg: { deleteNonCA: true },
  };
  const r = CUMPLI.auditar(st, { ahora: t0 + 864e5 });
  const reglas = r.hallazgos.map((h) => h.regla);
  assert.ok(reglas.includes("SMS a una baja")); assert.ok(reglas.includes("Fuera de horario"));
  assert.ok(reglas.includes("Varios SMS el mismo día")); assert.ok(reglas.includes("Se pasó el tope diario"));
  assert.ok(reglas.includes("Marki borra números")); assert.ok(reglas.includes("Subida automática a Lofty prendida"));
  assert.equal(r.resumen.smsRevisados, 3); assert.equal(r.hallazgos[0].gravedad, "alta");
});
test("Cumpli: sin problemas, sin hallazgos", () => {
  const t0 = Date.parse("2026-01-15T18:00:00Z");
  const r = CUMPLI.auditar({ smsRegistro: [{ t: t0, estado: "enviado", fuente: "Texi", tel: "9493728811" }] }, { ahora: t0 + 3600e3 });
  assert.equal(r.hallazgos.length, 0);
});
test("Qai: almacenamiento, tareas atoradas, llaves, errores de código", () => {
  const ahora = Date.now();
  const st = { tareas: { a: { robot: "ch", accion: "revisar", estado: "corriendo", latido: ahora - 10 * 60e3 } }, loftyKey: "x",
    svEventos: [{ t: ahora - 1000, mod: "zb", nivel: "error", texto: "Error de código: x is not defined (zb.js:10)" }], smsPolitica: { desde: 6 } };
  const r = QA.chequeos(st, { bytes: 9.5 * 1048576, registro: REGISTRO, ahora });
  const e = Object.fromEntries(r.chequeos.map((c) => [c.nombre, c.estado]));
  assert.equal(e["Almacenamiento"], "falla"); assert.equal(e["Tareas atoradas"], "falla"); assert.equal(e["API keys"], "aviso");
  assert.equal(e["Errores de código"], "falla"); assert.equal(e["Política de SMS"], "falla"); assert.equal(e["Registro de agentes"], "ok");
  assert.ok(!JSON.stringify(r).includes('"x"')); // nunca muestra el valor de una llave
});
test("Punti: ordena por señales y explica", () => {
  const ctx = { zonas: { "92618": 90, "92701": 20 }, vali: VALI };
  const r = PUNTI.ordenar([
    { owner: "Ana Ruiz", address: "1 Oak St, Irvine, CA 92618", phones: [{ num: "9493728811" }], categoria: "interesado" },
    { owner: "Luis Paz", address: "2 Elm St, Santa Ana, CA 92701", phones: [{ num: "7143728811" }] },
    { owner: "Eva Sol", address: "3 Pine St, Irvine, CA 92618", phones: [{ num: "9493728812" }], categoria: "baja" },
    { owner: "Rita Paz", address: "4 Ash St, Irvine, CA 92618", phones: [{ num: "8003728811" }], hecm: { parientes: [{}] } },
  ], ctx);
  assert.equal(r[0].owner, "Ana Ruiz"); assert.equal(r[0].nivel, "alto");
  assert.equal(r[r.length - 1].owner, "Eva Sol"); assert.equal(r[r.length - 1].score, 0);
  assert.ok(r.find((x) => x.owner === "Rita Paz").razones.some((z) => /sin teléfonos que sirvan/.test(z)));
});
test("Ana: métricas de SMS, respuestas y tareas", () => {
  const ahora = Date.parse("2026-01-15T20:00:00Z");
  const st = {
    smsRegistro: [{ t: ahora - 3600e3, estado: "enviado", fuente: "Texi", tel: "1" }, { t: ahora - 7200e3, estado: "enviado", fuente: "Marki", tel: "2" }, { t: ahora, estado: "bloqueado", motivo: "fuera de horario: solo de 8:00", tel: "3" }],
    txEnviados: { 1: {}, 2: {}, 3: {}, 4: {} },
    rsCasos: { 1: { categoria: "interesado", conv: [{ dir: "in" }] }, 2: { categoria: "baja", conv: [{ dir: "in" }] } },
    tareas: { a: { estado: "hecha", inicio: 1000, fin: 5000 }, b: { estado: "fallida" } },
  };
  const m = ANA.metricas(st, { ahora, dias: 7 });
  assert.equal(m.sms.enviados, 2); assert.equal(m.sms.porRobot.Texi, 1); assert.equal(m.sms.bloqueados, 1);
  assert.equal(m.respuestas.tasaRespuesta, 50); assert.equal(m.respuestas.interesados, 1); assert.equal(m.respuestas.bajas, 1);
  assert.equal(m.tareas.porEstado.hecha, 1); assert.equal(m.tareas.duracionPromedioSeg, 4);
  assert.equal(Object.keys(m.sms.porDia).length, 7);
});
