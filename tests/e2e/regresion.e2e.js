// =====================================================================
// Regresión de punta a punta (Fase 6). Corre la extensión de verdad en un
// Chromium aislado, contra un Lofty FALSO y con reloj fijo. Nada sale a
// internet y no se manda ningún SMS real.   node --test tests/e2e/
// =====================================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir } = require("./ambiente");

const lead = (leadId, tel, extra = {}) => ({ leadId, firstName: "Lead" + leadId, lastName: "Prueba", stage: "Warm", leadTypes: [1], phones: [tel], phoneStatuses: [2], phoneConsentStates: [], leadPropertyList: [{ streetAddress: `${leadId} Oak St`, city: "Irvine" }], ...extra });
const LEADS = [
  lead(101, "9493728811"),                                        // sí se le puede mandar
  lead(102, "9493728822", { phoneConsentStates: ["Do Not Text"] }), // opt-out en Lofty
  lead(103, "9493728833"),                                        // baja permanente local
  lead(104, "2125551234"),                                        // no es de California
];
const PLANTILLA = { txPlantillas: [{ id: "p1", nombre: "Prueba", texto: "Hola {nombre}, prueba." }], txConfig: { plantilla: "p1" } };
const BAJA_103 = { smsBajas: { tels: { "9493728833": { t: 1, motivo: "baja", fuente: "Resi" } }, leads: {} } };

async function texiMandar(amb) {
  const tx = await amb.pagina("tx.html");
  await tx.fill("#etapa", "Warm"); await tx.click("#buscar");
  await tx.waitForFunction(() => !document.getElementById("buscar").disabled && /encontr|lista|lead/i.test(document.getElementById("status").textContent), null, { timeout: 20000 });
  await tx.click("#mandar"); await tx.click("#si");
  await tx.waitForFunction(() => /^(Listo|Detenido|Me detengo|No pude)/.test(document.getElementById("status").textContent.trim()), null, { timeout: 60000 });
  return (await tx.textContent("#status")).trim();
}

test("Texi: solo le manda al que se puede (opt-out, baja permanente y fuera de CA se saltan) y queda registrado", async () => {
  const amb = await abrir({ leads: LEADS, storage: { txKey: "llave-falsa", ...PLANTILLA, ...BAJA_103 }, horaCA: "2026-01-15T10:00" });
  try {
    const fin = await texiMandar(amb);
    assert.deepEqual(amb.lofty.estado.sms.map((s) => s.phoneNumber), ["9493728811"], fin);
    const { smsRegistro = [] } = await amb.leer("smsRegistro");
    assert.ok(smsRegistro.some((e) => e.estado === "enviado" && e.tel === "9493728811"));
    assert.deepEqual(amb.errores, []);
  } finally { await amb.cerrar(); }
});

test("Texi: si Lofty falla al revisar el opt-out, NO manda (falla cerrada)", async () => {
  const amb = await abrir({ leads: LEADS.slice(0, 1), fallar: { "GET /leads/101": { status: 500 } }, storage: { txKey: "llave-falsa", ...PLANTILLA }, horaCA: "2026-01-15T10:00" });
  try {
    const fin = await texiMandar(amb);
    assert.equal(amb.lofty.estado.sms.length, 0);
    const { txLista = [] } = await amb.leer("txLista");
    const x = txLista.find((l) => l.id === "101");
    assert.ok(x, "el lead 101 debe estar en la lista: " + fin);
    assert.equal(x.estado, "error"); assert.match(x.detalle, /no pude revisar/);
  } finally { await amb.cerrar(); }
});

test("Texi: fuera de horario (22:30 en California) no manda nada y se detiene", async () => {
  const amb = await abrir({ leads: LEADS.slice(0, 1), storage: { txKey: "llave-falsa", ...PLANTILLA }, horaCA: "2026-01-15T22:30" });
  try {
    const fin = await texiMandar(amb);
    assert.equal(amb.lofty.estado.sms.length, 0, fin);
    const { smsRegistro = [] } = await amb.leer("smsRegistro");
    assert.ok(smsRegistro.some((e) => e.estado === "bloqueado" && /horario/.test(e.motivo)));
  } finally { await amb.cerrar(); }
});

const LOTE = { lote: [{ owner: "Ana Ruiz", address: "1 Oak St, Irvine, CA 92618", phones: [{ num: "(949) 372-8811" }, { num: "(800) 372-8811" }, { num: "(949) 372-8844", dnc: true }] }] };

test("Lofti: no sube solo por defecto; al subir con tu OK quita el 800 (Vali) y el DNC", async () => {
  const amb = await abrir({ storage: { loftyKey: "llave-falsa", ...LOTE } });
  try {
    const lf = await amb.pagina("lofty.html");
    await lf.waitForTimeout(4000);
    assert.equal(amb.lofty.estado.creados.length, 0, "no debe subir nada sin tu OK");
    await lf.click("#send"); await lf.waitForSelector("#go", { timeout: 10000 }); await lf.click("#go");
    await lf.waitForFunction(() => /Enviados a Lofty/.test(document.getElementById("smsg").textContent), null, { timeout: 20000 });
    assert.equal(amb.lofty.estado.creados.length, 1);
    assert.deepEqual(amb.lofty.estado.creados[0].phones, ["+19493728811"]);
  } finally { await amb.cerrar(); }
});

test("Lofti: con subida automática, un lead que Lofty rechaza NO se reenvía en bucle", async () => {
  const amb = await abrir({ fallar: { "POST /leads": { status: 400, mensaje: "dato inválido" } }, storage: { loftyKey: "llave-falsa", loftyAuto: true, ...LOTE } });
  try {
    await amb.pagina("lofty.html");
    await new Promise((r) => setTimeout(r, 12000)); // antes: un POST nuevo cada ~2 s
    const posts = amb.lofty.estado.llamadas.filter((l) => l.metodo === "POST" && l.ruta === "/leads").length;
    assert.equal(posts, 1, `hubo ${posts} intentos`);
  } finally { await amb.cerrar(); }
});

test("Marki: con SMS prendidos pide confirmación; al cancelar no hace nada", async () => {
  const amb = await abrir({ leads: LEADS.slice(0, 1).map((l) => ({ ...l, stage: "Cold 12 Month +", tags: [{ tagName: "Contact verified" }] })), storage: { alCfg: { apiKey: "llave-falsa", doSms: true } } });
  try {
    const al = await amb.pagina("al.html");
    await al.waitForTimeout(1000); await al.click("#start");
    await al.waitForSelector("[data-pregunta]", { timeout: 10000 });
    await al.click("[data-pregunta] .no"); await al.waitForTimeout(1500);
    assert.equal(amb.lofty.estado.sms.length, 0); assert.equal(amb.lofty.estado.cambios.length, 0);
  } finally { await amb.cerrar(); }
});

test("Capi: subir a Lofty pide tu confirmación en pantalla; si dices que no, no sube", async () => {
  const amb = await abrir({ storage: { loftyKey: "llave-falsa", loftyListos: 3 } });
  try {
    const sv = await amb.pagina("sv.html");
    await sv.waitForTimeout(1200);
    const r = sv.evaluate(() => ejecutar("subir_leads", {}));
    await sv.waitForSelector("[data-pregunta]", { timeout: 10000 }); await sv.click("[data-pregunta] .no");
    assert.match(await r, /no autorizó/);
    assert.equal(amb.lofty.estado.creados.length, 0);
  } finally { await amb.cerrar(); }
});

test("Bus: una tarea pedida con la página cerrada se hace sola al abrirla", async () => {
  const amb = await abrir({ storage: { loftyKey: "llave-falsa" } });
  try {
    const sv = await amb.pagina("sv.html"); await sv.waitForTimeout(800);
    const t = await sv.evaluate(() => Tareas.crear("ch", "revisar"));
    assert.equal(t.estado, "pendiente");
    await amb.pagina("ch.html");
    const fin = await sv.evaluate((id) => Tareas.esperar(id, 30000), t.id);
    assert.equal(fin.estado, "hecha");
  } finally { await amb.cerrar(); }
});

test("Tablero: pasar a la etapa 1 (con confirmación) apaga a los que escriben, gastan o contactan", async () => {
  const amb = await abrir({});
  try {
    const tb = await amb.pagina("tablero.html"); await tb.waitForTimeout(2000);
    await tb.click("#etapas button >> nth=0"); // etapa 1
    await tb.waitForSelector("[data-pregunta]"); await tb.click("[data-pregunta] .si"); await tb.waitForTimeout(800);
    const { robotsApagados = {} } = await amb.leer("robotsApagados");
    for (const id of ["tx", "rs", "al", "ti", "lf", "ac", "li", "bv", "wb3"]) assert.equal(robotsApagados[id], true, id);
    for (const id of ["ch", "cu", "qa", "pw"]) assert.ok(!robotsApagados[id], id);
    assert.ok(!robotsApagados.sv);
    assert.deepEqual(amb.errores, []);
  } finally { await amb.cerrar(); }
});
