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

test("Capi: subir a Lofty deja una tarea que solo el jefe aprueba; si la rechaza, no sube", async () => {
  const amb = await abrir({ storage: { loftyKey: "llave-falsa", loftyListos: 3 } });
  try {
    const sv = await amb.pagina("sv.html"); await sv.waitForTimeout(1200);
    assert.match(await sv.evaluate(() => ejecutar("subir_leads", {})), /aprobación del jefe/);
    await sv.waitForSelector("#chat .aviso button", { timeout: 10000 }); // tarjeta Aprobar / Rechazar
    await sv.evaluate(() => [...document.querySelectorAll("#chat .aviso button")].find((b) => b.textContent === "Rechazar").click());
    await sv.waitForTimeout(800);
    const t = (await sv.evaluate(() => Tareas.listar())).find((x) => x.robot === "lf");
    assert.equal(t.estado, "rechazada"); assert.equal(amb.lofty.estado.creados.length, 0);
  } finally { await amb.cerrar(); }
});

test("Lofti por el bus: aprobada por el jefe, sube (sin volver a preguntar) y quita el 800 y el DNC", async () => {
  const amb = await abrir({ storage: { loftyKey: "llave-falsa", ...LOTE } });
  try {
    const sv = await amb.pagina("sv.html"); await amb.pagina("lofty.html"); await sv.waitForTimeout(3000);
    const t = await sv.evaluate(() => Tareas.crear("lf", "subir", { origen: "capi" }));
    assert.equal(t.estado, "aprobacion");
    await sv.evaluate((id) => Tareas.aprobar(id), t.id);
    const fin = await sv.evaluate((id) => Tareas.esperar(id, 30000), t.id);
    assert.equal(fin.estado, "hecha", fin.error);
    assert.equal(amb.lofty.estado.creados.length, 1); assert.deepEqual(amb.lofty.estado.creados[0].phones, ["+19493728811"]);
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

test("Misión por el bus: pide Propi → Veri → espera tu OK, y al pausar cancela lo que pidió", async () => {
  const amb = await abrir({ storage: { loftyKey: "llave-falsa", chActivo: true } });
  try {
    const sv = await amb.pagina("sv.html"); await sv.waitForTimeout(1200);
    await sv.evaluate(() => ejecutar("iniciar_mision", { zona: "Irvine", meta: 2 }));
    await sv.waitForTimeout(5000);
    let ts = await sv.evaluate(() => Tareas.listar());
    const pw = ts.find((t) => t.robot === "pw" && t.accion === "buscar");
    assert.ok(pw, "pidió a Propi"); assert.equal(pw.entrada.zona, "Irvine"); assert.equal(pw.entrada.paginas, 1);
    assert.ok(ts.some((t) => t.robot === "ow" && t.accion === "leer"), "pidió a Owny leer en vivo");
    // Simular que Propi terminó y dejó 3 domicilios que Chequi ya aprobó
    await amb.sw.evaluate(async (id) => {
      await BUS.reclamar("pw", "simulado"); await BUS.terminar(id, "simulado", { ok: true, resultado: "Listo: recorrí 1 página" });
      const a = (s) => ({ street: s, city: "Irvine", zip: "92618", state: "CA", lofty: "no", via: "bv", found: Date.now() });
      await chrome.storage.local.set({ addresses: { k1: a("1 Oak St"), k2: a("2 Oak St"), k3: a("3 Oak St") } });
    }, pw.id);
    await sv.waitForTimeout(7000);
    ts = await sv.evaluate(() => Tareas.listar());
    const bv = ts.find((t) => t.robot === "bv" && t.accion === "ciclo");
    assert.ok(bv && bv.estado === "pendiente", "pidió a Veri un ciclo");
    // Llegar a la meta sin subida automática → espera el OK del jefe
    await amb.sw.evaluate(() => chrome.storage.local.set({ loftyListos: 2 }));
    await sv.waitForTimeout(5000);
    assert.equal((await amb.leer("mision")).mision.estado, "esperando_ok");
    ts = await sv.evaluate(() => Tareas.listar());
    assert.equal(ts.find((t) => t.id === bv.id).estado, "cancelada", "al llegar a la meta se cancela el ciclo de Veri");
    assert.equal(amb.lofty.estado.creados.length, 0, "no sube nada sin tu OK");
    // Seguir y pausar: cancela lo que pidió la misión
    await sv.evaluate(() => ejecutar("cambiar_meta", { meta: 50 })); await sv.waitForTimeout(5000);
    await sv.evaluate(() => ejecutar("pausar_mision", {}));
    await sv.waitForTimeout(1000);
    ts = await sv.evaluate(() => Tareas.listar({ vivas: true }));
    assert.ok(!ts.some((t) => ["pw", "bv"].includes(t.robot) && /misión/.test(t.origen)), JSON.stringify(ts.map((t) => [t.robot, t.estado])));
    assert.deepEqual(amb.errores, []);
  } finally { await amb.cerrar(); }
});
