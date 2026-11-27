# =====================================================================
# Servicio "lofty_salud": cada 10 min revisa que las llaves de Lofty guardadas en el puente sirvan.
# SOLO LEE (pide 1 lead: GET /v1.0/leads?limit=1). Nunca escribe en Lofty ni anota la llave en el log.
# Es la base para los servicios que vienen (Rayo, Cerebro): si una llave deja de servir, se avisa aquí.
# =====================================================================
import json
import urllib.error
import urllib.request

from llavero import NOMBRES  # las llaves que el puente guarda (puente/llavero.py)

from . import Servicio


class LoftySalud(Servicio):
    nombre = "lofty_salud"
    titulo = "Salud de las llaves de Lofty"
    descripcion = "Cada 10 minutos revisa (solo lectura) que las llaves de Lofty guardadas en el puente funcionen."
    intervalo = 600

    def _probar(self, llave):
        req = urllib.request.Request(self.ctx.lofty_api + "/v1.0/leads?limit=1&offset=0",
                                     headers={"Authorization": "token " + llave, "Accept": "application/json", "User-Agent": "CentroDeMando-Puente"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                json.loads(r.read().decode("utf-8", "replace") or "{}")
                return "ok", r.status
        except urllib.error.HTTPError as e:
            return ("mala" if e.code in (401, 403) else "falla"), e.code
        except (OSError, ValueError):
            return "sin_red", 0

    def correr(self):
        puestas = {n: self.ctx.llavero.leer(n) for n in NOMBRES}
        puestas = {n: v for n, v in puestas.items() if v}
        if not puestas:
            self.datos = {}
            self.poner("idle", "Todavía no hay llaves de Lofty en el puente (mándalas desde el Mando → Puente).")
            return
        res = {}
        for n, v in puestas.items():
            res[n] = dict(zip(("resultado", "codigo"), self._probar(v)))
        self.datos = res
        malas = [n for n, r in res.items() if r["resultado"] == "mala"]
        fallas = [n for n, r in res.items() if r["resultado"] in ("falla", "sin_red")]
        if malas:
            self.poner("error", f"La llave {', '.join(NOMBRES[n] for n in malas)} no funciona (Lofty dice {res[malas[0]]['codigo']}). Vuelve a mandarla desde el Mando.")
        elif fallas:
            self.poner("error", f"No pude revisar Lofty ({', '.join(str(res[n]['codigo'] or 'sin red') for n in fallas)}); lo intento en 10 min.")
        else:
            self.poner("feliz", f"Llaves de Lofty OK ({len(res)}).")
