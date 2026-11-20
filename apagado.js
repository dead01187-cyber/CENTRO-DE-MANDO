const m = new URLSearchParams(location.search).get("m") || "";
  const NOMBRE = window.REGISTRO ? Object.fromEntries(REGISTRO.ids().map((x) => [x, REGISTRO.nombre(x)])) : {}; // Fase 2: del registro central
  document.getElementById("titulo").textContent = (NOMBRE[m] || "Robot") + " está apagado";
  document.title = (NOMBRE[m] || "Robot") + " apagado";
  const base = m.replace(/[23]$/, "");
  if (window.robotSVG) document.getElementById("robot").innerHTML = robotSVG(base);
  document.getElementById("prender").onclick = async () => {
    const { robotsApagados = {} } = await chrome.storage.local.get("robotsApagados");
    delete robotsApagados[m]; await chrome.storage.local.set({ robotsApagados });
  };
