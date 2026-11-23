// =====================================================================
// Carpi (brazo Propwire): limpia el CSV que exportas de Propwire.
//  · Quita lo que no es de California, compañías y trusts, lo que ya está
//    en Lofty (por domicilio) y los repetidos.
//  · Guarda una carpeta en Descargas/Carpi/<fecha y nombre>/ con el
//    original, lo que quitó (con el motivo) y el limpio. La borra sola a
//    los N días para no dejar basura.
//  · Te da el archivo limpio (Address, City, State, Zip) para importar a
//    Propwire como lista. Wibi luego sube esos leads a Lofty.
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const tc = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const D = 864e5;
let corriendo = false, parar = false, ultimoLimpio = null, sesion = null;

// ---------- Ajustes ----------
const CHK = ["qCA", "qEmp", "qLofty", "qRep", "pasarTrust"];
async function cargarCfg() {
  const { carpiCfg = {} } = await chrome.storage.local.get("carpiCfg");
  for (const id of CHK) if (carpiCfg[id] != null) $(id).checked = !!carpiCfg[id];
  if (carpiCfg.dias) $("dias").value = carpiCfg.dias;
}
function guardarCfg() {
  const c = { dias: Math.max(1, parseInt($("dias").value, 10) || 7) };
  for (const id of CHK) c[id] = $(id).checked;
  chrome.storage.local.set({ carpiCfg: c });
  return c;
}
[...CHK, "dias"].forEach((id) => ($(id).onchange = guardarCfg));

// ---------- CSV ----------
const celda = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; /* Fase 1: sin fórmulas */ return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const aCSV = (cabeza, filas) => [cabeza.map(celda).join(","), ...filas.map((f) => cabeza.map((h) => celda(f[h])).join(","))].join("\r\n");
const leerArchivo = (f) => new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result || "")); r.onerror = () => mal(r.error); r.readAsText(f); });

// ---------- ¿Compañía o trust? ----------
const DUENOS = ["Owner 1 First Name", "Owner 1 Last Name", "Owner 2 First Name", "Owner 2 Last Name", "Owner 3 First Name", "Owner 3 Last Name", "Owner 4 First Name", "Owner 4 Last Name"];
function esEmpresa(f) {
  const nombres = DUENOS.map((h) => f[h] || "").join(" ").trim();
  const tipo = String(f["Owner Type"] || "");
  if (tipo && !/individual|person/i.test(tipo) && /company|corporat|trust|business|llc|entity|government|bank|estate/i.test(tipo)) return true;
  return !!nombres && Core.ENTITY_RE.test(nombres);
}
// Trust de una persona (FAMILY TRUST, LIVING TR, "APELLIDO NOMBRE TR"…) vs. compañía (LLC, Inc, banco…)
const RE_COMPANIA = /\b(L\.?L\.?C|L\.?L\.?P|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO\.|LTD|LIMITED|BANK|ASSN|ASSOCIATION|CHURCH|MINISTRIES|HOLDINGS?|PROPERT(?:Y|IES)|INVESTMENTS?|PARTNERS(?:HIP)?|FOUNDATION|COUNTY|CITY OF|STATE OF|UNIVERSITY|SCHOOL|DISTRICT|GROUP|VENTURES?|CAPITAL|REALTY|MANAGEMENT|MGMT|DEVELOPMENT|FUND|HOA|ENTERPRISES?|SERVICES|SOLUTIONS|AUTHORITY|AGENCY|FEDERAL|NATIONAL|MORTGAGE|LENDING|FINANCIAL|INVESTORS?|RENTALS?|ACQUISITIONS?|L\.?P)(?![A-Za-z0-9])/i;
const RE_TRUST = /\b(TRUSTS?|TRUSTEES?|TR|TRS|TTEES?|REVOCABLE|IRREVOCABLE|LIVING|FAMILY|SURVIVORS?|ESTATE)(?![A-Za-z0-9])/i;
function esTrust(f) { const n = DUENOS.map((h) => f[h] || "").join(" "); return RE_TRUST.test(n) && !RE_COMPANIA.test(n); }
const calleDe = (f) => String(f["Address"] || f["Property Address"] || f["Street"] || "").trim();

// ---------- Guardar en la carpeta (Descargas/Carpi/...) ----------
const limpioNombre = (s) => String(s).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
async function bajar(ruta, texto) {
  const url = URL.createObjectURL(new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" }));
  try { return await chrome.downloads.download({ url, filename: ruta, conflictAction: "uniquify", saveAs: false }); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
}

// ---------- Limpiar ----------
async function limpiar() {
  if (corriendo) return;
  const f = $("archivo").files[0];
  if (!f) { ver("Primero escoge el CSV que bajaste de Propwire."); $("archivo").focus(); return; }
  return limpiarTexto(await leerArchivo(f), f.name);
}
async function limpiarTexto(texto, nombreArch, deTermi = false) {
  if (corriendo) return false;
  const cfg = guardarCfg();
  corriendo = true; parar = false; botones();
  window.robot && robot.set("trabajando", "Limpiando el archivo de Propwire…");
  try {
    const p = Papa.parse(texto, { header: true, skipEmptyLines: true });
    const filas = p.data || [], cabeza = p.meta.fields || [];
    if (!cabeza.includes("Address")) throw new Error("no parece un CSV de Propwire (no tiene la columna Address)");
    const quitados = [], buenos = [], vistos = new Set(), cuenta = { ca: 0, emp: 0, lofty: 0, rep: 0 };
    for (const r of filas) {
      const calle = calleDe(r), ciudad = String(r["City"] || "").trim(), estado = String(r["State"] || "").trim().toUpperCase();
      let motivo = "";
      if (!calle) motivo = "Sin domicilio";
      else if (cfg.qCA && estado && estado !== "CA" && estado !== "CALIFORNIA") { motivo = "Fuera de California"; cuenta.ca++; }
      else if (cfg.qEmp && esEmpresa(r) && !(cfg.pasarTrust && esTrust(r))) { motivo = esTrust(r) ? "Trust" : "Compañía"; cuenta.emp++; }
      else if (cfg.qRep) {
        const k = Core.addrKey(calle, ciudad);
        if (vistos.has(k)) { motivo = "Repetido en el archivo"; cuenta.rep++; } else vistos.add(k);
      }
      if (motivo) quitados.push({ ...r, Motivo: motivo }); else buenos.push(r);
    }
    // Ya en Lofty (por domicilio), de 3 en 3 como Chequi
    let limpios = buenos;
    if (cfg.qLofty) {
      const { loftyKey } = await chrome.storage.local.get("loftyKey");
      if (!loftyKey) decir("Carpi: falta la API key de Lofty (pestaña Lofty); no pude revisar cuáles ya están en Lofty.", "error");
      else {
        limpios = [];
        let i = 0;
        for (; i < buenos.length && !parar; i += 3) {
          ver(`Revisando en Lofty… ${Math.min(i + 3, buenos.length)} de ${buenos.length}`);
          const tanda = buenos.slice(i, i + 3);
          const res = await Promise.all(tanda.map(async (r) => {
            for (let k = 0; k < 3; k++) {
              try { return await enLoftyPorDomicilio({ street: calleDe(r), city: String(r["City"] || "") }); }
              catch (e) { if (e.sinKey) throw e; await sleep(2500); }
            }
            return null; // Lofty no contestó: se deja (mejor revisar de más que perder un lead)
          }));
          tanda.forEach((r, j) => { if (res[j] === true) { quitados.push({ ...r, Motivo: "Ya está en Lofty" }); cuenta.lofty++; } else limpios.push(r); });
        }
        if (i < buenos.length) limpios.push(...buenos.slice(i)); // me pararon: lo que no alcancé a revisar se queda
      }
    }
    // Carpeta
    const fecha = new Date(), sello = fecha.toLocaleDateString("en-CA") + " " + fecha.toTimeString().slice(0, 5).replace(":", "-");
    const ciudades = [...new Set(limpios.map((r) => tc(r["City"])).filter(Boolean))];
    const nombre = limpioNombre(`${sello} ${ciudades.slice(0, 2).join(", ") || nombreArch.replace(/\.csv$/i, "")}`);
    const base = `Carpi/${nombre}/`;
    const paraPW = limpios.map((r) => ({ Address: calleDe(r), City: r["City"] || "", State: r["State"] || "CA", Zip: r["Zip"] || "" }));
    const ids = [];
    ids.push(await bajar(base + "1-original.csv", texto.replace(/^﻿/, "")));
    ids.push(await bajar(base + "2-quitados.csv", aCSV(["Motivo", ...cabeza], quitados)));
    ids.push(await bajar(base + "3-limpio-completo.csv", aCSV(cabeza, limpios)));
    const idLimpio = await bajar(base + "4-limpio-para-importar-a-propwire.csv", aCSV(["Address", "City", "State", "Zip"], paraPW));
    ids.push(idLimpio);
    const reg = { nombre, archivo: nombreArch, deTermi, t: Date.now(), dias: cfg.dias, ids, idLimpio, total: filas.length, limpios: limpios.length, cuenta,
      direcciones: paraPW.map((r) => ({ street: r.Address, city: r.City, state: r.State, zip: r.Zip })) };
    const { carpiCarpetas = [] } = await chrome.storage.local.get("carpiCarpetas");
    carpiCarpetas.unshift(reg);
    await chrome.storage.local.set({ carpiCarpetas: carpiCarpetas.slice(0, 60), carpiRes: { t: Date.now(), limpios: limpios.length, quitados: quitados.length, carpetas: carpiCarpetas.filter((c) => !c.borrada).length } });
    ultimoLimpio = { texto: aCSV(["Address", "City", "State", "Zip"], paraPW), nombre };
    sesion = { nombre, base, cabeza, limpios, quitados, total: filas.length, cuenta };
    pintarNums(filas.length, limpios.length, cuenta); pintarQuitados(quitados);
    decir(`Carpi: listo. De ${filas.length} propiedades quedaron ${limpios.length} limpias (quité ${cuenta.ca} fuera de CA, ${cuenta.emp} compañías/trusts, ${cuenta.lofty} ya en Lofty y ${cuenta.rep} repetidas)` +
      (parar ? " — me paraste: las que no alcancé a revisar en Lofty se quedaron en el limpio" : "") +
      `. Guardé todo en Descargas/Carpi/${nombre} (se borra en ${cfg.dias} días). Importa a Propwire el archivo “4-limpio-para-importar-a-propwire.csv”${deTermi ? ', hazle skip trace, y en Wibi ya está escogida esta lista: dale Leer' : ''}.`);
    return true;
    window.robot && robot.set("feliz", `${limpios.length} limpias · archivo listo para Propwire`);
    pintarCarpetas();
  } catch (e) {
    decir("Carpi: no pude limpiar el archivo: " + e.message, "error");
    window.robot && robot.set("error", "No pude limpiar el archivo");
  } finally { corriendo = false; botones(); }
}

// ---------- Borrar carpetas viejas ----------
async function purgar() {
  const { carpiCarpetas = [] } = await chrome.storage.local.get("carpiCarpetas");
  let cambio = false, borradas = 0;
  for (const c of carpiCarpetas) {
    if (c.borrada || Date.now() - c.t < (c.dias || 7) * D) continue;
    for (const id of c.ids || []) {
      try { await chrome.downloads.removeFile(id); } catch (e) {}
      try { await chrome.downloads.erase({ id }); } catch (e) {}
    }
    c.borrada = Date.now(); delete c.direcciones; cambio = true; borradas++;
  }
  if (cambio) {
    await chrome.storage.local.set({ carpiCarpetas });
    window.svLog && svLog(`Carpi: borré ${borradas} carpeta(s) vieja(s) de Descargas/Carpi para no dejar basura.`);
    const { carpiRes = {} } = await chrome.storage.local.get("carpiRes");
    chrome.storage.local.set({ carpiRes: { ...carpiRes, carpetas: carpiCarpetas.filter((c) => !c.borrada).length } });
    pintarCarpetas();
  }
}

// ---------- Pantalla ----------
function pintarNums(total, limpio, c) {
  $("nTotal").textContent = total; $("nLimpio").textContent = limpio; $("nCA").textContent = c.ca; $("nEmp").textContent = c.emp; $("nLofty").textContent = c.lofty;
}
function pintarQuitados(q) {
  $("quitados").innerHTML = q.length ? q.slice(0, 400).map((r, i) => `<li><div class="q">${esc(calleDe(r))}<small>${esc(tc(r["City"]))}, ${esc(r["State"] || "")} · ${esc(DUENOS.map((h) => r[h] || "").join(" ").replace(/\s+/g, " ").trim())}</small></div><span class="tag">${esc(r.Motivo)}</span>${/^(Trust|Compañía)$/.test(r.Motivo) && sesion ? `<button class="mini pasar" data-i="${i}" title="Regresarlo al archivo limpio">Dejar pasar</button>` : ""}</li>`).join("") +
    (q.length > 400 ? `<li class="empty">…y ${q.length - 400} más (están en 2-quitados.csv)</li>` : "") : '<span class="empty">No quité ninguna.</span>';
}
async function pintarCarpetas() {
  const { carpiCarpetas = [] } = await chrome.storage.local.get("carpiCarpetas");
  $("carpetas").innerHTML = carpiCarpetas.length ? carpiCarpetas.map((c) => {
    const queda = Math.max(0, Math.ceil(((c.dias || 7) * D - (Date.now() - c.t)) / D));
    return `<li><div class="q">${esc(c.nombre)}<small>${c.limpios} limpias de ${c.total} · ${c.borrada ? "ya se borró" : `se borra en ${queda} día(s)`}</small></div></li>`;
  }).join("") : '<span class="empty">Sin carpetas.</span>';
  const ult = carpiCarpetas.find((c) => !c.borrada);
  $("bajar").hidden = !ult && !ultimoLimpio; $("carpeta").hidden = !ult;
}
function botones() { $("run").disabled = corriendo; $("stopBtn").hidden = !corriendo; }

// "Dejar pasar": regresa una propiedad quitada (trust o compañía) al archivo limpio y vuelve a guardar los archivos
async function dejarPasar(i) {
  if (!sesion || corriendo) return;
  const r = sesion.quitados[i]; if (!r) return;
  sesion.quitados.splice(i, 1);
  const { Motivo, ...fila } = r; sesion.limpios.push(fila); sesion.cuenta.emp = Math.max(0, sesion.cuenta.emp - 1);
  const { carpiPasados = {} } = await chrome.storage.local.get("carpiPasados");
  carpiPasados[Core.addrKey(calleDe(fila), String(fila["City"] || ""))] = Date.now(); // Wibi tampoco lo quita
  const paraPW = sesion.limpios.map((x) => ({ Address: calleDe(x), City: x["City"] || "", State: x["State"] || "CA", Zip: x["Zip"] || "" }));
  const bajarSobre = async (ruta, texto) => { const url = URL.createObjectURL(new Blob(["\ufeff" + texto], { type: "text/csv;charset=utf-8" })); try { return await chrome.downloads.download({ url, filename: ruta, conflictAction: "overwrite", saveAs: false }); } finally { setTimeout(() => URL.revokeObjectURL(url), 60000); } };
  const ids = [await bajarSobre(sesion.base + "2-quitados.csv", aCSV(["Motivo", ...sesion.cabeza], sesion.quitados)),
    await bajarSobre(sesion.base + "3-limpio-completo.csv", aCSV(sesion.cabeza, sesion.limpios)),
    await bajarSobre(sesion.base + "4-limpio-para-importar-a-propwire.csv", aCSV(["Address", "City", "State", "Zip"], paraPW))];
  ultimoLimpio = { texto: aCSV(["Address", "City", "State", "Zip"], paraPW), nombre: sesion.nombre };
  const { carpiCarpetas = [] } = await chrome.storage.local.get("carpiCarpetas");
  const c = carpiCarpetas.find((x) => x.nombre === sesion.nombre);
  if (c) { c.limpios = sesion.limpios.length; c.direcciones = paraPW.map((x) => ({ street: x.Address, city: x.City, state: x.State, zip: x.Zip })); c.ids = [...new Set([...(c.ids || []), ...ids])]; c.idLimpio = ids[2]; }
  const { carpiRes = {} } = await chrome.storage.local.get("carpiRes");
  await chrome.storage.local.set({ carpiPasados, carpiCarpetas, carpiRes: { ...carpiRes, limpios: sesion.limpios.length, quitados: sesion.quitados.length } });
  pintarNums(sesion.total, sesion.limpios.length, sesion.cuenta); pintarQuitados(sesion.quitados); pintarCarpetas();
  decir(`Carpi: dejé pasar ${calleDe(fila)} (${Motivo}). El archivo limpio ya lo trae: ahora son ${sesion.limpios.length}.`);
}
$("quitados").addEventListener("click", (e) => { const b = e.target.closest("button.pasar"); if (b) dejarPasar(+b.dataset.i); });
$("run").onclick = limpiar;
$("stopBtn").onclick = () => { parar = true; ver("Parando…"); };
$("bajar").onclick = async () => {
  if (ultimoLimpio) { await bajar(`Carpi/${ultimoLimpio.nombre}/4-limpio-para-importar-a-propwire.csv`, ultimoLimpio.texto); return; }
  const { carpiCarpetas = [] } = await chrome.storage.local.get("carpiCarpetas");
  const c = carpiCarpetas.find((x) => !x.borrada && x.direcciones);
  if (c) await bajar(`Carpi/${c.nombre}/4-limpio-para-importar-a-propwire.csv`, aCSV(["Address", "City", "State", "Zip"], c.direcciones.map((d) => ({ Address: d.street, City: d.city, State: d.state, Zip: d.zip }))));
};
$("carpeta").onclick = async () => {
  const { carpiCarpetas = [] } = await chrome.storage.local.get("carpiCarpetas");
  const c = carpiCarpetas.find((x) => !x.borrada); if (c && c.idLimpio) chrome.downloads.show(c.idLimpio);
};

cargarCfg().then(() => { pintarCarpetas(); purgar(); setInterval(purgar, 60 * 60000); });
