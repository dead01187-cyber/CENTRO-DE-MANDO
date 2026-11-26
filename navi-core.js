// =====================================================================
// Navi (Fase 7) — lógica pura, sin Chrome ni red, para poder probarla.
// Navi le pide al puente local (puente/puente.py, http://127.0.0.1:8765) que corra recetas
// fijas de Browser Use. Aquí: validar lo que escribe el jefe antes de mandarlo, traducir las
// respuestas del puente a mensajes claros y a los estados del robot (Trabajando, ¡Terminé!,
// Error, Necesito ayuda).
// El puente vuelve a validar todo: esto es solo para avisar antes y bonito.
// =====================================================================
(function (g) {
  const PUENTE = "http://127.0.0.1:8765";
  const MSG = {
    apagado: "El puente está apagado. Corre puente/instalar.sh",
    sinClave: "Falta la clave del puente: pégala arriba (la muestra puente/instalar.sh; también está en ~/.navi/token).",
    claveMala: "La clave del puente no coincide. Revisa ~/.navi/token y pégala otra vez.",
    origen: "El puente no reconoce esta extensión. Corre otra vez puente/instalar.sh con el ID que sale abajo.",
    brave: "Abre Brave con brave-ia",
    sinBU: "El puente no encuentra browser-use. Instálalo con: uv tool install browser-use y corre otra vez puente/instalar.sh",
  };
  const VIVOS = ["en_cola", "trabajando"];

  // ¿Qué pasó al hablar con el puente? (error de red, código HTTP, respuesta de /salud)
  function diagnostico({ error, status, salud } = {}) {
    if (error) return { ok: false, estado: "error", texto: MSG.apagado, clave: "apagado" };
    if (status === 401) return { ok: false, estado: "error", texto: MSG.claveMala, clave: "claveMala" };
    if (status === 403) return { ok: false, estado: "error", texto: MSG.origen, clave: "origen" };
    if (status && status >= 400) return { ok: false, estado: "error", texto: `El puente contestó ${status}.`, clave: "http" };
    if (salud && !salud.brave) return { ok: false, estado: "ayuda", texto: MSG.brave, clave: "brave" };
    if (salud && salud.browser_use === false) return { ok: false, estado: "error", texto: MSG.sinBU, clave: "sinBU" };
    return { ok: true, estado: "idle", texto: salud ? `Puente listo · ${salud.navegador || "Brave"} en el 9222.` : "Puente listo.", clave: "ok" };
  }

  // Validación previa de los params con la definición que manda GET /recetas
  function validar(receta, params = {}) {
    if (!receta || !receta.params) return { ok: false, error: "Escoge una receta de la lista." };
    const out = {};
    for (const [n, d] of Object.entries(receta.params)) {
      const v = params[n];
      if (v === undefined || v === null || v === "") {
        if (d.requerido) return { ok: false, error: `Falta: ${d.etiqueta || n}.` };
        continue;
      }
      if (d.tipo === "bool") out[n] = v === true || v === "true" || v === "on";
      else if (d.tipo === "int") {
        const x = Number(v);
        if (!Number.isInteger(x) || (d.min != null && x < d.min) || (d.max != null && x > d.max)) return { ok: false, error: `${d.etiqueta || n}: un número de ${d.min ?? "?"} a ${d.max ?? "?"}.` };
        out[n] = x;
      } else if (d.tipo === "url") {
        let u;
        try { u = new URL(String(v).trim()); } catch (e) { return { ok: false, error: `${d.etiqueta || n}: no es una dirección.` }; }
        if (u.protocol !== "https:") return { ok: false, error: `${d.etiqueta || n}: debe empezar con https://` };
        if (d.hosts && !d.hosts.includes(u.hostname.toLowerCase())) return { ok: false, error: `${d.etiqueta || n}: solo se aceptan direcciones de ${d.hosts.join(" o ")}.` };
        out[n] = u.href;
      } else out[n] = String(v).trim();
    }
    return { ok: true, params: out };
  }

  // Estado de la tarea del puente → estado del robot + texto para la barra y la bitácora
  function estadoTarea(t) {
    if (!t) return { estado: "idle", texto: "Listo." };
    const r = t.resultado || {};
    switch (t.estado) {
      case "en_cola": return { estado: "trabajando", texto: t.en_fila > 1 ? `En fila (lugar ${t.en_fila})…` : "En fila…" };
      case "trabajando": return { estado: "trabajando", texto: ultimaLinea(t) || `Trabajando en ${t.receta}…` };
      case "terminado": return { estado: "feliz", texto: resumen(t.receta, r) };
      case "ayuda": return { estado: "ayuda", texto: `Necesito tu ayuda: ${t.ayuda || "la página pide verificación (CAPTCHA)"}. Resuélvela en Brave y vuelve a arrancar.` };
      case "cancelado": return { estado: "pausa", texto: "Detenido: cancelaste la tarea." };
      default: return { estado: "error", texto: `No se pudo: ${t.error || "la receta falló"}` };
    }
  }
  const ultimaLinea = (t) => String((t.log || []).slice(-1)[0] || "").replace(/^\d\d:\d\d:\d\d\s+/, "");

  function resumen(receta, r = {}) {
    if (receta === "fotos_listing") return `Listo: bajé ${r.fotos || 0} foto(s)${r.direccion ? ` de ${r.direccion}` : ""}.`;
    if (receta === "listings_agente") return `Listo: ${r.total || 0} listing(s) activos en el CSV${r.con_fotos ? `, ${r.con_fotos} con fotos` : ""}.`;
    return "Listo.";
  }

  // Líneas nuevas del log (el puente manda el log completo cada vez)
  function nuevas(vistas, log = []) { return log.slice(Math.min(vistas, log.length)); }

  // ¿Esta línea del log va a la bitácora del Mando? Solo lo importante (abrir página, guardar, avisos),
  // no cada foto; y nunca los "No pude bajar…" sueltos, que pondrían al robot en Error sin serlo.
  function paraBitacora(linea) {
    const t = String(linea || "").replace(/^\d\d:\d\d:\d\d\s+/, "").trim();
    if (!t || /^\s*No pude bajar/.test(t) || /^Foto \d+ de \d+$/.test(t)) return "";
    if (/^(Abriendo|Abrí la galería|Propiedad:|Encontré|Guardé|Bajé|\[\d+\/\d+\]|Aviso:|Conectado a)/.test(t)) return t.slice(0, 280);
    return "";
  }

  g.NAVI_CORE = { PUENTE, MSG, VIVOS, diagnostico, validar, estadoTarea, resumen, nuevas, paraBitacora };
  if (typeof module !== "undefined") module.exports = g.NAVI_CORE;
})(globalThis);
