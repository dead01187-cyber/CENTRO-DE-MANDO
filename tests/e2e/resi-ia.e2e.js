// =====================================================================
// Fase Anna 2 de punta a punta: Resi con IA (Claude falso, Lofty falso, sin internet; 10:00 am California).
// =====================================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir } = require("./ambiente");

const T0 = Date.parse("2026-01-15T18:00:00Z");
const gmt = (minAntes) => new Date(T0 - minAntes * 60e3).toISOString().replace(/\.\d+Z$/, "GMT");
const sale = (id, min, txt) => ({ id: `o${id}`, direction: "Outbound", textType: "Manual", agentId: 1, textTime: gmt(min), textContent: txt });
const entra = (id, min, txt) => ({ id: `i${id}`, direction: "Inbound", textTime: gmt(min), textContent: txt });
const lead = (leadId, tel, extra = {}) => ({ leadId, firstName: "Lead" + leadId, lastName: "Prueba", stage: "New Leads", leadTypes: [1], phones: [tel], phoneStatuses: [2],
  leadPropertyList: [{ streetAddress: `${leadId} Oak St`, city: "Irvine", label: "Home" }], ...extra });
// Claude falso: contesta según el lead del que se trate
const claude = (cuerpo) => {
  const u = JSON.stringify(cuerpo.messages || []);
  if (/Lead901/.test(u)) return JSON.stringify({ categoria: "caliente", temperatura: "caliente", calif: { cuando: "2 months", porque: "relocating", precio: null, agente: "no" }, resumen: "Quiere vender en 2 meses", summary: "Wants to sell in 2 months, relocating", borrador: "Great! Do you have 10 minutes today or tomorrow for a quick call?", urgente: true });
  if (/Lead911/.test(u)) return JSON.stringify({ categoria: "interesado", temperatura: "tibio", calif: { cuando: null, porque: null, precio: null, agente: null }, resumen: "Pregunta precio", summary: "Asked about price", borrador: "Happy to help! When would you be thinking of selling?" });
  return JSON.stringify({ categoria: "otro", borrador: "Thanks!" });
};
const casosDe = (amb) => amb.leer("rsCasos").then((s) => s.rsCasos || {});
async function esperarCasos(amb, ids) {
  const t0 = Date.now();
  for (;;) { const c = await casosDe(amb); if (ids.every((i) => c[i] && c[i].categoria)) return c; if (Date.now() - t0 > 30000) throw new Error("Resi no terminó: " + JSON.stringify(Object.keys(c))); await new Promise((r) => setTimeout(r, 500)); }
}

test("Resi IA: califica (caliente → nota en inglés, etapa Hot sugerida, aviso a Capi), no contesta temas de herencia y STOP pone cannotText; con tu OK no sale nada", async () => {
  const amb = await abrir({ claude,
    leads: [lead(901, "9495550901"), lead(902, "9495550902"), lead(903, "9495550903")],
    textos: {
      "901": [sale(901, 120, "Hi Lead901, still the owner?"), entra(901, 10, "Yes, thinking of selling in 2 months, we're relocating")],
      "902": [sale(902, 120, "Hi"), entra(902, 10, "My mom passed and the house is in probate, is that a problem?")],
      "903": [sale(903, 120, "Hi"), entra(903, 10, "STOP")],
    },
    storage: { txKey: "llave-texi", svKey: "llave-claude", txEnviados: { "901": { t: T0 - 7200e3 }, "902": { t: T0 - 7200e3 }, "903": { t: T0 - 7200e3 } } } });
  try {
    const rs = await amb.pagina("rs.html");
    const c = await esperarCasos(amb, ["901", "902", "903"]);
    assert.equal(c["901"].categoria, "caliente");
    assert.equal(c["901"].calif.cuando, "2 months"); assert.equal(c["901"].calif.agente, "no");
    assert.equal(c["901"].etapaSugerida, "Hot");
    assert.equal(c["902"].categoria, "sensible"); assert.equal(c["902"].borrador, ""); assert.equal(c["902"].estado, "atender");
    assert.equal(c["903"].categoria, "baja");
    assert.ok(amb.lofty.estado.cambios.some((x) => x.leadId === "903" && x.body.cannotText === true), "STOP → cannotText en Lofty");
    assert.ok(!amb.claudeLlamadas.some((b) => /Lead902|Lead903/.test(JSON.stringify(b.messages))), "temas de herencia y STOP no pasan por la IA");
    const nota901 = amb.lofty.estado.notas.find((n) => n.leadId === 901);
    assert.match(nota901.content, /Classified as: Hot lead\..*Qualification — Timeline: 2 months \| Reason: relocating \| Agent: no\. Suggested stage: Hot\./);
    const { rsAviso } = await amb.leer("rsAviso");
    assert.match(rsAviso.texto, /CALIENTE/); assert.match(rsAviso.texto, /legal, de financiamiento o de herencia/);
    assert.equal(amb.lofty.estado.sms.length, 0, "con 'aprobar cada respuesta' prendido no sale nada");
    assert.equal(amb.lofty.estado.cambios.filter((x) => x.body.stage).length, 0, "la etapa no se mueve sola");
    // mover la etapa con un clic (te pregunta antes)
    await rs.click("li[data-id='901'] button[data-a='etapa']");
    await rs.click("[data-pregunta] .si");
    await rs.waitForFunction(() => !document.querySelector("li[data-id='901'] button[data-a='etapa']"), null, { timeout: 10000 });
    assert.ok(amb.lofty.estado.cambios.some((x) => x.leadId === "901" && x.body.stage === "Hot"));
    assert.deepEqual(amb.errores, []);
  } finally { await amb.cerrar(); }
});

test("Resi IA en automático: contesta solo a un interesado (Cerebro: es respuesta a quien nos escribió), con ritmo humano", async () => {
  const amb = await abrir({ claude,
    leads: [lead(911, "9495550911")],
    textos: { "911": [sale(911, 300, "Hi Lead911, still the owner?"), entra(911, 15, "yes, how much could I get?")] },
    storage: { txKey: "llave-texi", svKey: "llave-claude", rsConfig: { aprobar: false }, txEnviados: { "911": { t: T0 - 300 * 60e3 } },
      cerebroContactos: [{ t: T0 - 300 * 60e3, leadId: "911", canal: "sms", robot: "Texi" }] } });
  try {
    await amb.pagina("rs.html");
    const t0 = Date.now();
    while (!amb.lofty.estado.sms.length && Date.now() - t0 < 40000) await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual(amb.lofty.estado.sms.map((x) => [x.phoneNumber, x.content]), [["9495550911", "Happy to help! When would you be thinking of selling?"]]);
    const c = await casosDe(amb);
    assert.equal(c["911"].estado, "respondido");
    assert.deepEqual(amb.errores, []);
  } finally { await amb.cerrar(); }
});
