// =====================================================================
// Puente (Fase A) — lógica pura de la pantalla de los servicios del puente (sin Chrome ni red).
// Los servicios corren en tu Mac (puente/servicios) aunque Brave esté cerrado; esta pantalla los
// muestra igual que a los robots y deja mandar las llaves de Lofty al Llavero de macOS.
// =====================================================================
(function (g) {
  const PESO = { error: 5, ayuda: 4, trabajando: 3, feliz: 2, idle: 1, apagado: 0 };
  const CHIP = { idle: "Listo", trabajando: "Trabajando", feliz: "OK", error: "Error", ayuda: "Necesito ayuda", apagado: "Apagado" };
  // Las llaves que la extensión puede copiar al puente (mismo nombre en chrome.storage y en el Llavero)
  const LLAVES = { loftyKey: "Lofty principal (Lofti, Anna)", txKey: "Lofty de Texi / Resi / Rayo", t2Key: "Lofty de Texi 2" };

  // Estado del robot "Puente" = el peor de sus servicios prendidos
  function resumen(servicios = []) {
    const prendidos = servicios.filter((s) => s.activo !== false && s.estado !== "apagado");
    if (!servicios.length) return { estado: "idle", texto: "El puente no tiene servicios.", cuenta: "sin servicios" };
    if (!prendidos.length) return { estado: "pausa", texto: "Todos los servicios están apagados.", cuenta: `${servicios.length} apagados` };
    const peor = prendidos.reduce((a, b) => ((PESO[b.estado] || 0) > (PESO[a.estado] || 0) ? b : a));
    const n = (e) => prendidos.filter((s) => s.estado === e).length;
    const malos = n("error") + n("ayuda");
    const cuenta = malos ? `${malos} con problema de ${prendidos.length}` : `${prendidos.length} servicio(s) bien`;
    const estado = peor.estado === "feliz" ? "feliz" : peor.estado === "idle" ? "idle" : peor.estado;
    const texto = malos ? `${peor.titulo}: ${peor.texto}` : `${prendidos.length} servicio(s) trabajando en tu Mac. ${prendidos.map((s) => s.texto).join(" ")}`.slice(0, 240);
    return { estado, texto, cuenta };
  }

  // Qué servicios cambiaron de estado (para la bitácora del Mando). Solo lo que importa:
  // pasar a error/ayuda, o recuperarse de un error.
  function cambios(antes = {}, ahora = []) {
    const out = [];
    for (const s of ahora) {
      const a = antes[s.nombre];
      if (!a || a.estado === s.estado) continue;
      if (s.estado === "error" || s.estado === "ayuda") out.push({ nombre: s.nombre, nivel: "error", texto: `Puente · ${s.titulo}: ${s.texto}` });
      else if ((a.estado === "error" || a.estado === "ayuda") && s.estado !== "apagado") out.push({ nombre: s.nombre, nivel: "info", texto: `Puente · ${s.titulo}: se recuperó. ${s.texto}` });
    }
    return out;
  }
  const mapa = (servicios = []) => Object.fromEntries(servicios.map((s) => [s.nombre, { estado: s.estado }]));

  // ¿Qué llaves tiene la extensión que el puente todavía no tiene (o tiene distinta)?
  function llavesPorMandar(storage = {}, enPuente = {}) {
    return Object.keys(LLAVES).map((k) => {
      const v = String(storage[k] || "").trim();
      const p = enPuente[k] || {};
      const pista = v.length >= 12 ? "…" + v.slice(-4) : "";
      return { nombre: k, descripcion: LLAVES[k], enExtension: !!v, enPuente: !!p.puesta, igual: !!v && !!p.puesta && p.pista === pista, pistaPuente: p.pista || "" };
    });
  }

  g.SP_CORE = { PESO, CHIP, LLAVES, resumen, cambios, mapa, llavesPorMandar };
  if (typeof module !== "undefined") module.exports = g.SP_CORE;
})(globalThis);
