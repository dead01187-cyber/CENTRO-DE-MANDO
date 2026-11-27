// Navi (Fase 7): lógica pura de navi-core.js + que esté bien conectado en el registro y el Mando
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const N = require("../navi-core.js");
const REG = require("../registro.js");

const RECETA = { nombre: "fotos_listing", titulo: "Fotos", params: { url: { tipo: "url", requerido: true, etiqueta: "URL", hosts: ["www.homes.com", "homes.com"] } } };
const AGENTE = { nombre: "listings_agente", params: { url: { tipo: "url", requerido: true, hosts: ["www.homes.com"] }, fotos: { tipo: "bool", defecto: false }, maximo: { tipo: "int", min: 1, max: 200 } } };

test("diagnóstico: puente apagado, clave mala, extensión no registrada y Brave sin el 9222", () => {
  assert.equal(N.diagnostico({ error: new TypeError("Failed to fetch") }).texto, "El puente está apagado. Corre puente/instalar.sh");
  assert.match(N.diagnostico({ status: 401 }).texto, /clave del puente no coincide/);
  assert.match(N.diagnostico({ status: 403 }).texto, /instalar\.sh/);
  const b = N.diagnostico({ salud: { ok: true, brave: false } });
  assert.equal(b.texto, "Abre Brave con brave-ia"); assert.equal(b.estado, "ayuda"); assert.equal(b.ok, false);
  const ok = N.diagnostico({ salud: { ok: true, brave: true, browser_use: true, navegador: "Brave/1.73" } });
  assert.equal(ok.ok, true); assert.match(ok.texto, /Brave\/1\.73/);
  assert.match(N.diagnostico({ salud: { ok: true, brave: true, browser_use: false } }).texto, /uv tool install browser-use/);
});

test("validar: URL de Homes.com obligatoria, https y del dominio correcto", () => {
  assert.deepEqual(N.validar(RECETA, { url: " https://www.homes.com/property/a-b/c1/ " }), { ok: true, params: { url: "https://www.homes.com/property/a-b/c1/" } });
  assert.match(N.validar(RECETA, {}).error, /Falta/);
  assert.match(N.validar(RECETA, { url: "http://www.homes.com/property/a/b/" }).error, /https/);
  assert.match(N.validar(RECETA, { url: "https://www.zillow.com/x" }).error, /homes\.com/);
  assert.match(N.validar(RECETA, { url: "no es url" }).error, /no es una dirección/);
  assert.match(N.validar(null, {}).error, /Escoge una receta/);
});

test("validar: sí/no y números con límites", () => {
  assert.deepEqual(N.validar(AGENTE, { url: "https://www.homes.com/real-estate-agents/a/b/", fotos: true, maximo: "5" }).params, { url: "https://www.homes.com/real-estate-agents/a/b/", fotos: true, maximo: 5 });
  assert.match(N.validar(AGENTE, { url: "https://www.homes.com/x/", maximo: 0 }).error, /de 1 a 200/);
  assert.match(N.validar(AGENTE, { url: "https://www.homes.com/x/", maximo: "2.5" }).error, /de 1 a 200/);
  assert.equal(N.validar(AGENTE, { url: "https://www.homes.com/x/", fotos: false }).params.fotos, false);
});

test("estados de la tarea → estados del robot (Trabajando, ¡Terminé!, Error, Necesito ayuda)", () => {
  assert.equal(N.estadoTarea({ estado: "en_cola", en_fila: 2 }).texto, "En fila (lugar 2)…");
  assert.deepEqual(N.estadoTarea({ estado: "trabajando", receta: "fotos_listing", log: ["10:00:01 Abriendo https://x"] }), { estado: "trabajando", texto: "Abriendo https://x" });
  const f = N.estadoTarea({ estado: "terminado", receta: "fotos_listing", resultado: { fotos: 24, direccion: "12352 Elmwood St, Garden Grove" } });
  assert.equal(f.estado, "feliz"); assert.equal(f.texto, "Listo: bajé 24 foto(s) de 12352 Elmwood St, Garden Grove.");
  assert.equal(N.estadoTarea({ estado: "terminado", receta: "listings_agente", resultado: { total: 9, con_fotos: 3 } }).texto, "Listo: 9 listing(s) activos en el CSV, 3 con fotos.");
  const a = N.estadoTarea({ estado: "ayuda", ayuda: "Hay un CAPTCHA en la página" });
  assert.equal(a.estado, "ayuda"); assert.match(a.texto, /CAPTCHA.*Brave/);
  assert.equal(N.estadoTarea({ estado: "error", error: "Brave no responde" }).estado, "error");
  assert.equal(N.estadoTarea({ estado: "cancelado" }).estado, "pausa");
});

test("log: solo las líneas nuevas, y a la bitácora solo lo importante", () => {
  assert.deepEqual(N.nuevas(2, ["a", "b", "c", "d"]), ["c", "d"]);
  assert.deepEqual(N.nuevas(9, ["a"]), []);
  assert.equal(N.paraBitacora("10:00:01 Abriendo https://www.homes.com/property/x/y/"), "Abriendo https://www.homes.com/property/x/y/");
  assert.equal(N.paraBitacora("10:00:02 Bajé 24 de 24 fotos."), "Bajé 24 de 24 fotos.");
  assert.equal(N.paraBitacora("10:00:03   No pude bajar 03.jpg: HTTP 404"), "", "un error suelto de una foto no pone a Navi en Error");
  assert.equal(N.paraBitacora("10:00:04 Foto 3 de 24"), "");
});

test("Navi está en el registro (OPS) con su acción del bus, y en el Mando", () => {
  const r = REG.ROBOTS.nv;
  assert.equal(r.nombre, "Navi"); assert.equal(r.supervisor, "OPS"); assert.equal(r.pagina, "navi.html");
  assert.deepEqual(r.permisos, ["lee_web"]);
  const acc = REG.accion("nv", "receta");
  assert.ok(acc && acc.aprobacion === false);
  const raiz = path.join(__dirname, "..");
  const mando = fs.readFileSync(path.join(raiz, "mando.html"), "utf8"), mjs = fs.readFileSync(path.join(raiz, "mando.js"), "utf8"), rjs = fs.readFileSync(path.join(raiz, "robot.js"), "utf8");
  assert.match(mando, /class="estacion" data-m="nv" id="e-nv"/);
  assert.match(mando, /<iframe id="f-nv" src="navi\.html"><\/iframe>/);
  assert.match(mando, /<button data-m="nv">Navi<\/button>/);
  assert.match(mjs, /const MODS = \[[^\]]*"nv"/);
  assert.match(mjs, /const COLOR = \{[^}]*\bnv: "#/);
  assert.match(rjs, /ROBOTS\.nv = /); assert.match(rjs, /"nv":"compass"/);
  const html = fs.readFileSync(path.join(raiz, "navi.html"), "utf8");
  assert.match(html, /data-mod="nv"/); assert.match(html, /tema\.css/); assert.match(html, /trabajador\.js/);
});

test("ninguna clave ni token en el código de Navi", () => {
  const raiz = path.join(__dirname, "..");
  const archivos = ["navi.js", "navi-core.js", "navi.html", "puente/puente.py", "puente/instalar.sh", "puente/desinstalar.sh", "puente/com.christopher.navi.plist",
    "puente/recetas/_comun.py", "puente/recetas/fotos_listing.py", "puente/recetas/listings_agente.py"];
  for (const f of archivos) {
    const s = fs.readFileSync(path.join(raiz, f), "utf8");
    // una clave de token_urlsafe(32) son 43 caracteres [A-Za-z0-9_-] seguidos; no debe haber ninguna escrita en el código
    const sospechosas = (s.match(/(?<![\w/.#-])[A-Za-z0-9_-]{40,}(?![\w/.-])/g) || []).filter((x) => /\d/.test(x) && /[A-Z]/.test(x) && /[a-z]/.test(x));
    assert.deepEqual(sospechosas, [], `${f} parece traer una clave escrita`);
  }
  const ign = fs.readFileSync(path.join(raiz, ".gitignore"), "utf8");
  assert.match(ign, /^\.navi\/$/m); assert.match(ign, /^\*\.token$/m);
});
