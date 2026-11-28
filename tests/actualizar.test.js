// actualizar.sh: baja la versión, enseña lo que va a borrar y pide permiso, respeta respaldos y node_modules,
// y deja la extensión igual que la versión nueva. Se prueba con un zip local (git archive), sin internet.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execSync } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const hay = (p) => spawnSync("sh", ["-c", `command -v ${p}`]).status === 0;
const listo = hay("unzip") && hay("git") && spawnSync("git", ["-C", RAIZ, "rev-parse", "HEAD"]).status === 0;

test("actualizar.sh: pide permiso para borrar, respeta respaldos y actualiza", { skip: !listo && "falta unzip o git" }, () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), "actualizar-"));
  try {
    const ext = path.join(T, "ext"); fs.mkdirSync(ext);
    execSync(`git -C "${RAIZ}" archive --format=tar HEAD | tar -x -C "${ext}"`);
    execSync(`git -C "${RAIZ}" archive --format=zip --prefix=CENTRO-DE-MANDO-rama/ HEAD > "${path.join(T, "nuevo.zip")}"`);
    fs.writeFileSync(path.join(ext, "robot-viejo.js"), "viejo");
    fs.writeFileSync(path.join(ext, "respaldo-2026-11-28.json"), "{\"mio\":1}");
    fs.mkdirSync(path.join(ext, "node_modules", "x"), { recursive: true }); fs.writeFileSync(path.join(ext, "node_modules", "x", "i.js"), "y");
    fs.writeFileSync(path.join(ext, "README.md"), "lo cambié a mano");
    const correr = (entrada, extra = {}) => spawnSync("bash", [path.join(ext, "actualizar.sh")], { input: entrada, encoding: "utf8",
      env: { ...process.env, HOME: path.join(T, "home"), CENTRO_ZIP: path.join(T, "nuevo.zip"), ...extra } });
    // sin terminal y sin --si: no borra nada
    let r = correr("");
    assert.equal(r.status, 1); assert.match(r.stdout, /robot-viejo\.js/); assert.match(r.stdout, /No los borro sin preguntarte/);
    assert.ok(fs.existsSync(path.join(ext, "robot-viejo.js")));
    // dice que no
    r = correr("n\n", { CENTRO_PREGUNTAR: "1" });
    assert.equal(r.status, 1); assert.ok(fs.existsSync(path.join(ext, "robot-viejo.js")));
    // dice que sí
    r = correr("s\n", { CENTRO_PREGUNTAR: "1" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /respaldo-2026|node_modules/, "nunca ofrece borrar respaldos ni node_modules");
    assert.ok(!fs.existsSync(path.join(ext, "robot-viejo.js")));
    assert.equal(fs.readFileSync(path.join(ext, "respaldo-2026-11-28.json"), "utf8"), "{\"mio\":1}");
    assert.ok(fs.existsSync(path.join(ext, "node_modules", "x", "i.js")));
    assert.equal(fs.readFileSync(path.join(ext, "README.md"), "utf8"), fs.readFileSync(path.join(RAIZ, "README.md"), "utf8"));
    assert.ok(fs.statSync(path.join(ext, "actualizar.sh")).mode & 0o100, "sigue ejecutable");
    assert.match(r.stdout, /Extensión actualizada/); assert.match(r.stdout, /El puente no está instalado/);
    // una carpeta que no es la extensión: no hace nada
    r = spawnSync("bash", [path.join(ext, "actualizar.sh")], { encoding: "utf8", env: { ...process.env, CENTRO_DESTINO: T, CENTRO_ZIP: path.join(T, "nuevo.zip") } });
    assert.equal(r.status, 1); assert.match(r.stdout, /No encuentro la extensión/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});
