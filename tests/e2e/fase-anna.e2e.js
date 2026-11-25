// =====================================================================
// Fase Anna 1 de punta a punta (Lofty falso, sin internet, reloj fijo 10:00 am California = 18:00 GMT):
// Rayo (leads nuevos, carrera con Anna, cola de Marki, SMS + email), Cerebro en Texi y Limpi con Anna.
// =====================================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir } = require("./ambiente");

const lead = (leadId, tel, extra = {}) => ({ leadId, firstName: "Lead" + leadId, lastName: "Prueba", stage: "New Leads", leadTypes: [1], phones: [tel], phoneStatuses: [2],
  phoneConsentStates: [], leadPropertyList: [{ streetAddress: `${leadId} Oak St`, city: "Irvine", label: "Home" }], emails: [`l${leadId}@example.com`], source: "zBuyer",
  createTime: "2026-01-15T17:58:00GMT", ...extra });
const anna = (min) => ({ direction: "Outbound", textType: "AI", agentId: 1, textTime: new Date(Date.parse("2026-01-15T18:00:00Z") - min * 60e3).toISOString().replace(/\.\d+Z$/, "GMT"), textContent: "Hi, this is Anna" });
const persona = (min) => ({ ...anna(min), textType: "Manual", agentId: 347 });

async function rayo(amb) {
  const p = await amb.pagina("ry.html");
  await p.waitForFunction(() => window.Rayo && Object.keys(Rayo.tarjetas()).length > 0, null, { timeout: 20000 });
  return p;
}

test("Rayo: lead nuevo de zBuyer en CA → tarjeta 'por aprobar'; ignora otras fuentes y descarta fuera de CA; con tu OK gana a Anna (la silencia), manda SMS + email y lo pone en la cola de Marki", async () => {
  const amb = await abrir({
    leads: [lead(801, "9495550801"), lead(802, "9495550802", { source: "propwire" }), lead(803, "2125550803")],
    pool: ["801"], storage: { txKey: "llave-texi", loftyKey: "llave-principal" } });
  try {
    const p = await rayo(amb);
    const t = await p.evaluate(() => Rayo.tarjetas());
    assert.equal(t["801"].estado, "por aprobar");
    assert.match(t["801"].sms, /Hi Lead801.*Irvine/);
    assert.equal(t["802"], undefined, "propwire no es de Rayo");
    assert.equal(t["803"].estado, "descartado"); assert.match(t["803"].motivo, /no son de California/);
    assert.equal(amb.lofty.estado.sms.length, 0, "con mi OK: nada sale solo");
    await p.click("li:has-text('Lead801') button:has-text('Aprobar y contactar')");
    await p.waitForFunction(() => Rayo.tarjetas()["801"].estado === "hecho", null, { timeout: 30000 });
    assert.deepEqual(amb.lofty.estado.sms.map((x) => x.phoneNumber), ["9495550801"]);
    assert.equal(amb.lofty.estado.emails.length, 1); assert.match(amb.lofty.estado.emails[0].subject, /Irvine/);
    assert.ok(amb.lofty.estado.muteados.has("801"), "Rayo ganó: silenció a Anna en ese lead");
    const st = await amb.leer(["alCola", "cerebroContactos", "annaSilenciados"]);
    assert.deepEqual(st.alCola.map((x) => x.leadId), ["801"]);
    assert.ok(st.cerebroContactos.some((c) => c.leadId === "801" && c.canal === "sms" && c.robot === "Rayo"));
    assert.ok(st.cerebroContactos.some((c) => c.leadId === "801" && c.canal === "email"));
    assert.equal(st.annaSilenciados["801"].robot, "Rayo");
    assert.deepEqual(amb.errores, []);
  } finally { await amb.cerrar(); }
});

test("Rayo: si Anna ya le escribió, ganó Anna y Rayo no lo toca; si una persona le escribió, lo salta (Cerebro)", async () => {
  const amb = await abrir({
    leads: [lead(811, "9495550811"), lead(812, "9495550812")],
    textos: { "811": [anna(3)], "812": [persona(20)] }, storage: { txKey: "llave-texi", ryConfig: { modo: "auto" } } });
  try {
    const p = await rayo(amb);
    await p.waitForFunction(() => { const t = Rayo.tarjetas(); return t["811"] && t["812"] && !["aprobado", "contactando"].includes(t["811"].estado) && !["aprobado", "contactando"].includes(t["812"].estado); }, null, { timeout: 30000 });
    const t = await p.evaluate(() => Rayo.tarjetas());
    assert.equal(t["811"].estado, "ganó Anna");
    assert.equal(t["812"].estado, "saltado"); assert.match(t["812"].motivo, /una persona le escribió/);
    assert.equal(amb.lofty.estado.sms.length, 0); assert.equal(amb.lofty.estado.emails.length, 0);
    assert.deepEqual(amb.errores, []);
  } finally { await amb.cerrar(); }
});

test("Cerebro en Texi: no arma lista con los leads de Anna; y antes de mandar salta al que le escribió una persona", async () => {
  const PLANTILLA = { txPlantillas: [{ id: "p1", nombre: "Prueba", texto: "Hola {nombre}." }], txConfig: { plantilla: "p1" } };
  const amb = await abrir({ leads: [lead(821, "9495550821", { stage: "Warm" }), lead(822, "9495550822", { stage: "Warm" }), lead(823, "9495550823", { stage: "Warm" })],
    pool: ["822"], textos: { "823": [persona(60)] }, storage: { txKey: "llave-texi", loftyKey: "llave-principal", ...PLANTILLA } });
  try {
    const tx = await amb.pagina("tx.html");
    await tx.fill("#etapa", "Warm"); await tx.click("#buscar");
    await tx.waitForFunction(() => !document.getElementById("buscar").disabled && /Encontr|No encontr/.test(document.getElementById("status").textContent), null, { timeout: 20000 });
    assert.match(await tx.textContent("#status"), /1 que trabaja Anna/);
    await tx.click("#mandar"); await tx.click("#si");
    await tx.waitForFunction(() => /^(Listo|Detenido)/.test(document.getElementById("status").textContent.trim()), null, { timeout: 60000 });
    assert.deepEqual(amb.lofty.estado.sms.map((x) => x.phoneNumber), ["9495550821"]);
    const { txLista = [] } = await amb.leer("txLista");
    assert.match(txLista.find((x) => x.id === "823").detalle, /Cerebro: una persona le escribió/);
    assert.deepEqual(amb.errores, []);
  } finally { await amb.cerrar(); }
});

test("Limpi: 'Anna: números fuera de California' enseña la lista y solo silencia con tu OK", async () => {
  const amb = await abrir({ leads: [lead(831, "9495550831"), lead(832, "2125550832")], pool: ["831", "832"], storage: { loftyKey: "llave-principal" } });
  try {
    const li = await amb.pagina("li.html"); await li.waitForTimeout(1200);
    await li.click("#annaFueraBtn");
    await li.waitForFunction(() => !document.getElementById("annaFueraOk").hidden, null, { timeout: 15000 });
    assert.match(await li.textContent("#annaFueraLista"), /Lead832/);
    assert.doesNotMatch(await li.textContent("#annaFueraLista"), /Lead831/);
    assert.equal(amb.lofty.estado.muteados.size, 0, "nada sin tu OK");
    await li.click("#annaFueraOk");
    await li.click("[data-pregunta] .si");
    await li.waitForFunction(() => /Silencié a Anna en 1/.test(document.getElementById("status").textContent), null, { timeout: 15000 });
    assert.deepEqual([...amb.lofty.estado.muteados], ["832"]);
    assert.deepEqual(amb.errores, []);
  } finally { await amb.cerrar(); }
});
