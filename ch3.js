// =====================================================================
// Chequi 3: el filtro de las HECM de Heri (línea HECM).
// No revisa domicilios sueltos: revisa CASOS de hipoteca inversa en ejecución.
// · Filtros HECM: lender (Celink confirmado / probable / todas), que el remate no
//   haya pasado y que el aviso no sea demasiado viejo.
// · ¿Ya está en Lofty? por domicilio, por nombre del dueño y por los teléfonos de
//   sus familiares (los que Heri encontró en BeenVerified).
// · Prioridad: remate (NTS) > NOD, remate cerca, dueño fallecido sin probate,
//   Celink confirmado, domicilio confirmado.
// · Lo que pasa sigue a Veri 3 o Wibi 3 (a.lofty = "no"); lo que ya está en Lofty
//   queda "si"; lo filtrado queda "filtrada" (se puede dejar pasar a mano).
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const D = 864e5;
const DEF = { activo: true, lender: "probable", vencidas: true, maxDias: 120 };
let cfg = { ...DEF }, casos = {}, hecms = [], res = {}, corriendo = false, parar = false;

const tk = (s) => String(s || "").toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter((t) => t.length > 1);
const fechaMDY = (s) => { const m = String(s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? new Date(+m[3], m[1] - 1, +m[2]).getTime() : 0; };
const fechaAlgo = (s) => fechaMDY(s) || Date.parse(String(s || "")) || 0;
const caseDe = (a) => (a.hecm && casos[a.hecm.dueno]) || Object.values(casos).find((c) => c.street && keyOf({ street: c.street, city: c.city, zip: c.zip }) === a.key) || null;

// ---------- Configuración ----------
async function cargarCfg() {
  const { ch3Config = {}, [K("chDestino")]: dest } = await chrome.storage.local.get(["ch3Config", K("chDestino")]);
  cfg = { ...DEF, ...ch3Config };
  $("activo").checked = cfg.activo !== false; $("lender").value = cfg.lender; $("vencidas").checked = !!cfg.vencidas; $("maxDias").value = cfg.maxDias;
  $("destino").value = dest === "wb" ? "wb" : "bv"; pintarDestino();
}
function guardarCfg() {
  cfg = { activo: $("activo").checked, lender: $("lender").value, vencidas: $("vencidas").checked, maxDias: Math.max(7, Math.min(730, parseInt($("maxDias").value, 10) || 120)) };
  chrome.storage.local.set({ ch3Config: cfg });
}
["lender", "vencidas", "maxDias"].forEach((id) => ($(id).onchange = async () => { guardarCfg(); await reevaluarFiltradas(); pintar(); }));
$("activo").onchange = () => { guardarCfg(); if (cfg.activo) revisar(false); else parar = true; };
const destino = () => ($("destino").value === "wb" ? "wb" : "bv");
const quien = () => (destino() === "wb" ? "Wibi 3" : "Veri 3");
function pintarDestino() { $("libresTxt").textContent = `pasan a ${quien()}`; }
$("destino").onchange = () => { chrome.storage.local.set({ [K("chDestino")]: destino() }); pintarDestino(); svLog && svLog(`Desde ahora las HECM que apruebo van a ${quien()}.`); };

// ---------- Datos ----------
async function cargar() {
  const { addresses = {}, hrCasos = {}, ch3Res = {} } = await chrome.storage.local.get(["addresses", "hrCasos", "ch3Res"]);
  casos = hrCasos; res = ch3Res;
  hecms = Object.entries(addresses).map(([key, a]) => ({ ...a, key })).filter((a) => a.origen === "hecm" && sirve(a));
  pintar();
}
const porRevisar = () => hecms.filter((a) => !a.lofty && !a.bvSearched);

// ---------- Filtros y prioridad ----------
function filtro(a, c0) {
  const h = a.hecm || {}, c = c0 || {};
  const celink = !!(h.celink || (c && c.celink)), probable = /probable|\?/i.test(String(h.lender || "")) || !!(c && c.celinkProbable);
  if (cfg.lender === "confirmado" && (!celink || probable)) return "el servicer no es Celink / Compu-Link confirmado";
  if (cfg.lender === "probable" && !celink) return "no es de Celink / Compu-Link (ni probable)";
  const remate = fechaAlgo(h.subasta || (c && c.subasta));
  if (cfg.vencidas && remate && remate < Date.now() - D) return `el remate ya pasó (${h.subasta || c.subasta})`;
  const aviso = fechaMDY(h.fecha || (c && c.aviso));
  if (aviso && Date.now() - aviso > cfg.maxDias * D) return `el aviso tiene más de ${cfg.maxDias} días (${h.fecha || c.aviso})`;
  return "";
}
function prioridad(a, c0) {
  const h = a.hecm || {}, c = c0 || {}; let p = 0; const por = [];
  if (h.nts || (c && c.nts)) { p += 3; por.push("remate (NTS)"); } else if (h.nod || (c && c.nod)) { p += 1; por.push("NOD"); }
  const remate = fechaAlgo(h.subasta || (c && c.subasta));
  if (remate && remate > Date.now() && remate - Date.now() < 30 * D) { p += 2; por.push("remate en < 30 días"); }
  if (remate && remate < Date.now()) { p -= 2; por.push("el remate ya pasó (revisar si se vendió)"); }
  const pr = h.properant || {}, debe = +pr.saldo || +pr.puja || 0, vale = +pr.valor || 0;
  if (debe && vale) { const q = vale - debe; if (q > 100000) { p += 2; por.push(`le quedarían ~$${Math.round(q / 1000)}K al vender`); } else if (q < 0) { p -= 1; por.push("debe más de lo que vale"); } }
  if (h.avisoOtro) { p -= 3; por.push("el remate es de otro préstamo"); }
  if (h.preNod) { p += 3; por.push("el dueño murió y aún no hay NOD (antes que todos)"); }
  if (h.fallecido || (c && c.fallecido)) { p += 2; por.push("dueño fallecido"); if (!(h.probate && h.probate.abierto)) { p += 1; por.push("sin probate abierto"); } }
  if ((h.celink || (c && c.celink)) && !/probable/i.test(String(h.celinkMotivo || ""))) { p += 1; por.push("Celink confirmado"); }
  if (h.domConfirmado || (c && c.domConfirmado)) { p += 1; por.push("domicilio confirmado"); }
  const ctos = ((h.parientes || (c && c.parientes) || []).filter((x) => x.vivo !== false && (x.tels || []).length).length);
  if (ctos) { p += 1; por.push(`${ctos} familiar(es) con teléfono`); }
  return { p, por };
}

// ---------- ¿Ya está en Lofty? (domicilio → nombre del dueño → teléfonos de familiares) ----------
async function enLofty(a, c) {
  if (await enLoftyPorDomicilio(a)) return "por domicilio";
  const dueno = (a.hecm && a.hecm.dueno) || (c && c.dueno) || "";
  const [ap, nom] = tk(dueno);
  if (ap && nom) {
    const d = await loftyApi(`/leads?limit=50&key=` + encodeURIComponent(`${nom} ${ap}`));
    const ciudad = norm(a.city);
    const hit = (d.leads || d.data || []).find((l) => tk(l.lastName).includes(ap) && tk(l.firstName)[0] === nom &&
      (!(l.leadPropertyList || []).length || (l.leadPropertyList || []).some((p) => !p.city || norm(p.city) === ciudad)));
    if (hit) return `por nombre (${l2n(hit)})`;
  }
  const tels = [...new Set([...((a.hecm && a.hecm.parientes) || (c && c.parientes) || []).flatMap((x) => (x.tels || []).map((t) => t.num)), ...((c && c.telsDueno) || []).map((t) => t.num)])].slice(0, 4);
  for (const t of tels) {
    const d = await loftyApi(`/leads?limit=5&key=` + encodeURIComponent(t));
    const hit = (d.leads || d.data || [])[0];
    if (hit) return `por teléfono de un familiar (${l2n(hit)})`;
  }
  return "";
}
const l2n = (l) => [l.firstName, l.lastName].filter(Boolean).join(" ") || `lead ${l.leadId || l.id || ""}`;

// ---------- Revisar ----------
const fallos3 = new Map(); // Fase 1: intentos fallidos por HECM
async function revisar(aMano) {
  if (corriendo) return;
  const { loftyKey } = await chrome.storage.local.get("loftyKey");
  if (!loftyKey) { if (aMano || porRevisar().length) ver("Falta la API key de Lofty (pégala en la pestaña Lofty). Mientras, las HECM pasan directo a Veri 3 sin revisar."); return; }
  if (!porRevisar().length) { if (aMano) ver("No hay HECM nuevas de Heri por revisar."); return; }
  corriendo = true; parar = false; $("run").disabled = true;
  let n = 0, pasan = 0, ya = 0, filt = 0;
  try {
    while (!parar && (aMano || cfg.activo)) {
      const a = porRevisar()[0];
      if (!a) break;
      const c = caseDe(a), dueno = (a.hecm && a.hecm.dueno) || (c && c.dueno) || a.street;
      window.robot && robot.set("trabajando", `Revisando la HECM de ${dueno}…`);
      ver(`Revisando la HECM de ${dueno} (${a.street})…`);
      const motivo = filtro(a, c);
      let valor, detalle = "";
      if (motivo) { valor = "filtrada"; detalle = motivo; filt++; }
      else {
        try { detalle = await enLofty(a, c); }
        catch (e) {
          if (e.sinKey) break;
          if (/respondió 40[13]\b/.test(e.message)) { decir(`Lofty rechazó la API key (${e.message}). Me detengo.`, "error"); break; }
          // Fase 1: máximo 3 intentos por HECM (antes reintentaba para siempre cada 4 s); luego queda "sinRevisar" y NO pasa
          const n = (fallos3.get(a.key) || 0) + 1; fallos3.set(a.key, n);
          decir(`No pude revisar en Lofty (${e.message}). ${n >= 3 ? "Ya van 3 intentos: la dejo sin revisar (no pasa)." : "Reintento en unos segundos."}`, "error");
          if (n < 3) { await sleep(4000); continue; }
          valor = "sinRevisar"; detalle = "no pude revisar en Lofty: " + e.message;
        }
        if (valor !== "sinRevisar") { valor = detalle ? "si" : "no"; if (detalle) ya++; else pasan++; }
      }
      const pr = prioridad(a, c);
      res[a.key] = { dueno, valor, detalle, prioridad: pr.p, por: pr.por, t: Date.now() };
      await chrome.storage.local.set({ ch3Res: res });
      await domicilios("lofty", { pares: [{ key: a.key, valor, ...(valor === "no" ? { via: destino() } : {}) }] });
      n++;
      if (valor === "si") decir(`↷ HECM de ${dueno}: ya está en Lofty ${detalle}. No pasa a ${quien()}.`);
      else if (valor === "sinRevisar") decir(`⚠ HECM de ${dueno}: no la pude revisar en Lofty; NO pasa a ${quien()}. Dale “volver a revisar” cuando Lofty conteste.`, "error");
      else if (valor === "filtrada") decir(`⏭ HECM de ${dueno}: la filtré (${detalle}). Si la quieres, dale “Dejar pasar” en Chequi 3.`);
      else decir(`✔ HECM de ${dueno} pasa a ${quien()} · prioridad ${pr.p}${pr.por.length ? ` (${pr.por.join(", ")})` : ""}.`);
      await cargar();
    }
  } finally {
    corriendo = false; $("run").disabled = false;
    if (n) decir(`Listo: revisé ${n} HECM · ${pasan} pasan a ${quien()} · ${ya} ya estaban en Lofty · ${filt} filtradas.`);
    window.robot && robot.set(pasan ? "feliz" : "idle", n ? `${pasan} HECM pasan a ${quien()}` : "Listo");
    if (porRevisar().length && cfg.activo && !parar) setTimeout(() => revisar(false), 1500);
  }
}
// Si cambias un filtro, las que había filtrado se vuelven a revisar
async function reevaluarFiltradas() {
  const pares = hecms.filter((a) => a.lofty === "filtrada" && !(res[a.key] && res[a.key].aMano)).map((a) => ({ key: a.key, valor: null }));
  if (pares.length) { await domicilios("lofty", { pares }); ver(`Cambiaste un filtro: vuelvo a revisar ${pares.length} HECM filtrada(s).`); await cargar(); revisar(false); }
}

// ---------- Pintar ----------
function pintar() {
  const fil = hecms.filter((a) => a.lofty === "filtrada"), ya = hecms.filter((a) => a.lofty === "si"), pas = hecms.filter((a) => a.lofty === "no" || a.bvSearched);
  $("count").textContent = porRevisar().length; $("libres").textContent = pas.length; $("enLofty").textContent = ya.length; $("nFilt").textContent = fil.length;
  const sinDom = Object.values(casos).filter((c) => !c.street && (c.estado === "sinDomicilio" || c.estado === "porNombre"));
  const item = (a, botones) => {
    const c = caseDe(a), r = res[a.key] || {}, h = a.hecm || {};
    const dueno = h.dueno || (c && c.dueno) || "";
    return `<li><div class="addr"><b>${esc(dueno)}</b>${r.prioridad != null && a.lofty !== "si" ? ` <span class="tag p${Math.min(3, Math.floor((r.prioridad || 0) / 3))}">prioridad ${r.prioridad}</span>` : ""}
      <small>${esc(a.street)}, ${esc(a.city)} · ${esc(h.lender || "")}${h.nts ? " · NTS " + esc(h.nts) : h.nod ? " · NOD " + esc(h.nod) : ""}${h.subasta ? " · remate " + esc(h.subasta) : ""}</small>
      ${r.detalle ? `<small>${a.lofty === "si" ? "Ya en Lofty " : "Motivo: "}${esc(r.detalle)}</small>` : ""}
      ${(r.por || []).length && a.lofty !== "si" ? `<small>⭐ ${esc(r.por.join(" · "))}</small>` : ""}</div>${botones ? botones(a) : ""}</li>`;
  };
  const dejar = (a) => `<button class="mini" data-k="${esc(a.key)}" data-a="pasar">Dejar pasar</button>`;
  const ord = (l) => l.slice().sort((x, y) => ((res[y.key] || {}).prioridad || 0) - ((res[x.key] || {}).prioridad || 0));
  const grupo = (tit, l, b) => l.length ? `<h4>${tit} (${l.length})</h4><ul>${ord(l).slice(0, 200).map((a) => item(a, b)).join("")}</ul>` : "";
  $("grupos").innerHTML = grupo(`Pasan a ${quien()}`, pas, null) + grupo("Filtradas", fil, dejar) + grupo("Ya en Lofty", ya, dejar) +
    (sinDom.length ? `<h4>Sin domicilio de la casa (Heri) (${sinDom.length})</h4><ul>${sinDom.map((c) => `<li><div class="addr"><b>${esc(c.dueno)}</b><small>${c.estado === "porNombre" ? "Heri lo encontró por nombre: sus teléfonos y familiares están en la lista de Heri" : "BeenVerified no dio domicilio: Heri lo vuelve a buscar por nombre"}</small></div></li>`).join("")}</ul>` : "") ||
    `<span class="empty">Cuando Heri mande HECM al brazo, las reviso aquí.</span>`;
  $("grupos").querySelectorAll("button[data-a=pasar]").forEach((b) => (b.onclick = async () => {
    const k = b.dataset.k; res[k] = { ...(res[k] || {}), aMano: true, detalle: "la dejaste pasar a mano" };
    await chrome.storage.local.set({ ch3Res: res });
    await domicilios("lofty", { pares: [{ key: k, valor: "no", via: destino() }] });
    decir(`La dejaste pasar: va a ${quien()}.`); await cargar();
  }));
}

$("run").onclick = () => revisar(true);
$("reset").onclick = async () => {
  const pares = hecms.filter((a) => a.lofty && !a.bvSearched).map((a) => ({ key: a.key, valor: null }));
  if (pares.length) await domicilios("lofty", { pares });
  res = {}; await chrome.storage.local.set({ ch3Res: {} });
  ver(`Voy a revisar otra vez ${pares.length} HECM.`); await cargar(); revisar(true);
};
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.addresses || ch.hrCasos) cargar().then(() => { if (cfg.activo) revisar(false); });
  if (ch.loftyKey && ch.loftyKey.newValue && cfg.activo) revisar(false);
  if (ch[K("chDestino")]) { $("destino").value = ch[K("chDestino")].newValue === "wb" ? "wb" : "bv"; pintarDestino(); }
});
(async () => { await cargarCfg(); await cargar(); if (cfg.activo) revisar(false); })();
