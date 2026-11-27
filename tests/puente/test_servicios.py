# =====================================================================
# Fase A del puente: llavero (Keychain / archivo 600), servicios en segundo plano y sus endpoints.
# Sin red real: un "Lofty" falso contesta /v1.0/leads y un "security" y un "caffeinate" falsos.
# =====================================================================
import datetime
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
os.environ["NAVI_LLAVERO"] = "archivo"
import puente as P  # noqa: E402
import llavero as L  # noqa: E402
import servicios as S  # noqa: E402
from test_puente import Base, EXT  # noqa: E402

LLAVE_BUENA = "lofty.Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z"
LLAVE_MALA = "lofty.ZZZZ-mala-0000000000000000000"


class LoftyFalso(http.server.BaseHTTPRequestHandler):
    vistos = []

    def do_GET(self):
        LoftyFalso.vistos.append({"ruta": self.path, "auth": self.headers.get("Authorization")})
        ok = self.headers.get("Authorization") == "token " + LLAVE_BUENA
        cuerpo = json.dumps({"leads": []} if ok else {"message": "invalid token"}).encode()
        self.send_response(200 if ok else 401)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_POST(self):  # el servicio de salud NUNCA debe escribir
        LoftyFalso.vistos.append({"ruta": self.path, "metodo": "POST"})
        self.send_response(500)
        self.end_headers()

    do_PUT = do_DELETE = do_POST

    def log_message(self, *a):
        pass


class Llavero(unittest.TestCase):
    def test_archivo_600_y_solo_nombres_permitidos(self):
        with tempfile.TemporaryDirectory() as d:
            ll = L.LlaveroArchivo(d)
            ll.guardar("loftyKey", LLAVE_BUENA)
            self.assertEqual(ll.leer("loftyKey"), LLAVE_BUENA)
            self.assertEqual(stat.S_IMODE(os.stat(Path(d) / "llaves.json").st_mode), 0o600)
            for nombre in ("svKey", "../x", "", None):
                with self.assertRaises(L.LlaveError):
                    ll.guardar(nombre, LLAVE_BUENA)
            for valor in ("corta", "con espacio adentro 123", 'comilla"123456789', "x\n-w otra", 12345678, ""):
                with self.assertRaises(L.LlaveError):
                    ll.guardar("txKey", valor)
            ll.borrar("loftyKey")
            self.assertEqual(ll.leer("loftyKey"), "")
            e = L.estado(ll)
            self.assertEqual(set(e), {"loftyKey", "txKey", "t2Key"})

    def test_estado_nunca_regresa_la_llave(self):
        with tempfile.TemporaryDirectory() as d:
            ll = L.LlaveroArchivo(d)
            ll.guardar("txKey", LLAVE_BUENA)
            e = json.dumps(L.estado(ll), ensure_ascii=False)
            self.assertNotIn(LLAVE_BUENA, e)
            self.assertIn("…" + LLAVE_BUENA[-4:], e)

    def test_keychain_la_llave_va_por_stdin_no_por_argumentos(self):
        with tempfile.TemporaryDirectory() as d:
            bitacora = Path(d) / "llamadas.json"
            falso = Path(d) / "security"
            falso.write_text(textwrap.dedent(f'''\
                #!/usr/bin/env python3
                import json, sys
                entrada = sys.stdin.read() if "-i" in sys.argv else ""
                with open({str(bitacora)!r}, "a") as f:
                    f.write(json.dumps({{"argv": sys.argv[1:], "stdin": entrada}}) + "\\n")
                if "find-generic-password" in sys.argv:
                    print("{LLAVE_BUENA}")
            '''))
            falso.chmod(0o755)
            ll = L.LlaveroMac(str(falso))
            ll.guardar("loftyKey", LLAVE_BUENA)
            self.assertEqual(ll.leer("loftyKey"), LLAVE_BUENA)
            llamadas = [json.loads(x) for x in bitacora.read_text().splitlines()]
            guardar = llamadas[0]
            self.assertEqual(guardar["argv"], ["-i"])
            self.assertNotIn(LLAVE_BUENA, " ".join(guardar["argv"]), "la llave nunca va en la línea de comandos")
            self.assertIn(f"add-generic-password -U -s {L.SERVICIO} -a loftyKey", guardar["stdin"])
            self.assertIn("-w " + LLAVE_BUENA, guardar["stdin"])
            self.assertNotIn(LLAVE_BUENA, " ".join(llamadas[1]["argv"]))


class Despierto(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.caf = Path(self.tmp.name) / "caffeinate"
        self.caf.write_text("#!/bin/sh\nsleep 60\n")
        self.caf.chmod(0o755)
        self.hora = 10

    def tearDown(self):
        self.tmp.cleanup()

    def servicio(self):
        ctx = S.Contexto(self.tmp.name, {"caffeinate_bin": str(self.caf)}, L.LlaveroArchivo(self.tmp.name),
                         reloj=lambda: datetime.datetime(2026, 11, 27, self.hora, 0))
        from servicios.despierto import Despierto as D
        return D(ctx)

    def test_en_horario_prende_caffeinate_y_fuera_lo_suelta(self):
        s = self.servicio()
        s.correr()
        self.assertEqual(s.estado, "trabajando")
        self.assertIsNotNone(s.proc)
        self.assertIsNone(s.proc.poll(), "caffeinate corriendo")
        self.assertIn(str(os.getpid()), s.proc.args, "con -w <pid del puente> para no quedar huérfano")
        p = s.proc
        s.correr()
        self.assertIs(s.proc, p, "no abre uno nuevo en cada vuelta")
        self.hora = 22
        s.correr()
        self.assertEqual(s.estado, "idle")
        self.assertIsNone(s.proc)
        self.assertIsNotNone(p.poll(), "fuera de horario se suelta")
        self.hora = 7
        s.correr()
        self.assertIsNone(s.proc)


class Servicios(Base):
    def setUp(self):
        super().setUp()
        self.lofty = http.server.ThreadingHTTPServer(("127.0.0.1", 0), LoftyFalso)
        threading.Thread(target=self.lofty.serve_forever, daemon=True).start()
        LoftyFalso.vistos = []
        self.puente.servicios.ctx.config["lofty_api"] = f"http://127.0.0.1:{self.lofty.server_address[1]}"

    def tearDown(self):
        self.lofty.shutdown()
        self.lofty.server_close()
        super().tearDown()

    def test_endpoints_piden_clave(self):
        for ruta in ("/llaves", "/servicios", "/servicios/lofty_salud"):
            self.assertEqual(self.pedir("GET", ruta, token=False)[0], 401)
        self.assertEqual(self.pedir("POST", "/llaves", {"nombre": "txKey", "valor": LLAVE_BUENA}, token=False)[0], 401)
        self.assertEqual(self.pedir("POST", "/llaves", {"nombre": "txKey", "valor": LLAVE_BUENA}, origen="https://evil.com")[0], 403)

    def test_guardar_llave_y_salud_de_lofty(self):
        st, _, j = self.pedir("GET", "/llaves")
        self.assertEqual(st, 200)
        self.assertFalse(j["llaves"]["txKey"]["puesta"])
        self.puente.servicios.ejecutar("lofty_salud")
        self.assertEqual(self.puente.servicios.servicios["lofty_salud"].estado, "idle")
        st, _, j = self.pedir("POST", "/llaves", {"nombre": "txKey", "valor": LLAVE_BUENA}, origen=f"chrome-extension://{EXT}")
        self.assertEqual(st, 200)
        self.assertTrue(j["llaves"]["txKey"]["puesta"])
        self.assertNotIn(LLAVE_BUENA, json.dumps(j))
        self.puente.servicios.ejecutar("lofty_salud")
        _, _, s = self.pedir("GET", "/servicios/lofty_salud")
        self.assertEqual(s["estado"], "feliz", s)
        self.assertEqual(s["texto"], "Llaves de Lofty OK (1).")
        self.assertNotIn(LLAVE_BUENA, json.dumps(s), "la llave nunca sale en el estado ni en el log")
        self.assertTrue(all(v.get("ruta", "").startswith("/v1.0/leads?limit=1") and "metodo" not in v for v in LoftyFalso.vistos), "solo lee")
        # una llave que Lofty rechaza → Error con mensaje claro
        self.pedir("POST", "/llaves", {"nombre": "loftyKey", "valor": LLAVE_MALA})
        self.puente.servicios.ejecutar("lofty_salud")
        s = self.pedir("GET", "/servicios/lofty_salud")[2]
        self.assertEqual(s["estado"], "error")
        self.assertIn("Lofty principal", s["texto"])
        self.assertIn("401", s["texto"])
        # borrar
        self.pedir("POST", "/llaves/borrar", {"nombre": "loftyKey"})
        self.assertFalse(self.pedir("GET", "/llaves")[2]["llaves"]["loftyKey"]["puesta"])

    def test_llaves_malas_400(self):
        self.assertEqual(self.pedir("POST", "/llaves", {"nombre": "svKey", "valor": LLAVE_BUENA})[0], 400)
        self.assertEqual(self.pedir("POST", "/llaves", {"nombre": "txKey", "valor": "x y"})[0], 400)

    def test_interruptor_se_recuerda(self):
        st, _, s = self.pedir("POST", "/servicios/lofty_salud/apagar", {})
        self.assertEqual(st, 200)
        self.assertEqual(s["estado"], "apagado")
        self.assertFalse(self.pedir("GET", "/servicios")[2]["servicios"][1]["activo"])
        self.assertEqual(json.loads((self.home / "servicios.json").read_text())["lofty_salud"], False)
        # al reiniciar el puente sigue apagado
        p2 = P.Puente(home=self.home)
        self.assertFalse(p2.servicios.activos["lofty_salud"])
        self.assertEqual(p2.servicios.servicios["lofty_salud"].estado, "apagado")
        self.pedir("POST", "/servicios/lofty_salud/prender", {})
        self.assertTrue(json.loads((self.home / "servicios.json").read_text())["lofty_salud"])
        self.assertEqual(self.pedir("POST", "/servicios/no_existe/prender", {})[0], 404)
        self.assertEqual(self.pedir("POST", "/servicios/lofty_salud/borrar", {})[0], 404)

    def test_un_servicio_que_truena_no_tumba_al_puente(self):
        s = self.puente.servicios.servicios["lofty_salud"]
        s.correr = lambda: (_ for _ in ()).throw(RuntimeError("se cayó la red"))
        self.puente.servicios.ejecutar("lofty_salud")
        self.assertEqual(s.estado, "error")
        self.assertIn("se cayó la red", s.texto)
        self.assertEqual(self.pedir("GET", "/salud")[0], 200)

    def test_hilos_corren_solos(self):
        self.pedir("POST", "/llaves", {"nombre": "txKey", "valor": LLAVE_BUENA})
        g = self.puente.servicios
        g.arrancar()
        try:
            t0 = time.time()
            while g.servicios["lofty_salud"].estado != "feliz" and time.time() - t0 < 10:
                time.sleep(0.1)
            self.assertEqual(g.servicios["lofty_salud"].estado, "feliz")
            _, _, salud = self.pedir("GET", "/salud")
            self.assertEqual(salud["servicios"]["lofty_salud"], "feliz")
            self.assertEqual(salud["llavero"], "archivo")
        finally:
            g.detener()


if __name__ == "__main__":
    unittest.main()
