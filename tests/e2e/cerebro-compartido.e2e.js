// =====================================================================
// Fase B de punta a punta: Texi (extensión real) con el puente real como ÁRBITRO.
// Lo que sabe el puente (un SMS de un robot que vive allá, una baja) también frena a Texi, y lo que
// manda Texi le llega al puente. Lofty falso, sin internet.
// =====================================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { abrir } = require("./ambiente");
const { apagar } = require("./procesos");

const RAIZ = path.resolve(__dirname, "../..");
const PY = ["python3", "python"].find((p) => spawnSync(p, ["--version"]).status === 0);
const lead = (leadId, tel) => ({ leadId, firstName: "Lead" + leadId, lastName: "Prueba", stage: "Warm", leadTypes: [1], phones: [tel], phoneStatuses: [2], phoneConsentStates: [],
  leadPropertyList: [{ streetAddress: `${leadId} Oak St`, city: "Irvine", label: "Home" }] });
const PLANTILLA = { txPlantillas: [{ id: "p1", nombre: "Prueba", texto: "Hola {nombre}." }], txConfig: { plantilla: "p1" } };
const esperar = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("se acabó el tiempo"); await new Promise((r) => setTimeout(r, 250)); } };

test("Árbitro: Texi salta al lead que ya contactó un robot del puente y al número con baja en el puente; el puente se entera de lo que manda Texi", { skip: !PY && "no hay python3" }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arbitro-e2e-"));
  const home = path.join(tmp, "navi"); fs.mkdirSync(home);
  const amb = await abrir({ permitir: ["http://127.0.0.1:8765/"], leads: [lead(831, "9495550831"), lead(832, "9495550832"), lead(833, "9495550833")], storage: { txKey: "llave-texi", ...PLANTILLA } });
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ extension_id: amb.id, cdp_url: "http://127.0.0.1:9", llavero: "archivo" }));
  const puente = spawn(PY, [path.join(RAIZ, "puente", "puente.py")], { env: { ...process.env, NAVI_HOME: home, NAVI_SIN_LOG: "1" }, stdio: "ignore" });
  try {
    const token = await esperar(() => { try { return fs.readFileSync(path.join(home, "token"), "utf8").trim(); } catch (e) { return ""; } });
    const api = (ruta, body) => fetch("http://127.0.0.1:8765" + ruta, { method: body ? "POST" : "GET", headers: { "X-Navi-Token": token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
    await esperar(async () => (await api("/salud").catch(() => null)) !== null);
    // lo que ya sabe el puente: un robot de allá le escribió al 831 y el 832 pidió STOP
    await api("/cerebro/anotar", { contacto: { leadId: "831", canal: "sms", robot: "Rayo", tel: "9495550831" } });
    await api("/bajas/marcar", { tels: ["9495550832"], motivo: "STOP", fuente: "Rayo" });
    await amb.sw.evaluate((t) => chrome.storage.local.set({ nvToken: t }), token);

    const tx = await amb.pagina("tx.html");
    await tx.fill("#etapa", "Warm"); await tx.click("#buscar");
    await tx.waitForFunction(() => !document.getElementById("buscar").disabled && /encontr|lista|lead/i.test(document.getElementById("status").textContent), null, { timeout: 20000 });
    await tx.click("#mandar"); await tx.click("#si");
    await tx.waitForFunction(() => /^(Listo|Detenido|Me detengo|No pude)/.test(document.getElementById("status").textContent.trim()), null, { timeout: 90000 });

    assert.deepEqual(amb.lofty.estado.sms.map((x) => x.phoneNumber), ["9495550833"], "solo al que nadie había tocado");
    const { txLista = [] } = await amb.leer("txLista");
    assert.match(txLista.find((x) => x.id === "831").detalle, /Cerebro: ya recibió un SMS .*Rayo/);
    assert.match(JSON.stringify(txLista.find((x) => x.id === "832")), /baja permanente|STOP/i);
    // el puente se enteró del SMS de Texi (y la extensión trajo la baja del puente)
    const c = await api("/cerebro/contactos?desde=0");
    assert.ok(c.contactos.some((x) => x.leadId === "833" && x.robot === "Texi"), JSON.stringify(c.contactos));
    const { smsBajas } = await amb.leer("smsBajas");
    assert.ok(smsBajas.tels["9495550832"], "la baja del puente quedó también en la extensión");
    const r = await api("/cerebro/resumen");
    assert.equal(r.contactos, 2);
    assert.deepEqual(amb.errores, []);
  } finally {
    await apagar(puente);
    await amb.cerrar();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
