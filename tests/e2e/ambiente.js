// Ambiente de prueba (Fase 6): Chromium aislado + la extensión + Lofty falso + reloj fijo.
// Bloquea TODO lo que no sea la propia extensión o el Lofty falso: nada sale a internet.
const path = require("path"), fs = require("fs"), os = require("os");
const { chromium } = require("playwright");
const loftyFalso = require("./lofty-falso");
const EXT = path.resolve(__dirname, "../..");

// horaCA: "2026-01-15T10:00" = 10:00 hora de California
const aUTC = (horaCA) => { const d = new Date(horaCA + ":00Z"); const off = new Date(d.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })) - new Date(d.toLocaleString("en-US", { timeZone: "UTC" })); return new Date(d.getTime() - off); };

async function abrir({ leads = [], fallar = {}, storage = {}, horaCA = "2026-01-15T10:00", textos = {}, pool = [] } = {}) {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "geo-prueba-"));
  const ctx = await chromium.launchPersistentContext(perfil, { headless: true, channel: "chromium", args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  const lofty = loftyFalso({ leads, fallar, textos, pool });
  await ctx.route("**/*", (r) => (r.request().url().startsWith("chrome-extension://") ? r.continue() : r.abort()));
  await ctx.route("https://api.lofty.com/**", lofty.atender);
  await ctx.clock.setFixedTime(aUTC(horaCA));
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 20000 });
  const id = sw.url().split("/")[2];
  await sw.evaluate((s) => chrome.storage.local.set(s), storage);
  const errores = [];
  const pagina = async (p) => { const pg = await ctx.newPage(); pg.on("pageerror", (e) => errores.push(`${p}: ${e.message}`)); await pg.goto(`chrome-extension://${id}/${p}`); return pg; };
  const leer = (k) => sw.evaluate((k) => chrome.storage.local.get(k), k);
  const cerrar = async () => { await ctx.close(); fs.rmSync(perfil, { recursive: true, force: true }); };
  return { ctx, sw, lofty, pagina, leer, errores, cerrar };
}
module.exports = { abrir, aUTC };
