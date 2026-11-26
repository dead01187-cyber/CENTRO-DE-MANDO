// =====================================================================
// Fase 7 de punta a punta: la página de Navi en la extensión real ↔ el puente real (puente/puente.py)
// en 127.0.0.1:8765 ↔ un browser-use FALSO (no abre ningún navegador ni sale a internet).
// =====================================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { abrir } = require("./ambiente");

const RAIZ = path.resolve(__dirname, "../..");
const URL_ELM = "https://www.homes.com/property/12352-elmwood-st-garden-grove-ca/sp9g4fw1ndpwt/";
const PY = ["python3", "python"].find((p) => spawnSync(p, ["--version"]).status === 0);
const FALSO_BU = `#!/usr/bin/env python3
import json, os, sys, time
guion = sys.stdin.read()
p = json.loads(os.environ["NAVI_PARAMS"]); salida = os.environ["NAVI_SALIDA"]
print("Abriendo " + p["url"], flush=True)
if "captcha" in p["url"]:
    print("NAVI:" + json.dumps({"tipo": "ayuda", "motivo": "Hay un CAPTCHA en la página"}), flush=True); sys.exit(3)
time.sleep(1)
for i in (1, 2, 3):
    open(os.path.join(salida, "%02d.jpg" % i), "wb").write(b"x" * 900)
    print("NAVI:" + json.dumps({"tipo": "progreso", "txt": "Foto %d de 3" % i}), flush=True)
print("Bajé 3 de 3 fotos.", flush=True)
print("NAVI:" + json.dumps({"tipo": "resultado", "carpeta": salida, "fotos": 3, "direccion": "12352 Elmwood St, Garden Grove"}), flush=True)
`;
const esperar = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("se acabó el tiempo"); await new Promise((r) => setTimeout(r, 250)); } };

test("Navi: dice que el puente está apagado; con el puente baja las fotos, escribe en la bitácora, pide ayuda con CAPTCHA y atiende tareas de Capi", { skip: !PY && "no hay python3" }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "navi-e2e-"));
  const home = path.join(tmp, "navi"); fs.mkdirSync(home);
  const bu = path.join(tmp, "browser-use"); fs.writeFileSync(bu, FALSO_BU, { mode: 0o755 });
  // "Brave" falso con el puerto de depuración
  const brave = http.createServer((q, r) => r.end(JSON.stringify({ Browser: "Brave/1.73", webSocketDebuggerUrl: "ws://x" }))).listen(0, "127.0.0.1");
  await new Promise((r) => brave.once("listening", r));
  const amb = await abrir({ permitir: ["http://127.0.0.1:8765/"], storage: { nvToken: "todavia-no" } });
  let puente = null;
  try {
    const nv = await amb.pagina("navi.html");
    // 1) puente apagado: el mensaje claro
    await nv.waitForFunction(() => /El puente está apagado\. Corre puente\/instalar\.sh/.test(document.getElementById("puente").textContent), null, { timeout: 15000 });
    assert.equal(await nv.textContent("#extId"), amb.id, "Navi enseña el ID de la extensión para instalar.sh");

    // 2) se prende el puente con el ID de esta extensión
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ extension_id: amb.id, browser_use: bu, cdp_url: `http://127.0.0.1:${brave.address().port}`, descargas: path.join(tmp, "Downloads", "navi") }));
    puente = spawn(PY, [path.join(RAIZ, "puente", "puente.py")], { env: { ...process.env, NAVI_HOME: home, NAVI_SIN_LOG: "1" }, stdio: "ignore" });
    const token = await esperar(() => { try { return fs.readFileSync(path.join(home, "token"), "utf8").trim(); } catch (e) { return ""; } });
    await esperar(async () => (await fetch("http://127.0.0.1:8765/salud", { headers: { "X-Navi-Token": token } }).catch(() => ({}))).status === 200);
    // clave mala → mensaje claro; clave buena → puente listo y recetas
    await nv.click("#revisar");
    await nv.waitForFunction(() => /clave del puente no coincide/.test(document.getElementById("puente").textContent), null, { timeout: 10000 });
    await nv.fill("#token", token); await nv.dispatchEvent("#token", "change");
    await nv.waitForFunction(() => /Puente listo/.test(document.getElementById("puente").textContent), null, { timeout: 10000 });
    assert.equal(await nv.inputValue("#token"), "••••••••••••", "la clave no se queda a la vista");
    assert.deepEqual(await nv.$$eval("#receta option", (os) => os.map((o) => o.value)), ["fotos_listing", "listings_agente"]);
    const { nvRecetas } = await amb.leer("nvRecetas");
    assert.deepEqual(nvRecetas.map((r) => r.nombre), ["fotos_listing", "listings_agente"], "Capi conoce la lista de recetas");

    // 3) URL mala: ni sale al puente
    await nv.selectOption("#receta", "fotos_listing");
    await nv.fill('[data-p="url"]', "https://www.zillow.com/homedetails/x");
    await nv.click("#arrancar");
    await nv.waitForFunction(() => /solo se aceptan direcciones de www\.homes\.com/.test(document.getElementById("status").textContent));

    // 4) Elmwood St: Trabajando → ¡Terminé! con log en vivo, resultado y bitácora
    await nv.fill('[data-p="url"]', URL_ELM);
    await nv.click("#arrancar");
    await nv.waitForFunction(() => document.querySelector(".rb .chip").textContent === "Trabajando", null, { timeout: 10000 });
    await nv.waitForFunction(() => !document.getElementById("resultado").hidden, null, { timeout: 20000 });
    assert.match(await nv.textContent("#resultado"), /Listo: bajé 3 foto\(s\) de 12352 Elmwood St, Garden Grove/);
    assert.match(await nv.textContent("#log"), /Abriendo https:\/\/www\.homes\.com\/property\/12352-elmwood/);
    assert.equal(await nv.textContent(".rb .chip"), "¡Terminé!");
    const { nvRes } = await amb.leer("nvRes");
    assert.equal(nvRes.estado, "terminado"); assert.equal(nvRes.fotos, 3);
    assert.ok(fs.readdirSync(nvRes.carpeta).includes("03.jpg"), "las fotos quedan en ~/Downloads/navi/fotos_listing/<fecha>/");
    assert.match(nvRes.carpeta, /Downloads\/navi\/fotos_listing\/\d{4}-\d\d-\d\d_\d{6}$/);
    const { svEventos = [] } = await amb.leer("svEventos");
    const deNavi = svEventos.filter((e) => e.mod === "nv").map((e) => e.texto);
    assert.ok(deNavi.some((t) => /Arranqué la receta fotos_listing/.test(t)), deNavi.join(" | "));
    assert.ok(deNavi.some((t) => /^Listo: bajé 3 foto/.test(t)), deNavi.join(" | "));

    // 5) CAPTCHA → Necesito ayuda
    await nv.fill('[data-p="url"]', "https://www.homes.com/property/captcha-st/abc123/");
    await nv.click("#arrancar");
    await nv.waitForFunction(() => document.querySelector(".rb .chip").textContent === "Necesito ayuda", null, { timeout: 15000 });
    assert.match(await nv.textContent("#status"), /CAPTCHA/);

    // 6) Capi por el bus: receta de la lista → hecha; receta inventada → falla sin llegar al puente
    const hecha = await nv.evaluate(async (url) => { const t = await Tareas.crear("nv", "receta", { origen: "capi", entrada: { receta: "fotos_listing", params: { url } } }); return Tareas.esperar(t.id, 30000); }, URL_ELM);
    assert.equal(hecha.estado, "hecha", JSON.stringify(hecha)); assert.match(hecha.resultado, /bajé 3 foto/);
    const mala = await nv.evaluate(async () => { const t = await Tareas.crear("nv", "receta", { origen: "capi", entrada: { receta: "borrar_todo", params: {} } }); return Tareas.esperar(t.id, 30000); });
    assert.notEqual(mala.estado, "hecha"); assert.match(mala.error, /No existe la receta/);
    assert.deepEqual(amb.errores, []);
  } finally {
    if (puente) puente.kill();
    brave.close();
    await amb.cerrar();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
