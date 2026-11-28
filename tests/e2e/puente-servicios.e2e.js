// =====================================================================
// Fase A de punta a punta: la pantalla "Puente" de la extensión real ↔ el puente real (puente/puente.py)
// con sus servicios corriendo solos ↔ un Lofty FALSO (solo para el puente). El llavero es el archivo 600
// (en Linux no hay Llavero de macOS). Nada sale a internet.
// =====================================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { abrir } = require("./ambiente");
const { apagar } = require("./procesos");

const RAIZ = path.resolve(__dirname, "../..");
const PY = ["python3", "python"].find((p) => spawnSync(p, ["--version"]).status === 0);
const BUENA = "lofty.Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z", MALA = "lofty.0000000000000000000000Q1w2";
const esperar = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("se acabó el tiempo"); await new Promise((r) => setTimeout(r, 250)); } };

test("Puente: muestra los servicios, manda las llaves con un clic, avisa si una no sirve, interruptor y puente apagado", { skip: !PY && "no hay python3" }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "puente-e2e-"));
  const home = path.join(tmp, "navi"); fs.mkdirSync(home);
  const pedidos = [];
  const lofty = http.createServer((q, r) => { pedidos.push({ metodo: q.method, ruta: q.url, auth: q.headers.authorization });
    const ok = q.method === "GET" && q.headers.authorization === "token " + BUENA; r.statusCode = ok ? 200 : 401; r.end(JSON.stringify(ok ? { leads: [] } : { message: "invalid" })); }).listen(0, "127.0.0.1");
  await new Promise((r) => lofty.once("listening", r));
  const amb = await abrir({ permitir: ["http://127.0.0.1:8765/"], storage: { txKey: BUENA, loftyKey: MALA } });
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ extension_id: amb.id, cdp_url: "http://127.0.0.1:9", lofty_api: `http://127.0.0.1:${lofty.address().port}`, llavero: "archivo" }));
  let puente = spawn(PY, [path.join(RAIZ, "puente", "puente.py")], { env: { ...process.env, NAVI_HOME: home, NAVI_SIN_LOG: "1" }, stdio: "ignore" });
  try {
    const token = await esperar(() => { try { return fs.readFileSync(path.join(home, "token"), "utf8").trim(); } catch (e) { return ""; } });
    await esperar(async () => (await fetch("http://127.0.0.1:8765/salud", { headers: { "X-Navi-Token": token } }).catch(() => ({}))).status === 200);
    await amb.sw.evaluate((t) => chrome.storage.local.set({ nvToken: t }), token);
    const sp = await amb.pagina("sp.html");
    // los 2 servicios con su estado; sin llaves la salud de Lofty espera
    await sp.waitForSelector('[data-servicio="lofty_salud"]', { timeout: 15000 });
    assert.deepEqual(await sp.$$eval("[data-servicio]", (xs) => xs.map((x) => x.dataset.servicio)), ["despierto", "lofty_salud", "rayo"]);
    assert.match(await sp.textContent('[data-servicio="lofty_salud"]'), /Todavía no hay llaves de Lofty/);
    assert.match(await sp.textContent('[data-llave="txKey"]'), /Todavía no está en el puente/);

    // mandar la llave de Texi con un clic → queda en el llavero del puente → la salud dice OK
    await sp.click('[data-llave="txKey"] [data-a="mandar"]');
    await sp.waitForFunction(() => /Llaves de Lofty OK \(1\)/.test(document.querySelector('[data-servicio="lofty_salud"]').textContent), null, { timeout: 15000 });
    assert.match(await sp.textContent('[data-llave="txKey"]'), /En el puente \(…Xy4z\)/);
    const archivo = JSON.parse(fs.readFileSync(path.join(home, "llaves.json"), "utf8"));
    assert.equal(archivo.txKey, BUENA);
    assert.equal(fs.statSync(path.join(home, "llaves.json")).mode & 0o777, 0o600);
    assert.equal(await sp.locator('[data-llave="txKey"] [data-a="mandar"]').count(), 0, "ya no hace falta mandarla");

    // la llave principal es mala → Error claro, en el robot y en la bitácora
    await sp.click('[data-llave="loftyKey"] [data-a="mandar"]');
    await sp.waitForFunction(() => document.querySelector(".rb .chip").textContent === "Error", null, { timeout: 15000 });
    assert.match(await sp.textContent("#status"), /Lofty principal.*no funciona.*401/);
    const { svEventos = [] } = await amb.leer("svEventos");
    assert.ok(svEventos.some((e) => e.mod === "sp" && /no funciona/.test(e.texto)), "se avisa en la bitácora");
    assert.ok(pedidos.every((p) => p.metodo === "GET" && p.ruta.startsWith("/v1.0/leads?limit=1")), "solo lee de Lofty");

    // interruptor: apagar la salud de Lofty → el robot ya no está en Error
    await sp.click('[data-servicio="lofty_salud"] [data-a="interruptor"]');
    await sp.waitForFunction(() => /Apagado/.test(document.querySelector('[data-servicio="lofty_salud"] .chip').textContent), null, { timeout: 10000 });
    assert.notEqual(await sp.textContent(".rb .chip"), "Error");
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, "servicios.json"), "utf8")).lofty_salud, false);
    const { spRes } = await amb.leer("spRes");
    assert.equal(spRes.ok, true);

    // el Mando muestra la estación del Puente
    const m = await amb.pagina("mando.html");
    await m.waitForFunction(() => { const e = document.querySelector("#e-sp .cuenta"); return e && /servicio/.test(e.textContent); }, null, { timeout: 15000 });

    // el puente se apaga → aviso claro (los demás robots siguen trabajando)
    await apagar(puente); puente = null;
    await sp.click("#run");
    await sp.waitForFunction(() => /El puente está apagado\. Corre puente\/instalar\.sh/.test(document.getElementById("status").textContent), null, { timeout: 10000 });
    assert.equal((await amb.leer("spRes")).spRes.cuenta, "puente apagado");
    assert.deepEqual(amb.errores, []);
  } finally {
    await apagar(puente);
    lofty.close();
    await amb.cerrar();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
