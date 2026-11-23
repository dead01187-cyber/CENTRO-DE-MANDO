if (window.__pwAgentLoaded) { /* ya cargado */ } else {
window.__pwAgentLoaded = true;
// Content script: saca domicilios de Propwire (de las respuestas JSON y del texto
// de la página), y hace el trabajo del agente: buscar la zona, bajar y pasar páginas.

const STREET_KEYS = ["street", "streetaddress", "street_address", "address", "address1", "addressline1",
  "address_line1", "address_line_1", "line1", "full_street_address", "fullstreetaddress", "house_address",
  "situs_address", "property_address", "propertyaddress", "label"];
const CITY_KEYS = ["city", "cityname", "city_name", "situs_city", "property_city"];
const STATE_KEYS = ["state", "statecode", "state_code", "situs_state", "property_state", "st"];
const ZIP_KEYS = ["zip", "zipcode", "zip_code", "postalcode", "postal_code", "zip5", "situs_zip", "property_zip"];
const COUNTY_KEYS = ["county", "countyname", "county_name", "fips_county"];

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function pick(obj, keys) {
  for (const k of Object.keys(obj)) {
    if (keys.includes(k.toLowerCase())) {
      const v = obj[k];
      if (typeof v === "string" || typeof v === "number") return clean(v);
    }
  }
  return "";
}

function isCA(state) {
  const s = state.toUpperCase();
  return s === "CA" || s === "CALIFORNIA";
}

// Si el "street" viene como dirección completa ("123 Main St, Irvine, CA 92618"), quedarnos con la calle.
function streetOnly(street) {
  const m = street.match(/^(.+?),\s*[^,]+,\s*CA\b/i);
  return clean(m ? m[1] : street);
}

// ¿Este objeto dice que la propiedad/owner ya tiene skip trace?
function skipFlag(node) {
  for (const [k, v] of Object.entries(node)) {
    const key = k.toLowerCase();
    if (/skip.?trac/.test(key)) {
      if (v === true) return true;
      if (typeof v === "number" && v > 0) return true;
      if (typeof v === "string" && v.trim() && !/^(false|0|no|null|none|not.?traced|pending)$/i.test(v.trim())) return true;
      if (Array.isArray(v) && v.length) return true;
      if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length) return true;
    }
    if (/^(phones?|phone_?numbers|mobile_?phones|landlines|emails?|email_?addresses|contacts)$/.test(key) &&
        Array.isArray(v) && v.length) return true;
  }
  return false;
}

function fromJSON(node, out, depth = 0, inherited = false, empHer = false) {
  if (!node || depth > 12) return;
  if (Array.isArray(node)) { for (const n of node) fromJSON(n, out, depth + 1, inherited, empHer); return; }
  if (typeof node !== "object") return;

  const traced = inherited || skipFlag(node);
  // ¿Propwire dice que el dueño es compañía/gobierno (y no persona ni trust)? Se hereda a la dirección anidada
  const emp = node.company_owned === true || node.government_owned === true ? !(node.individual_owned === true || node.trust_owned === true) : empHer;
  const street = pick(node, STREET_KEYS);
  const city = pick(node, CITY_KEYS);
  const state = pick(node, STATE_KEYS);
  const zip = pick(node, ZIP_KEYS).slice(0, 5);
  if (street && /^\d/.test(street) && city && state && isCA(state)) {
    // El flag puede venir en el objeto "hermano" (owner) del mismo registro: revisar también los hijos.
    let siblingTraced = false;
    for (const v of Object.values(node)) if (v && typeof v === "object" && !Array.isArray(v) && skipFlag(v)) siblingTraced = true;
    out.push({ street: streetOnly(street), city, state: "CA", zip, county: pick(node, COUNTY_KEYS),
      skipTraced: traced || siblingTraced, ...(emp ? { empresa: true } : {}) });
  }
  for (const v of Object.values(node)) if (v && typeof v === "object") fromJSON(v, out, depth + 1, traced, emp);
}

// Cuando un objeto de propiedad tiene la dirección anidada (property.address.street), el flag
// de skip trace vive en "property". Por eso se hereda hacia abajo con "inherited".

// Busca en la página la tarjeta que contiene esa calle y revisa si ya trae skip trace.
const PHONE_RE = /\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/;
function cardSaysTraced(street) {
  if (!document.body || !document.createTreeWalker) return false;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const needle = street.toLowerCase();
  let n;
  while ((n = walker.nextNode())) {
    if (!n.nodeValue || !n.nodeValue.toLowerCase().includes(needle)) continue;
    let el = n.parentElement;
    for (let i = 0; el && i < 8; i++, el = el.parentElement) {
      const t = el.innerText || "";
      if (t.length > 1500) break;
      // Si este contenedor ya tiene otro domicilio, nos salimos de la tarjeta: no revisar más arriba.
      if ((t.match(/,\s*CA,?\s+\d{5}/gi) || []).length > 1) break;
      if (/skip[\s-]?traced|traced on|skip trace (complete|results)/i.test(t) || PHONE_RE.test(t) ||
          /[\w.+-]+@[\w-]+\.[\w.]+/.test(t) ||
          el.querySelector('a[href^="tel:"], a[href^="mailto:"]')) return true;
    }
    return false;
  }
  return false;
}

function fromText() {
  const text = (document.body && document.body.innerText) || "";
  const out = [];
  const patterns = [
    /(?<![\w-])(\d{1,6} +[A-Za-z0-9 .'#\-\/]{2,60}?), *([A-Za-z .'\-]{2,40}?), *CA,? +(\d{5})/g,
    /(?<![\w-])(\d{1,6} +[^\n,]{2,60})\n\s*([A-Za-z .'\-]{2,40}), *CA,? +(\d{5})/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      const street = clean(m[1]);
      out.push({ street, city: clean(m[2]), state: "CA", zip: m[3], county: "", skipTraced: cardSaysTraced(street) });
    }
  }
  return out;
}

function report(items, source) {
  if (!items.length) return;
  chrome.runtime.sendMessage({ type: "found", items, source }).catch(() => {});
}

// Respuestas JSON interceptadas por hook.js
window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || !e.data.__pwAgent) return;
  const out = [];
  fromJSON(e.data.data, out);
  report(out, "red");
});

// ---------- Acciones del agente ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stopFlag = false;

function status(text) {
  chrome.runtime.sendMessage({ type: "pwStatus", text }).catch(() => {});
}

function setNativeValue(input, value) {
  const proto = Object.getPrototypeOf(input);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter ? setter.call(input, value) : (input.value = value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function visible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

function findSearchInput() {
  const inputs = [...document.querySelectorAll("input")].filter((i) =>
    visible(i) && !["hidden", "checkbox", "radio", "password", "email", "number"].includes(i.type));
  const score = (i) => {
    const t = `${i.placeholder} ${i.getAttribute("aria-label") || ""} ${i.name} ${i.id}`.toLowerCase();
    let s = 0;
    if (/search|buscar/.test(t)) s += 3;
    if (/address|city|zip|county|location|state/.test(t)) s += 3;
    if (i.type === "search") s += 2;
    return s;
  };
  return inputs.sort((a, b) => score(b) - score(a))[0] || null;
}

async function searchZone(zone) {
  if (!(await esperarVerificacion())) return false;
  const input = findSearchInput();
  if (!input) { status("No encontré la barra de búsqueda. Busca la zona a mano y dale “Recolectar”."); return false; }
  input.focus();
  setNativeValue(input, "");
  await sleep(200);
  setNativeValue(input, zone);
  status(`Escribí “${zone}” en Propwire, esperando sugerencias…`);
  await sleep(1800);

  const z = zone.toLowerCase().split(",")[0].trim();
  const zRe = new RegExp("^\\s*" + z.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*,\\s*ca\\b", "i");
  // Una sola opción (no la caja con toda la lista): en Propwire son <li class="dropdown-option">
  const options = [...document.querySelectorAll('[role="option"], li, .dropdown-option, [class*="suggest"] *, [class*="autocomplete"] *, [class*="dropdown"] *')]
    .filter((el) => visible(el) && el.innerText && el.innerText.length < 120 && el !== document.activeElement)
    .filter((el) => el.innerText.toLowerCase().includes(z))
    .filter((el) => (el.innerText.match(/,\s*[A-Z]{2}\b/g) || []).length <= 1);
  const puntos = (el) => (zRe.test(el.innerText) ? 0 : 50) + (/\bCA\b|california/i.test(el.innerText) ? 0 : 100) +
    (el.matches('[role="option"], li, .dropdown-option') ? 0 : 10) + el.innerText.length / 100;
  options.sort((a, b) => puntos(a) - puntos(b));
  const best = options[0] && (options[0].closest('[role="option"], li, .dropdown-option') || options[0]);
  if (best) {
    best.click();
    status(`Elegí “${clean(best.innerText)}”. Cargando resultados…`);
  } else {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
    status("No vi sugerencias, mandé Enter. Revisa que la búsqueda sea la correcta.");
  }
  await sleep(3500);
  return true;
}

function scrollables() {
  return [...document.querySelectorAll("div, section, ul, main")].filter((el) => {
    const s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 50 && visible(el);
  });
}

async function scrollAll() {
  const boxes = [document.scrollingElement, ...scrollables()];
  for (let i = 0; i < 6 && !stopFlag; i++) {
    for (const b of boxes) b.scrollTop = b.scrollHeight;
    await sleep(700);
  }
}

function findNext() {
  const els = [...document.querySelectorAll('button, a, [role="button"]')].filter(visible);
  return els.find((el) => {
    if (el.disabled || el.getAttribute("aria-disabled") === "true" || /disabled/.test(el.className)) return false;
    const t = `${el.innerText} ${el.getAttribute("aria-label") || ""} ${el.title || ""}`.trim().toLowerCase();
    return /^(next|siguiente|›|»|>)$/.test(el.innerText.trim().toLowerCase()) || /next page|siguiente/.test(t);
  });
}

async function collectOnce() {
  await scrollAll();
  const items = fromText();
  report(items, "texto");
  return items.length;
}

// ---------- Captcha / verificación: se pausa y se le pide ayuda a Christopher ----------
function hayVerificacion() {
  const t = ((document.body && document.body.innerText) || "").slice(0, 6000);
  return /verify (that )?you(['’]re| are) (a )?human|are you a robot|i['’]?m not a robot|captcha|unusual (activity|traffic)|press (and|&) hold|security check|checking your browser|confirm you are human/i.test(t) ||
    /just a moment|attention required/i.test(document.title) ||
    [...document.querySelectorAll("iframe")].some((f) => /recaptcha|hcaptcha|challenges\.cloudflare|turnstile|arkoselabs|datadome/i.test(f.src || "")) ||
    !!document.querySelector(".g-recaptcha, .h-captcha, .cf-turnstile, #challenge-form, [data-sitekey]");
}
async function esperarVerificacion() {
  if (!hayVerificacion()) return true;
  status("Propwire pide verificación (captcha). Resuélvela en esta pestaña; yo sigo solo cuando termines.");
  const inicio = Date.now(); let ultimo = 0;
  while (!stopFlag && Date.now() - inicio < 15 * 60e3) {
    await sleep(3000);
    if (!hayVerificacion()) { status("¡Gracias! La verificación quedó. Sigo recolectando."); await sleep(2000); return true; }
    const s = Math.round((Date.now() - inicio) / 1000);
    if (s - ultimo >= 30) { ultimo = s; status(`Esperando que resuelvas la verificación de Propwire (${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")})…`); }
  }
  return false;
}

// Turno de Propwire compartido con Wibi, Wibi 3 y Heri (misma cuenta): 8–12 s entre cargas de cualquier robot, 150 por hora
async function turnoPW() {
  const extra = Math.random() * 4000;
  for (;;) {
    if (stopFlag) return;
    const { pwUltimo = 0, pwCargas = [] } = await chrome.storage.local.get(["pwUltimo", "pwCargas"]);
    const ahora = Date.now(), hora = pwCargas.filter((t) => t > ahora - 3600e3);
    let espera = Math.max(0, pwUltimo + 8000 + extra - ahora);
    if (hora.length >= 150) espera = Math.max(espera, hora[0] + 3600e3 - ahora);
    if (espera <= 0) { hora.push(ahora); await chrome.storage.local.set({ pwUltimo: ahora, pwCargas: hora.slice(-150) }); return; }
    status(hora.length >= 150 ? `Turno de Propwire: ya van 150 páginas esta hora entre todos; espero ${Math.ceil(espera / 60000)} min…` : `Esperando turno de Propwire (otro agente la está usando)… ${Math.ceil(espera / 1000)} s`);
    await sleep(Math.min(espera, 2000));
  }
}
async function autoRun(maxPages) {
  stopFlag = false;
  for (let p = 1; p <= maxPages && !stopFlag; p++) {
    if (!(await esperarVerificacion())) { status("La verificación no se resolvió. Cuando esté lista, dale Buscar otra vez."); return; }
    status(`Página ${p}: recolectando…`);
    await collectOnce();
    const next = findNext();
    if (!next) { status(`Listo: no hay más páginas (llegué a la ${p}).`); return; }
    await turnoPW();
    if (stopFlag) break;
    next.click();
    await sleep(3000 + Math.random() * 4000); // ritmo humano entre páginas
  }
  status(stopFlag ? "Parado." : `Listo: recorrí ${maxPages} páginas.`);
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.cmd === "ping") return reply({ ok: true });
    if (msg.cmd === "stop") { stopFlag = true; return reply({ ok: true }); }
    if (msg.cmd === "collect") { const n = await collectOnce(); status(`Recolecté esta página (${n} vistos).`); return reply({ ok: true }); }
    if (msg.cmd === "run") {
      reply({ ok: true });
      stopFlag = false;
      if (msg.zone) {
        const ok = await searchZone(msg.zone);
        if (!ok || stopFlag) return;
      }
      await autoRun(msg.maxPages || 10);
    }
  })();
  return true;
});

}
