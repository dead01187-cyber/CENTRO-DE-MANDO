// ===== Lógica pura: Propwire -> Lofty =====
var Core = (() => {
  const ENTITY_RE = /\b(L\.?L\.?C\.?|L\.?L\.?P|L\.?P\.?|INC\.?|INCORPORATED|CORP\.?|CORPORATION|COMPANY|CO\.|LTD|LIMITED|TRUSTS?|TRUSTEES?|TR|TRS|TTEES?|ESTATE|BANK|ASSN|ASSOCIATION|CHURCH|MINISTRIES|HOLDINGS?|PROPERT(?:Y|IES)|INVESTMENTS?|PARTNERS(?:HIP)?|FOUNDATION|COUNTY|CITY OF|STATE OF|UNIVERSITY|SCHOOL|DISTRICT|GROUP|VENTURES?|CAPITAL|REALTY|MANAGEMENT|MGMT|DEVELOPMENT|FUND|HOA|ENTERPRISES?|SERVICES|SOLUTIONS|REVOCABLE|IRREVOCABLE|LIVING|FAMILY|SURVIVORS?|AUTHORITY|AGENCY|FEDERAL|NATIONAL|MORTGAGE|LENDING|FINANCIAL|INVESTORS?|RENTALS?|ACQUISITIONS?)(?![A-Za-z0-9])/i;

  const SUFFIX = { street:'st', st:'st', avenue:'ave', ave:'ave', av:'ave', boulevard:'blvd', blvd:'blvd', drive:'dr', dr:'dr', road:'rd', rd:'rd', lane:'ln', ln:'ln', court:'ct', ct:'ct', circle:'cir', cir:'cir', place:'pl', pl:'pl', terrace:'ter', ter:'ter', way:'way', parkway:'pkwy', pkwy:'pkwy', highway:'hwy', hwy:'hwy', trail:'trl', trl:'trl', square:'sq', north:'n', south:'s', east:'e', west:'w', northeast:'ne', northwest:'nw', southeast:'se', southwest:'sw', apartment:'unit', apt:'unit', suite:'unit', ste:'unit', unit:'unit', '#':'unit' };

  const norm = s => String(s ?? '').trim();
  const low = s => norm(s).toLowerCase();

  // ---------- detección de columnas ----------
  function pick(headers, inc, exc, prefer) {
    let best = '', score = -1;
    headers.forEach((h, i) => {
      const l = h.toLowerCase();
      if (!inc.test(l) || (exc && exc.test(l))) return;
      let s = 100 - i * 0.01;
      if (prefer && prefer.test(l)) s += 50;
      if (s > score) { score = s; best = h; }
    });
    return best;
  }
  function detect(headers) {
    const notMail = /mail(ing)?|tax|billing/;
    const m = {
      firstName: pick(headers, /first\s*_?name|^first$/, /mail|agent|contact 2|owner 2|owner2/, /owner\s*1|owner/),
      lastName: pick(headers, /last\s*_?name|^last$/, /mail|agent|contact 2|owner 2|owner2/, /owner\s*1|owner/),
      ownerName: pick(headers, /owner.*name|^owner\s*1?$|^name$|full\s*name/, /first|last|mail|owner 2|owner2/, /owner\s*1/),
      address: pick(headers, /address|street|situs/, /mail|owner|e-?mail|city|state|zip|unit|2$/, /property|situs|site|^address$/),
      city: pick(headers, /city/, notMail, /property|situs/),
      state: pick(headers, /^state$|property\s*state|situs\s*state|^st$/, notMail),
      zip: pick(headers, /zip|postal/, notMail, /property|situs/),
      ownerType: pick(headers, /owner\s*type|ownership\s*type|entity\s*type|corporate/, null),
      phones: headers.filter(h => /phone|mobile|cell|wireless|landline/i.test(h) && !/type|dnc|do not call|status|carrier|score|litigator|count|verified|connected|line/i.test(h)),
      emails: headers.filter(h => /e-?mail/i.test(h) && !/type|status|valid|count|opt/i.test(h)),
      dnc: headers.filter(h => /dnc|do not call/i.test(h)),
    };
    return m;
  }

  // ---------- normalización ----------
  function titleCase(s) {
    return low(s).replace(/\s+/g, ' ').split(' ').map(w => {
      if (!w) return w;
      if (/\d/.test(w) || /^(n|s|e|w|ne|nw|se|sw|po)$/.test(w)) return w.toUpperCase();
      return w.replace(/(^|[-'])([a-z])/g, (_, p, c) => p + c.toUpperCase());
    }).join(' ');
  }
  function nameCase(s) {
    const t = titleCase(s);
    return t.replace(/\bMc([a-z])/g, (_, c) => 'Mc' + c.toUpperCase());
  }
  function firstPerson(full) {
    // "JOHN A SMITH & MARY SMITH" -> "JOHN A SMITH"
    return norm(full).split(/\s+(?:&|and)\s+|\s*\/\s*|;/i)[0];
  }
  function splitPhones(v) {
    return norm(v).split(/[,;|\n]+/).map(x => x.trim()).filter(Boolean);
  }
  function cleanPhone(raw) {
    if (/dnc/i.test(raw)) return { dnc: true, num: digits10(raw) };
    return { dnc: false, num: digits10(raw) };
  }
  function digits10(raw) {
    let d = String(raw).replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    return d.length === 10 && !/^[01]/.test(d) ? d : '';
  }
  const fmtPhone = d => `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  const truthy = v => /^(y|yes|true|1|dnc|x|do not call)$/i.test(norm(v));
  const validEmail = e => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e);

  function streetKey(street) {
    return low(street).replace(/[.,]/g, ' ').replace(/#/g, ' # ').split(/\s+/).filter(Boolean)
      .map(w => SUFFIX[w] || w).join(' ').replace(/\bunit\s+/g, 'unit');
  }
  function addrKey(street, city) {
    const s = streetKey(street);
    return s ? s + '|' + low(city).replace(/[^a-z ]/g, '').trim() : '';
  }
  // "123 Main St, Irvine, CA 92618" -> partes
  function parseFull(full) {
    const parts = norm(full).split(',').map(x => x.trim()).filter(Boolean);
    const out = { street: parts[0] || '', city: '', state: '', zip: '' };
    if (parts.length >= 3) { out.city = parts[1]; const m = parts.slice(2).join(' ').match(/([A-Za-z]{2})\s*(\d{5})?/); if (m) { out.state = m[1]; out.zip = m[2] || ''; } }
    else if (parts.length === 2) { const m = parts[1].match(/^(.*?)\s+([A-Za-z]{2})\s*(\d{5})?$/); if (m) { out.city = m[1]; out.state = m[2]; out.zip = m[3] || ''; } else out.city = parts[1]; }
    return out;
  }

  // Empareja "Phone 2" con "Phone 2 DNC"
  function dncColFor(phoneCol, dncCols) {
    const n = (phoneCol.match(/\d+/) || [''])[0];
    const base = low(phoneCol).replace(/\d+/g, '').replace(/[^a-z]/g, '');
    return dncCols.find(d => {
      const dn = (d.match(/\d+/) || [''])[0];
      return dn === n && (low(d).includes(base) || /dnc|do not call/i.test(d));
    }) || '';
  }

  // ---------- procesamiento ----------
  // opts: {excludeEntities, requirePhone, dropDnc, onlyCA, cities:[], useHistory, history:{}, lofty:{addr:Set, street:Set, phones:Set}}
  function processRows(rows, map, opts) {
    const records = [];
    const byKey = new Map();
    const cities = (opts.cities || []).map(c => low(c)).filter(Boolean);

    for (const row of rows) {
      const g = c => (c ? norm(row[c]) : '');
      let first = g(map.firstName), last = g(map.lastName);
      const ownerFull = g(map.ownerName);
      const ownerForCheck = [ownerFull, first, last].join(' ');
      if (!first && ownerFull) {
        const p = firstPerson(ownerFull).split(/\s+/);
        first = p[0] || ''; last = p.slice(1).join(' ');
      }
      first = nameCase(first.split(/\s+/)[0] || '');
      last = nameCase(firstPerson(last));

      let street = g(map.address), city = g(map.city), state = g(map.state), zip = g(map.zip);
      if (street.includes(',') && !city) { const p = parseFull(street); street = p.street; city = p.city; state = state || p.state; zip = zip || p.zip; }
      zip = (zip.match(/\d{5}/) || [''])[0];

      const rec = { first, last, street: titleCase(street), city: titleCase(city), state: (state || '').toUpperCase().replace('CALIFORNIA', 'CA'), zip, phones: [], emails: [], dncDropped: 0, status: 'ok', reason: '', merged: 0 };

      // teléfonos
      for (const pc of map.phones || []) {
        const dcol = dncColFor(pc, map.dnc || []);
        const colDnc = dcol && truthy(row[dcol]);
        for (const raw of splitPhones(row[pc])) {
          const { dnc, num } = cleanPhone(raw);
          if (!num) continue;
          if ((dnc || colDnc) && opts.dropDnc) { rec.dncDropped++; continue; }
          if (!rec.phones.includes(num)) rec.phones.push(num);
        }
      }
      for (const ec of map.emails || []) for (const raw of splitPhones(row[ec])) {
        const e = low(raw); if (validEmail(e) && !rec.emails.includes(e)) rec.emails.push(e);
      }

      const otype = g(map.ownerType);
      const isEntity = /company|corporat|trust|business|llc|entity|government|bank|estate/i.test(otype) && !/individual|person/i.test(otype) || ENTITY_RE.test(ownerForCheck);

      const set = (s, r) => { rec.status = s; rec.reason = r; };
      if (opts.excludeEntities && isEntity) set('excluded', 'Empresa / trust');
      else if (!rec.street) set('excluded', 'Sin dirección');
      else if (!rec.first) set('excluded', 'Sin nombre');
      else if (opts.onlyCA && rec.state && rec.state !== 'CA') set('excluded', 'Fuera de CA');
      else if (cities.length && !cities.includes(low(rec.city))) set('excluded', 'Fuera de zona');
      else if (opts.requirePhone && !rec.phones.length) set('excluded', rec.dncDropped ? 'Solo números DNC' : 'Sin teléfono');

      rec.key = addrKey(rec.street, rec.city);
      if (rec.status === 'ok') {
        const prev = byKey.get(rec.key);
        if (prev) {
          rec.phones.forEach(p => { if (!prev.phones.includes(p)) prev.phones.push(p); });
          rec.emails.forEach(e => { if (!prev.emails.includes(e)) prev.emails.push(e); });
          prev.merged++;
          set('excluded', 'Repetido en el lote (unido)');
        } else if (opts.useHistory && opts.history && opts.history[rec.key]) {
          set('excluded', 'Ya exportado el ' + opts.history[rec.key]);
        } else if (opts.lofty && (opts.lofty.addr.has(rec.key) || opts.lofty.street.has(streetKey(rec.street)))) {
          set('excluded', 'Ya existe en Lofty (dirección)');
        } else if (opts.lofty && rec.phones.some(p => opts.lofty.phones.has(p))) {
          set('excluded', 'Ya existe en Lofty (teléfono)');
        } else byKey.set(rec.key, rec);
      }
      records.push(rec);
    }
    return records;
  }

  // Índice de un export de Lofty
  function indexLofty(rows) {
    const idx = { addr: new Set(), street: new Set(), phones: new Set(), count: rows.length };
    if (!rows.length) return idx;
    const headers = Object.keys(rows[0]);
    const addrCols = headers.filter(h => /address|street/i.test(h) && !/mail|e-?mail/i.test(h));
    const cityCol = headers.find(h => /city/i.test(h) && !/mail/i.test(h));
    const phoneCols = headers.filter(h => /phone|mobile|cell/i.test(h) && !/type|status/i.test(h));
    for (const r of rows) {
      for (const ac of addrCols) {
        const v = norm(r[ac]); if (!v) continue;
        if (v.includes(',')) { const p = parseFull(v); idx.addr.add(addrKey(p.street, p.city)); if (!p.city) idx.street.add(streetKey(p.street)); }
        else if (cityCol && r[cityCol]) idx.addr.add(addrKey(v, r[cityCol]));
        else idx.street.add(streetKey(v));
      }
      for (const pc of phoneCols) for (const raw of splitPhones(r[pc])) { const d = digits10(raw); if (d) idx.phones.add(d); }
    }
    idx.street.delete('');
    return idx;
  }

  // ---------- CSV de salida ----------
  function csvCell(v) { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function buildCsv(records, cfg) {
    const ok = records.filter(r => r.status === 'ok');
    const maxP = Math.min(cfg.maxPhones || 10, Math.max(1, ...ok.map(r => r.phones.length)));
    const maxE = Math.min(cfg.maxEmails || 10, Math.max(1, ...ok.map(r => r.emails.length)));
    const head = ['First Name'];
    if (cfg.includeLast) head.push('Last Name');
    for (let i = 0; i < maxP; i++) head.push(i ? `Phone ${i + 1}` : 'Phone');
    for (let i = 0; i < maxE; i++) head.push(i ? `Email ${i + 1}` : 'Email');
    head.push('Property Address', 'TAG 1', 'TAG 2');
    const extra = (cfg.extraTags || []).filter(Boolean);
    extra.forEach((_, i) => head.push(`TAG ${i + 3}`));
    const lines = [head.map(csvCell).join(',')];
    for (const r of ok) {
      const row = [r.first];
      if (cfg.includeLast) row.push(r.last);
      for (let i = 0; i < maxP; i++) row.push(r.phones[i] ? fmtPhone(r.phones[i]) : '');
      for (let i = 0; i < maxE; i++) row.push(r.emails[i] || '');
      row.push(fullAddress(r), cfg.tag1, low(r.city), ...extra);
      lines.push(row.map(csvCell).join(','));
    }
    return lines.join('\r\n');
  }
  function fullAddress(r) {
    const tail = [r.state, r.zip].filter(Boolean).join(' ');
    return [r.street, r.city, tail].filter(Boolean).join(', ');
  }

  return { detect, processRows, indexLofty, buildCsv, fullAddress, fmtPhone, addrKey, streetKey, ENTITY_RE };
})();
if (typeof module !== 'undefined') module.exports = Core;

