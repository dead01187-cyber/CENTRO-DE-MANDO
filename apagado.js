const m = new URLSearchParams(location.search).get("m") || "";
  const NOMBRE = { pr: "Prope", ch3: "Chequi 3", bv3: "Veri 3", ow3: "Owny 3", wb3: "Wibi 3", hr: "Heri", tx: "Texi", wb: "Wibi", zb: "Zeta", rd: "Redi", ti: "Timi", bv2: "Veri 2", ow2: "Owny 2", ac: "Acti", pw: "Propi", ch: "Chequi", bv: "Veri", ow: "Owny", lf: "Lofti" };
  document.getElementById("titulo").textContent = (NOMBRE[m] || "Robot") + " está apagado";
  document.title = (NOMBRE[m] || "Robot") + " apagado";
  const base = m.replace(/[23]$/, "");
  if (window.robotSVG) document.getElementById("robot").innerHTML = robotSVG(base);
  document.getElementById("prender").onclick = async () => {
    const { robotsApagados = {} } = await chrome.storage.local.get("robotsApagados");
    delete robotsApagados[m]; await chrome.storage.local.set({ robotsApagados });
  };
