// =====================================================================
// Cálculo de Termi, compartido: lo usa Termi (su pantalla) y lo usa Radar
// para pasarle a Termi los resultados en cuanto junta datos, aunque la
// pantalla de Termi no esté abierta.
// =====================================================================
(function () {
  const pct = (x) => (x == null ? "—" : (x * 100).toFixed(x < 0.1 ? 1 : 0) + "%");
  function tasa(z, campo) { const p = z.propwire; return p && p[campo] != null && p.total ? p[campo] / p.total : null; }
  const SENALES = [
    { id: "nod", nombre: "Pre-foreclosure", peso: 25, val: (z) => tasa(z, "preforeclosure"), txt: (z) => `${z.propwire.preforeclosure} en pre-foreclosure` },
    { id: "probate", nombre: "Probate", peso: 20, val: (z) => tasa(z, "preprobate"), txt: (z) => `${z.propwire.preprobate} pre-probates` },
    { id: "absentee", nombre: "Absentee", peso: 10, val: (z) => tasa(z, "absentee"), txt: (z) => `${pct(tasa(z, "absentee"))} absentee` },
    { id: "equity", nombre: "Mucho equity", peso: 10, val: (z) => tasa(z, "highEquity"), txt: (z) => `${pct(tasa(z, "highEquity"))} con mucho equity` },
    { id: "vacant", nombre: "Vacantes", peso: 5, val: (z) => tasa(z, "vacant") ?? (z.census && z.census.vacancia), txt: (z) => `${pct(tasa(z, "vacant") ?? (z.census && z.census.vacancia))} vacantes` },
    { id: "tenure", nombre: "Dueños de muchos años", peso: 10, val: (z) => (z.census && z.census.mudanza ? new Date().getFullYear() - z.census.mudanza : null), txt: (z) => `dueños desde ~${z.census.mudanza}` },
    { id: "bajas", nombre: "Bajas de precio", peso: 10, val: (z) => z.redfin && z.redfin.bajas, txt: (z) => `${z.redfin.bajas}% con baja de precio` },
    { id: "inventario", nombre: "Más casas a la venta", peso: 5, val: (z) => z.realtor && z.realtor.listingsYoY, txt: (z) => `inventario ${z.realtor.listingsYoY > 0 ? "+" : ""}${z.realtor.listingsYoY}% vs. año pasado` },
    { id: "lento", nombre: "Mercado lento", peso: 5, val: (z) => (z.redfin && z.redfin.dom) ?? (z.zillow && z.zillow.diasPending) ?? (z.realtor && z.realtor.dom), txt: (z) => `${(z.redfin && z.redfin.dom) ?? (z.zillow && z.zillow.diasPending) ?? (z.realtor && z.realtor.dom)} días en el mercado` },
  ];
  async function pesosGuardados() {
    const { termiPesos = {} } = await chrome.storage.local.get("termiPesos");
    return Object.fromEntries(SENALES.map((s) => [s.id, termiPesos[s.id] ?? s.peso]));
  }
  // Califica todos los ZIP con lo que haya juntado Radar y guarda el resumen (termiRes)
  async function calificar(pesos) {
    pesos = pesos || (await pesosGuardados());
    const { radarData = {}, radarZips = {} } = await chrome.storage.local.get(["radarData", "radarZips"]);
    const lista = (radarZips.lista || []).map((z) => ({ ...z, ...(radarData[z.zip] || {}), zip: z.zip }));
    const rangos = {};
    for (const s of SENALES) rangos[s.id] = lista.map((z) => { try { return s.val(z); } catch (e) { return null; } }).filter((v) => v != null && isFinite(v)).sort((a, b) => a - b);
    const percentil = (id, v) => { const a = rangos[id]; if (!a.length || v == null) return null; let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return a.length > 1 ? lo / (a.length - 1) : 0.5; };
    // La cobertura se mide contra las señales que Radar ya trae (si una fuente no ha corrido, no castiga a nadie)
    const disponibles = SENALES.filter((s) => rangos[s.id].length);
    const total = disponibles.reduce((a, s) => a + (pesos[s.id] || 0), 0) || 1;
    const filas = lista.map((z) => {
      let suma = 0, pesoUsado = 0; const razones = [];
      for (const s of SENALES) {
        const w = pesos[s.id] || 0; if (!w) continue;
        let v = null; try { v = s.val(z); } catch (e) {}
        const p = percentil(s.id, v); if (p == null) continue;
        suma += w * p; pesoUsado += w;
        if (p >= 0.8) { try { razones.push({ p, w, t: s.txt(z) }); } catch (e) {} }
      }
      return { ...z, score: pesoUsado ? Math.round((suma / pesoUsado) * 100) : null, cobertura: pesoUsado / total, razones: razones.sort((a, b) => b.w * b.p - a.w * a.p).slice(0, 3).map((r) => r.t) };
    }).filter((f) => f.score != null).sort((a, b) => b.score - a.score || b.cobertura - a.cobertura);
    const top = filas.find((f) => f.cobertura >= 0.5) || filas[0];
    const faltan = SENALES.filter((s) => !rangos[s.id].length).map((s) => s.nombre);
    const res = { t: Date.now(), n: filas.length, top: top ? { zip: top.zip, score: top.score, ciudad: (top.info || {}).ciudad || "" } : null, calientes: filas.filter((f) => f.score >= 75 && f.cobertura >= 0.5).length, faltan };
    await chrome.storage.local.set({ termiRes: res });
    return { filas, res };
  }
  window.TermiCalc = { SENALES, tasa, pct, pesosGuardados, calificar };
})();
