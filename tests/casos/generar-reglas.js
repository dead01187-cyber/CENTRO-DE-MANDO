// Genera tests/casos/reglas.json: casos de las reglas del Cerebro y de la política de SMS con el
// resultado que da HOY el JavaScript (cerebro-core.js y politica-sms.js). Las pruebas de Python
// (puente/reglas.py) y de JavaScript usan el mismo archivo: así las dos versiones nunca deciden distinto.
// Correr:  node tests/casos/generar-reglas.js
const fs = require("node:fs"), path = require("node:path");
const C = require("../../cerebro-core.js");
const SMS = require("../../politica-sms.js");
const MIN = 60e3, H = 3600e3, AHORA = Date.parse("2026-11-27T19:00:00Z"); // 11:00 am en California
const out = (t, tipo = "Manual", agentId = 1) => ({ t, direccion: "out", tipo, agentId });
const inn = (t) => ({ t, direccion: "in", tipo: "", agentId: null });
const c = (t, robot = "Texi", canal = "sms", leadId = "7") => ({ t, leadId, canal, robot });

const cerebro = [
  ["sin nada: puede", {}],
  ["robot le mandó SMS hace 2 h: 24h", { contactos: [c(AHORA - 2 * H)], textos: [out(AHORA - 2 * H + 30e3)] }],
  ["robot hace 25 h: puede", { contactos: [c(AHORA - 25 * H)], textos: [out(AHORA - 25 * H)] }],
  ["persona escribió hace 3 h: persona", { textos: [out(AHORA - 3 * H, "Manual", 42)] }],
  ["persona hace 3 h también bloquea llamadas", { canal: "llamada", textos: [out(AHORA - 3 * H, "Manual", 42)] }],
  ["SMS Manual de robot (±5 min) no es persona", { contactos: [c(AHORA - 30 * H)], textos: [out(AHORA - 30 * H + 4 * MIN)] }],
  ["Anna escribió hace 1 h: 24h (Anna)", { textos: [out(AHORA - H, "AI")] }],
  ["en pool de Anna sin silenciar: anna", { anna: { enPool: true, silenciado: false } }],
  ["en pool pero silenciada: puede", { anna: { enPool: true, silenciado: true } }],
  ["en pool sin respetar Anna (Rayo): puede", { anna: { enPool: true, silenciado: false }, respetaAnna: false }],
  ["Resi contesta a quien nos escribió: respuesta", { esRespuesta: true, contactos: [c(AHORA - 2 * H, "Resi")], textos: [out(AHORA - 2 * H), inn(AHORA - H)] }],
  ["respuesta pero no escribió después: 24h", { esRespuesta: true, contactos: [c(AHORA - H, "Resi")], textos: [inn(AHORA - 2 * H), out(AHORA - H)] }],
  ["contacto de otro lead no cuenta", { contactos: [c(AHORA - H, "Texi", "sms", "999")] }],
  ["email con SMS reciente: puede (24h es solo SMS)", { canal: "email", contactos: [c(AHORA - H)], textos: [out(AHORA - H)] }],
  ["robot 59 min sin texto en Lofty todavía: 24h", { contactos: [c(AHORA - 59 * MIN, "Rayo")] }],
].map(([nombre, x]) => {
  const entrada = { ahora: AHORA, leadId: "7", canal: "sms", contactos: [], textos: [], anna: {}, respetaAnna: true, esRespuesta: false, ...x };
  const r = C.revisar(entrada);
  return { nombre, entrada, salida: { ok: r.ok, codigo: r.codigo, motivo: r.motivo || "" } };
});

const d10 = ["9495551234", "(949) 555-1234", "+1 949 555 1234", "19495551234", "555-1234", "", null, "29495551234"].map((e) => ({ entrada: e, salida: SMS.d10(e) }));
const esCA = ["9495551234", "2125551234", "3105551234", "8005551234", "abc", "16195551234"].map((e) => ({ entrada: e, salida: SMS.esCA(e) }));
const cfg = { desde: 8, hasta: 21 };
const apagado = { desde: 8, hasta: 21, sinHorario: true }; // el jefe apagó el horario
const enHorario = [["2026-11-27T15:59:00Z"], ["2026-11-27T16:00:00Z"], ["2026-11-28T04:59:00Z"], ["2026-11-28T05:00:00Z"], ["2026-07-01T14:59:00Z"], ["2026-07-01T15:00:00Z"], ["2026-03-08T16:30:00Z"],
  ["2026-11-27T11:00:00Z", apagado], ["2026-11-28T06:30:00Z", apagado]]
  .map(([iso, c = cfg]) => ({ entrada: { ms: Date.parse(iso), cfg: c }, salida: SMS.enHorario(c, Date.parse(iso)) }));
const baja = ["STOP", "stop please", "Unsubscribe me", "remove me from your list", "no me escribas", "Baja", "quit", "  Cancelar! ", "yes call me", "I stopped by", "don't text me", "stop all", "please stop", "borrame", "cuánto vale"]
  .map((e) => ({ entrada: e, salida: SMS.RE_BAJA.test(e) }));

fs.writeFileSync(path.join(__dirname, "reglas.json"), JSON.stringify({ nota: "Generado por tests/casos/generar-reglas.js con el JavaScript actual. No editar a mano.", cerebro, d10, esCA, enHorario, baja }, null, 1) + "\n");
console.log(`reglas.json: ${cerebro.length} cerebro, ${d10.length} d10, ${esCA.length} esCA, ${enHorario.length} horario, ${baja.length} baja`);
