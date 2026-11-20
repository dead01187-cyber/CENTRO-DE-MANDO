// Panel principal: cuatro pestañas (Propwire → BeenVerified → Owners → Lofty). Cada una vive en su propio iframe
// y se comunican por chrome.storage.local.
const MODS = ["ac", "bv2", "ow2", "zb", "rd", "ti", "pr", "hr", "ch3", "bv3", "ow3", "wb3", "pw", "ch", "wb", "bv", "ow", "lf", "tx", "sv"];
document.querySelectorAll(".rbm").forEach((e) => (e.innerHTML = window.robotSVG ? robotSVG(e.dataset.r) : ""));

function mostrar(m) {
  for (const x of MODS) {
    document.getElementById("b-" + x).classList.toggle("on", x === m);
    document.getElementById("f-" + x).classList.toggle("on", x === m);
  }
  chrome.storage.local.set({ tabActiva: m });
  if (m === "sv") document.querySelector("#b-sv .n").textContent = "";
}
for (const x of MODS) document.getElementById("b-" + x).onclick = () => mostrar(x);

// Numeritos de cada pestaña
// Muchos robots escriben a la vez: se recalcula máximo una vez cada 0.7 s (antes, en cada cambio)
let timerContar = null;
function contarPronto() { if (!timerContar) timerContar = setTimeout(() => { timerContar = null; contar(); }, 700); }
async function contar() {
  const c = await conteos(); // misma cuenta que el Centro de Mando (comun.js)
  const n = (id, v) => (document.querySelector(`#b-${id} .n`).textContent = v ? String(v) : "");
  n("pw", c.dom);
  n("ac", c.acBus);
  n("bv2", c.bus2);
  n("ow2", c.pend2 ? `${c.pend2}↓` : c.own2);
  n("ch", c.rev);
  n("wb", c.wbBus);
  n("bv", c.bus);
  n("ow", c.pend ? `${c.pend}↓` : c.own);
  n("lf", c.lis);
  n("zb", c.zbRev ? `${c.zbRep}+${c.zbRev}?` : c.zbRep);
  n("rd", c.rdPen);
  n("ti", c.tiPen);
  n("pr", c.prHecm || "");
  n("hr", c.hrHecm || "");
  n("ch3", c.rev3 || ""); n("bv3", c.bus3 || ""); n("ow3", c.pend3 ? `${c.pend3}↓` : c.own3 || ""); n("wb3", c.wbBus3 || "");
  n("tx", c.txHoy || "");
}

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  // El supervisor dijo algo y no lo estás viendo: puntito rojo
  if (ch.svNoLeido) document.querySelector("#b-sv .n").textContent = document.getElementById("b-sv").classList.contains("on") ? "" : " ";
  if (ch.prCasos || ch.hrVistos || ch.hrCasos || ch.chDestino_hr || ch.lote_hr || ch.lote_wb_hr || ch.bvPendientes_hr || ch.txHoy || ch.zbLeads || ch.lote_wb || ch.chDestino || ch.addresses || ch.zone || ch.bvState || ch.lote || ch.bvPendientes || ch.loftyListos) contarPronto();
  // Al terminar el ciclo de BeenVerified, brincar a Owners para ver al fantasmita leer
  if (ch.bvCicloTermino) chrome.storage.local.get("bvAuto").then((d) => { if (d.bvAuto !== false) mostrar("ow"); });
});

chrome.storage.local.get("tabActiva").then(({ tabActiva }) => mostrar(MODS.includes(tabActiva) ? tabActiva : "pw"));
contar();

// ---------- Centro de Mando ----------
const URL_MANDO = chrome.runtime.getURL("mando.html");
async function abrirMando() {
  const [t] = await chrome.tabs.query({ url: URL_MANDO });
  if (t) { await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }).catch(() => {}); }
  // Se abre como ventana de app (sin pestañas ni barra de direcciones)
  else await chrome.windows.create({ url: URL_MANDO, type: "popup", width: 1440, height: 900, focused: true });
}
document.getElementById("b-mando").onclick = abrirMando;
document.getElementById("ir-mando").onclick = abrirMando;

// Candado: si el Mando está abierto, el panel se apaga (descarga sus pestañas) para que no corran dos Capis.
const canalMando = new BroadcastChannel("geo-farming-mando");
let marcosHTML = null;
function apagarPanel() {
  if (document.body.classList.contains("mando-abierto")) return;
  const m = document.querySelector(".marcos");
  marcosHTML = m.innerHTML; m.innerHTML = "";
  document.body.classList.add("mando-abierto");
}
function prenderPanel() {
  if (!document.body.classList.contains("mando-abierto")) return;
  document.querySelector(".marcos").innerHTML = marcosHTML || "";
  document.body.classList.remove("mando-abierto");
  chrome.storage.local.get("tabActiva").then(({ tabActiva }) => mostrar(MODS.includes(tabActiva) ? tabActiva : "pw"));
}
canalMando.onmessage = (e) => {
  const d = e.data || {};
  if (d.t === "mando") apagarPanel();
  if (d.t === "mando-cerrado") setTimeout(() => chrome.tabs.query({ url: URL_MANDO }).then((ts) => { if (!ts.length) prenderPanel(); }), 300);
};
canalMando.postMessage({ t: "ping" });
