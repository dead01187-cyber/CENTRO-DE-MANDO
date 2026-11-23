// Ayudas de pantalla para los robots de la Fase 4. Todo el texto entra con textContent (nunca innerHTML con datos).
(function (g) {
  function h(tag, props = {}, ...hijos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) { if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else if (k.startsWith("on")) e[k] = v; else e.setAttribute(k, v); }
    for (const x of hijos.flat()) if (x != null && x !== false) e.append(x instanceof Node ? x : document.createTextNode(String(x)));
    return e;
  }
  const llenar = (id, ...hijos) => { const e = document.getElementById(id); e.replaceChildren(...hijos.flat().filter(Boolean)); return e; };
  const etiqueta = (clase, txt) => h("span", { class: "tag " + clase, text: txt });
  const numero = (valor, txt) => h("div", { class: "card" }, h("div", { class: "count", text: String(valor) }), h("small", { text: txt }));
  const vacio = (txt) => h("li", { class: "empty", text: txt });
  g.VISTA = { h, llenar, etiqueta, numero, vacio };
})(globalThis);
