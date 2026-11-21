// =====================================================================
// Efectos de sonido relajantes del Centro de Mando (v1.76.0)
// Solo efectos cortos, sin música. Todo se sintetiza con Web Audio
// (no hay archivos de audio): gotas de agua, campanas suaves tipo cuenco,
// un soplo de aire y un tono cálido para avisos. Pasan por un eco suave
// (reverberación generada) y un compresor, a volumen bajo.
//
//   Sonidos.tocar("gota" | "listo" | "aviso" | "inicio" | "enviar" | "clic")
//   Sonidos.activo = true/false
//   Sonidos.volumen = 0..1   (se guarda en chrome.storage: mandoVolumen)
//
// Para no cansar: la misma clase de sonido no se repite antes de su pausa
// mínima (la gota, por ejemplo, máx. ~4 por segundo).
// =====================================================================
(function (g) {
  let ctx = null, salida = null;
  const ultimo = {};
  const GANANCIA = 2.6; // nivel general: con volumen 60% los picos quedan alrededor de -12 dB
  const PAUSA = { gota: 250, listo: 900, aviso: 1500, inicio: 1200, enviar: 300, clic: 80 };

  // ---------- Cadena de salida: volumen → compresor → (seco + eco) ----------
  function eco(c, seg = 2.6, caida = 3.2) {
    const n = Math.floor(c.sampleRate * seg), buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, caida);
    }
    const r = c.createConvolver(); r.buffer = buf; return r;
  }
  function armarSalida(c, volumen) {
    const maestro = c.createGain(); maestro.gain.value = volumen * GANANCIA;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -24; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    const suave = c.createBiquadFilter(); suave.type = "lowpass"; suave.frequency.value = 7000; // sin agudos chillones
    const seco = c.createGain(); seco.gain.value = 0.8;
    const mojado = c.createGain(); mojado.gain.value = 0.32;
    const rev = eco(c);
    maestro.connect(suave); suave.connect(seco); suave.connect(rev); rev.connect(mojado);
    seco.connect(comp); mojado.connect(comp); comp.connect(c.destination);
    return maestro;
  }

  // ---------- Piezas ----------
  // Una nota con envolvente suave (ataque, caída exponencial)
  function nota(c, dest, t, { f, tipo = "sine", vol = 0.2, ataque = 0.006, dura = 1, glide = 0, filtro = 0 }) {
    const o = c.createOscillator(), gn = c.createGain();
    o.type = tipo; o.frequency.setValueAtTime(f, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(f * glide, t + Math.min(dura, 0.25));
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(vol, t + ataque);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dura);
    let nodo = o;
    if (filtro) { const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = filtro; o.connect(lp); nodo = lp; }
    nodo.connect(gn).connect(dest);
    o.start(t); o.stop(t + dura + 0.05);
  }
  // Campana tipo cuenco: parciales inarmónicos que se apagan a distinto ritmo
  function campana(c, dest, t, f, vol = 0.12, dura = 2.4) {
    [[1, 1, 1], [2.01, 0.45, 0.6], [2.76, 0.25, 0.45], [5.4, 0.08, 0.25]].forEach(([k, v, d]) =>
      nota(c, dest, t, { f: f * k, vol: vol * v, ataque: 0.004, dura: dura * d }));
  }
  // Soplo de aire: ruido filtrado que barre suave
  function soplo(c, dest, t, { desde = 600, hasta = 2400, vol = 0.07, dura = 0.45 } = {}) {
    const n = Math.floor(c.sampleRate * dura), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(desde, t); bp.frequency.exponentialRampToValueAtTime(hasta, t + dura);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol, t + dura * 0.35); gn.gain.exponentialRampToValueAtTime(0.0001, t + dura);
    src.connect(bp).connect(gn).connect(dest); src.start(t); src.stop(t + dura + 0.02);
  }

  // ---------- Los efectos ----------
  const azar = (a, b) => a + Math.random() * (b - a);
  const EFECTOS = {
    // Llega un dato a un agente: gota de agua (tono que cae rápido)
    gota: (c, d, t) => nota(c, d, t, { f: azar(950, 1350), glide: 0.45, vol: 0.12, ataque: 0.003, dura: 0.22 }),
    // Un agente terminó bien: campana suave, una sola
    listo: (c, d, t) => campana(c, d, t, azar(520, 560), 0.11, 2.6),
    // Error o necesita ayuda: dos tonos cálidos que bajan (sin zumbido)
    aviso: (c, d, t) => {
      nota(c, d, t, { f: 392, tipo: "triangle", vol: 0.12, ataque: 0.02, dura: 0.9, filtro: 1200 });
      nota(c, d, t + 0.22, { f: 311, tipo: "triangle", vol: 0.12, ataque: 0.02, dura: 1.2, filtro: 1000 });
    },
    // Arranca una misión: soplo que sube y una campana grave
    inicio: (c, d, t) => { soplo(c, d, t, { desde: 400, hasta: 1800, vol: 0.06, dura: 0.7 }); campana(c, d, t + 0.35, 330, 0.12, 3.2); },
    // Mandaste un mensaje a Capi: soplo corto
    enviar: (c, d, t) => soplo(c, d, t, { desde: 900, hasta: 3200, vol: 0.16, dura: 0.3 }),
    // Prender el sonido / clic: toque de madera suave
    clic: (c, d, t) => nota(c, d, t, { f: 880, tipo: "sine", vol: 0.08, ataque: 0.002, dura: 0.09, glide: 0.7 }),
  };

  const S = {
    activo: false,
    volumen: 0.6,
    tocar(nombre) {
      if (!S.activo || !EFECTOS[nombre]) return;
      const ahora = performance.now();
      if (ahora - (ultimo[nombre] || 0) < (PAUSA[nombre] || 0)) return;
      ultimo[nombre] = ahora;
      try {
        if (!ctx) { ctx = new AudioContext(); salida = armarSalida(ctx, S.volumen); }
        if (ctx.state === "suspended") ctx.resume();
        salida.gain.value = S.volumen * GANANCIA;
        EFECTOS[nombre](ctx, salida, ctx.currentTime + 0.01);
      } catch (e) {}
    },
    // Para pruebas y para escucharlos fuera del navegador: arma el efecto en un contexto dado
    renderizar(c, nombre, volumen = 0.6) { const s = armarSalida(c, volumen); EFECTOS[nombre](c, s, 0.05); },
    NOMBRES: Object.keys(EFECTOS),
  };
  g.Sonidos = S;
})(window);
