// Ventana propia de cada brazo: solo dice de quién es.
const b = new URLSearchParams(location.search).get("b") || "nuevos";
const INFO = {
  nuevos: { ico: "🏠", nombre: "Leads nuevos", quienes: "Propi, Chequi, Wibi, Veri, Owny y Lofti" },
  zbuyer: { ico: "✉️", nombre: "zBuyer", quienes: "Zeta, Redi y Timi (Gmail, Lofty y Teams)" },
  actualizar: { ico: "🔄", nombre: "Actualizar leads", quienes: "Acti, Veri 2 y Owny 2" },
  hecm: { ico: "🏚️", nombre: "HECM", quienes: "Heri, Chequi 3, Veri 3, Owny 3 y Wibi 3" },
}[b] || { ico: "🪟", nombre: b, quienes: "" };
document.title = `${INFO.ico} ${INFO.nombre} · ventana de trabajo`;
document.getElementById("ico").textContent = INFO.ico;
document.getElementById("titulo").textContent = `Ventana de trabajo: ${INFO.nombre}`;
document.getElementById("quienes").textContent = INFO.quienes;
