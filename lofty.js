(() => {
  const $ = id => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  const S = {
    pwFiles: [], rows: [], headers: [], map: null,
    lofty: null, loftyName: '', src: store.get('pw2l_src', 'geo'), owners: null,
    history: store.get('pw2l_hist', {}), records: [], tab: 'ok'
  };

  // ---------- archivos ----------
  function wireDrop(drop, input, onFiles) {
    drop.onclick = () => input.click();
    input.onchange = () => { onFiles([...input.files]); input.value = ''; };
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); onFiles([...e.dataTransfer.files].filter(f => /\.csv$/i.test(f.name) || f.type.includes('csv'))); };
  }
  const parse = file => new Promise(res => Papa.parse(file, { header: true, skipEmptyLines: 'greedy', transformHeader: h => h.trim(), complete: r => res(r.data) }));

  wireDrop($('dropPw'), $('filePw'), async files => {
    for (const f of files) S.pwFiles.push({ name: f.name, rows: await parse(f) });
    rebuildRows();
  });
  wireDrop($('dropLf'), $('fileLf'), async files => {
    if (!files[0]) return;
    const rows = await parse(files[0]);
    S.lofty = Core.indexLofty(rows); S.loftyName = files[0].name;
    renderFiles(); run();
  });

  // ---------- owners de la pestaña 3 ----------
  // Se convierten a filas con los mismos encabezados que un export de Propwire.
  function ownersFile(lote) {
    const maxP = Math.max(1, ...lote.map(f => (f.phones || []).length));
    const maxE = Math.max(0, ...lote.map(f => (f.emails || []).length));
    const rows = lote.map(f => {
      const parts = String(f.address || '').split(',').map(x => x.trim()).filter(Boolean);
      const m = (parts.slice(2).join(' ') || '').match(/([A-Za-z]{2})\s*(\d{5})?/) ||
        ((parts[1] || '').match(/\s([A-Za-z]{2})\s+(\d{5})$/));
      let city = parts[1] || '';
      if (parts.length === 2 && m) city = city.replace(/\s+[A-Za-z]{2}\s+\d{5}$/, '');
      const nombre = String(f.owner || '').trim().split(/\s+/);
      const row = {
        'Address': parts[0] || '', 'City': city, 'State': m ? m[1].toUpperCase() : '', 'Zip': m && m[2] ? m[2] : '',
        'Owner 1 First Name': nombre[0] || '', 'Owner 1 Last Name': nombre.slice(1).join(' ')
      };
      for (let i = 0; i < maxP; i++) {
        row[`Phone ${i + 1}`] = (f.phones[i] && f.phones[i].num) || '';
        row[`Phone ${i + 1} DNC`] = f.phones[i] && f.phones[i].dnc ? 'DNC' : ''; // Fase 1: antes la marca DNC de Wibi se perdía aquí
      }
      for (let i = 0; i < maxE; i++) row[`Email ${i + 1}`] = (f.emails || [])[i] || ''; // Wibi (Propwire) también trae emails
      return row;
    });
    return { name: 'Owners de la pestaña 3', rows };
  }
  // HECM de Heri: domicilio → datos (lender, aviso). Esos leads llevan los tags preforeclosure y celink y NO se suben solos.
  let hecmMap = {}, pwKeys = new Set();
  const claveDir = (street, city) => (String(street || '') + '|' + String(city || '')).toLowerCase().replace(/[^a-z0-9|]/g, '');
  const hecmDe = (r) => hecmMap[claveDir(r.street, r.city)] || null;
  const RE_HECM_L = /compu[\s-]*link|celink/i; // solo hipotecas inversas administradas por Celink / Compu-Link
  const cortoL = (l) => /compu/i.test(l) ? 'Compu-Link' : /celink/i.test(l) ? 'Celink' : String(l || '').slice(0, 30);
  async function cargarHecm() {
    const { addresses = {} } = await chrome.storage.local.get('addresses');
    hecmMap = {};
    for (const a of Object.values(addresses)) if (a.origen === 'hecm' && a.hecm) hecmMap[claveDir(a.street, a.city)] = { ...a.hecm, ciudad: a.city };
  }
  // Cuántos leads HECM están listos esperando tu OK (Capi te avisa)
  function contarHecm() {
    const n = (S.records || []).filter(r => r.status === 'ok' && !r.sent && !S.history[r.key] && hecmDe(r)).length;
    chrome.storage.local.set({ hecmEsperando: n });
  }
  async function loadOwners() {
    await cargarHecm();
    const { lote = [], lote_wb = [], lote_hr = [], lote_wb_hr = [] } = await chrome.storage.local.get(['lote', 'lote_wb', 'lote_hr', 'lote_wb_hr']);
    // Owny (BeenVerified) + Wibi (Propwire). Los que traen leadId son de Acti: se actualizan, no se crean
    const nuevos = [...lote, ...lote_wb, ...lote_hr, ...lote_wb_hr].filter(f => !f.leadId); // + la línea HECM (Owny 3 / Wibi 3)
    S.owners = nuevos.length ? ownersFile(nuevos) : null;
    // Los que vienen de Wibi (brazo Propwire) llevan el tag "propwire" en vez del TAG 1, para distinguirlos de los de BeenVerified
    pwKeys = new Set(lote_wb.filter(f => f.fuente === 'propwire').map(f => { const p = String(f.address || '').split(',').map(x => x.trim()); return claveDir(p[0], (p[1] || '').replace(/\s+[A-Za-z]{2}\s+\d{5}$/, '')); }));
    $('owN').textContent = nuevos.length;
    rebuildRows();
  }

  function rebuildRows() {
    const files = [...($('oOw').checked && S.owners ? [S.owners] : []), ...S.pwFiles];
    S.rows = files.flatMap(f => f.rows);
    const hs = new Set(); files.forEach(f => f.rows[0] && Object.keys(f.rows[0]).forEach(h => hs.add(h)));
    S.headers = [...hs];
    // conservar las columnas que corregiste a mano si siguen existiendo
    const prev = S.map;
    S.map = S.headers.length ? Core.detect(S.headers) : null;
    if (S.map && prev && prev.__edited) Object.assign(S.map, prev);
    renderFiles(); renderMap(); run();
  }

  function renderFiles() {
    $('listPw').innerHTML = S.pwFiles.map((f, i) => `<div class="file"><span>${esc(f.name)} · <span class="muted">${f.rows.length} filas</span></span><button class="x" data-i="${i}">×</button></div>`).join('');
    $('listPw').querySelectorAll('.x').forEach(b => b.onclick = () => { S.pwFiles.splice(+b.dataset.i, 1); rebuildRows(); });
    $('listLf').innerHTML = S.lofty ? `<div class="file"><span>${esc(S.loftyName)} · <span class="muted">${S.lofty.count} leads</span></span><button class="x" id="lfx">×</button></div>` : '';
    if (S.lofty) $('lfx').onclick = () => { S.lofty = null; renderFiles(); run(); };
    $('histN').textContent = Object.keys(S.history).length;
  }

  // ---------- columnas ----------
  const SINGLE = [['firstName','Nombre (First)'],['lastName','Apellido (Last)'],['ownerName','Nombre completo del dueño'],['address','Dirección de la propiedad'],['city','Ciudad'],['state','Estado'],['zip','ZIP'],['ownerType','Tipo de dueño']];
  function renderMap() {
    const has = !!S.map;
    ['cMap','cOpts'].forEach(id => $(id).classList.toggle('hidden', !has));
    if (!has) return;
    const opts = ['<option value="">— ninguna —</option>', ...S.headers.map(h => `<option>${esc(h)}</option>`)].join('');
    $('mapSingle').innerHTML = SINGLE.map(([k, l]) => `<label class="f">${l}<select data-k="${k}">${opts}</select></label>`).join('');
    $('mapSingle').querySelectorAll('select').forEach(s => { s.value = S.map[s.dataset.k] || ''; s.onchange = () => { S.map[s.dataset.k] = s.value; S.map.__edited = true; run(); }; });
    chips('chPhones', 'phones', h => /phone|mobile|cell|wireless|landline|number/i.test(h));
    chips('chEmails', 'emails', h => /mail/i.test(h));
    chips('chDnc', 'dnc', h => /dnc|call|phone/i.test(h));
  }
  function chips(el, key, relevant) {
    const list = S.headers.filter(h => relevant(h) || S.map[key].includes(h));
    $(el).innerHTML = list.length ? list.map(h => `<span class="chip ${S.map[key].includes(h) ? 'on' : ''}" data-h="${esc(h)}">${esc(h)}</span>`).join('') : '<span class="muted" style="font-size:12px">No hay columnas de este tipo</span>';
    $(el).querySelectorAll('.chip').forEach(c => c.onclick = () => {
      const h = c.dataset.h, arr = S.map[key];
      const i = arr.indexOf(h); i >= 0 ? arr.splice(i, 1) : arr.push(h);
      c.classList.toggle('on'); S.map.__edited = true; run();
    });
  }

  // ---------- opciones ----------
  const OPT_IDS = ['oEnt','oPhone','oDnc','oCA','oHist','oLast','oSave'];
  const saved = store.get('pw2l_opts', {});
  OPT_IDS.forEach(id => { if (id in saved) $(id).checked = saved[id]; $(id).onchange = () => { saveOpts(); run(); }; });
  // Ciudades: si no las escribiste aquí, siguen a la zona de la pestaña Propwire
  $('cities').value = store.get('pw2l_cities', '');
  const ciudadesDeZona = zone => zone.split(',').map(z => z.trim()).filter(z => z && !/^\d{5}$/.test(z) && !/^(ca|california)$/i.test(z)).join(', ').toLowerCase();
  const seguirZona = ({ zone = '' }) => { if (store.get('pw2l_cities', '')) return; $('cities').value = ciudadesDeZona(zone); run(); };
  chrome.storage.local.get('zone').then(seguirZona);
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.zone) seguirZona({ zone: ch.zone.newValue || '' }); });
  $('cities').oninput = () => { store.set('pw2l_cities', $('cities').value); run(); };
  $('maxP').oninput = run;
  $('tags').value = store.get('pw2l_tags', '');
  $('tags').oninput = () => { store.set('pw2l_tags', $('tags').value); run(); };
  $('tag1').oninput = () => { store.set('pw2l_tag1_' + S.src, $('tag1').value); run(); };
  const extraTags = () => [...new Set($('tags').value.split(',').map(t => t.trim()).filter(Boolean))];
  const tag1 = () => $('tag1').value.trim() || (S.src === 'geo' ? 'Geo farming' : 'propwire');
  function saveOpts() { const o = {}; OPT_IDS.forEach(id => o[id] = $(id).checked); store.set('pw2l_opts', o); }
  function setSrc(v) {
    S.src = v; store.set('pw2l_src', v);
    $('segSrc').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    $('srcInfo').textContent = v === 'geo' ? 'Incluye Last Name · TAG 2 = ciudad' : 'TAG 2 = ciudad';
    $('tag1').value = store.get('pw2l_tag1_' + v, v === 'geo' ? 'Geo farming' : 'propwire');
    if (v === 'geo') $('oLast').checked = true;
    run();
  }
  $('segSrc').querySelectorAll('button').forEach(b => b.onclick = () => setSrc(b.dataset.v));

  // ---------- HECM: si el dueño falleció, el lead se crea a nombre del familiar vivo mejor ubicado ----------
  // (el orden ya viene de Heri: cónyuge vivo → hijos del mayor al menor → hermanos…; solo cuenta si tiene teléfono)
  function aHeredero(r) {
    const h = hecmDe(r);
    if (!h || !h.fallecido) return;
    const tk = (t) => String(t || '').toUpperCase().replace(/[^A-Z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
    const [dAp, dNom = ''] = tk(h.dueno);
    const esDueno = tk(r.last).includes(dAp) && (!dNom || String(r.first || '').toUpperCase().startsWith(dNom.slice(0, 3)));
    if (!esDueno && r.phones.length) return; // el contacto ya es otra persona (residente o familiar) con teléfono
    const p = (h.parientes || []).find(x => x.vivo !== false && (x.tels || []).length);
    if (!p) return;
    const [first, ...resto] = String(p.nombre).trim().split(/\s+/);
    r.heredero = { antes: `${r.first} ${r.last}`.trim(), rel: p.relEs || p.rel, relEn: p.rel || p.relEs, edad: p.edad || '', dom: p.dom || '' };
    r.first = first; r.last = resto.join(' ');
    r.phones = [...new Set([...p.tels.map(t => t.num), ...r.phones])]; // primero los del familiar; los de la casa quedan después
    if (r.status === 'excluded' && /Sin teléfono|Solo números DNC|Sin nombre/.test(r.reason)) { r.status = 'ok'; r.reason = ''; }
  }

  // ---------- proceso ----------
  function run() {
    const has = S.rows.length && S.map;
    ['cRes','cExp'].forEach(id => $(id).classList.toggle('hidden', !has));
    steps(has);
    if (!has) { chrome.storage.local.set({ loftyListos: 0 }); return; }
    S.records = Core.processRows(S.rows, S.map, {
      excludeEntities: $('oEnt').checked, requirePhone: $('oPhone').checked, dropDnc: $('oDnc').checked,
      onlyCA: $('oCA').checked, cities: (() => { const c = $('cities').value.split(',').map(x => x.trim()).filter(Boolean); return c.length ? [...c, ...Object.values(hecmMap).map(h => h.ciudad)] : c; })(), /* las HECM de Heri traen su propia zona */ useHistory: $('oHist').checked,
      history: S.history, lofty: S.lofty
    });
    const maxP = Math.max(1, Math.min(10, +$('maxP').value || 10));
    S.records.forEach(aHeredero); // HECM con dueño fallecido: el lead va a nombre del familiar vivo
    S.records.forEach(r => { if (r.phones.length > maxP) r.phones = r.phones.slice(0, maxP); });
    contarHecm();
    renderResults();
  }
  function steps(has) {
    $('s1').className = 'step ' + (has ? 'done' : 'on');
    ['s2','s3','s4'].forEach(id => $(id).className = 'step ' + (has ? 'on' : ''));
  }

  function renderResults() {
    const R = S.records, ok = R.filter(r => r.status === 'ok');
    const reasons = {};
    R.filter(r => r.status !== 'ok').forEach(r => { const k = r.reason.startsWith('Ya exportado') ? 'Ya exportado antes' : r.reason; reasons[k] = (reasons[k] || 0) + 1; });
    const phones = ok.reduce((a, r) => a + r.phones.length, 0), dnc = R.reduce((a, r) => a + r.dncDropped, 0);
    $('stats').innerHTML =
      stat(R.length, 'Filas leídas') + stat(ok.length, 'Listos para Lofty', 'ok') + stat(phones, 'Teléfonos') +
      (dnc ? stat(dnc, 'Números DNC quitados') : '') +
      Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => stat(n, k)).join('');
    const tabs = [['ok', `Listos (${ok.length})`], ['ex', `Excluidos (${R.length - ok.length})`]];
    $('tabs').innerHTML = `<div class="seg">${tabs.map(([k, l]) => `<button data-t="${k}" class="${S.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => { S.tab = b.dataset.t; renderResults(); });
    const list = S.tab === 'ok' ? ok : R.filter(r => r.status !== 'ok');
    const LIM = 300;
    $('tbl').innerHTML = `<tr><th>Estado</th><th>Nombre</th><th>Teléfonos</th><th>Emails</th><th>Dirección</th></tr>` +
      list.slice(0, LIM).map(r => `<tr><td>${r.status === 'ok' ? `<span class="badge ok">OK${r.merged ? ' · unido ×' + (r.merged + 1) : ''}</span>` : `<span class="badge">${esc(r.reason)}</span>`}</td>
        <td>${esc((r.first + ' ' + r.last).trim()) || '<span class="muted">—</span>'}</td>
        <td class="ph">${r.phones.map(Core.fmtPhone).join('<br>') || '<span class="muted">—</span>'}</td>
        <td>${r.emails.map(esc).join('<br>') || '<span class="muted">—</span>'}</td>
        <td>${esc(Core.fullAddress(r))}${hecmDe(r) ? ` <span class="badge" style="background:#fef3c7;color:#92400e" title="${esc(hecmDe(r).lender)}">HECM · espera tu OK</span>` : ''}</td></tr>`).join('');
    $('more').textContent = list.length > LIM ? `Mostrando ${LIM} de ${list.length}. El CSV incluye todos.` : '';
    $('expInfo').textContent = ok.length ? `${ok.length} leads · columnas: First Name${$('oLast').checked ? ', Last Name' : ''}, Phone…, Email…, Property Address, TAG 1 (${tag1()}), TAG 2 (ciudad)${extraTags().map((t, i) => `, TAG ${i + 3} (${t})`).join('')}` : 'No hay leads listos con estos filtros.';
    $('dl').disabled = $('cp').disabled = $('send').disabled = !ok.length;
    if (!sending) { const left = ok.filter(r => !r.sent).length; $('send').textContent = left && left < ok.length ? `Enviar a Lofty (${left} pendientes)` : 'Enviar a Lofty'; }
    // "Listos" = los que todavía no se han subido ni exportado
    chrome.storage.local.set({ loftyListos: ok.filter(r => !r.sent && !S.history[r.key]).length });
    programarAuto();
  }
  const stat = (n, l, c = '') => `<div class="stat ${c}"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`;

  // ---------- exportar ----------
  function csv() { return Core.buildCsv(S.records, { includeLast: $('oLast').checked, tag1: tag1(), extraTags: extraTags(), maxPhones: +$('maxP').value || 10 }); }
  function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function afterExport(how) {
    const ok = S.records.filter(r => r.status === 'ok');
    if ($('oSave').checked) { const d = today(); ok.forEach(r => S.history[r.key] = d); store.set('pw2l_hist', S.history); renderFiles(); }
    msg(`${how} ${ok.length} leads.` + ($('oSave').checked ? ' Guardados en el historial.' : ''), 'ok');
    if ($('oSave').checked) run();
  }
  $('dl').onclick = async () => {
    const name = `lofty_${S.src === 'geo' ? 'geofarming' : 'propwire'}_${today()}.csv`;
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff' + csv()], { type: 'text/csv;charset=utf-8' }));
      a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      afterExport('Descargados');
    } catch (e) { msg('No se pudo descargar. Usa "Copiar CSV".', 'bad'); }
  };
  $('cp').onclick = async () => {
    const text = csv();
    try { await navigator.clipboard.writeText(text); afterExport('Copiados'); }
    catch { const ta = $('ta'); ta.value = text; ta.select(); try { document.execCommand('copy'); afterExport('Copiados'); } catch { msg('No se pudo copiar.', 'bad'); } }
  };
  $('histClear').onclick = () => {
    if ($('histClear').dataset.c !== '1') { $('histClear').dataset.c = '1'; $('histClear').textContent = '¿Seguro? Clic otra vez'; setTimeout(() => { $('histClear').dataset.c = ''; $('histClear').textContent = 'Borrar historial'; }, 3000); return; }
    S.history = {}; store.set('pw2l_hist', {}); $('histClear').dataset.c = ''; $('histClear').textContent = 'Borrar historial'; renderFiles(); run();
  };
  $('check').querySelectorAll('li').forEach(li => li.onclick = () => li.classList.toggle('on'));
  function msg(t, c) { $('msg').textContent = t; $('msg').className = 'msg ' + c; if (window.svLog) svLog(t, c === 'bad' ? 'error' : undefined); }
  function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }


  // ---------- envío directo a Lofty (API de Lofty) ----------
  // Docs: https://developer.lofty.com — Authorization: "token <API key>"
  const API = 'https://api.lofty.com/v1.0';
  let sending = false, stopReq = false, membersLoaded = false;
  const smsg = (t, c = '') => { $('smsg').textContent = t; $('smsg').className = 'msg ' + c; if (t && window.svLog) svLog('Lofty: ' + t, c === 'bad' ? 'error' : undefined); };

  async function lofty(path, opts = {}) {
    const { loftyKey } = await chrome.storage.local.get('loftyKey');
    if (!loftyKey) throw Object.assign(new Error('Falta la API key de Lofty.'), { fatal: true });
    let r;
    try {
      r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', 'Authorization': 'token ' + loftyKey, 'X-Error-Status': 'true', ...(opts.headers || {}) } });
    } catch (e) { throw Object.assign(new Error('Sin conexión con Lofty.'), { red: true }); }
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Lofty rechazó la API key (¿expiró o no tiene permiso?).'), { fatal: true });
    if (r.status === 429) throw Object.assign(new Error('Lofty pidió ir más lento.'), { lento: true });
    if (!r.ok || (data && data.code && data.code !== 0 && !data.leadId)) throw new Error((data && data.message) || `HTTP ${r.status}`);
    return data;
  }

  // Lista de agentes para "Asignar a" (si la API no la da, se queda Daniel)
  async function loadMembers() {
    if (membersLoaded) return;
    membersLoaded = true;
    try {
      const d = await lofty('/members?limit=100');
      const ms = (Array.isArray(d) ? d : d.members || d.data || d.list || []).filter(m => m && (m.userId || m.memberUserId || m.id));
      if (!ms.length) return;
      const idOf = m => String(m.userId || m.memberUserId || m.id);
      const cur = store.get('pw2l_agent', '') || $('agent').value;
      $('agent').innerHTML = ms.map(m => `<option value="${esc(idOf(m))}">${esc(((m.firstName || '') + ' ' + (m.lastName || '')).trim() || m.name || m.email || idOf(m))}</option>`).join('');
      $('agent').value = ms.some(m => idOf(m) === cur) ? cur : idOf(ms.find(m => /daniel/i.test(m.firstName || m.name || '')) || ms[0]);
    } catch (e) { if (e.fatal) { membersLoaded = false; throw e; } }
  }
  $('agent').onchange = () => store.set('pw2l_agent', $('agent').value);

  // Nota para los HECM: aviso, documentos del registro y si el contacto parece heredero
  // ---------- Notas en Lofty: TODO en inglés ----------
  // Heri guarda algunos textos en español (motivo de Celink, parentesco, avisos): aquí se pasan a inglés.
  function celinkEn(h) {
    const m = String(h.celinkMotivo || '');
    let x;
    if (/aparece en el registro/i.test(m)) return 'Compu-Link/Celink appears in the county records';
    if ((x = m.match(/pas[oó] a HUD \(([^)]+)\)/i))) return `assigned to HUD (${x[1]}): Celink services HUD's HECM loans`;
    if ((x = m.match(/lender (.+?): Celink/i))) return `lender ${x[1]}: its loans are serviced by Celink (probable)`;
    if (/sin confirmar/i.test(m) || !m) return h.celink ? 'Celink/Compu-Link' : 'servicer not confirmed';
    return h.celink ? 'Celink/Compu-Link' : 'servicer not confirmed';
  }
  const relEn = (r) => {
    const t = String(r || '');
    if (/^(Hijo|Hija)/i.test(t)) return 'Child'; if (/^Nieto/i.test(t)) return 'Grandchild'; if (/^Hermano/i.test(t)) return 'Sibling';
    if (/^C[oó]nyuge/i.test(t)) return /viudez/i.test(t) ? 'Spouse (widowed)' : 'Spouse'; if (/^Padre|^Madre/i.test(t)) return 'Parent';
    if (/^Otro familiar/i.test(t)) return 'Other relative';
    return t.replace(/\s*-\s*Widowed/i, ' (widowed)');
  };
  // Probate / succession: what Heri found for free in the county recorder
  function notaProbate(h) {
    const p = h.probate;
    const fuera = h.fallecido || (p && (p.docs.length || p.estado));
    const out = [];
    if (p && p.docs.length) out.push('Probate / succession documents in the county recorder: ' + p.docs.slice(0, 4).map(d => `${d.ty} ${d.dt}${d.partes.length ? ` (${d.partes.join(', ')})` : ''}`).join(' · '));
    if (p && p.representantes.length) out.push(`Possible administrator / successor (likely the one who can sign the sale): ${p.representantes.join(', ')}`);
    if (p && p.familia.length) out.push(`Relatives in the recorder (same last name, signed documents with the owner): ${p.familia.join(', ')}`);
    if (p && p.estado) out.push('The recorder already indexes the owner as "ESTATE OF" (estate opened).');
    if (fuera && !(p && p.abierto)) out.push(`Next step: check the OC Superior Court for a probate case (occourts.org → Case Name Search, paid) under the name: ${h.dueno}.`);
    return out;
  }

  // Relatives of the deceased owner (BeenVerified): who to call, in the order the boss asked
  function notaParientes(h) {
    const bonito = (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    const ps = (h.parientes || []);
    if (!ps.length) return h.parientesNota ? ['Relatives: BeenVerified shows no relatives for the owner; check the people living at the property and the obituary.'] : [];
    const out = ['RELATIVES TO CALL (BeenVerified, in order: spouse → children oldest first → siblings):'];
    ps.forEach((p, i) => out.push(`${i + 1}. ${p.nombre} · ${relEn(p.rel || p.relEs)}${p.edad ? `, age ${p.edad}` : ''}${p.vivo === false ? ' · DECEASED' : ''}` +
      `${p.dom ? ` · ${p.vivo === false ? 'last address' : 'lives at'} ${p.dom}` : p.ciudad ? ` · ${p.ciudad}` : ''}${p.tels && p.tels.length ? ` · ${p.tels.map(t => `${bonito(t.num)}${t.tipo ? ' ' + t.tipo : ''}`).join(', ')}` : ' · no phone'}`));
    const resto = (h.parientesResto || []).slice(0, 5);
    if (resto.length) out.push(`Other relatives (report not opened): ${resto.map(p => `${p.nombre} (${relEn(p.rel || p.relEs)}${p.edad ? ', ' + p.edad : ''})`).join(', ')}`);
    return out;
  }

  function notaHecm(r, h) {
    const ap = (t) => String(t || '').toUpperCase().replace(/[^A-Z ]/g, ' ').trim().split(/\s+/)[0] || '';
    const duenoAp = ap(h.dueno);
    const contacto = [r.first, r.last].filter(Boolean).join(' ');
    const ctAp = String(r.last || '').toUpperCase().replace(/[^A-Z]/g, '');
    const nomDueno = String(h.dueno || '').toUpperCase().split(/\s+/).slice(1).join(' ');
    const relacion = !h.dueno ? 'no owner data'
      : ctAp && ctAp === duenoAp && nomDueno && String(r.first || '').toUpperCase().startsWith(nomDueno.split(' ')[0]) ? 'same person as the owner of record'
      : ctAp && ctAp === duenoAp ? 'same last name as the owner: possible heir / relative'
      : 'different last name: confirm relationship (could be an heir by marriage or the executor)';
    return [
      h.preNod ? 'HECM (reverse mortgage) · owner deceased, before foreclosure · Heri' : 'HECM (reverse mortgage) in foreclosure · Heri',
      `Owner of record: ${h.dueno || '—'}${h.fallecido ? ` · shows as DECEASED (${h.fallecidoBV === false && h.fallecidoPor ? 'county records: ' + h.fallecidoPor : 'BeenVerified'})` : ''}`,
      h.domConfirmado ? 'Address confirmed: the home was transferred on the same day the HECM was recorded' : '',
      `Lender/servicer: ${h.lender || '—'} · ${celinkEn(h)}`,
      h.preNod ? `NO FORECLOSURE FILED YET: the owner's death was recorded (${h.muerte}); the HECM is now due and the heirs must sell or pay it off. Reach them before the Notice of Default.` : '',
      h.avisoOtro ? 'WARNING: the foreclosure is for ANOTHER loan (not the reverse mortgage); Celink is not the foreclosing servicer.' : '',
      h.nod ? `Notice of Default: ${h.nod}` : '',
      h.nts ? `Notice of Trustee Sale: ${h.nts}` : '',
      h.subst && h.subst.length ? `Substitution of Trustee: ${h.subst.join(', ')}` : '',
      h.origen ? `HECM recorded since: ${h.origen}` : '',
      h.asignadaHud ? `Assigned to HUD: ${h.asignadaHud}` : '',
      h.monto ? `Amount in default: ${h.monto}` : '',
      h.subasta ? `Auction date: ${h.subasta}` : '',
      r.heredero ? `LEAD IS IN THE NAME OF: ${contacto} · ${relEn(r.heredero.relEn || r.heredero.rel)}${r.heredero.edad ? `, age ${r.heredero.edad}` : ''}${r.heredero.dom ? ` · lives at ${r.heredero.dom}` : ''} (the owner is deceased; the list had “${r.heredero.antes}”)`
        : `Contact: ${contacto || '—'} · ${relacion}`,
      ...notaProbate(h),
      ...notaParientes(h),
    ].filter(Boolean).join('\n');
  }

  function leadBody(r) {
    const h = hecmDe(r);
    const esPw = pwKeys.has(claveDir(r.street, r.city));
    const tags = [esPw ? 'propwire' : tag1(), (r.city || '').toLowerCase(), ...extraTags(), ...(h ? ['preforeclosure', ...(h.celink ? ['celink'] : [])] : [])].filter(Boolean).map(t => t.slice(0, 64));
    const body = {
      firstName: r.first.slice(0, 30),
      phones: r.phones.map(p => '+1' + p),
      emails: r.emails,
      leadTypes: [1],                       // Seller
      source: esPw ? 'propwire' : tag1(),
      tags: [...new Set(tags)],
      assignedUserId: Number($('agent').value),
      ownershipScope: 'TEAM',               // Company
      cannotCall: false, cannotText: false, cannotEmail: false,
      welcomeEmail: false, leadAlert: $('oAlert').checked,
      property: { streetAddress: r.street, city: r.city, state: r.state || 'CA', zipCode: r.zip }
    };
    if ($('oLast').checked && r.last) body.lastName = r.last.slice(0, 30);
    if (!body.property.zipCode) delete body.property.zipCode;
    return body;
  }

  // ¿Ya existe en Lofty? Busca por teléfono (los primeros 3)
  async function existsInLofty(r) {
    // los 3 teléfonos a la vez (antes uno tras otro)
    const res = await Promise.all(r.phones.slice(0, 3).map(p => existsPhone(p)));
    return res.some(Boolean);
  }
  async function existsPhone(p) {
    {
      let d;
      for (let i = 0; ; i++) {
        try { d = await lofty('/leads?limit=1&phone=' + encodeURIComponent(p)); break; }
        catch (e) {
          if (e.lento && i < 4) { await new Promise(z => setTimeout(z, 2000 * 2 ** i)); continue; } // Lofty pidió ir más lento
          if (e.fatal || e.red || e.lento) throw e;
          throw Object.assign(new Error(`No pude revisar duplicados en Lofty (${e.message}). Si quieres enviar sin revisar, apaga "Saltar si el teléfono ya está en Lofty".`), { fatal: true });
        }
      }
      const list = d.leads || d.data || d.list || (Array.isArray(d) ? d : []);
      const total = (d._metadata && d._metadata.total) || d.total || 0;
      if ((Array.isArray(list) && list.length) || total > 0) return true;
    }
    return false;
  }

  function logLine(r, cls, txt) {
    $('log').classList.remove('hidden');
    const d = document.createElement('div');
    d.innerHTML = `<span>${esc(r.first + ' ' + r.last)} · <span class="muted">${esc(r.street)}, ${esc(r.city)}</span></span><span class="${cls}">${esc(txt)}</span>`;
    $('log').prepend(d);
  }

  $('send').onclick = async () => {
    if (sending) return;
    const pend = S.records.filter(r => r.status === 'ok' && !r.sent);
    if (!pend.length) { smsg('No hay leads pendientes de enviar.', 'bad'); return; }
    smsg('Conectando con Lofty…');
    try { await loadMembers(); } catch (e) { smsg(e.message + ' Pégala en "API key de Lofty".', 'bad'); $('lfKey').focus(); return; }
    smsg('');
    const agentName = $('agent').selectedOptions[0].textContent;
    $('confirm').classList.remove('hidden');
    const nH = pend.filter(r => hecmDe(r)).length;
    $('confirm').innerHTML = `Vas a crear <b>${pend.length}</b> leads en Lofty como <b>Seller</b>, asignados a <b>${esc(agentName)}</b>, con tags <b>${esc([tag1(), 'ciudad', ...extraTags()].join(', '))}</b> y llamada/texto/email permitidos.${nH ? ` <b>${nH}</b> son HECM de Heri (herederos): llevan además los tags <b>preforeclosure</b> y <b>celink</b> y una nota con los documentos del registro.` : ''}${(() => { const nPw = pend.filter(r => pwKeys.has(claveDir(r.street, r.city))).length; return nPw ? ` <b>${nPw}</b> vienen de Wibi (Propwire): llevan el tag <b>propwire</b> en vez de “${esc(tag1())}”.` : ''; })()}${$('oChk').checked ? ' Los que ya tengan su teléfono en Lofty se saltan.' : ''}
      <div class="row" style="margin-top:10px"><button class="btn sm" id="go">Sí, crear ${pend.length}</button><button class="btn ghost sm" id="test">Solo 1 de prueba</button><button class="btn ghost sm" id="cancel">Cancelar</button></div>`;
    $('cancel').onclick = () => $('confirm').classList.add('hidden');
    $('go').onclick = () => runSend(pend);
    $('test').onclick = () => runSend(pend.slice(0, 1));
  };
  $('stop').onclick = () => { stopReq = true; $('stop').textContent = 'Deteniendo…'; };

  // ---------- Subida automática: conforme Owny entrega, Lofti sube (sin confirmación) ----------
  let autoTimer = null;
  function programarAuto() {
    if (!$('oAuto').checked || sending) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(async () => {          // espera 2 s para juntar a los que llegan seguidos
      if (!$('oAuto').checked || sending) return;
      // los HECM esperan tu OK · Fase 1: lo que ya falló (error o sin respuesta) NO se reintenta solo (antes se reenviaba sin fin)
      const pend = S.records.filter(r => r.status === 'ok' && !r.sent && !S.history[r.key] && !hecmDe(r) && !fallidos[r.key]);
      if (!pend.length) return;
      try { await loadMembers(); }
      catch (e) { apagarAuto('Apagué la subida automática: ' + e.message + ' Pégala en "API key de Lofty".'); return; }
      smsg(`Subiendo solos ${pend.length} lead(s) a Lofty…`);
      runSend(pend);
    }, 2000);
  }
  function apagarAuto(motivo) {
    $('oAuto').checked = false; chrome.storage.local.set({ loftyAuto: false });
    smsg(motivo, 'bad');
  }
  $('oAuto').onchange = () => { chrome.storage.local.set({ loftyAuto: $('oAuto').checked }); programarAuto(); };
  // Fase 1: la subida automática viene APAGADA salvo que tú la hayas prendido
  let fallidos = {}; // { claveDelDomicilio: { n, t, motivo } } — los que fallaron no se reintentan en automático
  const marcarFallido = (r, motivo) => { fallidos[r.key] = { n: ((fallidos[r.key] || {}).n || 0) + 1, t: Date.now(), motivo: String(motivo || '').slice(0, 120) }; chrome.storage.local.set({ loftyFallidos: fallidos }); };
  chrome.storage.local.get(['loftyAuto', 'loftyFallidos']).then(({ loftyAuto, loftyFallidos = {} }) => { fallidos = loftyFallidos; $('oAuto').checked = loftyAuto === true; programarAuto(); });

  async function runSend(list) {
    $('confirm').classList.add('hidden');
    sending = true; stopReq = false;
    $('send').disabled = true; $('stop').classList.remove('hidden'); $('stop').textContent = 'Detener';
    $('prog').classList.remove('hidden');
    let ok = 0, skip = 0, err = 0, unsure = 0, i = 0, hechos = 0, fatal = null;
    const bar = $('prog').firstElementChild, d = today();
    // 3 a la vez: cada "trabajador" toma el siguiente lead de la lista
    const trabajador = async () => { while (!stopReq && !fatal && i < list.length) { const r = list[i++]; await subirUno(r); } };
    const subirUno = async (r) => {
      try {
        if ($('oChk').checked && await existsInLofty(r)) {
          r.sent = true; skip++; logLine(r, 's-skip', 'Ya estaba en Lofty');
          S.history[r.key] = d;
        } else {
          let res;
          try { res = await lofty('/leads', { method: 'POST', body: JSON.stringify(leadBody(r)) }); }
          catch (e) { if (!e.lento) throw e; await new Promise(z => setTimeout(z, 5000)); res = await lofty('/leads', { method: 'POST', body: JSON.stringify(leadBody(r)) }); }
          r.sent = true; ok++; S.history[r.key] = d; if (fallidos[r.key]) { delete fallidos[r.key]; chrome.storage.local.set({ loftyFallidos: fallidos }); }
          logLine(r, 's-ok', res.leadId ? 'Creado · ' + res.leadId : 'Creado');
          const hh = hecmDe(r);
          if (hh && res.leadId) { // nota con los datos del registro para los HECM de Heri
            try { await lofty('/notes', { method: 'POST', body: JSON.stringify({ leadId: res.leadId, content: notaHecm(r, hh) }) }); }
            catch (e) { logLine(r, 's-err', 'Lead creado, pero la nota HECM falló: ' + String(e.message || '').slice(0, 60)); }
          }
        }
      } catch (e) {
        if (e.fatal) { fatal = fatal || e.message; return; }
        if (e.red) { unsure++; r.sent = true; marcarFallido(r, 'sin respuesta (pudo haberse creado)'); logLine(r, 's-err', 'Sin respuesta · revisa en Lofty'); }
        else { err++; marcarFallido(r, e.message); logLine(r, 's-err', 'Error: ' + String(e.message || 'desconocido').slice(0, 80)); }
      }
      hechos++; $('sendInfo').textContent = `${hechos} / ${list.length}`;
      bar.style.width = (hechos / list.length * 100) + '%';
      store.set('pw2l_hist', S.history);
      await new Promise(z => setTimeout(z, 150));
    };
    await Promise.all([trabajador(), trabajador(), trabajador()]);
    sending = false; $('send').disabled = false; $('stop').classList.add('hidden'); $('sendInfo').textContent = '';
    renderFiles();
    const parts = [`${ok} creados`]; if (skip) parts.push(`${skip} ya estaban`); if (err) parts.push(`${err} con error`); if (unsure) parts.push(`${unsure} sin respuesta (revísalos en Lofty)`);
    if (ok) chrome.storage.local.get('loftySubidos').then(({ loftySubidos = 0 }) => chrome.storage.local.set({ loftySubidos: loftySubidos + ok }));
    if (fatal && $('oAuto').checked) apagarAuto('Apagué la subida automática: ' + fatal);
    else if (fatal) smsg(fatal + ' · ' + parts.join(' · '), 'bad');
    else smsg((stopReq ? 'Detenido. ' : 'Enviados a Lofty: ') + parts.join(' · '), err || unsure ? 'bad' : 'ok');
    run();
  }

  // API key de Lofty: se guarda solo en este Chrome
  chrome.storage.local.get('loftyKey').then(({ loftyKey }) => { if (loftyKey) $('lfKey').value = '••••••••••••'; });
  $('lfKey').onchange = () => {
    const v = $('lfKey').value.trim();
    if (v.startsWith('•')) return;
    chrome.storage.local.set({ loftyKey: v });
    membersLoaded = false;
    $('lfKey').value = v ? '••••••••••••' : '';
    smsg(v ? 'Guardé la API key de Lofty.' : 'Quité la API key de Lofty.', 'ok');
    if (v) loadMembers().catch(e => smsg(e.message, 'bad'));
  };
  { const g = store.get('pw2l_agent', ''); if (g && [...$('agent').options].some(o => o.value === g)) $('agent').value = g; }

  // ---------- demo ----------
  $('demo').onclick = () => {
    const demo = `Address,City,State,Zip,Owner 1 First Name,Owner 1 Last Name,Owner Type,Phone 1,Phone 1 DNC,Phone 2,Phone 2 DNC,Email 1
12 SANDPIPER LN,IRVINE,CA,92618,JOHN,SMITH,Individual,949-555-1234,No,(714) 555-9876,Yes,JOHN@GMAIL.COM
12 Sandpiper Lane,Irvine,CA,92618,JOHN,SMITH,Individual,1-949-555-0000,No,,,
5 OAK AVE,IRVINE,CA,92620,OAK HOLDINGS,LLC,Company,9495551111,No,,,
9 PINE DR,IRVINE,CA,92612,ANA,LOPEZ,Individual,7145553333,Yes,,,
44 BAY ST,IRVINE,CA,92612,LUIS,GARCIA,Individual,,,,,
3 SUN CT,IRVINE,CA,92612,PEDRO,PEREZ,Individual,9495557777,No,9495558888,No,pedro@yahoo.com
21 VISTA DEL MAR,TUSTIN,CA,92780,MARIA,TORRES,Individual,7145550101,No,,,`;
    S.pwFiles = [{ name: 'ejemplo_propwire.csv', rows: Papa.parse(demo, { header: true, skipEmptyLines: true }).data }];
    rebuildRows();
  };

  $('oOw').checked = store.get('pw2l_useOwners', true);
  $('oOw').onchange = () => { store.set('pw2l_useOwners', $('oOw').checked); rebuildRows(); };
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.lote || ch.lote_wb || ch.lote_hr || ch.lote_wb_hr)) loadOwners(); if (area === 'local' && ch.addresses) cargarHecm(); });
  renderFiles(); setSrc(S.src); loadOwners();
})();
