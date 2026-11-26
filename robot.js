// =====================================================================
// Agentes: uno por sección, con su ícono de línea (Lucide) y su color.
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
    sv: { nombre: "Capi", rol: "Coordina a los agentes y te habla", color: "#b45309", claro: "#fde68a", oscuro: "#78350f",
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

  ROBOTS.ry = { ...ROBOTS.tx, nombre: "Rayo", rol: "Llega antes que Anna a los leads nuevos", color: "#f59e0b", claro: "#fde68a", oscuro: "#78350f" };
  ROBOTS.t2 = { ...ROBOTS.tx, nombre: "Texi 2", rol: "Manda SMS a leads Seller desde otra cuenta de Lofty", color: "#10b981", claro: "#a7f3d0", oscuro: "#064e3b" };
  ROBOTS.cb = { ...ROBOTS.tx, nombre: "Compri", rol: "Manda SMS a los leads Buyer que escojas", color: "#0ea5e9", claro: "#bae6fd", oscuro: "#0c4a6e" };
  ROBOTS.rs = { nombre: "Resi", rol: "Lee las respuestas a los SMS y da seguimiento", color: "#0d9488", claro: "#99f6e4", oscuro: "#134e4a",
    mapa: ["...A....A.....", "...X....X.....", "..XXXXXXXXXX..", "..XLLLLLLLLX..", "..XLWDLLWDLX..", "..XLDDLLDDLX..",
           "..XLLLLLLLLX..", "..XLDLLLLDLX..", "..XLLDDDDLLX..", "..XXXXXXXXXX..", ".RRRRR..XX....", ".RLLLR.XXXX...", "..R.......XX.."] };
  ROBOTS.rc = { ...ROBOTS.rs, nombre: "Resi 2", rol: "Lee las respuestas a los SMS de Compri (Buyer)", color: "#0284c7", claro: "#bae6fd", oscuro: "#0c4a6e" };
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
  ROBOTS.nv = { ...ROBOTS.ra, nombre: "Navi", rol: "Maneja tu Brave con Browser Use (recetas fijas)", color: "#7c3aed", claro: "#ddd6fe", oscuro: "#4c1d95" };
  // Clones de la línea de Acti: mismo robot, otro color
  ROBOTS.bv2 = { ...ROBOTS.bv, nombre: "Veri 2", rol: "Busca en BeenVerified los leads de Acti", color: "#c026d3", claro: "#f5d0fe", oscuro: "#701a75" };
  ROBOTS.ow2 = { ...ROBOTS.ow, nombre: "Owny 2", rol: "Lee los reportes de los leads de Acti", color: "#65a30d", claro: "#d9f99d", oscuro: "#365314" };

  // Fase 2: nombre y rol salen del registro central (registro.js); aquí solo vive el dibujo
  if (window.REGISTRO) for (const [k, r] of Object.entries(ROBOTS)) { const x = REGISTRO.ROBOTS[k]; if (x) { r.nombre = x.nombre; r.rol = x.rol; } }

  // Íconos de línea (Lucide v0.469.0, licencia ISC: https://lucide.dev/license). Uno por función.
  const FORMAS = {
    "zap": '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    "key-round": '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
    "layout-dashboard": '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    "sparkles": '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
    "map-pin": '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    "list-checks": '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    "search": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    "user-round": '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    "cloud-upload": '<path d="M12 13v8"/><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m8 17 4-4 4 4"/>',
    "refresh-cw": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    "mail": '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    "file-pen": '<path d="M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M13.378 15.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>',
    "send": '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    "scan-search": '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/><path d="m16 16-1.9-1.9"/>',
    "folder": '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    "landmark": '<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
    "house": '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    "message-square": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    "message-square-reply": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="m10 7-3 3 3 3"/><path d="M17 13v-1a2 2 0 0 0-2-2H7"/>',
    "phone": '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    "eraser": '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
    "radar": '<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><path d="M12 18h.01"/><path d="M17.99 11.66A6 6 0 0 1 15.77 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>',
    "thermometer": '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
    "badge-check": '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
    "gauge": '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    "shield-check": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    "activity": '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    "chart-column": '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    "database": '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
    "compass": '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>',
  };
  const ICONO = {"sv":"sparkles", "pw":"map-pin", "ch":"list-checks", "ch3":"list-checks", "bv":"search", "bv2":"search", "bv3":"search", "ow":"user-round", "ow2":"user-round", "ow3":"user-round", "lf":"cloud-upload", "ac":"refresh-cw", "zb":"mail", "rd":"file-pen", "ti":"send", "wb":"scan-search", "wb3":"scan-search", "cp":"folder", "pr":"landmark", "hr":"house", "tx":"message-square", "rs":"message-square-reply", "al":"phone", "li":"eraser", "ra":"radar", "te":"thermometer", "va":"badge-check", "pu":"gauge", "cu":"shield-check", "qa":"activity", "an":"chart-column", "gm":"mail", "tm":"users", "crm":"database", "tb":"layout-dashboard", "cb":"key-round", "t2":"message-square", "ry":"zap", "rc":"message-square-reply", "nv":"compass"};

  // Ícono de cada agente: línea fina del color de su sección (antes era pixel art; los mapas se quedan solo como color)
  function robotSVG(mod) {
    const r = ROBOTS[mod], f = FORMAS[ICONO[mod]]; if (!f) return "";
    const color = r ? `color-mix(in srgb, ${r.color} 70%, #fff)` : "rgba(255,255,255,.85)";
    return `<svg class="ico-linea" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="color:${color}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${f}</svg>`;
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
