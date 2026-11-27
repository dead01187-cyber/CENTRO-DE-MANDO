// =====================================================================
// Cliente del puente para el Cerebro y la política de SMS (Fase B).
// El puente (puente/arbitro.py) es el ÁRBITRO: una sola verdad de contactos, bajas y turno del número
// para los robots de la extensión y los que vivan en el puente.
//
// · Si el puente contesta: además de las reglas locales, se le pregunta a él (manda lo más estricto),
//   se le avisa de cada contacto y baja, y él reparte el turno del número de SMS.
// · Si el puente está apagado o no hay clave: los robots siguen con su copia local (decisión del jefe) y
//   se avisa en la bitácora como mucho cada 10 min. Cuando vuelve, se le sube todo lo local (importar).
// · Nunca se espera más de 2.5 s al puente: un SMS no se atora por él.
//
//   PuenteCliente.revisar({...})         → { ok, codigo, motivo } o null (sin puente)
//   PuenteCliente.anotar(contacto)       (best effort)
//   PuenteCliente.marcarBaja / quitarBaja / bajaDe
//   PuenteCliente.turno(cuenta, minimoMs) → ms a esperar o null
//   PuenteCliente.sincronizar()          (cada 30 s como mucho)
// =====================================================================
(function (g) {
  const URL = "http://127.0.0.1:8765";
  const TIMEOUT = 2500, REINTENTO = 20e3, AVISO_CADA = 10 * 60e3, SYNC_CADA = 30e3, MAX = 8000;
  let caido = 0; // cuándo falló por última vez (para no esperar 2.5 s en cada SMS mientras está apagado)
  const hayChrome = () => typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  const candado = (n, fn) => (typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request(n, fn) : fn());
  const claveContacto = (c) => c.id || `${c.leadId}|${c.canal}|${Math.trunc(Number(c.t) || 0)}`;
  const nuevaId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  async function token() {
    if (!hayChrome()) return "";
    const { nvToken = "" } = await chrome.storage.local.get("nvToken");
    return nvToken;
  }

  async function avisarCaido(motivo) {
    caido = Date.now();
    try {
      const { puenteAvisoT = 0 } = await chrome.storage.local.get("puenteAvisoT");
      await chrome.storage.local.set({ puenteSucio: true });
      if (Date.now() - puenteAvisoT > AVISO_CADA) {
        await chrome.storage.local.set({ puenteAvisoT: Date.now() });
        g.svLog && g.svLog(`Puente apagado (${motivo}): el Cerebro y la política de SMS siguen con su copia local en la extensión. Corre puente/instalar.sh.`, "error");
      }
    } catch (e) {}
  }

  // null = el puente no está (o no hay clave): el que llama sigue con lo local
  async function pedir(ruta, { method = "GET", body } = {}) {
    const tk = await token();
    if (!tk) return null; // el jefe no ha puesto el puente: modo solo-extensión, sin avisos
    if (caido && Date.now() - caido < REINTENTO) return null;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const reloj = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT) : null;
    try {
      const r = await fetch(URL + ruta, { method, cache: "no-store", signal: ctrl && ctrl.signal,
        headers: { "X-Navi-Token": tk, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 401 || r.status === 403) { await avisarCaido(r.status === 401 ? "la clave no coincide" : "no reconoce la extensión"); return null; }
      const j = await r.json().catch(() => null);
      if (!r.ok) { g.svLog && g.svLog(`Puente: ${ruta} respondió ${r.status}${j && j.error ? ": " + j.error : ""}`, "error"); return null; }
      caido = 0;
      return j;
    } catch (e) {
      await avisarCaido("no contesta");
      return null;
    } finally { if (reloj) clearTimeout(reloj); }
  }

  // ---------- Sincronizar: subir lo local si el puente es nuevo o estuvo caído; bajar lo que anotó el puente ----------
  async function sincronizar(forzar = false) {
    if (!hayChrome() || !(await token())) return false;
    return candado("puente-sync", async () => {
      const st = await chrome.storage.local.get(["puenteSyncT", "puenteInstancia", "puenteSucio", "puenteContactosDesde"]);
      if (!forzar && st.puenteSyncT && Date.now() - st.puenteSyncT < SYNC_CADA) return true;
      const res = await pedir("/cerebro/resumen");
      if (!res) return false;
      if (res.instancia !== st.puenteInstancia || st.puenteSucio) {
        const loc = await chrome.storage.local.get(["cerebroContactos", "smsBajas", "smsUltimoTx", "smsUltimo_t2", "smsUltimo_lofty"]);
        const turnos = {}; if (loc.smsUltimoTx) turnos.tx = loc.smsUltimoTx; if (loc.smsUltimo_t2) turnos.t2 = loc.smsUltimo_t2; if (loc.smsUltimo_lofty) turnos.lofty = loc.smsUltimo_lofty;
        const imp = await pedir("/cerebro/importar", { method: "POST", body: { contactos: (loc.cerebroContactos || []).slice(-MAX), bajas: loc.smsBajas || {}, turnos } });
        if (!imp) return false;
        if (imp.contactos_nuevos || imp.bajas_nuevas) g.svLog && g.svLog(`Puente: le subí lo que tenía la extensión (${imp.contactos_nuevos} contacto(s), ${imp.bajas_nuevas} baja(s)).`);
        await chrome.storage.local.set({ puenteInstancia: res.instancia, puenteSucio: false, puenteContactosDesde: 0 });
        st.puenteContactosDesde = 0;
      }
      // bajar lo que anotó el puente (por ejemplo, otro robot que vive allá)
      const desde = Math.max(0, (st.puenteContactosDesde || 0) - 120e3);
      const c = await pedir(`/cerebro/contactos?desde=${Math.floor(desde)}`);
      if (c) await candado("cerebro", async () => {
        const { cerebroContactos = [] } = await chrome.storage.local.get("cerebroContactos");
        const ya = new Set(cerebroContactos.map(claveContacto));
        const nuevos = (c.contactos || []).filter((x) => !ya.has(claveContacto(x)));
        if (nuevos.length) await chrome.storage.local.set({ cerebroContactos: [...cerebroContactos, ...nuevos].sort((a, b) => a.t - b.t).slice(-MAX) });
      });
      const b = await pedir("/bajas");
      if (b && b.bajas) await candado("politica-sms", async () => {
        const { smsBajas = { tels: {}, leads: {} } } = await chrome.storage.local.get("smsBajas");
        smsBajas.tels = smsBajas.tels || {}; smsBajas.leads = smsBajas.leads || {};
        let n = 0;
        for (const [k, v] of Object.entries(b.bajas.tels || {})) if (!smsBajas.tels[k]) { smsBajas.tels[k] = v; n++; }
        for (const [k, v] of Object.entries(b.bajas.leads || {})) if (!smsBajas.leads[k]) { smsBajas.leads[k] = v; n++; }
        if (n) await chrome.storage.local.set({ smsBajas });
      });
      await chrome.storage.local.set({ puenteSyncT: Date.now(), puenteContactosDesde: Date.now() });
      return true;
    });
  }

  // ---------- Lo que usan el Cerebro y la política ----------
  const revisar = (p) => pedir("/cerebro/revisar", { method: "POST", body: p });
  async function anotar(c) { const r = await pedir("/cerebro/anotar", { method: "POST", body: { contacto: c } }); if (!r && (await token())) { try { await chrome.storage.local.set({ puenteSucio: true }); } catch (e) {} } return !!r; }
  async function marcarBaja(p) { const r = await pedir("/bajas/marcar", { method: "POST", body: p }); if (!r && (await token())) { try { await chrome.storage.local.set({ puenteSucio: true }); } catch (e) {} } return r; }
  const quitarBaja = (p) => pedir("/bajas/quitar", { method: "POST", body: p });
  async function bajaDe(p) { const r = await pedir("/bajas/revisar", { method: "POST", body: p }); return r ? r.baja || null : null; }
  async function turno(cuenta, minimoMs = 0) { const r = await pedir("/turno", { method: "POST", body: { cuenta, minimo_ms: Math.max(0, Math.round(minimoMs)) } }); return r ? Number(r.esperar_ms) || 0 : null; }

  g.PuenteCliente = { URL, pedir, sincronizar, revisar, anotar, marcarBaja, quitarBaja, bajaDe, turno, claveContacto, nuevaId };
  if (typeof module !== "undefined") module.exports = g.PuenteCliente;
})(globalThis);
