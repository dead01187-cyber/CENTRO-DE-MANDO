document.getElementById("robot").innerHTML = window.robotSVG ? robotSVG("sv") : "";
document.getElementById("ok").onclick = async () => {
  const msg = document.getElementById("msg");
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    msg.textContent = "¡Listo! Ya puedes cerrar esta pestaña y prender “🎤 Escuchar” en Capi.";
    chrome.storage.local.set({ svMic: true });
  } catch (e) {
    msg.textContent = "No se dio el permiso. Revisa el ícono del micrófono en la barra de direcciones o en Configuración de Chrome.";
  }
};
