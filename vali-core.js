// =====================================================================
// Vali (Fase 4) — validación de teléfonos y datos de un lead, SIN servicios
// externos (reglas del plan de numeración de Norteamérica, NANP).
// No sabe si un número es celular o fijo ni si está activo: eso requiere un
// servicio de pago (por ejemplo Veriphone) y queda para cuando el jefe lo decida.
//
// Nivel de cada teléfono:
//   "malo"    seguro que no sirve (formato imposible, de mentira, 800/900…): no debe subir
//   "dudoso"  sirve pero hay que revisarlo (fuera de California, compartido por varios leads)
//   "ok"
// =====================================================================
(function (g) {
  const LADAS_CA = new Set("209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951".split(" "));
  const GRATUITOS = new Set(["800", "833", "844", "855", "866", "877", "888"]);
  const ESPECIALES = new Set(["900", "976", "500", "521", "522", "523", "524", "525", "526", "527", "528", "529", "533", "544", "566", "577", "588", "700", "710"]);
  const RE_EMPRESA = /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|TRUST|TRUSTEE|ESTATE|BANK|HOLDINGS?|PROPERTIES|INVESTMENTS?|PARTNERS|LP|LTD|GROUP|REALTY|MANAGEMENT|FUND)\b/i;

  const d10 = (t) => { let d = String(t || "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d; };

  function telefono(t) {
    const d = d10(t), problemas = [];
    if (d.length !== 10) return { num: d, nivel: "malo", problemas: ["no tiene 10 dígitos"] };
    const area = d.slice(0, 3), central = d.slice(3, 6), linea = d.slice(6);
    if (/^[01]/.test(area)) problemas.push("la lada no puede empezar con 0 o 1");
    if (/^[01]/.test(central)) problemas.push("el número local no puede empezar con 0 o 1");
    if (/^\d11$/.test(area) || /^\d11$/.test(central)) problemas.push("x11 es un código de servicio (411, 911…)");
    if (/^(\d)\1{9}$/.test(d)) problemas.push("todos los dígitos son iguales");
    if ("01234567890123456789".includes(d) || "98765432109876543210".includes(d)) problemas.push("dígitos en secuencia");
    if (/^(\d)\1{6}$/.test(central + linea)) problemas.push("los 7 dígitos locales son iguales");
    if (central === "555" && /^01\d\d$/.test(linea)) problemas.push("555-01xx es de mentira (películas)");
    if (GRATUITOS.has(area)) problemas.push(`lada ${area} es número gratuito (800): no es de una persona`);
    if (ESPECIALES.has(area)) problemas.push(`lada ${area} es de servicio especial`);
    if (problemas.length) return { num: d, nivel: "malo", problemas };
    const dudas = [];
    if (!LADAS_CA.has(area)) dudas.push("no es lada de California");
    if (central === "555") dudas.push("555 casi nunca es un número real");
    return { num: d, nivel: dudas.length ? "dudoso" : "ok", problemas: dudas };
  }

  // Lead de los lotes de Owny/Wibi: { owner, address, phones: [{ num }], emails }
  // Regresa los números buenos, los problemas y si se puede subir.
  function lead(l, { compartidos = new Set() } = {}) {
    const problemas = [], tels = [];
    for (const p of l.phones || []) {
      const v = telefono(p && typeof p === "object" ? p.num : p);
      if (v.nivel !== "malo" && compartidos.has(v.num)) { v.nivel = "dudoso"; v.problemas = [...v.problemas, "lo tienen otros leads del lote"]; }
      tels.push(v);
    }
    const owner = String(l.owner || "").trim();
    if (!owner) problemas.push("sin nombre del dueño");
    else if (RE_EMPRESA.test(owner)) problemas.push("el dueño parece empresa o trust");
    const partes = String(l.address || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (partes.length < 2) problemas.push("domicilio sin ciudad");
    if (!/\b\d{5}\b/.test(String(l.address || ""))) problemas.push("domicilio sin código postal");
    const buenos = tels.filter((t) => t.nivel !== "malo");
    if (!buenos.length) problemas.push(tels.length ? "ningún teléfono sirve" : "sin teléfonos");
    const nivel = !buenos.length || !owner ? "malo" : problemas.length || tels.some((t) => t.nivel !== "ok") ? "dudoso" : "ok";
    return { nivel, problemas, telefonos: tels };
  }

  // Revisa un lote completo (detecta números repetidos entre leads distintos)
  function lote(items) {
    const cuenta = new Map();
    for (const l of items || []) for (const n of new Set((l.phones || []).map((p) => d10(p && typeof p === "object" ? p.num : p)))) cuenta.set(n, (cuenta.get(n) || 0) + 1);
    const compartidos = new Set([...cuenta].filter(([, c]) => c > 1).map(([n]) => n));
    const filas = (items || []).map((l) => ({ address: l.address, owner: l.owner, ...lead(l, { compartidos }) }));
    const tot = (nv) => filas.filter((f) => f.nivel === nv).length;
    const telsMalos = filas.reduce((s, f) => s + f.telefonos.filter((t) => t.nivel === "malo").length, 0);
    return { filas, resumen: { leads: filas.length, ok: tot("ok"), dudosos: tot("dudoso"), malos: tot("malo"), telefonosMalos: telsMalos, compartidos: compartidos.size } };
  }

  g.VALI = { telefono, lead, lote, d10, LADAS_CA };
  if (typeof module !== "undefined") module.exports = g.VALI;
})(globalThis);
