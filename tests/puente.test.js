// Corre las pruebas del puente de Navi (Python, solo librería estándar) dentro de `npm test`.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const py = ["python3", "python"].find((p) => spawnSync(p, ["--version"]).status === 0);
test("puente de Navi: pruebas de Python (params, clave, CORS, recetas, fila)", { skip: !py && "no hay python3" }, () => {
  const r = spawnSync(py, ["-m", "unittest", "discover", "-s", path.join("tests", "puente")], { cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 180e3 });
  assert.equal(r.status, 0, (r.stdout || "") + (r.stderr || "").slice(-3000));
  assert.match(r.stderr, /Ran \d+ tests/);
});
