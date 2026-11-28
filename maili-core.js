// =====================================================================
// Maili (correos desde Lofty) — reglas puras, sin Chrome ni Lofty, para poder probarlas.
//   · correoDe(lead)            el correo válido del lead (el primero) o "".
//   · sinCorreo(lead)           motivo por el que Lofty NO deja escribirle por correo (o "").
//   · revisarPlantilla(p, cfg)  errores que impiden mandar (asunto/cuerpo vacíos, llaves sueltas como "Sam}",
//                               falta tu dirección postal: la pide la ley CAN-SPAM).
//   · armar(p, lead, cfg)       asunto y cuerpo ya rellenados + pie legal (remitente, dirección y cómo darse de baja).
//   · puede({...})              regla del Cerebro para correos: máximo 1 correo por lead cada N días (7) entre los
//                               robots y las personas; nada si una persona le escribió por correo en las últimas 24 h.
//                               Los correos automáticos de Lofty (emailType "Auto": reportes de mercado, drips) no cuentan.
//   · esBaja(texto)             ¿la respuesta pide ya no recibir correos?
// =====================================================================
(function (g) {
  const DIA = 864e5, EMPAREJE = 5 * 60e3;
  const RE_CORREO = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
  const RE_BAJA = /\b(unsubscribe|remove me|take me off|opt[ -]?out|stop (emailing|sending|contacting)|do ?n[o']?t (email|contact|send)|no more emails?|darme de baja|dar de baja|b[oó]rrame|qu[ií]tame|no me (escrib\w*|mand\w*|env[ií]\w*)|cancelar suscripci[oó]n)\b|^\s*(stop|unsubscribe|baja|remove)\s*[.!]*\s*$/i;
  const CAMPOS = ["nombre", "apellido", "ciudad", "direccion"];
  const tc = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const tiempo = (s) => Date.parse(String(s || "").replace(/GMT$/, "Z")) || 0;

  const correoValido = (e) => RE_CORREO.test(String(e || "").trim());
  function correoDe(l) {
    const lista = [].concat(l.emails || [], l.email || []).map((e) => String(e && typeof e === "object" ? e.email || e.address || e.value || "" : e || "").trim());
    return lista.find(correoValido) || "";
  }
  // Lofty: cannotEmail / unsubscription = no se le puede escribir por correo
  function sinCorreo(l) {
    if (l.cannotEmail === true) return "Lofty dice que no recibe correos (cannotEmail)";
    if (l.unsubscription === true) return "se dio de baja en Lofty (unsubscribe)";
    if (!correoDe(l)) return "no tiene correo válido";
    return "";
  }

  function datosDe(l) {
    const props = l.leadPropertyList || [];
    const p = props.find((x) => /home/i.test(x.label || "") && (x.streetAddress || x.city)) || props.find((x) => x.streetAddress || x.city) || l;
    return { leadId: String(l.leadId || l.id), nombre: tc(l.firstName || "").split(" ")[0] || "there", apellido: tc(l.lastName || ""),
      ciudad: tc(p.city || ""), calle: tc(p.streetAddress || ""), correo: correoDe(l) };
  }
  const rellenar = (txt, x) => String(txt || "").replace(/\{nombre\}/gi, x.nombre || "there").replace(/\{apellido\}/gi, x.apellido || "")
    .replace(/\{ciudad\}/gi, x.ciudad || "your area").replace(/\{direccion\}/gi, x.calle || "your home").trim();

  // Errores que impiden mandar. cfg = { remitente, direccion }
  function revisarPlantilla(p = {}, cfg = {}) {
    const errores = [];
    const asunto = String(p.asunto || "").trim(), texto = String(p.texto || "").trim();
    if (!asunto) errores.push("Falta el asunto.");
    if (!texto) errores.push("El correo está vacío.");
    for (const [nombre, s] of [["asunto", asunto], ["correo", texto]]) {
      const sinCampos = s.replace(new RegExp(`\\{(${CAMPOS.join("|")})\\}`, "gi"), "");
      const raros = sinCampos.match(/\{[^{}\s]*\}?|\}/g);
      if (raros) errores.push(`En el ${nombre} hay llaves que no reconozco (${[...new Set(raros)].slice(0, 3).join(" ")}). Solo se pueden usar ${CAMPOS.map((c) => `{${c}}`).join(", ")}.`);
    }
    if (asunto.length > 150) errores.push("El asunto es muy largo (máximo 150 caracteres).");
    if (!String(cfg.remitente || "").trim()) errores.push("Falta tu nombre y empresa (remitente): va al pie de cada correo.");
    if (String(cfg.direccion || "").trim().length < 10) errores.push("Falta tu dirección postal: la ley CAN-SPAM pide que vaya en cada correo comercial.");
    return errores;
  }

  // Pie legal que Maili agrega SIEMPRE (CAN-SPAM): quién manda, dirección postal y cómo darse de baja
  const pie = (cfg = {}) => `--\n${String(cfg.remitente || "").trim()}\n${String(cfg.direccion || "").trim()}\nIf you'd rather not receive emails from me, just reply "unsubscribe".`;
  const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const aHtml = (texto) => escHtml(texto).replace(/\r?\n/g, "<br>");
  function armar(p, x, cfg) {
    const asunto = rellenar(p.asunto, x).replace(/\s+/g, " ");
    const texto = `${rellenar(p.texto, x)}\n\n${pie(cfg)}`;
    return { asunto, texto, html: aHtml(texto) };
  }

  // Historial de correos de Lofty → formato común
  const deLofty = (e) => ({ t: tiempo(e.emailEventTime || e.emailTime || e.communicationTime || e.createTime), direccion: /^\s*in/i.test(String(e.direction || "")) ? "in" : "out",
    tipo: e.emailType || e.communicationType || "", evento: e.eventType || "", asunto: e.emailSubject || e.subject || "", agentId: e.agentId || null });

  // contactos: registro del Cerebro [{ t, leadId, canal, robot }] · correos: historial de Lofty ya convertido con deLofty
  function puede({ ahora = Date.now(), leadId, contactos = [], correos = [], dias = 7, esRespuesta = false }) {
    const mios = contactos.filter((c) => String(c.leadId) === String(leadId) && c.canal === "email");
    const deRobot = (e) => mios.some((c) => Math.abs(c.t - e.t) <= EMPAREJE);
    const manuales = correos.filter((e) => e.direccion === "out" && String(e.tipo).toLowerCase() !== "auto" && e.t);
    const persona = manuales.find((e) => ahora - e.t < DIA && !deRobot(e));
    if (persona) return { ok: false, codigo: "persona", motivo: `una persona le mandó un correo hace ${Math.round((ahora - persona.t) / 3600e3)} h (“${String(persona.asunto).slice(0, 40)}”); no lo toco en 24 h` };
    const ultimoIn = Math.max(0, ...correos.filter((e) => e.direccion === "in").map((e) => e.t));
    const ultimoOut = Math.max(0, ...mios.map((c) => c.t), ...manuales.map((e) => e.t));
    if (esRespuesta && ultimoIn > ultimoOut) return { ok: true, codigo: "respuesta" };
    if (ultimoOut && ahora - ultimoOut < dias * DIA) {
      const quien = (mios.find((c) => c.t === ultimoOut) || {}).robot || "alguien del equipo";
      return { ok: false, codigo: "reciente", motivo: `ya recibió un correo hace ${Math.max(1, Math.round((ahora - ultimoOut) / DIA))} día(s) (${quien}); máximo 1 cada ${dias} días` };
    }
    return { ok: true, codigo: "ok" };
  }

  const esBaja = (texto) => RE_BAJA.test(String(texto || ""));
  // Pausa entre correos (ritmo humano): 20 a 45 s
  const pausaMs = (azar = Math.random()) => Math.round(20000 + azar * 25000);

  g.MAILI_CORE = { correoValido, correoDe, sinCorreo, datosDe, rellenar, revisarPlantilla, pie, aHtml, armar, deLofty, puede, esBaja, pausaMs, RE_BAJA, CAMPOS };
  if (typeof module !== "undefined") module.exports = g.MAILI_CORE;
})(globalThis);
