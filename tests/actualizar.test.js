// actualizar.sh: baja la versión, enseña lo que va a borrar y pide permiso, respeta respaldos y node_modules,
// y deja la extensión igual que la versión nueva. Se prueba con un zip local (git archive), sin internet.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execSync } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const hay = (p) => spawnSync("sh", ["-c", `command -v ${p}`]).status === 0;
const listo = hay("unzip") && hay("git") && hay("python3") && spawnSync("git", ["-C", RAIZ, "rev-parse", "HEAD"]).status === 0;

test("actualizar.sh: pide permiso para borrar, respeta respaldos y actualiza", { skip: !listo && "falta unzip o git" }, () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), "actualizar-"));
  try {
    const ext = path.join(T, "ext"); fs.mkdirSync(ext);
    execSync(`git -C "${RAIZ}" archive --format=tar HEAD | tar -x -C "${ext}"`);
    // la "versión nueva" se arma con los archivos de esta copia del repo (los que sigue git), conservando permisos
    execSync(`python3 -c "
import os, subprocess, sys, zipfile
raiz, dest = sys.argv[1], sys.argv[2]
archivos = subprocess.check_output(['git', '-C', raiz, 'ls-files', '-z']).decode().split(chr(0))
with zipfile.ZipFile(dest, 'w') as z:
    for f in filter(None, archivos):
        p = os.path.join(raiz, f)
        if not os.path.isfile(p):
            continue
        i = zipfile.ZipInfo('CENTRO-DE-MANDO-rama/' + f)
        i.external_attr = (os.stat(p).st_mode & 0o777 | 0o100000) << 16
        z.writestr(i, open(p, 'rb').read())
" "${RAIZ}" "${path.join(T, "nuevo.zip")}"`);
    fs.copyFileSync(path.join(RAIZ, "actualizar.sh"), path.join(ext, "actualizar.sh")); // el script de esta copia del repo (no el de HEAD)
    fs.writeFileSync(path.join(ext, "robot-viejo.js"), "viejo");
    fs.writeFileSync(path.join(ext, "respaldo-2026-11-28.json"), "{\"mio\":1}");
    fs.mkdirSync(path.join(ext, "node_modules", "x"), { recursive: true }); fs.writeFileSync(path.join(ext, "node_modules", "x", "i.js"), "y");
    fs.writeFileSync(path.join(ext, "README.md"), "lo cambié a mano");
    // una carpeta que el sistema llama TMP NUNCA se debe borrar (error que ya pasó una vez)
    const delSistema = path.join(T, "tmp-del-sistema"); fs.mkdirSync(delSistema); fs.writeFileSync(path.join(delSistema, "no-borrar.txt"), "x");
    const correr = (entrada, extra = {}) => spawnSync("bash", [path.join(ext, "actualizar.sh")], { input: entrada, encoding: "utf8",
      env: { ...process.env, TMP: delSistema, HOME: path.join(T, "home"), CENTRO_ZIP: path.join(T, "nuevo.zip"), ...extra } });
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
    r = spawnSync("bash", [path.join(ext, "actualizar.sh")], { encoding: "utf8", env: { ...process.env, TMP: delSistema, CENTRO_DESTINO: T, CENTRO_ZIP: path.join(T, "nuevo.zip") } });
    assert.equal(r.status, 1); assert.match(r.stdout, /No encuentro la extensión/);
    assert.ok(fs.existsSync(path.join(delSistema, "no-borrar.txt")), "la carpeta TMP del sistema sigue ahí");
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});
