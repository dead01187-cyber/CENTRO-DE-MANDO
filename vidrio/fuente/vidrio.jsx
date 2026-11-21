// =====================================================================
// Puente del efecto "Liquid Glass" (liquid-glass-react, MIT, © 2025 Max Rovensky)
// para las páginas de la extensión, que NO usan React.
//
//   const v = Vidrio.envolver(elemento, { radio: 14, distorsion: 40 });   // lo pone dentro de un vidrio
//   v.quitar();                                                           // lo regresa a como estaba
//
// El elemento original (con sus botones y eventos) se MUEVE adentro del vidrio: no se copia ni se vuelve a dibujar.
// Se compila con `npm run build:vidrio` a vidrio/vidrio.js (ese archivo es el que carga la extensión).
// =====================================================================
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import LiquidGlass from "liquid-glass-react";

function Contenido({ nodo }) {
  const caja = useRef(null);
  useEffect(() => {
    const c = caja.current;
    if (c && nodo && nodo.parentNode !== c) c.appendChild(nodo);
  }, [nodo]);
  return <div ref={caja} />;
}

function Vidrio({ nodo, ancho, op, letra }) {
  return (
    <LiquidGlass
      style={{ position: "absolute", top: "50%", left: "50%" }}
      cornerRadius={op.radio}
      padding="0px"
      displacementScale={op.distorsion}
      blurAmount={op.desenfoque}
      saturation={op.saturacion}
      aberrationIntensity={op.aberracion}
      elasticity={op.elasticidad}
      mode={op.modo}
      overLight={op.sobreClaro}
    >
      {/* la librería fija "500 20px/1 system-ui" y sombra de texto: aquí se regresa la letra de la página */}
      <div className="vidrio-contenido" style={{ display: "flow-root", width: ancho ? `${ancho}px` : "auto", font: letra, textShadow: "none", textAlign: "left" }}><Contenido nodo={nodo} /></div>
    </LiquidGlass>
  );
}

const DEF = { radio: 14, distorsion: 40, desenfoque: 0.08, saturacion: 140, aberracion: 1.5, elasticidad: 0.12, modo: "standard", sobreClaro: false };

function envolver(nodo, opciones = {}) {
  if (!nodo || nodo.__vidrio) return nodo && nodo.__vidrio;
  const op = { ...DEF, ...opciones };
  // El "anfitrión" ocupa el lugar del elemento en la página; el vidrio flota centrado sobre él con el mismo tamaño
  const anfitrion = document.createElement("div");
  anfitrion.className = "vidrio-anfitrion";
  anfitrion.style.cssText = "position:relative;width:100%;";
  // El margen del elemento pasa al anfitrión (afuera del vidrio); adentro el elemento queda sin margen.
  // Si no, el margen se sumaba al vidrio y su marco quedaba más grande que el bloque (borde doble).
  const margenOriginal = nodo.style.margin;
  anfitrion.style.margin = getComputedStyle(nodo).margin;
  nodo.style.margin = "0";
  nodo.parentNode.insertBefore(anfitrion, nodo);
  const raiz = createRoot(anfitrion);
  const letra = getComputedStyle(anfitrion.parentNode).font; // la letra que tenía el elemento antes de entrar al vidrio
  let ancho = anfitrion.clientWidth;
  const pintar = () => raiz.render(<Vidrio nodo={nodo} ancho={ancho} op={op} letra={letra} />);
  let alto = -1, avisar = 0;
  const medir = () => {
    // el alto se mide DENTRO del vidrio: ahí los márgenes del contenido sí cuentan (afuera no, y el vidrio quedaba 12 px más alto)
    const dentro = anfitrion.querySelector(".vidrio-contenido");
    const w = anfitrion.clientWidth, h = dentro ? dentro.offsetHeight : nodo.offsetHeight;
    const cambio = Math.abs(w - ancho) > 1 || Math.abs(h - alto) > 1;
    if (Math.abs(w - ancho) > 1) { ancho = w; pintar(); }
    alto = h;
    anfitrion.style.height = `${h}px`; // el vidrio es absoluto: el anfitrión reserva su alto
    // La librería mide el vidrio solo al crearlo y cuando cambia la ventana ("resize"). Si el contenido cambió de tamaño,
    // se le avisa para que su marco y brillos vuelvan a medir (si no, quedaba un borde doble abajo).
    if (cambio) { cancelAnimationFrame(avisar); avisar = requestAnimationFrame(() => window.dispatchEvent(new Event("resize"))); }
  };
  const ro = new ResizeObserver(medir);
  pintar();
  requestAnimationFrame(() => { medir(); ro.observe(anfitrion); ro.observe(nodo); const d = anfitrion.querySelector(".vidrio-contenido"); if (d) ro.observe(d); });
  const control = {
    quitar() {
      ro.disconnect();
      anfitrion.parentNode && anfitrion.parentNode.insertBefore(nodo, anfitrion);
      nodo.style.margin = margenOriginal;
      raiz.unmount(); anfitrion.remove(); delete nodo.__vidrio;
    },
  };
  nodo.__vidrio = control;
  return control;
}

window.Vidrio = { envolver, version: "liquid-glass-react 1.1.1 · React 19.1.0" };
