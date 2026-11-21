// Agente Lofty — script que corre dentro de crm.lofty.com.
// Se encarga SOLO de las llamadas (Lofty no tiene API para marcar):
// abre el menú del botón verde de llamada, elige el número, espera a que
// la llamada A ESE NÚMERO termine y le da Save al resultado.

let abortFlag = false;
let calling = false; // mientras el agente controla una llamada, el vigilante no toca nada
let saving = false;
let autoSave = true;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const digits = (s) => (s || "").replace(/\D/g, "");
const last10 = (s) => digits(s).slice(-10);

// Visible de verdad: con tamaño, sin ocultar y DENTRO de la pantalla
// (los paneles de Lofty se esconden deslizándose fuera de la pantalla).
function visible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
  if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none";
}

// Panel "Call Result" ya terminado: tiene "Outcome", "End Time"/"Call Detail" y un Save.
// Devuelve { save, panel } o null.
function findResultPanel() {
  const bodyText = document.body ? document.body.textContent : "";
  if (!bodyText.includes("Outcome") || !bodyText.includes("Save")) return null;
  const all = document.querySelectorAll("button, [role=button], a, div, span");
  for (const el of all) {
    if ((el.textContent || "").trim() !== "Save") continue;
    if ([...el.children].some((c) => (c.textContent || "").trim() === "Save")) continue;
    if (!visible(el)) continue;
    if (el.closest(".com-simple-phone-popover")) continue;
    let p = el.parentElement;
    for (let i = 0; i < 20 && p && p !== document.body; i++, p = p.parentElement) {
      const t = p.textContent || "";
      if (t.length > 8000) break;
      if (t.includes("Outcome") && (t.includes("End Time") || t.includes("Call Detail") || t.includes("Call Result"))) {
        return { save: el.closest("button, [role=button], a") || el, panel: p };
      }
    }
  }
  return null;
}

// ¿Hay una llamada en curso a este número? (texto "Dialer To:" con el número)
function activeCallTo(d10) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (!n.nodeValue || !n.nodeValue.includes("Dialer To")) continue;
    if (!visible(n.parentElement)) continue;
    let p = n.parentElement;
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
      if (digits(p.textContent).includes(d10)) return true;
    }
  }
  return false;
}

function realClick(el) {
  ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
  );
}

// Le da Save y confirma que el panel se cerró. Si no, reintenta.
async function saveCallResult() {
  for (let intento = 0; intento < 4; intento++) {
    const r = findResultPanel();
    if (!r) return true;
    await sleep(700);
    if (intento % 2 === 0) r.save.click(); else realClick(r.save);
    for (let i = 0; i < 10; i++) {
      await sleep(500);
      if (!findResultPanel()) return true;
    }
  }
  return !findResultPanel();
}

async function waitFor(fn, timeoutMs, stepMs = 500) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (abortFlag) return null;
    const v = fn();
    if (v) return v;
    await sleep(stepMs);
  }
  return null;
}

async function callNumber(phone, maxCallMs) {
  abortFlag = false;
  calling = true;
  const d10 = last10(phone);
  try {
    // 1) Esperar a que cargue el perfil del lead.
    // (Lofty movió los botones a la barra de arriba en la versión nueva; este selector sirve para ambas.)
    const greenBtn = await waitFor(() => document.querySelector(".contact-item.green"), 20000);
    if (!greenBtn) return { ok: false, error: "No encontré el botón verde de llamada." };
    if (greenBtn.classList.contains("disabled")) {
      return { ok: false, error: "Lofty tiene desactivado el botón de llamada para este lead." };
    }
    // Con varios números el botón trae un menú; con UN solo número, no hay menú
    // y el clic en el botón marca directo a ese número.
    const opener = greenBtn.querySelector(".com-dropdown-body");
    const singleBtn = !opener ? greenBtn.querySelector(".contact-label") || greenBtn : null;

    // 2) Si quedó un resultado de llamada abierto, guardarlo y esperar a que se cierre.
    if (findResultPanel()) {
      const ok = await saveCallResult();
      if (!ok) return { ok: false, error: "Quedó una llamada sin guardar y no pude darle Save." };
      await sleep(1500);
    }

    // 3) Abrir el menú de números y dar clic al que coincide.
    //    En la versión nueva de Lofty el menú se dibuja aparte (en .com-dropdown.show),
    //    así que buscamos el número entre los menús VISIBLES.
    const menuItems = () =>
      [...document.querySelectorAll(".com-dropdown.show li.click-item, .contact-item.green li.click-item")]
        .filter(visible);
    if (singleBtn) {
      singleBtn.click(); // lead con un solo número
    } else {
      if (!menuItems().length) opener.click();
      const item = await waitFor(() => menuItems().find((li) => last10(li.innerText) === d10), 5000);
      if (!item) return { ok: false, error: "El número no aparece en el menú de llamada." };
      item.click();
    }

    // 4) Confirmar que arrancó la llamada A ESTE número.
    const started = await waitFor(() => {
      if (activeCallTo(d10)) return "activa";
      const r = findResultPanel();
      if (r && digits(r.panel.textContent).includes(d10)) return "terminó"; // colgó rapidísimo
      return null;
    }, 20000);
    if (!started) return { ok: false, error: abortFlag ? "Detenido" : "La llamada no arrancó." };

    // 5) Esperar a que ESTA llamada termine: panel de resultado con este número y su Save.
    const ended = await waitFor(() => {
      const r = findResultPanel();
      return r && digits(r.panel.textContent).includes(d10) ? r : null;
    }, maxCallMs, 1000);
    if (!ended) return { ok: false, error: abortFlag ? "Detenido" : "La llamada no terminó a tiempo." };

    // 6) Save y confirmar que se cerró antes de seguir con el siguiente número.
    saving = true;
    let ok;
    try { ok = await saveCallResult(); } finally { saving = false; }
    flashBadge(ok ? "✓ Llamada guardada" : "No pude darle Save");
    await sleep(2000);
    if (!ok) return { ok: false, error: "La llamada terminó pero no pude darle Save." };
    return { ok: true };
  } finally {
    calling = false;
  }
}

// ---------- Vigilante de auto-Save ----------
// Cualquier llamada que termine (la marques tú a mano, o después de Parar/Saltar)
// se guarda sola para que Lofty no se quede trabado.
chrome.storage.local.get("alCfg").then((s) => {
  if (s.alCfg && s.alCfg.autoSave === false) autoSave = false;
  updateBadge();
});
chrome.storage.onChanged.addListener((ch) => {
  if (ch.alCfg && ch.alCfg.newValue) {
    autoSave = ch.alCfg.newValue.autoSave !== false;
    updateBadge();
  }
});

async function tick() {
  if (!autoSave || saving || calling) return;
  if (findResultPanel()) {
    saving = true;
    try {
      const ok = await saveCallResult();
      flashBadge(ok ? "✓ Llamada guardada" : "No pude darle Save");
    } finally { saving = false; }
  }
}
setInterval(tick, 1500);
let tickQueued = false;
new MutationObserver(() => {
  if (!autoSave || saving || calling || tickQueued) return;
  tickQueued = true;
  setTimeout(() => { tickQueued = false; tick(); }, 600);
}).observe(document.documentElement, { childList: true, subtree: true });

// Etiqueta en la esquina para saber que la extensión está activa.
let badge;
function updateBadge() {
  if (!document.body || window.top !== window) return;
  if (!badge) {
    badge = document.createElement("div");
    badge.style.cssText =
      "position:fixed;left:10px;bottom:10px;z-index:2147483647;padding:4px 8px;border-radius:6px;" +
      "font:600 11px system-ui,sans-serif;color:#fff;pointer-events:none;opacity:.85";
    document.body.appendChild(badge);
  }
  badge.textContent = autoSave ? "Agente Lofty · auto-Save activo" : "Agente Lofty · auto-Save apagado";
  badge.style.background = autoSave ? "#2f9e44" : "#868e96";
}
function flashBadge(text) {
  if (window.top !== window) return;
  if (!badge) updateBadge();
  badge.textContent = text;
  setTimeout(updateBadge, 3000);
}

// ---------- Mensajes del panel ----------
const IS_TOP = window.top === window;
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!IS_TOP) return; // solo la página principal contesta
  if (msg.type === "ping") { sendResponse({ ok: true }); return; }
  if (msg.type === "abort") { abortFlag = true; sendResponse({ ok: true }); return; }
  if (msg.type === "flush") { saveCallResult().then((ok) => sendResponse({ ok })); return true; }
  if (msg.type === "autosave") { sendResponse({ ok: true }); return; }
  if (msg.type === "call") {
    callNumber(msg.phone, msg.maxCallMs || 30 * 60 * 1000).then(sendResponse);
    return true;
  }
});
