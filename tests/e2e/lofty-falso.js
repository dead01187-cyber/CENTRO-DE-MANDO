// =====================================================================
// Lofty FALSO para pruebas (Fase 6). Contesta como la API de Lofty pero en
// memoria: nada sale a internet y no se manda ningún SMS real. Guarda cada
// llamada para que la prueba revise qué hizo la extensión.
// =====================================================================
module.exports = function loftyFalso({ leads = [], fallar = {}, textos = {}, pool = [] } = {}) {
  // textos: { leadId: [{ direction, textType, textTime, agentId, textContent }] }  ·  pool: leadIds que trabaja Anna
  const estado = { leads: JSON.parse(JSON.stringify(leads)), llamadas: [], sms: [], creados: [], notas: [], cambios: [], emails: [],
    textos: JSON.parse(JSON.stringify(textos)), pool: pool.map(String), muteados: new Set() };
  const json = (route, cuerpo, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(cuerpo) });
  async function atender(route) {
    const req = route.request(), url = new URL(req.url()), metodo = req.method(), ruta = url.pathname.replace(/^\/v[12]\.0/, "");
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    estado.llamadas.push({ metodo, ruta, query: Object.fromEntries(url.searchParams), body });
    const falla = fallar[`${metodo} ${ruta}`] || fallar[`${metodo} *`];
    if (falla) return json(route, { message: falla.mensaje || "falla simulada" }, falla.status || 500);
    if (metodo === "GET" && ruta === "/members") return json(route, { members: [{ userId: 1, firstName: "Agente", lastName: "Prueba" }] });
    if (metodo === "GET" && ruta === "/leads") {
      const tel = url.searchParams.get("phone"), etapa = url.searchParams.get("stage"), off = Number(url.searchParams.get("offset") || 0), lim = Number(url.searchParams.get("limit") || 100);
      let ls = estado.leads;
      if (tel) ls = ls.filter((l) => (l.phones || []).some((p) => String(p).replace(/\D/g, "").endsWith(tel.replace(/\D/g, "").slice(-10))));
      if (etapa) ls = ls.filter((l) => l.stage === etapa);
      return json(route, { leads: ls.slice(off, off + lim), _metadata: { total: ls.length } });
    }
    const m = ruta.match(/^\/leads\/(\d+)$/);
    if (m && metodo === "GET") { const l = estado.leads.find((x) => String(x.leadId) === m[1]); return l ? json(route, { lead: l }) : json(route, { message: "no existe" }, 404); }
    if (m && metodo === "PUT") { estado.cambios.push({ leadId: m[1], body }); const l = estado.leads.find((x) => String(x.leadId) === m[1]); if (l) Object.assign(l, body); return json(route, { code: 0 }); }
    if (metodo === "POST" && ruta === "/leads") { const leadId = 900 + estado.creados.length; estado.creados.push(body); return json(route, { leadId }); }
    if (metodo === "POST" && ruta === "/notes") { estado.notas.push(body); return json(route, { code: 0 }); }
    if (metodo === "POST" && ruta === "/message/sms/send") { estado.sms.push(body); return json(route, { code: 0 }); }
    if (metodo === "GET" && ruta === "/communication/text") return json(route, { texts: estado.textos[url.searchParams.get("leadId")] || [] });
    if (metodo === "GET" && ruta === "/communication/agent") // SMS que entraron (para Resi): todos los inbound con su leadId
      return json(route, { communications: Object.entries(estado.textos).flatMap(([leadId, ts]) => ts.filter((t) => /^in/i.test(t.direction)).map((t) => ({ ...t, leadId: Number(leadId) }))) });
    if (metodo === "GET" && /communication/.test(ruta)) return json(route, { texts: [], communications: [] });
    if (metodo === "POST" && ruta === "/message/email/send") { estado.emails.push(body); return json(route, { messageId: "m" + estado.emails.length }); }
    // Anna (AI Sales Agent)
    if (metodo === "GET" && ruta === "/working-leads") {
      const off = Number(url.searchParams.get("offset") || 0), lim = Number(url.searchParams.get("limit") || 20);
      const ws = estado.pool.map((id) => { const l = estado.leads.find((x) => String(x.leadId) === id) || {}; return { leadId: Number(id), firstName: l.firstName || "", lastName: l.lastName || "", phone: String((l.phones || [])[0] || ""), email: "" }; });
      return json(route, { workingLeads: ws.slice(off, off + lim), metadata: { total: ws.length } });
    }
    const mm = ruta.match(/^\/sales-agents\/working-lead\/(\d+)\/mute$/);
    if (mm && metodo === "PUT") { estado.muteados.add(mm[1]); return json(route, { success: true }); }
    if (metodo === "GET" && ruta === "/sales-agent/lead/mute-status") { const id = url.searchParams.get("leadId"); return json(route, { leadId: Number(id), muted: estado.muteados.has(id) }); }
    return json(route, { message: "ruta no simulada: " + metodo + " " + ruta }, 404);
  }
  return { estado, atender };
};
