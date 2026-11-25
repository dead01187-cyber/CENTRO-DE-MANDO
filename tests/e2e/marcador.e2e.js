// Fase Anna 3 de punta a punta: el marcador del Tablero (Lofty falso, solo lee; reloj fijo 10:00 am California).
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir } = require("./ambiente");
const T0 = Date.parse("2026-01-15T18:00:00Z"), MIN = 60e3;
const gmt = (t) => new Date(t).toISOString().replace(/\.\d+Z$/, "GMT");
const creado = T0 - 3 * 3600e3;
const lead = (leadId, extra = {}) => ({ leadId, firstName: "L" + leadId, lastName: "P", stage: "New Leads", leadTypes: [1], phones: ["949555" + leadId], createTime: gmt(creado), ...extra });

test("Marcador: compara Anna vs robots (contactados, minutos, contestó, Warm/Hot, citas, STOP) sin escribir nada en Lofty", async () => {
  const amb = await abrir({
    leads: [lead(1001), lead(1002, { stage: "Hot" }), lead(1003)],
    pool: ["1001", "1003"],
    textos: {
      "1001": [{ direction: "Outbound", textType: "AI", textTime: gmt(creado + 10 * MIN), textContent: "Hi, this is Anna" }, { direction: "Inbound", textTime: gmt(creado + 40 * MIN), textContent: "STOP" }],
      "1003": [{ direction: "Outbound", textType: "AI", textTime: gmt(creado + 30 * MIN), textContent: "Hi, this is Anna" }],
      "1002": [{ direction: "Outbound", textType: "Manual", textTime: gmt(creado + 1 * MIN), textContent: "Hi from Rayo" }, { direction: "Inbound", textTime: gmt(creado + 20 * MIN), textContent: "yes call me" }],
    },
    citas: { "1002": [{ id: 1, createTime: gmt(creado + 60 * MIN), deadline: gmt(T0 + 86400e3) }] },
    storage: { loftyKey: "llave-principal", cerebroContactos: [{ t: creado + 1 * MIN, leadId: "1002", canal: "sms", robot: "Rayo" }] } });
  try {
    const tb = await amb.pagina("tablero.html"); await tb.waitForTimeout(1500);
    await tb.click("#marcadorBtn");
    await tb.waitForFunction(() => /Actualizado/.test(document.getElementById("marcadorEstado").textContent), null, { timeout: 30000 });
    const filas = await tb.$$eval("#marcador tr", (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent)));
    const fila = (n) => filas.find((f) => f[0].startsWith(n));
    assert.deepEqual(fila("Leads contactados"), ["Leads contactados", "2", "1", "Anna"]);
    assert.deepEqual(fila("Tiempo al primer contacto"), ["Tiempo al primer contacto (mediana)", "20 min", "1 min", "Tus robots"]);
    assert.deepEqual(fila("% que contestó"), ["% que contestó", "50%", "100%", "Tus robots"]);
    assert.deepEqual(fila("Pasaron a Warm"), ["Pasaron a Warm / Hot", "0", "1", "Tus robots"]);
    assert.deepEqual(fila("Citas"), ["Citas", "0", "1", "Tus robots"]);
    assert.deepEqual(fila("Bajas"), ["Bajas (STOP)", "1 (50%)", "0 (0%)", "Tus robots"]);
    assert.match(await tb.textContent("#marcadorRes"), /tus robots ganan 5 de 6/);
    assert.equal(amb.lofty.estado.llamadas.filter((x) => x.metodo !== "GET").length, 0, "el marcador solo lee");
    assert.deepEqual(amb.errores, []);
  } finally { await amb.cerrar(); }
});
