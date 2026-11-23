// Núcleo del tablero (Fase 5): todo sale de storage, nada del DOM
const test = require("node:test");
const assert = require("node:assert/strict");
const REGISTRO = require("../registro.js");
globalThis.PRESUPUESTO = require("../presupuesto.js");
const T = require("../tablero-core.js");
const ahora = Date.parse("2026-01-15T20:00:00Z");
const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(ahora);

const base = () => ({
  robotsApagados: { tx: true },
  rbEstado_ch: { estado: "trabajando", texto: "Revisando…", t: ahora - 60e3 },
  rbEstado_zb: { estado: "trabajando", texto: "Leyendo Gmail", t: ahora - 30 * 60e3 }, // lleva 30 min sin moverse
  rbEstado_bv: { estado: "error", texto: "captcha", t: ahora - 1000 },
  tareas: {
    a: { id: "a", robot: "ch", accion: "revisar", estado: "hecha", inicio: ahora - 9000, fin: ahora - 3000, actualizada: ahora - 3000 },
    b: { id: "b", robot: "ch", accion: "revisar", estado: "fallida", actualizada: ahora - 2000 },
    c: { id: "c", robot: "li", accion: "limpiar", estado: "aprobacion", actualizada: ahora - 1000 },
  },
  svEventos: [{ t: ahora - 1000, mod: "bv", nivel: "error", texto: "captcha" }, { t: ahora - 2 * 864e5, mod: "pw", nivel: "error", texto: "viejo" }],
  llmUso: { dia, por: { capi: { entrada: 1000000, salida: 10000, llamadas: 5 }, OPS: { entrada: 280000, salida: 1000, llamadas: 2 } } },
  smsRegistro: [{ t: ahora - 3600e3, estado: "enviado" }, { t: ahora - 3500e3, estado: "bloqueado" }],
  rsCasos: { 1: { estado: "abierto", categoria: "interesado" } },
  cuRes: { altas: 0, medias: 1 }, qaRes: { fallas: 0, avisos: 2 },
  mision: { zona: "Irvine", meta: 100, estado: "corriendo", subidosBase: 0, inicio: ahora - 600e3 }, loftyListos: 12,
});

test("robots: estado guardado, apagado, sin señal y rendimiento", () => {
  const t = T.construir(base(), REGISTRO, { ahora });
  const r = Object.fromEntries(t.robots.map((x) => [x.id, x]));
  assert.equal(r.tx.estado, "apagado"); assert.equal(r.ch.estado, "trabajando"); assert.equal(r.zb.estado, "sin señal"); assert.equal(r.rs.estado, "sin datos");
  assert.equal(r.ch.exito, 50); assert.equal(r.ch.duracionSeg, 6); assert.equal(r.bv.errores24, 1);
  assert.equal(t.robots.length, REGISTRO.ids().length);
});
test("supervisores, tareas, errores y misión", () => {
  const t = T.construir(base(), REGISTRO, { ahora });
  const crm = t.supervisores.find((s) => s.id === "CRM");
  assert.ok(crm.conProblema >= 2); // Veri en error y Zeta sin señal
  assert.equal(t.tareas.porEstado.aprobacion, 1); assert.equal(t.tareas.lista[0].viva, true);
  assert.equal(t.errores.ultimas24h, 1); assert.equal(t.errores.porRobot[0].nombre, "Veri");
  assert.equal(t.mision.zona, "Irvine"); assert.equal(t.mision.listos, 12);
  assert.equal(t.leads.smsHoy, 1); assert.equal(t.leads.smsBloqueadosHoy, 1); assert.equal(t.leads.interesados, 1);
});
test("costos: tokens siempre; dólares solo con precios del jefe", () => {
  const t = T.construir(base(), REGISTRO, { ahora });
  assert.equal(t.costos.conPrecios, false); assert.equal(t.costos.total.dolares, null);
  assert.equal(t.costos.porQuien.find((c) => c.quien === "OPS").porciento, 93);
  const conP = T.construir({ ...base(), llmPrecios: { entrada: 3, salida: 15 } }, REGISTRO, { ahora });
  assert.equal(conP.costos.porQuien.find((c) => c.quien === "capi").dolares, 3.15); // 1M×3 + 10k×15 por millón
});
test("seguridad y semáforo", () => {
  const t = T.construir(base(), REGISTRO, { ahora });
  assert.equal(t.semaforo, "rojo"); // Veri en error
  assert.equal(t.seguridad.aprobacionesPendientes, 1);
  assert.ok(t.seguridad.mandanSms.includes("Texi")); assert.ok(t.seguridad.escribenCrm.includes("Lofti"));
  const limpio = T.construir({}, REGISTRO, { ahora });
  assert.equal(limpio.semaforo, "verde"); assert.equal(limpio.mision, null);
});

test("Fase 6: etapas de lanzamiento según permisos", () => {
  const l = T.lanzamiento({}, REGISTRO);
  const etapa = (id) => l.robots.find((r) => r.id === id).etapa;
  assert.equal(etapa("cu"), 1); assert.equal(etapa("ch"), 1); assert.equal(etapa("lf"), 2); assert.equal(etapa("rd"), 2);
  assert.equal(etapa("bv"), 3); assert.equal(etapa("wb3"), 3); assert.equal(etapa("tx"), 4); assert.equal(etapa("ti"), 4);
  assert.equal(l.actual, 4); // todos prendidos
  assert.ok(!l.robots.some((r) => r.id === "sv")); // Capi no entra (nunca se apaga)
});
test("Fase 6: plan de etapa prende ≤ n y apaga > n", () => {
  const p = T.planEtapa({ robotsApagados: { cu: true } }, REGISTRO, 1);
  assert.ok(p.prender.some((r) => r.id === "cu"));
  assert.ok(p.apagar.some((r) => r.id === "tx") && p.apagar.some((r) => r.id === "lf"));
  assert.ok(!p.apagar.some((r) => r.id === "ch"));
  const todosApag = Object.fromEntries(REGISTRO.ids().map((id) => [id, true]));
  assert.equal(T.lanzamiento({ robotsApagados: todosApag }, REGISTRO).actual, 0);
});
