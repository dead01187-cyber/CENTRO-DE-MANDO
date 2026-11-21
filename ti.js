// =====================================================================
// Timi: manda a Teams (chat "Replacement Leads") la captura del borrador
// de reclamo que dejó Redi en Gmail. Redi toma la foto; Timi la pega en el
// chat de Teams que ya tienes abierto en Chrome y le da Enviar.
// Cada captura se manda UNA sola vez (si algo queda dudoso, no la repite: te avisa).
// =====================================================================
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ver = (t) => { $("status").textContent = t; };
const decir = (t, nivel) => { ver(t); window.svLog && svLog(t, nivel); };
const fecha = (ms) => ms ? new Date(ms).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const DEF = { activo: true, auto: true, chat: "Replacement Leads", url: "https://teams.live.com/v2/" };
let cfg = { ...DEF }, corriendo = false, parar = false;

async function cargarCfg() {
  const { tiConfig = {} } = await chrome.storage.local.get("tiConfig");
  cfg = { ...DEF, ...tiConfig };
  $("activo").checked = cfg.activo !== false; $("auto").checked = !!cfg.auto; $("chat").value = cfg.chat; $("url").value = cfg.url;
}
function guardarCfg() {
  cfg = { activo: $("activo").checked, auto: $("auto").checked, chat: $("chat").value.trim() || DEF.chat, url: $("url").value.trim() || DEF.url };
  chrome.storage.local.set({ tiConfig: cfg });
}
["activo", "auto", "chat", "url"].forEach((id) => ($(id).onchange = () => { guardarCfg(); pintar(); if (cfg.auto) mandar(false); }));

// ---------- Corre DENTRO de Teams (mundo de la página) ----------
async function enTeams(chat, dataUrl, nombreArchivo) {
  const esp = (ms) => new Promise((r) => setTimeout(r, ms));
  const limpio = (t) => String(t || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (/login\.(microsoftonline|live)\.com/.test(location.host)) return { ok: false, motivo: "Teams pide iniciar sesión" };
  // 1) Abrir el chat
  let item = null;
  const nombre = (e) => ((e.querySelector('[id^="title-chat-list-item_"]') || {}).textContent || "").trim();
  for (let i = 0; i < 60 && !item; i++) {
    item = [...document.querySelectorAll('[role="treeitem"][data-item-type="chat"]')].find((e) => limpio(nombre(e)) === limpio(chat));
    if (!item) await esp(500);
  }
  if (!item) return { ok: false, motivo: `no encontré el chat “${chat}” en Teams` };
  const titulo = () => limpio((document.querySelector('[data-tid="chat-title"]') || {}).textContent);
  if (titulo() !== limpio(chat)) { item.click(); for (let i = 0; i < 30 && titulo() !== limpio(chat); i++) await esp(300); }
  if (titulo() !== limpio(chat)) return { ok: false, motivo: `no pude abrir el chat “${chat}”` };
  await esp(1500);
  // 2) Caja de mensaje vacía
  let ed = null;
  for (let i = 0; i < 30 && !ed; i++) { ed = document.querySelector('[data-tid="ckeditor"]'); if (!ed) await esp(300); }
  await esp(800);
  ed = document.querySelector('[data-tid="ckeditor"]') || ed;
  if (!ed) return { ok: false, motivo: "no encontré la caja para escribir en Teams" };
  if (ed.querySelector("img") || ed.innerText.replace(/[\s⁠]/g, "")) {
    if (ed.ckeditorInstance) { ed.ckeditorInstance.setData(""); await esp(600); }
    else return { ok: false, motivo: "la caja de mensaje de Teams tiene algo escrito; no la toqué" };
  }
  const misMensajes = () => [...document.querySelectorAll('[data-tid="chat-pane-message"]')].filter((m) => /ChatMyMessage/.test(String(m.className)));
  const antes = misMensajes().length, ultimoAntes = (misMensajes().pop() || {}).id || "";
  // 3) Pegar la imagen (hasta 3 intentos: Teams a veces ignora el primero si la caja apenas se está armando)
  const blob = await (await fetch(dataUrl)).blob();
  const pegar = () => {
    const dt = new DataTransfer(); dt.items.add(new File([blob], nombreArchivo, { type: "image/png" }));
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  };
  let lista = false;
  for (let intento = 0; intento < 3 && !lista; intento++) {
    ed = document.querySelector('[data-tid="ckeditor"]') || ed; // Teams puede rearmar la caja al cambiar de chat
    ed.focus(); await esp(500);
    if (!ed.querySelector("img")) pegar();
    for (let i = 0; i < 40 && !lista; i++) { // hasta 12 s: la imagen ya está en la caja (aunque siga cargando)
      await esp(300); const im = ed.querySelector("img");
      lista = !!(im && im.getAttribute("src") && (im.complete ? im.naturalWidth > 0 : i > 6));
    }
  }
  if (!lista) { if (ed.ckeditorInstance) ed.ckeditorInstance.setData(""); return { ok: false, motivo: "Teams no aceptó la imagen" }; }
  await esp(1200);
  // 4) Enviar
  const enviar = document.querySelector('button[data-tid$="MessageCommands-send"]');
  if (!enviar || enviar.disabled || enviar.getAttribute("aria-disabled") === "true") return { ok: false, motivo: "el botón Enviar de Teams no está disponible" };
  enviar.click();
  // 5) Confirmar que salió: un mensaje mío nuevo con imagen y la caja vacía
  for (let i = 0; i < 60; i++) {
    await esp(500);
    const mios = misMensajes(), u = mios[mios.length - 1];
    if (u && (mios.length > antes || u.id !== ultimoAntes) && u.querySelector("img") && !ed.querySelector("img")) return { ok: true };
  }
  return { ok: false, dudoso: true, motivo: "le di Enviar pero no vi el mensaje en el chat" };
}

// Pestaña de Teams del robot
async function pestanaTeams() {
  const { tiTab } = await chrome.storage.local.get("tiTab");
  if (tiTab) {
    const t = await chrome.tabs.get(tiTab).catch(() => null);
    if (t && /^https:\/\/teams\.(live|microsoft)\.com\//.test(t.url || "") && await enSuVentana(t.id)) return t.id;
  }
  const t = await abrirPestana(cfg.url);
  await chrome.storage.local.set({ tiTab: t.id });
  await sleep(4000);
  return t.id;
}

// Pone la pestaña de Teams al frente unos segundos (Teams no procesa bien la imagen en una pestaña oculta)
// y regresa una función para dejar todo como estaba
async function alFrente(tabId) {
  const t = await chrome.tabs.get(tabId);
  const [antes] = await chrome.tabs.query({ active: true, windowId: t.windowId });
  const winFoco = await chrome.windows.getLastFocused().catch(() => null);
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
  await sleep(1200);
  return async () => {
    if (antes && antes.id !== tabId) await chrome.tabs.update(antes.id, { active: true }).catch(() => {});
    if (winFoco && winFoco.id !== t.windowId) await chrome.windows.update(winFoco.id, { focused: true }).catch(() => {});
  };
}

const porMandar = (zbLeads) => Object.values(zbLeads).filter((l) => l.teams === "pendiente").sort((a, b) => (a.fotoT || 0) - (b.fotoT || 0));

async function mandar(aMano, soloId) {
  if (corriendo) return;
  guardarCfg();
  const { zbLeads = {} } = await chrome.storage.local.get("zbLeads");
  const lista = soloId ? [zbLeads[soloId]].filter(Boolean) : porMandar(zbLeads);
  if (!lista.length) { if (aMano) ver("No hay capturas pendientes para Teams."); return; }
  if (!soloId && !aMano && !cfg.auto) return;
  corriendo = true; parar = false; $("run").disabled = true;
  let hechos = 0;
  try {
    const tab = await pestanaTeams();
    for (const l of lista) {
      if (parar) break;
      const url = await fotoLeer(l.leadIdZb).catch(() => null);
      if (!url) { await zbPoner({ [l.leadIdZb]: { teams: "error", teamsError: "no encontré la captura (dale Rehacer en Redi)" } }); continue; }
      window.robot && robot.set("trabajando", `Mandando a Teams la captura de ${l.nombre}…`);
      ver(`Mandando a Teams (“${cfg.chat}”) la captura de ${l.nombre}…`);
      await zbPoner({ [l.leadIdZb]: { teams: "enviando" } }); // si algo se corta a la mitad, no se vuelve a mandar sola
      const archivo = `Replacement ${String(l.nombre || "lead").replace(/[^\w ]+/g, "").trim()}.png`;
      const volver = await alFrente(tab);
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab }, world: "MAIN", func: enTeams, args: [cfg.chat, url, archivo] })
        .catch((e) => [{ result: { ok: false, motivo: e.message } }]);
      await volver();
      const res = (r && r.result) || { ok: false, motivo: "la pestaña de Teams no respondió" };
      if (res.ok) {
        hechos++;
        await zbPoner({ [l.leadIdZb]: { teams: "enviado", teamsT: Date.now(), teamsError: "" } });
        svLog && svLog(`Mandé a Teams (“${cfg.chat}”) la captura del reclamo de ${l.nombre}.`);
      } else {
        await zbPoner({ [l.leadIdZb]: { teams: res.dudoso ? "revisar" : "error", teamsError: res.motivo } });
        decir(`No pude mandar a Teams la captura de ${l.nombre}: ${res.motivo}.${res.dudoso ? " Revisa el chat antes de reenviarla." : ""}`, "error");
        if (/sesión|no encontré el chat|caja/.test(res.motivo)) break;
      }
      await sleep(2500);
    }
  } catch (e) {
    decir(`Error mandando a Teams: ${e.message}`, "error");
  } finally {
    corriendo = false; $("run").disabled = false;
    if (hechos) decir(`Listo: mandé ${hechos} captura(s) al chat “${cfg.chat}” de Teams.`);
    pintar();
  }
}

// ---------- Pantalla ----------
const ETQ = { pendiente: ["por mandar", "#fef3c7", "#92400e"], enviando: ["mandando…", "#e0f2fe", "#075985"], enviado: ["✓ en Teams", "#dcfce7", "#166534"],
  error: ["falló", "#fee2e2", "#b91c1c"], revisar: ["¿se mandó? revisa", "#ffedd5", "#9a3412"] };
async function pintar() {
  const { zbLeads = {} } = await chrome.storage.local.get("zbLeads");
  const ls = Object.values(zbLeads).filter((l) => l.teams).sort((a, b) => (b.fotoT || b.borradorT || 0) - (a.fotoT || a.borradorT || 0));
  $("nPen").textContent = ls.filter((l) => l.teams === "pendiente").length;
  $("nEnv").textContent = ls.filter((l) => l.teams === "enviado").length;
  $("nErr").textContent = ls.filter((l) => l.teams === "error" || l.teams === "revisar").length;
  const ul = $("list"); ul.innerHTML = "";
  if (!ls.length) { ul.innerHTML = '<li class="empty">Cuando Redi deje un borrador listo, aquí aparece su captura.</li>'; return; }
  for (const l of ls.slice(0, 200)) {
    const [t, bg, fg] = ETQ[l.teams] || [l.teams, "#e2e8f0", "#334155"];
    const li = document.createElement("li");
    li.innerHTML = `<div class="addr"><b>${esc(l.nombre)}</b> <span class="tag" style="background:${bg};color:${fg}" title="${esc(l.teamsError || "")}">${t}</span>
      <small>${l.teams === "enviado" ? "mandada " + fecha(l.teamsT) : "captura " + fecha(l.fotoT || l.borradorT)}${l.teamsError ? " · " + esc(l.teamsError) : ""}</small></div>`;
    const acc = document.createElement("div"); acc.className = "acc";
    const boton = (txt, fn, title) => { const b = document.createElement("button"); b.className = "mini"; b.textContent = txt; b.title = title || ""; b.onclick = fn; acc.appendChild(b); };
    boton("Ver", () => verFoto(l), "Ver la captura que se manda");
    if (l.teams === "pendiente") boton("Mandar", () => mandar(true, l.leadIdZb), "Mandar esta captura a Teams ahora");
    if (l.teams === "error" || l.teams === "revisar" || l.teams === "enviado")
      boton(l.teams === "enviado" ? "Reenviar" : "Reintentar", async () => {
        if (l.teams !== "error" && !(await preguntar(l.teams === "enviado" ? `¿Mandar OTRA VEZ a Teams la captura de ${l.nombre}?` : `Revisa primero el chat de Teams. ¿Mandar la captura de ${l.nombre}?`, "Mandar"))) return;
        await zbPoner({ [l.leadIdZb]: { teams: "pendiente", teamsError: "" } }); mandar(true, l.leadIdZb);
      });
    li.appendChild(acc); ul.appendChild(li);
  }
}
async function verFoto(l) {
  const url = await fotoLeer(l.leadIdZb).catch(() => null);
  if (!url) { ver(`No encontré la captura de ${l.nombre}.`); return; }
  $("vistaImg").src = url; $("vistaTit").textContent = l.nombre; $("vista").hidden = false;
}
$("vistaCerrar").onclick = () => { $("vista").hidden = true; $("vistaImg").src = ""; };
$("run").onclick = () => mandar(true);
$("stop").onclick = () => { parar = true; ver("Detenido."); };
$("abrir").onclick = () => chrome.tabs.create({ url: cfg.url });

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local" || !ch.zbLeads) return;
  pintar();
  if (cfg.auto && porMandar(ch.zbLeads.newValue || {}).length) setTimeout(() => mandar(false), 2000);
});

window.tiMandar = mandar; // Capi
(async () => {
  await cargarCfg();
  // lo que quedó "mandando…" (se cerró Chrome a la mitad): no se repite solo
  const { zbLeads = {} } = await chrome.storage.local.get("zbLeads");
  const colgados = Object.values(zbLeads).filter((l) => l.teams === "enviando");
  if (colgados.length) await zbPoner(Object.fromEntries(colgados.map((l) => [l.leadIdZb, { teams: "revisar", teamsError: "se cortó mientras se mandaba" }])));
  fotosLimpiar().catch(() => {});
  await pintar();
  if (cfg.auto) setTimeout(() => mandar(false), 5000);
})();
