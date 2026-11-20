// Línea de producción de esta pestaña. Veri y Owny tienen un clon para la línea de Acti:
// bv.html?linea=ac y owners.html?linea=ac (y la línea HECM: ?linea=hr para Chequi, Veri, Owny y Wibi). El clon guarda sus datos aparte (bvState_ac, bvPendientes_ac, lote_ac)
// y solo trabaja los domicilios de Acti. Este archivo va antes que todos los demás.
window.LINEA = new URLSearchParams(location.search).get("linea") || "";
window.K = (k) => (window.LINEA ? k + "_" + window.LINEA : k);
// bv → bv2 / ow → ow2 (línea de Acti) · bv → bv3, ow → ow3, ch → ch3, wb → wb3 (línea HECM de Heri)
if (window.LINEA) document.documentElement.dataset.mod += window.LINEA === "hr" ? "3" : "2";
