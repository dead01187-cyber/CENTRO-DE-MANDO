// Timi contra un Teams FALSO (página local): encuentra el chat de grupo, pone la imagen
// (si Teams ignora el "pegar", la adjunta por el botón de archivo) y confirma que salió.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { chromium } = require("playwright");

const fuente = fs.readFileSync(__dirname + "/../../ti.js", "utf8");
const enTeams = fuente.slice(fuente.indexOf("async function enTeams("), fuente.indexOf("// Pestaña de Teams del agente"));
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const TEAMS = (aceptaPegar) => `<!doctype html><meta charset="utf-8"><body>
<div role="tree">
  <div role="treeitem" data-item-type="chat"><span id="title-chat-list-item_1">Juan Pérez</span></div>
  <div role="treeitem" data-item-type="chat" aria-label="Replacement Leads, chat de grupo"><span id="title-chat-list-item_2">Replacement Leads</span></div>
</div>
<h2 data-tid="chat-title">Juan Pérez</h2>
<div data-tid="ckeditor" contenteditable="true"></div>
<input type="file" hidden id="f">
<button data-tid="newMessageCommands-send">Enviar</button>
<div id="msgs"></div>
<script>
  const ed = document.querySelector('[data-tid="ckeditor"]');
  document.querySelectorAll('[role=treeitem]').forEach((t) => t.onclick = () => { document.querySelector('[data-tid="chat-title"]').textContent = t.innerText.trim(); });
  const poner = (file) => { const im = new Image(); im.src = URL.createObjectURL(file); ed.appendChild(im); };
  ed.addEventListener("paste", (e) => { if (${aceptaPegar}) { e.preventDefault(); poner(e.clipboardData.files[0]); } });
  document.getElementById("f").addEventListener("change", (e) => poner(e.target.files[0]));
  document.querySelector('[data-tid$="send"]').onclick = () => {
    const im = ed.querySelector("img"); if (!im) return;
    const m = document.createElement("div"); m.dataset.tid = "chat-pane-message"; m.className = "fui-ChatMyMessage"; m.id = "m" + Date.now();
    m.appendChild(im); document.getElementById("msgs").appendChild(m); ed.innerHTML = "";
  };
</script></body>`;

for (const aceptaPegar of [true, false]) {
  test(`Timi en Teams falso: chat de grupo, ${aceptaPegar ? "pegando" : "Teams ignora el pegar → adjunta por archivo"}`, async () => {
    const b = await chromium.launch({ channel: "chromium", headless: true });
    try {
      const p = await b.newPage();
      await p.route("https://teams.cloud.microsoft/**", (r) => r.fulfill({ contentType: "text/html", body: TEAMS(aceptaPegar) }));
      await p.goto("https://teams.cloud.microsoft/v2/");
      const r = await p.evaluate(`(${enTeams})("Replacement Leads", ${JSON.stringify(PNG)}, "captura.png")`);
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.como, aceptaPegar ? "pegar" : "archivo");
      assert.equal(await p.textContent('[data-tid="chat-title"]'), "Replacement Leads");
      assert.equal(await p.locator('#msgs [data-tid="chat-pane-message"] img').count(), 1);
      // chat que no existe: dice qué chats ve
      const r2 = await p.evaluate(`(${enTeams})("Otro Grupo", ${JSON.stringify(PNG)}, "c.png")`);
      assert.equal(r2.ok, false); assert.match(r2.motivo, /no encontré el chat de grupo “Otro Grupo”.*replacement leads/i);
    } finally { await b.close(); }
  });
}
