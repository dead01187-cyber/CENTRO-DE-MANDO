// Remi (seguimiento de los correos de Maili): reglas puras y conexión al Centro de Mando
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const M = require("../maili-core.js");
const R = require("../remi-core.js");
const REG = require("../registro.js");

const T = Date.parse("2026-01-10T18:00:00Z"), H = 3600e3, AHORA = T + 5 * 24 * H;
const ENV = { t: T, asunto: "Your home in Irvine" };
const ev = (min, eventType, extra = {}) => M.deLofty({ direction: "Outbound", emailType: null, eventType, emailSubject: "Your home in Irvine", emailEventTime: new Date(T + min * 60e3).toISOString().replace(/\.\d+Z$/, "GMT").replace("T", " "), ...extra });

test("resumir: sin abrir / abrió / respondió / baja", () => {
  const sent = ev(0, "Sent", { emailType: "Manual" });
  assert.equal(R.resumir({ enviado: ENV, correos: [sent], ahora: AHORA }).estado, "sin_abrir");
  assert.equal(R.resumir({ enviado: ENV, correos: [sent], ahora: AHORA }).dias, 5);
  const a = R.resumir({ enviado: ENV, correos: [sent, ev(30, "Opened"), ev(90, "Opened"), ev(91, "Clicked")], ahora: AHORA });
  assert.deepEqual([a.estado, a.abiertos, a.clics], ["abrio", 2, 1]);
  const r = R.resumir({ enviado: ENV, correos: [sent, ev(30, "Opened"), ev(120, "Received", { direction: "Inbound", emailSubject: "Re: Your home in Irvine" })], ahora: AHORA });
  assert.equal(r.estado, "respondio"); assert.equal(r.respondioT, T + 120 * 60e3);
  assert.equal(R.resumir({ enviado: ENV, correos: [sent, ev(30, "Opened")], lead: { unsubscription: true }, ahora: AHORA }).estado, "baja");
});

test("resumir: no cuenta aperturas de otros correos (reportes de Lofty) ni lo que pasó antes del envío", () => {
  const otros = [ev(30, "Opened", { emailSubject: "92618 Real Estate Market Report" }), ev(-600, "Opened"), ev(-300, "Received", { direction: "Inbound" })];
  const r = R.resumir({ enviado: ENV, correos: otros, ahora: AHORA });
  assert.deepEqual([r.estado, r.abiertos, r.respondioT], ["sin_abrir", 0, 0]);
});

test("ordenar: primero los que respondieron, luego los que más abrieron; las bajas al final", () => {
  const l = R.ordenar([{ id: "a", estado: "sin_abrir", abiertos: 0, clics: 0 }, { id: "b", estado: "baja", abiertos: 3, clics: 0 }, { id: "c", estado: "abrio", abiertos: 1, clics: 0 }, { id: "d", estado: "abrio", abiertos: 4, clics: 0 }, { id: "e", estado: "respondio", abiertos: 0, clics: 0 }]);
  assert.deepEqual(l.map((x) => x.id), ["e", "d", "c", "a", "b"]);
});

test("nota en inglés y cuándo se deja (respuesta, baja o 2+ aperturas); no se repite", () => {
  const b = { asunto: "Your home in Irvine", enviadoT: T, abiertos: 1, clics: 0 };
  assert.match(R.nota({ ...b, estado: "respondio" }), /^Remi: the lead REPLIED by email to "Your home in Irvine" \(sent 2026-01-10\)/);
  assert.match(R.nota({ ...b, estado: "baja" }), /unsubscribed.*Do not email/);
  assert.match(R.nota({ ...b, estado: "abrio", abiertos: 3 }), /opened the email .* 3 time\(s\)/);
  assert.ok(!R.merece({ ...b, estado: "abrio" })); assert.ok(R.merece({ ...b, estado: "abrio", abiertos: 2 })); assert.ok(R.merece({ ...b, estado: "respondio" })); assert.ok(!R.merece({ ...b, estado: "sin_abrir" }));
  assert.equal(R.huella({ ...b, estado: "abrio", abiertos: 2 }), R.huella({ ...b, estado: "abrio", abiertos: 9 }), "abrir más veces no repite la nota");
  assert.notEqual(R.huella({ ...b, estado: "abrio", abiertos: 2 }), R.huella({ ...b, estado: "respondio" }));
});

test("Remi está en el registro (GROW, no manda nada), en el Mando y Capi lo puede correr", () => {
  const r = REG.ROBOTS.rm;
  assert.equal(r.nombre, "Remi"); assert.equal(r.supervisor, "GROW"); assert.deepEqual(r.permisos, ["lee_crm", "escribe_crm"]);
  assert.equal(REG.accion("rm", "revisar").aprobacion, false);
  const raiz = path.join(__dirname, ".."), leer = (f) => fs.readFileSync(path.join(raiz, f), "utf8");
  const mando = leer("mando.html");
  assert.match(mando, /data-m="rm" id="e-rm"/); assert.match(mando, /<iframe id="f-rm" src="rm\.html">/); assert.match(mando, /<button data-m="rm">Remi<\/button>/);
  assert.match(leer("mando.js"), /const MODS = \[[^\]]*"rm"/);
  const js = leer("rm.js");
  assert.ok(!/message\/(email|sms)\/send/.test(js), "Remi no manda correos ni SMS");
  assert.match(js, /const LLAVE = "t2Key"/);
});
