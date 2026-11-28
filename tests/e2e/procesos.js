// Apaga un proceso de prueba (puente, Lofty falso) y ESPERA a que de verdad termine,
// para que el puerto 8765 quede libre antes de la siguiente prueba.
module.exports.apagar = (p) => new Promise((ok) => {
  if (!p || p.exitCode !== null || p.signalCode !== null) return ok();
  const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch (e) {} }, 3000);
  p.once("exit", () => { clearTimeout(t); ok(); });
  try { p.kill(); } catch (e) { clearTimeout(t); ok(); }
});
