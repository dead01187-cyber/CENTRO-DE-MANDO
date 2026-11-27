# =====================================================================
# Servicios del puente (Fase A): trabajos que corren SOLOS en tu Mac, aunque Brave esté cerrado.
# Cada servicio tiene interruptor (se recuerda en ~/.navi/servicios.json), estado, texto y log.
# Estados (los mismos chips de los robots): idle (Listo), trabajando, feliz (¡Terminé!/OK), error,
# ayuda (Necesito ayuda) y apagado.
# Los servicios son código fijo del repo (lista de abajo); el puente nunca carga otros.
# =====================================================================
import collections
import datetime
import json
import threading
import time
import traceback
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    CA = ZoneInfo("America/Los_Angeles")
except Exception:  # Python sin base de zonas: se usa la hora local de la Mac (que ya está en California)
    CA = None

ESTADOS = ("idle", "trabajando", "feliz", "error", "ayuda", "apagado")


def ahora_ca():
    return datetime.datetime.now(CA) if CA else datetime.datetime.now()


class Contexto:
    """Lo que un servicio puede usar: carpeta ~/.navi, config, llavero y el reloj (cambiable en pruebas)."""
    def __init__(self, home, config, llavero, reloj=ahora_ca, arbitro=None):
        self.home, self.config, self.llavero, self.reloj, self.arbitro = Path(home), config, llavero, reloj, arbitro

    @property
    def lofty_api(self):
        return (self.config.get("lofty_api") or "https://api.lofty.com").rstrip("/")


class Servicio:
    nombre = ""
    titulo = ""
    descripcion = ""
    intervalo = 60           # segundos entre corridas
    activo_defecto = True

    def __init__(self, ctx):
        self.ctx = ctx
        self.lock = threading.Lock()
        self.estado, self.texto = "idle", "Esperando la primera vuelta…"
        self.ultimo = None
        self.log = collections.deque(maxlen=300)
        self.datos = {}

    def anotar(self, txt):
        txt = str(txt).strip()[:300]
        if txt:
            with self.lock:
                self.log.append(f"{time.strftime('%H:%M:%S')} {txt}")

    def poner(self, estado, texto):
        cambio = (estado, texto) != (self.estado, self.texto)
        self.estado, self.texto = estado, str(texto)[:300]
        if cambio:
            self.anotar(texto)

    def correr(self):  # lo escribe cada servicio
        raise NotImplementedError

    def al_apagar(self):  # limpiar (por ejemplo, soltar caffeinate)
        pass

    def foto(self, con_log=30):
        with self.lock:
            log = list(self.log)[-con_log:] if con_log else []
        return {"nombre": self.nombre, "titulo": self.titulo, "descripcion": self.descripcion, "intervalo": self.intervalo,
                "estado": self.estado, "texto": self.texto, "ultimo": self.ultimo, "datos": self.datos, "log": log}


class Gestor:
    def __init__(self, ctx, clases):
        self.ctx = ctx
        self.ruta = ctx.home / "servicios.json"
        self.servicios = {c.nombre: c(ctx) for c in clases}
        self.activos = self._leer_activos()
        self.despertar = {n: threading.Event() for n in self.servicios}
        self.parar = threading.Event()
        self.hilos = []
        for n, s in self.servicios.items():
            if not self.activos[n]:
                s.poner("apagado", "Apagado con su interruptor.")

    def _leer_activos(self):
        try:
            d = json.loads(self.ruta.read_text())
        except (OSError, ValueError):
            d = {}
        return {n: bool(d.get(n, s.activo_defecto)) for n, s in self.servicios.items()}

    def _guardar_activos(self):
        try:
            self.ruta.write_text(json.dumps(self.activos, indent=1))
        except OSError:
            pass

    def arrancar(self):
        for n in self.servicios:
            h = threading.Thread(target=self._vuelta, args=(n,), name=f"servicio-{n}", daemon=True)
            h.start()
            self.hilos.append(h)

    def detener(self):
        self.parar.set()
        for e in self.despertar.values():
            e.set()
        for s in self.servicios.values():
            try:
                s.al_apagar()
            except Exception:
                pass

    def ejecutar(self, n):
        """Una vuelta del servicio (también la usan las pruebas)."""
        s = self.servicios[n]
        if not self.activos[n]:
            return
        try:
            s.correr()
        except Exception as e:
            s.poner("error", f"Falló: {e}")
            s.anotar(traceback.format_exc().strip().splitlines()[-1])
        s.ultimo = time.time()

    def _vuelta(self, n):
        s = self.servicios[n]
        while not self.parar.is_set():
            self.ejecutar(n)
            self.despertar[n].wait(s.intervalo)
            self.despertar[n].clear()

    def prender(self, n, si=True):
        if n not in self.servicios:
            return None
        self.activos[n] = bool(si)
        self._guardar_activos()
        s = self.servicios[n]
        if si:
            s.poner("idle", "Prendido; empiezo ya.")
            self.despertar[n].set()
        else:
            try:
                s.al_apagar()
            finally:
                s.poner("apagado", "Apagado con su interruptor.")
        return s.foto()

    def ahora(self, n):
        if n not in self.servicios:
            return None
        self.despertar[n].set()
        return self.servicios[n].foto()

    def lista(self):
        return [dict(s.foto(), activo=self.activos[n]) for n, s in self.servicios.items()]

    def uno(self, n):
        s = self.servicios.get(n)
        return dict(s.foto(con_log=300), activo=self.activos[n]) if s else None


def todas():
    """Lista fija de servicios del puente."""
    from .despierto import Despierto
    from .lofty_salud import LoftySalud
    from .rayo import Rayo
    return [Despierto, LoftySalud, Rayo]
