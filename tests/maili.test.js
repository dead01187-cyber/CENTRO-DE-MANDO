// Maili (correos desde Lofty): reglas puras de maili-core.js y su conexión al Centro de Mando
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const M = require("../maili-core.js");
const REG = require("../registro.js");

const H = 3600e3, DIA = 24 * H, AHORA = Date.parse("2026-01-15T18:00:00Z");
const CFG = { remitente: "Mark · The Irvine Realtors", direccion: "123 Main St, Irvine, CA 92618" };

test("correoDe / sinCorreo: correo válido, cannotEmail y unsubscribe", () => {
  assert.equal(M.correoDe({ emails: ["malo", "ana@correo.com"] }), "ana@correo.com");
  assert.equal(M.correoDe({ emails: [{ email: "x@y.co" }] }), "x@y.co");
  assert.equal(M.sinCorreo({ emails: ["ana@correo.com"] }), "");
  assert.match(M.sinCorreo({ emails: [] }), /no tiene correo/);
  assert.match(M.sinCorreo({ emails: ["a@b.com"], cannotEmail: true }), /cannotEmail/);
  assert.match(M.sinCorreo({ emails: ["a@b.com"], unsubscription: true }), /baja/);
});

test("revisarPlantilla: llaves sueltas (el error de “Hi Sam}”), vacíos y pie legal obligatorio", () => {
  assert.deepEqual(M.revisarPlantilla({ asunto: "Your home in {ciudad}", texto: "Hi {nombre}," }, CFG), []);
  assert.match(M.revisarPlantilla({ asunto: "Hola", texto: "Hi {nombre}}," }, CFG).join(" "), /llaves que no reconozco/);
  assert.match(M.revisarPlantilla({ asunto: "Hola", texto: "Hi {name}," }, CFG).join(" "), /\{name\}/);
  assert.match(M.revisarPlantilla({ asunto: "", texto: "" }, CFG).join(" "), /Falta el asunto.*vacío/);
  assert.match(M.revisarPlantilla({ asunto: "Hola", texto: "This is Mark with Rubio Real Estate." }, CFG).join(" "), /solo de The Irvine Realtors/);
  assert.match(M.revisarPlantilla({ asunto: "Hola", texto: "Hi" }, { ...CFG, remitente: "Mark · Rubio Real Estate" }).join(" "), /solo de The Irvine Realtors/);
  const sinPie = M.revisarPlantilla({ asunto: "a", texto: "b" }, {}).join(" ");
  assert.match(sinPie, /remitente/); assert.match(sinPie, /CAN-SPAM/);
});

test("armar: rellena los campos y SIEMPRE agrega el pie (remitente, dirección y baja); el HTML va escapado", () => {
  const x = M.datosDe({ leadId: 7, firstName: "SAM lee", lastName: "o'neil", emails: ["s@x.com"], leadPropertyList: [{ label: "Home", streetAddress: "1 oak st", city: "irvine" }] });
  const c = M.armar({ asunto: "Your home in {ciudad}", texto: "Hi {nombre},\n<b>{direccion}</b>" }, x, CFG);
  assert.equal(c.asunto, "Your home in Irvine");
  assert.match(c.texto, /^Hi Sam,\n<b>1 Oak St<\/b>\n\n--\nMark · The Irvine Realtors\n123 Main St, Irvine, CA 92618\nIf you'd rather not receive emails/);
  assert.match(c.html, /&lt;b&gt;1 Oak St&lt;\/b&gt;<br>/); assert.ok(!c.html.includes("\n"));
  assert.equal(M.armar({ asunto: "{ciudad}", texto: "{nombre}" }, { nombre: "", ciudad: "" }, CFG).asunto, "your area");
});

test("puede: 1 correo cada 7 días entre robots y personas; los automáticos de Lofty no cuentan", () => {
  const L = "7";
  assert.equal(M.puede({ ahora: AHORA, leadId: L }).ok, true);
  const r = M.puede({ ahora: AHORA, leadId: L, contactos: [{ t: AHORA - 3 * DIA, leadId: L, canal: "email", robot: "Maili" }] });
  assert.equal(r.codigo, "reciente"); assert.match(r.motivo, /3 día\(s\) \(Maili\)/);
  assert.equal(M.puede({ ahora: AHORA, leadId: L, contactos: [{ t: AHORA - 8 * DIA, leadId: L, canal: "email", robot: "Maili" }] }).ok, true);
  assert.equal(M.puede({ ahora: AHORA, leadId: L, contactos: [{ t: AHORA - DIA, leadId: L, canal: "sms", robot: "Texi" }] }).ok, true, "un SMS no cuenta como correo");
  assert.equal(M.puede({ ahora: AHORA, leadId: L, contactos: [{ t: AHORA - DIA, leadId: "8", canal: "email", robot: "Maili" }] }).ok, true, "otro lead");
  const auto = M.deLofty({ direction: "Outbound", emailType: "Auto", emailEventTime: "2026-01-15 10:00:00 GMT", emailSubject: "Market report" });
  assert.equal(auto.t, Date.parse("2026-01-15T10:00:00Z"));
  assert.equal(M.puede({ ahora: AHORA, leadId: L, correos: [auto] }).ok, true);
  const persona = M.deLofty({ direction: "Outbound", emailType: "Manual", emailEventTime: "2026-01-15 10:00:00 GMT", emailSubject: "Following up" });
  assert.equal(M.puede({ ahora: AHORA, leadId: L, correos: [persona] }).codigo, "persona");
  // el mismo correo pero mandado por Maili (anotado en el Cerebro a ±5 min) no es "persona": es "reciente"
  assert.equal(M.puede({ ahora: AHORA, leadId: L, correos: [persona], contactos: [{ t: persona.t + 60e3, leadId: L, canal: "email", robot: "Maili" }] }).codigo, "reciente");
  // "Opened" (el lead abrió un correo) NO es un envío: no bloquea
  const abierto = M.deLofty({ direction: "Outbound", emailType: null, eventType: "Opened", emailEventTime: "2026-01-15 10:00:00 GMT", emailSubject: "Market report" });
  assert.equal(M.puede({ ahora: AHORA, leadId: L, correos: [abierto] }).ok, true);
  assert.ok(M.esApertura(abierto)); assert.ok(!M.esEnvio(abierto));
  const viejo = { ...persona, t: AHORA - 3 * DIA };
  assert.equal(M.puede({ ahora: AHORA, leadId: L, correos: [viejo] }).codigo, "reciente");
  // Remi sí puede contestar si el lead escribió después
  assert.equal(M.puede({ ahora: AHORA, leadId: L, correos: [viejo, { t: AHORA - H, direccion: "in" }], esRespuesta: true }).codigo, "respuesta");
});

test("esBaja y pausa a ritmo humano (20–45 s)", () => {
  for (const t of ["unsubscribe", "Please remove me from your list", "STOP", "no me escriban más", "Quiero darme de baja"]) assert.ok(M.esBaja(t), t);
  for (const t of ["Sure, call me tomorrow", "I can't stop thinking about selling", ""]) assert.ok(!M.esBaja(t), t);
  assert.equal(M.pausaMs(0), 20000); assert.equal(M.pausaMs(1), 45000);
});

test("Maili está en el registro (GROW, manda correo = etapa 4), en el Mando y Capi solo puede buscar", () => {
  const r = REG.ROBOTS.ml;
  assert.equal(r.nombre, "Maili"); assert.equal(r.supervisor, "GROW"); assert.equal(r.pagina, "ml.html");
  assert.deepEqual(r.permisos, ["lee_crm", "envia_correo"]);
  const raiz = path.join(__dirname, ".."), leer = (f) => fs.readFileSync(path.join(raiz, f), "utf8");
  assert.match(leer("tablero-core.js"), /envia_correo: 4/);
  const mando = leer("mando.html");
  assert.match(mando, /data-m="ml" id="e-ml"/); assert.match(mando, /<iframe id="f-ml" src="ml\.html">/); assert.match(mando, /<button data-m="ml">Maili<\/button>/);
  assert.match(leer("mando.js"), /const MODS = \[[^\]]*"ml"/);
  assert.match(leer("sv.js"), /ml: \{ buscar: "Maili:[^"]*NO manda nada/);
  const js = leer("ml.js");
  assert.match(js, /const LLAVE = "t2Key"/, "usa la cuenta de Texi 2");
  assert.ok(!/lofty\.[A-Za-z0-9]{20,}/.test(js), "sin llaves en el código");
});
