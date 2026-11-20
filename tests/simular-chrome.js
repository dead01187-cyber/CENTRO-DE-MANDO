// chrome.storage.local simulado en memoria para probar módulos sin Chrome
module.exports = function simularChrome(inicial = {}) {
  let datos = JSON.parse(JSON.stringify(inicial));
  const copia = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  globalThis.chrome = {
    storage: { local: {
      async get(k) { if (k == null) return copia(datos); const ks = [].concat(k); const r = {}; for (const x of ks) if (x in datos) r[x] = copia(datos[x]); return r; },
      async set(o) { for (const [k, v] of Object.entries(o)) datos[k] = copia(v); },
      async remove(k) { for (const x of [].concat(k)) delete datos[x]; },
    } },
  };
  return { datos: () => datos, poner: (o) => Object.assign(datos, copia(o)) };
};
