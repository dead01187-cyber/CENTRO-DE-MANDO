// =====================================================================
// Capturas para el reclamo a zBuyer (las usa Redi):
//  1) La ficha del lead en Lofty (Details) con Source y Reg Date marcados.
//  2) El correo de zBuyer en Gmail con su fecha marcada.
//  3) El borrador ya listo (la ventana de redactar completa), que Timi manda a Teams.
// Se toman en una ventanita aparte (Chrome solo fotografía pestañas visibles),
// se recortan y se pegan dentro del borrador de Gmail como imágenes.
// =====================================================================
(function (g) {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const ANCHO = 1920, ALTO = 1100;

  async function cargar(tabId, url) {
    await chrome.tabs.update(tabId, { url });
    await espera(700);
    for (let i = 0; i < 80; i++) { const x = await chrome.tabs.get(tabId).catch(() => null); if (!x || x.status === "complete") break; await espera(400); }
  }

  // ---- Corren DENTRO de la página ----
  // Lofty: tarjeta "Details" hasta "Reg Date"
  async function enLofty(nombre) {
    const esp = (ms) => new Promise((r) => setTimeout(r, ms));
    const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const etiqueta = (c, re) => [...c.querySelectorAll("*")].find((e) => !e.children.length && re.test(e.textContent.trim()) && e.getBoundingClientRect().height > 0);
    const fila = (e, c) => { let f = e; while (f.parentElement && f.parentElement !== c && f.getBoundingClientRect().width < c.getBoundingClientRect().width * 0.8) f = f.parentElement; return f; };
    let c = null;
    for (let i = 0; i < 60; i++) {
      c = document.querySelector(".sidebar-card.details-group");
      if (c && /Phone|Email/i.test(c.textContent)) break;
      if (/sign\s*in|log\s*in/i.test(document.title)) return { error: "Lofty pide iniciar sesión" };
      await esp(500);
    }
    if (!c || R(c).w < 50) return { error: "no encontré la ficha Details del lead en Lofty", alejar: true };
    if (!etiqueta(c, /^Reg Date:?$/i)) {
      const esMas = (e) => !e.children.length && /^View More$/i.test(e.textContent.trim());
      const mas = [...c.querySelectorAll("*")].find(esMas) || [...(c.parentElement || document).querySelectorAll("*")].find(esMas) || [...document.querySelectorAll("*")].find(esMas);
      if (mas) { mas.click(); await esp(1200); }
    }
    const reg = etiqueta(c, /^Reg Date:?$/i), src = etiqueta(c, /^Source:?$/i);
    if (!reg) return { error: "la ficha de Lofty no muestra Reg Date" };
    c.scrollIntoView({ block: "start" }); await esp(500);
    const top = R(c).y, fReg = fila(reg, c), fSrc = src && fila(src, c);
    const abajo = R(fReg).y + R(fReg).h + 8;
    const caja = R(c);
    // el nombre del lead (encabezado de la página) va arriba de la ficha
    const limpio = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim();
    const tit = nombre && [...document.querySelectorAll("h1,h2,h3,div,span")].find((e) => !e.children.length && limpio(e.textContent) === limpio(nombre) && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().top < 200);
    const rt = tit && R(tit);
    const valor = (f) => f ? f.innerText.replace(/\s+/g, " ").trim().replace(/^[^:]*:\s*/, "") : "";
    return { regDate: valor(fReg), fuente: valor(fSrc), franja: { izq: rt ? { x: rt.x - 8, y: rt.y - 6, w: rt.w + 16, h: rt.h + 12 } : null }, vw: innerWidth, vh: innerHeight, recorte: { x: caja.x - 2, y: top - 2, w: caja.w + 4, h: abajo - top + 4 },
      marcas: [fSrc && R(fSrc), R(fReg)].filter(Boolean), titulo: document.title };
  }
  // Gmail: la tarjeta del lead (hasta la dirección) + una franja arriba con asunto, remitente y la fecha del correo
  async function enGmailCorreo() {
    const esp = (ms) => new Promise((r) => setTimeout(r, ms));
    const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const une = (a, b) => { if (!a) return b; if (!b) return a; const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };
    let cuerpo = null, enc = null;
    for (let i = 0; i < 60; i++) {
      cuerpo = document.querySelector(".a3s"); enc = document.querySelector(".gE");
      if (cuerpo && enc && /Curious|LeadID|selling/i.test(cuerpo.textContent)) break;
      if (/accounts\.google\.com/.test(location.host)) return { error: "Gmail pide iniciar sesión" };
      await esp(500);
    }
    if (!cuerpo || !enc) return { error: "no se abrió el correo de zBuyer" };
    const asunto = document.querySelector("h2.hP"), fecha = document.querySelector("span.g3");
    (asunto || enc).scrollIntoView({ block: "start" }); await esp(600);
    // textos visibles del correo, en orden
    const textos = []; const tw = document.createTreeWalker(cuerpo, NodeFilter.SHOW_TEXT); let n;
    while ((n = tw.nextNode())) {
      if (!n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n); const r = rg.getBoundingClientRect();
      if (r.height > 0 && r.width > 0) textos.push({ n, r });
      if (textos.length > 80) break;
    }
    if (!textos.length) return { error: "el correo de zBuyer se ve vacío" };
    const iFin = textos.findIndex((t) => /,\s*[A-Z]{2}\s*\d{5}/.test(t.n.textContent));
    const prim = textos[0], fin = iFin >= 0 ? textos[iFin] : textos[Math.min(textos.length - 1, 9)];
    // la tarjeta: el contenedor común del primer texto y la dirección
    let cont = fin.n.parentElement;
    while (cont && cont !== cuerpo && !cont.contains(prim.n)) cont = cont.parentElement;
    let cx = cont ? R(cont) : null;
    const anchoCuerpo = R(cuerpo).w;
    if (!cx || cx.w > anchoCuerpo * 0.9 || cx.w < 200) { // sin contenedor claro: me guío por los textos
      const dentro = textos.filter((t) => t.r.top <= fin.r.bottom + 40);
      const izq = Math.min(...dentro.map((t) => t.r.left)) - 24, der = Math.max(...dentro.map((t) => t.r.right)) + 24;
      cx = { x: izq, w: Math.max(der - izq, 420) };
    }
    const arriba = prim.r.top - 18;
    const abajo = Math.max(fin.r.bottom, ...textos.filter((t) => t.r.top < fin.r.bottom + 40).map((t) => t.r.bottom)) + 18;
    const rem = document.querySelector(".gE .gD"), remCorreo = document.querySelector(".gE .go");
    let izq = une(asunto && R(asunto), une(rem && R(rem), remCorreo && R(remCorreo)));
    if (izq) izq = { x: izq.x - 6, y: izq.y - 6, w: izq.w + 12, h: izq.h + 12 };
    const rf = fecha && R(fecha);
    return { vw: innerWidth, vh: innerHeight, recorte: { x: cx.x - 16, y: arriba, w: cx.w + 32, h: abajo - arriba }, marcas: [],
      franja: { izq, der: rf ? { x: rf.x - 6, y: rf.y - 5, w: rf.w + 12, h: rf.h + 10 } : null, marcarDer: true },
      fecha: fecha ? fecha.getAttribute("title") || fecha.textContent : "" };
  }

  // Gmail: la ventana de redactar completa (título, Para, Asunto, el texto, las capturas y la firma), como se ve antes de enviar
  async function enRedactar() {
    const esp = (ms) => new Promise((r) => setTimeout(r, ms));
    let ed = null;
    for (let i = 0; i < 40 && !ed; i++) {
      ed = document.querySelector('div[aria-label="Message Body"], div[aria-label="Cuerpo del mensaje"], div[g_editable="true"]');
      if (!ed) await esp(300);
    }
    if (!ed) return { error: "no encontré el borrador abierto" };
    // el cuerpo vive en un contenedor con scroll: hasta arriba
    let sc = ed.parentElement;
    while (sc && sc !== document.body && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    if (sc && sc !== document.body) sc.scrollTop = 0; else sc = null;
    scrollTo(0, 0);
    try { getSelection().removeAllRanges(); ed.blur(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {} // sin cursor en la foto
    await esp(350);
    // la "tarjeta" de redactar
    let tarjeta = ed.closest('[role="region"], [role="dialog"]');
    if (!tarjeta) { tarjeta = ed; while (tarjeta.parentElement && tarjeta.parentElement !== document.body && !tarjeta.querySelector('input[name="subjectbox"]')) tarjeta = tarjeta.parentElement; }
    const rt = tarjeta.getBoundingClientRect();
    const rg = document.createRange(); rg.selectNodeContents(ed); const rc = rg.getBoundingClientRect();
    if (!(rc.height > 0)) return { error: "el borrador se ve vacío" };
    // hasta dónde se ve el cuerpo: arriba de la barra de formato y del botón Enviar
    const tops = [innerHeight];
    if (sc) tops.push(sc.getBoundingClientRect().bottom);
    for (const b of document.querySelectorAll('[role="toolbar"]')) { const r = b.getBoundingClientRect(); if (r.height > 0 && r.top > rc.top + 40) tops.push(r.top); }
    const enviar = [...document.querySelectorAll('div[role="button"]')].find((b) => /^(Send|Enviar)/.test(b.getAttribute("aria-label") || b.getAttribute("data-tooltip") || ""));
    if (enviar && enviar.getBoundingClientRect().height > 0) tops.push(enviar.getBoundingClientRect().top);
    const limite = Math.min(...tops) - 8;
    const x = Math.max(0, rt.left), arriba = Math.max(0, rt.top), abajo = rc.bottom + 24;
    return { vw: innerWidth, vh: limite, ih: innerHeight, maxAncho: 700, marcas: [], recorte: { x, y: arriba, w: Math.min(rt.width, innerWidth - x), h: abajo - arriba } };
  }

  // ---- Recorte con marcas ----
  async function recortar(dataUrl, info, maxAncho = info.maxAncho || 900) {
    const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const k = img.width / info.vw, c = info.recorte;         // k = pixeles de la foto por pixel de la página (cubre zoom y retina)
    const ky = img.height / (info.ih || info.vh);              // lo mismo, a lo alto
    const sx = Math.max(0, c.x * k), sy = Math.max(0, c.y * ky);
    const sw = Math.min(img.width - sx, c.w * k), sh = Math.min(img.height - sy, c.h * ky);
    const esc = Math.min(1, (maxAncho * 2) / sw);             // deja buena resolución
    const W = Math.round(sw * esc), H = Math.round(sh * esc * k / ky);
    // franja de arriba: un pedazo a la izquierda (nombre o asunto) y otro a la derecha (la fecha)
    const fr = info.franja || {}, a = fr.izq, b = fr.der;
    const y0 = Math.min(a ? a.y : Infinity, b ? b.y : Infinity);
    const fh = a || b ? Math.round((Math.max(a ? a.y + a.h : 0, b ? b.y + b.h : 0) - y0) * k * esc) + Math.round(8 * k * esc) : 0;
    const cv = new OffscreenCanvas(W, H + fh), x = cv.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, W, H + fh);
    x.strokeStyle = "#e11d48"; x.lineWidth = Math.max(2, 2.5 * k * esc);
    const pega = (r, dx, maxW) => { // pega un pedazo de la foto en la franja; regresa dónde quedó
      const w = Math.max(1, Math.min(r.w * k * esc, maxW)), h = r.h * k * esc, dy = (r.y - y0) * k * esc;
      x.drawImage(img, Math.max(0, r.x * k), Math.max(0, r.y * ky), w / esc, r.h * ky, dx(w), dy, w, h);
      return { x: dx(w), y: dy, w, h };
    };
    const bw = b ? Math.min(b.w * k * esc, W) : 0;
    if (a) pega(a, () => 0, W - (bw ? bw + 14 * k * esc : 0));   // si no cabe junto a la fecha, se recorta el asunto
    if (b) {
      const p = pega(b, (w) => W - w, W);
      if (fr.marcarDer) x.strokeRect(p.x + x.lineWidth / 2, p.y + x.lineWidth / 2, p.w - x.lineWidth, p.h - x.lineWidth);
    }
    if (fh) { x.fillStyle = "#e2e8f0"; x.fillRect(0, fh - 1, W, 1); }
    x.drawImage(img, sx, sy, sw, sh, 0, fh, W, H);
    for (const m of info.marcas || []) {
      const p = 3 * k * esc;
      x.strokeRect((m.x * k - sx) * esc - p, fh + (m.y * ky - sy) * esc * k / ky - p, m.w * k * esc + 2 * p, m.h * k * esc + 2 * p);
    }
    const blob = await cv.convertToBlob({ type: "image/png" });
    const url = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
    return { url, cssW: Math.round(c.w), px: [W, H + fh] };
  }

  async function foto(win, tabId, func, url, args = []) {
    let info = null;
    const corre = async () => (await chrome.scripting.executeScript({ target: { tabId }, func, args }))[0];
    const alejar = async (factor) => { // zoom solo en esta pestaña (no cambia el zoom de tus otras pestañas de Lofty o Gmail)
      await chrome.tabs.setZoomSettings(tabId, { mode: "automatic", scope: "per-tab" }).catch(() => {});
      const zoom = await chrome.tabs.getZoom(tabId);
      await chrome.tabs.setZoom(tabId, Math.max(0.5, zoom * factor));
      await espera(1000);
    };
    for (let z = 0; z < 3; z++) {
      let r;
      try { r = await corre(); }
      catch (e) { // página de error (se cayó la carga): la vuelvo a abrir una vez
        if (z > 0 || !url) throw e;
        await espera(800); await cargar(tabId, url);
        r = await corre();
      }
      info = r && r.result;
      if (!info) return { error: "la página no respondió" };
      if (info.error) { // la ficha no se ve en una ventana angosta: alejo y reintento una vez
        if (info.alejar && z === 0) { await alejar(0.67); continue; }
        return info;
      }
      const sobraAlto = (info.recorte.y + info.recorte.h) / info.vh, sobraAncho = (info.recorte.x + info.recorte.w) / info.vw;
      if (sobraAlto <= 1.002 && sobraAncho <= 1.002) break;
      if (z === 2) return { error: "no cabe en la ventana para fotografiarlo" };
      await alejar(0.95 / Math.max(sobraAlto, sobraAncho)); // no cabe: alejo la página y vuelvo a medir
    }
    // al frente un momento: Chrome no dibuja (ni fotografía) ventanas tapadas
    await chrome.windows.update(win, { focused: true }).catch(() => {});
    await espera(500);
    const dataUrl = await chrome.tabs.captureVisibleTab(win, { format: "png" });
    const { recorte, marcas, franja, vw, vh, ...datos } = info;
    return { ...datos, img: await recortar(dataUrl, info) };
  }

  // Abre la página en una ventanita aparte, la fotografía y cierra la ventanita
  async function enVentana(url, func, args) {
    const sw = screen.availWidth || 1440, sh = screen.availHeight || 900;
    const ancho = Math.min(ANCHO, sw - 20), alto = Math.min(ALTO, sh - 20), tipo = globalThis.__tipoVentana || "popup";
    const w = await chrome.windows.create({ url: "about:blank", type: tipo, width: ancho, height: alto,
      left: (screen.availLeft || 0) + Math.max(0, sw - ancho - 10), top: (screen.availTop || 0) + 10, focused: false })
      .catch(() => chrome.windows.create({ url: "about:blank", type: tipo, focused: false }));
    try {
      await espera(500);
      const tabId = w.tabs[0].id;
      await cargar(tabId, url);
      return await foto(w.id, tabId, func, url, args);
    } catch (e) { return { error: e.message };
    } finally { await chrome.windows.remove(w.id).catch(() => {}); }
  }

  // Toma las dos capturas de un lead. Regresa { lofty, correo, errores[] }
  //   lofty  = { url, px, regDate, fuente }   (ficha de Lofty: Source y Reg Date marcados)
  //   correo = { url, px, fecha }             (correo de zBuyer: su fecha marcada)
  async function capturasDe(l, base) {
    const out = { lofty: null, correo: null, errores: [] };
    if (l.loftyId) {
      const f = await enVentana(`https://crm.lofty.com/admin/home/detail?leadId=${encodeURIComponent(l.loftyId)}`, enLofty, [l.loftyNombre || ""]);
      if (f && !f.error) out.lofty = { ...f.img, regDate: f.regDate || "", fuente: f.fuente || "" }; else out.errores.push("Lofty: " + ((f && f.error) || "falló"));
    } else out.errores.push("Lofty: sin id de lead");
    if (l.hilo) {
      const f = await enVentana(`https://mail.google.com${base}#all/${l.hilo}`, enGmailCorreo, []);
      if (f && !f.error) out.correo = { ...f.img, fecha: f.fecha || "" }; else out.errores.push("Gmail: " + ((f && f.error) || "falló"));
    } else out.errores.push("Gmail: sin id del correo");
    return out;
  }

  // Le toma foto al borrador que está abierto en la pestaña tabId: la pasa a una ventana propia, alta, y la aleja
  // lo necesario para que quepa todo (solo esa pestaña). Regresa { url, px } o { error }. La pestaña se queda en esa ventana.
  async function fotoBorrador(tabId) {
    const sw = screen.availWidth || 1440, sh = screen.availHeight || 900;
    const ancho = Math.min(820, sw - 20), alto = sh - 20, tipo = globalThis.__tipoVentana || "popup";
    try {
      const w = await chrome.windows.create({ tabId, type: tipo, width: ancho, height: alto,
        left: (screen.availLeft || 0) + Math.max(0, sw - ancho - 10), top: (screen.availTop || 0) + 10, focused: false })
        .catch(() => chrome.windows.create({ tabId, type: tipo, focused: false }));
      await espera(700);
      // al 100 % (solo en esta pestaña) para que la foto salga nítida aunque tengas Gmail más chico
      await chrome.tabs.setZoomSettings(tabId, { mode: "automatic", scope: "per-tab" }).catch(() => {});
      await chrome.tabs.setZoom(tabId, 1).catch(() => {});
      await espera(900);
      const f = await foto(w.id, tabId, enRedactar, null, []);
      return f && !f.error ? f.img : { error: (f && f.error) || "falló" };
    } catch (e) { return { error: e.message }; }
  }

  // Corre DENTRO de la ventana de redactar (mundo de la página): pega las imágenes donde dice la marca
  // y espera a que Gmail las suba y guarde el borrador. Sin imágenes, solo quita la marca.
  async function pegarEnBorrador(html, marca, cuantas) {
    const esp = (ms) => new Promise((r) => setTimeout(r, ms));
    const guardado = () => [...document.querySelectorAll("span,div")].some((e) => !e.children.length && /^(Draft saved|Saved|Borrador guardado|Guardado)$/i.test((e.textContent || "").trim()));
    let ed = null;
    for (let i = 0; i < 100 && !ed; i++) {
      ed = document.querySelector('div[aria-label="Message Body"], div[aria-label="Cuerpo del mensaje"], div[g_editable="true"]');
      if (/accounts\.google\.com/.test(location.host)) return { ok: false, motivo: "Gmail pide iniciar sesión" };
      if (!ed) await esp(300);
    }
    if (!ed) return { ok: false, motivo: "no encontré el cuerpo del borrador" };
    await esp(800);
    // que se apague el aviso "Draft saved" del guardado anterior (dura unos 5 s), para no confundirlo con el nuevo
    for (let i = 0; i < 26 && guardado(); i++) await esp(300);
    ed.focus();
    const sel = getSelection();
    const buscaMarca = () => {
      const tw = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let n;
      while ((n = tw.nextNode())) {
        const i = n.textContent.indexOf(marca);
        if (i >= 0) { const rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, i + marca.length); return rg; }
      }
      return null;
    };
    let rg = buscaMarca();
    const hallado = !!rg;
    if (!rg) { rg = document.createRange(); rg.selectNodeContents(ed); rg.collapse(false); }
    sel.removeAllRanges(); sel.addRange(rg);
    const esFinal = (i) => /^blob:/.test(i.src) || /mail\.google\.com\/mail|googleusercontent/.test(i.src);
    const antes = [...ed.querySelectorAll("img")].filter(esFinal).length;
    let pegadas = 0;
    if (html) {
      const dt = new DataTransfer(); dt.setData("text/html", html); dt.setData("text/plain", "");
      ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      let hay = false;
      for (let i = 0; i < 14 && !hay; i++) { await esp(300); hay = ed.querySelectorAll("img").length > 0; }
      if (!hay) return { ok: false, motivo: "Gmail no aceptó las capturas" };
    } else if (!hallado) return { ok: true, imagenes: 0 };
    const queda = buscaMarca(); // quita la marca (si no hubo imágenes, o si Gmail la dejó)
    if (queda) { sel.removeAllRanges(); sel.addRange(queda); document.execCommand("delete"); }
    // espera el guardado nuevo: aviso "Draft saved" y las imágenes ya subidas
    for (let i = 0; i < 150; i++) {
      await esp(300);
      const imgs = [...ed.querySelectorAll("img")];
      pegadas = imgs.filter(esFinal).length - antes;
      const subiendo = imgs.some((im) => !esFinal(im));
      if (guardado() && !subiendo && (!html || pegadas >= cuantas)) {
        await esp(1500);
        return { ok: true, imagenes: Math.max(0, pegadas) };
      }
    }
    return { ok: false, motivo: html ? "Gmail no terminó de guardar las capturas" : "no vi que Gmail guardara el borrador" };
  }

  // Las dos capturas, una debajo de la otra y en este orden: primero la ficha de Lofty (la fecha vieja)
  // y después el correo de zBuyer (la fecha nueva). Gmail les pone su propio tamaño al pegarlas.
  function htmlCapturas(caps) {
    const dpr = globalThis.devicePixelRatio || 1;
    const img = (c, alt, max) => `<img src="${c.url}" alt="${alt}" width="${Math.round(Math.min(max, Math.max(c.px[0] / dpr, Math.min(c.px[0], 260))))}">`;
    const partes = [];
    if (caps && caps.lofty) partes.push(img(caps.lofty, "Lofty CRM", 320));
    if (caps && caps.correo) partes.push(img(caps.correo, "zBuyer lead email", 520));
    return { html: partes.map((p) => `<div>${p}</div>`).join(""), cuantas: partes.length };
  }

  Object.assign(g, { capturasDe, pegarEnBorrador, htmlCapturas, fotoBorrador });
})(globalThis);
