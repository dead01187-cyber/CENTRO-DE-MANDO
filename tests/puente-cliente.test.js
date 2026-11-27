// Fase B: el Cerebro y la política de SMS con el puente como árbitro, y sin él (copia local + aviso).
const test = require("node:test");
const assert = require("node:assert/strict");
const simularChrome = require("./simular-chrome");

function cargar(storage, puente) {
  const ch = simularChrome(storage);
  const avisos = [], pedidos = [];
  globalThis.svLog = (t, n) => avisos.push({ t, n });
  globalThis.fetch = async (url, o = {}) => {
    const u = String(url);
    if (u.startsWith("https://api.lofty.com")) return { ok: true, status: 200, text: async () => JSON.stringify(u.includes("/communication/text") ? { texts: [] } : { workingLeads: [] }), json: async () => ({}) };
    pedidos.push({ ruta: u.replace("http://127.0.0.1:8765", ""), body: o.body ? JSON.parse(o.body) : null, token: (o.headers || {})["X-Navi-Token"] });
    if (!puente) throw new TypeError("Failed to fetch");
    const r = puente(u.replace("http://127.0.0.1:8765", ""), o.body ? JSON.parse(o.body) : null);
    return { ok: r.status === undefined || r.status < 400, status: r.status || 200, json: async () => r.json || r };
  };
  for (const m of ["../puente-cliente.js", "../cerebro-core.js", "../cerebro.js", "../politica-sms.js"]) delete require.cache[require.resolve(m)];
  delete globalThis.PuenteCliente; delete globalThis.Cerebro;
  require("../puente-cliente.js"); require("../cerebro-core.js"); require("../cerebro.js");
  const SMS = require("../politica-sms.js");
  return { ch, avisos, pedidos, Cerebro: globalThis.Cerebro, SMS, PC: globalThis.PuenteCliente };
}
const base = { txKey: "llave-de-prueba", annaPool: { t: Date.now(), leads: [] } };

test("sin clave del puente: todo igual que antes, sin llamarlo ni avisar", async () => {
  const { Cerebro, pedidos, avisos, SMS } = cargar({ ...base });
  const r = await Cerebro.puedo({ leadId: "7", canal: "sms", robot: "Texi" });
  assert.equal(r.ok, true); assert.equal(r.fuente, "local");
  assert.equal(await SMS.turnoCompartido("tx", 5000), null);
  assert.equal(pedidos.length, 0); assert.equal(avisos.length, 0);
});

test("puente apagado: sigue con lo local, avisa UNA vez y marca que hay que re-subir", async () => {
  const { Cerebro, avisos, ch, SMS } = cargar({ ...base, nvToken: "clave" }, null);
  assert.equal((await Cerebro.puedo({ leadId: "7", canal: "sms", robot: "Texi" })).ok, true);
  await Cerebro.anotar({ leadId: "7", canal: "sms", robot: "Texi" });
  assert.equal((await Cerebro.puedo({ leadId: "7", canal: "sms", robot: "Texi" })).codigo, "24h", "la regla local sigue funcionando");
  assert.equal(await SMS.turnoCompartido("tx", 3000), null);
  assert.equal(avisos.filter((a) => /Puente apagado/.test(a.t)).length, 1, "un solo aviso");
  assert.equal(ch.datos().puenteSucio, true);
});

test("con puente: el árbitro manda lo más estricto y se entera de cada contacto y baja", async () => {
  const anotados = [], bajas = [];
  const puente = (ruta, body) => {
    if (ruta === "/cerebro/resumen") return { instancia: "i1" };
    if (ruta === "/cerebro/importar") return { contactos_nuevos: 0, bajas_nuevas: 0 };
    if (ruta.startsWith("/cerebro/contactos")) return { contactos: [{ id: "r1", t: Date.now() - 3600e3, leadId: "9", canal: "sms", robot: "Rayo" }] };
    if (ruta === "/bajas") return { bajas: { tels: { "9495550000": { t: 1, motivo: "STOP", fuente: "Rayo" } }, leads: {} } };
    if (ruta === "/cerebro/revisar") return body.leadId === "8" ? { ok: false, codigo: "24h", motivo: "ya recibió un SMS hace 5 min (Rayo); máximo 1 cada 24 h", fuente: "puente" } : { ok: true, codigo: "ok" };
    if (ruta === "/cerebro/anotar") { anotados.push(body.contacto); return { ok: true, nuevos: 1 }; }
    if (ruta === "/bajas/marcar") { bajas.push(body); return { ok: true, nuevas: 1 }; }
    if (ruta === "/bajas/revisar") return { baja: body.tel === "9495551111" ? { motivo: "equivocado", fuente: "Rayo" } : null };
    if (ruta === "/turno") return { esperar_ms: 9000 };
    return { status: 404, json: { error: "no" } };
  };
  const { Cerebro, ch, SMS, pedidos } = cargar({ ...base, nvToken: "clave" }, puente);
  // el puente dice que no (otro robot le escribió) aunque lo local diga que sí
  const r = await Cerebro.puedo({ leadId: "8", canal: "sms", robot: "Texi" });
  assert.equal(r.ok, false); assert.equal(r.fuente, "puente"); assert.match(r.motivo, /Rayo.*según el puente/);
  assert.equal(pedidos.find((p) => p.ruta === "/cerebro/revisar").token, "clave");
  // sincronizó: bajó el contacto de Rayo y la baja del puente
  assert.ok(ch.datos().cerebroContactos.some((c) => c.id === "r1" && c.robot === "Rayo"));
  assert.ok(ch.datos().smsBajas.tels["9495550000"]);
  assert.equal(ch.datos().puenteInstancia, "i1");
  assert.equal((await Cerebro.puedo({ leadId: "9", canal: "sms", robot: "Texi" })).codigo, "24h", "el contacto de Rayo ya cuenta también localmente");
  // cada contacto y baja le llega al árbitro
  await Cerebro.anotar({ leadId: "10", canal: "llamada", robot: "Marki" });
  assert.equal(anotados[0].leadId, "10"); assert.ok(anotados[0].id, "con id para no duplicar");
  await SMS.marcarBaja({ tel: "(949) 555-2222", leadId: "10", cuenta: "tx", motivo: "STOP", fuente: "Resi" });
  assert.deepEqual(bajas[0].tels, ["9495552222"]);
  // una baja que solo conoce el puente también bloquea
  assert.equal((await SMS.bajaDe({ tel: "9495551111", leadId: "11", cuenta: "tx" })).motivo, "equivocado");
  // turno: el puente reparte
  assert.equal(await SMS.turnoCompartido("tx", 4000), 9000);
  assert.deepEqual(pedidos.filter((p) => p.ruta === "/turno").pop().body, { cuenta: "tx", minimo_ms: 4000 });
});

test("cuando el puente vuelve (otra instancia) se le sube lo que tenía la extensión", async () => {
  const subido = [];
  const puente = (ruta, body) => {
    if (ruta === "/cerebro/resumen") return { instancia: "nueva" };
    if (ruta === "/cerebro/importar") { subido.push(body); return { contactos_nuevos: body.contactos.length, bajas_nuevas: 1 }; }
    if (ruta.startsWith("/cerebro/contactos")) return { contactos: [] };
    if (ruta === "/bajas") return { bajas: { tels: {}, leads: {} } };
    return { ok: true, codigo: "ok" };
  };
  const { Cerebro, avisos, ch } = cargar({ ...base, nvToken: "clave", puenteInstancia: "vieja", smsUltimoTx: 123, cerebroContactos: [{ t: 1, leadId: "1", canal: "sms", robot: "Texi" }], smsBajas: { tels: { "9495553333": { t: 1, motivo: "STOP" } }, leads: {} } }, puente);
  await Cerebro.puedo({ leadId: "7", canal: "sms", robot: "Texi" });
  assert.equal(subido.length, 1);
  assert.equal(subido[0].contactos.length, 1); assert.ok(subido[0].bajas.tels["9495553333"]); assert.deepEqual(subido[0].turnos, { tx: 123 });
  assert.equal(ch.datos().puenteInstancia, "nueva"); assert.equal(ch.datos().puenteSucio, false);
  assert.ok(avisos.some((a) => /le subí lo que tenía la extensión/.test(a.t)));
});
