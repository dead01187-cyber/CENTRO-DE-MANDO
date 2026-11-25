// =====================================================================
// Cerebro (Fase Anna 1) — registro compartido de contactos + consulta antes de actuar.
// Lo usan todos los robots que contactan leads (Marki, Texi, Compri, Texi 2, Resi, Resi 2, Rayo).
//
//   await Cerebro.puedo({ leadId, canal: "sms"|"llamada"|"email", robot, llave, respetaAnna, esRespuesta })
//       → { ok, motivo, codigo }   (falla cerrada: si no puede revisar Lofty, NO deja contactar)
//   await Cerebro.anotar({ leadId, canal, robot, tel })       (los SMS de la política se anotan solos)
//   await Cerebro.anna(leadId)          → { enPool, silenciado }
//   await Cerebro.silenciarAnna(leadId, motivo) → true/false (verifica en Lofty)
//   await Cerebro.poolAnna(forzar)      → [{ leadId, firstName, lastName, phone, ... }]
//
// Datos en chrome.storage.local:
//   cerebroContactos  [{ t, leadId, canal, robot, tel }]  (últimos 8000)
//   annaPool          { t, leads: [...] }   (se refresca cada 10 min)
//   annaMute          { leadId: { muted, t } }  (estado de silencio, se refresca cada hora)
//   annaSilenciados   { leadId: { t, robot, motivo } }  (los que silenciamos nosotros)
// Anna se consulta con la llave principal (loftyKey); si no hay, con la de Texi (txKey).
// =====================================================================
(function (g) {
  const C = g.CEREBRO_CORE;
  const MAX = 8000, POOL_TTL = 10 * 60e3, MUTE_TTL = 60 * 60e3, TEXTOS_TTL = 45e3;
  const conCandado = (n, fn) => (typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request(n, fn) : fn());
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  async function api(path, { llave = "loftyKey", clave = "", method = "GET", body } = {}) {
    const st = await chrome.storage.local.get([llave, "loftyKey", "txKey"]);
    const key = clave || st[llave] || (llave === "annaKey" ? st.loftyKey || st.txKey : ""); // clave = la llave directa (Marki la guarda dentro de alCfg)
    if (!key) throw Object.assign(new Error(`falta la API key (${llave === "annaKey" ? "Lofty" : llave})`), { sinKey: true });
    let r;
    for (let i = 0; ; i++) {
      r = await fetch("https://api.lofty.com" + path, { method, headers: { Authorization: "token " + key, "X-Error-Status": "true", ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (r.status !== 429 || i >= 3) break;
      const reset = parseInt(r.headers.get("X-RateLimit-Reset") || "", 10);
      await espera(reset > 0 ? reset + 200 : 2000 * 2 ** i);
    }
    const txt = await r.text(); let d = {}; try { d = txt ? JSON.parse(txt) : {}; } catch (e) { d = {}; }
    if (!r.ok) throw Object.assign(new Error(`Lofty respondió ${r.status}${d.message ? ": " + String(d.message).slice(0, 120) : ""}`), { status: r.status });
    return d;
  }

  // ---------- Registro de contactos ----------
  async function anotar({ leadId, canal = "sms", robot = "", tel = "" }) {
    if (leadId == null || leadId === "") return;
    await conCandado("cerebro", async () => {
      const { cerebroContactos = [] } = await chrome.storage.local.get("cerebroContactos");
      cerebroContactos.push({ t: Date.now(), leadId: String(leadId), canal, robot: String(robot || ""), tel: String(tel || "") });
      await chrome.storage.local.set({ cerebroContactos: cerebroContactos.slice(-MAX) });
    });
  }
  const contactos = async () => (await chrome.storage.local.get("cerebroContactos")).cerebroContactos || [];

  // ---------- Historial de SMS del lead en Lofty (con caché corta) ----------
  const cacheTextos = new Map();
  async function textos(leadId, llave, clave = "") {
    const k = `${clave ? "directa" : llave}:${leadId}`, c = cacheTextos.get(k);
    if (c && Date.now() - c.t < TEXTOS_TTL) return c.v;
    const d = await api(`/v1.0/communication/text?leadId=${encodeURIComponent(leadId)}&limit=40`, { llave, clave });
    const filas = d.texts || d.data || d.list || (Array.isArray(d) ? d : []);
    const v = filas.map(C.deLofty).filter((x) => x.t);
    cacheTextos.set(k, { t: Date.now(), v });
    return v;
  }

  // ---------- Anna (AI Sales Agent de Lofty) ----------
  async function poolAnna(forzar = false) {
    const { annaPool } = await chrome.storage.local.get("annaPool");
    if (!forzar && annaPool && Date.now() - annaPool.t < POOL_TTL) return annaPool.leads;
    return conCandado("cerebro-anna", async () => {
      const leads = [];
      for (let offset = 0; offset < 5000; offset += 100) {
        const d = await api(`/v2.0/working-leads?limit=100&offset=${offset}`, { llave: "annaKey" });
        const fil = d.workingLeads || d.leads || d.data || [];
        leads.push(...fil.map((x) => ({ leadId: String(x.leadId), firstName: x.firstName || "", lastName: x.lastName || "", phone: String(x.phone || ""), email: x.email || "", createdAt: x.createdAt || "" })));
        const total = (d.metadata && d.metadata.total) || (d._metadata && d._metadata.total) || 0;
        if (fil.length < 100 || (total && leads.length >= total)) break;
        await espera(300);
      }
      await chrome.storage.local.set({ annaPool: { t: Date.now(), leads } });
      return leads;
    });
  }
  async function muteado(leadId, forzar = false) {
    const { annaMute = {} } = await chrome.storage.local.get("annaMute");
    const m = annaMute[leadId];
    if (!forzar && m && Date.now() - m.t < MUTE_TTL) return !!m.muted;
    const d = await api(`/v2.0/sales-agent/lead/mute-status?leadId=${encodeURIComponent(leadId)}`, { llave: "annaKey" });
    const muted = !!(d.muted ?? (d.data && d.data.muted));
    await conCandado("cerebro-anna", async () => {
      const { annaMute: am = {} } = await chrome.storage.local.get("annaMute");
      am[leadId] = { muted, t: Date.now() };
      const ks = Object.keys(am); if (ks.length > 5000) ks.sort((a, b) => am[a].t - am[b].t).slice(0, ks.length - 5000).forEach((x) => delete am[x]);
      await chrome.storage.local.set({ annaMute: am });
    });
    return muted;
  }
  async function anna(leadId) {
    const pool = await poolAnna();
    const enPool = pool.some((x) => x.leadId === String(leadId));
    return { enPool, silenciado: enPool ? await muteado(String(leadId)) : false };
  }
  async function silenciarAnna(leadId, motivo = "", robot = "") {
    await api(`/v2.0/sales-agents/working-lead/${encodeURIComponent(leadId)}/mute`, { llave: "annaKey", method: "PUT" });
    const ok = await muteado(String(leadId), true); // verificar en Lofty
    if (ok) await conCandado("cerebro-anna", async () => {
      const { annaSilenciados = {} } = await chrome.storage.local.get("annaSilenciados");
      annaSilenciados[leadId] = { t: Date.now(), robot, motivo: String(motivo).slice(0, 120) };
      await chrome.storage.local.set({ annaSilenciados });
    });
    return ok;
  }

  // ---------- La pregunta antes de contactar ----------
  async function puedo({ leadId, canal = "sms", robot = "", llave = "txKey", clave = "", respetaAnna = true, esRespuesta = false }) {
    try {
      const [cs, tx, an] = await Promise.all([contactos(), textos(leadId, llave, clave), respetaAnna ? anna(leadId) : Promise.resolve({})]);
      const r = C.revisar({ leadId, canal, contactos: cs, textos: tx, anna: an, respetaAnna, esRespuesta });
      return { ...r, textos: tx };
    } catch (e) {
      return { ok: false, codigo: "error", motivo: "no pude revisar en Lofty si ya lo contactaron (" + (e.message || e) + "); por seguridad no lo toco", sinKey: !!e.sinKey, status: e.status };
    }
  }

  g.Cerebro = { puedo, anotar, contactos, textos, anna, poolAnna, muteado, silenciarAnna, api };
})(globalThis);
