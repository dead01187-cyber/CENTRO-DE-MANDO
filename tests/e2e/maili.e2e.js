// Maili: correos desde Lofty (cuenta de Texi 2) con Lofty falso. Nada sale a internet.
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir } = require("./ambiente");

const lead = (leadId, extra = {}) => ({ leadId, firstName: "Lead" + leadId, lastName: "Prueba", stage: "Warm", leadTypes: [1], emails: [`lead${leadId}@correo.com`],
  leadPropertyList: [{ streetAddress: `${leadId} Oak St`, city: "Irvine", label: "Home" }], ...extra });
const BASE = { t2Key: "llave-texi2", mlPlantillas: [{ id: "p1", nombre: "Prueba", asunto: "Your home in {ciudad}", texto: "Hi {nombre}," }],
  mlConfig: { plantilla: "p1", remitente: "Mark · Rubio Real Estate", direccion: "123 Main St, Irvine, CA 92618", tope: 50 } };
const AHORA = Date.parse("2026-01-15T18:00:00Z"); // 10:00 en California
async function buscar(ml) {
  await ml.fill("#etapa", "Warm"); await ml.click("#buscar");
  await ml.waitForFunction(() => !document.getElementById("buscar").disabled && /Encontré|No encontré|No pude|Falta/.test(document.getElementById("status").textContent), null, { timeout: 20000 });
}
const fin = (ml) => ml.waitForFunction(() => /^(Listo|Detenido)/.test(document.getElementById("status").textContent.trim()), null, { timeout: 60000 });

test("Maili: manda solo a quien se puede, con pie legal, y lo anota en el Cerebro", async () => {
  const leads = [lead(701), lead(702, { cannotEmail: true }), lead(703, { emails: [] }), lead(704), lead(705), lead(706)];
  const amb = await abrir({ leads,
    correos: { 705: [{ direction: "Outbound", emailType: "Manual", emailEventTime: "2026-01-15 16:00:00 GMT", emailSubject: "Following up" }],
               706: [{ direction: "Outbound", emailType: "Auto", emailEventTime: "2026-01-15 16:00:00 GMT", emailSubject: "Market report" }] },
    storage: { ...BASE, cerebroContactos: [{ id: "c1", t: AHORA - 2 * 864e5, leadId: "704", canal: "email", robot: "Maili" }] } });
  try {
    const ml = await amb.pagina("ml.html");
    await ml.evaluate(() => { window.MAILI_CORE.pausaMs = () => 0; });
    await buscar(ml);
    assert.match(await ml.textContent("#status"), /Encontré 4 lead\(s\) con correo \(salté 1 sin correo, 1 que Lofty marca/);
    assert.equal(amb.lofty.estado.emails.length, 0, "buscar no manda nada");
    assert.equal((await ml.textContent("#nMarcados")).trim(), "3", "el 704 (correo hace 2 días) no queda marcado");
    await ml.click("#mandar");
    assert.match(await ml.textContent("#confTxt"), /3 correo\(s\)/);
    await ml.click("#si"); await fin(ml);
    const env = amb.lofty.estado.emails;
    assert.deepEqual(env.map((e) => e.leadId), [701, 706], "705: una persona le escribió hoy; 706: el automático de Lofty no cuenta");
    assert.equal(env[0].subject, "Your home in Irvine");
    assert.match(env[0].content, /^Hi Lead701,<br><br>--<br>Mark · Rubio Real Estate<br>123 Main St, Irvine, CA 92618<br>If you'd rather not receive emails/);
    const st = await amb.leer(["cerebroContactos", "mlHoy", "emailRegistro", "mlLista"]);
    assert.deepEqual(st.cerebroContactos.filter((c) => c.canal === "email" && c.robot === "Maili").map((c) => c.leadId).sort(), ["701", "704", "706"]);
    assert.equal(st.mlHoy.n, 2);
    assert.ok(st.emailRegistro.some((e) => e.leadId === "705" && e.estado === "bloqueado" && /persona/.test(e.motivo)));
    assert.equal(st.mlLista.find((x) => x.id === "705").estado, "saltado");
    // una segunda vuelta no repite a nadie (máximo 1 cada 7 días)
    await buscar(ml);
    const l2 = (await amb.leer("mlLista")).mlLista;
    assert.deepEqual(l2.filter((x) => x.marcado).map((x) => x.id), ["705"], "701, 704 y 706 ya recibieron correo: no se marcan");
    await ml.click("#mandar"); await ml.click("#si"); await fin(ml);
    assert.equal(amb.lofty.estado.emails.length, 2, "al 705 lo vuelve a frenar la revisión en Lofty");
    assert.deepEqual(amb.errores, []);
  } finally { await amb.cerrar(); }
});

test("Maili: sin pie legal no manda; con tope diario se detiene; si Lofty falla al revisar el lead, no manda", async () => {
  const amb = await abrir({ leads: [lead(711), lead(712), lead(713)], fallar: { "GET /leads/711": { status: 500 } },
    storage: { ...BASE, mlConfig: { ...BASE.mlConfig, direccion: "", tope: 1 } } });
  try {
    const ml = await amb.pagina("ml.html");
    await ml.evaluate(() => { window.MAILI_CORE.pausaMs = () => 0; });
    await buscar(ml);
    await ml.click("#mandar");
    assert.match(await ml.textContent("#status"), /No puedo mandar todavía:.*dirección postal/);
    assert.ok(await ml.isHidden("#confirma"));
    await ml.fill("#direccion", "123 Main St, Irvine, CA 92618"); await ml.dispatchEvent("#direccion", "change");
    await ml.click("#mandar"); await ml.click("#si"); await fin(ml);
    assert.deepEqual(amb.lofty.estado.emails.map((e) => e.leadId), [712], "711 falló al revisarse; 713 ya no cabe en el tope de 1");
    const { svEventos = [] } = await amb.leer("svEventos");
    assert.ok(svEventos.some((e) => /tope de 1 correos por día/.test(e.texto)));
    const { mlLista } = await amb.leer("mlLista");
    assert.equal(mlLista.find((x) => x.id === "711").estado, "error");
    assert.equal(mlLista.find((x) => x.id === "713").estado, "");
  } finally { await amb.cerrar(); }
});

test("Maili aparece en el Centro de Mando con su contador", async () => {
  const amb = await abrir({ storage: { ...BASE, mlHoy: { dia: "2026-01-15", n: 4 } } });
  try {
    const m = await amb.pagina("mando.html");
    await m.waitForFunction(() => /4/.test(document.querySelector("#e-ml .cuenta").textContent), null, { timeout: 10000 });
    assert.match(await m.textContent("#e-ml .cuenta"), /4 correos hoy/);
    assert.deepEqual(amb.errores, []);
  } finally { await amb.cerrar(); }
});
