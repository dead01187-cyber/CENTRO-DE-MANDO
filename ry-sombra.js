// =====================================================================
// Rayo (Fase C) — comparación de la SOMBRA, lógica pura para poder probarla.
// En modo sombra la extensión trabaja como siempre y el Rayo del puente solo anota lo que HARÍA.
// Aquí se comparan lead por lead: ¿los dos llegaron a la misma decisión?
//   decisión de la extensión: hecho → contactar · ganó Anna · saltado → saltar · descartado · error
//   decisión del puente:      descartado, o lo que "haría" (contactar · ganó Anna · saltar · error)
// Los que siguen pendientes (por aprobar, programado…) todavía no se comparan.
// =====================================================================
(function (g) {
  const DE_EXT = { hecho: "contactar", "ganó Anna": "ganó Anna", saltado: "saltar", descartado: "descartado", error: "error" };
  const decisionExt = (t) => (t && DE_EXT[t.estado]) || "pendiente";
  const decisionPuente = (t) => (!t ? "pendiente" : t.estado === "descartado" ? "descartado" : t.haria || "pendiente");

  function comparar(local = {}, puente = {}) {
    const ids = new Set([...Object.keys(local), ...Object.keys(puente)]);
    const filas = [];
    for (const id of ids) {
      const l = local[id], p = puente[id];
      const de = decisionExt(l), dp = decisionPuente(p);
      const tipo = !l ? "solo puente" : !p ? "solo extensión" : de === "pendiente" || dp === "pendiente" ? "pendiente" : de === dp ? "igual" : "distinto";
      const t = l || p;
      filas.push({ leadId: id, nombre: `${t.nombre === "there" ? "" : t.nombre || ""} ${t.apellido || ""}`.trim() || "(sin nombre)", extension: de, puente: dp, tipo,
        motivoExt: (l && l.motivo) || "", motivoPuente: (p && p.motivo) || "" });
    }
    const n = (x) => filas.filter((f) => f.tipo === x).length;
    const comparables = n("igual") + n("distinto");
    return { filas: filas.sort((a, b) => (a.tipo === "distinto" ? -1 : 0) - (b.tipo === "distinto" ? -1 : 0)), iguales: n("igual"), distintos: n("distinto"),
      pendientes: n("pendiente"), soloExt: n("solo extensión"), soloPuente: n("solo puente"), comparables,
      pct: comparables ? Math.round((n("igual") / comparables) * 100) : null };
  }

  // Lista del puente (arreglo) → mapa por leadId
  const mapa = (lista = []) => Object.fromEntries(lista.map((t) => [String(t.leadId), t]));

  g.RAYO_SOMBRA = { comparar, mapa, decisionExt, decisionPuente };
  if (typeof module !== "undefined") module.exports = g.RAYO_SOMBRA;
})(globalThis);
