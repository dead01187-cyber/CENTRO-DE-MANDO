// Fase A del puente: pantalla "Puente" (servicios que corren solos en la Mac)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../sp-core.js");
const REG = require("../registro.js");

const srv = (nombre, estado, extra = {}) => ({ nombre, titulo: nombre === "despierto" ? "Mac despierta (8 am – 9 pm)" : "Salud de las llaves de Lofty", estado, texto: `${nombre} ${estado}`, activo: estado !== "apagado", ...extra });

test("resumen: el robot Puente toma el peor estado de sus servicios prendidos", () => {
  assert.equal(S.resumen([srv("despierto", "trabajando"), srv("lofty_salud", "feliz")]).estado, "trabajando");
  const e = S.resumen([srv("despierto", "trabajando"), srv("lofty_salud", "error", { texto: "La llave no funciona (401)." })]);
  assert.equal(e.estado, "error");
  assert.equal(e.texto, "Salud de las llaves de Lofty: La llave no funciona (401).");
  assert.equal(e.cuenta, "1 con problema de 2");
  assert.equal(S.resumen([srv("despierto", "idle"), srv("lofty_salud", "feliz")]).estado, "feliz");
  assert.equal(S.resumen([srv("despierto", "apagado"), srv("lofty_salud", "apagado")]).estado, "pausa");
  assert.equal(S.resumen([srv("despierto", "apagado"), srv("lofty_salud", "feliz")]).cuenta, "1 servicio(s) bien", "los apagados no cuentan");
});

test("cambios: a la bitácora solo cuando un servicio falla o se recupera", () => {
  assert.deepEqual(S.cambios({}, [srv("lofty_salud", "error")]), [], "la primera vez no se avisa nada");
  const a = S.mapa([srv("lofty_salud", "feliz"), srv("despierto", "idle")]);
  const c = S.cambios(a, [srv("lofty_salud", "error", { texto: "No pude revisar Lofty" }), srv("despierto", "trabajando")]);
  assert.deepEqual(c.map((x) => [x.nombre, x.nivel]), [["lofty_salud", "error"]]);
  assert.match(c[0].texto, /^Puente · Salud de las llaves de Lofty: No pude revisar Lofty/);
  const r = S.cambios(S.mapa([srv("lofty_salud", "error")]), [srv("lofty_salud", "feliz", { texto: "Llaves de Lofty OK (1)." })]);
  assert.equal(r[0].nivel, "info"); assert.match(r[0].texto, /se recuperó/);
});

test("llaves por mandar: compara la extensión con el puente sin ver la llave del puente", () => {
  const ext = { txKey: "lofty.Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z", loftyKey: "lofty.0000000000000000000000Q1w2" };
  const r = Object.fromEntries(S.llavesPorMandar(ext, { txKey: { puesta: true, pista: "…Xy4z" }, loftyKey: { puesta: true, pista: "…zzzz" } }).map((x) => [x.nombre, x]));
  assert.equal(r.txKey.igual, true, "misma llave: no hace falta mandarla");
  assert.equal(r.loftyKey.igual, false, "la del puente es otra: se puede actualizar");
  assert.equal(r.t2Key.enExtension, false);
  assert.equal(r.t2Key.enPuente, false);
});

test("Puente está en el registro (OPS, solo lee) y en el Mando; Capi lo puede revisar", () => {
  const r = REG.ROBOTS.sp;
  assert.equal(r.nombre, "Puente"); assert.equal(r.supervisor, "OPS"); assert.equal(r.pagina, "sp.html");
  assert.deepEqual(r.permisos, ["lee_crm"]);
  assert.equal(REG.accion("sp", "revisar").boton, "run");
  const raiz = path.join(__dirname, "..");
  const mando = fs.readFileSync(path.join(raiz, "mando.html"), "utf8"), mjs = fs.readFileSync(path.join(raiz, "mando.js"), "utf8");
  assert.match(mando, /data-m="sp" id="e-sp"/); assert.match(mando, /<iframe id="f-sp" src="sp\.html">/); assert.match(mando, /<button data-m="sp">Puente<\/button>/);
  assert.match(mjs, /const MODS = \[[^\]]*"sp"/);
  assert.match(fs.readFileSync(path.join(raiz, "sv.js"), "utf8"), /sp: \{ run: "Puente:/);
  const html = fs.readFileSync(path.join(raiz, "sp.html"), "utf8");
  assert.match(html, /data-mod="sp"/); assert.match(html, /id="run"/); assert.match(html, /sp-core\.js/);
});
