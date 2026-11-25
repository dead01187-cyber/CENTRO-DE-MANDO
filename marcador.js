// =====================================================================
// Marcador vs Anna (Fase Anna 3) — recolecta en Lofty y pinta la tabla en el Tablero.
// Leads que entran a la cuenta: los del pool de Anna (y los que silenciamos) + los que contactaron tus
// robots en los últimos 30 días (Cerebro + registro de SMS). Por cada lead lee: el lead (creado, etapa),
// su historial de SMS (los de Anna vienen con textType "AI") y sus citas. A ritmo seguro y con caché de 2 h.
// Resultado: marcadorRes = { t, n, r7, r30 }. Solo LEE: no escribe nada en Lofty.
// =====================================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const M = window.MARCADOR_CORE, CACHE_TTL = 2 * 3600e3, D30 = 30 * 864e5;
  let corriendo = false, dias = 7;
  try { dias = Number(localStorage.getItem("marcadorDias")) === 30 ? 30 : 7; } catch (e) {}

  async function leadsDelMarcador() {
    const ahora = Date.now();
    const st = await chrome.storage.local.get(["cerebroContactos", "smsRegistro", "annaSilenciados"]);
    const contactos = {};
    const pon = (id, c) => { if (id == null || id === "") return; (contactos[String(id)] = contactos[String(id)] || []).push(c); };
    for (const c of st.cerebroContactos || []) if (ahora - c.t < D30) pon(c.leadId, { t: c.t, canal: c.canal, robot: c.robot });
    for (const e of st.smsRegistro || []) if (e.estado === "enviado" && ahora - e.t < D30) pon(e.leadId, { t: e.t, canal: "sms", robot: e.fuente }); // historial de antes del Cerebro
    // sin duplicados (el mismo SMS puede estar en los dos registros)
    for (const k of Object.keys(contactos)) { const vistos = new Set(); contactos[k] = contactos[k].filter((c) => { const x = `${c.canal}:${Math.round(c.t / 60e3)}`; if (vistos.has(x)) return false; vistos.add(x); return true; }); }
    const pool = await Cerebro.poolAnna(true);
    const ids = new Set([...pool.map((x) => x.leadId), ...Object.keys(st.annaSilenciados || {}), ...Object.keys(contactos)]);
    return { ids: [...ids], contactos };
  }

  async function datosDe(id) {
    const { marcadorCache = {} } = await chrome.storage.local.get("marcadorCache");
    const c = marcadorCache[id];
    if (c && Date.now() - c.t < CACHE_TTL) return c;
    const api = (p) => Cerebro.api(p, { llave: "annaKey" });
    const l = await api(`/v1.0/leads/${encodeURIComponent(id)}`).then((d) => d.lead || d.data || d).catch(() => ({}));
    await sleep(120);
    const tx = await api(`/v1.0/communication/text?leadId=${encodeURIComponent(id)}&limit=60`).then((d) => (d.texts || d.data || []).map(M.textoDeLofty)).catch(() => []);
    await sleep(120);
    const citas = await api(`/v1.0/appts?leadId=${encodeURIComponent(id)}`).then((d) => (d.appts || d.appointments || d.data || (Array.isArray(d) ? d : [])).filter((a) => !a.deleteFlag).map((a) => ({ creado: M.tiempo(a.createTime) }))).catch(() => []);
    await sleep(120);
    const v = { t: Date.now(), creado: M.tiempo(l.createTime), etapa: l.stage || "", textos: tx, citas };
    const { marcadorCache: mc = {} } = await chrome.storage.local.get("marcadorCache");
    mc[id] = v;
    const ks = Object.keys(mc); if (ks.length > 3000) ks.sort((a, b) => mc[a].t - mc[b].t).slice(0, ks.length - 3000).forEach((k) => delete mc[k]);
    await chrome.storage.local.set({ marcadorCache: mc });
    return v;
  }

  async function actualizar() {
    if (corriendo) return;
    corriendo = true; $("marcadorBtn").disabled = true;
    try {
      $("marcadorEstado").textContent = "Leyendo el pool de Anna y lo que hicieron tus robots…";
      const { ids, contactos } = await leadsDelMarcador();
      const { rsConfig = {} } = await chrome.storage.local.get("rsConfig");
      const buenas = [rsConfig.etapaCaliente || "Hot", rsConfig.etapaTibio || "Warm"];
      const leads = [];
      for (let i = 0; i < ids.length; i++) {
        $("marcadorEstado").textContent = `Leyendo en Lofty… ${i + 1} de ${ids.length} leads (la primera vez tarda; después usa la caché de 2 h)`;
        const d = await datosDe(ids[i]);
        leads.push({ leadId: ids[i], ...d, contactos: contactos[ids[i]] || [] });
      }
      const ahora = Date.now();
      const res = { t: ahora, n: ids.length, r7: M.marcador(leads, { ahora, dias: 7, etapasBuenas: buenas }), r30: M.marcador(leads, { ahora, dias: 30, etapasBuenas: buenas }) };
      await chrome.storage.local.set({ marcadorRes: res });
      pintar(res);
    } catch (e) { $("marcadorEstado").textContent = (e.sinKey ? "Falta la API key de Lofty (pestaña Lofty). " : "No pude armar el marcador: ") + e.message; }
    finally { corriendo = false; $("marcadorBtn").disabled = false; }
  }

  function pintar(res) {
    if (!res) { $("marcadorEstado").textContent = "Todavía no hay marcador. Dale “Actualizar marcador” (lee Lofty, no cambia nada)."; return; }
    const r = dias === 30 ? res.r30 : res.r7, A = r.anna, R = r.robots, G = r.ganador;
    const f = (v, suf = "") => (v == null ? "—" : `${v}${suf}`);
    const filas = [
      ["Leads contactados", A.contactados, R.contactados, G.contactados],
      ["Tiempo al primer contacto (mediana)", f(A.minutosMediana, " min"), f(R.minutosMediana, " min"), G.minutosMediana],
      ["% que contestó", f(A.pctContesto, "%"), f(R.pctContesto, "%"), G.pctContesto],
      ["Pasaron a Warm / Hot", A.warmHot, R.warmHot, G.warmHot],
      ["Citas", A.citas, R.citas, G.citas],
      ["Bajas (STOP)", `${A.bajas}${A.pctBajas != null ? ` (${A.pctBajas}%)` : ""}`, `${R.bajas}${R.pctBajas != null ? ` (${R.pctBajas}%)` : ""}`, G.pctBajas],
    ];
    const tabla = $("marcador"); tabla.textContent = "";
    const tr = (celdas, th = false) => { const t = document.createElement("tr"); celdas.forEach((c, i) => { const x = document.createElement(th ? "th" : "td"); x.textContent = c; if (i) x.className = "num"; t.appendChild(x); }); return t; };
    tabla.appendChild(tr(["", "Anna", "Tus robots", "Gana"], true));
    for (const [n, a, b, g] of filas) {
      const t = tr([n, String(a), String(b), g === "robots" ? "Tus robots" : g === "anna" ? "Anna" : "Empate"]);
      t.lastChild.classList.add(g === "robots" ? "gana-robots" : g === "anna" ? "gana-anna" : "empate");
      tabla.appendChild(t);
    }
    const ganados = Object.values(G).filter((x) => x === "robots").length, perdidos = Object.values(G).filter((x) => x === "anna").length;
    $("marcadorRes").textContent = `Últimos ${dias} días: tus robots ganan ${ganados} de 6 · Anna gana ${perdidos}`;
    $("marcadorEstado").textContent = `Actualizado ${new Date(res.t).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · ${res.n} leads revisados. Cada lead cuenta para quien lo contactó primero. "Warm/Hot" es la etapa de hoy.`;
    document.querySelectorAll("[data-dias]").forEach((b) => b.classList.toggle("activo", Number(b.dataset.dias) === dias));
  }

  document.querySelectorAll("[data-dias]").forEach((b) => (b.onclick = async () => {
    dias = Number(b.dataset.dias); try { localStorage.setItem("marcadorDias", String(dias)); } catch (e) {}
    pintar((await chrome.storage.local.get("marcadorRes")).marcadorRes);
  }));
  $("marcadorBtn").onclick = actualizar;
  chrome.storage.local.get("marcadorRes").then(({ marcadorRes }) => pintar(marcadorRes));
  window.Marcador = { actualizar }; // para pruebas
})();
