// =====================================================================
// Lógica compartida de "Agente Geo Farming". La usan el background, las
// pestañas de los robots, el panel y el Centro de Mando. Si cambia una
// regla (zona, llave de un domicilio, conteos), se cambia solo aquí.
// =====================================================================
(function (g) {
  const norm = (s) => String(s || "").toLowerCase().replace(/\bcounty\b/g, "").replace(/[^a-z0-9]/g, "");
  const keyOf = (a) => `${a.street}|${a.city}|${a.zip}`.toLowerCase().replace(/[^a-z0-9|]/g, "");
  const lineaDir = (a) => `${a.street}, ${a.city}, CA ${a.zip || ""}`.trim();

  // Zona: "Irvine, 92618, Orange County" → ["Irvine", "92618", "Orange County"] (sin "CA")
  const zonasDe = (zone) => String(zone || "").split(",").map((z) => z.trim()).filter((z) => z && !/^(ca|california)$/i.test(z));
  // los de Heri (HECM) traen su propia zona
  const enZona = (a, zs) => a.origen === "hecm" || !zs.length || zs.some((z) =>
    /^\d{5}$/.test(z) ? a.zip === z : norm(a.city) === norm(z) || (a.county && norm(a.county) === norm(z)));
  // Domicilio que sirve: California y sin skip trace
  const sirve = (a) => a.state === "CA" && !a.skipTraced;

  // ---------- Filtro de Lofty (Chequi) ----------
  // Cada domicilio lleva a.lofty: "no" (Chequi lo revisó y no está) · "si" (ya es lead) · vacío (sin revisar).
  // Pasa a Veri si ya se revisó y no está; o, si el filtro está apagado o no hay API key, todo lo que no esté marcado "si".
  // "actualizar" = viene de Acti (ya es lead de Lofty y se busca para actualizarlo): pasa directo.
  // Fase 1: el interruptor del filtro según la línea. La línea HECM usa el de Chequi 3 (ch3Config.activo), no el de Chequi 1.
  const filtroDe = (linea, st) => (linea === "hr" ? { chActivo: (st.ch3Config || {}).activo === false ? false : true, loftyKey: st.loftyKey } : { chActivo: st.chActivo, loftyKey: st.loftyKey });
  const pasaFiltro = (a, cfg) => a.lofty !== "filtrada" && (a.lofty === "no" || a.lofty === "actualizar" || !!a.bvSearched || ((cfg.chActivo === false || !cfg.loftyKey) && a.lofty !== "si"));
  const sinTipo = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|circle|cir|boulevard|blvd|way|place|pl|terrace|ter|parkway|pkwy|highway|hwy|trail|trl|north|south|east|west|n|s|e|w)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  // ¿Ya hay un lead en Lofty con ese domicilio? (búsqueda de texto libre; compara calle y ciudad)
  // Busca primero con número + calle (ej. "1009 N Jackson") y, si no sale, con menos palabras pero más resultados.
  async function enLoftyPorDomicilio(a) {
    const calle = sinTipo(a.street), ciudad = norm(a.city);
    const coincide = (d) => (d.leads || d.data || []).some((l) => [...(l.leadPropertyList || []), l].some((p) =>
      p && p.streetAddress && sinTipo(p.streetAddress) === calle && (!p.city || norm(p.city) === ciudad)));
    const pal = a.street.trim().split(/\s+/);
    const claves = [...new Set([pal.slice(0, 3).join(" "), pal.slice(0, 2).join(" ")])];
    for (const [i, k] of claves.entries()) {
      const d = await loftyApi(`/leads?limit=${i ? 100 : 50}&key=` + encodeURIComponent(k));
      if (coincide(d)) return true;
    }
    return false;
  }

  // ---------- Wibi (skip trace en Propwire) ----------
  // Chequi manda los domicilios a Veri (BeenVerified) o a Wibi (Propwire), según su interruptor "Mandar a" (chDestino).
  // Lo que Chequi ya aprobó lleva a.via; lo demás sigue al interruptor de ese momento. Los de Acti siempre van a Veri 2.
  // Cada línea tiene su propio interruptor: chDestino (leads nuevos) y chDestino_hr (HECM de Heri)
  const paraWibi = (a, destino) => a.origen !== "lofty" && (a.via === "wb" || (!a.via && destino === "wb"));
  // Línea de cada domicilio: "" = leads nuevos (Propi) · "ac" = Acti · "hr" = HECM de Heri
  const lineaDe = (a) => a.origen === "lofty" ? "ac" : a.origen === "hecm" ? "hr" : "";

  // ---------- Pregunta "¿seguro?" dentro de la página ----------
  // confirm() no aparece dentro del panel lateral de Chrome (el botón no hacía nada): esta sí sale en el panel y en el Mando.
  function preguntar(texto, si = "Sí", no = "Cancelar") {
    return new Promise((ok) => {
      const fondo = document.createElement("div"); fondo.dataset.pregunta = "1";
      fondo.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(2,6,23,.6);display:flex;align-items:center;justify-content:center;padding:16px";
      fondo.innerHTML = `<div style="background:#fff;color:#0f172a;border-radius:10px;padding:14px 16px;max-width:360px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35)">
        <div class="t" style="white-space:pre-line;max-height:60vh;overflow:auto"></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="no" style="padding:6px 12px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer">${no}</button>
        <button class="si" style="padding:6px 12px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer">${si}</button></div></div>`;
      fondo.querySelector(".t").textContent = texto;
      const fin = (v) => { fondo.remove(); ok(v); };
      fondo.querySelector(".si").onclick = () => fin(true);
      fondo.querySelector(".no").onclick = () => fin(false);
      fondo.onclick = (e) => { if (e.target === fondo) fin(false); };
      document.body.appendChild(fondo);
    });
  }

  // ---------- Semáforo de Propwire ----------
  // Propi, Wibi, Wibi 3 y Heri usan la MISMA cuenta de Propwire. Antes de cargar una página de Propwire cada robot pide
  // turno: entre dos cargas de CUALQUIER robot pasan al menos 8–12 s, y entre todos no más de 150 cargas por hora.
  // (Propi lo respeta desde su script en la página: guarda la misma marca "pwUltimo".)
  const PW_GAP = 8000, PW_POR_HORA = 150;
  async function turnoPropwire({ aviso, parar } = {}) {
    const run = async () => {
      const extra = Math.random() * 4000;
      for (;;) {
        if (parar && parar()) return false;
        const { pwUltimo = 0, pwCargas = [] } = await chrome.storage.local.get(["pwUltimo", "pwCargas"]);
        const ahora = Date.now(), hora = pwCargas.filter((t) => t > ahora - 3600e3);
        let espera = Math.max(0, pwUltimo + PW_GAP + extra - ahora);
        if (hora.length >= PW_POR_HORA) espera = Math.max(espera, hora[0] + 3600e3 - ahora);
        if (espera <= 0) { hora.push(ahora); await chrome.storage.local.set({ pwUltimo: ahora, pwCargas: hora.slice(-PW_POR_HORA) }); return true; }
        if (aviso) aviso(espera, hora.length >= PW_POR_HORA);
        await new Promise((r) => setTimeout(r, Math.min(espera, 2000)));
      }
    };
    return typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request("turno-propwire", run) : run();
  }

  // ---------- Heri (ejecuciones de hipotecas inversas administradas por Celink) ----------
  // Solo cuenta si Celink o Compu-Link (el nombre legal de Celink) aparece como administrador de la hipoteca:
  // Celink solo administra hipotecas inversas (HECM). "Secretary of HUD" sin Celink ya no entra.
  const RE_HECM = /compu[\s-]*link|celink/i;
  const corto = (lender) => /compu/i.test(lender) ? "Compu-Link" : /celink/i.test(lender) ? "Celink" : String(lender || "").slice(0, 30);
  const tagsHecm = () => ["preforeclosure", "celink"];

  // ---------- zBuyer (Zeta y Redi) ----------
  // Solo se le reclama a zBuyer un lead que ya teníamos si en Lofty su fuente (Source) es zBuyer,
  // o si tú le diste "Reclamar" a mano en la pestaña de Zeta.
  const deZbuyer = (fuente) => /z\s*-?\s*buyer/i.test(String(fuente || ""));
  const reclamable = (l) => !!l && l.estado === "repetido" && (!!l.aMano || deZbuyer(l.loftyFuente));

  // Los números que muestran el panel y el Centro de Mando
  async function conteos() {
    const { addresses = {}, zone = "", bvState = {}, lote = [], bvPendientes = [], loftyListos = 0, svEventos = [], chActivo, loftyKey, chDestino, lote_wb = [], txHoy = {}, cbHoy = {}, hrCasos = {}, hrPasos = {}, cpResumen = {}, rsResumen = {}, rcResumen = {}, liResumen = {}, alResumen = {}, carpiRes = {}, wibiRes = {}, radarRes = {}, termiRes = {} } =
      await chrome.storage.local.get(["addresses", "zone", "bvState", "lote", "bvPendientes", "loftyListos", "svEventos", "chActivo", "loftyKey", "chDestino", "lote_wb", "txHoy", "cbHoy", "hrCasos", "hrPasos", "cpResumen", "rsResumen", "rcResumen", "liResumen", "alResumen", "carpiRes", "wibiRes", "radarRes", "termiRes"]);
    const cfg = { chActivo, loftyKey };
    const zs = zonasDe(zone), done = bvState.done || {};
    const todos = Object.entries(addresses).filter(([, a]) => sirve(a));
    const lista = todos.filter(([, a]) => lineaDe(a) !== "hr" && enZona(a, zs));
    const deVeri = todos.filter(([, a]) => lineaDe(a) === "" && !paraWibi(a, chDestino)); // los de Acti los busca Veri 2; los HECM, Veri 3; los de Wibi, Wibi
    const paraBV = bvState.onlyZone === false ? deVeri : deVeri.filter(([, a]) => enZona(a, zs));
    const hoy = new Date().toDateString();
    const { acTrabajos = {}, lote_ac = [], bvPendientes_ac = [] } = await chrome.storage.local.get(["acTrabajos", "lote_ac", "bvPendientes_ac"]);
    const ac = Object.values(acTrabajos);
    const { zbLeads = {} } = await chrome.storage.local.get("zbLeads");
    const zb = Object.values(zbLeads);
    return {
      zbTot: zb.length, zbNue: zb.filter((l) => l.estado === "nuevo").length, zbRep: zb.filter(reclamable).length,
      zbRev: zb.filter((l) => l.estado === "revisar").length, zbOtra: zb.filter((l) => l.estado === "otrafuente").length,
      rdPen: zb.filter((l) => reclamable(l) && !l.borrador && !l.realizado).length, rdHec: zb.filter((l) => reclamable(l) && l.borrador === "hecho" && !l.realizado).length,
      tiPen: zb.filter((l) => l.teams === "pendiente").length, tiHec: zb.filter((l) => l.teams === "enviado").length, // Timi: capturas para Teams
      acBus: ac.filter((t) => t.estado === "buscando").length,
      bus2: Object.values(addresses).filter((a) => a.origen === "lofty" && !a.bvSearched).length, // por buscar en Veri 2
      own2: lote_ac.length, pend2: bvPendientes_ac.length,                                         // Owny 2
      acHechos: ac.filter((t) => t.estado === "actualizado" || t.estado === "cambio").length,
      dom: lista.length,
      rev: lista.filter(([, a]) => !a.lofty && !a.bvSearched).length,
      libres: lista.filter(([, a]) => a.lofty === "no").length,
      enLofty: lista.filter(([, a]) => a.lofty === "si").length,
      bus: paraBV.filter(([k, a]) => pasaFiltro(a, cfg) && !a.bvSearched && !done[k]).length + (bvState.manual || []).filter((a) => !done[a.key]).length,
      buscados: Object.keys(done).length + Object.values(addresses).filter((a) => a.bvSearched).length,
      own: lote.length, pend: bvPendientes.length, lis: loftyListos,
      wbBus: lista.filter(([, a]) => paraWibi(a, chDestino) && pasaFiltro(a, cfg) && !a.bvSearched).length, wbLote: lote_wb.length, // Wibi
      destino: chDestino === "wb" ? "wb" : "bv",
      cpWibi: cpResumen.wibi || 0, cpBorrar: cpResumen.borrar || 0, // Carpi (viejo)
      raDatos: radarRes.conDatos || 0, raZips: radarRes.total || 0, teCalientes: termiRes.calientes || 0, teTop: termiRes.top ? `${termiRes.top.zip} (${termiRes.top.score})` : "", teT: termiRes.t || 0, teN: termiRes.n || 0, // Zonas calientes
      cpLimpias: carpiRes.limpios || 0, cpCarpetas: carpiRes.carpetas || 0, // Carpi (brazo Propwire)
      wiPorSubir: wibiRes.porSubir || 0, wiHoy: wibiRes.fecha === new Date().toLocaleDateString("en-CA") ? wibiRes.aLoftiHoy || 0 : 0, // Wibi (brazo Propwire)
      ...(alResumen.fecha === new Date().toLocaleDateString("en-CA") ? { alHechos: alResumen.done || 0, alSms: alResumen.sms || 0, alLlamadas: alResumen.calls || 0 } : {}), // Marki (Agente Lofty)
      liMovidos: liResumen.fecha === new Date().toLocaleDateString("en-CA") ? liResumen.movidosHoy || 0 : 0, liRevisar: liResumen.revisar || 0, // Limpi
      rsAbiertos: rsResumen.abiertos || 0, rsInteresados: rsResumen.interesados || 0, // Resi
      rcAbiertos: rcResumen.abiertos || 0, rcInteresados: rcResumen.interesados || 0, // Resi 2 (Compri)
      ...(await chrome.storage.local.get("prCasos").then(({ prCasos = {} }) => { const v = Object.values(prCasos).filter((x) => x.activo !== false); return { prHecm: v.filter((x) => x.hecm).length, prHer: v.filter((x) => x.hecm && x.fallecido).length, prPasados: v.filter((x) => x.pasadoAHeri).length }; })), // Prope
      hrHecm: Object.keys(hrCasos).length, hrRev: hrPasos.revisados || 0, hrBrazo: Object.values(hrCasos).filter((x) => x.estado === "brazo").length, // Heri
      // Línea HECM: Chequi 3 → Veri 3 → Owny 3 (o Wibi 3)
      ...(await (async () => {
        const { chDestino_hr, lote_hr = [], bvPendientes_hr = [], lote_wb_hr = [], ch3Res = {}, ch3Config = {} } = await chrome.storage.local.get(["chDestino_hr", "lote_hr", "bvPendientes_hr", "lote_wb_hr", "ch3Res", "ch3Config"]);
        const cfg = filtroDe("hr", { ch3Config, loftyKey });
        const r3 = Object.values(ch3Res); // registro de Chequi 3 (los que ya estaban en Lofty se podan de addresses)
        const h = Object.values(addresses).filter((a) => a.origen === "hecm" && sirve(a));
        return { rev3: h.filter((a) => !a.lofty && !a.bvSearched).length, libres3: h.filter((a) => a.lofty === "no").length, enLofty3: Math.max(h.filter((a) => a.lofty === "si").length, r3.filter((x) => x.valor === "si").length), filt3: h.filter((a) => a.lofty === "filtrada").length,
          bus3: h.filter((a) => !paraWibi(a, chDestino_hr) && pasaFiltro(a, cfg) && !a.bvSearched).length,
          wbBus3: h.filter((a) => paraWibi(a, chDestino_hr) && pasaFiltro(a, cfg) && !a.bvSearched).length, wbLote3: lote_wb_hr.length,
          own3: lote_hr.length, pend3: bvPendientes_hr.length, destino3: chDestino_hr === "wb" ? "wb" : "bv" };
      })()),
      txHoy: txHoy.dia === new Date().toLocaleDateString("en-CA") ? txHoy.n || 0 : 0, // Texi: SMS mandados hoy
      cbHoy: cbHoy.dia === new Date().toLocaleDateString("en-CA") ? cbHoy.n || 0 : 0, // Compri: SMS mandados hoy
      enviados: svEventos.filter((e) => new Date(e.t).toDateString() === hoy && /Enviados a Lofty/i.test(e.texto))
        .reduce((s, e) => s + (parseInt((e.texto.match(/(\d+)/) || [])[1], 10) || 0), 0),
      svEventos,
    };
  }

  // Cupo compartido para la API de Lofty: entre todos los robots (Chequi, Chequi 3, Acti, Zeta…) máximo 3 llamadas a la vez.
  async function conCupoLofty(fn) {
    if (typeof navigator === "undefined" || !navigator.locks) return fn();
    for (const i of [0, 1, 2]) {
      let r, tomado = false;
      await navigator.locks.request("lofty-api-" + i, { ifAvailable: true }, async (l) => { if (l) { tomado = true; r = await fn(); } });
      if (tomado) return r;
    }
    return navigator.locks.request("lofty-api-" + Math.floor(Math.random() * 3), fn);
  }
  // API de Lofty (con la API key que se pega en la pestaña Lofty). Si Lofty pide ir más lento (429), espera y reintenta.
  async function loftyApi(path, opts = {}) {
    const { loftyKey } = await chrome.storage.local.get("loftyKey");
    if (!loftyKey) throw Object.assign(new Error("Falta la API key de Lofty."), { sinKey: true });
    let r;
    for (let intento = 0; ; intento++) {
      r = await conCupoLofty(() => fetch("https://api.lofty.com/v1.0" + path, {
        method: opts.method || "GET",
        headers: { Authorization: "token " + loftyKey, "X-Error-Status": "true", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
        ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
        ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(opts.timeout || 30000) } : {}), // Fase 1: sin respuesta en 30 s = error (antes podía colgarse para siempre)
      }));
      if ((r.status !== 429 && r.status !== 503) || intento >= 4) break;
      const ra = parseInt(r.headers.get("Retry-After") || "", 10);
      await new Promise((z) => setTimeout(z, (ra > 0 ? ra * 1000 : 2000 * 2 ** intento) + Math.random() * 500)); // 2, 4, 8, 16 s
    }
    if (!r.ok) {
      const det = await r.json().catch(() => ({}));
      throw new Error("Lofty respondió " + r.status + (det.message ? ": " + String(det.message).slice(0, 120) : ""));
    }
    return r.json().catch(() => ({}));
  }

  // Ventanas de trabajo: cada brazo tiene SU propia ventana de Chrome para que sus pestañas no choquen
  // cuando dos brazos trabajan al mismo tiempo.
  //   nuevos     = Leads nuevos (Propi, Chequi, Wibi, Veri, Owny, Lofti)
  //   zbuyer     = zBuyer (Zeta, Redi, Timi: Gmail, Lofty y Teams)
  //   actualizar = Actualizar leads (Acti, Veri 2, Owny 2)
  //   hecm       = HECM (Prope, Heri, Chequi 3, Veri 3, Owny 3, Wibi 3)
  const BRAZO_DE = { cp: "nuevos", pr: "hecm", hr: "hecm", ch3: "hecm", bv3: "hecm", ow3: "hecm", wb3: "hecm", pw: "nuevos", ch: "nuevos", wb: "nuevos", bv: "nuevos", ow: "nuevos", lf: "nuevos", tx: "nuevos", cb: "nuevos", rs: "nuevos", rc: "nuevos", li: "nuevos", al: "nuevos", ra: "zonas", te: "zonas",
    zb: "zbuyer", rd: "zbuyer", ti: "zbuyer", ac: "actualizar", bv2: "actualizar", ow2: "actualizar" };
  const NOMBRE_BRAZO = { nuevos: "Leads nuevos", zbuyer: "zBuyer", actualizar: "Actualizar leads", hecm: "HECM", zonas: "Zonas calientes" };
  const brazoActual = () => { try { return BRAZO_DE[document.documentElement.dataset.mod] || "nuevos"; } catch (e) { return "nuevos"; } };
  async function ventanaTrabajo(brazo, { crear = true } = {}) {
    brazo = NOMBRE_BRAZO[brazo] ? brazo : brazoActual();
    const buscar = async () => {
      const { ventanas = {} } = await chrome.storage.local.get("ventanas");
      if (ventanas[brazo]) {
        const w = await chrome.windows.get(ventanas[brazo]).catch(() => null);
        if (w && w.type === "normal") return w.id;
      }
      if (!crear) return null; // solo mirar: no abrir ventana si todavía no hay
      const w = await chrome.windows.create({ type: "normal", focused: false, state: "normal", url: chrome.runtime.getURL("ventana.html?b=" + brazo) });
      const { ventanas: v2 = {} } = await chrome.storage.local.get("ventanas");
      await chrome.storage.local.set({ ventanas: { ...v2, [brazo]: w.id } });
      return w.id;
    };
    // un candado para que dos robots del mismo brazo no abran dos ventanas a la vez
    if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request("ventana-" + brazo, buscar);
    return buscar();
  }
  // ¿Esta pestaña está en la ventana de su brazo? (si no, el robot abre otra en la suya)
  async function enSuVentana(tabId, brazo) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    return !!t && t.windowId === (await ventanaTrabajo(brazo));
  }

  // La lista de domicilios ("addresses") solo la escribe el background, en orden, para que nada se pise.
  // accion: "actualizar" ({ items } de Acti) · "marcar" ({ key, bvSearched }) · "lofty" ({ pares: [{ key, valor: "si" | "no" | null }] }) · "borrar"
  // Mensaje al background con límite de tiempo: si el background está roto, Chrome deja el mensaje colgado para siempre.
  const alFondo = (msg, ms = 1500) => Promise.race([
    chrome.runtime.sendMessage(msg).catch(() => null),
    new Promise((r) => setTimeout(() => r(null), ms)),
  ]);
  // Fase 1: candado para TODA escritura de "addresses" (background y páginas comparten el mismo candado de la extensión).
  // Así el respaldo "sin background" ya no se pisa con la fila del background.
  const conCandadoDom = (fn) => (typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request("domicilios-escribir", fn) : fn());
  // Los cambios a "addresses": un solo lugar para el background y para el respaldo (antes el respaldo no tenía hecm/hecmInfo/hecmQuitar
  // y aun así decía "ok": Heri perdía casos en silencio).
  async function cambiarDomicilios(msg) {
    return conCandadoDom(async () => {
      if (msg.accion === "borrar") return chrome.storage.local.set({ addresses: {}, pwCupo: null });
      const { addresses = {} } = await chrome.storage.local.get("addresses");
      if (msg.accion === "actualizar") {
        for (const a of msg.items || []) addresses[keyOf(a)] = paraActualizar(a, addresses[keyOf(a)]);
      } else if (msg.accion === "lofty") {
        for (const p of msg.pares || []) if (addresses[p.key]) { if (p.valor) addresses[p.key].lofty = p.valor; else delete addresses[p.key].lofty; if (p.via) addresses[p.key].via = p.via; }
      } else if (msg.accion === "hecm") { // domicilios que Heri encontró con HECM (pasan por Chequi 3 → Veri 3 / Wibi 3 → Owny 3 → Lofti)
        for (const a of msg.items || []) {
          const k = keyOf(a), prev = addresses[k] || {};
          if (prev.bvSearched && prev.hecm) continue; // ya se buscó
          addresses[k] = { ...prev, street: a.street, city: a.city, zip: a.zip || prev.zip || "", state: "CA", county: prev.county || a.county || "",
            skipTraced: false, found: prev.found || Date.now(), origen: "hecm", hecm: a.hecm };
        }
      } else if (msg.accion === "hecmInfo") { // Heri corrigió los datos de una HECM que ya está en el brazo
        for (const a of msg.items || []) { const k = keyOf(a); if (addresses[k] && addresses[k].origen === "hecm") addresses[k].hecm = { ...(addresses[k].hecm || {}), ...a.hecm }; }
      } else if (msg.accion === "hecmQuitar") { // solo Celink / Compu-Link: se quitan las HECM de otro lender que aún no se buscan
        for (const [k, a] of Object.entries(addresses)) if (a.origen === "hecm" && !a.bvSearched && !/compu[\s-]*link|celink/i.test((a.hecm && a.hecm.lender) || "")) delete addresses[k];
      } else if (msg.accion === "borrarPropi") { // Fase 1: solo la línea de Propi (leads nuevos); Acti y HECM no se tocan
        for (const [k, a] of Object.entries(addresses)) if (lineaDe(a) === "") delete addresses[k];
        await chrome.storage.local.set({ addresses, pwCupo: null });
        return;
      } else if (msg.accion === "marcar") {
        if (!addresses[msg.key]) return;
        addresses[msg.key].bvSearched = !!msg.bvSearched;
      } else throw new Error("Acción de domicilios desconocida: " + msg.accion);
      return chrome.storage.local.set({ addresses });
    });
  }
  // Si el background no contesta (no está corriendo), se hace aquí mismo para que el botón no falle.
  async function domicilios(accion, datos = {}) {
    const r = await alFondo({ type: "domicilios", accion, ...datos }, 3000);
    if (r && r.ok) return r;
    await cambiarDomicilios({ accion, ...datos }); // si falla, lanza el error (antes se decía "ok" sin hacer nada)
    return { ok: true, sinFondo: true };
  }
  // Los leads de zBuyer ("zbLeads") también los escribe solo el background, en fila: Zeta, Redi y Timi escriben a la vez.
  // cambios = { idDelLead: { campo: valor, … } } y se mezclan con lo que ya tiene ese lead. crear = darlo de alta si no existe.
  async function zbPoner(cambios, crear = false) {
    const r = await alFondo({ type: "zbLeads", accion: "poner", cambios, crear }, 3000);
    if (r && r.ok) return r;
    const { zbLeads = {} } = await chrome.storage.local.get("zbLeads"); // el background no contestó: se hace aquí mismo
    for (const [id, datos] of Object.entries(cambios)) if (zbLeads[id] || crear) zbLeads[id] = { ...(zbLeads[id] || {}), ...datos };
    await chrome.storage.local.set({ zbLeads });
    return { ok: true, sinFondo: true };
  }
  async function zbVaciar() {
    const r = await alFondo({ type: "zbLeads", accion: "vaciar" }, 3000);
    if (!(r && r.ok)) await chrome.storage.local.set({ zbLeads: {}, zbVistos: [] });
  }
  // Abre una pestaña en segundo plano en la ventana de trabajo (primero en blanco y luego la página: así carga igual en todos lados)
  async function abrirPestana(url, brazo) {
    const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
    const vid = await ventanaTrabajo(brazo);
    const t = await chrome.tabs.create({ url: "about:blank", active: false, windowId: vid });
    if (t.windowId !== vid) await chrome.tabs.move(t.id, { windowId: vid, index: -1 }).catch(() => {}); // que quede en la ventana de su brazo
    await pausa(300); await chrome.tabs.update(t.id, { url });
    await pausa(500);
    // esperar a que de verdad deje about:blank y termine de cargar (con varios brazos a la vez Chrome tarda más)
    for (let i = 0; i < 80; i++) {
      const x = await chrome.tabs.get(t.id).catch(() => null);
      if (!x) break;
      const enBlanco = /^about:blank/.test(x.url || "") && !x.pendingUrl;
      if (x.status === "complete" && !enBlanco) break;
      if (enBlanco && i === 10) await chrome.tabs.update(t.id, { url }).catch(() => {}); // no tomó la dirección: otra vez
      await pausa(500);
    }
    return t;
  }
  // Domicilio que manda Acti: se busca otra vez en BeenVerified aunque ya se haya buscado antes
  const paraActualizar = (a, prev = {}) => ({ ...prev, street: a.street, city: a.city, zip: a.zip || prev.zip || "", state: "CA", county: prev.county || "",
    skipTraced: false, bvSearched: false, lofty: "actualizar", origen: "lofty", leadId: String(a.leadId), found: prev.found || Date.now() });
  // ¿Está vivo el background? (es el que guarda lo que encuentra Propwire)
  async function fondoVivo() {
    const r = await alFondo({ type: "ping" }); return !!(r && r.pong);
  }

  Object.assign(g, { preguntar, turnoPropwire, lineaDe, RE_HECM, tagsHecm, corto, norm, keyOf, lineaDir, zonasDe, enZona, sirve, conteos, loftyApi, ventanaTrabajo, enSuVentana, BRAZO_DE, NOMBRE_BRAZO, domicilios, fondoVivo, pasaFiltro, enLoftyPorDomicilio, paraActualizar, paraWibi, filtroDe, deZbuyer, cambiarDomicilios, conCandadoDom, reclamable, zbPoner, zbVaciar, abrirPestana });
})(globalThis);
