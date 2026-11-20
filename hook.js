// Corre dentro de la página de Propwire (MAIN world).
// Escucha las respuestas JSON que Propwire baja (resultados de búsqueda)
// y se las pasa al content script para sacar los domicilios.
(() => {
  if (window.__pwAgentHooked) return;
  window.__pwAgentHooked = true;

  const send = (data) => {
    try { window.postMessage({ __pwAgent: true, data }, "*"); } catch (e) {}
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("json")) res.clone().json().then(send).catch(() => {});
    } catch (e) {}
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (...a) { return origOpen.apply(this, a); };
  XMLHttpRequest.prototype.send = function (...a) {
    this.addEventListener("load", () => {
      try {
        const ct = this.getResponseHeader("content-type") || "";
        if (!ct.includes("json")) return;
        const body = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
        send(body);
      } catch (e) {}
    });
    return origSend.apply(this, a);
  };
})();
