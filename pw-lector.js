// =====================================================================
// Funciones que corren DENTRO de una pestaña de Propwire (para Termi).
// Solo leen lo que la página ya muestra: no exportan ni gastan créditos.
// =====================================================================
// Aprende el nombre interno de un filtro dándole clic en el menú "Lead Types"
async function pwLlaveT(label) {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const norm = (s) => String(s || "").replace(/\s+/g, " ").replace(/&/g, "and").trim().toLowerCase();
  const propio = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ");
  const leer = () => { try { return (JSON.parse(new URLSearchParams(location.search).get("filters") || "{}").lead_type) || []; } catch (e) { return []; } };
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

// Lee las propiedades de la búsqueda abierta, página por página (con pausas de persona)
async function pwListarT(maxPag, pausaMin, pausaMax) {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = () => (document.body ? document.body.innerText : "");
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const limpio = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const bloqueo = () => /acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)|temporarily (blocked|restricted)|unusual (traffic|activity)/i.test(txt()) ||
    /verif|captcha|challenge/i.test(document.title) || !!document.querySelector('iframe[src*="captcha"], iframe[src*="challenge"], iframe[src*="turnstile"]');
  if (bloqueo()) return { bloqueo: true };
  // esperar el "of N Results"
  let total = null, igual = 0, ultimo = null;
  for (let i = 0; i < 50; i++) {
    await esp(400);
    if (/no (properties|results) (found|match)/i.test(txt())) return { total: 0, items: [] };
    const m = txt().match(/of\s+([\d,]+)\s+Results/i); const v = m ? Number(m[1].replace(/,/g, "")) : null;
    if (v != null && v === ultimo) { if (++igual >= 4) { total = v; break; } } else { ultimo = v; igual = 0; }
  }
  if (total == null) total = ultimo;
  if (total === 0) return { total: 0, items: [] };
  const leer = () => {
    const t = txt(), out = [];
    for (const re of [/(?<![\w-])(\d{1,6} +[A-Za-z0-9 .'#\-\/]{2,60}?), *([A-Za-z .'\-]{2,40}?), *CA,? +(\d{5})/g, /(?<![\w-])(\d{1,6} +[^\n,]{2,60})\n\s*([A-Za-z .'\-]{2,40}), *CA,? +(\d{5})/g]) {
      let m; while ((m = re.exec(t))) out.push({ street: limpio(m[1]), city: limpio(m[2]), zip: m[3] });
    }
    return out;
  };
  const cajas = () => [document.scrollingElement, ...[...document.querySelectorAll("div, section, ul, main")].filter((el) => { const s = getComputedStyle(el); return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 50 && vis(el); })];
  const siguiente = () => [...document.querySelectorAll('button, a, [role="button"]')].filter(vis).find((el) => {
    if (el.disabled || el.getAttribute("aria-disabled") === "true" || /disabled/.test(el.className)) return false;
    const t = `${el.innerText} ${el.getAttribute("aria-label") || ""} ${el.title || ""}`.trim().toLowerCase();
    return /^(next|siguiente|›|»|>)$/.test(el.innerText.trim().toLowerCase()) || /next page|siguiente/.test(t);
  });
  const vistos = new Map(); let p = 0;
  for (p = 1; p <= maxPag; p++) {
    if (bloqueo()) return { bloqueo: true, total, items: [...vistos.values()], paginas: p - 1 };
    for (let i = 0; i < 5; i++) { for (const b of cajas()) if (b) b.scrollTop = b.scrollHeight; await esp(600 + Math.random() * 500); }
    for (const it of leer()) { const k = (it.street + "|" + it.zip).toUpperCase(); if (!vistos.has(k)) vistos.set(k, it); }
    const sig = siguiente(); if (!sig || p === maxPag) break;
    await esp(pausaMin + Math.random() * (pausaMax - pausaMin)); // ritmo humano entre páginas
    const antes = leer()[0]; sig.click();
    for (let i = 0; i < 30; i++) { await esp(500); const ahora = leer()[0]; if (!antes || (ahora && ahora.street !== antes.street)) break; }
  }
  return { total, items: [...vistos.values()], paginas: p };
}
