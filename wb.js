// =====================================================================
// Wibi: skip trace en Propwire. Toma los domicilios que Chequi aprobó
// (cuando en Chequi escoges "Mandar a: Wibi"), abre cada propiedad en
// Propwire, pestaña Owner, le da "Skip Trace" y saca owner y teléfonos
// (la misma data que Owny). Lo deja en su lote y Lofti lo sube.
// El skip trace de Propwire se cobra de tu saldo: Wibi respeta un tope
// por día y, la primera vez (o si cambia el precio), te pide tu OK.
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const hoy = () => new Date().toLocaleDateString("en-CA");
const fecha = (ms) => ms ? new Date(ms).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const RE_EMPRESA = /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|LP|LLP|LTD|PARTNERS(HIP)?|HOLDINGS?|PROPERTIES|INVESTMENTS?|BANK|CHURCH|ASSOCIATION|CITY OF|COUNTY OF|STATE OF|HOUSING|DEVELOPMENT)\b/i;

const DEF = { auto: true, tope: 20, sinEmpresas: true, modo: "lista", tanda: 25, minEntre: 10 };
let cfg = { ...DEF }, corriendo = false, parar = false;

async function cargarCfg() {
  const { wbConfig = {}, [K("wbConfig")]: propia } = await chrome.storage.local.get(["wbConfig", K("wbConfig")]);
  cfg = { ...DEF, ...wbConfig, ...(LINEA ? { auto: false } : {}), ...(propia || {}) }; // Wibi 3 arranca con los ajustes de Wibi pero apagado
  $("auto").checked = !!cfg.auto; $("tope").value = cfg.tope; $("sinEmpresas").checked = cfg.sinEmpresas !== false;
  $("modo").value = cfg.modo || "lista"; $("tanda").value = cfg.tanda || 25; $("minEntre").value = cfg.minEntre != null ? cfg.minEntre : 10;
}
function guardarCfg() {
  cfg = { auto: $("auto").checked, tope: Math.max(0, parseInt($("tope").value, 10) || 0), sinEmpresas: $("sinEmpresas").checked,
    modo: $("modo").value === "una" ? "una" : "lista", tanda: Math.max(2, Math.min(200, parseInt($("tanda").value, 10) || 25)), minEntre: Math.max(1, Math.min(240, parseInt($("minEntre").value, 10) || 10)) };
  chrome.storage.local.set({ [K("wbConfig")]: cfg });
}
["auto", "tope", "sinEmpresas", "modo", "tanda", "minEntre"].forEach((id) => ($(id).onchange = () => { guardarCfg(); pintar(); if (cfg.auto) trabajar(false); }));

// ---------- Corren DENTRO de Propwire ----------
// 1) Buscar el domicilio y abrir su pestaña Owner. Regresa { url } o { error }
async function pwAbrir(calle, ciudad, zip) {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  if (/acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)|temporarily (blocked|restricted)|unusual (traffic|activity)/i.test(document.body ? document.body.innerText : "")) return { error: "Propwire bloqueó el acceso temporalmente", bloqueo: true };
  if (/verif|captcha|challenge/i.test(document.title) || document.querySelector('iframe[src*="captcha"], iframe[src*="challenge"]'))
    return { error: "Propwire pide verificación (captcha)", ayuda: true };
  let inp = null;
  for (let i = 0; i < 40 && !inp; i++) { inp = [...document.querySelectorAll("input")].find((e) => /Address, city/i.test(e.placeholder || "") && visible(e)); if (!inp) await esp(300); }
  if (!inp) return { error: "no encontré la caja de búsqueda de Propwire (¿sesión abierta?)" };
  inp.focus();
  const poner = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  poner.call(inp, `${calle}, ${ciudad}, CA ${zip || ""}`.trim());
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  const num = (calle.match(/^\d+/) || [""])[0], pal = (calle.replace(/^\d+\s*/, "").split(/\s+/).find((w) => w.length > 2) || "").toLowerCase();
  let sug = null;
  for (let i = 0; i < 40 && !sug; i++) {
    await esp(300);
    sug = [...document.querySelectorAll("li.dropdown-option, [role=option], li")].find((e) => visible(e) && /Address\s*$/i.test(e.textContent.trim()) &&
      e.textContent.trim().startsWith(num + " ") && e.textContent.toLowerCase().includes(pal));
  }
  if (!sug) return { error: "Propwire no encontró ese domicilio", sinDatos: true };
  sug.click();
  for (let i = 0; i < 40 && !/\/realestate\/.+\/(property|owner)-details/.test(location.pathname); i++) await esp(300);
  if (!/\/realestate\//.test(location.pathname)) return { error: `no se abrió la propiedad en Propwire (se quedó en ${location.pathname.slice(0, 60)})` };
  await esp(1200);
  if (!/owner-details/.test(location.pathname)) {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i++) { tab = [...document.querySelectorAll("nav, a, button")].find((e) => /^\s*Owner\s*$/.test(e.textContent) && visible(e)); if (!tab) await esp(300); }
    if (!tab) return { error: `no encontré la pestaña Owner en Propwire (${location.pathname.slice(0, 60)})` };
    tab.click();
    for (let i = 0; i < 30 && !/owner-details/.test(location.pathname); i++) await esp(300);
  }
  for (let i = 0; i < 30 && ![...document.querySelectorAll("span")].some((e) => /^\s*Full Name\s*$/.test(e.textContent)); i++) await esp(300);
  return { url: location.href };
}
// ¿Propwire puso su página de "acceso restringido"?
function pwBloqueo() { return /acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)|temporarily (blocked|restricted)|unusual (traffic|activity)/i.test(document.body ? document.body.innerText : ""); }
// 2) Leer owner y teléfonos (y si se puede dar Skip Trace)
function pwLeer() {
  const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const fn = [...document.querySelectorAll("span")].find((e) => /^\s*Full Name\s*$/.test(e.textContent) && visible(e));
  const nombre = fn && fn.parentElement ? fn.parentElement.innerText.replace(/^\s*Full Name\s*/i, "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || "" : "";
  // Propwire enseña los teléfonos de dos formas: tapados "Mobile - (999) 999-9999" y,
  // ya con skip trace, "(714) 879-5956  Land Line" (el número es un link y el tipo va al lado)
  const TIPO = /\b(Mobile|Cell|Wireless|Land ?Line|Landline|VoIP|Phone|Other|Unknown|Residential)\b/i;
  const RE = /^(?:(Mobile|Cell|Wireless|Land ?Line|Landline|VoIP|Phone|Other|Unknown|Residential)\s*-\s*)?\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})\b/i;
  const borroso = (e) => { for (let x = e, i = 0; x && i < 4; x = x.parentElement, i++) if (/blur/.test(String(x.className))) return true; return false; };
  const tels = [];
  for (const e of document.querySelectorAll("span, div, li, a, p")) {
    if (e.children.length || !visible(e)) continue;
    const m = e.textContent.trim().match(RE);
    if (!m) continue;
    const num = m[2] + m[3] + m[4];
    const fila = e.parentElement || e;
    const t = m[1] || ((fila.textContent.replace(e.textContent, "").match(TIPO) || [])[1]) || "Phone";
    const tapado = /^9{10}$/.test(num) || borroso(e);
    const dnc = /\bDNC\b|do not call/i.test(fila.textContent);
    if (!tels.some((x) => x.num === num)) tels.push({ num, type: /land/i.test(t) ? "Landline" : t.replace(/^./, (c) => c.toUpperCase()), tapado, dnc });
  }
  const emails = [];
  const et = [...document.querySelectorAll("span, div, p")].find((e) => /^\s*Email\(s\)\s*$/i.test(e.textContent) && visible(e));
  if (et) for (const m of (et.parentElement.parentElement || et.parentElement).innerText.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) { const x = m[0].toLowerCase(); if (!emails.includes(x) && !borroso(et.parentElement)) emails.push(x); }
  const boton = [...document.querySelectorAll("button")].find((b) => /^\s*Skip Trace\s*$/i.test(b.textContent) && visible(b) && !b.disabled);
  const yaHecho = /Skip Traced on/i.test(document.body.innerText);
  const cartera = [...document.querySelectorAll("button")].find((b) => /^\$[\d,]+(\.\d+)?$/.test(b.innerText.trim()));
  const saldo = cartera ? parseFloat(cartera.innerText.trim().replace(/[$,]/g, "")) : null; // dinero de Propwire (los créditos de skip trace van aparte)
  const bloqueo = /acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)|temporarily (blocked|restricted)|unusual (traffic|activity)/i.test(document.body.innerText);
  return { nombre, tels, emails, hayBoton: !!boton, yaHecho, saldo, url: location.href, bloqueo };
}
// 3) Darle Skip Trace. Si sale una ventana de confirmación, NO la acepta: regresa su texto y botones.
//    Propwire a veces se brinca a la ficha (property-details) de la MISMA propiedad: eso es normal.
async function pwSkip() {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const idDe = (p) => (p.match(/\/realestate\/[^/]+\/(\d+)/) || [])[1] || "";
  const id0 = idDe(location.pathname), path0 = location.pathname;
  const NO_ES = /^(add|added|remove|save|save search|saved|\+|×|x|close|cancel|)$/i; // botones de las listas de Propwire: no son la confirmación del cobro
  const botonesVisibles = () => new Set([...document.querySelectorAll("button, a[role=button], [role=button]")].filter((b) => visible(b) && !NO_ES.test(b.innerText.replace(/\s+/g, " ").trim())));
  const antes = botonesVisibles();
  const destapados = () => /Skip Traced on/i.test(document.body.innerText);
  const boton = [...document.querySelectorAll("button")].find((b) => /^\s*Skip Trace\s*$/i.test(b.textContent) && visible(b) && !b.disabled);
  if (!boton) return { error: "no encontré el botón Skip Trace" };
  // La ficha de Propwire ya es una ventana flotante (modal): esa NO es la confirmación
  const SEL = '[role=dialog], [role=alertdialog], .modal, [class*="modal"]';
  const modales0 = new Set(document.querySelectorAll(SEL));
  boton.click();
  let navego = false;
  for (let i = 0; i < 50; i++) {
    await esp(300);
    if (location.pathname !== path0) {
      if (!/\/realestate\//.test(location.pathname) || idDe(location.pathname) !== id0) return { error: "Propwire me mandó a otra página: " + location.pathname.slice(0, 70) };
      navego = true; // la misma propiedad, otra pestaña de la ficha
    }
    // 1º por el título de la ventana ("Please Confirm"); 2º una ventana NUEVA que no sea la ficha
    let dlg = null;
    const tit = [...document.querySelectorAll("h1, h2, h3, h4, div, span, p")].find((e) => !e.children.length && visible(e) && /^\s*(Please Confirm|Confirm Skip Trace|Review your transaction summary\.?)\s*$/i.test(e.textContent));
    for (let x = tit; x && x !== document.body; x = x.parentElement) if ([...x.querySelectorAll("button, a[role=button], [role=button]")].some((b) => visible(b) && /^(continue|confirm|ok|yes|proceed|run skip trace)$/i.test(b.innerText.replace(/\s+/g, " ").trim()))) { dlg = x; break; }
    if (!dlg) dlg = [...document.querySelectorAll(SEL)].find((d) => !modales0.has(d) && !d.contains(boton) && visible(d) && [...d.querySelectorAll("button")].some((b) => visible(b) && !NO_ES.test(b.innerText.replace(/\s+/g, " ").trim())));
    const nuevos = navego ? [] : [...botonesVisibles()].filter((b) => !antes.has(b));
    if (dlg || nuevos.length) {
      await esp(700);
      const nb = dlg ? [...dlg.querySelectorAll("button, a[role=button], [role=button]")].filter((b) => visible(b) && !NO_ES.test(b.innerText.replace(/\s+/g, " ").trim())) : [...botonesVisibles()].filter((b) => !antes.has(b));
      if (!nb.length) continue;
      let caja = dlg || nb[0];
      while (!dlg && caja && caja.parentElement && nb.some((b) => !caja.contains(b))) caja = caja.parentElement;
      while (caja && caja.parentElement && caja.innerText.trim().length < 25) caja = caja.parentElement;
      // que el texto incluya toda la ventana ("Please Confirm … Use Skip Trace Credits … New Credit Balance")
      while (!dlg && caja && caja.parentElement && !/please confirm|credit|transaction|\$\s*\d/i.test(caja.innerText) && caja.parentElement.innerText.length < 1500) caja = caja.parentElement;
      return { dialogo: { texto: (caja ? caja.innerText : "").replace(/\s+/g, " ").trim().slice(0, 400), botones: nb.map((b) => b.innerText.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 6) } };
    }
    if (/owner-details/.test(location.pathname) && destapados() && i > 3) return { listo: true };
  }
  return navego ? { navego: true } : { error: "le di Skip Trace y no pasó nada" };
}
// 4) Aceptar la confirmación con el botón aprobado y esperar a que termine
async function pwConfirmar(etiqueta) {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const b = [...document.querySelectorAll("button, a[role=button], [role=button]")].find((x) => visible(x) && x.innerText.replace(/\s+/g, " ").trim() === etiqueta);
  if (!b) return { error: `no encontré el botón “${etiqueta}”` };
  const path0 = location.pathname;
  b.click();
  for (let i = 0; i < 100; i++) {
    await esp(300);
    const t = document.body.innerText;
    if (/insufficient|add funds|not enough|top up|recharge|fondos insuficientes|saldo insuficiente/i.test(t)) return { sinSaldo: true };
    if (/Skip Traced on/i.test(t) && i > 2) return { listo: true };
    if (location.pathname !== path0 && i > 12) return { listo: true, navego: true }; // se fue a otra pestaña de la ficha: se revisa en Owner
    const dlg = [...document.querySelectorAll("h1, h2, h3, h4, div, span, p")].find((e) => !e.children.length && visible(e) && /^\s*Please Confirm\s*$/i.test(e.textContent)) || (b.isConnected && visible(b)); // sigue abierta la confirmación
    if (!dlg && i > 15) return { listo: true }; // la ventana se cerró: se revisa en Owner
  }
  return { error: "acepté el skip trace pero no terminó" };
}
// 5) Ir a la pestaña Owner de la misma propiedad (Propwire a veces se brinca a la ficha)
async function pwIrOwner() {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  if (!/owner-details/.test(location.pathname)) {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i++) { tab = [...document.querySelectorAll("nav, a, button")].find((e) => /^\s*Owner\s*$/.test(e.textContent) && visible(e)); if (!tab) await esp(300); }
    if (!tab) return { error: `no encontré la pestaña Owner (${location.pathname.slice(0, 70)})` };
    tab.click();
    for (let i = 0; i < 30 && !/owner-details/.test(location.pathname); i++) await esp(300);
  }
  for (let i = 0; i < 30 && ![...document.querySelectorAll("span")].some((e) => /^\s*Full Name\s*$/.test(e.textContent)); i++) await esp(300);
  await esp(1500);
  return { ok: /owner-details/.test(location.pathname) };
}

// ---------- Pestaña de Propwire del robot ----------
async function pestanaPW(irABuscar) {
  const { [K("wbTab")]: wbTab } = await chrome.storage.local.get(K("wbTab"));
  let id = null;
  const vid = await ventanaTrabajo(); // la ventana de su brazo (Leads nuevos o HECM)
  if (wbTab) {
    const t = await chrome.tabs.get(wbTab).catch(() => null);
    if (t && /^https:\/\/([a-z0-9-]+\.)?propwire\.com\//.test(t.url || "")) {
      if (t.windowId !== vid) { await chrome.tabs.move(t.id, { windowId: vid, index: -1 }).catch(() => {}); svLog && svLog(`Pasé mi pestaña de Propwire a la ventana de ${NOMBRE_BRAZO[BRAZO_DE[document.documentElement.dataset.mod]] || "trabajo"}.`); }
      id = t.id;
    }
  }
  if (!id) {
    const t = await abrirPestana("https://propwire.com/search"); id = t.id;
    await chrome.storage.local.set({ [K("wbTab")]: id }); await sleep(2500);
    svLog && svLog(`Abrí mi pestaña de Propwire en la ventana de ${NOMBRE_BRAZO[BRAZO_DE[document.documentElement.dataset.mod]] || "trabajo"}.`);
    return id;
  }
  if (irABuscar) {
    await chrome.tabs.update(id, { url: "https://propwire.com/search" });
    await sleep(700);
    for (let i = 0; i < 60; i++) { const x = await chrome.tabs.get(id).catch(() => null); if (!x || x.status === "complete") break; await sleep(400); }
    await sleep(1500);
  }
  return id;
}
// Pone la pestaña de Propwire al frente mientras trabaja: Chrome casi no deja avanzar a las páginas ocultas
// (Propwire no termina de abrir la ficha). Regresa una función para dejar todo como estaba.
async function alFrente(tabId) {
  const t = await chrome.tabs.get(tabId);
  const [antes] = await chrome.tabs.query({ active: true, windowId: t.windowId });
  const winFoco = await chrome.windows.getLastFocused().catch(() => null);
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
  await sleep(800);
  return async () => {
    if (antes && antes.id !== tabId) await chrome.tabs.update(antes.id, { active: true }).catch(() => {});
    if (winFoco && winFoco.id !== t.windowId) await chrome.windows.update(winFoco.id, { focused: true }).catch(() => {});
  };
}
const corre = async (tab, func, args = []) => {
  const [r] = await chrome.scripting.executeScript({ target: { tabId: tab }, func, args });
  return r && r.result;
};

// ---------- Utilidades ----------
// Fase 1: la firma CONSERVA los montos en dinero ($30.00 ≠ $0.12) y solo quita los demás números (créditos que quedan,
// número de propiedades). Antes los montos se borraban y un cobro distinto se aprobaba solo.
const firma = (t) => {
  const montos = [];
  const sinMontos = String(t || "").toLowerCase().replace(/\$\s*([\d,]+(?:\.\d+)?)/g, (m, a) => { montos.push(Number(a.replace(/,/g, "")).toFixed(2)); return "\u0000"; });
  let i = 0;
  return sinMontos.replace(/\d+/g, "#").replace(/\u0000/g, () => "$" + montos[i++]).replace(/\s+/g, " ").trim();
};
// La ventana "Please Confirm" de Propwire: ¿usa créditos? ¿cuántos quedan? ¿cobra dinero?
const creditos = (t) => {
  t = String(t || "");
  if (!/skip trace/i.test(t)) return null;
  const q = t.match(/remaining\s+([\d,]+)\s+skip/i);
  return { conCreditos: /Use Skip Trace Credits/i.test(t), quedan: q ? parseInt(q[1].replace(/,/g, ""), 10) : null, dinero: /\$\s*[\d,]*\.?\d*[1-9]/.test(t.replace(/\$\s*0+(\.0+)?(?![\d.,])/g, "")) };
};
const ordenNombre = (n) => { // Propwire pone "Apellido Nombre"; para Lofty va "Nombre Apellido"
  const s = String(n || "").replace(/\s+/g, " ").trim().replace(/\s+(Trs?|Tte|Ttee|Et Al|Etal|Jr Tr)\.?$/i, "");
  if (!s || RE_EMPRESA.test(s) || /\b(TRUST|ESTATE|TRUSTEE|REVOCABLE|LIVING|FAMILY)\b/i.test(s) || /,/.test(s)) return s;
  const p = s.split(" ");
  if (p.length < 2 || p.length > 3) return s;
  const t = [...p.slice(1), p[0]].join(" ");
  return t === t.toUpperCase() ? t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : t;
};
// Ritmo: Wibi va despacio (pausas largas entre propiedades y un máximo por hora) y, si Propwire lo bloquea, se detiene un buen rato.
const PAUSA_BLOQUEO = 3 * 60 * 60 * 1000; // 3 horas sin tocar Propwire después de un bloqueo
const POR_HORA = 12;
async function pausaHasta() { const { wbPausa = 0 } = await chrome.storage.local.get("wbPausa"); return wbPausa > Date.now() ? wbPausa : 0; }
async function enUltimaHora() { const { wbHora = [] } = await chrome.storage.local.get("wbHora"); return wbHora.filter((t) => t > Date.now() - 3600e3); }
async function marcarHora() { const h = await enUltimaHora(); h.push(Date.now()); await chrome.storage.local.set({ wbHora: h }); }
async function esperar(ms, texto) { // espera que se puede cortar con "Parar"
  const fin = Date.now() + ms;
  while (Date.now() < fin && !parar) { ver(`${texto} (${Math.ceil((fin - Date.now()) / 1000)} s)…`); await sleep(Math.min(1000, fin - Date.now())); }
}
let huboBloqueo = false;
async function bloqueado(key, dir) {
  huboBloqueo = true;
  const hasta = Date.now() + PAUSA_BLOQUEO;
  await chrome.storage.local.set({ wbPausa: hasta, [K("wbAutoAntes")]: !!cfg.auto, [K("wbConfig")]: { ...cfg, auto: false } });
  cfg.auto = false; $("auto").checked = false;
  if (key) await trabajo(key, { estado: "error", detalle: "Propwire bloqueó el acceso" });
  decir(`Propwire bloqueó el acceso temporalmente (dice que vio movimiento de robot). Wibi se detuvo y no va a tocar Propwire hasta las ${new Date(hasta).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}; a esa hora sigue solo. Mientras, en Chequi usa “Mandar a: Veri”.`, "error");
}
async function usoHoy() { const { wbUso = {} } = await chrome.storage.local.get("wbUso"); return wbUso.dia === hoy() ? wbUso.n || 0 : 0; }
async function sumarUso() { const n = (await usoHoy()) + 1; await chrome.storage.local.set({ wbUso: { dia: hoy(), n } }); return n; }
async function trabajo(key, datos) {
  const { [K("wbTrabajos")]: wbTrabajos = {} } = await chrome.storage.local.get(K("wbTrabajos"));
  wbTrabajos[key] = { ...(wbTrabajos[key] || {}), ...datos, t: Date.now() };
  const ks = Object.keys(wbTrabajos); if (ks.length > 600) ks.sort((a, b) => wbTrabajos[a].t - wbTrabajos[b].t).slice(0, ks.length - 600).forEach((k) => delete wbTrabajos[k]);
  await chrome.storage.local.set({ [K("wbTrabajos")]: wbTrabajos });
}
async function alLote(a, nombre, phones, url, emails = []) {
  const { [K("lote_wb")]: lote_wb = [] } = await chrome.storage.local.get(K("lote_wb"));
  const dir = lineaDir(a), clave = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const ya = lote_wb.find((x) => clave(x.address) === clave(dir));
  if (ya) { for (const p of phones) if (!ya.phones.some((q) => q.num === p.num)) ya.phones.push(p); ya.emails = [...new Set([...(ya.emails || []), ...emails])]; if (!ya.owner) ya.owner = nombre; }
  else lote_wb.push({ owner: nombre, phones, emails, address: dir, url, fuente: "propwire" });
  await chrome.storage.local.set({ [K("lote_wb")]: lote_wb });
}

// Lo que le toca a Wibi: aprobado por Chequi, de la zona, mandado a Wibi y sin buscar todavía
async function porHacer() {
  const st = await chrome.storage.local.get(["addresses", "zone", "chActivo", "ch3Config", "loftyKey", K("chDestino")]);
  const { addresses = {}, zone = "", [K("chDestino")]: chDestino } = st;
  const { chActivo, loftyKey } = filtroDe(LINEA, st); // Fase 1: Wibi 3 usa el interruptor de Chequi 3
  const zs = zonasDe(zone);
  return Object.entries(addresses).map(([key, a]) => ({ ...a, key }))
    .filter((a) => sirve(a) && lineaDe(a) === LINEA && enZona(a, zs) && paraWibi(a, chDestino) && pasaFiltro(a, { chActivo, loftyKey }) && !a.bvSearched);
}


// =====================================================================
// MODO LISTA: en vez de abrir propiedad por propiedad, Wibi junta una
// tanda, la importa a Propwire como lista (CSV), le da "Skip Trace" a toda
// la lista de un jalón y lee el CSV de resultados en "My Activity".
// Mismas reglas: tope por día, sin compañías, solo con créditos (nunca
// dinero sin tu OK), ritmo humano y pausa de 3 h si Propwire bloquea.
// Los teléfonos DNC NO se quitan (decisión del jefe): pasan igual a Lofti.
// =====================================================================
const csvCampo = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const claveDom = (calle, zip) => `${String(calle || "").toUpperCase().replace(/[^A-Z0-9]/g, "")}|${String(zip || "").slice(0, 5)}`;
function leerCSV(texto) { // CSV con comillas
  const filas = []; let fila = [], campo = "", q = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (q) { if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') q = false; else campo += c; }
    else if (c === '"') q = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && texto[i + 1] === "\n") i++; fila.push(campo); campo = ""; if (fila.some((x) => x !== "")) filas.push(fila); fila = []; }
    else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); if (fila.some((x) => x !== "")) filas.push(fila); }
  const enc = filas.shift() || [];
  return filas.map((f) => Object.fromEntries(enc.map((h, i) => [h.trim(), (f[i] || "").trim()])));
}
// --- Corren DENTRO de Propwire ---
// Asistente "Import a List": sube el CSV, columnas, lista nueva, "solo importar" (sin skip trace aquí) y completar
async function pwImportar(csv, nombre, archivo) {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const humano = () => esp(800 + Math.random() * 1400);
  const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const txt = () => document.body ? document.body.innerText : "";
  if (/acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)|temporarily (blocked|restricted)|unusual (traffic|activity)/i.test(txt())) return { bloqueo: true };
  const boton = (re, dentro) => [...(dentro || document).querySelectorAll("button, a[role=button]")].find((b) => visible(b) && !b.disabled && re.test(b.innerText.replace(/\s+/g, " ").trim()));
  const esperaTxt = async (re, n = 40) => { for (let i = 0; i < n; i++) { if (re.test(txt())) return true; await esp(400); } return false; };
  let inp = null;
  for (let i = 0; i < 40 && !inp; i++) { inp = document.querySelector('input[type=file]'); if (!inp) await esp(300); }
  if (!inp) return { error: "no encontré dónde subir el CSV (¿sesión de Propwire abierta?)" };
  const dt = new DataTransfer(); dt.items.add(new File([csv], archivo, { type: "text/csv" }));
  inp.files = dt.files; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true }));
  await humano();
  let b = null; for (let i = 0; i < 20 && !b; i++) { b = boton(/^Continue$/i); if (!b) await esp(300); }
  if (!b) return { error: "Propwire no aceptó el CSV" };
  b.click();
  if (!(await esperaTxt(/Match Fields/i))) return { error: "no salió el paso de columnas" };
  await humano();
  const lbl = [...document.querySelectorAll("label")].find((l) => /first row of my file contains column headers/i.test(l.innerText));
  const cb = lbl && (lbl.control || lbl.querySelector("input[type=checkbox]") || (lbl.parentElement && lbl.parentElement.querySelector("input[type=checkbox]")));
  if (!cb) return { error: "no encontré la casilla de encabezados" };
  if (!cb.checked) { cb.click(); await esp(400); }
  if (!cb.checked) return { error: "no pude marcar la casilla de encabezados" };
  await humano();
  b = boton(/^Continue$/i); if (!b) return { error: "no encontré Continue en columnas" };
  b.click();
  if (!(await esperaTxt(/Select Destination/i))) return { error: "no salió el paso de destino" };
  await humano();
  const nom = [...document.querySelectorAll("input")].find((e) => visible(e) && /list name/i.test(e.placeholder || ""));
  if (!nom) return { error: "no encontré el nombre de la lista nueva" };
  nom.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(nom, nombre);
  nom.dispatchEvent(new Event("input", { bubbles: true })); nom.dispatchEvent(new Event("change", { bubbles: true }));
  await humano();
  let cont = null;
  for (let x = nom; x && x !== document.body && !cont; x = x.parentElement) cont = boton(/^Continue$/i, x);
  if (!cont) return { error: "no encontré Continue de la lista nueva" };
  for (let i = 0; i < 10 && cont.disabled; i++) await esp(300);
  cont.click();
  if (!(await esperaTxt(/Would You Like to Skip Trace This List/i))) return { error: "no salió la pregunta de skip trace" };
  await humano();
  b = boton(/^No, Just Import It$/i); if (!b) return { error: "no encontré “No, Just Import It”" };
  b.click();
  let si = null; for (let i = 0; i < 20 && !si; i++) { si = boton(/^Yes, Import Only$/i); if (!si) await esp(300); }
  if (si) { await humano(); si.click(); }
  if (!(await esperaTxt(/Review & Complete/i))) return { error: "no salió el resumen de la importación" };
  const n = parseInt((txt().match(/Properties:\s*(\d+)/i) || [])[1] || "0", 10);
  if (!/Skip Trace:\s*No/i.test(txt())) return { error: "el resumen no dice “Skip Trace: No”; no completo la importación" };
  await humano();
  b = boton(/^Complete Import$/i); if (!b) return { error: "no encontré “Complete Import”" };
  b.click();
  await esperaTxt(/Import is Underway|Go To My Activity|Return to Property Lists/i, 50);
  return { ok: true, n };
}
// Busca la lista por nombre en Property Lists y regresa su link y cuántas propiedades tiene
function pwBuscarLista(nombre) {
  const filas = [...document.querySelectorAll("a[href*='/property-lists/']")].filter((a) => a.innerText.trim() === nombre);
  if (!filas.length) return { no: true };
  const a = filas[0]; let fila = a; for (let i = 0; i < 6 && fila.parentElement && !/\d+\s+\d{1,2}\/\d{1,2}\/\d{4}/.test(fila.innerText); i++) fila = fila.parentElement;
  const n = parseInt((fila.innerText.replace(nombre, "").match(/(\d+)\s+\d{1,2}\/\d{1,2}\/\d{4}/) || [])[1] || "0", 10);
  return { href: a.href, n };
}
// En la lista: "Skip Trace" → regresa la ventana de confirmación SIN aceptarla
async function pwListaSkip() {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  if (/acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)/i.test(document.body.innerText)) return { bloqueo: true };
  // En ventanas anchas es un botón “Skip Trace”; en angostas (<1280px) está en el menú ⋮ como “Skip Trace All”
  const buscar = () => [...document.querySelectorAll("button")].find((x) => visible(x) && /^Skip Trace( All)?$/i.test(x.innerText.trim()));
  let b = null;
  for (let i = 0; i < 40 && !b; i++) {
    b = buscar();
    if (!b && i % 5 === 4) { // abrir el menú ⋮ del encabezado de la lista
      const h = document.querySelector("h1.page-heading"), hdr = h && (h.closest(".mb-6") || h.parentElement.parentElement);
      const k = hdr && [...hdr.querySelectorAll("svg")].filter(visible).map((v) => v.closest("button") || v.parentElement).find((p) => !p.closest("li") && /^\s*((Open|Close) Dropdown)?\s*$/i.test(p.innerText || ""));
      if (k) { k.click(); await esp(700); b = buscar(); }
    }
    if (!b) await esp(400);
  }
  if (!b) return { error: "no encontré el botón Skip Trace de la lista" };
  await esp(900 + Math.random() * 1200);
  b.click();
  for (let i = 0; i < 40; i++) {
    await esp(400);
    const tit = [...document.querySelectorAll("h1, h2, h3, h4, div, span, p")].find((e) => !e.children.length && visible(e) && /^\s*Please Confirm\s*$/i.test(e.textContent));
    if (tit) {
      let caja = tit; while (caja.parentElement && !/New Credit Balance|Continue/i.test(caja.innerText)) caja = caja.parentElement;
      await esp(600);
      return { dialogo: { texto: caja.innerText.replace(/\s+/g, " ").trim().slice(0, 500), botones: [...caja.querySelectorAll("button")].filter(visible).map((x) => x.innerText.replace(/\s+/g, " ").trim()).filter(Boolean) },
        pedidos: parseInt((caja.innerText.match(/Total Skip Trace Requests\s*(\d+)/i) || [])[1] || "0", 10) };
    }
  }
  return { error: "no salió la confirmación del skip trace" };
}
// Acepta la confirmación y, en "What Data Would You Like to Download?", baja Propiedad + Skip Trace Results
async function pwListaConfirmar(etiqueta) {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const b = [...document.querySelectorAll("button")].find((x) => visible(x) && x.innerText.replace(/\s+/g, " ").trim() === etiqueta);
  if (!b) return { error: `no encontré “${etiqueta}”` };
  b.click();
  let d = null;
  for (let i = 0; i < 60 && !d; i++) {
    await esp(500);
    if (/insufficient|add funds|not enough|top up/i.test(document.body.innerText)) return { sinSaldo: true };
    d = [...document.querySelectorAll("button")].find((x) => visible(x) && /^Download \d+ Propert(y|ies)$/i.test(x.innerText.trim()));
  }
  if (!d) return { error: "no salió la ventana para bajar los resultados" };
  const lbl = [...document.querySelectorAll("label")].find((l) => /^Skip Trace Results$/i.test(l.innerText.trim()));
  const cb = lbl && (lbl.control || lbl.parentElement.querySelector("input[type=checkbox]"));
  if (cb && !cb.checked) { cb.click(); await esp(300); }
  await esp(700 + Math.random() * 900);
  d.click();
  for (let i = 0; i < 30; i++) { await esp(400); const x = [...document.querySelectorAll("button")].find((y) => visible(y) && /^Dismiss$/i.test(y.innerText.trim())); if (x) { x.click(); break; } }
  return { ok: true };
}
// En "My Activity": ¿ya está listo el CSV de "Batch Skip Trace N Properties" de hoy? Si sí, lo lee aquí mismo
async function pwLeerResultado(n, yaVistos) {
  const t = document.body.innerText;
  if (/acceso est[aá] restringido|access (is|has been) (temporarily )?(restricted|denied|blocked)/i.test(t)) return { bloqueo: true };
  const re = new RegExp(`^Batch Skip Trace ${n} Propert(y|ies)`, "i");
  const links = [...document.querySelectorAll("a")].filter((a) => /^Download$/i.test(a.innerText.trim()));
  for (const a of links) {
    let caja = a; for (let i = 0; i < 6 && caja.parentElement && !re.test(caja.innerText.trim()); i++) caja = caja.parentElement;
    if (!re.test(caja.innerText.trim())) continue;
    if (yaVistos.includes(a.href)) continue; // uno viejo (ya leído o de otra lista): seguir buscando
    try {
      const r = await fetch(a.href, { credentials: "include" });
      const csv = await r.text();
      if (!/^Address,City/i.test(csv)) return { reintentar: true, status: r.status, bloqueoDescarga: r.status === 403 || /datadome|captcha/i.test(csv) };
      return { csv, href: a.href };
    } catch (e) { return { reintentar: true }; }
  }
  return { noListo: true };
}
async function irA(tab, url) {
  await chrome.tabs.update(tab, { url }); await sleep(800);
  for (let i = 0; i < 60; i++) { const x = await chrome.tabs.get(tab).catch(() => null); if (!x || x.status === "complete") break; await sleep(400); }
  await sleep(1500 + Math.random() * 1500);
}
const turno = () => turnoPropwire({ aviso: (ms, lleno) => ver(lleno ? `Turno de Propwire: entre todos los agentes ya van 150 páginas esta hora; espero ${Math.ceil(ms / 60000)} min…` : `Esperando turno de Propwire (otro agente la está usando)… ${Math.ceil(ms / 1000)} s`), parar: () => parar });

// Registro de las listas que Wibi crea en Propwire (lo usa Carpi para organizarlas y borrarlas)
async function registrar(nombre, datos) {
  const { wbListas = {} } = await chrome.storage.local.get("wbListas");
  wbListas[nombre] = { ...(wbListas[nombre] || { creada: Date.now(), linea: LINEA || "" }), ...datos, t: Date.now() };
  const ks = Object.keys(wbListas); if (ks.length > 300) ks.sort((a, b) => wbListas[a].t - wbListas[b].t).slice(0, ks.length - 300).forEach((k) => delete wbListas[k]);
  await chrome.storage.local.set({ wbListas });
}
// Plan B cuando Propwire bloquea la descarga del archivo (DataDome 403): las propiedades YA tienen el skip trace pagado,
// así que en la pestaña Owner de cada una se ven los teléfonos. Se leen ficha por ficha (no se cobra nada otra vez).
async function leerPorFicha(tab, tanda) {
  const filas = [];
  for (const [k, a] of tanda.entries()) {
    if (parar) break;
    if (k) await esperar(6000 + Math.random() * 6000, `Leyendo los teléfonos ficha por ficha (${k + 1} de ${tanda.length}); ya están pagados`);
    if (!(await turno())) break;
    await irA(tab, "https://propwire.com/search");
    const r = await corre(tab, pwAbrir, [a.street, a.city, a.zip || ""]).catch((e) => ({ error: e.message }));
    if ((r && r.bloqueo) || (await corre(tab, pwBloqueo).catch(() => false))) return { bloqueo: true, filas };
    if (!r || r.error) continue; // no vino: queda como “no vino en el archivo”
    await marcarHora();
    let o = await corre(tab, pwLeer).catch(() => null);
    if (o && !o.nombre && !o.tels.length) { await sleep(2500); o = await corre(tab, pwLeer).catch(() => null); }
    if (!o) continue;
    if (o.bloqueo) return { bloqueo: true, filas };
    const f = { "Address": a.street, "Zip": a.zip || "", "Name 1": o.nombre || "", "Owner Type": "", "Litigator": "", "Email": (o.emails || []).join(";"), "Property URL": o.url || "" };
    o.tels.filter((t) => !t.tapado).slice(0, 5).forEach((t, i) => { f[`Phone ${i + 1}`] = t.num; f[`Phone ${i + 1} Type`] = t.type; f[`Do Not ${i + 1} Call`] = t.dnc ? "DNC" : ""; });
    filas.push(f);
  }
  return { filas };
}
// Reparte las filas (del archivo de Propwire o leídas ficha por ficha) → owner, teléfonos y emails a Lofti
async function repartirFilas(filas, tanda, nombre) {
  let hechos = 0;
  const porDom = new Map(filas.map((f) => [claveDom(f["Address"], f["Zip"]), f]));
  for (const a of tanda) {
    const f = porDom.get(claveDom(a.street, a.zip));
    const dir = lineaDir(a);
    if (!f) { await trabajo(a.key, { estado: "sin datos", detalle: "no vino en el archivo de Propwire" }); await domicilios("marcar", { key: a.key, bvSearched: true }); continue; }
    const nombreOwner = f["Name 1"] || [f["Owner 1 First Name"], f["Owner 1 Last Name"]].filter(Boolean).join(" ");
    const nombreBonito = nombreOwner === nombreOwner.toUpperCase() ? nombreOwner.toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase()) : nombreOwner;
    const tipo = f["Owner Type"] || "";
    if (cfg.sinEmpresas && (/^(COMPANY|CORPORATE|BUSINESS|GOVERNMENT)/i.test(tipo) || RE_EMPRESA.test(nombreOwner))) {
      await trabajo(a.key, { estado: "empresa", owner: nombreBonito, detalle: "owner es compañía" }); await domicilios("marcar", { key: a.key, bvSearched: true }); continue;
    }
    if (f["Litigator"] && !/^(no|false|0)$/i.test(f["Litigator"])) {
      await trabajo(a.key, { estado: "sin datos", owner: nombreBonito, detalle: "Propwire lo marca como litigator: no se manda" }); await domicilios("marcar", { key: a.key, bvSearched: true });
      svLog && svLog(`↷ ${dir}: el owner está marcado como litigator; no se manda a Lofti.`); continue;
    }
    const phones = [];
    for (let i = 1; i <= 5; i++) {
      const num = String(f[`Phone ${i}`] || "").replace(/\D/g, "").slice(-10);
      if (num.length !== 10) continue;
      const dnc = /dnc|yes|true|^1$/i.test(f[`Do Not ${i} Call`] || ""); // el DNC se ignora: el número pasa igual (solo se anota)
      if (phones.some((p) => p.num === num)) continue;
      const ty = f[`Phone ${i} Type`] || "Phone";
      phones.push({ num, type: /land/i.test(ty) ? "Landline" : ty, ...(dnc ? { dnc: true } : {}) });
    }
    const emails = String(f["Email"] || "").split(/[;,\s]+/).map((e) => e.toLowerCase()).filter((e) => /@/.test(e));
    if (!phones.length) {
      await trabajo(a.key, { estado: "sin datos", owner: nombreBonito, detalle: "Propwire no dio teléfonos" });
      await domicilios("marcar", { key: a.key, bvSearched: true }); continue;
    }
    await alLote(a, nombreBonito, phones, f["Property URL"] || "", emails);
    await domicilios("marcar", { key: a.key, bvSearched: true });
    await trabajo(a.key, { estado: "listo", owner: nombreBonito, tels: phones.length, detalle: `lista “${nombre}”` });
    hechos++;
  }
  return hechos;
}
// Listas con el skip trace YA PAGADO que no se alcanzaron a leer: se leen antes de pagar otra tanda (nunca se vuelven a cobrar)
async function leerPagadas() {
  const { wbListas = {}, addresses = {} } = await chrome.storage.local.get(["wbListas", "addresses"]);
  const pend = Object.entries(wbListas).filter(([, r]) => r.estado === "skip" && !r.borrada && (r.linea || "") === (LINEA || "") && (r.keys || []).length && Date.now() - (r.t || 0) > 3 * 60e3);
  let total = 0;
  for (const [nombre, r] of pend) {
    if (parar) break;
    const tanda = r.keys.map((k) => addresses[k] ? { ...addresses[k], key: k } : null).filter(Boolean);
    if (!tanda.length) { await registrar(nombre, { estado: "leida", conTels: 0, motivo: "sin domicilios guardados" }); continue; }
    decir(`La lista “${nombre}” ya tiene el skip trace pagado y no se leyó: leo sus ${tanda.length} propiedades ficha por ficha (no se cobra otra vez).`);
    for (const a of tanda) await trabajo(a.key, { direccion: lineaDir(a), estado: "buscando", detalle: `leyendo la lista pagada “${nombre}”` });
    const tab = await pestanaPW(false);
    const volver = await alFrente(tab);
    try {
      const lf = await leerPorFicha(tab, tanda);
      if (lf.bloqueo) { await bloqueado(null, nombre); return { bloqueo: true }; }
      if (parar) break;
      const h = await repartirFilas(lf.filas, tanda, nombre);
      total += h;
      await registrar(nombre, { estado: "leida", conTels: h, archivo: "fichas" });
      decir(`Lista pagada “${nombre}”: ${h} con teléfonos van a Lofti.`);
    } finally { await volver(); }
  }
  return { hechos: total };
}
async function trabajarLista(lista) {
  let hechos = 0;
  const usados = await usoHoy();
  const quedanHoy = cfg.tope ? Math.max(0, cfg.tope - usados) : Infinity;
  if (!quedanHoy) { decir(`Llegué al tope de hoy: ${usados} skip trace(s) en Propwire. Mañana sigo (o sube el tope).`); return 0; }
  const { wbCreditos } = await chrome.storage.local.get("wbCreditos");
  const creditosConocidos = wbCreditos && wbCreditos.quedan != null ? wbCreditos.quedan : Infinity;
  let tanda = lista.slice(0, Math.min(cfg.tanda || 25, quedanHoy, creditosConocidos));
  if (!tanda.length) { decir("Se acabaron tus créditos de skip trace de Propwire. Wibi se detiene (no paga con dinero).", "error"); return 0; }
  const ahora = new Date();
  let nombre = `${LINEA ? "Wibi 3" : "Wibi"} ${hoy()} ${String(ahora.getHours()).padStart(2, "0")}${String(ahora.getMinutes()).padStart(2, "0")}`;
  // ¿Ya hay una lista mía en Propwire que se quedó sin skip trace con (casi) los mismos domicilios? Se reusa en vez de crear otra
  const { wbListas: regs = {} } = await chrome.storage.local.get("wbListas");
  const pendientes = new Map(lista.map((a) => [a.key, a]));
  const previa = Object.entries(regs).find(([, r]) => r.estado === "sinSkip" && !r.skips && !r.borrada && r.href && (r.linea || "") === (LINEA || "") && (r.keys || []).length &&
    r.keys.filter((k) => pendientes.has(k)).length >= Math.ceil(r.keys.length * 0.8) && (r.n || r.keys.length) <= Math.min(quedanHoy, creditosConocidos));
  let li = null;
  if (previa) {
    nombre = previa[0];
    tanda = previa[1].keys.filter((k) => pendientes.has(k)).map((k) => pendientes.get(k));
    li = { href: previa[1].href, n: previa[1].n || previa[1].keys.length };
    svLog && svLog(`Reuso la lista “${nombre}” que ya estaba en Propwire sin skip trace (${tanda.length} domicilios); no creo otra.`);
  } else { let i = 2; const base = nombre; while (regs[nombre]) nombre = `${base}-${i++}`; }
  const csv = "Address,City,State,Zip\n" + tanda.map((a) => [a.street, a.city, "CA", (a.zip || "").slice(0, 5)].map(csvCampo).join(",")).join("\n") + "\n";
  for (const a of tanda) await trabajo(a.key, { direccion: lineaDir(a), estado: "buscando", detalle: `en la lista “${nombre}”` });
  window.robot && robot.set("trabajando", `Lista de ${tanda.length} en Propwire…`);
  const tab = await pestanaPW(false);
  const volver = await alFrente(tab);
  let quedarse = false;
  let pagado = false; // una vez cobrado el skip trace, la lista NUNCA vuelve a “sin skip trace” (no se vuelve a cobrar)
  const regresarTanda = async (detalle) => { for (const a of tanda) await trabajo(a.key, { estado: pagado ? "buscando" : "error", detalle: pagado ? `pagado; falta leer (${detalle})` : detalle }); await registrar(nombre, pagado ? { estado: "skip", motivo: detalle } : { estado: "sinSkip", motivo: detalle }); };
  try {
    if (!li) { // 1) y 2): importar la tanda como lista nueva y esperar a que aparezca
    // 1) Importar la tanda como lista nueva (sin skip trace todavía)
    if (!(await turno())) return 0;
    ver(`Importando a Propwire la lista “${nombre}” con ${tanda.length} domicilio(s)…`);
    await irA(tab, "https://propwire.com/property-lists/import");
    await marcarHora();
    const im = await corre(tab, pwImportar, [csv, nombre, nombre.replace(/[^\w-]+/g, "_") + ".csv"]).catch((e) => ({ error: e.message }));
    if ((im && im.bloqueo) || ((!im || im.error) && (await corre(tab, pwBloqueo).catch(() => false)))) { await bloqueado(null, nombre); quedarse = true; await regresarTanda("Propwire bloqueó el acceso"); return 0; }
    if (!im || im.error) {
      // Si Propwire cambió el asistente o no deja importar, Wibi sigue "una por una" con esta misma tanda (nada se cobró)
      await registrar(nombre, { estado: "sinSkip", motivo: (im && im.error) || "falló la importación" });
      svLog && svLog(`No pude importar la lista (${(im && im.error) || "falló"}). Sigo una por una con estos ${tanda.length} domicilio(s).`, "error");
      for (const a of tanda) await trabajo(a.key, { estado: "buscando", detalle: "en fila (una por una)" });
      return { fallback: true };
    }
    await registrar(nombre, { estado: "importada", n: im.n || tanda.length, zona: [...new Set(tanda.map((a) => a.city))].join(", "), keys: tanda.map((a) => a.key) });
    if (im.n && im.n !== tanda.length) svLog && svLog(`Ojo: Propwire leyó ${im.n} de ${tanda.length} domicilios del CSV.`);
    // 2) Esperar a que la lista aparezca con sus propiedades
    for (let i = 0; i < 12 && !parar; i++) {
      await esperar(i ? 15000 + Math.random() * 10000 : 6000, "Esperando a que Propwire termine de importar la lista");
      if (!(await turno())) return 0;
      await irA(tab, "https://propwire.com/property-lists");
      if (await corre(tab, pwBloqueo).catch(() => false)) { await bloqueado(null, nombre); quedarse = true; await regresarTanda("Propwire bloqueó el acceso"); return 0; }
      li = await corre(tab, pwBuscarLista, [nombre]).catch(() => null);
      if (li && li.href && li.n > 0) break;
    }
    if (li && li.href) await registrar(nombre, { href: li.href, n: li.n });
    if (!li || !li.href) { decir(`Propwire no terminó de importar la lista “${nombre}”. Revísala en Property Lists.`, "error"); await regresarTanda("la lista no se importó"); return 0; }
    }
    // 3) Skip Trace a toda la lista: misma regla de cobro (solo créditos, nunca dinero sin tu OK)
    await esperar(4000 + Math.random() * 4000, "Pausa antes del skip trace (ritmo humano)");
    if (!(await turno())) return 0;
    await irA(tab, li.href);
    const s = await corre(tab, pwListaSkip).catch((e) => ({ error: e.message }));
    if (s && s.bloqueo) { await bloqueado(null, nombre); quedarse = true; return 0; }
    if (!s || !s.dialogo) { decir(`Lista “${nombre}”: ${(s && s.error) || "no salió la confirmación del skip trace"}.`, "error"); await regresarTanda((s && s.error) || "falló"); quedarse = true; return 0; }
    const cr = creditos(s.dialogo.texto);
    if (cr && cr.quedan !== null && cr.quedan < (s.pedidos || li.n)) {
      decir(`No alcanzan tus créditos de skip trace (${cr.quedan}) para la lista de ${s.pedidos || li.n}. Wibi no paga con dinero: se detiene. La lista “${nombre}” se queda en Propwire sin skip trace.`, "error");
      await regresarTanda("sin créditos suficientes"); quedarse = true; return 0;
    }
    let { wbAprobado } = await chrome.storage.local.get("wbAprobado");
    const cont = s.dialogo.botones.find((b) => /^continue$/i.test(b));
    if (cr && cr.conCreditos && !cr.dinero && cont) wbAprobado = { firma: firma(s.dialogo.texto), boton: cont }; // solo créditos, sin dinero: aprobado
    if (!wbAprobado || wbAprobado.firma !== firma(s.dialogo.texto) || !s.dialogo.botones.includes(wbAprobado.boton)) {
      await chrome.storage.local.set({ wbPregunta: { ...s.dialogo, key: tanda[0].key, direccion: `lista “${nombre}” (${s.pedidos || li.n})`, t: Date.now() } });
      await registrar(nombre, { estado: "sinSkip", motivo: "esperando tu OK para el cobro" });
      for (const a of tanda) await trabajo(a.key, { estado: "esperando ok", detalle: "Propwire pide confirmar el cobro de la lista" });
      decir(`Propwire pide confirmar el cobro del skip trace de la lista: “${s.dialogo.texto.slice(0, 160)}”. Revísalo en la pestaña Wibi y dale tu OK.`, "error");
      quedarse = true; return 0;
    }
    ver(`Skip trace de la lista “${nombre}” (${s.pedidos || li.n} propiedades)…`);
    if (!(cr && cr.conCreditos && !cr.dinero)) await chrome.storage.local.remove("wbAprobado"); // Fase 1: un OK de cobro en dinero sirve UNA sola vez
    const c = await corre(tab, pwListaConfirmar, [wbAprobado.boton]).catch((e) => ({ error: e.message }));
    if (c && c.sinSaldo) { decir("Propwire dice que no hay saldo para el skip trace. Wibi se detiene.", "error"); await regresarTanda("sin saldo"); quedarse = true; return 0; }
    if (!c || c.error) { decir(`Lista “${nombre}”: ${(c && c.error) || "falló el skip trace"}. Revisa la lista en Propwire.`, "error"); await regresarTanda((c && c.error) || "falló"); quedarse = true; return 0; }
    const pedidos = s.pedidos || li.n;
    pagado = true;
    await registrar(nombre, { estado: "skip", skips: pedidos });
    const { wbUso = {} } = await chrome.storage.local.get("wbUso");
    await chrome.storage.local.set({ wbUso: { dia: hoy(), n: (wbUso.dia === hoy() ? wbUso.n || 0 : 0) + pedidos } });
    if (cr && cr.quedan !== null) await chrome.storage.local.set({ wbCreditos: { quedan: cr.quedan - pedidos, t: Date.now() } });
    // 4) Esperar el CSV en "My Activity" y leerlo ahí mismo
    const { wbBajados = [] } = await chrome.storage.local.get("wbBajados");
    let res = null, bloqDesc = 0; const ajenos = [];
    for (let i = 0; i < 14 && !parar; i++) {
      await esperar(i ? 20000 + Math.random() * 15000 : 8000, "Esperando el archivo de resultados en My Activity");
      if (!(await turno())) break;
      await irA(tab, "https://propwire.com/activity");
      res = await corre(tab, pwLeerResultado, [pedidos, [...wbBajados, ...ajenos]]).catch(() => null);
      if (res && res.bloqueo) { await bloqueado(null, nombre); quedarse = true; return 0; }
      if (res && res.bloqueoDescarga && ++bloqDesc >= 3) { res = null; break; } // Propwire bloquea la descarga automática (3 veces): plan B
      if (res && res.csv) { // que sea el de ESTA lista: la mayoría de sus domicilios deben venir en el archivo
        const ds = new Set(leerCSV(res.csv).map((f) => claveDom(f["Address"], f["Zip"])));
        if (tanda.filter((a) => ds.has(claveDom(a.street, a.zip))).length * 2 >= tanda.length) break;
        ajenos.push(res.href); res = null; // era otro archivo con el mismo número de propiedades
      }
    }
    let filas;
    if (res && res.csv) {
      await chrome.storage.local.set({ wbBajados: [...wbBajados, res.href].slice(-50) });
      filas = leerCSV(res.csv);
    } else {
      if (parar) { await regresarTanda("me detuviste antes de leer los resultados"); return 0; }
      decir(`Propwire no deja bajar el archivo de resultados de la lista “${nombre}” (bloqueo anti-robots). Leo los teléfonos ficha por ficha: ya están pagados, no se cobra otra vez.`, "error");
      const lf = await leerPorFicha(tab, tanda);
      if (lf.bloqueo) { await bloqueado(null, nombre); quedarse = true; await regresarTanda("Propwire bloqueó el acceso al leer las fichas"); return 0; }
      if (parar || !lf.filas.length) { await regresarTanda(parar ? "me detuviste mientras leía las fichas" : "no pude leer ninguna ficha"); quedarse = true; return 0; }
      filas = lf.filas; res = { href: "fichas" };
    }
    // 5) Repartir: owner, teléfonos (los DNC también) y emails → Lofti
    hechos = await repartirFilas(filas, tanda, nombre);
    await registrar(nombre, { estado: "leida", conTels: hechos, archivo: res.href });
    decir(`Lista “${nombre}”: ${pedidos} skip trace(s) de un jalón; ${hechos} con teléfonos van a Lofti (los DNC también). Hoy van ${await usoHoy()} de ${cfg.tope || "∞"}.`);
    return { hechos, procesadas: tanda.length };
  } catch (e) {
    decir(`Error en la lista de Propwire: ${e.message}`, "error");
    return hechos;
  } finally { if (!quedarse) await volver(); }
}

// ---------- Ciclo ----------
const fallos = new Map();
let segundoClic = 0;
// Fase 1: candado para que dos disparos (timer, cambio de storage, botón, Capi) no arranquen dos vueltas a la vez
// (antes había 4 await entre la revisión de "corriendo" y el momento en que se prendía)
let entrando = false;
async function trabajar(aMano) {
  if (corriendo || entrando) return;
  entrando = true;
  try {
    const hecho = navigator.locks ? await navigator.locks.request("wibi-trabajar" + (LINEA || ""), { ifAvailable: true }, async (l) => (l ? (await trabajarUnaVez(aMano), true) : false)) : (await trabajarUnaVez(aMano), true);
    if (!hecho && aMano) ver("Wibi ya está trabajando en otra pestaña.");
  } finally { entrando = false; }
}
async function trabajarUnaVez(aMano) {
  if (corriendo) return;
  guardarCfg();
  const { wbPregunta } = await chrome.storage.local.get("wbPregunta");
  if (wbPregunta) { ver("Esperando tu OK para el cobro de Propwire (arriba)."); return; }
  const pz = await pausaHasta();
  if (pz) {
    if (!aMano) return;
    const hora = new Date(pz).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (Date.now() - segundoClic > 15000) { // (los avisos de "confirmar" no salen dentro del panel: se confirma con un 2º clic)
      segundoClic = Date.now();
      ver(`En pausa hasta las ${hora} porque Propwire bloqueó el acceso. Lo recomendable es esperar. Si de todos modos quieres seguir, dale otra vez a “Hacer skip trace” (en los próximos 15 s).`);
      return;
    }
    segundoClic = 0;
    await chrome.storage.local.set({ wbPausa: 0, [K("wbAutoAntes")]: null });
  }
  let lista = await porHacer();
  const { wbListas: _wl = {} } = await chrome.storage.local.get("wbListas");
  const hayPagadas = cfg.modo !== "una" && Object.values(_wl).some((r) => r.estado === "skip" && !r.borrada && (r.linea || "") === (LINEA || "") && (r.keys || []).length);
  if (!lista.length && !hayPagadas) { if (aMano) ver(await sinTrabajo()); return; }
  if (!aMano && !cfg.auto) return;
  corriendo = true; parar = false; huboBloqueo = false; $("run").disabled = true;
  let hechos = 0, hechosLista = 0;
  try {
    if (cfg.modo !== "una") { // modo lista: una tanda por vuelta
      if (cfg.sinEmpresas) { // las que Propi ya sabe que son de compañía no se gastan
        for (const a of lista.filter((x) => x.empresa)) { await trabajo(a.key, { direccion: lineaDir(a), estado: "empresa", detalle: "owner es compañía: no gasté skip trace" }); await domicilios("marcar", { key: a.key, bvSearched: true }); }
        lista = lista.filter((x) => !x.empresa);
      }
      const pg = await leerPagadas(); // primero lo que ya se pagó y no se leyó
      if (pg && pg.bloqueo) lista = [];
      else if (pg && pg.hechos !== undefined) { // se recalcula: lo que se acaba de leer ya no está pendiente
        const { wbListas: wl2 = {} } = await chrome.storage.local.get("wbListas");
        const enPagadas = new Set(Object.values(wl2).filter((r) => r.estado === "skip").flatMap((r) => r.keys || []));
        lista = (await porHacer()).filter((x) => !x.empresa && !enPagadas.has(x.key));
      }
      if (lista.length && !parar) {
        const r = await trabajarLista(lista);
        hechosLista = r && r.procesadas ? r.procesadas : 0;
        if (!(r && r.fallback)) lista = []; // si la importación no se pudo, esta vuelta sigue una por una
      }
    }
    for (const a of lista) {
      if (parar) break;
      const usados = await usoHoy();
      if (cfg.tope && usados >= cfg.tope) { decir(`Llegué al tope de hoy: ${usados} skip trace(s) en Propwire. Mañana sigo (o sube el tope).`); break; }
      if (a !== lista[0]) { await esperar(30000 + Math.random() * 45000, "Pausa entre propiedades para ir a ritmo tranquilo"); if (parar) break; }
      if ((await enUltimaHora()).length >= POR_HORA) { decir(`Ya van ${POR_HORA} propiedades en la última hora: Wibi descansa para ir a ritmo tranquilo y sigue después.`); if (cfg.auto) setTimeout(() => trabajar(false), 20 * 60 * 1000); break; }
      const dir = lineaDir(a);
      window.robot && robot.set("trabajando", `Skip trace en Propwire: ${a.street}…`);
      ver(`Buscando en Propwire: ${dir}…`);
      await trabajo(a.key, { direccion: dir, estado: "buscando", detalle: "" });
      if (!(await turnoPropwire({ aviso: (ms, lleno) => ver(lleno ? `Turno de Propwire: entre todos los agentes ya van 150 páginas esta hora; espero ${Math.ceil(ms / 60000)} min para no ser bloqueados…` : `Esperando turno de Propwire (otro agente la está usando)… ${Math.ceil(ms / 1000)} s`), parar: () => parar }))) break;
      const tab = await pestanaPW(true);
      const volver = await alFrente(tab);
      let quedarse = false;
      try {
      if (!(await turnoPropwire({ aviso: (ms, lleno) => ver(lleno ? `Turno de Propwire: entre todos los agentes ya van 150 páginas esta hora; espero ${Math.ceil(ms / 60000)} min para no ser bloqueados…` : `Esperando turno de Propwire (otro agente la está usando)… ${Math.ceil(ms / 1000)} s`), parar: () => parar }))) break;
      let r = await corre(tab, pwAbrir, [a.street, a.city, a.zip || ""]).catch((e) => ({ error: e.message }));
      if (!r || r.error) {
        if ((r && r.bloqueo) || (await corre(tab, pwBloqueo).catch(() => false))) { await bloqueado(a.key, dir); quedarse = true; break; }
        if (r && r.ayuda) { decir(`Propwire pide verificación: resuélvela en la pestaña de Propwire y dale “Hacer skip trace”.`, "error"); await trabajo(a.key, { estado: "error", detalle: r.error }); quedarse = true; /* que veas la página de Propwire */ break; }
        const n = (fallos.get(a.key) || 0) + 1; fallos.set(a.key, n);
        if ((r && r.sinDatos) || n >= 2) { await trabajo(a.key, { estado: "sin datos", detalle: (r && r.error) || "falló" }); await domicilios("marcar", { key: a.key, bvSearched: true }); }
        else await trabajo(a.key, { estado: "error", detalle: (r && r.error) || "falló" });
        decir(`${dir}: ${(r && r.error) || "falló"}.`, "error");
        continue;
      }
      await marcarHora();
      let o = await corre(tab, pwLeer);
      if (!o.nombre && !o.tels.length) { await sleep(2500); o = await corre(tab, pwLeer); }
      if (o.bloqueo) { await bloqueado(a.key, dir); quedarse = true; break; }
      await sleep(2000 + Math.random() * 3000); // como una persona que lee la ficha antes de darle Skip Trace
      const empresa = RE_EMPRESA.test(o.nombre);
      const yaDestapados = o.tels.filter((t) => !t.tapado);
      if (!yaDestapados.length && o.hayBoton) {
        if (empresa && cfg.sinEmpresas) {
          await trabajo(a.key, { estado: "empresa", owner: o.nombre, detalle: "owner es compañía: no gasté skip trace" });
          await domicilios("marcar", { key: a.key, bvSearched: true });
          svLog && svLog(`↷ ${dir}: el owner es compañía (${o.nombre}); no gasté skip trace.`);
          continue;
        }
        // Skip trace pagado
        ver(`Skip trace en Propwire: ${dir}…`);
        const s = await corre(tab, pwSkip).catch((e) => ({ error: e.message }));
        if (s && s.dialogo) {
          const cr = creditos(s.dialogo.texto);
          if (cr && cr.quedan !== null && cr.quedan <= 0) {
            await trabajo(a.key, { estado: "error", detalle: "sin créditos de skip trace" });
            decir("Se acabaron tus créditos de skip trace de Propwire este mes. Wibi se detiene (no paga con dinero). En Chequi usa “Mandar a: Veri”.", "error");
            quedarse = true; break;
          }
          let { wbAprobado } = await chrome.storage.local.get("wbAprobado");
          if (cr && cr.conCreditos && !cr.dinero && s.dialogo.botones.some((b) => /^continue$/i.test(b))) wbAprobado = { firma: firma(s.dialogo.texto), boton: s.dialogo.botones.find((b) => /^continue$/i.test(b)) }; // usa 1 crédito, sin cobrar dinero: aprobado
          if (!wbAprobado || wbAprobado.firma !== firma(s.dialogo.texto) || !s.dialogo.botones.includes(wbAprobado.boton)) {
            await chrome.storage.local.set({ wbPregunta: { ...s.dialogo, key: a.key, direccion: dir, t: Date.now() } });
            await trabajo(a.key, { estado: "esperando ok", detalle: "Propwire pide confirmar el cobro" });
            decir(`Propwire pide confirmar el cobro del skip trace: “${s.dialogo.texto.slice(0, 140)}”. Revísalo en la pestaña Wibi y dale tu OK.`, "error");
            quedarse = true; /* que veas la página de Propwire */
            break;
          }
          if (!(cr && cr.conCreditos && !cr.dinero)) await chrome.storage.local.remove("wbAprobado"); // Fase 1: un OK de cobro en dinero sirve UNA sola vez
          const c = await corre(tab, pwConfirmar, [wbAprobado.boton]).catch((e) => ({ error: e.message }));
          if (c && c.sinSaldo) { await trabajo(a.key, { estado: "error", detalle: "sin saldo en Propwire" }); decir("Propwire dice que no hay saldo para el skip trace. Recarga tu saldo de Propwire y dale “Hacer skip trace”.", "error"); break; }
          if ((!c || c.error) && (await corre(tab, pwBloqueo).catch(() => false))) { await bloqueado(a.key, dir); quedarse = true; break; }
          if (!c || c.error) { await trabajo(a.key, { estado: "error", detalle: (c && c.error) || "falló" }); decir(`${dir}: ${(c && c.error) || "falló el skip trace"}.`, "error"); await sumarUso(); continue; }
          await sumarUso();
          if (cr && cr.quedan !== null) await chrome.storage.local.set({ wbCreditos: { quedan: cr.quedan - 1, t: Date.now() } });
        } else if (s && (s.listo || s.navego)) { /* se cuenta abajo si de verdad quedó hecho */ }
        else if (await corre(tab, pwBloqueo).catch(() => false)) { await bloqueado(a.key, dir); quedarse = true; break; }
        else { await trabajo(a.key, { estado: "error", detalle: (s && s.error) || "falló" }); decir(`${dir}: ${(s && s.error) || "falló el skip trace"}.`, "error"); continue; }
        await sleep(1200);
        await corre(tab, pwIrOwner).catch(() => null); // regresar a Owner por si Propwire se brincó a la ficha
        o = await corre(tab, pwLeer);
        if (o.bloqueo) { await bloqueado(a.key, dir); quedarse = true; break; }
        if (o.tels.length && o.tels.every((t) => t.tapado)) { // a veces tarda en destapar
          await sleep(4000); await corre(tab, pwIrOwner).catch(() => null); o = await corre(tab, pwLeer);
        }
        if (!(s && s.dialogo) && o.yaHecho) await sumarUso();
      }
      const phones = o.tels.filter((t) => !t.tapado).map((t) => ({ num: t.num, type: t.type, ...(t.dnc ? { dnc: true } : {}) })); // el DNC se ignora
      const nombre = ordenNombre(o.nombre);
      if (!phones.length) {
        await trabajo(a.key, { estado: "sin datos", owner: nombre, detalle: "Propwire no dio teléfonos" });
        await domicilios("marcar", { key: a.key, bvSearched: true });
        svLog && svLog(`↷ ${dir}: Propwire no dio teléfonos.`);
        continue;
      }
      await alLote(a, nombre, phones, o.url, o.emails || []);
      await domicilios("marcar", { key: a.key, bvSearched: true });
      await trabajo(a.key, { estado: "listo", owner: nombre, tels: phones.length, detalle: "" });
      hechos++;
      svLog && svLog(`✓ ${dir}: ${nombre} · ${phones.length} teléfono(s)${(o.emails || []).length ? ` · ${o.emails.length} email(s)` : ""}. Va a Lofti.`);
      } finally { if (!quedarse) await volver(); }
    }
  } catch (e) {
    decir(`Error en el skip trace: ${e.message}`, "error");
  } finally {
    corriendo = false; $("run").disabled = false;
    if (hechos && !huboBloqueo) decir(`Listo: ${hechos} propiedad(es) con skip trace de Propwire, mandadas a Lofti. Hoy van ${await usoHoy()} de ${cfg.tope || "∞"}.`);
    pintar();
    if (cfg.auto && !parar && (hechos || hechosLista) && (await porHacer()).length) { const ms = hechosLista ? (cfg.minEntre || 10) * 60000 * (0.85 + Math.random() * 0.3) : 3000; if (hechosLista) ver(`Siguiente tanda a las ${new Date(Date.now() + ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (ritmo tranquilo: ${cfg.minEntre || 10} min entre tandas).`); setTimeout(() => trabajar(false), ms); } // entre listas, una pausa tranquila
  }
}

// ---------- Pantalla ----------
const ETQ = { buscando: ["buscando…", "#e0f2fe", "#075985"], listo: ["✓ a Lofti", "#dcfce7", "#166534"], "sin datos": ["sin datos", "#e2e8f0", "#475569"],
  empresa: ["compañía", "#e2e8f0", "#475569"], error: ["falló", "#fee2e2", "#b91c1c"], "esperando ok": ["esperando tu OK", "#fef3c7", "#92400e"] };
async function pintar() {
  const { [K("wbTrabajos")]: wbTrabajos = {}, wbPregunta, wbAprobado, [K("lote_wb")]: lote_wb = [] } = await chrome.storage.local.get([K("wbTrabajos"), "wbPregunta", "wbAprobado", K("lote_wb")]);
  const pend = (await porHacer()).length, usados = await usoHoy();
  $("nPen").textContent = pend; $("nLote").textContent = lote_wb.length; $("nHoy").textContent = cfg.tope ? `${usados}/${cfg.tope}` : usados;
  // Pregunta de cobro
  $("pregunta").hidden = !wbPregunta;
  if (wbPregunta) {
    $("pregTxt").textContent = wbPregunta.texto || "(sin texto)";
    const caja = $("pregBotones"); caja.innerHTML = "";
    for (const b of wbPregunta.botones || []) {
      if (/cancel|close|no\b|cerrar|back/i.test(b)) continue;
      const x = document.createElement("button"); x.className = "primary"; x.textContent = `Sí, aprobar con “${b}”`;
      x.onclick = async () => {
        await chrome.storage.local.set({ wbAprobado: { firma: firma(wbPregunta.texto), boton: b, t: Date.now() }, wbPregunta: null });
        svLog && svLog(`Aprobaste el cobro del skip trace de Propwire (“${b}”).`); pintar(); trabajar(true);
      };
      caja.appendChild(x);
    }
    const no = document.createElement("button"); no.textContent = "No, parar";
    no.onclick = async () => { await chrome.storage.local.set({ wbPregunta: null, [K("wbConfig")]: { ...cfg, auto: false } }); $("auto").checked = false; cfg.auto = false; ver("Detenido: no aprobaste el cobro."); pintar(); };
    caja.appendChild(no);
  }
  $("aprobado").textContent = wbAprobado ? `Cobro aprobado: “${wbAprobado.boton}” (${fecha(wbAprobado.t)}).` : "Todavía no apruebas el cobro: la primera vez te pregunto.";
  const ul = $("list"); ul.innerHTML = "";
  const ls = Object.entries(wbTrabajos).sort((a, b) => b[1].t - a[1].t).slice(0, 200);
  if (!ls.length) { ul.innerHTML = '<li class="empty">Todavía no hago ningún skip trace.</li>'; return; }
  for (const [, w] of ls) {
    const [t, bg, fg] = ETQ[w.estado] || [w.estado, "#e2e8f0", "#334155"];
    const li = document.createElement("li");
    li.innerHTML = `<div class="addr">${esc(w.direccion)} <span class="tag" style="background:${bg};color:${fg}">${t}</span>
      <small>${w.owner ? esc(w.owner) + (w.tels ? ` · ${w.tels} tel.` : "") : ""}${w.detalle ? " · " + esc(w.detalle) : ""} · ${fecha(w.t)}</small></div>`;
    ul.appendChild(li);
  }
}
$("run").onclick = () => trabajar(true);
$("stop").onclick = () => { parar = true; ver("Detenido."); };
$("vaciar").onclick = async () => {
  const { [K("lote_wb")]: lote_wb = [] } = await chrome.storage.local.get(K("lote_wb"));
  if (lote_wb.length && !(await preguntar(`¿Vaciar el lote de Wibi (${lote_wb.length} propiedad(es))? Lo que ya subió Lofti no se toca.`, "Vaciar"))) return;
  await chrome.storage.local.set({ [K("lote_wb")]: [] }); pintar();
};
$("olvidarOk").onclick = async () => { await chrome.storage.local.set({ wbAprobado: null }); pintar(); };
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch[K("wbTrabajos")] || ch.wbPregunta || ch.wbAprobado || ch[K("lote_wb")] || ch.wbUso) pintar();
  if ((ch.addresses || ch[K("chDestino")] || ch.zone) && cfg.auto) { pintar(); setTimeout(() => trabajar(false), 1500); }
});

// Por qué no hay nada que hacer (para decirlo claro)
async function sinTrabajo() {
  const { addresses = {}, [K("chDestino")]: chDestino, zone = "" } = await chrome.storage.local.get(["addresses", K("chDestino"), "zone"]);
  if (LINEA === "hr") { const h = Object.values(addresses).filter((a) => a.origen === "hecm" && sirve(a)); return chDestino !== "wb" ? "No hay HECM para Wibi 3: Chequi 3 está mandando a Veri 3. En Chequi 3 escoge “Mandar a: Wibi”." : !h.length ? "Todavía no hay HECM: primero Heri tiene que encontrarlas." : h.every((a) => a.bvSearched) ? "Wibi 3 ya buscó todas las HECM." : "Las HECM que hay todavía no las aprueba Chequi 3 (o ya están en Lofty)."; }
  if (chDestino !== "wb") return "No hay domicilios para Wibi: Chequi está mandando a Veri. En Chequi escoge “Mandar a: Wibi”.";
  const zs = zonasDe(zone);
  const todos = Object.values(addresses).filter((a) => sirve(a) && enZona(a, zs) && lineaDe(a) === "");
  if (!todos.length) return `No hay domicilios de la zona “${zone || "(vacía)"}”. Primero Propi tiene que juntar domicilios.`;
  if (todos.every((a) => a.bvSearched)) return "Wibi ya buscó todos los domicilios de la zona. Junta más con Propi.";
  return "Los domicilios que hay todavía no los aprueba Chequi (o ya están en Lofty). Dale “Revisar” en Chequi.";
}
// Al terminar la pausa por bloqueo: si Wibi trabajaba solo, vuelve a prenderse
async function revisarPausa() {
  const { wbPausa = 0, [K("wbAutoAntes")]: wbAutoAntes } = await chrome.storage.local.get(["wbPausa", K("wbAutoAntes")]);
  if (wbPausa && wbPausa <= Date.now()) {
    await chrome.storage.local.set({ wbPausa: 0, [K("wbAutoAntes")]: null });
    if (wbAutoAntes) { cfg.auto = true; $("auto").checked = true; await chrome.storage.local.set({ [K("wbConfig")]: { ...cfg } }); decir("Ya pasó la pausa por el bloqueo de Propwire: Wibi vuelve a trabajar solo, a ritmo tranquilo."); if (!corriendo) trabajar(false); }
    else ver("Ya pasó la pausa por el bloqueo de Propwire. Dale “Hacer skip trace” cuando quieras.");
  }
}
async function diagnostico() {
  if (corriendo) return;
  const pz = await pausaHasta();
  const { wbPregunta, [K("wbAutoAntes")]: wbAutoAntes } = await chrome.storage.local.get(["wbPregunta", K("wbAutoAntes")]);
  if (pz) ver(`En pausa hasta las ${new Date(pz).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} porque Propwire bloqueó el acceso.` + (wbAutoAntes ? " A esa hora sigue solo." : ""));
  else if (wbPregunta) ver("Esperando tu OK para el cobro de Propwire (arriba).");
  else if (!cfg.auto) ver((await porHacer()).length ? `Tengo ${(await porHacer()).length} domicilio(s) por hacer, pero “Trabajar solo” está apagado: dale “Hacer skip trace” o prende “Trabajar solo”.` : await sinTrabajo());
}
setInterval(revisarPausa, 60000);

window.wbTrabajar = trabajar; // Capi
(async () => {
  await cargarCfg();
  const { wbAprobado: ap, wbPregunta: pq } = await chrome.storage.local.get(["wbAprobado", "wbPregunta"]);
  if (ap && /^(add|added|remove|save|save search|saved)$/i.test(ap.boton || "")) await chrome.storage.local.set({ wbAprobado: null }); // eso no era la confirmación del cobro
  if (pq && ((pq.botones || []).every((b) => /^(add|added|remove|save|save search|saved|cancel|close)$/i.test(b)) || /please confirm|skip trace credits/i.test(pq.texto || ""))) await chrome.storage.local.set({ wbPregunta: null }); // la ventana de créditos ya se acepta sola
  // Si quedó apagado por un bloqueo viejo (antes de que Wibi lo recordara), se vuelve a prender solo una vez
  const { wbPausa = 0, [K("wbAutoAntes")]: wbAutoAntes } = await chrome.storage.local.get(["wbPausa", K("wbAutoAntes")]);
  if (!LINEA && !cfg.auto && wbPausa && wbPausa <= Date.now() && wbAutoAntes === undefined) await chrome.storage.local.set({ [K("wbAutoAntes")]: true });
  await revisarPausa();
  await pintar(); await diagnostico();
  if (cfg.auto) setTimeout(() => trabajar(false), 5000); })();
