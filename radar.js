// =====================================================================
// Radar (brazo Zonas calientes): junta señales de venta por ZIP de todo
// Orange County y LA County, con RITMO HUMANO para que ninguna página bloquee:
//  · Census (ACS): dueños que viven ahí, vacancia, año en que se mudaron (llave gratis)
//  · Redfin / Zillow / Realtor.com: bajas de precio, inventario, días en el mercado
//  · Propwire: cuántas propiedades hay por ZIP en Preforeclosures, Pre-Probates,
//    Absentee, High Equity y Vacant (solo lee el conteo; no gasta créditos)
// Ritmo humano: pausas al azar de 12–35 s entre páginas del mismo sitio, descansos
// de 3–7 min cada 15–25 páginas, tope por día en cada sitio, y si un sitio muestra
// captcha/bloqueo, Radar no lo vuelve a tocar en 8 horas.
// Cada vuelta actualiza primero los ZIP más viejos; en unos días cubre todo.
// Termi usa estos datos para calificar las zonas.
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const hoy = () => new Date().toLocaleDateString("en-CA");
const azar = (a, b) => a + Math.random() * (b - a);
const H = 36e5, D = 864e5;
const CONDADOS = { "06059": "Orange", "06037": "Los Angeles" };
const FUENTES = ["census", "redfin", "zillow", "realtor", "propwire"];
const NOMBRE_F = { census: "Census", redfin: "Redfin", zillow: "Zillow", realtor: "Realtor.com", propwire: "Propwire" };
// cada cuánto se refresca cada dato de un ZIP
const VIGENCIA = { census: 60 * D, redfin: 6 * D, zillow: 6 * D, realtor: 6 * D, pw_rapido: 6 * D, pw_lento: 30 * D };
// señales de Propwire: etiqueta del menú "Lead Types" → campo; las rápidas cambian cada semana
const PW_SENALES = [
  { label: "Preforeclosures", campo: "preforeclosure", rapido: true },
  { label: "Pre-Probates", campo: "preprobate", rapido: true },
  { label: "Absentee Owners", campo: "absentee" },
  { label: "High Equity", campo: "highEquity" },
  { label: "Vacant Homes", campo: "vacant" },
];
const DEF = { censusKey: "", auto: true, hora: 9, fuentes: { census: true, redfin: true, zillow: true, realtor: true, propwire: true },
  topes: { redfin: 70, zillow: 70, realtor: 50, propwire: 90 } };
let cfg = JSON.parse(JSON.stringify(DEF)), corriendo = false, parar = false;

// ---------- Ajustes ----------
async function cargarCfg() {
  const { radarCfg = {} } = await chrome.storage.local.get("radarCfg");
  cfg = { ...DEF, ...radarCfg, fuentes: { ...DEF.fuentes, ...(radarCfg.fuentes || {}) }, topes: { ...DEF.topes, ...(radarCfg.topes || {}) } };
  $("censusKey").value = cfg.censusKey || ""; $("auto").checked = !!cfg.auto;
  if (!$("hora").options.length) for (let i = 0; i < 24; i++) $("hora").add(new Option(`${String(i).padStart(2, "0")}:00`, String(i)));
  $("hora").value = String(cfg.hora);
  for (const f of FUENTES) $("f_" + f).checked = cfg.fuentes[f] !== false;
  for (const f of Object.keys(DEF.topes)) $("t_" + f).value = cfg.topes[f];
}
function guardarCfg() {
  const k = $("censusKey").value.replace(/[•\s]/g, "");
  cfg.censusKey = k;
  cfg.auto = $("auto").checked; cfg.hora = parseInt($("hora").value, 10) || 0;
  for (const f of FUENTES) cfg.fuentes[f] = $("f_" + f).checked;
  for (const f of Object.keys(DEF.topes)) cfg.topes[f] = Math.max(0, Math.min(400, parseInt($("t_" + f).value, 10) || 0));
  chrome.storage.local.set({ radarCfg: cfg });
}
document.querySelectorAll("#ajustes input, #ajustes select").forEach((e) => (e.onchange = guardarCfg));

// ---------- Uso por día y pausas por bloqueo ----------
async function uso() { const { radarUso = {} } = await chrome.storage.local.get("radarUso"); return radarUso.fecha === hoy() ? radarUso : { fecha: hoy(), n: {} }; }
async function sumar(f) { const u = await uso(); u.n[f] = (u.n[f] || 0) + 1; await chrome.storage.local.set({ radarUso: u }); return u.n[f]; }
async function quedan(f) { const u = await uso(); return Math.max(0, (cfg.topes[f] ?? 999) - (u.n[f] || 0)); }
async function pausado(f) { const { radarPausa = {} } = await chrome.storage.local.get("radarPausa"); return radarPausa[f] > Date.now() ? radarPausa[f] : 0; }
async function pausar(f, horas, porque) {
  const { radarPausa = {} } = await chrome.storage.local.get("radarPausa");
  radarPausa[f] = Date.now() + horas * H; await chrome.storage.local.set({ radarPausa });
  decir(`Radar: ${NOMBRE_F[f]} ${porque}. No lo vuelvo a tocar en ${horas} h (ritmo humano).`, "error");
}
async function esperar(ms, texto) { const fin = Date.now() + ms; while (!parar && Date.now() < fin) { ver(`${texto} · sigo en ${Math.ceil((fin - Date.now()) / 1000)} s`); await sleep(Math.min(1000, fin - Date.now())); } }

// ---------- Datos ----------
async function datos() { const { radarData = {} } = await chrome.storage.local.get("radarData"); return radarData; }
let guardando = Promise.resolve();
function poner(zip, fuente, valores) { // guarda sin pisar lo que otra fuente guardó en paralelo
  guardando = guardando.then(async () => {
    const d = await datos(); const z = d[zip] || (d[zip] = { zip });
    z[fuente] = { ...(z[fuente] || {}), ...valores, t: Date.now() };
    await chrome.storage.local.set({ radarData: d });
  });
  aTermiPronto();
  return guardando;
}
// Le pasa a Termi lo que lleva (cada 20 s mientras escanea, y al final)
let tTermi = null;
function aTermiPronto() { if (!tTermi) tTermi = setTimeout(() => { tTermi = null; aTermi(false); }, 20000); }
async function aTermi(avisar) {
  try {
    const { res } = await TermiCalc.calificar();
    if (avisar) decir(`Radar → Termi: le pasé ${res.n} ZIP calificados · ${res.calientes} calientes${res.top ? ` · top ${res.top.zip}${res.top.ciudad ? " " + res.top.ciudad : ""} (${res.top.score})` : ""}.${res.faltan && res.faltan.length ? ` Sin datos aún de: ${res.faltan.join(", ")}.` : ""}`);
    return res;
  } catch (e) { decir("Radar: no pude pasarle los datos a Termi: " + e.message, "error"); }
}

// ---------- Lista de ZIP (Census, relación ZCTA–condado) ----------
async function zips() {
  const { radarZips } = await chrome.storage.local.get("radarZips");
  if (radarZips && radarZips.lista && Date.now() - radarZips.t < 90 * D) return radarZips.lista;
  ver("Bajando la lista oficial de ZIP de Orange County y LA County (Census)…");
  const t = await fetch("https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt").then((r) => r.text());
  const L = t.split(/\r?\n/), h = L[0].split("|");
  const iz = h.indexOf("GEOID_ZCTA5_20"), ic = h.indexOf("GEOID_COUNTY_20"), ia = h.indexOf("AREALAND_PART");
  const mejor = {};
  for (const l of L.slice(1)) {
    const c = l.split("|"); const z = c[iz], co = c[ic], a = Number(c[ia]) || 0;
    if (!z || !/^\d{5}$/.test(z)) continue;
    if (!mejor[z] || a > mejor[z].a) mejor[z] = { co, a };
  }
  const lista = Object.entries(mejor).filter(([, v]) => CONDADOS[v.co]).map(([zip, v]) => ({ zip, condado: CONDADOS[v.co] }));
  await chrome.storage.local.set({ radarZips: { t: Date.now(), lista } });
  return lista;
}

// ---------- Census (una consulta por cada 50 ZIP; no es scraping) ----------
async function census(lista) {
  if (!cfg.censusKey) { ver("Census: falta la llave (gratis en api.census.gov/data/key_signup.html)."); return; }
  const d = await datos();
  const toca = lista.filter((z) => !d[z.zip] || !d[z.zip].census || Date.now() - d[z.zip].census.t > VIGENCIA.census).map((z) => z.zip);
  for (let i = 0; i < toca.length && !parar; i += 50) {
    const grupo = toca.slice(i, i + 50);
    ver(`Census: datos de vivienda ${Math.min(i + 50, toca.length)} de ${toca.length} ZIP…`);
    const url = `https://api.census.gov/data/2023/acs/acs5?get=B25003_001E,B25003_002E,B25002_001E,B25002_003E,B25039_002E,B25077_001E&for=zip%20code%20tabulation%20area:${grupo.join(",")}&key=${encodeURIComponent(cfg.censusKey)}`;
    const r = await fetch(url); const tx = await r.text();
    if (!r.ok || !tx.trim().startsWith("[")) { decir("Radar: el Census no aceptó la consulta (¿llave correcta?).", "error"); return; }
    const filas = JSON.parse(tx), cab = filas[0];
    for (const f of filas.slice(1)) {
      const o = Object.fromEntries(cab.map((k, j) => [k, f[j]]));
      const ocup = +o.B25003_001E || 0, unidades = +o.B25002_001E || 0;
      await poner(o["zip code tabulation area"], "census", { duenos: ocup ? +o.B25003_002E / ocup : null, vacancia: unidades ? +o.B25002_003E / unidades : null,
        mudanza: +o.B25039_002E > 1900 ? +o.B25039_002E : null, valor: +o.B25077_001E > 0 ? +o.B25077_001E : null });
    }
    await sleep(azar(1500, 3000));
  }
}

// ---------- Mercado (Redfin, Zillow, Realtor.com) ----------
const textoDe = (h) => new DOMParser().parseFromString(h, "text/html").body.textContent.replace(/\s+/g, " ");
const num = (s) => (s == null ? null : Number(String(s).replace(/[$,%]/g, "")));
const BLOQUEO = /captcha|press (&|and) hold|are you a (human|robot)|access (to this page )?(has been )?denied|unusual (traffic|activity)|px-captcha|kpsdk/i;
async function traer(url) {
  const r = await fetch(url, { credentials: "include" });
  const h = await r.text();
  if (r.status === 403 || r.status === 429 || (BLOQUEO.test(h.slice(0, 20000)) && h.length < 60000)) throw Object.assign(new Error("bloqueo " + r.status), { bloqueo: true });
  if (!r.ok) throw new Error("respondió " + r.status);
  return h;
}
const MERCADO = {
  async redfin(z) {
    const t = textoDe(await traer(`https://www.redfin.com/zipcode/${z.zip}/housing-market`));
    const g = (re) => { const m = t.match(re); return m ? m[1] : null; };
    return { precio: num(g(/Median Sale Price\s*(\$[\d,]+)/)), precioYoY: num(g(/Median Sale Price\s*\$[\d,]+\s*(-?[\d.]+)%/)), vendidos: num(g(/# of Homes Sold\s*(\d+)/)),
      dom: num(g(/Median Days on Market\s*(\d+)/)), bajas: num(g(/Homes with Price Drops\s*([\d.]+)%/)), stl: num(g(/Sale-to-List Price\s*([\d.]+)%/)) };
  },
  async zillow(z, d) {
    let zid = d.zillow && d.zillow.zid, ciudad = (d.info || {}).ciudad;
    if (!zid) {
      const s = await fetch("https://www.zillowstatic.com/autocomplete/v3/suggestions?q=" + z.zip).then((r) => r.json());
      const hit = (s.results || []).find((x) => x.metaData && x.metaData.regionType === "zipcode");
      if (!hit) return { sinDatos: true };
      zid = hit.metaData.regionId; ciudad = hit.metaData.city;
      if (ciudad) await poner(z.zip, "info", { ciudad });
    }
    const h = await traer(`https://www.zillow.com/home-values/${zid}/${z.zip}/`);
    const g = (k) => { const m = h.match(new RegExp('\\\\?"' + k + '\\\\?":\\s*(-?[\\d.]+)')); return m ? Number(m[1]) : null; };
    const yoy = g("zhviYoY");
    return { zid, valorYoY: yoy == null ? null : Math.round(yoy * 1000) / 10, inventario: g("forSaleInventory"), nuevos: g("newListings"), diasPending: g("medianDaysToPending"), precioLista: g("medianListPrice") };
  },
  async realtor(z) {
    const t = textoDe(await traer(`https://www.realtor.com/local/market/california/zipcode-${z.zip}`));
    const g = (re) => { const m = t.match(re); return m ? m[1] : null; };
    return { listingsYoY: num(g(/active listing count (?:increased|decreased|rose|fell|changed) by (-?[\d.]+)%/i)), precioYoY: num(g(/median listing price (?:increased|decreased|rose|fell|declined) by (-?[\d.]+)%/i)),
      dom: num(g(/median days on market of (\d+)/i)), activos: num(g(/there are ([\d,]+) homes currently for sale/i)), calor: g(/this is an? (\w+) market/i) };
  },
};
async function mercado(lista) {
  const d = await datos();
  const activas = ["redfin", "zillow", "realtor"].filter((f) => cfg.fuentes[f]);
  const cola = {}; // por fuente: ZIP más viejos primero
  lista = [...lista].sort((a, b) => (a.condado === "Orange" ? 0 : 1) - (b.condado === "Orange" ? 0 : 1)); // primero Orange County
  for (const f of activas) cola[f] = lista.filter((z) => !d[z.zip] || !d[z.zip][f] || Date.now() - d[z.zip][f].t > VIGENCIA[f]).sort((a, b) => ((d[a.zip] || {})[f] || { t: 0 }).t - ((d[b.zip] || {})[f] || { t: 0 }).t);
  const seguidas = {};
  // va turnando sitios (Redfin → Zillow → Realtor → …) para que cada sitio vea una página cada ~30–90 s
  while (!parar) {
    let hizo = false;
    for (const f of activas) {
      if (parar) break;
      if (!cola[f].length || (await pausado(f)) || !(await quedan(f))) continue;
      const z = cola[f].shift(); hizo = true;
      try {
        ver(`${NOMBRE_F[f]}: mercado del ${z.zip} (${z.condado})…`);
        const v = await MERCADO[f](z, (await datos())[z.zip] || {});
        await poner(z.zip, f, v); await sumar(f);
        seguidas[f] = (seguidas[f] || 0) + 1;
      } catch (e) {
        if (e.bloqueo) await pausar(f, 8, "mostró verificación o bloqueo");
        else { await sumar(f); window.svLog && svLog(`Radar: ${NOMBRE_F[f]} ${z.zip}: ${e.message}`); }
      }
      await esperar(azar(12000, 35000) / Math.max(1, activas.length), "Ritmo humano: pausa entre páginas");
      if (seguidas[f] && seguidas[f] % Math.round(azar(15, 25)) === 0) await esperar(azar(3, 7) * 60000, `Ritmo humano: descanso de ${NOMBRE_F[f]}`);
    }
    if (!hizo) break;
  }
}

// ---------- Propwire (abre la búsqueda con el filtro y lee "of N Results") ----------
// Corren DENTRO de Propwire
async function pwConteo() {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = () => (document.body ? document.body.innerText : "");
  if (/acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)|temporarily (blocked|restricted)|unusual (traffic|activity)/i.test(txt())) return { bloqueo: true };
  if (/verif|captcha|challenge/i.test(document.title) || document.querySelector('iframe[src*="captcha"], iframe[src*="challenge"]')) return { bloqueo: true, ayuda: true };
  let ultimo = null, igual = 0;
  for (let i = 0; i < 50; i++) {
    await esp(400);
    const m = txt().match(/of\s+([\d,]+)\s+Results/i);
    const v = m ? Number(m[1].replace(/,/g, "")) : null;
    if (v != null && v === ultimo) { if (++igual >= 4) return { n: v }; } else { ultimo = v; igual = 0; }
  }
  return ultimo != null ? { n: ultimo } : { error: "no vi el número de resultados" };
}
async function pwLlave(label) { // aprende el nombre interno de un filtro dándole clic en el menú "Lead Types"
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const propio = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "); // solo su texto, sin íconos ni etiquetas
  const leer = () => { try { return (JSON.parse(new URLSearchParams(location.search).get("filters") || "{}").lead_type) || []; } catch (e) { return []; } };
  // 1) abrir el menú "Lead Types" (si ya está abierto, no pasa nada)
  const buscarOpcion = () => {
    const quiero = norm(label);
    let c = [...document.querySelectorAll("body *")].filter((e) => norm(propio(e)) === quiero);
    if (!c.length) c = [...document.querySelectorAll("body *")].filter((e) => e.children.length <= 4 && norm(e.textContent).replace(/\s*(premium|gold|pro|new)\s*$/i, "") === quiero);
    return c.sort((a, b) => a.textContent.length - b.textContent.length)[0] || null;
  };
  let op = buscarOpcion();
  if (!op || !vis(op)) {
    let b = null;
    for (let i = 0; i < 20 && !b; i++) {
      b = [...document.querySelectorAll("button, div, span")].filter((e) => vis(e) && norm(propio(e) || e.textContent) === "lead types").sort((x, y) => x.textContent.length - y.textContent.length)[0];
      if (!b) await esp(400);
    }
    if (!b) return { error: "no encontré el menú Lead Types" };
    (b.closest("button, [role=button], [aria-haspopup]") || b).click();
    for (let i = 0; i < 15 && !(op = buscarOpcion()); i++) await esp(300);
  }
  if (!op) return { error: "no encontré la opción " + label };
  // 2) darle clic al renglón de la opción (o a su casilla), y si no cambia el filtro, probar con el texto
  const antes = leer();
  const renglon = op.closest("label, li, [role=option], [role=menuitemcheckbox], [role=checkbox], button") || op.parentElement || op;
  const casilla = renglon.querySelector("input[type=checkbox]");
  try { renglon.scrollIntoView({ block: "center" }); } catch (e) {}
  for (const blanco of [casilla, renglon, op].filter(Boolean)) {
    blanco.click();
    for (let i = 0; i < 12; i++) { await esp(300); const ahora = leer(); if (ahora.length !== antes.length || ahora.some((k) => !antes.includes(k))) { const nueva = ahora.filter((k) => !antes.includes(k)); return { llaves: nueva.length ? nueva : ahora }; } }
  }
  return { error: "le di clic a " + label + " pero Propwire no cambió el filtro" };
}
const corre = async (tab, func, args = []) => { const [r] = await chrome.scripting.executeScript({ target: { tabId: tab }, func, args }); return r && r.result; };
async function irA(tab, url) {
  await chrome.tabs.update(tab, { url }); await sleep(900);
  for (let i = 0; i < 60; i++) { const x = await chrome.tabs.get(tab).catch(() => null); if (!x || x.status === "complete") break; await sleep(400); }
  await sleep(azar(1500, 3000));
}
const urlPW = (zip, llave) => "https://propwire.com/search?filters=" + encodeURIComponent(JSON.stringify({ locations: [{ searchType: "Z", zip, state: "CA", title: `${zip}, CA` }], ...(llave ? { lead_type: [llave] } : {}) }));
async function pestanaPW() {
  const { radarTab } = await chrome.storage.local.get("radarTab");
  if (radarTab) { const t = await chrome.tabs.get(radarTab).catch(() => null); if (t && /propwire\.com/.test(t.url || "")) return t.id; }
  const t = await abrirPestana("https://propwire.com/search", "zonas"); await chrome.storage.local.set({ radarTab: t.id }); await sleep(2500); return t.id;
}
async function llavesPW(tab) {
  const { radarPwKeys = {} } = await chrome.storage.local.get("radarPwKeys");
  for (const s of PW_SENALES) {
    if (radarPwKeys[s.label] || parar) continue;
    ver(`Propwire: aprendiendo el filtro “${s.label}”…`);
    await irA(tab, urlPW("92620"));
    const r = await corre(tab, pwLlave, [s.label]).catch((e) => ({ error: e.message }));
    if (r && r.llaves && r.llaves.length) { radarPwKeys[s.label] = r.llaves[r.llaves.length - 1]; window.svLog && svLog(`Radar: aprendí el filtro “${s.label}” de Propwire (${radarPwKeys[s.label]}).`); }
    else window.svLog && svLog(`Radar: no pude aprender el filtro ${s.label} de Propwire (${(r && r.error) || "?"}).`);
    await chrome.storage.local.set({ radarPwKeys });
    await esperar(azar(8000, 15000), "Ritmo humano");
  }
  return radarPwKeys;
}
async function propwire(lista) {
  if (await pausado("propwire")) return;
  const d = await datos();
  // trabajos: [zip, campo, llave] — primero total, luego señales rápidas (cada semana) y lentas (cada mes); los más viejos primero
  const trabajos = [];
  const viejo = (z, campo, vig) => { const p = (d[z.zip] || {}).propwire || {}; const t = (p.tc || {})[campo] || 0; return Date.now() - t > vig ? t : null; };
  for (const z of lista) {
    const tt = viejo(z, "total", VIGENCIA.pw_lento); if (tt != null) trabajos.push({ z, campo: "total", label: null, t: tt, pri: 1 });
    for (const s of PW_SENALES) { const t = viejo(z, s.campo, s.rapido ? VIGENCIA.pw_rapido : VIGENCIA.pw_lento); if (t != null) trabajos.push({ z, campo: s.campo, label: s.label, t, pri: s.rapido ? 0 : 2 }); }
  }
  if (!trabajos.length || !(await quedan("propwire"))) return;
  const oc = (z) => (z.condado === "Orange" ? 0 : 1); // primero Orange County, luego LA
  trabajos.sort((a, b) => a.pri - b.pri || a.t - b.t || oc(a.z) - oc(b.z));
  const tab = await pestanaPW();
  const llaves = await llavesPW(tab);
  let hechas = 0;
  for (const j of trabajos) {
    if (parar || !(await quedan("propwire")) || (await pausado("propwire"))) break;
    const llave = j.label ? llaves[j.label] : null;
    if (j.label && !llave) continue;
    if (typeof turnoPropwire === "function" && !(await turnoPropwire({ aviso: (ms) => ver(`Propwire: esperando turno (otro robot la usa)… ${Math.ceil(ms / 1000)} s`), parar: () => parar }))) break;
    ver(`Propwire: ${j.label || "total de propiedades"} en ${j.z.zip}…`);
    await irA(tab, urlPW(j.z.zip, llave));
    const r = await corre(tab, pwConteo).catch((e) => ({ error: e.message }));
    await sumar("propwire"); hechas++;
    if (r && r.bloqueo) { await pausar("propwire", 8, r.ayuda ? "pidió verificación (captcha)" : "bloqueó el acceso"); break; }
    if (r && r.n != null) {
      const p = ((await datos())[j.z.zip] || {}).propwire || {};
      const val = { [j.campo]: r.n, tc: { ...(p.tc || {}), [j.campo]: Date.now() } };
      if (j.campo === "preforeclosure" || j.campo === "preprobate") val["prev_" + j.campo] = p[j.campo] ?? null; // para avisar si sube
      await poner(j.z.zip, "propwire", val);
      if ((j.campo === "preforeclosure" || j.campo === "preprobate") && p[j.campo] != null && r.n - p[j.campo] >= 3)
        decir(`🔥 Radar: ${j.z.zip} subió de ${p[j.campo]} a ${r.n} en ${j.label} desde la última vez.`);
    }
    await esperar(azar(15000, 40000), "Ritmo humano: pausa en Propwire");
    if (hechas % Math.round(azar(15, 25)) === 0) await esperar(azar(4, 8) * 60000, "Ritmo humano: descanso de Propwire");
  }
}

// ---------- Vuelta completa ----------
async function escanear(aMano) {
  if (corriendo) return;
  guardarCfg();
  await navigator.locks.request("radar-escanear", { ifAvailable: true }, async (lock) => {
    if (!lock) { ver("Ya hay un Radar escaneando en otra pestaña."); return; }
    corriendo = true; parar = false; botones();
    window.robot && robot.set("trabajando", "Escaneando zonas…");
    try {
      const lista = await zips();
      decir(`Radar: empiezo la vuelta (${lista.length} ZIP de Orange County y LA County, ritmo humano).`);
      if (cfg.fuentes.census) await census(lista).catch((e) => decir("Radar: Census: " + e.message, "error"));
      // mercado y Propwire al mismo tiempo (son sitios distintos), cada uno con su propio ritmo
      await Promise.all([
        mercado(lista).catch((e) => decir("Radar: mercado: " + e.message, "error")),
        cfg.fuentes.propwire ? propwire(lista).catch((e) => decir("Radar: Propwire: " + e.message, "error")) : null,
      ]);
      await chrome.storage.local.set({ radarVuelta: { fecha: hoy(), t: Date.now(), parada: parar } });
      const r = await resumen();
      decir(`Radar: ${parar ? "me paraste" : "terminé la vuelta de hoy"}. Tengo datos de ${r.conDatos} de ${lista.length} ZIP (${r.completos} completos).`);
      clearTimeout(tTermi); tTermi = null; await aTermi(true);
      window.robot && robot.set("feliz", `${r.conDatos} ZIP con datos`);
    } catch (e) { decir("Radar: " + e.message, "error"); window.robot && robot.set("error", e.message); }
    finally { corriendo = false; botones(); pintar(); }
  });
}
async function resumen() {
  const d = await datos(); const { radarZips = {} } = await chrome.storage.local.get("radarZips");
  const lista = radarZips.lista || [];
  const conDatos = lista.filter((z) => d[z.zip] && FUENTES.some((f) => d[z.zip][f])).length;
  const completos = lista.filter((z) => d[z.zip] && d[z.zip].propwire && d[z.zip].propwire.preforeclosure != null && (d[z.zip].redfin || d[z.zip].zillow)).length;
  const r = { total: lista.length, conDatos, completos };
  await chrome.storage.local.set({ radarRes: r });
  return r;
}

// ---------- Pantalla ----------
async function pintar() {
  const d = await datos(); const { radarZips = {}, radarPausa = {} } = await chrome.storage.local.get(["radarZips", "radarPausa"]);
  const lista = radarZips.lista || []; const u = await uso();
  $("nZips").textContent = lista.length || "—";
  const r = await resumen(); $("nDatos").textContent = r.conDatos; $("nCompletos").textContent = r.completos;
  $("fuentes").innerHTML = FUENTES.map((f) => {
    const n = lista.filter((z) => d[z.zip] && d[z.zip][f]).length;
    const p = radarPausa[f] > Date.now() ? ` · <b style="color:#b91c1c">en pausa hasta ${new Date(radarPausa[f]).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</b>` : "";
    const hoyN = (u.n || {})[f] || 0;
    return `<li><div class="q"><b>${NOMBRE_F[f]}</b><small>${n} de ${lista.length || "?"} ZIP con datos${f !== "census" ? ` · hoy ${hoyN}/${cfg.topes[f] ?? "—"}` : ""}${p}${f === "census" && !cfg.censusKey ? " · falta la llave" : ""}</small></div><span class="tag ${cfg.fuentes[f] ? "ok" : "gris"}">${cfg.fuentes[f] ? "activa" : "apagada"}</span></li>`;
  }).join("");
}
function botones() { $("run").disabled = corriendo; $("stopBtn").hidden = !corriendo; }
$("run").onclick = () => escanear(true);
$("stopBtn").onclick = () => { parar = true; ver("Parando…"); };
$("guardarKey").onclick = async () => {
  guardarCfg(); $("censusKey").value = cfg.censusKey || ""; pintar();
  if (!cfg.censusKey) { ver("Pega la llave del Census."); return; }
  ver(`Guardé la llave (${cfg.censusKey.length} caracteres). Probándola con el Census…`);
  try {
    const r = await fetch(`https://api.census.gov/data/2023/acs/acs5?get=B25003_001E&for=zip%20code%20tabulation%20area:92620&key=${encodeURIComponent(cfg.censusKey)}`);
    const tx = await r.text();
    ver(r.ok && tx.trim().startsWith("[") ? `✅ La llave del Census funciona (${cfg.censusKey.length} caracteres).` : `❌ El Census no aceptó la llave (${cfg.censusKey.length} caracteres; normalmente son 40). Revisa que la copiaste completa del correo.`);
  } catch (e) { ver("No pude probar la llave: " + e.message); }
};

// Una vuelta al día (mientras el Centro de Mando esté abierto)
async function revisarHora() {
  if (corriendo || !cfg.auto || new Date().getHours() < cfg.hora) return;
  const { radarVuelta = {} } = await chrome.storage.local.get("radarVuelta");
  if (radarVuelta.fecha === hoy()) return;
  escanear(false);
}
cargarCfg().then(() => { pintar(); setTimeout(revisarHora, 30000); setInterval(revisarHora, 10 * 60000); setInterval(() => { if (corriendo) pintar(); }, 15000); });
