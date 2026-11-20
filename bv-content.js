if (window.__bvAgentLoaded) { /* ya cargado */ } else {
window.__bvAgentLoaded = true;
// Content script en BeenVerified: escribe el domicilio en la búsqueda de propiedad y la lanza.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function status(text) {
  chrome.runtime.sendMessage({ type: "bvStatus", text }).catch(() => {});
}

function visible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

function setNativeValue(input, value) {
  const proto = Object.getPrototypeOf(input);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter ? setter.call(input, value) : (input.value = value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

// 1) Seleccionar "Property" (pills de arriba o el cuadro de "Try Another Search")
function realClick(el) {
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
  for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    el.dispatchEvent(t.startsWith("pointer") ? new PointerEvent(t, o) : new MouseEvent(t, o));
  }
}

async function openPropertyTab() {
  const listo = () => { const i = findAddressInput(); return !!(i && /\d+\s+main st|address|street|property/i.test(i.placeholder || "")); };
  if (listo()) return true; // ya está en Property
  const cands = [...document.querySelectorAll('button, a, [role="tab"], [role="button"], li, label, div, span, p')]
    .filter((el) => {
      if (!visible(el)) return false;
      const t = clean(el.innerText);
      // "Property", "home Property", "■ Property"… (ícono + texto), pero no el grupo con todas las opciones
      return t.length <= 30 && /(^|[^a-z])property$/i.test(t) && !/people|phone|email|username|vehicle/i.test(t);
    })
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width < 450 && r.height < 200; })
    .map((el) => el.closest('button, a, [role="tab"], [role="button"], label') || el)
    .filter((el, i, arr) => arr.indexOf(el) === i);
  if (!cands.length) return false;
  // Hay dos "Property": el del menú de arriba (no cambia la búsqueda) y el botón junto al buscador.
  // Primero el que está junto al buscador: con ícono, fuera del encabezado y más cerca del campo de texto.
  const caja = [...document.querySelectorAll("input")].find((i) => visible(i) && i.getBoundingClientRect().width > 200);
  const puntos = (el) => {
    const r = el.getBoundingClientRect();
    let p = 0;
    if (el.closest("header, nav, [class*='Header'], [class*='header'], [class*='AppBar']")) p -= 50;
    if (r.y < 80) p -= 30;
    if (el.querySelector("svg, img, i") || /labelIcon/.test(el.className)) p += 20;
    if (caja) p -= dist(el, caja) / 20;
    return p;
  };
  cands.sort((x, y) => puntos(y) - puntos(x));
  for (const target of cands) {
    realClick(target);
    for (let i = 0; i < 12; i++) { await sleep(250); if (listo() || target.getAttribute("aria-selected") === "true" && findAddressInput()) break; }
    if (listo()) { status("Seleccioné Property."); await sleep(300); return true; }
  }
  status("No pude cambiar la búsqueda a Property.");
  return false;
}

// 2) Encontrar el campo de dirección (placeholder tipo "e.g. 123 Main St. New York, NY")
function findAddressInput() {
  const inputs = [...document.querySelectorAll("input")].filter((i) =>
    visible(i) && !i.disabled && !["hidden", "checkbox", "radio", "password", "submit", "button", "email", "tel"].includes(i.type));
  const score = (i) => {
    const t = `${i.placeholder} ${i.getAttribute("aria-label") || ""} ${i.name} ${i.id}`.toLowerCase();
    let s = 0;
    if (/address|street|property/.test(t)) s += 5;
    if (/\d+\s+\w+\s+(st|ave|rd|blvd|dr)\b|main st/.test(t)) s += 5;   // "123 Main St."
    if (/search/.test(t)) s += 1;
    if (/first|last|name|phone|email|vin|plate|user/.test(t)) s -= 5;
    return s;
  };
  const best = inputs.sort((a, b) => score(b) - score(a))[0];
  return best && score(best) > 0 ? best : null;
}

// 3) Pegar el texto como si fuera a mano (React sí lo detecta)
async function pasteInto(input, text) {
  input.focus();
  input.click();
  input.select && input.select();
  document.execCommand("selectAll", false, null);
  document.execCommand("delete", false, null);
  await sleep(150);
  let ok = false;
  try {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  } catch (e) {}
  if (input.value !== text) ok = document.execCommand("insertText", false, text);
  if (input.value !== text) setNativeValue(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
  return input.value === text || ok;
}

// 4) El botón azul "Search"
function findSearchButton(input) {
  const btns = [...document.querySelectorAll('button, input[type="submit"], [role="button"], a')]
    .filter((b) => visible(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true");
  const isSearch = (b) => /^(search|buscar)$/i.test(clean(b.innerText || b.value));
  const form = input.closest("form");
  return (form && [...form.querySelectorAll('button, input[type="submit"]')].find((b) => visible(b) && (isSearch(b) || b.type === "submit")))
    || btns.filter(isSearch).sort((a, b) => dist(a, input) - dist(b, input))[0] || null;
}
function dist(a, b) {
  const r1 = a.getBoundingClientRect(), r2 = b.getBoundingClientRect();
  return Math.hypot(r1.x - r2.x, r1.y - r2.y);
}

async function searchAddress(address, launched = () => {}) {
  // Siempre seleccionar Property antes de buscar
  await openPropertyTab();
  let input = findAddressInput();
  if (!input) {
    status("No encontré el campo de dirección. Abre la búsqueda de Property en BeenVerified y vuelve a darle Buscar.");
    return false;
  }

  await pasteInto(input, address);
  status(`Pegué “${address}”, esperando sugerencias…`);
  await sleep(1500);

  // Si sale la lista de sugerencias, elegir la que tenga el número y la calle
  const num = (address.match(/^\d+/) || [""])[0];
  const streetWord = (address.split(",")[0].split(/\s+/)[1] || "").toLowerCase();
  const options = [...document.querySelectorAll('[role="option"], [role="listbox"] *, li, [class*="suggest"] *, [class*="autocomplete"] *, [class*="pac-item"]')]
    .filter((el) => visible(el) && el !== input && el.children.length <= 4 && el.innerText && el.innerText.length < 160)
    .filter((el) => { const t = el.innerText.toLowerCase(); return num && t.includes(num) && (!streetWord || t.includes(streetWord)); });
  if (options[0]) {
    options[0].click();
    await sleep(800);
    // algunas listas cambian el texto del campo; si lo borró, volver a pegarlo
    if (!input.value) await pasteInto(input, address);
  }

  const go = findSearchButton(input);
  status(`Le di Search a ${address}.`);
  launched(true); // avisar antes del clic: la página puede cambiar de inmediato
  await sleep(50);
  if (go) { go.click(); }
  else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
  await sleep(1200);

  // Si BeenVerified marca "valid street address", intentar una vez más escribiendo letra por letra
  if (/valid street address/i.test(document.body.innerText) && document.contains(input)) {
    status("BeenVerified no aceptó el pegado, lo escribo letra por letra…");
    input.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    for (const ch of address) { document.execCommand("insertText", false, ch); await sleep(35); }
    await sleep(1500);
    const opt = [...document.querySelectorAll('[role="option"], li')].find((el) => visible(el) && el.innerText && el.innerText.toLowerCase().includes(num));
    if (opt) { opt.click(); await sleep(800); }
    (findSearchButton(input) || input).click();
  }
  return true;
}

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.cmd === "ping") { reply({ ok: true }); return; }
  if (msg.cmd === "search") {
    let sent = false;
    const once = (ok) => { if (!sent) { sent = true; reply({ ok }); } };
    searchAddress(msg.address, once).then((ok) => once(ok)).catch(() => once(false));
    return true;
  }
});

}
