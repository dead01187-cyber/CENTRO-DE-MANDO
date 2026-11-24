// =====================================================================
// Centro de Mando: la misma extensión en pestaña completa. Los robots de
// verdad trabajan dentro del cajón (los mismos iframes del panel), y aquí
// arriba se ve todo con efectos: estados, flujo de datos, misión y bitácora.
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODS = ["pr", "hr", "ch3", "bv3", "ow3", "wb3", "pw", "ch", "cp", "bv", "ow", "lf", "ac", "bv2", "ow2", "zb", "rd", "ti", "wb", "tx", "t2", "cb", "rs", "rc", "li", "al", "ra", "te", "va", "pu", "cu", "qa", "an", "tb", "sv"];
const NOMBRE = { ...Object.fromEntries(REGISTRO.ids(false).map((m) => [m, REGISTRO.nombre(m)])), tb: "Tablero" }; // Fase 2: del registro central · Fase 5: tablero
const COLOR = { t2: "#34d399", cb: "#38bdf8", rc: "#7dd3fc", ra: "#ef4444", te: "#f97316", al: "#60a5fa", pr: "#eab308", li: "#fb7185", rs: "#2dd4bf", cp: "#22d3ee", ch3: "#fbbf24", bv3: "#fb923c", ow3: "#facc15", wb3: "#d97706", hr: "#f59e0b", tx: "#34d399", wb: "#facc15", zb: "#22d3ee", rd: "#a78bfa", gm: "#f9a8d4", ti: "#60a5fa", tm: "#818cf8", bv2: "#e879f9", ow2: "#a3e635", ac: "#fb923c", pw: "#2dd4bf", ch: "#f472b6", bv: "#818cf8", ow: "#4ade80", lf: "#38bdf8", sv: "#fbbf24", crm: "#a5b4fc" };
const CHIP = { idle: "Listo", trabajando: "Trabajando", feliz: "¡Terminé!", error: "Error", ayuda: "Necesito ayuda", pausa: "Pausa", pensando: "Pensando" };

// ---------- Candado: un solo Capi a la vez (panel lateral o Mando) ----------
const yo = Math.random().toString(36).slice(2);
const canal = new BroadcastChannel("geo-farming-mando");
canal.onmessage = (e) => {
  const d = e.data || {};
  if (d.t === "ping") canal.postMessage({ t: "mando", id: yo });
  if (d.t === "mando" && d.id !== yo && d.nuevo) bloquear(); // abrieron otro Mando más nuevo
};
canal.postMessage({ t: "mando", id: yo, nuevo: true });
addEventListener("pagehide", () => canal.postMessage({ t: "mando-cerrado", id: yo }));
function bloquear() {
  document.querySelectorAll(".marcos iframe").forEach((f) => f.remove());
  $("bloqueo").hidden = false;
}

// ---------- Íconos de los agentes ----------
for (const m of [...MODS, "crm", "gm", "tm"]) { const e = document.getElementById("e-" + m); if (e && COLOR[m]) e.style.setProperty("--rc", COLOR[m]); } // color de cada nodo (efectos)
for (const m of [...MODS, "gm", "tm", "crm"]) {
  const r = document.querySelector(`#e-${m} .robot`);
  if (r && window.robotSVG) r.innerHTML = robotSVG(m);
}
const frame = (m) => $("f-" + m);
const docDe = (m) => { try { return frame(m).contentDocument; } catch (e) { return null; } };
const svWin = () => { try { return frame("sv").contentWindow; } catch (e) { return null; } };

// ---------- Cajón (pestañas reales) ----------
let enCajon = null;
function mostrar(m) {
  if (!MODS.includes(m)) return;
  if (enCajon !== m || !document.body.classList.contains("con-cajon")) window.Sonidos && Sonidos.tocar("abrir"); // sonido suave al abrir un agente
  enCajon = m;
  document.body.classList.add("con-cajon");
  for (const x of MODS) frame(x) && frame(x).classList.toggle("on", x === m);
  document.querySelectorAll("#cajonNav button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
  $("cajonTitulo").textContent = NOMBRE[m];
  $("cajonIcono").innerHTML = window.robotSVG ? robotSVG(m) : "";
  chrome.storage.local.set({ tabActiva: m });
  setTimeout(medir, 380);
}
function cerrarCajon() {
  enCajon = null;
  document.body.classList.remove("con-cajon");
  chrome.storage.local.set({ tabActiva: "mando" });
  setTimeout(medir, 380);
}
window.mostrar = mostrar; // Capi lo usa (parent.mostrar)
document.querySelectorAll(".estacion[data-m]").forEach((e) => (e.onclick = () => mostrar(e.dataset.m)));
document.querySelectorAll("#cajonNav button").forEach((b) => {
  // ícono de línea de cada agente junto a su nombre en el menú
  if (window.robotSVG) { const i = document.createElement("span"); i.className = "ni"; i.innerHTML = robotSVG(b.dataset.m); b.prepend(i); }
  b.onclick = () => mostrar(b.dataset.m);
});
$("cajonCerrar").onclick = cerrarCajon;
// Menú desplegable de robots
const menuBtn = $("cajonMenuBtn"), menuNav = $("cajonNav");
const abrirMenu = (si) => { menuNav.hidden = !si; menuBtn.setAttribute("aria-expanded", si ? "true" : "false"); };
menuBtn.onclick = (e) => { e.stopPropagation(); abrirMenu(menuNav.hidden); };
menuNav.addEventListener("click", (e) => { if (e.target.closest("button")) abrirMenu(false); });
document.addEventListener("click", (e) => { if (!menuNav.hidden && !e.target.closest(".selector")) abrirMenu(false); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && !menuNav.hidden) { e.stopImmediatePropagation(); abrirMenu(false); } }, true);
addEventListener("keydown", (e) => { if (e.key === "Escape" && enCajon) cerrarCajon(); });

// ---------- Sonidos (opcionales): efectos relajantes de sonidos.js, sin música ----------
let sonido = false;
const sonar = (nombre) => window.Sonidos && Sonidos.tocar(nombre);
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local" || !ch.smsRegistro) return;
  const antes = (ch.smsRegistro.oldValue || []).length, ahora = ch.smsRegistro.newValue || [];
  if (ahora.slice(antes > ahora.length ? -1 : antes).some((e) => e && e.estado === "enviado")) sonar("sms");
});
// ---------- Tema: solo estilo n8n (el tema neón se quitó por decisión del jefe) ----------
const N8N = () => true;
function ponerTema() {
  document.body.classList.add("n8n");
  aplicarCam();
  setTimeout(() => { try { medir(); } catch (e) {} }, 60);
}
// ---------- Cámara (estilo n8n): zoom con botones o Ctrl/⌘ + rueda; arrastrar con clic izquierdo para mover ----------
let cam = { s: 1, x: 0, y: 0 }, camGuardar = null;
const arbolEl = () => document.querySelector(".arbol");
function aplicarCam() {
  const a = arbolEl(); if (!a) return;
  a.style.transformOrigin = "0 0";
  a.style.transform = N8N() ? `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})` : "";
  const z = document.getElementById("camZoom"); if (z) z.textContent = Math.round(cam.s * 100) + "%";
  seguirCam();
  clearTimeout(camGuardar); camGuardar = setTimeout(() => chrome.storage.local.set({ mandoCam: cam }), 400);
}
function zoomEn(f, cx, cy) {
  const E = $("escena"), r = E.getBoundingClientRect();
  if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
  const s2 = Math.max(.35, Math.min(2, cam.s * f));
  cam.x = cx - (cx - cam.x) * (s2 / cam.s); cam.y = cy - (cy - cam.y) * (s2 / cam.s); cam.s = s2;
  aplicarCam();
}
// Fluidez (v1.80.1): mientras arrastras o haces zoom, el lienzo de las líneas se mueve con la cámara
// por CSS (no se mide ni se redibuja nada); 140 ms después de detenerte se mide de verdad una vez.
let camBase = null, camFin = null;
function seguirCam() {
  const a = arbolEl();
  if (!camBase || !a) { try { medir(); } catch (e) {} return; }
  const k = cam.s / camBase.s;
  const tx = camBase.ox + cam.x - k * (camBase.ox + camBase.x), ty = camBase.oy + cam.y - k * (camBase.oy + camBase.y);
  cL.style.transformOrigin = "0 0"; cL.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
  clearTimeout(camFin); camFin = setTimeout(() => { cL.style.transform = ""; try { medir(); } catch (e) {} }, 140);
}
function encuadrar() { // que quepa todo el flujo en la pantalla
  const E = $("escena"), a = arbolEl(); if (!a) return;
  const w = Math.max(a.offsetWidth, a.scrollWidth), h = a.scrollHeight, W = E.clientWidth - 30, H = E.clientHeight - 30; // scrollWidth: las tarjetas se salen de la caja
  cam.s = Math.max(.35, Math.min(1, W / w, H / h));
  cam.x = (E.clientWidth - w * cam.s) / 2; cam.y = Math.max(10, (E.clientHeight - h * cam.s) / 2);
  aplicarCam();
}
(() => {
  const E = $("escena");
  const c = document.createElement("div"); c.id = "camara";
  c.innerHTML = `<button data-c="mas" title="Acercar">+</button><button data-c="menos" title="Alejar">−</button><span id="camZoom">100%</span><button data-c="fit" title="Que quepa todo">⤢</button><button data-c="uno" title="Tamaño real (100%)">1:1</button>`;
  E.appendChild(c);
  c.addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (!b) return; ev.stopPropagation();
    ({ mas: () => zoomEn(1.2), menos: () => zoomEn(1 / 1.2), fit: encuadrar, uno: () => zoomEn(1 / cam.s) })[b.dataset.c](); });
  // Arrastrar con clic izquierdo (sobre el fondo o sobre un nodo; si solo das clic sin mover, el nodo se abre como siempre)
  let arr = null, movio = false, raf = 0;
  E.addEventListener("mousedown", (ev) => {
    if (!N8N() || ev.button !== 0 || ev.target.closest("#camara, .interruptor, input, textarea, select, a, .burbuja")) return;
    arr = { x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y }; movio = false;
  });
  addEventListener("mousemove", (ev) => {
    if (!arr) return;
    const dx = ev.clientX - arr.x, dy = ev.clientY - arr.y;
    if (!movio && Math.hypot(dx, dy) < 4) return;
    if (!movio) { movio = true; document.body.classList.add("arrastrando"); }
    cam.x = arr.cx + dx; cam.y = arr.cy + dy;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; aplicarCam(); });
  });
  addEventListener("mouseup", () => { if (!arr) return; arr = null; document.body.classList.remove("arrastrando"); });
  // si arrastraste, ese clic no abre el robot
  E.addEventListener("click", (ev) => { if (movio) { ev.stopPropagation(); ev.preventDefault(); movio = false; } }, true);
  // rueda: Ctrl/⌘ + rueda (o pellizco del trackpad) = zoom; rueda sola = mover
  E.addEventListener("wheel", (ev) => {
    if (!N8N()) return;
    ev.preventDefault();
    const r = E.getBoundingClientRect();
    if (ev.ctrlKey || ev.metaKey) zoomEn(Math.exp(-ev.deltaY * 0.0025), ev.clientX - r.left, ev.clientY - r.top);
    else { cam.x -= ev.deltaX; cam.y -= ev.deltaY; aplicarCam(); }
  }, { passive: false });
  chrome.storage.local.get("mandoCam").then(({ mandoCam }) => { if (mandoCam && mandoCam.s) { cam = mandoCam; aplicarCam(); } else setTimeout(encuadrar, 300); });
})();

$("b-tablero").onclick = () => mostrar("tb"); // Fase 5
chrome.storage.local.set({ mandoTema: "n8n" }); // si estaba guardado "neon", se reemplaza
ponerTema();

function pintarSonido() { $("b-sonido").textContent = sonido ? "Sonido: sí" : "Sonido: no"; if (window.Sonidos) Sonidos.activo = sonido; $("volSonido").hidden = !sonido; }
$("b-sonido").onclick = () => { sonido = !sonido; chrome.storage.local.set({ mandoSonido: sonido }); pintarSonido(); if (sonido) sonar("abrir"); }; // muestra cómo suena
$("volSonido").oninput = (e) => { const v = Number(e.target.value) / 100; if (window.Sonidos) Sonidos.volumen = v; chrome.storage.local.set({ mandoVolumen: v }); };
$("volSonido").onchange = () => sonar("sms"); // para oír el volumen nuevo

// =====================================================================
// Fondo de estrellas
// =====================================================================
const cE = $("estrellas"), xE = cE.getContext("2d");
let estrellas = [], fugaz = null;
function tamEstrellas() {
  const d = devicePixelRatio || 1;
  cE.width = innerWidth * d; cE.height = innerHeight * d; cE.style.width = innerWidth + "px"; cE.style.height = innerHeight + "px";
  xE.setTransform(d, 0, 0, d, 0, 0);
  estrellas = Array.from({ length: Math.round(innerWidth * innerHeight / 7000) }, () => ({
    x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: Math.random() * 1.3 + .2, f: Math.random() * 6.28, v: Math.random() * .08 + .02 }));
}
function dibujarEstrellas(t) {
  xE.clearRect(0, 0, innerWidth, innerHeight);
  if (N8N()) return;
  for (const s of estrellas) {
    s.x -= s.v; if (s.x < 0) s.x = innerWidth;
    xE.globalAlpha = .35 + .45 * Math.sin(t / 900 + s.f) ** 2;
    xE.fillStyle = "#cfe0ff"; xE.beginPath(); xE.arc(s.x, s.y, s.r, 0, 6.28); xE.fill();
  }
  if (!fugaz && Math.random() < .002) fugaz = { x: Math.random() * innerWidth, y: Math.random() * innerHeight * .4, v: 9, vida: 1 };
  if (fugaz) {
    const g = xE.createLinearGradient(fugaz.x, fugaz.y, fugaz.x - 90, fugaz.y - 35);
    g.addColorStop(0, `rgba(255,255,255,${fugaz.vida})`); g.addColorStop(1, "rgba(255,255,255,0)");
    xE.globalAlpha = 1; xE.strokeStyle = g; xE.lineWidth = 1.6;
    xE.beginPath(); xE.moveTo(fugaz.x, fugaz.y); xE.lineTo(fugaz.x - 90, fugaz.y - 35); xE.stroke();
    fugaz.x += fugaz.v; fugaz.y += fugaz.v * .4; fugaz.vida -= .015;
    if (fugaz.vida <= 0) fugaz = null;
  }
  xE.globalAlpha = 1;
}

// =====================================================================
// Lazos entre robots y partículas de datos
// =====================================================================
const cL = $("lazos"), xL = cL.getContext("2d");
let centros = {}, cajas = {}, lazos = [], particulas = [];
let sucio = true, estrellasLimpias = false; // ¿hay que redibujar las líneas?
const ACENTO = "#0a84ff"; // azul del sistema de Apple para lo que está activo (antes coral de n8n)
const TUBERIA = [["ac", "bv2"], ["bv2", "ow2"], ["ow2", "lf"], ["pw", "ch"], ["ch", "bv"], ["cp", "wb"], ["wb", "lf"], ["bv", "ow"], ["ow", "lf"], ["lf", "crm"], ["zb", "rd"], ["rd", "gm"], ["gm", "ti"], ["ti", "tm"], ["crm", "tx"], ["tx", "rs"], ["crm", "cb"], ["cb", "rc"], ["crm", "t2"], ["crm", "li"], ["crm", "al"], ["ra", "te"], ["pr", "hr"], ["hr", "ch3"], ["ch3", "bv3"], ["ch3", "wb3"], ["bv3", "ow3"], ["ow3", "lf"], ["wb3", "lf"]];
const MANDO = [["sv", "ac"], ["sv", "zb"], ["sv", "cp"], ["sv", "pw"], ["sv", "pr"], ["sv", "ra"]];

function medir() {
  const E = $("escena"), r0 = E.getBoundingClientRect(), d = devicePixelRatio || 1;
  const alto = Math.max(E.clientHeight, E.scrollHeight);
  // si el lienzo baja con scroll (estilo n8n), el canvas cubre todo lo alto y las posiciones se miden desde arriba del contenido
  const esc = { left: r0.left, top: r0.top - E.scrollTop, width: r0.width, height: alto };
  // solo se vuelve a crear el lienzo si cambió de tamaño (crearlo en cada cuadro al mover la cámara trababa todo)
  const W = Math.round(esc.width * d), H = Math.round(alto * d);
  if (cL.width !== W || cL.height !== H) { cL.style.height = alto + "px"; cL.width = W; cL.height = H; }
  xL.setTransform(d, 0, 0, d, 0, 0);
  sucio = true;
  for (const m of [...MODS, "crm", "gm", "tm"]) {
    const a = document.querySelector(`#e-${m} .aro`); if (!a) continue;
    const r = a.getBoundingClientRect();
    centros[m] = { x: r.left - esc.left + r.width / 2, y: r.top - esc.top + r.height / 2, r: r.width / 2 + 10 };
    const e = document.getElementById("e-" + m), q = e && e.getBoundingClientRect();
    if (q) cajas[m] = { x: q.left - esc.left, y: q.top - esc.top, w: q.width, h: q.height };
  }
  lazos = [...TUBERIA.map(([a, b]) => armar(a, b, "tubo")), ...MANDO.map(([a, b]) => armar(a, b, "mando"))].filter(Boolean);
  { const ar = arbolEl(), cr = cL.getBoundingClientRect(); if (ar && !cL.style.transform) { const r = ar.getBoundingClientRect(); camBase = { s: cam.s, x: cam.x, y: cam.y, ox: r.left - cr.left - cam.x, oy: r.top - cr.top - cam.y }; } }
  for (const p of particulas) p.l = lazos.find((l) => l.a === p.l.a && l.b === p.l.b) || p.l;
}
function armar(a, b, tipo) {
  if (N8N()) return armarN8n(a, b, tipo);
  const A = centros[a], B = centros[b]; if (!A || !B) return null;
  const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  const p0 = { x: A.x + ux * A.r, y: A.y + uy * A.r }, p2 = { x: B.x - ux * B.r, y: B.y - uy * B.r };
  const curva = 0; // árbol: líneas rectas
  const p1 = { x: (p0.x + p2.x) / 2 - uy * curva, y: (p0.y + p2.y) / 2 + ux * curva };
  return { a, b, tipo, p0, p1, p2 };
}
// n8n: las líneas bajan por su columna (o por el pasillo entre columnas si hay un nodo en medio)
// y solo al final doblan hacia el nodo destino, para no pasar por encima de otros nodos.
function cubica(a, c1, c2, b, n = 22) {
  const o = [];
  for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; o.push({ x: u ** 3 * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * b.x, y: u ** 3 * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * b.y }); }
  return o;
}
function choca(x, y1, y2, fuera) {
  return Object.entries(cajas).some(([m, c]) => !fuera.includes(m) && x > c.x - 8 && x < c.x + c.w + 8 && Math.max(y1, y2) > c.y - 4 && Math.min(y1, y2) < c.y + c.h + 4);
}
// ¿algún punto del camino cae dentro de la caja de otro nodo?
function cruza(pts, fuera) {
  return pts.some((p) => Object.entries(cajas).some(([m, c]) => !fuera.includes(m) && p.x > c.x - 6 && p.x < c.x + c.w + 6 && p.y > c.y - 6 && p.y < c.y + c.h + 6));
}
function armarN8n(a, b, tipo) {
  const A = cajas[a], B = cajas[b]; if (!A || !B) return null;
  const mismaFila = Math.abs((A.y + A.h / 2) - (B.y + B.h / 2)) < 20;
  let pts;
  if (mismaFila) {
    const der = B.x > A.x;
    const p0 = { x: der ? A.x + A.w : A.x, y: A.y + A.h / 2 }, p3 = { x: der ? B.x : B.x + B.w, y: B.y + B.h / 2 };
    const k = Math.max(30, Math.abs(p3.x - p0.x) / 2) * (der ? 1 : -1);
    pts = [p0, ...cubica(p0, { x: p0.x + k, y: p0.y }, { x: p3.x - k, y: p3.y }, p3)];
  } else {
    const abajo = B.y > A.y;
    const p0 = { x: A.x + A.w / 2, y: abajo ? A.y + A.h : A.y }, p3 = { x: B.x + B.w / 2, y: abajo ? B.y : B.y + B.h };
    const k = Math.max(26, Math.abs(p3.y - p0.y) / 2) * (abajo ? 1 : -1);
    const directo = [p0, ...cubica(p0, { x: p0.x, y: p0.y + k }, { x: p3.x, y: p3.y - k }, p3)];
    if (!abajo || !cruza(directo.slice(2, -2), [a, b])) pts = directo;
    else {
      // Hay nodos en medio: salir por el costado (hacia donde está el destino), bajar por el pasillo
      // hasta pasar el último nodo que estorba y de ahí doblar hacia el destino.
      const lados = p3.x < p0.x ? ["izq", "der"] : ["der", "izq"];
      for (const lado of lados) {
        const sx = lado === "izq" ? A.x : A.x + A.w, gx = lado === "izq" ? A.x - 12 : A.x + A.w + 12, sy = A.y + A.h / 2;
        // nodos del pasillo/columna entre el origen y el destino
        const estorban = Object.entries(cajas).filter(([m, c]) => m !== a && m !== b && c.y > A.y + A.h - 2 && c.y < p3.y && gx > c.x - 40 && gx < c.x + c.w + 40);
        const bajo = Math.max(A.y + A.h, ...estorban.map(([, c]) => c.y + c.h)) + 16;
        const p1 = { x: gx, y: sy };
        const cand = [{ x: sx, y: sy }, ...cubica({ x: sx, y: sy }, { x: (sx + gx) / 2, y: sy }, { x: gx, y: sy }, p1, 6),
          { x: gx, y: Math.max(sy + 12, bajo - 10) },
          ...cubica({ x: gx, y: Math.max(sy + 12, bajo - 10) }, { x: gx, y: bajo + Math.max(20, (p3.y - bajo) * .6) }, { x: p3.x, y: p3.y - Math.max(20, (p3.y - bajo) * .5) }, p3, 26)];
        if (!cruza(cand.slice(1, -2), [a, b])) { pts = cand; break; }
        if (!pts) pts = cand;
      }
    }
  }
  // largo acumulado (para las partículas)
  const acum = [0];
  for (let i = 1; i < pts.length; i++) acum.push(acum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { a, b, tipo, n8n: true, pts, acum, p0: pts[0], p2: pts[pts.length - 1], p3: pts[pts.length - 1] };
}
const puntoN8n = (l, t) => {
  const L = l.acum[l.acum.length - 1] * Math.max(0, Math.min(1, t));
  let i = 1; while (i < l.acum.length - 1 && l.acum[i] < L) i++;
  const f = (L - l.acum[i - 1]) / ((l.acum[i] - l.acum[i - 1]) || 1);
  return { x: l.pts[i - 1].x + (l.pts[i].x - l.pts[i - 1].x) * f, y: l.pts[i - 1].y + (l.pts[i].y - l.pts[i - 1].y) * f };
};
const punto = (l, t) => l.n8n ? puntoN8n(l, t) : ({
  x: (1 - t) ** 2 * l.p0.x + 2 * (1 - t) * t * l.p1.x + t * t * l.p2.x,
  y: (1 - t) ** 2 * l.p0.y + 2 * (1 - t) * t * l.p1.y + t * t * l.p2.y });
const lazo = (a, b) => lazos.find((l) => l.a === a && l.b === b);

function disparar(a, b, n = 1, grande = false) {
  n = Math.max(0, Math.min(6, n | 0)); if (!n) return;
  const l = lazo(a, b); if (!l) return;
  for (let i = 0; i < Math.min(n, 14); i++)
    particulas.push({ l, t: -i * 0.09, v: (grande ? .006 : .009) + Math.random() * .004, c: COLOR[a], r: grande ? 4.2 : 2.6 + Math.random() * 1.2 });
}

function dibujarLazosN8n(t) {
  for (const l of lazos) {
    if (!l.n8n) continue;
    const activo = estado[l.a] === "trabajando" || estado[l.a] === "pensando";
    xL.strokeStyle = activo ? ACENTO : l.tipo === "mando" ? "rgba(255,255,255,.45)" : "rgba(255,255,255,.62)"; // blancas translúcidas sobre el fondo de colores
    xL.lineWidth = 2; xL.globalAlpha = 1;
    xL.setLineDash(activo ? [7, 5] : l.tipo === "mando" ? [3, 5] : []); xL.lineDashOffset = activo ? -t / 30 : 0;
    xL.beginPath(); xL.moveTo(l.pts[0].x, l.pts[0].y); for (const q of l.pts.slice(1)) xL.lineTo(q.x, q.y); xL.stroke();
    xL.setLineDash([]);
    // punto de salida (como el "handle" de n8n) y flecha de entrada
    xL.fillStyle = "#9a9a9a"; xL.beginPath(); xL.arc(l.p0.x, l.p0.y, 3.5, 0, 6.28); xL.fill();
    const q = punto(l, 0.97), ang = Math.atan2(l.p3.y - q.y, l.p3.x - q.x);
    xL.fillStyle = activo ? ACENTO : "#7a7a7a";
    xL.beginPath(); xL.moveTo(l.p3.x, l.p3.y);
    xL.lineTo(l.p3.x - 8 * Math.cos(ang - .45), l.p3.y - 8 * Math.sin(ang - .45));
    xL.lineTo(l.p3.x - 8 * Math.cos(ang + .45), l.p3.y - 8 * Math.sin(ang + .45)); xL.closePath(); xL.fill();
  }
  // datos que pasan: puntitos naranjas, sin brillo
  particulas = particulas.filter((p) => p.t < 1);
  for (const p of particulas) {
    p.t += p.v; if (p.t < 0) continue;
    const q = punto(p.l, p.t);
    xL.globalAlpha = 1; xL.fillStyle = ACENTO; xL.beginPath(); xL.arc(q.x, q.y, 3.2, 0, 6.28); xL.fill();
    if (p.t >= 1 - p.v) llegada(p.l.b);
  }
}
function dibujarLazos(t) {
  const esc = $("escena");
  xL.clearRect(0, 0, esc.clientWidth, Math.max(esc.clientHeight, esc.scrollHeight));
  if (N8N()) { if (lazos.length && !lazos[0].n8n) medir(); dibujarLazosN8n(t); return; }
  if (lazos.length && lazos[0].n8n) medir();
  for (const l of lazos) {
    const activo = estado[l.a] === "trabajando" || estado[l.a] === "pensando";
    const g = xL.createLinearGradient(l.p0.x, l.p0.y, l.p2.x, l.p2.y);
    g.addColorStop(0, COLOR[l.a]); g.addColorStop(1, COLOR[l.b]);
    xL.strokeStyle = g;
    // todas las conexiones con la misma línea punteada de Capi (sin flechas); se iluminan cuando el robot trabaja
    xL.globalAlpha = activo ? .6 : .2; xL.lineWidth = activo ? 1.6 : 1.2; xL.setLineDash([4, 7]); xL.lineDashOffset = -t / 40;
    xL.beginPath(); xL.moveTo(l.p0.x, l.p0.y); xL.quadraticCurveTo(l.p1.x, l.p1.y, l.p2.x, l.p2.y); xL.stroke();
  }
  xL.setLineDash([]); xL.globalAlpha = 1;
  particulas = particulas.filter((p) => p.t < 1);
  for (const p of particulas) {
    p.t += p.v; if (p.t < 0) continue;
    const q = punto(p.l, p.t);
    for (let k = 4; k >= 0; k--) { // estela
      const s = punto(p.l, Math.max(0, p.t - k * 0.012));
      xL.globalAlpha = (1 - k / 5) * .8; xL.fillStyle = p.c; xL.shadowColor = p.c; xL.shadowBlur = 12;
      xL.beginPath(); xL.arc(s.x, s.y, p.r * (1 - k / 7), 0, 6.28); xL.fill();
    }
    if (p.t >= 1 - p.v) { llegada(p.l.b); }
  }
  xL.shadowBlur = 0; xL.globalAlpha = 1;
}
function llegada(m) {
  const a = document.querySelector(`#e-${m} .aro`); if (!a) return;
  a.animate([{ filter: "brightness(1.9)" }, { filter: "brightness(1)" }], { duration: 380 });
}

// Los pulsos SOLO salen cuando algo de verdad pasa de un robot a otro (un domicilio, un lead, un borrador, un SMS…):
// los dispara contar() cuando sube un número real. Ya no hay pulsos de adorno mientras un robot "trabaja".
// Fluidez (v1.80.0): solo se dibuja cuando algo se mueve (un dato viajando o un agente trabajando)
// o cuando cambió algo (medir, estados). En reposo el lienzo no se toca y el vidrio no se recalcula.
const hayMovimiento = () => particulas.length > 0 || lazos.some((l) => estado[l.a] === "trabajando" || estado[l.a] === "pensando");
function cuadro(t) {
  if (N8N()) { if (!estrellasLimpias) { xE.clearRect(0, 0, innerWidth, innerHeight); estrellasLimpias = true; } }
  else dibujarEstrellas(t);
  if (sucio || hayMovimiento()) { sucio = false; dibujarLazos(t); }
  requestAnimationFrame(cuadro);
}

// =====================================================================
// Estados de los robots (leídos del robotsito de cada pestaña)
// =====================================================================
const estado = {};
let capiUltimo = "", capiTimer = null;
function leerEstados() {
  for (const m of MODS) {
    if (window.robotApagado && robotApagado(m)) { // interruptor apagado
      const e = $("e-" + m);
      if (e && estado[m] !== "apagado") { estado[m] = "apagado"; for (const c of Object.keys(CHIP)) e.classList.remove(c); e.querySelector(".chip").textContent = "Apagado"; const box = e.querySelector(".msg"); if (box) box.textContent = ""; }
      continue;
    }
    const d = docDe(m), rb = d && d.querySelector(".rb");
    if (!rb) continue;
    const st = (rb.className.split(" ").find((c) => CHIP[c])) || "idle";
    const msg = ((rb.querySelector(".txt") || {}).textContent || "").trim();
    const e = $("e-" + m);
    if (estado[m] !== st) {
      if (estado[m] !== undefined) {
      }
      estado[m] = st; sucio = true;
      for (const c of Object.keys(CHIP)) e.classList.toggle(c, c === st);
      e.querySelector(".chip").textContent = CHIP[st];
    }
    // en reposo, "Listo para trabajar." no aporta nada: la tarjeta solo muestra lo importante
    const enReposo = (estado[m] === "idle" || !estado[m]) && /^(Listo para trabajar\.?|Esperando…?|Listo\.?)$/i.test(String(msg || "").trim());
    const txtMsg = enReposo ? "" : msg;
    const box = e.querySelector(".msg"); if (box && box.textContent !== txtMsg) box.textContent = txtMsg;
  }
  // Lo último que dijo Capi en su chat → burbuja
  const d = docDe("sv"), ms = d ? d.querySelectorAll("#chat .m.sv") : [];
  const ult = ms.length ? ms[ms.length - 1].textContent.trim() : "";
  if (ult && ult !== capiUltimo) {
    const primera = !capiUltimo; capiUltimo = ult;
    if (!primera || ms.length === 1) {
      const b = $("capiDice"); b.textContent = ult; b.hidden = false; b.style.animation = "none"; void b.offsetWidth; b.style.animation = "";
      clearTimeout(capiTimer); capiTimer = setTimeout(() => (b.hidden = true), 14000);
    }
  }
}

// =====================================================================
// Conteos y flujo de datos (los mismos números que el panel)
// =====================================================================
let prev = null;
// Muchos robots escriben a la vez: se recalcula máximo una vez cada 0.7 s (antes, en cada cambio)
let timerContar = null;
function contarPronto() { if (!timerContar) timerContar = setTimeout(() => { timerContar = null; contar(); }, 700); }
async function contar() {
  const n = await conteos(); // misma cuenta que el panel (comun.js)
  const svEventos = n.svEventos;

  poner("m-dom", n.dom); poner("m-bus", n.bus); poner("m-own", n.own); poner("m-lis", n.lis);
  $("e-pw").querySelector(".cuenta b").textContent = n.dom;
  $("e-bv2").querySelector(".cuenta b").textContent = n.bus2;
  $("e-ow2").querySelector(".cuenta").innerHTML = `<b>${n.own2}</b> leídos` + (n.pend2 ? ` · <b>+${n.pend2}</b>` : "");
  $("actualizadosHoy").textContent = n.acHechos;
  $("e-ac").querySelector(".cuenta").innerHTML = `<b>${n.acHechos}</b> actualizados` + (n.acBus ? ` · <b>${n.acBus}</b> en camino` : "");
  $("e-ch").querySelector(".cuenta").innerHTML = `<b>${n.rev}</b> por revisar · <b>${n.enLofty}</b> ya en Lofty`;
  $("e-bv").querySelector(".cuenta b").textContent = n.bus;
  $("e-ow").querySelector(".cuenta b").textContent = n.pend ? `${n.own} (+${n.pend})` : n.own;
  $("e-lf").querySelector(".cuenta b").textContent = n.lis;
  $("enviados").textContent = n.enviados;
  $("e-zb").querySelector(".cuenta").innerHTML = `<b>${n.zbRep}</b> repetidos · <b>${n.zbNue}</b> nuevos` + (n.zbRev ? ` · <b>${n.zbRev}</b> ?` : "");
  $("e-rd").querySelector(".cuenta").innerHTML = `<b>${n.rdHec}</b> borradores` + (n.rdPen ? ` · <b>${n.rdPen}</b> pendientes` : "");
  $("borradores").textContent = n.rdHec;
  $("e-ti").querySelector(".cuenta").innerHTML = `<b>${n.tiHec}</b> mandadas` + (n.tiPen ? ` · <b>${n.tiPen}</b> por mandar` : "");
  $("enTeams").textContent = n.tiHec;
  $("e-cp").querySelector(".cuenta").innerHTML = `<b>${n.cpLimpias || 0}</b> limpias · <b>${n.cpCarpetas || 0}</b> carpetas`;
  $("e-wb").querySelector(".cuenta").innerHTML = `<b>${n.wiPorSubir || 0}</b> listos · <b>${n.wiHoy || 0}</b> a Lofti hoy`;
  $("e-pr").querySelector(".cuenta").innerHTML = `<b>${n.prHecm || 0}</b> HECM · ${n.prHer || 0} herederos`;
  $("e-hr").querySelector(".cuenta").innerHTML = `<b>${n.hrHecm}</b> HECM · ${n.hrBrazo || 0} al brazo`;
  $("e-ch3").querySelector(".cuenta").innerHTML = `<b>${n.rev3}</b> por revisar · <b>${n.enLofty3}</b> ya en Lofty` + (n.filt3 ? ` · <b>${n.filt3}</b> filtradas` : "");
  $("e-bv3").querySelector(".cuenta").innerHTML = `<b>${n.bus3}</b> por buscar`;
  $("e-ow3").querySelector(".cuenta").innerHTML = `<b>${n.own3}</b> en lote` + (n.pend3 ? ` · <b>+${n.pend3}</b>` : "");
  $("e-wb3").querySelector(".cuenta").innerHTML = `<b>${n.wbBus3}</b> por hacer · <b>${n.wbLote3}</b> en lote` + (n.destino3 === "wb" ? " · <b>activo</b>" : "");
  $("e-wb3").classList.toggle("apagada", n.destino3 !== "wb"); $("e-bv3").classList.toggle("apagada", n.destino3 === "wb"); $("e-ow3").classList.toggle("apagada", n.destino3 === "wb");
  $("e-tx").querySelector(".cuenta").innerHTML = `<b>${n.txHoy}</b> SMS hoy`;
  $("e-cb").querySelector(".cuenta").innerHTML = `<b>${n.cbHoy || 0}</b> SMS hoy`;
  $("e-t2").querySelector(".cuenta").innerHTML = `<b>${n.t2Hoy || 0}</b> SMS hoy`;
  $("e-al").querySelector(".cuenta").innerHTML = `<b>${n.alHechos || 0}</b> leads hoy · <b>${n.alSms || 0}</b> SMS · <b>${n.alLlamadas || 0}</b> llamadas`;
  $("e-ra").querySelector(".cuenta").innerHTML = `<b>${n.raDatos || 0}</b> de ${n.raZips || 0} ZIP con datos`;
  $("e-te").querySelector(".cuenta").innerHTML = `<b>${n.teCalientes || 0}</b> calientes` + (n.teTop ? ` · top <b>${n.teTop}</b>` : "");
  $("e-li").querySelector(".cuenta").innerHTML = `<b>${n.liMovidos || 0}</b> movidos hoy` + (n.liRevisar ? ` · <b>${n.liRevisar}</b> revisar` : "");
  $("e-rs").querySelector(".cuenta").innerHTML = `<b>${n.rsAbiertos || 0}</b> por atender · <b>${n.rsInteresados || 0}</b> interesados`;
  $("e-rc").querySelector(".cuenta").innerHTML = `<b>${n.rcAbiertos || 0}</b> por atender · <b>${n.rcInteresados || 0}</b> interesados`;
  // Fase 4: robots de calidad y operación (lo que dejó cada uno en su última revisión)
  const { vaRes = {}, puRes = {}, cuRes = {}, qaRes = {}, anRes = {} } = await chrome.storage.local.get(["vaRes", "puRes", "cuRes", "qaRes", "anRes"]);
  const cta = (id, txt) => { const e = $("e-" + id); if (e) e.querySelector(".cuenta").textContent = txt; };
  cta("va", vaRes.t ? `${vaRes.malos || 0} no sirven · ${vaRes.dudosos || 0} revisar` : "sin revisar");
  cta("pu", puRes.t ? `${puRes.altos || 0} prioridad alta de ${puRes.total || 0}` : "sin calificar");
  cta("cu", cuRes.t ? `${cuRes.altas || 0} graves · ${cuRes.medias || 0} medios` : "sin auditar");
  cta("qa", qaRes.t ? `${qaRes.fallas || 0} fallas · ${qaRes.avisos || 0} avisos` : "sin revisar");
  cta("an", anRes.t ? `${anRes.sms || 0} SMS · ${anRes.respuesta || 0}% contestó` : "sin calcular");
  $("e-bv").classList.toggle("apagada", n.destino === "wb"); $("e-ow").classList.toggle("apagada", n.destino === "wb");

  if (prev) { // datos que se movieron → partículas
    if (n.dom > prev.dom) disparar("pw", "ch", n.dom - prev.dom);
    if (n.acBus > prev.acBus) disparar("ac", "bv2", n.acBus - prev.acBus);
    if (n.own2 > prev.own2) disparar("bv2", "ow2", n.own2 - prev.own2);
    if (n.acHechos > prev.acHechos) { disparar("ow2", "lf", n.acHechos - prev.acHechos); setTimeout(() => disparar("lf", "crm", n.acHechos - prev.acHechos, true), 900); }
    if (n.libres > prev.libres) disparar("ch", n.destino === "wb" ? "wb" : "bv", n.libres - prev.libres);
    if ((n.wiPorSubir || 0) > (prev.wiPorSubir || 0)) disparar("cp", "wb", n.wiPorSubir - (prev.wiPorSubir || 0));
    if ((n.wiHoy || 0) > (prev.wiHoy || 0)) disparar("wb", "lf", n.wiHoy - (prev.wiHoy || 0), true);
    if (prev.teT && (n.teT || 0) > prev.teT) disparar("ra", "te", Math.max(1, Math.min(5, n.teCalientes || 1)), true);
    if (n.buscados > prev.buscados || n.pend > prev.pend) disparar("bv", "ow", Math.max(n.buscados - prev.buscados, n.pend - prev.pend));
    if (n.own > prev.own) disparar("ow", "lf", n.own - prev.own);
    if (n.zbRep > prev.zbRep) disparar("zb", "rd", n.zbRep - prev.zbRep);
    if (n.rdHec > prev.rdHec) disparar("rd", "gm", n.rdHec - prev.rdHec, true);
    if (n.tiPen > prev.tiPen) disparar("gm", "ti", n.tiPen - prev.tiPen);
    if (n.tiHec > prev.tiHec) disparar("ti", "tm", n.tiHec - prev.tiHec, true);
    if ((n.prPasados || 0) > (prev.prPasados || 0)) disparar("pr", "hr", n.prPasados - (prev.prPasados || 0));
    if ((n.hrBrazo || 0) > (prev.hrBrazo || 0)) disparar("hr", "ch3", n.hrBrazo - (prev.hrBrazo || 0));
    if (n.libres3 > prev.libres3) disparar("ch3", n.destino3 === "wb" ? "wb3" : "bv3", n.libres3 - prev.libres3);
    if (n.own3 > prev.own3) disparar("bv3", "ow3", n.own3 - prev.own3);
    if (n.own3 > prev.own3) disparar("ow3", "lf", n.own3 - prev.own3);
    if (n.wbLote3 > prev.wbLote3) disparar("wb3", "lf", n.wbLote3 - prev.wbLote3);
    if ((n.liMovidos || 0) > (prev.liMovidos || 0)) disparar("crm", "li", n.liMovidos - (prev.liMovidos || 0));
    if (n.txHoy > prev.txHoy) disparar("crm", "tx", Math.min(8, n.txHoy - prev.txHoy), true);
    if ((n.cbHoy || 0) > (prev.cbHoy || 0)) disparar("crm", "cb", Math.min(8, n.cbHoy - (prev.cbHoy || 0)), true);
    if ((n.t2Hoy || 0) > (prev.t2Hoy || 0)) disparar("crm", "t2", Math.min(8, n.t2Hoy - (prev.t2Hoy || 0)), true);
    if (n.enviados > prev.enviados) disparar("lf", "crm", Math.min(12, n.enviados - prev.enviados), true);
  }
  prev = n;
  svEvs = svEventos; pintarLog();
  pintarMision();
}
function poner(id, v) {
  const e = $(id); if (e.textContent === String(v)) return;
  e.textContent = v; const c = e.parentElement; c.classList.remove("sube"); void c.offsetWidth; c.classList.add("sube");
}

// ---------- Bitácora ----------
let ultimoLog = "", svEvs = [], ultimaT = 0;
function pintarLog() {
  const evs = [...svEvs].sort((a, b) => a.t - b.t);
  const ult = evs.length + ":" + (evs.length ? evs[evs.length - 1].t : 0);
  if (ult === ultimoLog) return; ultimoLog = ult;
  $("log").innerHTML = "";
  const corte = ultimaT; ultimaT = evs.length ? evs[evs.length - 1].t : 0;
  for (const e of evs.slice(-60).reverse()) {
    const d = document.createElement("div");
    // solo los eventos nuevos entran con animación (antes se reanimaba toda la lista y se veía vacía)
    d.className = "ev" + (e.nivel === "error" ? " error" : "") + (corte && e.t > corte ? " nuevo" : "");
    d.style.setProperty("--c", COLOR[e.mod] || "#94a3b8");
    const h = new Date(e.t).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    d.innerHTML = `<span class="h">${h}</span> <span class="q">${NOMBRE[e.mod] || e.mod}</span> `;
    d.append(document.createTextNode(e.texto));
    $("log").append(d);
  }
}

// =====================================================================
// Misión (la corre el motor de Capi; aquí solo se manda y se ve)
// =====================================================================
const CORRIDO = 2000; // meta "sin límite": la misión sigue hasta que ya no hay domicilios nuevos
$("mCorrido").onchange = () => { $("mMeta").disabled = $("mCorrido").checked; };
chrome.storage.local.get(["zone", "mandoCorrido"]).then(({ zone, mandoCorrido }) => {
  if (zone && !$("mZona").value) $("mZona").value = zone;
  if (mandoCorrido) { $("mCorrido").checked = true; $("mMeta").disabled = true; }
});
const FASE = { wibi: "Wibi hace skip trace", propwire: "Propi junta domicilios", beenverified: "Veri busca dueños", owners: "Owny lee reportes", revisando: "Revisando avance", esperando: "Esperando tu OK" };
async function pintarMision() {
  const { mision, loftyListos: listos0 = 0, loftySubidos = 0 } = await chrome.storage.local.get(["mision", "loftyListos", "loftySubidos"]);
  // avance = listos por subir + los que Lofti ya subió desde que empezó la misión (igual que cuenta Capi)
  const loftyListos = listos0 + Math.max(0, loftySubidos - ((mision && mision.subidosBase) || 0));
  const activa = mision && ["corriendo", "pausada", "esperando_ok"].includes(mision.estado);
  $("misionVacia").hidden = !!activa; $("misionActiva").hidden = !activa;
  if (!activa) return;
  const corrido = mision.meta >= CORRIDO;
  document.querySelector(".tarjeta.mision").classList.toggle("es-corrido", corrido);
  $("mTxt").textContent = corrido ? `Trabajo corrido · ${mision.zona}` : `${mision.meta} leads de ${mision.zona}`;
  $("mBarra").style.width = Math.min(100, (loftyListos / mision.meta) * 100) + "%";
  $("mNum").textContent = corrido ? `${loftyListos} entregados a Lofti` : `${loftyListos} / ${mision.meta} listos`;
  $("mFase").textContent = mision.estado === "pausada" ? "En pausa" : mision.estado === "esperando_ok" ? "Esperando tu OK" : (FASE[mision.fase] || "Trabajando");
  $("mPausa").textContent = mision.estado === "pausada" ? "▶ Seguir" : "Pausar";
  $("mPausa").hidden = mision.estado === "esperando_ok";
  $("mSubir").hidden = mision.estado !== "esperando_ok";
}
async function capi(herr, args = {}) {
  const w = svWin();
  if (!w || typeof w.ejecutar !== "function") { alert("Capi todavía está cargando. Intenta en un segundo."); return null; }
  return await w.ejecutar(herr, args);
}
$("mIniciar").onclick = async () => {
  const corrido = $("mCorrido").checked;
  const zona = $("mZona").value.trim(), meta = corrido ? CORRIDO : parseInt($("mMeta").value, 10);
  if (!zona || !meta) { $("mZona").focus(); return; }
  chrome.storage.local.set({ mandoCorrido: corrido });
  const r = await capi("iniciar_mision", { zona, meta });
  if (r) { const w = svWin(); w && w.burbuja && w.burbuja("aviso", "Desde el Centro de Mando: " + r); }
  pintarMision();
};
$("mPausa").onclick = async () => {
  const { mision } = await chrome.storage.local.get("mision");
  if (!mision) return;
  await capi(mision.estado === "pausada" ? "seguir_mision" : "pausar_mision"); pintarMision();
};
$("mCancelar").onclick = async () => { if (confirm("¿Cancelar la misión?")) { await capi("cancelar_mision"); pintarMision(); } };
$("mSubir").onclick = async () => {
  if (!confirm("¿Subir a Lofty los leads listos?")) return;
  const r = await capi("subir_leads", {});
  const w = svWin(); r && w && w.burbuja && w.burbuja("aviso", "Subida desde el Centro de Mando: " + r);
  pintarMision();
};
$("mZona").onkeydown = (e) => { if (e.key === "Enter") $("mIniciar").click(); };

// ---------- Hablarle a Capi ----------
$("fCapi").onsubmit = (e) => {
  e.preventDefault();
  const t = $("tCapi").value.trim(); if (!t) return;
  const w = svWin();
  if (!w || typeof w.turno !== "function") { alert("Capi todavía está cargando."); return; }
  $("tCapi").value = "";
  w.burbuja("yo", t); w.turno(t);
};

// ---------- Reloj ----------
setInterval(() => ($("reloj").textContent = new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" })), 1000);

// ---------- Arranque ----------
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.zone || ch.chActivo || ch.loftyKey || ch.chDestino || ch.chDestino_hr) prev = null; // cambiar un ajuste no es mandar nada: sin pulsos
  if (ch.prCasos || ch.prResumen || ch.hrVistos || ch.hrCasos || ch.hrPasos || ch.cpResumen || ch.rsResumen || ch.rcResumen || ch.liResumen || ch.alResumen || ch.carpiRes || ch.wibiRes || ch.radarRes || ch.termiRes || ch.ch3Res || ch.chDestino_hr || ch.lote_hr || ch.lote_wb_hr || ch.bvPendientes_hr || ch.txHoy || ch.cbHoy || ch.t2Hoy || ch.zbLeads || ch.lote_wb || ch.chDestino || ch.addresses || ch.acTrabajos || ch.lote_ac || ch.bvPendientes_ac || ch.zone || ch.chActivo || ch.loftyKey || ch.bvState || ch.lote || ch.bvPendientes || ch.loftyListos || ch.svEventos || ch.vaRes || ch.puRes || ch.cuRes || ch.qaRes || ch.anRes) contarPronto();
  if (ch.mision || ch.loftySubidos || ch.loftyListos) pintarMision();
});
addEventListener("resize", () => { tamEstrellas(); medir(); });
$("escena").addEventListener("scroll", () => medir(), { passive: true });
new ResizeObserver(() => medir()).observe($("escena"));
tamEstrellas(); medir(); contar();
setInterval(leerEstados, 500);
chrome.storage.local.get(["mandoSonido", "mandoVolumen"]).then((d) => { sonido = !!d.mandoSonido; const v = d.mandoVolumen == null ? 0.6 : d.mandoVolumen; if (window.Sonidos) Sonidos.volumen = v; $("volSonido").value = String(Math.round(v * 100)); pintarSonido(); });
chrome.storage.local.set({ tabActiva: "mando" });
requestAnimationFrame(cuadro);

// Clic en el nombre de un brazo: trae al frente SU ventana de trabajo
document.querySelectorAll(".etq-col[data-brazo]").forEach((e) => {
  e.style.cursor = "pointer";
  e.onclick = async () => { const id = await ventanaTrabajo(e.dataset.brazo); await chrome.windows.update(id, { focused: true, state: "normal" }).catch(() => {}); };
});
