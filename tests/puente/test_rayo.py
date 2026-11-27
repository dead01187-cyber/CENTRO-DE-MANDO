# =====================================================================
# Fase C: Rayo en el puente, contra un Lofty FALSO (tests/puente/lofty_falso.py). Sin internet.
# =====================================================================
import datetime
import os
import sys
import tempfile
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "puente"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ["NAVI_SIN_LOG"] = "1"
os.environ["NAVI_LLAVERO"] = "archivo"
import arbitro as A  # noqa: E402
import llavero as L  # noqa: E402
import servicios as S  # noqa: E402
from servicios.rayo import Rayo, tiempo, evaluar  # noqa: E402
import lofty_falso as LF  # noqa: E402
from test_puente import Base, EXT  # noqa: E402

# 10:00 am en California (18:00 GMT) — en horario
DIA = datetime.datetime(2026, 1, 15, 18, 0, tzinfo=datetime.timezone.utc).timestamp() * 1000
NOCHE = datetime.datetime(2026, 1, 16, 6, 30, tzinfo=datetime.timezone.utc).timestamp() * 1000  # 10:30 pm CA
MIN = 60e3


def gmt(ms_):
    return datetime.datetime.fromtimestamp(ms_ / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SGMT")


def lead(i, tel, **extra):
    return {"leadId": i, "firstName": f"lead{i}", "lastName": "prueba", "stage": "New Leads", "leadTypes": [1], "phones": [tel], "phoneStatuses": [2],
            "phoneConsentStates": [], "leadPropertyList": [{"streetAddress": f"{i} Oak St", "city": "irvine", "label": "Home"}], "emails": [f"l{i}@example.com"],
            "source": "zBuyer", "createTime": gmt(DIA - 2 * MIN), **extra}


def texto(min_antes, tipo="AI", agent=1):
    return {"direction": "Outbound", "textType": tipo, "agentId": agent, "textTime": gmt(DIA - min_antes * MIN), "textContent": "hi"}


class Ambiente(unittest.TestCase):
    ahora = DIA

    def preparar(self, leads, textos=None, pool=(), config=None, sombra=False, llaves=("txKey", "loftyKey")):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.lofty = LF.Estado(leads, textos or {}, pool, llaves=["llave-texi", "llave-principal"])
        self.srv = LF.servir(self.lofty)
        self.addCleanup(lambda: (self.srv.shutdown(), self.srv.server_close()))
        ll = L.LlaveroArchivo(self.tmp.name)
        valores = {"txKey": "llave-texi", "loftyKey": "llave-principal"}
        for k in llaves:
            ll.guardar(k, valores[k])
        self.arb = A.Arbitro(self.tmp.name, reloj=lambda: self.ahora)
        ctx = S.Contexto(self.tmp.name, {"lofty_api": f"http://127.0.0.1:{self.srv.server_address[1]}"}, ll, arbitro=self.arb)
        self.r = Rayo(ctx)
        self.r.ms = lambda: self.ahora
        self.r.poner_config(config=config or {}, modo="sombra" if sombra else "puente")
        self.r.ultimo = DIA - 15 * MIN
        return self.r


class RayoEnElPuente(Ambiente):
    def setUp(self):
        A.TURNO_MIN, A.TURNO_MAX = 0, 5  # sin esperar 6–12 s en las pruebas

    def tearDown(self):
        A.TURNO_MIN, A.TURNO_MAX = 6000, 12000

    def test_con_mi_ok_filtra_y_al_aprobar_gana_a_anna(self):
        r = self.preparar([lead(801, "9495550801"), lead(802, "9495550802", source="propwire"), lead(803, "2125550803"),
                           lead(804, "9495550804"), lead(805, "9495550804", createTime=gmt(DIA - 90 * MIN))], pool=["801"])
        r.correr()
        t = r.tarjetas
        self.assertEqual(t["801"]["estado"], "por aprobar")
        self.assertRegex(t["801"]["sms"], r"Hi Lead801.*Irvine")
        self.assertNotIn("802", t, "propwire no es de Rayo")
        self.assertEqual(t["803"]["estado"], "descartado")
        self.assertIn("no son de California", t["803"]["motivo"])
        self.assertEqual(t["804"]["estado"], "descartado")
        self.assertIn("ya existe otro lead con el (949) 555-0804", t["804"]["motivo"])
        self.assertNotIn("805", t, "un lead viejo (antes de los 15 min) no es nuevo")
        self.assertEqual(self.lofty.sms, [], "con mi OK: nada sale solo")
        self.assertEqual(r.estado, "ayuda")
        # aprobar → silencia a Anna, SMS, email, fila de Marki, Cerebro compartido
        self.assertEqual(r.aprobar(["801"], "jefe"), 1)
        r.correr()
        self.assertEqual(t["801"]["estado"], "hecho", t["801"]["log"])
        self.assertEqual([x["phoneNumber"] for x in self.lofty.sms], ["9495550801"])
        self.assertEqual(len(self.lofty.emails), 1)
        self.assertIn("Irvine", self.lofty.emails[0]["subject"])
        self.assertIn("801", self.lofty.muteados)
        self.assertEqual([x["leadId"] for x in r.cola], ["801"])
        self.assertEqual(r.silenciados["801"]["robot"], "Rayo")
        canales = sorted(c["canal"] for c in self.arb.contactos if c["leadId"] == "801" and c["robot"] == "Rayo")
        self.assertEqual(canales, ["email", "sms"])
        self.assertTrue(any(e["estado"] == "enviado" and e["leadId"] == "801" for e in r.registro))
        self.assertEqual(t["801"]["segundos"], 120)

    def test_automatico_gana_anna_persona_baja_y_24h(self):
        r = self.preparar([lead(811, "9495550811"), lead(812, "9495550812"), lead(813, "9495550813"), lead(814, "9495550814")],
                          textos={"811": [texto(3, "AI")], "812": [texto(20, "Manual", 347)]}, config={"modo": "auto"})
        self.arb.marcar_baja({"tels": ["9495550813"], "motivo": "STOP", "fuente": "Resi"})
        self.arb.anotar({"leadId": "814", "canal": "sms", "robot": "Texi", "t": DIA - 60 * MIN})
        r.correr()
        t = r.tarjetas
        self.assertEqual(t["811"]["estado"], "ganó Anna")
        self.assertEqual(t["812"]["estado"], "saltado")
        self.assertIn("una persona le escribió", t["812"]["motivo"])
        self.assertEqual(t["813"]["estado"], "error", "con SMS prendido, sin SMS no cuenta como hecho")
        self.assertTrue(any("baja permanente (STOP)" in x for x in t["813"]["log"]))
        self.assertEqual(t["814"]["estado"], "saltado")
        self.assertIn("(Texi)", t["814"]["motivo"], "el árbitro sabe lo que mandó Texi en la extensión")
        self.assertEqual(self.lofty.sms, [])

    def test_de_noche_queda_programado_y_sale_de_dia(self):
        self.ahora = NOCHE
        r = self.preparar([lead(821, "9495550821", createTime=gmt(NOCHE - 2 * MIN))], config={"modo": "auto"})
        r.ultimo = NOCHE - 15 * MIN
        r.correr()
        self.assertEqual(r.tarjetas["821"]["estado"], "programado")
        self.assertEqual(self.lofty.sms, [])
        self.ahora = NOCHE + 10 * 3600e3  # 8:30 am
        r.correr()
        self.assertEqual(r.tarjetas["821"]["estado"], "hecho")
        self.assertEqual(len(self.lofty.sms), 1)

    def test_vigila_30_min_y_silencia_si_anna_lo_agarra_tarde(self):
        r = self.preparar([lead(831, "9495550831")], config={"modo": "auto"})
        r.correr()
        self.assertIn("831", r.vigilar)
        self.lofty.pool.append("831")
        r._pool["t"] = 0
        self.ahora += 5 * MIN
        r.correr()
        self.assertIn("831", self.lofty.muteados)
        self.assertNotIn("831", r.vigilar)

    def test_sin_llave_avisa_claro(self):
        r = self.preparar([lead(841, "9495550841")], llaves=())
        r.correr()
        self.assertEqual(r.estado, "error")
        self.assertIn("mándala desde el Mando", r.texto)

    def test_no_puede_silenciar_a_anna_entonces_no_contacta(self):
        r = self.preparar([lead(851, "9495550851")], pool=["851"], config={"modo": "auto"}, llaves=("txKey",))
        self.lofty.llaves = {"llave-texi"}  # Anna se revisa con la de Texi, pero mute falla si se rompe
        orig = r.silenciar
        r.silenciar = lambda i, m: False
        r.correr()
        r.silenciar = orig
        self.assertEqual(r.tarjetas["851"]["estado"], "error")
        self.assertIn("no pude silenciar a Anna", r.tarjetas["851"]["motivo"])
        self.assertEqual(self.lofty.sms, [])


class RayoEnSombra(Ambiente):
    def test_sombra_anota_lo_que_haria_sin_tocar_nada(self):
        r = self.preparar([lead(861, "9495550861"), lead(862, "9495550862")], textos={"862": [texto(3, "AI")]}, pool=["861"], sombra=True, config={"modo": "auto"})
        r.correr()
        t = r.tarjetas
        self.assertEqual((t["861"]["estado"], t["861"]["haria"]), ("por aprobar", "contactar"))
        self.assertIn("silenciar a Anna", t["861"]["motivo"])
        self.assertEqual(t["862"]["haria"], "ganó Anna")
        self.assertEqual((self.lofty.sms, self.lofty.emails, sorted(self.lofty.muteados), r.cola, self.arb.contactos), ([], [], [], [], []), "en sombra no toca nada")
        self.assertFalse(any(m in ("POST", "PUT") for m, _ in self.lofty.pedidos), "en sombra solo lee de Lofty")
        self.assertEqual(r.aprobar(["861"], "jefe"), 0, "en sombra no se aprueba nada")
        self.assertIn("SOMBRA", r.texto)


class Utilidades(unittest.TestCase):
    def test_tiempo_como_en_javascript(self):
        self.assertEqual(tiempo("2026-01-15T18:00:00GMT"), DIA)
        self.assertEqual(tiempo("2026-01-15T18:00:00Z"), DIA)
        self.assertEqual(tiempo("2026-01-15T10:00:00-08:00"), DIA)
        self.assertEqual(tiempo(""), 0)

    def test_evaluar_dnc_y_cannot_text(self):
        self.assertIn("DNC", evaluar(lead(1, "9495550001", phoneConsentStates=["Do Not Text"]), DIA)["motivo"])
        self.assertIn("cannotText", evaluar(lead(1, "9495550001", cannotText=True), DIA)["motivo"])
        self.assertTrue(evaluar(lead(1, "9495550001", leadTypes=[2]), DIA)["comprador"])


class EndpointsRayo(Base):
    def test_modo_aprobar_y_cola(self):
        self.assertEqual(self.pedir("GET", "/rayo/estado", token=False)[0], 401)
        st, _, j = self.pedir("GET", "/rayo/estado")
        self.assertEqual((st, j["modo"]), (200, "extension"))
        self.assertEqual(self.pedir("POST", "/rayo/modo", {"modo": "todo"})[0], 400)
        st, _, j = self.pedir("POST", "/rayo/modo", {"modo": "sombra", "config": {"modo": "auto", "fuentes": "zBuyer", "smsSeller": "Hola {nombre}"}}, origen=f"chrome-extension://{EXT}")
        self.assertEqual(j["modo"], "sombra")
        e = self.pedir("GET", "/rayo/estado")[2]
        self.assertTrue(e["sombra"])
        self.assertEqual(e["config"]["smsSeller"], "Hola {nombre}")
        self.assertEqual(self.pedir("POST", "/rayo/modo", {"modo": "puente"})[2]["modo"], "puente")
        r = self.puente.servicios.servicios["rayo"]
        r.tarjetas["9"] = {"leadId": "9", "estado": "por aprobar", "creado": 1, "log": []}
        r.cola.append({"leadId": "9", "t": 1, "nombre": "x"})
        self.assertEqual(self.pedir("POST", "/rayo/aprobar", {"ids": ["9"], "por": "Capi"})[2]["aprobados"], 1)
        self.assertEqual(self.pedir("POST", "/rayo/cola/tomar", {"ids": ["9"]})[2]["tomados"], 1)
        self.assertEqual(self.pedir("GET", "/rayo/registro?desde=0")[2]["registro"], [])
        self.assertEqual(self.pedir("POST", "/rayo/modo", {"modo": "extension"})[2]["modo"], "extension")
        self.assertFalse(self.puente.servicios.activos["rayo"])


if __name__ == "__main__":
    unittest.main()
