// =====================================================================
// Política de SMS (Fase 1). La consultan TODOS los robots que mandan SMS
// (Texi, Resi y Marki) justo antes de cada envío. Reglas:
//   1. Bajas permanentes: un número o lead que pidió STOP, dijo "número
//      equivocado", está enojado o Lofty marcó como opt-out / DNC queda
//      bloqueado PARA SIEMPRE (por teléfono y por lead). Un mensaje nuevo
//      del lead NO lo desbloquea. Solo se quita a mano desde Resi.
//   2. Horario: solo de 8:00 a 21:00, hora de California (America/Los_Angeles).
//      v1.92.3: el jefe lo puede APAGAR con el botón "Horario SMS" del Centro de Mando (smsPolitica.sinHorario).
//      Apagado = se manda a cualquier hora (riesgo legal TCPA: el botón pide confirmar y queda en rojo).
//   3. Tope diario: YA NO HAY (v1.73.0). Solo aplica si se pone smsPolitica.tope > 0.
//   4. Solo números de California (lada de CA): así el horario es el correcto.
//   5. Falla cerrada: si cualquier revisión falla, NO se manda.
// Todo SMS mandado (o bloqueado) queda en el registro "smsRegistro".
// Fase B: si el puente está prendido (puente-cliente.js), las bajas y los contactos también se le
// avisan a él (el árbitro de todos los robots), se le pregunta por bajas que la extensión no conozca y
// él reparte el turno del número de SMS. Si está apagado, todo sigue con la copia local.
// =====================================================================
(function (g) {
  const LADAS_CA = new Set("209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951".split(" "));
  const DEF = { desde: 8, hasta: 21, tope: 0 }; // tope 0 = sin tope diario (lo quitó el jefe en v1.73.0)
  const REGISTRO_MAX = 5000;

  const d10 = (t) => { let d = String(t || "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d.length === 10 ? d : ""; };
  const esCA = (t) => { const d = d10(t); return !!d && LADAS_CA.has(d.slice(0, 3)); };
  const diaCA = (ms = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(ms);
  function horaCA(ms = Date.now()) {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(ms);
    const v = (k) => Number((p.find((x) => x.type === k) || {}).value);
    return v("hour") + v("minute") / 60;
  }
  // Candado entre pestañas de la extensión (mismo origen) para que dos robots no se pisen
  const conCandado = (fn) => (typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request("politica-sms", fn) : fn());
  const PC = () => g.PuenteCliente || null;

  async function config() {
    const { smsPolitica = {} } = await chrome.storage.local.get("smsPolitica");
    const c = { ...DEF, ...smsPolitica };
    c.desde = Math.min(21, Math.max(8, Number(c.desde) || DEF.desde)); // nunca antes de 8 ni después de 21
    c.hasta = Math.min(21, Math.max(c.desde, Number(c.hasta) || DEF.hasta));
    c.tope = Math.max(0, Math.floor(Number(c.tope) || 0));
    c.sinHorario = smsPolitica.sinHorario === true; // el jefe apagó el horario (botón del Centro de Mando)
    return c;
  }

  function enHorario(cfg, ms = Date.now()) {
    if (cfg && cfg.sinHorario === true) return true; // horario apagado por el jefe
    const h = horaCA(ms);
    return h >= cfg.desde && h < cfg.hasta;
  }

  // ---------- Bajas permanentes ----------
  // smsBajas = { tels: { "9495551234": { t, motivo, fuente } }, leads: { "cuenta:leadId": { t, motivo, fuente } } }
  const claveLead = (cuenta, leadId) => `${cuenta || "tx"}:${leadId}`;
  async function marcarBaja({ tel, tels, leadId, cuenta, motivo, fuente }) {
    const lista = [].concat(tel || [], tels || []).map(d10).filter(Boolean);
    if (PC()) await PC().marcarBaja({ tels: lista, leadId: leadId == null ? "" : String(leadId), cuenta: cuenta || "tx", motivo: String(motivo || "baja"), fuente: String(fuente || "") });
    return conCandado(async () => {
      const { smsBajas = { tels: {}, leads: {} } } = await chrome.storage.local.get("smsBajas");
      smsBajas.tels = smsBajas.tels || {}; smsBajas.leads = smsBajas.leads || {};
      const reg = { t: Date.now(), motivo: String(motivo || "baja"), fuente: String(fuente || "") };
      let n = 0;
      for (const d of lista) if (!smsBajas.tels[d]) { smsBajas.tels[d] = reg; n++; }
      if (leadId != null && leadId !== "") { const k = claveLead(cuenta, leadId); if (!smsBajas.leads[k]) { smsBajas.leads[k] = reg; n++; } }
      if (n) await chrome.storage.local.set({ smsBajas });
      return n;
    });
  }
  // Quitar una baja: SOLO a mano y con confirmación del jefe (por ejemplo, el lead escribió START).
  async function quitarBaja({ tel, leadId, cuenta }) {
    if (PC()) await PC().quitarBaja({ tel: d10(tel), leadId: leadId == null ? "" : String(leadId), cuenta: cuenta || "tx" });
    return conCandado(async () => {
      const { smsBajas = { tels: {}, leads: {} } } = await chrome.storage.local.get("smsBajas");
      const d = d10(tel); let n = 0;
      if (d && smsBajas.tels && smsBajas.tels[d]) { delete smsBajas.tels[d]; n++; }
      const k = claveLead(cuenta, leadId);
      if (leadId != null && smsBajas.leads && smsBajas.leads[k]) { delete smsBajas.leads[k]; n++; }
      if (n) await chrome.storage.local.set({ smsBajas });
      return n;
    });
  }
  async function bajaDe({ tel, leadId, cuenta }) {
    const { smsBajas = { tels: {}, leads: {} } } = await chrome.storage.local.get("smsBajas");
    const d = d10(tel);
    if (d && smsBajas.tels && smsBajas.tels[d]) return smsBajas.tels[d];
    if (leadId != null && smsBajas.leads && smsBajas.leads[claveLead(cuenta, leadId)]) return smsBajas.leads[claveLead(cuenta, leadId)];
    // Fase B: una baja que marcó otro robot (por ejemplo, uno del puente) y aún no llega a la extensión
    return PC() ? await PC().bajaDe({ tel: d, leadId: leadId == null ? "" : String(leadId), cuenta: cuenta || "tx" }) : null;
  }

  // ---------- Registro de comunicaciones ----------
  async function anotar(ev) {
    try {
      await conCandado(async () => {
        const { smsRegistro = [] } = await chrome.storage.local.get("smsRegistro");
        smsRegistro.push({ t: Date.now(), ...ev });
        await chrome.storage.local.set({ smsRegistro: smsRegistro.slice(-REGISTRO_MAX) });
      });
      // Fase Anna 1: cada SMS que sí salió también queda en el Cerebro (registro de contactos de todos los robots)
      if (ev && ev.estado === "enviado" && ev.leadId != null && ev.leadId !== "") {
        await (typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request("cerebro", (x) => guardarContacto(ev)) : guardarContacto(ev));
      }
    } catch (e) { /* el registro nunca debe tumbar al agente */ }
  }

  async function guardarContacto(ev) {
    const c = { id: PC() ? PC().nuevaId() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, t: Date.now(), leadId: String(ev.leadId), canal: "sms", robot: String(ev.fuente || ""), tel: String(ev.tel || "") };
    const { cerebroContactos = [] } = await chrome.storage.local.get("cerebroContactos");
    cerebroContactos.push(c);
    await chrome.storage.local.set({ cerebroContactos: cerebroContactos.slice(-8000) });
    if (PC()) PC().anotar(c); // Fase B: el árbitro también lo sabe (sin esperar)
  }

  // Fase B: turno del número compartido. minimoMs = lo que el robot ya iba a esperar con su reloj local.
  // Regresa cuánto esperar según el puente (que aparta el lugar entre TODOS los robots) o null si no hay puente.
  async function turnoCompartido(cuenta, minimoMs = 0) {
    try { return PC() ? await PC().turno(cuenta || "tx", minimoMs) : null; } catch (e) { return null; }
  }

  // ---------- La pregunta antes de cada SMS ----------
  // Regresa { ok: true } o { ok: false, motivo }. Si dice ok, ya contó el SMS del día (para el registro y por si algún día se pone tope).
  async function puedeMandar({ tel, leadId, cuenta = "tx", fuente }) {
    try {
      const d = d10(tel);
      if (!d) return { ok: false, motivo: "número inválido" };
      if (!esCA(d)) return { ok: false, motivo: "no es número de California (no se puede asegurar el horario)" };
      const baja = await bajaDe({ tel: d, leadId, cuenta });
      if (baja) return { ok: false, motivo: `baja permanente (${baja.motivo}${baja.fuente ? ", " + baja.fuente : ""})`, baja: true };
      const cfg = await config();
      if (!enHorario(cfg)) return { ok: false, motivo: `fuera de horario: solo de ${cfg.desde}:00 a ${cfg.hasta}:00 hora de California`, horario: true };
      return await conCandado(async () => {
        const { smsConteo = {} } = await chrome.storage.local.get("smsConteo");
        const hoy = diaCA(), n = smsConteo.dia === hoy ? smsConteo.n || 0 : 0;
        if (cfg.tope > 0 && n >= cfg.tope) return { ok: false, motivo: `se llegó al tope de ${cfg.tope} SMS por día`, tope: true };
        await chrome.storage.local.set({ smsConteo: { dia: hoy, n: n + 1 } });
        return { ok: true };
      });
    } catch (e) {
      return { ok: false, motivo: "no pude revisar la política de SMS (" + (e && e.message || e) + "); por seguridad no se manda" };
    }
  }
  // Si el envío falló, se regresa el lugar apartado en el tope
  async function devolverLugar() {
    try {
      await conCandado(async () => {
        const { smsConteo = {} } = await chrome.storage.local.get("smsConteo");
        if (smsConteo.dia === diaCA() && smsConteo.n > 0) await chrome.storage.local.set({ smsConteo: { dia: smsConteo.dia, n: smsConteo.n - 1 } });
      });
    } catch (e) {}
  }

  // Palabras de baja (inglés y español) para quien quiera revisarlas
  const RE_BAJA = /\b(stop|stop ?all|unsubscribe|remove me|take me off|opt[ -]?out|revoke|do ?n[o']?t (text|contact|message)|no (more )?(texts|messages)|no me (escrib\w*|mand\w*|contact\w*)|d[eé]jame de (escribir|mandar)|b[oó]rrame|baja|darme de baja|cancelar suscripci[oó]n)\b|^\s*(stop|quit|end|cancel|alto|para|pare|cancelar|basta)\s*[.!]*\s*$/i;

  g.SMS = { d10, esCA, diaCA, horaCA, enHorario, config, marcarBaja, quitarBaja, bajaDe, anotar, puedeMandar, devolverLugar, turnoCompartido, RE_BAJA, DEF };
  if (typeof module !== "undefined") module.exports = g.SMS;
})(globalThis);
