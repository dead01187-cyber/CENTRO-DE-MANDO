// =====================================================================
// Apariencia del Centro de Mando: intensidad del vidrio (v1.80.0) y fondos de pantalla propios (v1.74.0)
// · Botón "Fondo" en la barra de arriba: abre un panel con el fondo de
//   siempre y los que el jefe agregó desde su computadora.
// · Las imágenes viven en IndexedDB de la extensión (no en chrome.storage,
//   para no gastar el espacio que usan los agentes). Se achican a 3200 px
//   como máximo para que el Mando no se ponga lento.
// · En chrome.storage.local solo se guarda cuál está elegido (mandoFondo)
//   y qué tanto se oscurece (mandoFondoVelo, 0–0.7).
// · También se puede soltar una imagen arrastrándola sobre el panel.
// =====================================================================
(function () {
  const DB = "mando-fondos", STORE = "fondos", MAX_LADO = 3200, MAX_GUARDADOS = 12, MAX_MB = 40;
  const $ = (id) => document.getElementById(id);
  const urls = {}; // id → object URL (para no crearlas dos veces)

  // ---------- IndexedDB ----------
  function abrirDB() {
    return new Promise((ok, mal) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
      r.onsuccess = () => ok(r.result);
      r.onerror = () => mal(r.error);
    });
  }
  async function op(modo, fn) {
    const db = await abrirDB();
    return new Promise((ok, mal) => {
      const tx = db.transaction(STORE, modo), st = tx.objectStore(STORE);
      const r = fn(st);
      tx.oncomplete = () => { db.close(); ok(r && "result" in r ? r.result : undefined); };
      tx.onerror = () => { db.close(); mal(tx.error); };
    });
  }
  const listar = () => op("readonly", (s) => s.getAll()).then((xs) => (xs || []).sort((a, b) => b.t - a.t));
  const leer = (id) => op("readonly", (s) => s.get(id));
  const guardar = (f) => op("readwrite", (s) => s.put(f));
  const borrar = (id) => op("readwrite", (s) => s.delete(id));

  // ---------- Imagen: achicar si es muy grande ----------
  async function preparar(archivo) {
    if (!/^image\//.test(archivo.type)) throw new Error(`“${archivo.name}” no es una imagen.`);
    if (archivo.size > MAX_MB * 1048576) throw new Error(`“${archivo.name}” pesa más de ${MAX_MB} MB.`);
    const bmp = await createImageBitmap(archivo);
    const k = Math.min(1, MAX_LADO / Math.max(bmp.width, bmp.height));
    if (k === 1 && archivo.size <= 4 * 1048576 && /jpe?g|webp/.test(archivo.type)) { bmp.close(); return archivo; }
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const c = new OffscreenCanvas(w, h);
    c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return c.convertToBlob({ type: "image/jpeg", quality: 0.88 });
  }

  // ---------- Aplicar ----------
  const urlDe = (f) => urls[f.id] || (urls[f.id] = URL.createObjectURL(f.blob));
  async function aplicar() {
    const { mandoFondo = "", mandoFondoVelo = 0.28 } = await chrome.storage.local.get(["mandoFondo", "mandoFondoVelo"]);
    const b = document.body;
    b.style.setProperty("--fondo-velo", String(mandoFondoVelo));
    let f = null;
    if (mandoFondo) { try { f = await leer(mandoFondo); } catch (e) { f = null; } }
    if (f && f.blob) b.style.setProperty("--fondo-url", `url("${urlDe(f)}")`);
    else b.style.removeProperty("--fondo-url"); // el de siempre (fondos/fondo-mando.jpg)
    return f ? f.id : "";
  }

  async function agregar(archivos) {
    const aviso = $("fondoAviso");
    let ultimo = "";
    for (const a of [...archivos]) {
      try {
        if ((await listar()).length >= MAX_GUARDADOS) throw new Error(`Ya tienes ${MAX_GUARDADOS} fondos; borra uno para agregar otro.`);
        aviso.textContent = `Preparando “${a.name}”…`;
        const blob = await preparar(a);
        const f = { id: "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), nombre: a.name, blob, t: Date.now() };
        await guardar(f);
        ultimo = f.id;
        aviso.textContent = "";
      } catch (e) { aviso.textContent = String((e && e.message) || e); }
    }
    if (ultimo) { await chrome.storage.local.set({ mandoFondo: ultimo }); await aplicar(); }
    pintar();
  }


  // ---------- Intensidad del vidrio (v1.80.0) ----------
  // 0 = materiales sólidos estilo macOS oscuro (sin desenfoque: lo más fluido).
  // 100 = vidrio fuerte (más transparente y desenfocado). Se guarda en mandoVidrioNivel.
  const VIDRIO_DEF = 45;
  function aplicarVidrio(nivel) {
    const v = Math.min(100, Math.max(0, Number(nivel))) / 100, b = document.body.style;
    const blur = (px, sat) => (v < 0.03 ? "none" : `blur(${Math.round(px)}px) saturate(${Math.round(sat)}%)`);
    b.setProperty("--vid-fondo", `linear-gradient(135deg, rgba(255,255,255,${(0.035 + 0.085 * v).toFixed(3)}), rgba(255,255,255,${(0.015 + 0.025 * v).toFixed(3)})), rgba(38,38,40,${(0.96 - 0.9 * v).toFixed(3)})`);
    b.setProperty("--vid-blur", blur(6 + 20 * v, 100 + 80 * v));
    b.setProperty("--vid-borde", `rgba(255,255,255,${(0.09 + 0.07 * v).toFixed(3)})`);
    b.setProperty("--vid-luz", `inset 0 1px 0 rgba(255,255,255,${(0.06 + 0.16 * v).toFixed(3)})`);
    b.setProperty("--mat", `rgba(30,30,32,${(0.97 - 0.27 * v).toFixed(3)})`);        // barra, cajón y ventanitas
    b.setProperty("--mat-blur", blur(14 + 18 * v, 120 + 60 * v));
    document.body.classList.toggle("sin-vidrio", v < 0.03);
    const out = $("vidrioValor"); if (out) out.textContent = String(Math.round(v * 100));
    const r = $("vidrioNivel"); if (r && Number(r.value) !== Math.round(v * 100)) r.value = String(Math.round(v * 100));
  }
  async function cargarVidrio() {
    const { mandoVidrioNivel } = await chrome.storage.local.get("mandoVidrioNivel");
    aplicarVidrio(mandoVidrioNivel == null ? VIDRIO_DEF : mandoVidrioNivel);
  }

  // ---------- Panel ----------
  async function pintar() {
    const lista = $("fondoLista"); if (!lista) return;
    const { mandoFondo = "", mandoFondoVelo = 0.28 } = await chrome.storage.local.get(["mandoFondo", "mandoFondoVelo"]);
    const fondos = await listar().catch(() => []);
    lista.textContent = "";
    const mini = (id, src, titulo, quitable) => {
      const d = document.createElement("div");
      d.className = "fondo-mini" + (id === mandoFondo ? " elegido" : "");
      d.title = titulo; d.tabIndex = 0; d.setAttribute("role", "button");
      d.style.backgroundImage = `url("${src}")`;
      const elegir = async () => { await chrome.storage.local.set({ mandoFondo: id }); await aplicar(); pintar(); };
      d.onclick = elegir; d.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegir(); } };
      if (quitable) {
        const x = document.createElement("button");
        x.className = "fondo-quitar"; x.textContent = "×"; x.title = "Borrar este fondo";
        x.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm(`¿Borrar el fondo “${titulo}”?`)) return;
          await borrar(id);
          if (urls[id]) { URL.revokeObjectURL(urls[id]); delete urls[id]; }
          if (id === mandoFondo) await chrome.storage.local.set({ mandoFondo: "" });
          await aplicar(); pintar();
        };
        d.appendChild(x);
      }
      lista.appendChild(d);
    };
    mini("", "fondos/fondo-mando.jpg", "El de siempre", false);
    for (const f of fondos) mini(f.id, urlDe(f), f.nombre || "Fondo", true);
    $("fondoVelo").value = String(Math.round(mandoFondoVelo * 100));
    $("fondoCuenta").textContent = `${fondos.length} de ${MAX_GUARDADOS}`;
  }

  function armar() {
    const btn = $("b-fondo"), pan = $("fondoPanel");
    if (!btn || !pan) return;
    const abrir = (si) => { pan.hidden = !si; btn.setAttribute("aria-expanded", String(si)); if (si) pintar(); };
    btn.onclick = (e) => { e.stopPropagation(); abrir(pan.hidden); };
    document.addEventListener("click", (e) => { if (!pan.hidden && !pan.contains(e.target) && e.target !== btn) abrir(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pan.hidden) abrir(false); });
    $("fondoArchivo").onchange = (e) => { agregar(e.target.files); e.target.value = ""; };
    $("fondoAgregar").onclick = () => $("fondoArchivo").click();
    let guardarVidrio = null;
    $("vidrioNivel").oninput = (e) => {
      aplicarVidrio(e.target.value); // al instante mientras mueves
      clearTimeout(guardarVidrio); guardarVidrio = setTimeout(() => chrome.storage.local.set({ mandoVidrioNivel: Number(e.target.value) }), 250);
    };
    $("fondoVelo").oninput = async (e) => {
      const v = Math.min(0.7, Math.max(0, Number(e.target.value) / 100));
      document.body.style.setProperty("--fondo-velo", String(v));
      await chrome.storage.local.set({ mandoFondoVelo: v });
    };
    pan.addEventListener("dragover", (e) => { e.preventDefault(); pan.classList.add("soltando"); });
    pan.addEventListener("dragleave", () => pan.classList.remove("soltando"));
    pan.addEventListener("drop", (e) => { e.preventDefault(); pan.classList.remove("soltando"); if (e.dataTransfer.files.length) agregar(e.dataTransfer.files); });
  }

  // Si se cambia el fondo en otra pestaña del Mando, esta también se actualiza
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch.mandoFondo || ch.mandoFondoVelo) { aplicar(); if (!$("fondoPanel").hidden) pintar(); }
    if (ch.mandoVidrioNivel && ch.mandoVidrioNivel.newValue != null && Number($("vidrioNivel").value) !== ch.mandoVidrioNivel.newValue) aplicarVidrio(ch.mandoVidrioNivel.newValue);
  });

  armar();
  cargarVidrio().catch(() => aplicarVidrio(VIDRIO_DEF));
  aplicar().catch(() => {});
  window.Fondos = { aplicar, agregar, listar, aplicarVidrio }; // para pruebas
})();
