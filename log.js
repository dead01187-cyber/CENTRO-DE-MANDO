// Bitácora compartida: cada pestaña anota lo que pasa para que el Supervisor lo vea.
// Los eventos se mandan al background, que los guarda en orden (svEventos).
(function () {
  const MOD = document.documentElement.dataset.mod || "?";
  const ERR = /no pude|no se pudo|error|fall[óo]|no encontr|interrump|iniciar sesi|sin respuesta|no acept|rechaz|atorad/i;
  let ultimo = "", ultimoT = 0;
  window.svLog = function (texto, nivel) {
    texto = String(texto || "").trim();
    if (!texto || (texto === ultimo && Date.now() - ultimoT < 3000)) return;
    ultimo = texto; ultimoT = Date.now();
    const ev = { t: Date.now(), mod: MOD, nivel: nivel || (ERR.test(texto) ? "error" : "info"), texto: texto.slice(0, 300) };
    try { chrome.runtime.sendMessage({ type: "svLog", ev }).catch(() => {}); } catch (e) {}
    // Si el robot necesita ayuda (captcha o login), avisar en voz alta (máx. una vez por minuto)
    if (/pide (verificación|iniciar sesi)|captcha/i.test(texto) && Date.now() - (window.__ultimaVoz || 0) > 60000) {
      window.__ultimaVoz = Date.now();
      const quien = (window.robot && window.robot.nombre) || "Tu robot";
      chrome.storage.local.get(["svVoz", "svVozNombre", "svVelocidad"]).then(({ svVoz, svVozNombre, svVelocidad }) => {
        if (svVoz === false) return;
        const o = { lang: "es-MX", rate: Number(svVelocidad) || 1, enqueue: true };
        if (svVozNombre) o.voiceName = svVozNombre;
        try { chrome.tts.speak(`Jefe, ${quien} necesita tu ayuda. ${texto.split(".")[0]}.`, o); } catch (e) {}
      });
    }
  };
  window.addEventListener("error", (e) =>
    window.svLog(`Error de código: ${e.message} (${String(e.filename || "").split("/").pop()}:${e.lineno})`, "error"));
  window.addEventListener("unhandledrejection", (e) =>
    window.svLog(`Error de código: ${(e.reason && e.reason.message) || e.reason}`, "error"));
})();
