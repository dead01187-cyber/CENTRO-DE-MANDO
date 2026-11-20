// =====================================================================
// Lectura y clasificación de Properant, compartida por Prope (pr.js) y Heri (hr.js).
// Todo queda dentro de window.PR para no chocar con los nombres de cada robot.
// =====================================================================
(() => {
// ---------- Clasificar ----------
const tokens = (s) => String(s || "").toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter((t) => t.length > 1);
const REV = /REVERSE|HECM|AMERICAN ADVISORS|LONGBRIDGE|LIBERTY H(OME|M) EQUITY|URBAN FINANCIAL|GENERATION MORTGAGE|MUTUAL OF OMAHA|SECURITY ONE|HIGHLANDS RESIDENTIAL|SENIOR LENDING|CELINK|COMPU[\s-]*LINK|FINANCE OF AMERICA|FIN'?L FREEDOM|FINANCIAL FREEDOM|ONE REVERSE|OPEN MORTGAGE|HIGHTECHLENDING|SYNERGY ONE|SMARTFI|HOUSING\s*&?\s*URBAN|\bHUD\b|SECRETARY OF HOUSING/i;
const HUD_RE = /HOUSING|\bHUD\b|COMMISSIONER|UNITED STATES OF A/i;
const HOA_RE = /HOMEOWNERS|\bHOA\b|OWNERS ASS(OCIATION|N)|COMMUNITY ASS(OCIATION|N)|MAINTENANCE ASS|CONDOMINIUM|LAGUNA (HILLS|WOODS) MUTUAL/i;
const GENERICA = /^(MORTGAGE|FINANCIAL|HOME|LENDING|SERVICES|SERVICING|CORP|CORPORATION|COMPANY|BANK|NATIONAL|TRUST|SAVINGS|LOAN|LOANS|ASSOCIATION|ASSN|GROUP|FUNDING|SOLUTIONS|EQUITY|FEDERAL)$/;
const palabra = (s) => tokens(s).find((t) => t.length > 3 && !GENERICA.test(t)) || "";
const esRev = (h) => /reverse|hecm/i.test(h.tipo || "");
const diasEntre = (a, b) => Math.abs(new Date(a) - new Date(b)) / 864e5;
// Una HECM son DOS deeds of trust del mismo día (el del lender y el de HUD); Properant a veces solo le pone "reverse" a uno.
function prestamos(p) {
  const hs = p.hipotecas || [];
  const marcadas = hs.filter(esRev);
  const rev = hs.filter((h) => esRev(h) || marcadas.some((m) => (m.fecha && h.fecha && diasEntre(m.fecha, h.fecha) <= 3) || (HUD_RE.test(m.lender || "") && !!m.monto && m.monto === h.monto)));
  return { rev, otros: hs.filter((h) => !rev.includes(h)) };
}
// ¿El aviso de ejecución es de la hipoteca inversa?
function esHecmReal(p) {
  const { rev, otros } = prestamos(p);
  if (!rev.length) return { ok: false, motivo: "Properant no muestra una hipoteca inversa abierta" };
  const fl = p.fcLender || "";
  const mismo = (lista) => !!palabra(fl) && lista.some((h) => [h.lender, h.actual].some((l) => palabra(l) === palabra(fl)));
  if (fl && HOA_RE.test(fl) && !REV.test(fl)) return { ok: false, motivo: `el aviso es del HOA (${fl}), no de la hipoteca inversa` };
  if (!otros.length) return { ok: true, motivo: fl ? `lo ejecuta ${fl}; la hipoteca inversa es el único préstamo abierto` : "la hipoteca inversa es el único préstamo abierto" };
  if (fl && (REV.test(fl) || mismo(rev))) return { ok: true, motivo: `lo ejecuta ${fl}` };
  if (fl && mismo(otros)) return { ok: false, motivo: `lo ejecuta ${fl} por otro préstamo (no por la hipoteca inversa)` };
  return { ok: true, dudoso: true, motivo: `lo ejecuta ${fl || "?"} y hay otro préstamo abierto: revisar cuál es` };
}
// La HECM pasó a HUD (el lender original no era HUD y el dueño actual del préstamo sí): Celink administra las de HUD
const pasoAHud = (p) => prestamos(p).rev.some((h) => esRev(h) && HUD_RE.test(h.actual || "") && !HUD_RE.test(h.lender || ""));

const EMPRESA = /\b(LLC|INC|CORP|CORPORATION|COMPANY|BANK|ASSN|ASSOCIATION|COUNTY|CITY|STATE|PUB(LIC)? ADM\w*)\b/i;
const limpiaNombre = (n) => String(n || "").toUpperCase().replace(/\s+(TR|TRS|TRUSTEE|TRUST|ETAL|ET AL|EST OF|ESTATE OF|ESTATE|EST)\b.*$/, "").replace(/[^A-Z' -]/g, " ").replace(/\s+/g, " ").trim();
// Dueño de la escritura hoy (el primero que sea persona)
function duenoActualDe(p) {
  const partes = `${p.owner || ""} & ${p.owner2 || ""}`.split(/\s*&\s*/).map((x) => x.trim()).filter(Boolean);
  return limpiaNombre(partes.find((x) => !EMPRESA.test(x) && !/\bEST(ATE)?\b/i.test(x)) || partes.find((x) => !EMPRESA.test(x)) || "");
}
// Nombre del aviso (borrower): es el que tiene el registro. Si Properant no lo trae, el dueño de la escritura.
function duenoDe(p) {
  const b = String(p.borrower || "").split(/\s*[&;]\s*/)[0];
  if (b && !EMPRESA.test(b) && tokens(b).length >= 2) return limpiaNombre(b);
  return duenoActualDe(p);
}
const mismoNombre = (a, b) => { const x = tokens(a), y = tokens(b); return !!x[0] && x[0] === y[0] && !!x[1] && x[1] === y[1]; }; // APELLIDO + NOMBRE
const RE_MUERTE = /affidavit.*death|death of|decedent|probate|letters|executor|administrat/i;
// Señales de sucesión (es = para la pantalla, en = para la nota de Lofty). fallecido solo con señal fuerte.
function sucesionDe(p) {
  const dueno = duenoDe(p), actual = duenoActualDe(p), titular = `${p.owner || ""} ${p.owner2 || ""}`;
  const fechaHecm = prestamos(p).rev.map((h) => h.fecha).filter(Boolean).sort()[0] || "";
  const es = [], en = []; let fallecido = false, pa = false;
  if (/\bPUB(LIC)?\s+ADM/i.test(titular)) { fallecido = pa = true; es.push("la sucesión la lleva el Public Administrator del condado"); en.push("title is held by the county Public Administrator (estate)"); }
  else if (/\bESTATE\b|\bEST OF\b/i.test(titular)) { fallecido = true; es.push("la casa está a nombre de Estate"); en.push("title is in the name of the estate"); }
  for (const d of p.docs || []) {
    if (!fechaHecm || !d.fecha || !(d.fecha > fechaHecm)) continue; // anterior o del mismo día que la hipoteca inversa: es de un dueño previo
    if (!RE_MUERTE.test(d.tipo || "")) continue;
    const queda = d.grantee || "";
    const persona = !!queda && !EMPRESA.test(queda) && !/\b(TRUST|TR|LIVING|FAMILY|REVOCABLE)\b/i.test(queda);
    if (persona && mismoNombre(queda, dueno)) { es.push(`murió un co-dueño; queda ${dueno} (${d.tipo}, ${d.fecha})`); en.push(`a co-owner died; ${dueno} survives (${d.tipo}, ${d.fecha})`); }
    else if (persona || /probate|letters|executor|administrat|decedent/i.test(d.tipo) || (actual && !mismoNombre(actual, dueno))) {
      fallecido = true; es.push(`${d.tipo} del ${d.fecha}${persona ? `: queda ${queda}` : ""}`); en.push(`${d.tipo} recorded ${d.fecha}${persona ? ` (successor: ${queda})` : ""}`);
    } else { es.push(`${d.tipo} del ${d.fecha} (no se ve quién murió)`); en.push(`${d.tipo} recorded ${d.fecha} (unclear who died)`); }
  }
  if (!pa && actual && dueno && tokens(actual).length >= 2 && !mismoNombre(actual, dueno)) { es.push(`la casa ya está a nombre de ${actual}`); en.push(`title is now in the name of ${actual}`); }
  if (p.ocupada === false || p.ausente) { es.push("el dueño ya no vive ahí"); en.push("owner no longer lives at the property"); }
  if (p.vacante) { es.push("casa vacía"); en.push("property flagged vacant"); }
  return { es, en, fallecido, pa };
}
const isoAmdy = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[2]}/${m[3]}/${m[1]}` : ""; };

// ---------- Corre en la página de Properant (mundo de la página) ----------
// Busca un nombre ("APELLIDO NOMBRE") y regresa las propiedades de Orange County que salen
async function buscarNombre(q) {
  if (!/properant\.com$/i.test(location.hostname)) return { error: "la pestaña no está en Properant" };
  const u = new URL("/api/properties/search", location.origin); u.searchParams.set("q", q); u.searchParams.set("limit", "6");
  let r; try { r = await fetch(u, { credentials: "include" }); } catch (e) { return { error: "Properant no respondió" }; }
  if (r.status === 401 || r.status === 403 || !/json/i.test(r.headers.get("content-type") || "")) return { sesion: true };
  if (r.status === 429) return { lento: true };
  const j = await r.json();
  return { lista: (j.properties || []).filter((p) => /orange/i.test(p.county || "")).map((p) => ({ id: String(p.property_id), street: p.address, city: p.city, owner: p.owner_name || "" })) };
}
// Lee la ficha de una propiedad (mismos campos que usa Prope)
async function leerFicha(id) {
  let x; try { x = await fetch("/api/properties/" + encodeURIComponent(id), { credentials: "include" }); } catch (e) { return { error: "Properant no respondió" }; }
  if (x.status === 429) return { lento: true };
  if (!x.ok || !/json/i.test(x.headers.get("content-type") || "")) return { error: `Properant respondió ${x.status}` };
  const d = await x.json();
  if (!d || !d.property) return { error: "ficha vacía" };
  const P = d.property, fc = d.foreclosure || {}, o = P.owner || {}, liens = P.liens || {}, sh = P.sales_history || {};
  return { item: {
    id: String(P.property_id), apn: P.apn || "", street: P.address, city: P.city, zip: P.zip,
    owner: o.name || P.owner_name || "", owner2: o.name2 || "", borrower: fc.borrower_name || "",
    ocupada: o.owner_occupied !== false, ausente: !!o.is_absentee, vacante: !!P.vacant,
    etapa: fc.stage_label || "", nod: fc.nod_recording_date || "", aviso: fc.recording_date || fc.nod_recording_date || "",
    subasta: fc.auction_date || "", subastaPasada: !!fc.auction_date_passed, estadoRemate: fc.sale_status || "", fcLender: fc.current_lender || fc.original_lender || "",
    trustee: fc.trustee_name || "", trusteeTel: fc.trustee_phone || "", trusteeNum: fc.trustee_sale_number || "",
    saldo: fc.unpaid_balance || "", puja: fc.auction_min_bid || "",
    hipotecas: (liens.mortgages || []).filter((m) => !m.released).map((m) => ({ pos: m.position, lender: m.lender || "", actual: m.current_lender || "", tipo: m.loanType || "", monto: m.amount || "", fecha: m.recordingDate || "" })),
    docs: (sh.transactions || []).slice(0, 40).map((t) => ({ fecha: t.date || "", tipo: t.type || "", grantee: t.grantee || "" })),
    valor: P.estimated_value || "",
  } };
}
// ¿Esta ficha tiene una hipoteca inversa abierta? (Properant a veces la llama "Home Equity Line": se ve por el lender)
const tieneHecm = (p) => prestamos(p).rev.length > 0 || (p.hipotecas || []).some((h) => REV.test(h.lender || "") || REV.test(h.actual || ""));
// Arma el registro de un caso (lo que guarda Prope en prCasos)
function armarCaso(p) {
  const h = esHecmReal(p), su = sucesionDe(p), dueno = duenoDe(p);
  return { ...p, dueno, duenoActual: duenoActualDe(p), todos: [...new Set([p.borrower, p.owner, p.owner2].filter(Boolean))],
    hecm: h.ok, dudoso: !!h.dudoso, motivo: h.motivo, herederos: su.es, senalesEn: su.en, fallecido: su.fallecido, fallecidoPor: su.fallecido ? su.en[0] || "" : "", publicAdmin: su.pa,
    pasoAHud: pasoAHud(p), avisoMdy: isoAmdy(p.aviso), subastaMdy: isoAmdy(p.subasta) };
}
window.PR = { tokens, esHecmReal, sucesionDe, duenoDe, duenoActualDe, pasoAHud, mismoNombre, isoAmdy, prestamos, tieneHecm, armarCaso, buscarNombre, leerFicha };
})();
