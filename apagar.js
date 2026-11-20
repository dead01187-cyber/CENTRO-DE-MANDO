// =====================================================================
// Interruptores de los robots (Centro de Mando y panel lateral).
// Un robot apagado no carga: su marco muestra "apagado" y no hace nada solo
// (ni timers, ni revisiones automáticas). Lo que le llegue se queda en fila
// hasta que lo prendas. Capi no se apaga (es el supervisor).
// =====================================================================
(() => {
  const NO_SE_APAGA = ["sv"];
  let actuales = {};
  function aplicar(ap) {
    actuales = ap || {};
    document.querySelectorAll("iframe[id^='f-']").forEach((f) => {
      const m = f.id.slice(2);
      if (NO_SE_APAGA.includes(m)) return;
      if (!f.dataset.src) f.dataset.src = f.getAttribute("src");
      const quiero = actuales[m] ? "apagado.html?m=" + m : f.dataset.src;
      if (f.getAttribute("src") !== quiero) f.setAttribute("src", quiero);
    });
    document.querySelectorAll("[data-m]").forEach((e) => {
      if (NO_SE_APAGA.includes(e.dataset.m)) return;
      e.classList.toggle("off", !!actuales[e.dataset.m]);
      const b = e.querySelector(".interruptor");
      if (b) { b.classList.toggle("on", !actuales[e.dataset.m]); b.title = actuales[e.dataset.m] ? "Apagado · clic para prender" : "Prendido · clic para apagar"; }
    });
  }
  async function cambiar(m, prender) {
    const { robotsApagados = {} } = await chrome.storage.local.get("robotsApagados");
    if (prender) delete robotsApagados[m]; else robotsApagados[m] = true;
    await chrome.storage.local.set({ robotsApagados });
  }
  window.robotApagado = (m) => !!actuales[m];
  window.prenderRobot = cambiar;
  // Botón de interruptor en cada estación del Mando
  document.querySelectorAll(".estacion[data-m]").forEach((e) => {
    if (NO_SE_APAGA.includes(e.dataset.m) || e.querySelector(".interruptor")) return;
    const b = document.createElement("button");
    b.className = "interruptor on"; b.type = "button"; b.innerHTML = "<i></i>";
    b.onclick = (ev) => { ev.stopPropagation(); cambiar(e.dataset.m, !b.classList.contains("on") ? true : false); };
    e.appendChild(b);
  });
  chrome.storage.local.get("robotsApagados").then(({ robotsApagados = {} }) => aplicar(robotsApagados));
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.robotsApagados) aplicar(ch.robotsApagados.newValue || {}); });
})();
