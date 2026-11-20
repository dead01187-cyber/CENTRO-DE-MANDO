const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lote = []; // { owner, phones: [{num, type}], address, url }

// =====================================================================
// Esta función se inyecta en la página: busca owner, teléfonos y propiedad
// =====================================================================
async function extractor(opts) {
  // ---- 0. Reporte de propiedad de BeenVerified: formato conocido ----
  // "Ownership" → nombre del owner; "Possible Residents" → tarjetas con rol (Owner / Previous Resident) y "Phone:".
  // Solo se toman teléfonos de las tarjetas con rol Owner; nunca los de residentes anteriores.
  if (/beenverified\.com$/i.test(location.hostname) && /\/report\/property/i.test(location.pathname)) {
    const L = (document.body.innerText || "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    const RE_T = /(?<!\d)(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})(?!\d)/g;
    const iOwn = L.findIndex((l) => /^Ownership$/i.test(l));
    const nombreOwnership = iOwn >= 0 ? (L[iOwn + 1] || "") : "";
    const iRes = L.findIndex((l) => /Possible Residents$/i.test(l));
    const tarjetas = [];
    if (iRes >= 0) {
      let cur = null;
      for (let i = iRes + 1; i < L.length; i++) {
        const l = L[i];
        if (/^(Legal & Deeds|Local Market Insights|Neighborhood Insights|Next Steps|Deeds|Liens|Permits)$/i.test(l)) break;
        if (/^[A-Z]{1,3}$/.test(l) && /[a-z]/.test(L[i + 1] || "") && L[i + 2] && !/\d/.test(L[i + 1])) {
          cur = { nombre: L[i + 1], rol: L[i + 2], phones: [] };
          tarjetas.push(cur); i += 2; continue;
        }
        if (cur) for (const m of l.matchAll(RE_T)) {
          const num = `(${m[1]}) ${m[2]}-${m[3]}`;
          if (!cur.phones.some((p) => p.num === num)) cur.phones.push({ num, tipo: "" });
        }
      }
    }
    const duenos = tarjetas.filter((t) => /owner/i.test(t.rol));
    const owners = duenos.length ? duenos.map((t) => ({ nombre: t.nombre, phones: t.phones }))
      : (nombreOwnership && !/^\$|^\d/.test(nombreOwnership) ? [{ nombre: nombreOwnership, phones: [] }] : []);
    const m2 = [L[0], document.title].join("\n").match(/\d{1,6}[A-Z]?\s+[^,\n]+?\s+[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}/);
    return { url: location.href, direccion: m2 ? m2[0] : "", owners, sinAsignar: [], cargando: iOwn < 0 && iRes < 0 };
  }
  // ---- 1. Copiar todo el texto, como Cmd+A ----
  let textoTotal = "";
  try {
    const sel = window.getSelection();
    const antes = [];
    for (let k = 0; k < sel.rangeCount; k++) antes.push(sel.getRangeAt(k));
    sel.selectAllChildren(document.body);
    textoTotal = sel.toString();
    sel.removeAllRanges();
    antes.forEach((r) => sel.addRange(r));
  } catch (e) { /* si falla, usamos innerText */ }
  if (!textoTotal || textoTotal.trim().length < 20) textoTotal = document.body.innerText || "";

  // ---- 2. Texto en líneas ----
  const lineas = textoTotal
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

  // ---- 3. Patrones ----
  const RE_TEL = /(?<!\d)(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})(?!\d)/g;
  // número + calle (con o sin sufijo, ej. "12 Gingerwood") + , Ciudad, ST 12345
  const RE_DIR = /\b\d{1,6}[A-Z]?\s+[A-Za-z0-9#.' -]{2,60}?,\s*[A-Za-z][A-Za-z .'-]{1,30},?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/;
  const RE_OWNER = /^(?:current\s+|property\s+|registered\s+)?(?:owner|owners|owner\(s\)|propietarios?|due[ñn]os?)(?:\s*(?:name|names|1|2|3|#\s?\d|information|info|de la propiedad))?\s*[:\-]?\s*(.*)$/i;
  const PALABRAS_NO = /\b(owner|owners|name|information|details|property|address|phone|phones|email|view|report|unknown|mailing|contact|resident|residents|show|more|sale|tax|value|history|record|records|search|results|bedroom|bath|sq|ft|year|built|type|status|occupied|vacant|equity|mortgage|lien|county|parcel|apn|wireless|landline|mobile|see|all|none|n\/a|login|sign|menu|home|people|possible|associated|relatives|neighbors|taxes|fees|fee|hoa|insurance|assessment|assessed|payment|payments|price|estimate|estimated|total|amount|annual|monthly|school|schools|district|zoning|lot|size|land|use|occupancy|transfer|deed|loan|lender|balance|open|market|listing|agent|broker|details|overview|summary|map|photos|street|comparables|comps|demographics|crime|utilities|permits|foreclosure|owned|length|ownership|absentee|occupied|rate|interest|purchase|sold|last|first|cost|costs|details|bank|title|company|info|more|less|unlock|upgrade|premium|free)\b/i;
  const RE_TIPO = /\b(wireless|mobile|cell(?:ular)?|landline|land line|voip|fixed)\b/i;

  function pareceNombre(s) {
    if (!s || s.length < 4 || s.length > 70) return false;
    if (/\d|[:@/()|]/.test(s)) return false;
    if (PALABRAS_NO.test(s)) return false;
    const pal = s.split(" ").filter(Boolean);
    if (pal.length < 2 || pal.length > 7) return false;
    return pal.every((p) => /^[A-Za-zÀ-ÿ.,'&-]+$/.test(p));
  }

  function separarNombres(s) {
    // "JOHN & JANE SMITH" -> ["JOHN SMITH", "JANE SMITH"]
    const partes = s.split(/\s*(?:&|;|\band\b|\/)\s*/i).map((p) => p.trim()).filter(Boolean);
    const apellido = (partes[partes.length - 1] || "").split(" ").slice(-1)[0];
    return partes.map((p) => (p.split(" ").length === 1 && apellido ? `${p} ${apellido}` : p))
      .filter((p) => p.split(" ").length >= 2);
  }

  function telefonos(linea) {
    const out = [];
    for (const m of linea.matchAll(RE_TEL)) out.push(`(${m[1]}) ${m[2]}-${m[3]}`);
    return out;
  }

  // ---- 4. Propiedad ----
  let direccion = "";
  const h1 = document.querySelector("h1")?.innerText?.replace(/\s+/g, " ") || "";
  for (const fuente of [h1, document.title]) {
    const m = fuente.match(RE_DIR);
    if (m) { direccion = m[0]; break; }
  }
  if (!direccion) {
    // buscar en una línea o en dos líneas juntas ("123 Main St" + "Irvine, CA 92620")
    const candidatos = [];
    for (let i = 0; i < lineas.length; i++) {
      const una = lineas[i].match(RE_DIR);
      const dos = !una && lineas[i + 1] ? (lineas[i] + ", " + lineas[i + 1]).match(RE_DIR) : null;
      const m = una || dos;
      if (m) {
        const cercaEtiqueta = lineas.slice(Math.max(0, i - 3), i + 1).some((l) => /property|propiedad|address|direcci/i.test(l))
          && !lineas.slice(Math.max(0, i - 3), i + 1).some((l) => /mailing|postal/i.test(l));
        candidatos.push({ dir: m[0].replace(/,\s*,/g, ","), prioridad: cercaEtiqueta ? 0 : 1, i });
      }
    }
    candidatos.sort((a, b) => a.prioridad - b.prioridad || a.i - b.i);
    if (candidatos[0]) direccion = candidatos[0].dir;
  }

  // ---- 5. Owners (por etiqueta "Owner", "Owner Name", etc.) ----
  const owners = [];
  const agregarOwner = (n) => {
    const limpio = n.replace(/\s+/g, " ").replace(/[,.]$/, "").trim();
    if (limpio && !owners.some((o) => o.toUpperCase() === limpio.toUpperCase())) owners.push(limpio);
  };
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(RE_OWNER);
    if (!m) continue;
    const resto = (m[1] || "").trim();
    if (resto && pareceNombre(resto.replace(/&/g, " ").replace(/\s+/g, " "))) {
      separarNombres(resto).forEach(agregarOwner);
      continue;
    }
    for (let j = i + 1; j <= i + 4 && j < lineas.length; j++) {
      const l = lineas[j];
      if (pareceNombre(l.replace(/&/g, " ").replace(/\s+/g, " "))) separarNombres(l).forEach(agregarOwner);
      else if (owners.length) break;
    }
  }

  // ---- 6. Teléfonos y a quién pertenecen ----
  const tokens = (n) => n.toUpperCase().replace(/[^A-ZÀ-Ÿ ]/g, " ").split(" ").filter((t) => t.length > 1);
  const contieneOwner = (linea, owner) => {
    const L = " " + linea.toUpperCase().replace(/[^A-ZÀ-Ÿ ]/g, " ") + " ";
    const t = tokens(owner);
    if (t.length < 2) return false;
    return L.includes(" " + t[0] + " ") && L.includes(" " + t[t.length - 1] + " ");
  };

  const porOwner = new Map(owners.map((o) => [o, []]));
  const sinAsignar = [];
  const vistos = new Set();

  for (let i = 0; i < lineas.length; i++) {
    const tels = telefonos(lineas[i]);
    if (!tels.length) continue;
    const tipoM = (lineas[i].match(RE_TIPO) || (lineas[i + 1] || "").match(RE_TIPO));
    const tipo = tipoM ? tipoM[1].toLowerCase().replace("cellular", "mobile").replace("cell", "mobile").replace("wireless", "mobile") : "";

    // dueño más cercano hacia arriba
    let dueno = null;
    let deOtraPersona = false;
    if (owners.length) {
      for (let j = i; j >= Math.max(0, i - 60) && !dueno; j--) {
        dueno = owners.find((o) => contieneOwner(lineas[j], o)) || null;
        // si antes de llegar a un owner aparece otro nombre (vecino, pariente…), el teléfono no es del owner
        if (!dueno && j < i && pareceNombre(lineas[j])) { deOtraPersona = true; break; }
      }
      if (deOtraPersona) continue;
    } else {
      // sin etiqueta "Owner": tomar el nombre más cercano arriba del teléfono
      for (let j = i - 1; j >= Math.max(0, i - 8) && !dueno; j--) {
        if (pareceNombre(lineas[j])) dueno = lineas[j];
      }
      if (dueno && !porOwner.has(dueno)) porOwner.set(dueno, []);
    }

    for (const num of tels) {
      const clave = (dueno || "") + num;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      if (dueno) porOwner.get(dueno).push({ num, tipo });
      else sinAsignar.push({ num, tipo });
    }
  }

  // si solo hay un owner, los teléfonos sueltos son suyos
  if (porOwner.size === 1 && sinAsignar.length) {
    const [unico] = porOwner.keys();
    for (const t of sinAsignar) if (!porOwner.get(unico).some((x) => x.num === t.num)) porOwner.get(unico).push(t);
    sinAsignar.length = 0;
  }

  return {
    url: location.href,
    direccion,
    owners: [...porOwner.entries()].map(([nombre, phones]) => ({ nombre, phones })),
    sinAsignar,
  };
}

// =====================================================================
// Panel
// =====================================================================
const RE_EMPRESA = /\b(trust|trustee|trustees|tr|llc|l\.l\.c|inc|corp|corporation|lp|llp|ltd|company|co|bank|estate of|revocable|living|holdings|properties|investments|investment|association|assn|church|city of|county of|partners|partnership|group|fund|homes|realty)\b/i;

function estado(msg, error = false) {
  $("estado").textContent = msg;
  $("estado").className = error ? "error" : "";
  if (msg && window.svLog) svLog(msg, error ? "error" : undefined);
}

function guardar() { chrome.storage.local.set({ [K("lote")]: lote }); }

function titulo(s) {
  return s.toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
}

function agregarResultado(r) {
  // Un solo owner por propiedad: el que tenga más teléfonos (si empatan, el primero)
  let candidatos = r.owners.filter((o) => !($("sinEmpresas").checked && RE_EMPRESA.test(o.nombre)));
  const empresas = r.owners.length - candidatos.length;
  if (!candidatos.length && r.sinAsignar.length) candidatos = [{ nombre: "", phones: r.sinAsignar }];
  if (!candidatos.length) return { nuevos: 0, empresas, soloEmpresas: true };

  const o = candidatos.reduce((m, x) => (x.phones.length > m.phones.length ? x : m), candidatos[0]);
  const nombre = o.nombre === o.nombre.toUpperCase() ? titulo(o.nombre) : o.nombre;
  const dir = (r.direccion || "").trim();

  // Si la propiedad ya está en el lote, no se repite: solo se suman teléfonos nuevos
  const clave = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const existente = lote.find((x) => (dir && clave(x.address) === clave(dir)) ||
    (!dir && clave(x.owner) === clave(nombre)));
  let nuevos = 0;
  if (existente) {
    if (r.leadId) { existente.leadId = r.leadId; if (nombre) existente.owner = nombre; }
    if (!existente.owner && nombre) existente.owner = nombre;
    for (const p of o.phones) if (!existente.phones.some((q) => q.num === p.num)) existente.phones.push(p);
  } else {
    lote.push({ owner: nombre, phones: [...o.phones], address: dir, url: r.url, ...(r.leadId ? { leadId: r.leadId } : {}) });
    nuevos = 1;
  }
  guardar();
  pintar();
  return { nuevos, empresas };
}

function textoLimpio() {
  return lote.map((f) => [f.owner || "(sin nombre)", ...f.phones.map((p) => p.num), f.address || "(sin dirección)"].join("\n")).join("\n\n");
}

function editable(texto, vacio, alGuardar, clase) {
  const el = document.createElement("div");
  el.className = clase + (texto ? "" : " sin");
  el.contentEditable = "true";
  el.innerText = texto || vacio;
  el.onblur = () => alGuardar(el.innerText.replace(vacio, "").trim());
  return el;
}

function pintar() {
  const cont = $("lista");
  cont.innerHTML = "";
  lote.forEach((f, i) => {
    const card = document.createElement("div");
    card.className = "card";
    const x = document.createElement("span");
    x.className = "x"; x.textContent = "✕"; x.title = "Quitar";
    x.onclick = () => { lote.splice(i, 1); guardar(); pintar(); };

    card.append(
      x,
      editable(f.owner, "(sin nombre)", (v) => { f.owner = v; guardar(); }, "owner"),
      editable(f.phones.map((p) => p.num).join("\n"), "(sin teléfonos)", (v) => {
        const nums = [];
        for (const m of v.matchAll(/\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/g)) {
          const num = `(${m[1]}) ${m[2]}-${m[3]}`;
          if (!nums.some((n) => n.num === num)) nums.push({ num, tipo: (f.phones.find((p) => p.num === num) || {}).tipo || "" });
        }
        f.phones = nums; guardar(); pintar();
      }, "tels"),
      editable(f.address, "(sin dirección)", (v) => { f.address = v; guardar(); }, "dir"),
    );
    cont.appendChild(card);
  });
  const tels = lote.reduce((s, f) => s + f.phones.length, 0);
  $("conteo").textContent = lote.length ? `${lote.length} propiedad(es) · ${tels} teléfono(s)` : "Lote vacío";
}

function noSePuede(url) {
  return !url || /^(chrome|edge|about|chrome-extension|devtools):/.test(url) ||
    url.includes("chromewebstore.google.com") || url.includes("chrome.google.com/webstore");
}

async function extraerDeTab(tabId) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId }, func: extractor, args: [{}],
  });
  return res.result;
}

function esperarCarga(tabId, limite = 30000) {
  return new Promise((resolve) => {
    let listo = false;
    const fin = () => {
      if (listo) return;
      listo = true; clearTimeout(t);
      chrome.tabs.onUpdated.removeListener(escucha); resolve();
    };
    const escucha = (id, info) => { if (id === tabId && info.status === "complete") fin(); };
    const t = setTimeout(fin, limite);
    chrome.tabs.onUpdated.addListener(escucha);
    chrome.tabs.get(tabId).then((tb) => { if (tb.status === "complete") fin(); }).catch(fin);
  });
}

function bloquear(si) { ["btnActual", "btnLista", "btnPestanas", "btnFantasma", "btnBV"].forEach((id) => ($(id).disabled = si)); }

function resumen(r, res) {
  const partes = [res.nuevos ? "propiedad agregada" : "ya estaba en el lote (sumé teléfonos nuevos)"];
  
  if (!r.direccion) partes.push("no encontré dirección");
  if (!r.owners.length && !r.sinAsignar.length) partes.push("no encontré owner ni teléfonos");
  return partes.join(" · ");
}

$("btnActual").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, windowId: await ventanaTrabajo() });
  if (!tab || noSePuede(tab.url)) return estado("Chrome no deja leer esta página.", true);
  bloquear(true);
  estado("Leyendo la página…");
  try {
    const r = await extraerDeTab(tab.id);
    const res = agregarResultado(r);
    estado("Listo ✅ " + resumen(r, res), !r.owners.length && !r.sinAsignar.length);
  } catch (e) {
    estado("No se pudo leer: " + e.message, true);
  }
  bloquear(false);
};

$("btnLista").onclick = async () => {
  const urls = $("urls").value.split("\n").map((u) => u.trim()).filter(Boolean)
    .map((u) => (/^https?:\/\//i.test(u) ? u : "https://" + u));
  if (!urls.length) return estado("Pega al menos una URL.", true);
  bloquear(true);
  let fallas = 0, total = 0;
  for (let i = 0; i < urls.length; i++) {
    estado(`Leyendo ${i + 1} de ${urls.length}…`);
    let tab;
    try {
      tab = await chrome.tabs.create({ url: urls[i], active: false, windowId: await ventanaTrabajo() });
      await esperarCarga(tab.id);
      await sleep(2500); // dar tiempo a que cargue
      total += agregarResultado(await extraerDeTab(tab.id)).nuevos;
    } catch (e) {
      fallas++;
    } finally {
      if (tab) chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
  estado(`Terminado: ${total} propiedad(es) nueva(s)` + (fallas ? ` · ${fallas} página(s) con error` : " ✅"), fallas > 0);
  bloquear(false);
};


// ---------- Pestañas abiertas ----------
const desmarcadas = new Set();
async function listarPestanas() {
  const vid = await ventanaTrabajo(undefined, { crear: false });
  const tabs = vid ? await chrome.tabs.query({ windowId: vid }) : [];
  const cont = $("pestanas");
  cont.innerHTML = "";
  for (const t of tabs) {
    const bloqueada = noSePuede(t.url);
    const lab = document.createElement("label");
    lab.className = "pest" + (bloqueada ? " no" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = t.id; cb.disabled = bloqueada; cb.checked = !bloqueada && !desmarcadas.has(t.id);
    cb.onchange = () => (cb.checked ? desmarcadas.delete(t.id) : desmarcadas.add(t.id));
    const img = document.createElement("img");
    img.src = t.favIconUrl || "icons/icon16.png";
    img.onerror = () => { img.src = "icons/icon16.png"; };
    const sp = document.createElement("span");
    sp.textContent = t.title || t.url; sp.title = t.url;
    lab.append(cb, img, sp);
    cont.appendChild(lab);
  }
}

function marcar(v) {
  document.querySelectorAll("#pestanas input:not(:disabled)").forEach((c) => {
    c.checked = v;
    v ? desmarcadas.delete(Number(c.value)) : desmarcadas.add(Number(c.value));
  });
}
$("selTodas").onclick = (e) => { e.preventDefault(); marcar(true); };
$("selNinguna").onclick = (e) => { e.preventDefault(); marcar(false); };
$("refrescar").onclick = (e) => { e.preventDefault(); listarPestanas(); };
chrome.tabs.onCreated.addListener(() => listarPestanas());
chrome.tabs.onRemoved.addListener(() => listarPestanas());
chrome.tabs.onUpdated.addListener((id, info) => { if (info.title || info.status === "complete") listarPestanas(); });

$("btnPestanas").onclick = async () => {
  const ids = [...document.querySelectorAll("#pestanas input:checked")].map((c) => Number(c.value));
  if (!ids.length) return estado("Marca al menos una pestaña.", true);
  bloquear(true);
  let nuevas = 0, repetidas = 0, vacias = 0, fallas = 0, empresas = 0;
  const leidas = [];
  for (let i = 0; i < ids.length; i++) {
    estado(`Leyendo pestaña ${i + 1} de ${ids.length}…`);
    try {
      let tab = await chrome.tabs.get(ids[i]);
      // pestañas "dormidas" por Chrome: hay que recargarlas antes de leer
      if (tab.discarded || tab.status === "unloaded") {
        await chrome.tabs.reload(tab.id);
        await esperarCarga(tab.id);
        await sleep(2000);
      } else if (tab.status === "loading") {
        await esperarCarga(tab.id);
      }
      const r = await extraerDeTab(tab.id);
      if (!r.owners.length && !r.sinAsignar.length) { vacias++; continue; }
      const res = agregarResultado(r);
      if (res.soloEmpresas) { empresas++; continue; }
      res.nuevos ? nuevas++ : repetidas++;
      leidas.push(tab.id);
    } catch (e) {
      fallas++;
    }
  }
  if ($("cerrarLeidas").checked && leidas.length) await chrome.tabs.remove(leidas).catch(() => {});
  const partes = [`${nuevas} propiedad(es) nueva(s)`];
  if (repetidas) partes.push(`${repetidas} ya estaban`);
  if (vacias) partes.push(`${vacias} sin owner ni teléfonos`);
  if (empresas) partes.push(`${empresas} solo con trust/compañía`);
  if (fallas) partes.push(`${fallas} con error`);
  estado("Listo ✅ " + partes.join(" · "), fallas > 0);
  bloquear(false);
  listarPestanas();
};

listarPestanas();

// =====================================================================
// Fantasmita pixel (diseño propio, 8 bits)
// =====================================================================
const MAPA_FANTASMA = [
  ".....XXXX.....",
  "...XXXXXXXX...",
  "..XXXXXXXXXX..",
  ".XXXXXXXXXXXX.",
  ".XXEWXXXXEWXX.",
  ".XXEEXXXXEEXX.",
  "XXXXXXXXXXXXXX",
  "XXPXXXMMXXXPXX",
  "X.XXXXMMXXXX.X",
  "..XXXXXXXXXX..",
  "...XXXXXXXXX..",
  "....XXXXXXX...",
  ".....XXXXX....",
  ".......XXX....",
  "........XX....",
  ".........X....",
];
function svgFantasma() {
  const col = { X: "#4ade80", E: "#0b1f12", W: "#ffffff", M: "#0b1f12", P: "#86efac" };
  let r = "";
  MAPA_FANTASMA.forEach((fila, y) => [...fila].forEach((c, x) => {
    if (col[c]) r += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${col[c]}"${c === "E" || c === "W" ? ' class="ojo"' : ""}/>`;
  }));
  return `<svg viewBox="0 0 14 16" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${r}</svg>`;
}
document.querySelectorAll(".fantasmaMini").forEach((el) => (el.innerHTML = svgFantasma()));
$("fantasmaIcono").innerHTML = svgFantasma();
$("fantasmaIcono").classList.add("parpadea");
const CUADROS = 20;
$("fantasmaBarra").innerHTML = "<i></i>".repeat(CUADROS);

let detenerFantasma = false;

function fantasma(txt, i, total) {
  $("fantasmaTxt").textContent = txt;
  if (window.svLog && !/^(Cargando|Leyendo) /.test(txt)) svLog("Fantasmita: " + txt);
  const llenos = total ? Math.round((i / total) * CUADROS) : 0;
  [...$("fantasmaBarra").children].forEach((c, k) => c.classList.toggle("lleno", k < llenos));
}

$("btnDetener").onclick = () => { detenerFantasma = true; fantasma("Deteniendo después de esta pestaña…"); };

// Carga y lee una lista de pestañas con el fantasmita.
// lista: [{ tabId, address? }]  (address = domicilio que buscó el Agente BeenVerified)
// ---------- BeenVerified a veces deja "Search Results" en vez del reporte ----------
// ("We have found 1 records for …" con un botón "View Property"). Owny abre ese View Property,
// cierra la pestaña de resultados y se queda con la nueva para leerla.
async function revisarResultados(tabId, address) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId }, args: [address || ""],
    func: (addr) => {
      const texto = (document.body && document.body.innerText) || "";
      if (!/search results/i.test(texto) || !/we have found \d+ records?/i.test(texto)) return { es: false };
      const botones = [...document.querySelectorAll('a, button, [role="button"]')].filter((b) => /^\s*view property\s*$/i.test(b.innerText || ""));
      if (!botones.length) return { es: true, boton: false };
      // Si hay varias tarjetas, la que trae el mismo número y calle que buscó Veri
      const num = (addr.match(/^\s*(\d+)/) || [])[1] || "";
      const calle = ((addr.split(",")[0] || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)[1]) || "";
      // La tarjeta de cada botón = el contenedor más grande que solo tiene ESE botón de View Property
      const tarjeta = (b) => {
        let c = b;
        while (c.parentElement && [...c.parentElement.querySelectorAll('a, button, [role="button"]')]
          .filter((x) => /^\s*view property\s*$/i.test(x.innerText || "")).length === 1) c = c.parentElement;
        return (c.innerText || "").toLowerCase();
      };
      const reNum = num ? new RegExp("(^|\\D)" + num + "(\\D|$)") : null;
      let idx = 0;
      for (let j = 0; j < botones.length; j++) {
        const t = tarjeta(botones[j]);
        if (reNum && reNum.test(t) && (!calle || t.includes(calle))) { idx = j; break; }
      }
      const href = botones[idx].href || (botones[idx].closest("a") || {}).href || "";
      return { es: true, boton: true, href, idx, varios: botones.length };
    },
  });
  return r.result;
}

// Espera una pestaña nueva abierta desde esa pestaña (o en su misma ventana, porque a veces Chrome no marca de dónde salió)
function esperarPestanaNueva(tabId, windowId, ms) {
  let listener, t;
  const promesa = new Promise((resolve) => {
    listener = (tab) => { if (tab.openerTabId === tabId || tab.windowId === windowId) { fin(); resolve(tab); } };
    const fin = () => { clearTimeout(t); chrome.tabs.onCreated.removeListener(listener); };
    t = setTimeout(() => { fin(); resolve(null); }, ms);
    chrome.tabs.onCreated.addListener(listener);
  });
  promesa.cancelar = () => { clearTimeout(t); chrome.tabs.onCreated.removeListener(listener); };
  return promesa;
}

// Si la pestaña es "Search Results", abre View Property y regresa la pestaña buena (la nueva o la misma).
async function pasarDeResultados(tab, item) {
  const nueva = esperarPestanaNueva(tab.id, tab.windowId, 5000);
  let r;
  try { r = await revisarResultados(tab.id, item.address); } catch (e) { r = { es: false }; }
  if (!r.es) { nueva.cancelar(); return tab; }
  if (!r.boton) { nueva.cancelar(); throw new Error("Search Results sin botón View Property"); }
  fantasma(`Abriendo “View Property” de ${(item.address || "").slice(0, 40)}…`);
  let buena;
  if (!r.href) {
    // Botón sin link: se le da clic dentro de la página atrapando la dirección que intenta abrir
    // (Chrome bloquearía esa ventana nueva por no ser un clic de persona). Si no abre nada, navega en la misma pestaña.
    try {
      const [c] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN", args: [r.idx],
        func: (idx) => {
          const b = [...document.querySelectorAll('a, button, [role="button"]')].filter((x) => /^\s*view property\s*$/i.test(x.innerText || ""))[idx];
          if (!b) return null;
          let url = null; const orig = window.open;
          window.open = (u) => { url = u ? new URL(u, location.href).href : null; return null; };
          try { b.click(); } finally { window.open = orig; }
          return url;
        },
      });
      r.href = (c && c.result) || "";
    } catch (e) {}
  }
  if (r.href) {
    nueva.cancelar();
    buena = await chrome.tabs.create({ url: r.href, windowId: tab.windowId, index: tab.index + 1, active: false });
  } else {
    buena = (await nueva) || tab; // si no abrió otra pestaña, navegó en la misma
  }
  if (buena.id !== tab.id) {
    await chrome.tabs.remove(tab.id).catch(() => {});   // cerrar la de "Search Results"
  }
  await sleep(800);
  await esperarCarga(buena.id);
  await sleep(2000);
  return await chrome.tabs.get(buena.id);
}

async function correrFantasma(lista) {
  const [original] = await chrome.tabs.query({ active: true, windowId: await ventanaTrabajo() });
  bloquear(true);
  detenerFantasma = false;
  $("fantasmaCaja").hidden = false;
  $("fantasmaIcono").classList.add("flota");
  estado("");
  let nuevas = 0, repetidas = 0, vacias = 0, fallas = 0, empresas = 0, alFrente = false;
  const leidas = [], intentadas = [], sinLeer = [];

  for (let i = 0; i < lista.length && !detenerFantasma; i++) {
    const item = lista[i];
    intentadas.push(item.tabId);
    try {
      let tab = await chrome.tabs.get(item.tabId);
      const nombre = (item.address || tab.title || tab.url || "").slice(0, 40);
      const vacio = (x) => !x || x.cargando || (!x.owners.length && !x.sinAsignar.length);
      let r = null;

      // Rápido: si la pestaña ya cargó, se lee sin ponerla al frente y sin esperas
      if (tab.status === "complete" && !tab.discarded) {
        fantasma(`Leyendo ${i + 1} de ${lista.length}: ${nombre}`, i + 0.5, lista.length);
        tab = await pasarDeResultados(tab, item); // "Search Results" → View Property (y se cierra la de resultados)
        r = await extraerDeTab(tab.id).catch(() => null);
      }
      // Si no salió, como antes: al frente, despertarla y esperar a que pinte
      if (vacio(r)) {
        fantasma(`Cargando ${i + 1} de ${lista.length}: ${nombre}`, i, lista.length);
        alFrente = true;
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.discarded || tab.status === "unloaded") {
          await chrome.tabs.reload(tab.id);
          await sleep(300);
        }
        await esperarCarga(tab.id);
        await sleep(1500); // dejar que termine de pintar los datos
        tab = await pasarDeResultados(tab, item);
        fantasma(`Leyendo ${i + 1} de ${lista.length}: ${nombre}`, i + 0.5, lista.length);
        r = await extraerDeTab(tab.id);
      }
      // Reporte de BeenVerified que todavía no termina de cargar: esperar y leer otra vez
      for (let k = 0; k < 6 && item.address && (r.cargando || (!r.owners.length && !r.sinAsignar.length)) && !detenerFantasma; k++) {
        fantasma(`Esperando que cargue ${i + 1} de ${lista.length}: ${nombre}`, i + 0.5, lista.length);
        await sleep(4000);
        r = await extraerDeTab(tab.id);
      }
      // Si viene del Agente BeenVerified, la propiedad es la que buscó (más segura que adivinarla de la página)
      if (item.address) r.direccion = item.address;
      if (item.leadId) r.leadId = item.leadId; // viene de Acti: es un lead de Lofty que se va a actualizar
      if (!r.owners.length && !r.sinAsignar.length) {
        vacias++;
        if (item.address) { intentadas.pop(); sinLeer.push(item.address); } // se queda pendiente para leerla después
        continue;
      }
      const res = agregarResultado(r);
      leidas.push(tab.id); // ya se leyó (aunque sea solo trust/compañía): se puede cerrar
      if (res.soloEmpresas) { empresas++; continue; }
      res.nuevos ? nuevas++ : repetidas++;
    } catch (e) {
      fallas++;
    }
  }
  if (sinLeer.length) estado(`Se quedaron pendientes ${sinLeer.length} resultado(s) sin owner ni teléfonos (¿no cargó el reporte?): ${sinLeer.slice(0, 3).join(" · ")}. Revisa esas pestañas y vuelve a darle Leer resultados.`, true);

  // Regresar a la pestaña donde estabas (solo si hubo que poner alguna al frente)
  if (original && alFrente) await chrome.tabs.update(original.id, { active: true }).catch(() => {});
  if ($("cerrarLeidas").checked && leidas.length) {
    // La pestaña donde estabas no se cierra… salvo que todo sean resultados de Veri (esas sí se cierran ya leídas)
    const todasDeVeri = lista.every((x) => x.address);
    await chrome.tabs.remove(leidas.filter((id) => todasDeVeri || !original || id !== original.id)).catch(() => {});
  }

  $("fantasmaIcono").classList.remove("flota");
  const partes = [`${nuevas} propiedad(es) nueva(s)`];
  if (repetidas) partes.push(`${repetidas} ya estaban`);
  if (vacias) partes.push(`${vacias} sin owner ni teléfonos`);
  if (empresas) partes.push(`${empresas} solo con trust/compañía`);
  if (fallas) partes.push(`${fallas} con error`);
  fantasma((detenerFantasma ? "Detenido. " : "¡Listo! ") + partes.join(" · "), 1, 1);
  if (!sinLeer.length) estado("");
  bloquear(false);
  listarPestanas();
  return intentadas;
}

$("btnFantasma").onclick = async () => {
  const ids = [...document.querySelectorAll("#pestanas input:checked")].map((c) => Number(c.value));
  if (!ids.length) return estado("Marca al menos una pestaña.", true);
  await correrFantasma(ids.map((tabId) => ({ tabId })));
};

// ---------- Resultados que manda el Agente BeenVerified ----------
let leyendoBV = false;

async function pendientesBV() {
  const { [K("bvPendientes")]: bvPendientes = [] } = await chrome.storage.local.get(K("bvPendientes"));
  // quitar los de pestañas que ya se cerraron
  const vivos = [];
  for (const p of bvPendientes) if (await chrome.tabs.get(p.tabId).then(() => true, () => false)) vivos.push(p);
  if (vivos.length !== bvPendientes.length) await chrome.storage.local.set({ [K("bvPendientes")]: vivos });
  return vivos;
}

async function pintarBV() {
  const n = (await pendientesBV()).length;
  $("bvInfo").textContent = n ? `${n} pestaña(s) con resultado esperando a que las lea.` : "No hay resultados pendientes.";
  $("bvInfo").className = "meta";
}

// Intentos por pestaña: en modo "en vivo" no se reintenta para siempre una pestaña que no se deja leer
const intentosBV = new Map();
let otraLectura = false, timerVivo = null;
function leerEnVivo() {
  if (!$("bvVivo").checked) return;
  clearTimeout(timerVivo);
  timerVivo = setTimeout(() => leerBV(true, true), 1200);
}
async function leerBV(automatico = false, vivo = false) {
  if (leyendoBV || $("btnBV").disabled) { if (vivo) otraLectura = true; return; }
  let lista = await pendientesBV();
  if (vivo) lista = lista.filter((p) => (intentosBV.get(p.tabId) || 0) < 3);
  if (!lista.length) { if (!automatico) estado("No hay resultados de BeenVerified pendientes."); return; }
  leyendoBV = true;
  try {
    lista.forEach((p) => intentosBV.set(p.tabId, (intentosBV.get(p.tabId) || 0) + 1));
    const intentadas = await correrFantasma(lista);
    const { [K("bvPendientes")]: bvPendientes = [] } = await chrome.storage.local.get(K("bvPendientes"));
    await chrome.storage.local.set({ [K("bvPendientes")]: bvPendientes.filter((p) => !intentadas.includes(p.tabId)) });
  } finally {
    leyendoBV = false;
    pintarBV();
    if (otraLectura) { otraLectura = false; leerEnVivo(); } // llegaron más mientras leía
  }
}

$("btnBV").onclick = () => leerBV(false);
chrome.storage.onChanged.addListener((cambios, area) => {
  if (area !== "local") return;
  const cambioPend = cambios[K("bvPendientes")];
  if (cambioPend) {
    pintarBV();
    const antes = (cambioPend.oldValue || []).length, ahora = (cambioPend.newValue || []).length;
    if (ahora > antes) leerEnVivo(); // llegó un resultado nuevo de Veri
  }
  if (cambios[K("bvCicloTermino")] && $("bvAuto").checked) leerBV(true);
});
pintarBV();

// ---------- CSV formato Lofty (rama Geo Farming) ----------
function dividirNombre(n) {
  n = n.trim();
  if (n.includes(",")) {
    const [ap, resto] = n.split(",").map((s) => s.trim());
    return { first: (resto || "").split(" ")[0] || "", last: ap };
  }
  const p = n.split(" ").filter(Boolean);
  if (p.length === 1) return { first: p[0], last: "" };
  return { first: p[0], last: p[p.length - 1] };
}

function ciudad(dir) {
  const m = dir.match(/,\s*([^,]+?),?\s+[A-Z]{2}\s+\d{5}/);
  return m ? m[1].trim().toLowerCase() : "";
}

const csvCelda = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);

$("btnCsv").onclick = () => {
  if (!lote.length) return estado("El lote está vacío.", true);
  const maxTel = Math.max(1, ...lote.map((f) => f.phones.length));
  const encTel = ["Phone", ...Array.from({ length: maxTel - 1 }, (_, i) => `Phone ${i + 2}`)];
  const enc = ["First Name", "Last Name", ...encTel, "Email", "Property Address", "TAG 1", "TAG 2"];
  const filas = lote.map((f) => {
    const { first, last } = dividirNombre(f.owner);
    const tels = encTel.map((_, i) => (f.phones[i] ? f.phones[i].num : ""));
    return [first, last, ...tels, "", f.address, $("tag1").value.trim(), ciudad(f.address)];
  });
  const csv = [enc, ...filas].map((r) => r.map(csvCelda).join(",")).join("\n");
  const fecha = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `owners-lofty-${fecha}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  estado(`CSV descargado con ${lote.length} owner(s) ✅`);
};

$("btnCopiar").onclick = async () => {
  if (!lote.length) return;
  try { await navigator.clipboard.writeText(textoLimpio()); estado("Texto copiado 📋"); }
  catch { estado("No se pudo copiar.", true); }
};

$("btnLimpiar").onclick = async () => {
  if (lote.length && !(await preguntar(`¿Vaciar el lote con ${lote.length} propiedad(es)?`, "Vaciar"))) return;
  lote = []; guardar(); pintar(); estado("");
};

// ---------- Preferencias ----------
["sinEmpresas", "tag1", "urls", "cerrarLeidas", "bvAuto", "bvVivo"].forEach((id) => {
  $(id).addEventListener("change", () => {
    const el = $(id);
    chrome.storage.local.set({ [id]: el.type === "checkbox" ? el.checked : el.value });
  });
});
chrome.storage.local.get(["sinEmpresas", "tag1", "urls", K("lote"), "cerrarLeidas", "bvAuto", "bvVivo"], (d) => {
  d.lote = d[K("lote")];
  if (typeof d.bvAuto === "boolean") $("bvAuto").checked = d.bvAuto;
  if (typeof d.bvVivo === "boolean") $("bvVivo").checked = d.bvVivo;
  if (typeof d.cerrarLeidas === "boolean") $("cerrarLeidas").checked = d.cerrarLeidas;
  if (typeof d.sinEmpresas === "boolean") $("sinEmpresas").checked = d.sinEmpresas;
  if (d.tag1) $("tag1").value = d.tag1;
  if (d.urls) $("urls").value = d.urls;
  if (Array.isArray(d.lote)) lote = d.lote;
  pintar();
});
