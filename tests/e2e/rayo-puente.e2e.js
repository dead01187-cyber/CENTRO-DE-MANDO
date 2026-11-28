// =====================================================================
// Fase C de punta a punta: la pantalla de Rayo (extensión real) con el Rayo del puente real.
// Sombra: la extensión contacta y el puente solo anota lo que haría → la comparación dice "iguales".
// Puente: el puente encuentra el lead, se aprueba desde la pantalla, contacta (Lofty falso en Python),
// y la extensión recibe la fila de Marki, el registro de SMS, Anna silenciada y el contacto del Cerebro.
// Reloj fijo: 10:00 am California (extensión y puente). Sin internet.
// =====================================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { abrir } = require("./ambiente");
const { apagar } = require("./procesos");

const RAIZ = path.resolve(__dirname, "../..");
const PY = ["python3", "python"].find((p) => spawnSync(p, ["--version"]).status === 0);
const T0 = Date.parse("2026-01-15T18:00:00Z");
const lead = (leadId, tel, extra = {}) => ({ leadId, firstName: "Lead" + leadId, lastName: "Prueba", stage: "New Leads", leadTypes: [1], phones: [tel], phoneStatuses: [2], phoneConsentStates: [],
  leadPropertyList: [{ streetAddress: `${leadId} Oak St`, city: "Irvine", label: "Home" }], emails: [`l${leadId}@example.com`], source: "zBuyer", createTime: "2026-01-15T17:58:00GMT", ...extra });
const anna = { direction: "Outbound", textType: "AI", agentId: 1, textTime: "2026-01-15T17:59:00GMT", textContent: "Hi, this is Anna" };
const esperar = async (fn, ms = 30000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("se acabó el tiempo"); await new Promise((r) => setTimeout(r, 300)); } };

async function montar({ leads, textos = {}, pool = [], storage = {} }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rayo-e2e-"));
  const home = path.join(tmp, "navi"); fs.mkdirSync(home);
  // Lofty falso del PUENTE (Python)
  fs.writeFileSync(path.join(tmp, "lofty.json"), JSON.stringify({ leads, textos, pool, llaves: ["llave-texi", "llave-principal"] }));
  const lofty = spawn(PY, [path.join(RAIZ, "tests", "puente", "lofty_falso.py"), path.join(tmp, "lofty.json"), path.join(tmp, "puerto.txt"), path.join(tmp, "estado.json")], { stdio: "ignore" });
  const puertoLofty = await esperar(() => { try { return fs.readFileSync(path.join(tmp, "puerto.txt"), "utf8").trim(); } catch (e) { return ""; } });
  // extensión (con su propio Lofty falso de Playwright, con los mismos leads)
  const amb = await abrir({ permitir: ["http://127.0.0.1:8765/"], leads, textos, pool: pool.map(String), storage: { txKey: "llave-texi", loftyKey: "llave-principal", ...storage } });
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ extension_id: amb.id, cdp_url: "http://127.0.0.1:9", llavero: "archivo", lofty_api: `http://127.0.0.1:${puertoLofty}` }));
  const puente = spawn(PY, [path.join(RAIZ, "puente", "puente.py")], { env: { ...process.env, NAVI_HOME: home, NAVI_SIN_LOG: "1", NAVI_RELOJ_MS: String(T0) }, stdio: "ignore" });
  const token = await esperar(() => { try { return fs.readFileSync(path.join(home, "token"), "utf8").trim(); } catch (e) { return ""; } });
  const api = (ruta, body) => fetch("http://127.0.0.1:8765" + ruta, { method: body ? "POST" : "GET", headers: { "X-Navi-Token": token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
  await esperar(async () => (await api("/salud").catch(() => null)) !== null);
  await api("/llaves", { nombre: "txKey", valor: "llave-texi" }); await api("/llaves", { nombre: "loftyKey", valor: "llave-principal" });
  await amb.sw.evaluate((t) => chrome.storage.local.set({ nvToken: t }), token);
  const estadoLofty = () => { try { return JSON.parse(fs.readFileSync(path.join(tmp, "estado.json"), "utf8")); } catch (e) { return { sms: [], emails: [], muteados: [] }; } };
  const cerrar = async () => { await apagar(puente); await apagar(lofty); await amb.cerrar(); fs.rmSync(tmp, { recursive: true, force: true }); };
  return { amb, api, estadoLofty, cerrar };
}

test("Rayo en SOMBRA: la extensión contacta y el puente solo anota; la comparación sale igual", { skip: !PY && "no hay python3" }, async () => {
  const m = await montar({ leads: [lead(901, "9495550901"), lead(902, "9495550902"), lead(903, "2125550903")], textos: { "902": [anna] }, storage: { ryConfig: { modo: "auto" } } });
  try {
    const p = await m.amb.pagina("ry.html");
    p.on("dialog", (d) => d.accept());
    await p.selectOption("#donde", "sombra");
    await p.waitForFunction(() => Rayo.donde() === "sombra", null, { timeout: 10000 });
    assert.equal((await m.api("/rayo/estado")).modo, "sombra");
    // la extensión trabaja como siempre (automático)
    await p.evaluate(() => Rayo.buscar());
    await p.waitForFunction(() => { const t = Rayo.tarjetas(); return t["901"] && t["901"].estado === "hecho" && t["902"] && t["902"].estado === "ganó Anna"; }, null, { timeout: 40000 });
    // el puente revisó los mismos leads sin tocar nada
    await m.api("/servicios/rayo/ahora", {});
    await esperar(async () => (await m.api("/rayo/estado")).tarjetas.length === 3);
    const e = await m.api("/rayo/estado");
    const porId = Object.fromEntries(e.tarjetas.map((t) => [String(t.leadId), t]));
    assert.equal(porId["901"].haria, "contactar"); assert.equal(porId["902"].haria, "ganó Anna"); assert.equal(porId["903"].estado, "descartado");
    assert.deepEqual(m.estadoLofty().sms || [], [], "en sombra el puente no manda nada");
    await p.evaluate(() => Rayo.verPuente());
    await p.waitForFunction(() => /100% iguales: 3 iguales · 0 distintos/.test(document.getElementById("sombraRes").textContent), null, { timeout: 15000 });
    assert.equal(m.amb.lofty.estado.sms.length, 1, "solo la extensión mandó (1 SMS)");
    assert.deepEqual(m.amb.errores, []);
  } finally { await m.cerrar(); }
});

test("Rayo en el PUENTE: el puente encuentra, se aprueba desde la pantalla, contacta y la extensión recibe todo; regresar a Extensión", { skip: !PY && "no hay python3" }, async () => {
  const m = await montar({ leads: [lead(911, "9495550911")], pool: [911] });
  try {
    const p = await m.amb.pagina("ry.html");
    p.on("dialog", (d) => d.accept());
    await p.selectOption("#donde", "puente");
    await p.waitForFunction(() => Rayo.donde() === "puente", null, { timeout: 10000 });
    assert.equal((await m.api("/rayo/estado")).modo, "puente");
    await m.api("/servicios/rayo/ahora", {});
    await p.waitForFunction(() => { const t = Rayo.tarjetas()["911"]; return t && t.estado === "por aprobar"; }, null, { timeout: 30000 });
    assert.deepEqual(m.estadoLofty().sms || [], [], "con mi OK no sale nada");
    const { ryTarjetas } = await m.amb.leer("ryTarjetas");
    assert.equal(ryTarjetas["911"].estado, "por aprobar", "espejo para Capi y el Mando");
    // aprobar desde la pantalla de Rayo (como el jefe) → el puente contacta
    await p.click("li:has-text('Lead911') button:has-text('Aprobar y contactar')");
    await p.waitForFunction(() => { const t = Rayo.tarjetas()["911"]; return t && t.estado === "hecho"; }, null, { timeout: 40000 });
    const lo = m.estadoLofty();
    assert.deepEqual(lo.sms.map((x) => x.phoneNumber), ["9495550911"]);
    assert.equal(lo.emails.length, 1); assert.ok(lo.muteados.includes("911"), "el puente silenció a Anna");
    assert.equal(m.amb.lofty.estado.sms.length, 0, "la extensión no mandó nada");
    // la extensión recibió lo que hizo el puente
    await p.evaluate(() => Rayo.verPuente());
    await esperar(async () => { const st = await m.amb.leer(["alCola", "smsRegistro", "annaSilenciados", "cerebroContactos"]);
      return (st.alCola || []).some((x) => String(x.leadId) === "911") && (st.smsRegistro || []).some((x) => x.fuente === "Rayo" && x.estado === "enviado" && x.puente)
        && (st.annaSilenciados || {})["911"] && (st.cerebroContactos || []).some((c) => c.leadId === "911" && c.robot === "Rayo"); }, 20000);
    const { svEventos = [] } = await m.amb.leer("svEventos");
    assert.ok(svEventos.some((x) => x.mod === "ry" && /Rayo \(puente\): Contacté a Lead911/.test(x.texto)), "lo que hace el puente sale en la bitácora");
    assert.equal((await m.api("/rayo/estado")).cola.length, 0, "la fila pasó a Marki");
    // regresar a la extensión: el puente deja de trabajar
    await p.selectOption("#donde", "extension");
    await p.waitForFunction(() => Rayo.donde() === "extension", null, { timeout: 10000 });
    assert.equal((await m.api("/rayo/estado")).modo, "extension");
    assert.deepEqual(m.amb.errores, []);
  } finally { await m.cerrar(); }
});
