// =====================================================================
// Fotos: las capturas que toman los robots (por ejemplo la del borrador
// de Gmail que Timi manda a Teams) se guardan aquí, en el navegador
// (IndexedDB). No van en chrome.storage porque pesan y lo llenarían.
// =====================================================================
(function (g) {
  const abrir = () => new Promise((ok, mal) => {
    const r = indexedDB.open("geo-farming-fotos", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("fotos");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
  async function con(modo, fn) {
    const db = await abrir();
    try {
      return await new Promise((ok, mal) => {
        const t = db.transaction("fotos", modo), q = fn(t.objectStore("fotos"));
        t.oncomplete = () => ok(q && q.result);
        t.onerror = t.onabort = () => mal(t.error);
      });
    } finally { db.close(); }
  }
  // id = el ID del lead; dataUrl = la imagen (PNG) como texto
  const fotoGuardar = (id, dataUrl) => con("readwrite", (s) => s.put({ url: dataUrl, t: Date.now() }, String(id)));
  const fotoLeer = async (id) => { const v = await con("readonly", (s) => s.get(String(id))); return v ? v.url : null; };
  const fotoBorrar = (id) => con("readwrite", (s) => s.delete(String(id)));
  // Borra las que ya tienen más de N días (para no acumular)
  async function fotosLimpiar(dias = 45) {
    const corte = Date.now() - dias * 86400000;
    const db = await abrir();
    try {
      await new Promise((ok, mal) => {
        const t = db.transaction("fotos", "readwrite"), cur = t.objectStore("fotos").openCursor();
        cur.onsuccess = () => { const c = cur.result; if (!c) return; if (!c.value || !(c.value.t > corte)) c.delete(); c.continue(); };
        t.oncomplete = ok; t.onerror = t.onabort = () => mal(t.error);
      });
    } finally { db.close(); }
  }
  Object.assign(g, { fotoGuardar, fotoLeer, fotoBorrar, fotosLimpiar });
})(globalThis);
