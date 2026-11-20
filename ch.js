// =====================================================================
// Chequi: el filtro de Lofty. Va entre Propi y Veri. Revisa cada domicilio
// que junta Propi contra Lofty y le pone a.lofty = "no" (pasa a Veri) o
// "si" (ya es lead: no se busca). Veri solo busca los que ya pasaron.
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };                       // solo en pantalla
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };   // también a la bitácora de Capi

let todos = [], zona = "", corriendo = false, parar = false;
const fallos = new Map(); // key → veces que Lofty no contestó

const deZona = () => { const zs = zonasDe(zona); return todos.filter((a) => sirve(a) && lineaDe(a) === LINEA && enZona(a, zs)); }; // cada Chequi solo su línea
const porRevisar = () => deZona().filter((a) => !a.lofty && !a.bvSearched);

async function cargar() {
  const { addresses = {}, zone = "" } = await chrome.storage.local.get(["addresses", "zone"]);
  todos = Object.entries(addresses).map(([key, a]) => ({ ...a, key }));
  zona = zone;
  pintar();
}
function pintar() {
  const z = deZona(), ya = z.filter((a) => a.lofty === "si");
  $("count").textContent = porRevisar().length;
  $("libres").textContent = z.filter((a) => a.lofty === "no").length;
  $("enLofty").textContent = ya.length;
  const ul = $("list");
  ul.innerHTML = "";
  if (!ya.length) { ul.innerHTML = '<li class="empty">Ninguno todavía.</li>'; return; }
  for (const a of ya.slice(0, 300)) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="addr">${esc(a.street)}<br><small>${esc(a.city)}, CA ${esc(a.zip || "")}</small></div>`;
    const b = document.createElement("button");
    b.className = "mini"; b.textContent = "Dejar pasar"; b.title = "Mandarlo a Veri aunque ya esté en Lofty";
    b.onclick = () => domicilios("lofty", { pares: [{ key: a.key, valor: "no" }] });
    li.appendChild(b); ul.appendChild(li);
  }
}

async function revisar(aMano) {
  if (corriendo) return;
  const { loftyKey } = await chrome.storage.local.get("loftyKey");
  if (!loftyKey) { if (aMano || porRevisar().length) ver("Falta la API key de Lofty (pégala en la pestaña Lofty). Mientras, todo pasa directo a Veri sin revisar."); return; }
  if (!porRevisar().length) { if (aMano) ver("No hay domicilios por revisar."); return; }
  corriendo = true; parar = false; $("run").disabled = true;
  let revisados = 0, yaEstaban = 0, hecm = 0;
  try {
    while (!parar && (aMano || $("activo").checked)) {
      const tanda = porRevisar().slice(0, 3); // 3 a la vez
      if (!tanda.length) break;
      window.robot && robot.set("trabajando", `Revisando en Lofty: ${tanda[0].street}…`);
      ver(`Revisando en Lofty: ${tanda.map((a) => a.street).join(" · ")}`);
      const pares = [];
      let falla = null;
      await Promise.all(tanda.map(async (a) => {
        try {
          const esta = await enLoftyPorDomicilio(a);
          pares.push({ key: a.key, valor: esta ? "si" : "no", ...(esta ? {} : { via: destino() }) });
          revisados++; if (!esta && a.origen === "hecm") hecm++;
          if (esta) { yaEstaban++; decir(`↷ ${lineaDir(a)} ya está en Lofty: no pasa a ${quien()} (ahorré un crédito).`); }
        } catch (e) {
          falla = e;
          const n = (fallos.get(a.key) || 0) + 1; fallos.set(a.key, n);
          // Fase 1 · falla cerrada: tras 3 fallos ya NO pasa a Veri/Wibi (antes pasaba como "no está" y podía duplicar el lead
          // y gastar créditos). Queda "sinRevisar"; con “Volver a revisar todos” se reintenta.
          if (n >= 3) pares.push({ key: a.key, valor: "sinRevisar" });
        }
      }));
      if (pares.length) { await domicilios("lofty", { pares }); await cargar(); }
      if (falla) {
        if (falla.sinKey) break;
        if (/respondió 40[13]\b/.test(falla.message)) { decir(`Lofty rechazó la API key (${falla.message}). Me detengo: nada pasa a ${quien()} sin revisar.`, "error"); break; }
        decir(`No pude revisar en Lofty (${falla.message}). Reintento en unos segundos.`, "error");
        await sleep(4000);
      }
    }
  } finally {
    corriendo = false; $("run").disabled = false;
    if (revisados) decir(`Listo: revisé ${revisados} domicilio(s) en Lofty · ${yaEstaban} ya estaban · ` +
      `${revisados - yaEstaban} pasan a ${quien()}.`);
    if (porRevisar().length && $("activo").checked && !parar) setTimeout(() => revisar(false), 1500); // llegaron más mientras tanto
  }
}

// A quién le paso lo aprobado: Veri (BeenVerified) o Wibi (skip trace en Propwire)
const destino = () => ($("destino").value === "wb" ? "wb" : "bv");
const quien = () => (destino() === "wb" ? "Wibi" : "Veri") + (LINEA === "hr" ? " 3" : "");
function pintarDestino() { $("libresTxt").textContent = `pasan a ${quien()}`; }
$("destino").onchange = () => { chrome.storage.local.set({ [K("chDestino")]: destino() }); pintarDestino(); svLog && svLog(`Desde ahora lo que apruebo va a ${quien()}.`); };
$("run").onclick = () => revisar(true);
// ---------- Fase 2: acciones que se pueden pedir por el bus de tareas (registro.js) ----------
window.Tareas && Tareas.atender("revisar", async () => {
  await Tareas.esperarLibre(() => corriendo);
  await revisar(true);
  return $("status").textContent.trim() || "Revisión terminada.";
});
$("reset").onclick = async () => {
  const pares = deZona().filter((a) => a.lofty && a.lofty !== "actualizar" && !a.bvSearched).map((a) => ({ key: a.key, valor: null }));
  fallos.clear();
  if (pares.length) await domicilios("lofty", { pares });
  ver(`Voy a revisar otra vez ${pares.length} domicilio(s).`);
};
$("activo").onchange = () => { chrome.storage.local.set({ chActivo: $("activo").checked }); if ($("activo").checked) revisar(false); else parar = true; };

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.addresses || ch.zone) cargar().then(() => { if ($("activo").checked) revisar(false); });
  if (ch.loftyKey && ch.loftyKey.newValue && $("activo").checked) revisar(false);
  if (ch[K("chDestino")]) { $("destino").value = ch[K("chDestino")].newValue === "wb" ? "wb" : "bv"; pintarDestino(); }
});
(async () => {
  const { chActivo, [K("chDestino")]: chDestino } = await chrome.storage.local.get(["chActivo", K("chDestino")]);
  $("activo").checked = chActivo !== false;
  $("destino").value = chDestino === "wb" ? "wb" : "bv"; pintarDestino();
  await cargar();
  if ($("activo").checked) revisar(false);
})();
