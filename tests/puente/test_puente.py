# =====================================================================
# Pruebas del puente de Navi (Fase 7). Sin red ni navegador: un "Brave" falso contesta /json/version
# y un "browser-use" falso hace como que corre la receta. Correr: python3 -m unittest discover -s tests/puente
# (o `npm test`, que también las corre).
# =====================================================================
import http.client
import http.server
import json
import os
import stat
import sys
import tempfile
import textwrap
import threading
import time
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "puente"))
os.environ["NAVI_SIN_LOG"] = "1"
import puente as P  # noqa: E402

EXT = "a" * 32  # ID de extensión de mentira (las IDs de Chrome son 32 letras a-p)
URL_LISTING = "https://www.homes.com/property/12352-elmwood-st-garden-grove-ca/sp9g4fw1ndpwt/"
URL_AGENTE = "https://www.homes.com/real-estate-agents/christopher-rubio-novack/rpbcje3/"

# "browser-use" falso: lee el guion por stdin (debe traer _comun + receta) y actúa según la URL
FALSO_BU = textwrap.dedent('''\
    #!/usr/bin/env python3
    import json, os, sys, time
    guion = sys.stdin.read()
    assert "def fotos_listing" in guion and "META" in guion, "el guion no trae las recetas"
    p = json.loads(os.environ["NAVI_PARAMS"])
    url = p.get("url", "")
    print("Abriendo " + url, flush=True)
    if "ayuda" in url:
        print("NAVI:" + json.dumps({"tipo": "ayuda", "motivo": "Hay un CAPTCHA en la página"}), flush=True); sys.exit(3)
    if "lento" in url:
        time.sleep(30)
    if "falla" in url:
        print("Traceback: algo tronó", flush=True); sys.exit(1)
    salida = os.environ["NAVI_SALIDA"]
    open(os.path.join(salida, "01.jpg"), "wb").write(b"x" * 1000)
    print("NAVI:" + json.dumps({"tipo": "progreso", "txt": "Foto 1 de 1"}), flush=True)
    print("NAVI:" + json.dumps({"tipo": "resultado", "carpeta": salida, "fotos": 1, "params": p}), flush=True)
''')


class BraveFalso(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        cuerpo = json.dumps({"Browser": "Brave/1.0", "webSocketDebuggerUrl": "ws://127.0.0.1/devtools/browser/x"}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def log_message(self, *a):
        pass


class Base(unittest.TestCase):
    brave_vivo = True

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.home = t / "navi"
        self.home.mkdir()
        bu = t / "browser-use"
        bu.write_text(FALSO_BU)
        bu.chmod(0o755)
        self.brave = http.server.ThreadingHTTPServer(("127.0.0.1", 0), BraveFalso)
        threading.Thread(target=self.brave.serve_forever, daemon=True).start()
        cdp = f"http://127.0.0.1:{self.brave.server_address[1]}" if self.brave_vivo else "http://127.0.0.1:9"
        (self.home / "config.json").write_text(json.dumps({"extension_id": EXT, "browser_use": str(bu), "cdp_url": cdp, "descargas": str(t / "Downloads" / "navi")}))
        self.puente = P.Puente(home=self.home)
        self.srv = P.servidor(self.puente, 0)
        self.puerto = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.token = (self.home / "token").read_text().strip()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.brave.shutdown()
        self.brave.server_close()
        self.tmp.cleanup()

    def pedir(self, metodo, ruta, cuerpo=None, token=True, origen=None, host=None, extra=None):
        c = http.client.HTTPConnection("127.0.0.1", self.puerto, timeout=10)
        h = {"Host": host or f"127.0.0.1:{self.puerto}"}
        if token:
            h["X-Navi-Token"] = self.token if token is True else token
        if origen:
            h["Origin"] = origen
        if cuerpo is not None:
            h["Content-Type"] = "application/json"
        h.update(extra or {})
        c.request(metodo, ruta, body=json.dumps(cuerpo) if cuerpo is not None else None, headers=h)
        r = c.getresponse()
        datos = r.read()
        c.close()
        try:
            j = json.loads(datos) if datos else None
        except ValueError:
            j = None
        return r.status, dict(r.getheaders()), j

    def esperar(self, tid, estados=("terminado", "error", "ayuda", "cancelado"), seg=45):
        t0 = time.time()
        while time.time() - t0 < seg:
            _, _, j = self.pedir("GET", f"/tarea/{tid}")
            if j["estado"] in estados:
                return j
            time.sleep(0.1)
        self.fail(f"la tarea no terminó: {j}")


class ValidacionParams(unittest.TestCase):
    def setUp(self):
        self.recetas = P.cargar_recetas(RAIZ / "puente" / "recetas")
        self.fl = self.recetas["fotos_listing"]["meta"]
        self.la = self.recetas["listings_agente"]["meta"]

    def test_las_dos_recetas_existen(self):
        self.assertEqual(sorted(self.recetas), ["fotos_listing", "listings_agente"])

    def test_url_buena_y_normalizada(self):
        self.assertEqual(P.validar_params(self.fl, {"url": URL_LISTING})["url"], URL_LISTING)
        # sin www, sin la diagonal final y con ?query: se limpia
        r = P.validar_params(self.fl, {"url": "https://homes.com/property/12352-elmwood-st-garden-grove-ca/sp9g4fw1ndpwt?utm=x#fotos"})
        self.assertEqual(r["url"], URL_LISTING)

    def test_url_mala(self):
        malas = ["http://www.homes.com/property/a-b/c1/", "https://www.zillow.com/property/a-b/c1/", "https://evil.com/?h=www.homes.com",
                 "https://www.homes.com/real-estate-agents/x/y/", "https://www.homes.com.evil.com/property/a/b/",
                 "https://user:pw@www.homes.com/property/a/b/", "https://www.homes.com:8443/property/a/b/",
                 'https://www.homes.com/property/a/b/"); import os; os.system("x', "https://www.homes.com/property/a/b/\nprint(1)",
                 "javascript:alert(1)", "", 123, ["x"]]
        for u in malas:
            with self.subTest(u=u):
                with self.assertRaises(P.ParamError):
                    P.validar_params(self.fl, {"url": u})

    def test_params_desconocidos_y_faltantes(self):
        with self.assertRaises(P.ParamError):
            P.validar_params(self.fl, {"url": URL_LISTING, "codigo": "print(1)"})
        with self.assertRaises(P.ParamError):
            P.validar_params(self.fl, {})
        with self.assertRaises(P.ParamError):
            P.validar_params(self.fl, "url=x")

    def test_bool_e_int(self):
        r = P.validar_params(self.la, {"url": URL_AGENTE})
        self.assertEqual(r, {"url": URL_AGENTE, "fotos": False, "maximo": 60})
        self.assertTrue(P.validar_params(self.la, {"url": URL_AGENTE, "fotos": "sí"})["fotos"])
        self.assertEqual(P.validar_params(self.la, {"url": URL_AGENTE, "maximo": "5"})["maximo"], 5)
        for malo in ({"fotos": "quizás"}, {"maximo": 0}, {"maximo": 999}, {"maximo": "diez"}, {"maximo": True}):
            with self.subTest(malo=malo), self.assertRaises(P.ParamError):
                P.validar_params(self.la, {"url": URL_AGENTE, **malo})

    def test_leer_meta_no_ejecuta_la_receta(self):
        with tempfile.TemporaryDirectory() as d:
            marca = Path(d) / "se-ejecuto"
            Path(d, "_comun.py").write_text("")
            Path(d, "trampa.py").write_text(f"META = {{'nombre': 'trampa', 'params': {{}}}}\nopen({str(marca)!r}, 'w').write('x')\n")
            r = P.cargar_recetas(d)
            self.assertIn("trampa", r)
            self.assertFalse(marca.exists(), "cargar las recetas no debe ejecutarlas")


class Seguridad(Base):
    def test_token_creado_con_permisos_600(self):
        modo = stat.S_IMODE(os.stat(self.home / "token").st_mode)
        self.assertEqual(modo, 0o600)
        self.assertGreaterEqual(len(self.token), 32)

    def test_sin_token_o_token_malo_401(self):
        self.assertEqual(self.pedir("GET", "/salud", token=False)[0], 401)
        self.assertEqual(self.pedir("GET", "/salud", token="otra-clave-que-no-es")[0], 401)
        self.assertEqual(self.pedir("POST", "/tarea", {"receta": "fotos_listing", "params": {"url": URL_LISTING}}, token=False)[0], 401)
        st, _, j = self.pedir("GET", "/salud")
        self.assertEqual(st, 200)
        self.assertTrue(j["brave"])
        self.assertNotIn(self.token, json.dumps(j), "la salud nunca regresa la clave")

    def test_cors_solo_para_la_extension(self):
        st, h, _ = self.pedir("GET", "/salud", origen=f"chrome-extension://{EXT}")
        self.assertEqual(st, 200)
        self.assertEqual(h.get("Access-Control-Allow-Origin"), f"chrome-extension://{EXT}")
        st, h, _ = self.pedir("GET", "/salud", origen="https://evil.com")
        self.assertEqual(st, 403)
        self.assertNotIn("Access-Control-Allow-Origin", h)
        st, h, _ = self.pedir("GET", "/salud", origen=f"chrome-extension://{'b' * 32}")
        self.assertEqual(st, 403)
        # sin Origin (curl en la Mac) funciona con la clave, pero no regresa CORS
        st, h, _ = self.pedir("GET", "/salud")
        self.assertEqual(st, 200)
        self.assertNotIn("Access-Control-Allow-Origin", h)

    def test_preflight(self):
        st, h, _ = self.pedir("OPTIONS", "/tarea", token=False, origen=f"chrome-extension://{EXT}",
                              extra={"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-navi-token, content-type"})
        self.assertEqual(st, 204)
        self.assertIn("X-Navi-Token", h.get("Access-Control-Allow-Headers", ""))
        self.assertEqual(self.pedir("OPTIONS", "/tarea", token=False, origen="https://evil.com")[0], 403)

    def test_host_raro_rechazado(self):
        # contra DNS rebinding: una página que nos llame con otro nombre no pasa, aunque traiga la clave
        self.assertEqual(self.pedir("GET", "/salud", host="evil.com")[0], 403)
        self.assertEqual(self.pedir("GET", "/salud", host=f"localhost:{self.puerto}")[0], 200)

    def test_recetas_que_no_existen(self):
        for nombre in ("borrar_todo", "../puente", "_comun", "os.system", "", None, 5):
            with self.subTest(nombre=nombre):
                st, _, j = self.pedir("POST", "/tarea", {"receta": nombre, "params": {}})
                self.assertEqual(st, 400)
                self.assertIn("no existe la receta", j["error"])

    def test_params_malos_400(self):
        st, _, j = self.pedir("POST", "/tarea", {"receta": "fotos_listing", "params": {"url": "https://evil.com/x"}})
        self.assertEqual(st, 400)
        self.assertIn("homes.com", j["error"])
        st, _, _ = self.pedir("POST", "/tarea", ["no", "es", "objeto"])
        self.assertEqual(st, 400)

    def test_metodos_y_rutas_desconocidos(self):
        self.assertEqual(self.pedir("GET", "/../../etc/passwd")[0], 404)
        self.assertEqual(self.pedir("DELETE", "/tarea/abcdefabcdef")[0], 405)
        self.assertEqual(self.pedir("GET", "/tarea/no-existe")[0], 404)

    def test_abrir_solo_carpetas_del_puente(self):
        st, _, j = self.pedir("POST", "/tarea/abcdefabcdef/abrir", {})
        self.assertEqual(st, 400)


class Tareas(Base):
    def test_lista_de_recetas(self):
        st, _, j = self.pedir("GET", "/recetas")
        self.assertEqual(st, 200)
        nombres = [r["nombre"] for r in j["recetas"]]
        self.assertEqual(nombres, ["fotos_listing", "listings_agente"])
        self.assertEqual(j["recetas"][0]["params"]["url"]["tipo"], "url")

    def test_tarea_completa(self):
        st, _, j = self.pedir("POST", "/tarea", {"receta": "fotos_listing", "params": {"url": URL_LISTING}})
        self.assertEqual(st, 201)
        fin = self.esperar(j["id"])
        self.assertEqual(fin["estado"], "terminado", fin)
        self.assertEqual(fin["resultado"]["fotos"], 1)
        self.assertEqual(fin["resultado"]["params"], {"url": URL_LISTING}, "la receta recibe los params ya validados")
        carpeta = Path(fin["resultado"]["carpeta"])
        self.assertTrue((carpeta / "01.jpg").exists())
        self.assertIn(str(Path(self.tmp.name) / "Downloads" / "navi" / "fotos_listing"), str(carpeta))
        self.assertTrue(any("Abriendo" in l for l in fin["log"]))
        self.assertTrue(any("Foto 1 de 1" in l for l in fin["log"]))
        self.assertTrue((self.home / "tareas" / f"{j['id']}.json").exists(), "queda historial en ~/.navi/tareas")

    def test_captcha_pide_ayuda(self):
        _, _, j = self.pedir("POST", "/tarea", {"receta": "fotos_listing", "params": {"url": "https://www.homes.com/property/ayuda-st/abc123/"}})
        fin = self.esperar(j["id"])
        self.assertEqual(fin["estado"], "ayuda")
        self.assertIn("CAPTCHA", fin["ayuda"])

    def test_error_de_la_receta(self):
        _, _, j = self.pedir("POST", "/tarea", {"receta": "fotos_listing", "params": {"url": "https://www.homes.com/property/falla-st/abc123/"}})
        fin = self.esperar(j["id"])
        self.assertEqual(fin["estado"], "error")
        self.assertIn("algo tronó", fin["error"])

    def test_una_a_la_vez_y_cancelar(self):
        _, _, a = self.pedir("POST", "/tarea", {"receta": "fotos_listing", "params": {"url": "https://www.homes.com/property/lento-st/abc123/"}})
        _, _, b = self.pedir("POST", "/tarea", {"receta": "fotos_listing", "params": {"url": URL_LISTING}})
        self.esperar(a["id"], estados=("trabajando",))
        _, _, vb = self.pedir("GET", f"/tarea/{b['id']}")
        self.assertEqual(vb["estado"], "en_cola")
        self.assertEqual(vb["en_fila"], 1)
        st, _, c = self.pedir("POST", f"/tarea/{a['id']}/cancelar", {})
        self.assertEqual(c["estado"], "cancelando")
        self.assertEqual(self.esperar(a["id"])["estado"], "cancelado")
        self.assertEqual(self.esperar(b["id"])["estado"], "terminado", "la siguiente de la fila corre sola")

    def test_cancelar_en_fila(self):
        _, _, a = self.pedir("POST", "/tarea", {"receta": "fotos_listing", "params": {"url": "https://www.homes.com/property/lento-st/abc123/"}})
        _, _, b = self.pedir("POST", "/tarea", {"receta": "fotos_listing", "params": {"url": URL_LISTING}})
        self.assertEqual(self.pedir("POST", f"/tarea/{b['id']}/cancelar", {})[2]["estado"], "cancelado")
        self.pedir("POST", f"/tarea/{a['id']}/cancelar", {})
        self.assertEqual(self.esperar(a["id"])["estado"], "cancelado")


class BraveApagado(Base):
    brave_vivo = False

    def test_avisa_abrir_brave(self):
        _, _, s = self.pedir("GET", "/salud")
        self.assertFalse(s["brave"])
        _, _, j = self.pedir("POST", "/tarea", {"receta": "fotos_listing", "params": {"url": URL_LISTING}})
        fin = self.esperar(j["id"])
        self.assertEqual(fin["estado"], "error")
        self.assertIn("brave-ia", fin["error"])


if __name__ == "__main__":
    unittest.main()
