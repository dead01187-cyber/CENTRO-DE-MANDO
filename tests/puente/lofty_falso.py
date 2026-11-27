# =====================================================================
# Lofty FALSO para probar a Rayo en el puente (Fase C). Servidor HTTP local con lo que usa Rayo:
#   GET  /v1.0/leads (limit, offset, phone)      GET /v1.0/communication/text?leadId=
#   GET  /v2.0/working-leads                      PUT /v2.0/sales-agents/working-lead/<id>/mute
#   GET  /v2.0/sales-agent/lead/mute-status       POST /v1.0/message/sms/send · /v1.0/message/email/send
# Solo acepta la llave "token <LLAVE>" de la config. Lo que se manda queda en .estado (y en un archivo si se pide).
# Uso suelto (para las pruebas de punta a punta):  python3 lofty_falso.py config.json puerto.txt estado.json
# =====================================================================
import http.server
import json
import sys
import threading
import urllib.parse


class Estado:
    def __init__(self, leads=(), textos=None, pool=(), llave="llave-texi", llaves=None):
        self.leads = list(leads)
        self.textos = dict(textos or {})
        self.pool = [str(x) for x in pool]
        self.muteados = set()
        self.sms, self.emails, self.pedidos = [], [], []
        self.llaves = set(llaves or [llave])
        self.lock = threading.Lock()

    def foto(self):
        with self.lock:
            return {"sms": list(self.sms), "emails": list(self.emails), "muteados": sorted(self.muteados), "pedidos": list(self.pedidos)}


def manejador(estado, archivo=None):
    class M(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _json(self, codigo, datos):
            b = json.dumps(datos).encode()
            self.send_response(codigo)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            if archivo:
                with open(archivo, "w") as f:
                    json.dump(estado.foto(), f)

        def _auth(self):
            a = self.headers.get("Authorization") or ""
            ok = a.startswith("token ") and a[6:] in estado.llaves
            if not ok:
                self._json(401, {"message": "invalid token"})
            return ok

        def _cuerpo(self):
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}") if n else {}

        def do_GET(self):
            u = urllib.parse.urlsplit(self.path)
            q = urllib.parse.parse_qs(u.query)
            with estado.lock:
                estado.pedidos.append(("GET", self.path))
            if not self._auth():
                return
            if u.path == "/v1.0/leads":
                ls = estado.leads
                if q.get("phone"):
                    tel = q["phone"][0]
                    ls = [l for l in ls if tel in [str(p).replace("-", "") for p in l.get("phones", [])]]
                off, lim = int((q.get("offset") or ["0"])[0]), int((q.get("limit") or ["50"])[0])
                return self._json(200, {"leads": ls[off:off + lim]})
            if u.path == "/v1.0/communication/text":
                return self._json(200, {"texts": estado.textos.get((q.get("leadId") or [""])[0], [])})
            if u.path == "/v2.0/working-leads":
                off = int((q.get("offset") or ["0"])[0])
                fil = [{"leadId": int(x), "firstName": "", "lastName": ""} for x in estado.pool][off:off + 100]
                return self._json(200, {"workingLeads": fil, "metadata": {"total": len(estado.pool)}})
            if u.path == "/v2.0/sales-agent/lead/mute-status":
                i = (q.get("leadId") or [""])[0]
                return self._json(200, {"leadId": i, "muted": i in estado.muteados})
            self._json(404, {"message": "no"})

        def do_PUT(self):
            with estado.lock:
                estado.pedidos.append(("PUT", self.path))
            if not self._auth():
                return
            p = self.path.split("?")[0].strip("/").split("/")
            if len(p) == 5 and p[:3] == ["v2.0", "sales-agents", "working-lead"] and p[4] == "mute":
                with estado.lock:
                    estado.muteados.add(p[3])
                return self._json(200, {"success": True})
            self._json(404, {"message": "no"})

        def do_POST(self):
            with estado.lock:
                estado.pedidos.append(("POST", self.path))
            if not self._auth():
                return
            b = self._cuerpo()
            if self.path == "/v1.0/message/sms/send":
                with estado.lock:
                    estado.sms.append(b)
                return self._json(200, {"code": 0})
            if self.path == "/v1.0/message/email/send":
                with estado.lock:
                    estado.emails.append(b)
                return self._json(200, {"messageId": "m%d" % len(estado.emails)})
            self._json(404, {"message": "no"})

    return M


def servir(estado, puerto=0, archivo=None):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", puerto), manejador(estado, archivo))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


if __name__ == "__main__":
    cfg = json.load(open(sys.argv[1]))
    e = Estado(cfg.get("leads", []), cfg.get("textos", {}), cfg.get("pool", []), llaves=cfg.get("llaves") or ["llave-texi"])
    s = servir(e, 0, sys.argv[3] if len(sys.argv) > 3 else None)
    with open(sys.argv[2], "w") as f:
        f.write(str(s.server_address[1]))
    threading.Event().wait()
