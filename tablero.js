// Tablero (Fase 5): pinta lo que arma tablero-core.js. Lee SOLO chrome.storage; nunca las páginas de los robots.
// Lo único que escribe: aprobar/rechazar/cancelar tareas, y solo con un clic del jefe.
const { h, llenar, etiqueta, numero, vacio } = VISTA;
const $ = (id) => document.getElementById(id);
const hace = (ms) => (ms == null ? "—" : ms < 60e3 ? "ahora" : ms < 3600e3 ? `hace ${Math.round(ms / 60e3)} min` : ms < 864e5 ? `hace ${Math.round(ms / 3600e3)} h` : `hace ${Math.round(ms / 864e5)} d`);
const miles = (n) => Number(n || 0).toLocaleString("es-MX");
const CLASE = { trabajando: "ok", feliz: "ok", idle: "gris", pensando: "ok", pausa: "aviso", ayuda: "aviso", "sin señal": "aviso", error: "falla", apagado: "gris", "sin datos": "gris" };
const TXT = { trabajando: "trabajando", feliz: "terminó", idle: "listo", pensando: "pensando", pausa: "pausa", ayuda: "necesita ayuda", "sin señal": "sin señal", error: "error", apagado: "apagado", "sin datos": "sin datos" };
const ESTADO_T = { aprobacion: ["aviso", "espera OK"], pendiente: ["gris", "en fila"], corriendo: ["ok", "corriendo"], hecha: ["ok", "hecha"], fallida: ["falla", "falló"], cancelada: ["gris", "cancelada"], rechazada: ["gris", "rechazada"] };
const medidor = (pct) => h("div", { class: "medidor" + (pct >= 80 ? " alto" : "") }, h("div", { style: `width:${Math.min(100, pct)}%` }));
const fila = (...celdas) => h("tr", {}, ...celdas.map((c) => (c instanceof Node && c.tagName === "TD" ? c : h("td", {}, c))));
const num = (v) => h("td", { class: "num", text: String(v) });

async function pintar() {
  const st = await chrome.storage.local.get(null);
  const t = TABLERO.construir(st, REGISTRO);
  // Semáforo y números
  $("luz").className = "luz " + t.semaforo;
  $("titulo").textContent = { verde: "Todo en orden", amarillo: "Hay cosas que revisar", rojo: "Hay problemas" }[t.semaforo];
  $("sub").textContent = `Actualizado ${new Date(t.generado).toLocaleTimeString("es-MX")} · se refresca solo`;
  const r = t.robots, vivas = t.tareas.lista.filter((x) => x.viva).length;
  llenar("nums", numero(r.filter((x) => ["trabajando", "pensando"].includes(x.estado)).length, "agentes trabajando"), numero(r.filter((x) => ["error", "ayuda", "sin señal"].includes(x.estado)).length, "con problema"),
    numero(r.filter((x) => x.estado === "apagado").length, "apagados"), numero(vivas, "tareas vivas"), numero(t.seguridad.aprobacionesPendientes, "esperan tu OK"),
    numero(t.errores.ultimas24h, "errores 24 h"), numero(t.leads.smsHoy, "SMS hoy"), numero(t.costos.total.dolares != null ? "$" + t.costos.total.dolares : miles(t.costos.total.llamadas), t.costos.total.dolares != null ? "Claude hoy" : "llamadas a Claude"));
  // Aprobaciones (botones del jefe)
  const aprob = t.tareas.lista.filter((x) => x.estado === "aprobacion");
  $("secAprob").hidden = !aprob.length;
  llenar("aprob", aprob.map((x) => {
    const acc = REGISTRO.accion(x.robot, x.accion) || {};
    return h("li", { class: "apr" }, h("div", { class: "q" }, h("b", { text: `${x.nombre}: ${acc.desc || x.accion}` }), h("small", { text: `pedida por ${x.origen || "?"} · ${hace(x.hace)}` })),
      h("button", { class: "primary", text: "Aprobar", onclick: async (e) => { e.target.disabled = true; if (await preguntar(`¿Aprobar que ${x.nombre} haga: ${acc.desc || x.accion}?`, "Aprobar", "Cancelar")) await Tareas.aprobar(x.id).catch((er) => alert(er.message)); pintarPronto(); } }),
      h("button", { text: "Rechazar", onclick: async () => { await Tareas.rechazar(x.id).catch(() => {}); pintarPronto(); } }));
  }));
  // Misión
  $("secMision").hidden = !t.mision;
  if (t.mision) { const m = t.mision, pct = Math.round((100 * m.listos) / Math.max(1, m.meta));
    llenar("mision", h("div", { class: "row" }, h("b", { text: `${m.meta} leads de ${m.zona}` }), etiqueta(m.estado === "corriendo" ? "ok" : "aviso", m.estado === "esperando_ok" ? "esperando tu OK" : m.estado), h("span", { class: "hint", text: `${m.listos} listos · fase ${m.fase || "—"} · ${hace(m.desde)}` })), medidor(pct)); }
  // Supervisores
  llenar("sups", t.supervisores.map((s) => h("div", { class: "card sup" }, h("h4", { text: s.id }), h("div", { class: "hint", text: s.rol }),
    h("div", { text: `${s.robots} agentes · ${s.trabajando} trabajando · ${s.conProblema} con problema${s.apagados ? ` · ${s.apagados} apagados` : ""}` }),
    h("div", { class: "hint", text: `${s.tareasVivas} tareas vivas · ${s.errores24} errores 24 h · Claude ${s.presupuesto}% del tope (${s.llamadas} llamadas)` }), medidor(s.presupuesto))));
  // Robots
  const orden = { error: 0, ayuda: 1, "sin señal": 2, trabajando: 3, pensando: 3, pausa: 4, feliz: 5, idle: 6, "sin datos": 7, apagado: 8 };
  llenar("robots", h("tr", {}, ...["Agente", "Sup.", "Estado", "Último mensaje", "Errores 24 h", "Tareas ✓/✗", "Éxito", "Duración"].map((x, i) => h("th", { class: i >= 4 ? "num" : "", text: x }))),
    [...r].sort((a, b) => (orden[a.estado] ?? 9) - (orden[b.estado] ?? 9) || a.nombre.localeCompare(b.nombre)).map((x) => fila(h("b", { text: x.nombre }), x.supervisor, etiqueta(CLASE[x.estado] || "gris", TXT[x.estado] || x.estado),
      h("span", { class: "hint", text: `${x.texto.slice(0, 90)}${x.hace != null ? ` · ${hace(x.hace)}` : ""}` }), num(x.errores24), num(`${x.tareasHechas}/${x.tareasFallidas}`), num(x.exito == null ? "—" : x.exito + "%"), num(x.duracionSeg == null ? "—" : x.duracionSeg + " s"))));
  // Tareas
  $("tareasRes").textContent = Object.entries(t.tareas.porEstado).map(([k, n]) => `${(ESTADO_T[k] || [, k])[1]} ${n}`).join(" · ");
  llenar("tareas", t.tareas.lista.length ? t.tareas.lista.slice(0, 25).map((x) => { const [cl, tx] = ESTADO_T[x.estado] || ["gris", x.estado];
    return h("li", {}, etiqueta(cl, tx), h("div", { class: "q" }, h("b", { text: `${x.nombre} · ${x.accion}` }), h("small", { text: [x.resultado || x.error, `pedida por ${x.origen || "?"}`, hace(x.hace)].filter(Boolean).join(" · ") })),
      x.viva && x.estado !== "aprobacion" ? h("button", { class: "mini", text: "Cancelar", onclick: async () => { await Tareas.cancelar(x.id, "jefe").catch(() => {}); pintarPronto(); } }) : null); }) : [vacio("Todavía no hay tareas en el bus.")]);
  // Leads
  const L = t.leads;
  llenar("leads", numero(miles(L.domicilios), "domicilios"), numero(L.enLotes, "en lotes"), numero(L.listosParaSubir, "listos p/ Lofty"), numero(miles(L.subidosTotal), "subidos (total)"),
    numero(L.smsHoy, "SMS hoy"), numero(L.smsBloqueadosHoy, "SMS bloqueados hoy"), numero(L.porAtender, "respuestas por atender"), numero(L.interesados, "interesados"), numero(L.zbRepetidos, "repetidos zBuyer"),
    numero(L.vali ? L.vali.malos : "—", "no sirven (Vali)"), numero(L.punti ? L.punti.altos : "—", "prioridad alta (Punti)"));
  // Costos
  $("costoNota").textContent = t.costos.conPrecios ? "dólares con tus precios (llmPrecios)" : "en tokens; para ver dólares guarda tus precios en llmPrecios (ver docs/FASE-5.md)";
  llenar("costos", h("tr", {}, ...["Quién", "Llamadas", "Tokens entrada", "Tokens salida", "Uso del tope", t.costos.conPrecios ? "US$" : ""].map((x, i) => h("th", { class: i ? "num" : "", text: x }))),
    t.costos.porQuien.filter((c) => c.llamadas || ["capi", "GEO", "CRM", "GROW", "OPS"].includes(c.quien)).map((c) => fila(h("b", { text: c.quien }), num(c.llamadas), num(miles(c.entrada)), num(miles(c.salida)), h("td", {}, medidor(c.porciento), h("small", { text: c.porciento + "%" })), num(c.dolares == null ? "" : "$" + c.dolares))));
  // Errores
  llenar("errores", t.errores.recientes.length ? [...t.errores.recientes.map((e) => h("li", {}, etiqueta("falla", e.nombre), h("div", { class: "q" }, e.texto, h("small", { text: hace(e.hace) })))),
    t.errores.bitacoraLimite ? h("li", { class: "empty", text: "La bitácora guarda solo los últimos 150 eventos: puede haber más errores." }) : null] : [vacio("Sin errores en las últimas 24 h. ✓")]);
  // Seguridad
  const S = t.seguridad, si = (v) => (v ? "sí" : "no");
  const filasS = [
    ["Cumpli (cumplimiento)", S.cumpli ? `${S.cumpli.altas} graves · ${S.cumpli.medias} medios` : "sin auditar todavía", S.cumpli && S.cumpli.altas ? "falla" : S.cumpli && S.cumpli.medias ? "aviso" : "ok"],
    ["Qai (salud técnica)", S.qai ? `${S.qai.fallas} fallas · ${S.qai.avisos} avisos` : "sin revisar todavía", S.qai && S.qai.fallas ? "falla" : S.qai && S.qai.avisos ? "aviso" : "ok"],
    ["Política de SMS", `${S.politicaSms.desde}:00–${S.politicaSms.hasta}:00 California · ${S.politicaSms.tope > 0 ? `tope ${S.politicaSms.tope}/día` : "sin tope diario"} · ${S.bajasPermanentes} bajas permanentes`, "ok"],
    ["Subida automática a Lofty", si(S.subidaAutomatica), S.subidaAutomatica ? "aviso" : "ok"],
    ["Marki borra números fuera de CA", si(S.markiBorraNumeros), S.markiBorraNumeros ? "aviso" : "ok"],
    ["Esperan tu aprobación", String(S.aprobacionesPendientes), S.aprobacionesPendientes ? "aviso" : "ok"],
    ["Pueden escribir en Lofty", S.escribenCrm.join(", "), "gris"], ["Pueden mandar SMS (con tu OK)", S.mandanSms.join(", "), "gris"],
    ["Gastan créditos", S.gastan.join(", "), "gris"], ["Publican fuera (Teams)", S.publican.join(", ") || "—", "gris"],
  ];
  pintarEtapas(st);
  llenar("seguridad", filasS.map(([k, v, c]) => h("tr", {}, h("th", { text: k }), h("td", { text: v }), h("td", {}, etiqueta(c, c === "ok" ? "bien" : c === "gris" ? "info" : c)))));
}
// ---- Fase 6: lanzamiento gradual. Solo el jefe, con clic y confirmación, cambia de etapa. ----
function pintarEtapas(st) {
  const l = TABLERO.lanzamiento(st, REGISTRO);
  $("etapaActual").textContent = l.actual ? `hoy estás en la etapa ${l.actual} (${TABLERO.ETAPAS[l.actual - 1].nombre})` : "todos los agentes están apagados";
  llenar("etapas", l.etapas.map((e) => h("div", { class: "card sup" }, h("h4", {}, `${e.n}. ${e.nombre} `, e.n === l.actual ? etiqueta("ok", "actual") : null), h("div", { class: "hint", text: e.desc }),
    h("small", { text: e.robots.map((r) => `${r.prendido ? "●" : "○"} ${r.nombre}`).join("  ") }),
    h("div", { class: "row", style: "margin-top:6px" }, h("button", { class: "mini", text: e.n === l.actual ? "Volver a aplicar" : `Pasar a etapa ${e.n}`, onclick: () => cambiarEtapa(e.n) })))));
}
async function cambiarEtapa(n) {
  const st = await chrome.storage.local.get(null), plan = TABLERO.planEtapa(st, REGISTRO, n);
  if (!plan.prender.length && !plan.apagar.length) { $("sub").textContent = `Ya estás en la etapa ${n}: no hay nada que cambiar.`; return; }
  const txt = `Etapa ${n}: ${TABLERO.ETAPAS[n - 1].nombre}.\n\n` + (plan.prender.length ? `Se PRENDEN: ${plan.prender.map((r) => r.nombre).join(", ")}.\n` : "") + (plan.apagar.length ? `Se APAGAN: ${plan.apagar.map((r) => r.nombre).join(", ")}.\n` : "") + "\nCapi siempre queda prendido.";
  if (!(await preguntar(txt, `Sí, etapa ${n}`, "Cancelar"))) return;
  const { robotsApagados = {} } = await chrome.storage.local.get("robotsApagados");
  for (const r of plan.prender) delete robotsApagados[r.id];
  for (const r of plan.apagar) robotsApagados[r.id] = true;
  await chrome.storage.local.set({ robotsApagados, lanzamientoEtapa: { n, t: Date.now() } });
  window.svLog && svLog(`Tablero: el jefe pasó el lanzamiento a la etapa ${n} (${TABLERO.ETAPAS[n - 1].nombre}).`);
  pintarPronto();
}

let timer = null;
const pintarPronto = () => { clearTimeout(timer); timer = setTimeout(() => pintar().catch((e) => { $("sub").textContent = "No pude actualizar: " + e.message; }), 800); };
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local") pintarPronto(); });
$("act").onclick = pintarPronto;
setInterval(pintarPronto, 30e3); // "sin señal" y "hace X min" cambian aunque no cambie storage
pintar().catch((e) => { $("sub").textContent = "No pude cargar el tablero: " + e.message; });
