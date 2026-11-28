// Botón "Horario SMS" del Centro de Mando: apagado → los robots mandan a cualquier hora (con confirmación,
// botón en rojo y aviso en la bitácora); prendido → de 8:00 a 21:00 California como siempre.
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir } = require("./ambiente");

const lead = (leadId, tel) => ({ leadId, firstName: "Lead" + leadId, lastName: "Prueba", stage: "Warm", leadTypes: [1], phones: [tel], phoneStatuses: [2], phoneConsentStates: [],
  leadPropertyList: [{ streetAddress: `${leadId} Oak St`, city: "Irvine", label: "Home" }] });
const PLANTILLA = { txPlantillas: [{ id: "p1", nombre: "Prueba", texto: "Hola {nombre}." }], txConfig: { plantilla: "p1" } };
async function texiMandar(amb) {
  const tx = await amb.pagina("tx.html");
  await tx.fill("#etapa", "Warm"); await tx.click("#buscar");
  await tx.waitForFunction(() => !document.getElementById("buscar").disabled && /encontr|lista|lead/i.test(document.getElementById("status").textContent), null, { timeout: 20000 });
  await tx.click("#mandar"); await tx.click("#si");
  await tx.waitForFunction(() => /^(Listo|Detenido|Me detengo|No pude)/.test(document.getElementById("status").textContent.trim()), null, { timeout: 60000 });
  return (await tx.textContent("#status")).trim();
}

test("Horario SMS: el botón del Mando lo apaga (con confirmación) y Texi manda a las 22:30; al prenderlo vuelve a bloquear", async () => {
  const amb = await abrir({ horaCA: "2026-01-15T22:30", leads: [lead(951, "9495550951")], storage: { txKey: "llave-texi", ...PLANTILLA } });
  try {
    const m = await amb.pagina("mando.html");
    assert.equal((await m.textContent("#b-horario")).trim(), "Horario SMS: 8–21");
    // cancelar la confirmación no cambia nada
    m.once("dialog", (d) => d.dismiss());
    await m.click("#b-horario");
    await m.waitForTimeout(500);
    assert.notEqual(((await amb.leer("smsPolitica")).smsPolitica || {}).sinHorario, true);
    // aceptar → apagado, en rojo y en la bitácora
    m.once("dialog", (d) => { assert.match(d.message(), /TCPA/); d.accept(); });
    await m.click("#b-horario");
    await m.waitForFunction(() => document.getElementById("b-horario").textContent.includes("APAGADO"), null, { timeout: 5000 });
    assert.ok(await m.$eval("#b-horario", (b) => b.classList.contains("horario-apagado")));
    assert.equal((await amb.leer("smsPolitica")).smsPolitica.sinHorario, true);
    const { svEventos = [] } = await amb.leer("svEventos");
    assert.ok(svEventos.some((e) => /Horario de SMS APAGADO/.test(e.texto)));
    // Texi a las 22:30 sí manda
    await texiMandar(amb);
    assert.deepEqual(amb.lofty.estado.sms.map((x) => x.phoneNumber), ["9495550951"]);
    // prender otra vez (sin confirmación) → bloquea
    await m.click("#b-horario");
    await m.waitForFunction(() => document.getElementById("b-horario").textContent === "Horario SMS: 8–21", null, { timeout: 5000 });
    assert.equal((await amb.leer("smsPolitica")).smsPolitica.sinHorario, false);
    assert.deepEqual(amb.errores, []);
  } finally { await amb.cerrar(); }
});
