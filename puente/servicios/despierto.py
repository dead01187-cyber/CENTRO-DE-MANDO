# =====================================================================
# Servicio "despierto": que la Mac no se duerma de 8 am a 9 pm (hora de California), para que los
# servicios del puente sigan trabajando. Usa `caffeinate -i` de macOS (evita el reposo por inactividad;
# la pantalla sí se puede apagar). Fuera de horario lo suelta y la Mac duerme normal.
# Ojo: una laptop con la TAPA CERRADA se duerme igual (salvo con monitor y corriente).
# =====================================================================
import os
import shutil
import subprocess
import sys

from . import Servicio

DESDE, HASTA = 8, 21


class Despierto(Servicio):
    nombre = "despierto"
    titulo = "Mac despierta (8 am – 9 pm)"
    descripcion = "Evita que la Mac se duerma en horario de trabajo para que los servicios del puente no se paren. Usa caffeinate de macOS."
    intervalo = 60

    def __init__(self, ctx):
        super().__init__(ctx)
        self.proc = None

    def _bin(self):
        b = self.ctx.config.get("caffeinate_bin")
        if b:
            return b
        if sys.platform == "darwin":
            return shutil.which("caffeinate") or "/usr/bin/caffeinate"
        return None

    def correr(self):
        b = self._bin()
        if not b:
            self.poner("idle", "Solo funciona en macOS.")
            return
        h = self.ctx.reloj()
        dentro = DESDE <= h.hour < HASTA
        vivo = self.proc is not None and self.proc.poll() is None
        if dentro:
            if not vivo:
                # -w: caffeinate termina solo si el puente se cae (nunca queda huérfano)
                self.proc = subprocess.Popen([b, "-i", "-w", str(os.getpid())], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.datos = {"despierta": True}
            self.poner("trabajando", "La Mac no se duerme hasta las 9 pm.")
        else:
            self.al_apagar()
            self.datos = {"despierta": False}
            self.poner("idle", "Fuera de horario (8 am – 9 pm): la Mac puede dormir.")

    def al_apagar(self):
        if self.proc is not None and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None
