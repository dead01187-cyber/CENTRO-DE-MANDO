// =====================================================================
// Robotsitos: uno por sección (diseños propios, pixel art).
// Cambian de estado solos según lo que anota cada pestaña en la bitácora.
// Estados: idle, trabajando, feliz, error, ayuda (captcha/login), pausa.
// =====================================================================
// Tema de las pestañas: siempre estilo n8n (el tema neón se quitó)
(function () {
  try { document.documentElement.classList.add("n8n"); } catch (e) {}
})();
(function () {
  const ROBOTS = {
    pw: { nombre: "Propi", rol: "Busca domicilios en Propwire", color: "#0f766e", claro: "#99f6e4", oscuro: "#134e4a",
      mapa: ["......A.......", "......X.......", "..XXXXXXXXXX..", "..XLLLLLLLLX..", "..XLDDLLDDLX..", "..XLDWLLDWLX..",
             "..XLLLLLLLLX..", "..XLLDDDDLLX..", "..XXXXXXXXXX..", "....XXXXXX....", "..XXXXXXXXXX..", "XXXXXXXXXXXXXX", "..XX......XX.."] },
    ac: { nombre: "Acti", rol: "Actualiza leads que ya están en Lofty", color: "#ea580c", claro: "#fed7aa", oscuro: "#7c2d12",
      mapa: ["...A....A.....", "...X....X.....", "..XXXXXXXXXX..", "..XLLLLLLLLX..", "..XLWDLLWDLX..", "..XLDDLLDDLX..",
             "..XLLLLLLLLX..", "..XLDLLLLDLX..", "..XLLDDDDLLX..", "..XXXXXXXXXX..", "R.XXXXXXXXXX.R", "RRXX.XXXX.XXRR", "...XX....XX..."] },
    ch: { nombre: "Chequi", rol: "Revisa que no estén ya en Lofty", color: "#db2777", claro: "#fbcfe8", oscuro: "#831843",
      mapa: ["......A.......", "......X.......", "...XXXXXXXX...", "..XXXXXXXXXX..", "..XLLLLLLLLX..", "..XLDWLLDWLX..",
             "..XLLLLLLLLX..", "..XLLLDDLLLX..", "..XXXXXXXXXX..", ".RRXXXXXXXXRR.", ".RR.XXXXXX.RR.", "....XX..XX....", "...RRR..RRR..."] },
    bv: { nombre: "Veri", rol: "Busca los dueños en BeenVerified", color: "#4f46e5", claro: "#c7d2fe", oscuro: "#312e81",
      mapa: ["..A........A..", "..X........X..", "..XXXXXXXXXX..", ".XXXXXXXXXXXX.", ".XXDDDDDDDDXX.", ".XXDWWDDWWDXX.",
             ".XXDDDDDDDDXX.", ".XXXXXXXXXXXX.", "..XXXLLLLXXX..", "....XXXXXX....", "..XXXXXXXXXX..", "..X.XXXXXX.X..", "....XX..XX...."] },
    ow: { nombre: "Owny", rol: "Saca owner y teléfonos", color: "#16a34a", claro: "#bbf7d0", oscuro: "#14532d",
      mapa: ["........A.....", "......RRR.....", "....RRRRRR....", "..RRRRRRRRRR..", "..XXXXXXXXXX..", "..XLLLLLLLLX..",
             "..XLDWLLDWLX..", "..XLDDLLDDLX..", "..XLLLDDLLLX..", "..XXXXXXXXXX..", "....XXXXXX....", "..XXXXXXXXXX..", "...XX....XX..."] },
    lf: { nombre: "Lofti", rol: "Limpia y sube los leads a Lofty", color: "#0a84ff", claro: "#bfdbfe", oscuro: "#1e3a8a",
      mapa: ["......A.......", ".....AAA......", "......X.......", "..XXXXXXXXXX..", "..XLLLLLLLLX..", "..XLWDLLWDLX..",
             "..XLDDLLDDLX..", "..XLLLLLLLLX..", "..XLLDLLDLLX..", "..XLLLDDLLLX..", "..XXXXXXXXXX..", "...XXXXXXXX...", "...XX....XX..."] },
    sv: { nombre: "Capi", rol: "Coordina a los robots y te habla", color: "#b45309", claro: "#fde68a", oscuro: "#78350f",
      mapa: ["...RRRRRRRR...", "..RRRRRRRRRRA.", "..XXXXXXXXXX..", ".DXLLLLLLLLXD.", ".DXLDDLLDDLXD.", ".DXLDWLLDWLXD.",
             "..XLLLLLLLLX..", "..XLLDDDDLLXD.", "..XXXXXXXXXXD.", "....XXXXXX....", "..XXXXXXXXXX..", "..XX.XXXX.XX..", "....XX..XX...."] },
  };

  // Brazo de zBuyer: Zeta (lee Gmail y compara con Lofty) y Redi (redacta el borrador)
  ROBOTS.zb = { nombre: "Zeta", rol: "Lee los leads de zBuyer en Gmail y los compara con Lofty", color: "#0891b2", claro: "#a5f3fc", oscuro: "#164e63",
    mapa: ["..A........A..", "...X......X...", "..XXXXXXXXXX..", "..XLLLLLLLLX..", "..XLWDLLWDLX..", "..XLDDLLDDLX..",
           "..XLLLLLLLLX..", "..XLLDDDDLLX..", "..XXXXXXXXXX..", "RRRRRRRR.XX...", "RLRLLRLR.XXXX.", "RLLRRLLR.XX...", "RRRRRRRRXX.XX."] };
  ROBOTS.rd = { nombre: "Redi", rol: "Redacta el borrador de reclamo a zBuyer", color: "#7c3aed", claro: "#ddd6fe", oscuro: "#4c1d95",
    mapa: ["......A.......", "......X.......", "..XXXXXXXXXX..", "..XLLLLLLLLX..", "..XLDWLLDWLX..", "..XLDDLLDDLX..",
           "..XLLLLLLLLX..", "..XLLLDDLLLX..", "..XXXXXXXXXX..", "....XXXXXX..R.", "..XXXXXXXXXRR.", "..XX.XXXX.RR..", "....XX..XRA..."] };

  ROBOTS.ti = { nombre: "Timi", rol: "Manda a Teams la captura del reclamo", color: "#2563eb", claro: "#bfdbfe", oscuro: "#1e3a8a",
    mapa: ["......A.......", "......X.......", "..XXXXXXXXXX..", "..XLLLLLLLLX..", "..XLWDLLWDLX..", "..XLDDLLDDLX..",
           "..XLLLLLLLLX..", "..XLLDDDDLLX..", "..XXXXXXXXXX..", ".RRRR.XXXX....", ".RLLR.XXXXXX..", ".RRRR.XX..X...", "......XX..XX.."] };

  ROBOTS.wb = { nombre: "Wibi", rol: "Pasa a Lofti los leads de Propwire (tag ciudad + propwire)", color: "#ca8a04", claro: "#fef08a", oscuro: "#713f12",
    mapa: ["...A....A.....", "...X....X.....", "..XXXXXXXXXX..", "..XLLLLLLLLX..", "..XLDWLLDWLX..", "..XLDDLLDDLX..",
           "..XLLLLLLLLX..", "..XLLLDDLLLX..", "..XXXXXXXXXX..", "....XXXXXX.RR.", "..XXXXXXXXRLLR", "..XX.XXXX.RLLR", "....XX..XX.RR."] };

  ROBOTS.ra = { nombre: "Radar", rol: "Junta señales de venta por ZIP (OC y LA) con ritmo humano", color: "#dc2626", claro: "#fecaca", oscuro: "#7f1d1d",
    mapa: ["....AAAAA.....", "...A.....A....", "......X.......", "..XXXXXXXXXX..", "..XLLLLLLLLX..", "..XLWDLLWDLX..", "..XLDDLLDDLX..",
           "..XLLLLLLLLX..", "..XLLDDDDLLX..", "..XXXXXXXXXX..", "...XX....XX...", "..XXXX..XXXX..", "...XX....XX..."] };
  ROBOTS.te = { nombre: "Termi", rol: "Califica las zonas de 0 a 100", color: "#ea580c", claro: "#fed7aa", oscuro: "#7c2d12",
    mapa: ["......A.......", "......X.......", "..XXXXXXXXXX..", "..XLLLLLLLLX..", "..XLWDLLWDLX..", "..XLDDLLDDLX..",
           "..XLLLLLLLLX..", "..XLLDDDDLLX..", "..XXXXXXXXXX..", "...XX..XX.RR..", "..XXXX.XXXRR..", "...XX..XX.RR..", "..XX....XXRR.."] };
  ROBOTS.cp = { nombre: "Carpi", rol: "Limpia el CSV de Propwire y te da el archivo para importar", color: "#0e7490", claro: "#a5f3fc", oscuro: "#155e75",
    mapa: ["......A.......", "......X.......", "..XXXXXXXXXX..", "..XLLLLLLLLX..", "..XLWDLLWDLX..", "..XLDDLLDDLX..",
           "..XLLLLLLLLX..", "..XLLDDDDLLX..", "..XXXXXXXXXX..", "..XXXX.AAA....", "XXXXXX.ALAAAA.", "..XX...AAAAAA.", "..XX..XAAAAAA."] };
  ROBOTS.hr = { nombre: "Heri", rol: "Busca HECM (Celink / HUD) con Notice of Default", color: "#b45309", claro: "#fde68a", oscuro: "#78350f",
    mapa: ["..A......A....", "..X......X....", "..XXXXXXXXXX..", "..XLLLLLLLLX..", "..XLDWLLDWLX..", "..XLDDLLDDLX..",
           "..XLLLLLLLLX..", "..XLLLDDLLLX..", "..XXXXXXXXXX..", "...RRRRRR.XX..", "..RLLRRLLR.XXX", "..RLLLLLLR.XX.", "..RRRRRRRR...."] };
  ROBOTS.tx = { nombre: "Texi", rol: "Manda SMS a los leads Seller que escojas", color: "#059669", claro: "#a7f3d0", oscuro: "#064e3b",
    mapa: ["......A.......", "......X.......", "..XXXXXXXXXX..", "..XLLLLLLLLX..", "..XLWDLLWDLX..", "..XLDDLLDDLX..",
           "..XLLLLLLLLX..", "..XLLDDDDLLX..", "..XXXXXXXXXX..", "..RRRRRR.XX...", "..RLLLLR.XXXX.", "..RRRRRR.XX...", "....R...XX.XX."] };

  ROBOTS.rs = { nombre: "Resi", rol: "Lee las respuestas a los SMS y da seguimiento", color: "#0d9488", claro: "#99f6e4", oscuro: "#134e4a",
    mapa: ["...A....A.....", "...X....X.....", "..XXXXXXXXXX..", "..XLLLLLLLLX..", "..XLWDLLWDLX..", "..XLDDLLDDLX..",
           "..XLLLLLLLLX..", "..XLDLLLLDLX..", "..XLLDDDDLLX..", "..XXXXXXXXXX..", ".RRRRR..XX....", ".RLLLR.XXXX...", "..R.......XX.."] };
  ROBOTS.al = { nombre: "Marki", rol: "Agente Lofty: marca a los leads, manda SMS y mueve el pipeline", color: "#2563eb", claro: "#bfdbfe", oscuro: "#1e3a8a",
    mapa: ["......A.......", "......X.......", "..XXXXXXXXXX..", "..XLLLLLLLLX..", "..XLWDLLWDLX..", "..XLDDLLDDLX..",
           "..XLLLLLLLLX..", "..XLLDDDDLLX..", "..XXXXXXXXXX..", "...XX..XX.DD..", "..XXXX.XXDDDD.", "...XX..XX.DD..", "..XX....XX...."] };
  ROBOTS.li = { nombre: "Limpi", rol: "Limpia todo el CRM (sellers y buyers)", color: "#e11d48", claro: "#fecdd3", oscuro: "#881337",
    mapa: [".....A......D.", ".....X......D.", "..XXXXXXXXX.D.", "..XLLLLLLLX.D.", "..XLWDLWDLX.D.", "..XLDDLDDLX.D.", 
           "..XLLLLLLLX.D.", "..XLLDDDLLX.D.", "..XXXXXXXXXXD.", "...XX...XX.RRR", "..XXXX.XXXXRRR", "...XX...XX.RRR", "..XX.....XX..."] };
  ROBOTS.pr = { ...ROBOTS.hr, nombre: "Prope", rol: "Saca de Properant las HECM en ejecución (herederos)", color: "#a16207", claro: "#fef08a", oscuro: "#422006" };
  // Clones de la línea HECM (Heri): mismo robot, color ámbar
  ROBOTS.ch3 = { ...ROBOTS.ch, nombre: "Chequi 3", rol: "Revisa en Lofty las HECM de Heri", color: "#d97706", claro: "#fde68a", oscuro: "#78350f" };
  ROBOTS.bv3 = { ...ROBOTS.bv, nombre: "Veri 3", rol: "Busca en BeenVerified a los herederos (HECM)", color: "#ea580c", claro: "#fed7aa", oscuro: "#7c2d12" };
  ROBOTS.ow3 = { ...ROBOTS.ow, nombre: "Owny 3", rol: "Lee los reportes de las HECM", color: "#ca8a04", claro: "#fef08a", oscuro: "#713f12" };
  ROBOTS.wb3 = { ...ROBOTS.wb, nombre: "Wibi 3", rol: "Skip trace en Propwire de las HECM", color: "#a16207", claro: "#fde68a", oscuro: "#422006" };
  // Fase 4: robots nuevos (mismo cuerpo, su propio color)
  ROBOTS.va = { ...ROBOTS.ch, nombre: "Vali", rol: "", color: "#0891b2", claro: "#a5f3fc", oscuro: "#164e63" };
  ROBOTS.cu = { ...ROBOTS.rd, nombre: "Cumpli", rol: "", color: "#7c3aed", claro: "#ddd6fe", oscuro: "#4c1d95" };
  ROBOTS.qa = { ...ROBOTS.te, nombre: "Qai", rol: "", color: "#0f766e", claro: "#99f6e4", oscuro: "#134e4a" };
  ROBOTS.pu = { ...ROBOTS.wb, nombre: "Punti", rol: "", color: "#ca8a04", claro: "#fef08a", oscuro: "#713f12" };
  ROBOTS.an = { ...ROBOTS.ra, nombre: "Ana", rol: "", color: "#db2777", claro: "#fbcfe8", oscuro: "#831843" };
  // Clones de la línea de Acti: mismo robot, otro color
  ROBOTS.bv2 = { ...ROBOTS.bv, nombre: "Veri 2", rol: "Busca en BeenVerified los leads de Acti", color: "#c026d3", claro: "#f5d0fe", oscuro: "#701a75" };
  ROBOTS.ow2 = { ...ROBOTS.ow, nombre: "Owny 2", rol: "Lee los reportes de los leads de Acti", color: "#65a30d", claro: "#d9f99d", oscuro: "#365314" };

  // Fase 2: nombre y rol salen del registro central (registro.js); aquí solo vive el dibujo
  if (window.REGISTRO) for (const [k, r] of Object.entries(ROBOTS)) { const x = REGISTRO.ROBOTS[k]; if (x) { r.nombre = x.nombre; r.rol = x.rol; } }

  function robotSVG(mod) {
    const r = ROBOTS[mod]; if (!r) return "";
    const col = { X: r.color, L: r.claro, R: r.oscuro, D: "#0f172a", W: "#ffffff", A: "#fde047" };
    let s = "";
    r.mapa.forEach((fila, y) => [...fila].forEach((c, x) => {
      if (!col[c]) return;
      const cls = c === "A" ? ' class="luz"' : (c === "W" || (c === "D" && y >= 4 && y <= 6)) ? ' class="ojo"' : "";
      s += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${col[c]}"${cls}/>`;
    }));
    return `<svg viewBox="0 0 14 13" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
  }
  window.ROBOTS = ROBOTS;
  window.robotSVG = robotSVG;

  const MOD = document.documentElement.dataset.mod;
  // Interruptor: si el jefe apagó este robot, la página no trabaja (se cambia por la de "apagado")
  if (MOD && MOD !== "sv" && window.chrome && chrome.storage) chrome.storage.local.get("robotsApagados").then(({ robotsApagados = {} }) => {
    if (robotsApagados[MOD]) location.replace("apagado.html?m=" + encodeURIComponent(MOD));
  }).catch(() => {});
  const R = ROBOTS[MOD];
  if (!R) return; // panel principal: solo usa robotSVG

  const oscuro = MOD === "lf";
  const css = document.createElement("style");
  css.textContent = `
  .rb { display:flex; align-items:center; gap:10px; padding:8px 12px; border-bottom:1px solid ${oscuro ? "#2a2a30" : "#e2e8f0"};
        background:${oscuro ? "#151518" : "#fff"}; color:${oscuro ? "#f2f2f4" : "#0f172a"}; font:12px/1.35 -apple-system, system-ui, sans-serif; position:sticky; top:0; z-index:50; }
  .rb .ico { width:38px; height:35px; flex:none; }
  .rb .ico svg { width:38px; height:35px; display:block; image-rendering:pixelated; }
  .rb b { font-size:13px; }
  .rb .rol { color:${oscuro ? "#8d8d96" : "#64748b"}; }
  .rb .txt { color:${oscuro ? "#c7c7cc" : "#334155"}; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .rb .chip { margin-left:auto; flex:none; font-size:10px; font-weight:700; padding:2px 7px; border-radius:99px; background:${R.claro}; color:${R.oscuro}; }
  .rb.idle .ojo { animation: rbParp 3.2s steps(1) infinite; }
  .rb.trabajando .ico svg { animation: rbBob .6s steps(2) infinite; }
  .rb.trabajando .luz { animation: rbLuz .5s steps(1) infinite; }
  .rb.feliz .ico svg { animation: rbSalto .5s ease-out 3; }
  .rb.feliz .luz { fill:#22c55e; }
  .rb.error .luz { fill:#ef4444; }
  .rb.error .ico svg { animation: rbTiembla .25s linear 4; }
  .rb.ayuda { background:${oscuro ? "#3b1414" : "#fef2f2"}; }
  .rb.ayuda .luz { animation: rbRoja .4s steps(1) infinite; }
  .rb.ayuda .ico svg { animation: rbBob 1s steps(2) infinite; }
  .rb.pausa .luz { fill:#f59e0b; }
  .rb.pensando .luz { animation: rbAzul .7s steps(1) infinite; }
  .rb.pensando .ico svg { animation: rbBob 1.2s steps(2) infinite; }
  @keyframes rbAzul { 0% { fill:#38bdf8 } 50% { fill:#e0f2fe } }
  .rb.pausa .ojo { animation: rbParp 1.6s steps(1) infinite; }
  @keyframes rbParp { 0%,90% { opacity:1 } 91%,100% { opacity:0 } }
  @keyframes rbBob { 0% { transform:translateY(0) } 50% { transform:translateY(-2px) } }
  @keyframes rbLuz { 0% { fill:#fde047 } 50% { fill:#ffffff } }
  @keyframes rbRoja { 0% { fill:#ef4444 } 50% { fill:#fecaca } }
  @keyframes rbSalto { 0% { transform:translateY(0) } 40% { transform:translateY(-5px) } 100% { transform:translateY(0) } }
  @keyframes rbTiembla { 0%,100% { transform:translateX(0) } 25% { transform:translateX(-2px) } 75% { transform:translateX(2px) } }`;
  document.head.appendChild(css);

  const CHIP = { idle: "Listo", trabajando: "Trabajando", feliz: "¡Terminé!", error: "Error", ayuda: "Necesito ayuda", pausa: "Pausa", pensando: "Pensando" };
  const bar = document.createElement("div");
  bar.className = "rb idle";
  bar.innerHTML = `<div class="ico">${robotSVG(MOD)}</div><div><b>${R.nombre}</b> <span class="rol">· ${R.rol}</span><div class="txt">Listo para trabajar.</div></div><span class="chip">Listo</span>`;
  const poner = () => document.body.insertBefore(bar, document.body.firstChild);
  if (document.body) poner(); else document.addEventListener("DOMContentLoaded", poner);

  let timer = null;
  // Fase 5: el estado de cada robot se guarda en storage ("rbEstado_<robot>") para que el tablero lo lea sin tocar las páginas.
  // Con freno: como mucho una escritura cada 2 s por robot (y siempre la última).
  let pendienteEst = null, timerEst = null;
  function guardarEstado(estado, texto) {
    pendienteEst = { estado, texto: String(texto || bar.querySelector(".txt").textContent || "").slice(0, 200), t: Date.now() };
    if (timerEst) return;
    timerEst = setTimeout(() => { timerEst = null; try { chrome.storage.local.set({ ["rbEstado_" + MOD]: pendienteEst }); } catch (e) {} }, 2000);
  }
  function set(estado, texto) {
    bar.className = "rb " + estado;
    bar.querySelector(".chip").textContent = CHIP[estado] || estado;
    if (texto) bar.querySelector(".txt").textContent = texto;
    guardarEstado(estado, texto);
    clearTimeout(timer);
    // si deja de haber movimiento, vuelve a descansar
    if (estado === "trabajando") timer = setTimeout(() => set("idle", "Esperando…"), 30000);
    if (estado === "feliz") timer = setTimeout(() => set("idle"), 25000);
  }
  window.robot = { set, nombre: R.nombre };

  // Leer el estado de lo que la pestaña anota en la bitácora
  const AYUDA = /pide (verificación|iniciar sesi)|captcha|necesita tu ayuda|resuelvas la verificación/i;
  const FELIZ = /^(Listo|¡Listo|Terminado|Enviados a Lofty|Descargados|Copiados|Recolecté|Gracias)|Pasé \d+|Fantasmita: ¡Listo/i;
  const PAUSA = /^(Parado|Detenido|Pausa|Tomando una pausa|Esperando que resuelvas)/i;
  const orig = window.svLog;
  if (orig) window.svLog = function (texto, nivel) {
    orig(texto, nivel);
    const t = String(texto || "");
    const n = nivel || (/no pude|no se pudo|error|fall[óo]|no encontr|interrump|rechaz/i.test(t) ? "error" : "info");
    if (AYUDA.test(t)) set("ayuda", t);
    else if (n === "error") set("error", t);
    else if (FELIZ.test(t)) set("feliz", t);
    else if (PAUSA.test(t)) set("pausa", t);
    else set("trabajando", t);
  };
})();
