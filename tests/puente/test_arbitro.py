# =====================================================================
# Fase B: reglas en Python (mismos casos que JavaScript) y árbitro del puente (contactos, bajas, turno).
# =====================================================================
import json
import os
import stat
import sys
import tempfile
import threading
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "puente"))
os.environ["NAVI_SIN_LOG"] = "1"
os.environ["NAVI_LLAVERO"] = "archivo"
import reglas as R  # noqa: E402
import arbitro as A  # noqa: E402
from test_puente import Base, EXT  # noqa: E402

CASOS = json.loads((RAIZ / "tests" / "casos" / "reglas.json").read_text())
H = 3600e3


class ReglasIgualQueJavaScript(unittest.TestCase):
    def test_cerebro(self):
        for c in CASOS["cerebro"]:
            with self.subTest(c["nombre"]):
                r = R.revisar(**c["entrada"])
                self.assertEqual({"ok": r["ok"], "codigo": r["codigo"], "motivo": r.get("motivo", "")}, c["salida"])

    def test_politica(self):
        for c in CASOS["d10"]:
            self.assertEqual(R.d10(c["entrada"]), c["salida"], c)
        for c in CASOS["esCA"]:
            self.assertEqual(R.es_ca(c["entrada"]), c["salida"], c)
        for c in CASOS["enHorario"]:
            self.assertEqual(R.en_horario(c["entrada"]["cfg"], c["entrada"]["ms"]), c["salida"], c)
        for c in CASOS["baja"]:
            self.assertEqual(R.es_baja(c["entrada"]), c["salida"], c)


class Arbitro(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ahora = 1_800_000_000_000.0
        self.a = A.Arbitro(self.tmp.name, reloj=lambda: self.ahora)

    def tearDown(self):
        self.tmp.cleanup()

    def test_contacto_de_otro_robot_bloquea_24h(self):
        self.a.anotar({"leadId": "7", "canal": "sms", "robot": "Rayo", "t": self.ahora - H})
        r = self.a.revisar({"leadId": "7", "canal": "sms", "robot": "Texi"})
        self.assertEqual((r["ok"], r["codigo"]), (False, "24h"))
        self.assertIn("(Rayo)", r["motivo"])
        self.assertEqual(r["fuente"], "puente")
        self.assertTrue(self.a.revisar({"leadId": "8", "canal": "sms"})["ok"])

    def test_sin_duplicados_y_se_guarda_en_disco_600(self):
        c = {"id": "abc", "leadId": "7", "canal": "sms", "robot": "Texi", "t": self.ahora}
        self.assertTrue(self.a.anotar(c))
        self.assertFalse(self.a.anotar(c), "el mismo contacto dos veces no cuenta doble")
        ruta = Path(self.tmp.name) / "cerebro.json"
        self.assertEqual(stat.S_IMODE(os.stat(ruta).st_mode), 0o600)
        b = A.Arbitro(self.tmp.name, reloj=lambda: self.ahora)
        self.assertEqual(len(b.contactos), 1)
        self.assertEqual(b.instancia, self.a.instancia, "la instancia se conserva al reiniciar")

    def test_contactos_invalidos(self):
        for c in ({}, {"leadId": ""}, {"leadId": "7", "canal": "fax"}, "x"):
            with self.subTest(c=c), self.assertRaises(A.ArbitroError):
                self.a.anotar(c)
        futuro = {"leadId": "7", "t": self.ahora + 10 * H}
        self.a.anotar(futuro)
        self.assertEqual(self.a.contactos[-1]["t"], self.ahora, "nadie anota en el futuro")

    def test_bajas_por_telefono_y_por_lead(self):
        self.assertEqual(self.a.marcar_baja({"tels": ["(949) 555-1234"], "leadId": "7", "cuenta": "tx", "motivo": "STOP", "fuente": "Resi"}), 2)
        self.assertEqual(self.a.marcar_baja({"tel": "9495551234"}), 0, "no se repite")
        self.assertEqual(self.a.baja_de({"tel": "+1 949 555 1234"})["motivo"], "STOP")
        self.assertIsNotNone(self.a.baja_de({"leadId": "7", "cuenta": "tx"}))
        self.assertIsNone(self.a.baja_de({"leadId": "7", "cuenta": "t2"}), "las bajas por lead son por cuenta")
        self.assertEqual(self.a.quitar_baja({"tel": "9495551234", "leadId": "7", "cuenta": "tx"}), 2)
        self.assertIsNone(self.a.baja_de({"tel": "9495551234"}))

    def test_turno_del_numero_6_a_12_s_entre_todos(self):
        w1 = self.a.turno("tx")
        w2 = self.a.turno("tx")
        w3 = self.a.turno("tx")
        self.assertGreaterEqual(w2 - w1, A.TURNO_MIN)
        self.assertLessEqual(w2 - w1, A.TURNO_MAX)
        self.assertGreaterEqual(w3 - w2, A.TURNO_MIN)
        self.assertLess(self.a.turno("t2"), A.TURNO_MAX + 1, "otro número, otra fila")
        # el mínimo local (lo que ya esperaba el robot) se respeta
        self.ahora += 10 * H
        self.assertGreaterEqual(self.a.turno("tx", minimo_ms=9000), 9000)
        with self.assertRaises(A.ArbitroError):
            self.a.turno("tx; rm -rf")

    def test_turnos_al_mismo_tiempo_nunca_se_empalman(self):
        res = []
        hilos = [threading.Thread(target=lambda: res.append(self.a.turno("tx"))) for _ in range(20)]
        [h.start() for h in hilos]
        [h.join() for h in hilos]
        res.sort()
        self.assertTrue(all(b - a >= A.TURNO_MIN for a, b in zip(res, res[1:])), res)

    def test_importar_lo_de_la_extension(self):
        r = self.a.importar({"contactos": [{"leadId": "1", "t": self.ahora - H, "canal": "sms", "robot": "Texi"}, {"leadId": "2", "t": self.ahora, "canal": "llamada"}, {"leadId": ""}],
                             "bajas": {"tels": {"9495551234": {"t": 1, "motivo": "STOP"}, "123": {}}, "leads": {"tx:9": {"t": 2, "motivo": "enojado"}, "sin-dos-puntos": {}}},
                             "turnos": {"tx": self.ahora + 5000}})
        self.assertEqual(r, {"contactos_nuevos": 2, "bajas_nuevas": 2})
        self.assertEqual(self.a.importar({"contactos": [{"leadId": "1", "t": self.ahora - H, "canal": "sms", "robot": "Texi"}]})["contactos_nuevos"], 0, "re-subir no duplica")
        self.assertGreaterEqual(self.a.turno("tx"), 5000 + A.TURNO_MIN)


class EndpointsArbitro(Base):
    def test_piden_clave(self):
        for metodo, ruta in (("GET", "/cerebro/resumen"), ("GET", "/bajas"), ("POST", "/turno"), ("POST", "/cerebro/revisar"), ("POST", "/cerebro/anotar"), ("POST", "/cerebro/importar")):
            self.assertEqual(self.pedir(metodo, ruta, {} if metodo == "POST" else None, token=False)[0], 401, ruta)

    def test_flujo(self):
        o = f"chrome-extension://{EXT}"
        st, _, j = self.pedir("POST", "/cerebro/anotar", {"contacto": {"leadId": "7", "canal": "sms", "robot": "Rayo"}}, origen=o)
        self.assertEqual((st, j["nuevos"]), (200, 1))
        _, _, r = self.pedir("POST", "/cerebro/revisar", {"leadId": "7", "canal": "sms", "robot": "Texi", "textos": [], "anna": {}})
        self.assertEqual(r["codigo"], "24h")
        _, _, c = self.pedir("GET", "/cerebro/contactos?desde=0")
        self.assertEqual([x["robot"] for x in c["contactos"]], ["Rayo"])
        self.assertEqual(self.pedir("GET", "/cerebro/contactos?desde=abc")[0], 400)
        self.pedir("POST", "/bajas/marcar", {"tels": ["9495551234"], "motivo": "STOP", "fuente": "Resi"})
        self.assertEqual(self.pedir("POST", "/bajas/revisar", {"tel": "9495551234"})[2]["baja"]["motivo"], "STOP")
        self.assertIn("9495551234", self.pedir("GET", "/bajas")[2]["bajas"]["tels"])
        w = self.pedir("POST", "/turno", {"cuenta": "tx"})[2]["esperar_ms"]
        self.assertIsInstance(w, int)
        self.assertEqual(self.pedir("POST", "/turno", {"cuenta": "tx; x"})[0], 400)
        self.assertEqual(self.pedir("POST", "/cerebro/revisar", {"canal": "sms"})[0], 400)
        salud = self.pedir("GET", "/salud")[2]
        self.assertEqual(salud["cerebro"]["contactos"], 1)
        self.assertEqual(salud["cerebro"]["bajas_tels"], 1)

    def test_importar_grande(self):
        contactos = [{"id": f"c{i}", "leadId": str(i), "t": 1_700_000_000_000 + i, "canal": "sms", "robot": "Texi", "tel": "9495551234"} for i in range(8000)]
        st, _, j = self.pedir("POST", "/cerebro/importar", {"contactos": contactos, "bajas": {}})
        self.assertEqual(st, 200)
        self.assertEqual(j["contactos_nuevos"], 8000)


if __name__ == "__main__":
    unittest.main()
