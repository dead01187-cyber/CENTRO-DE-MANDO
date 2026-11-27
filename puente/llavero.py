# =====================================================================
# Llavero del puente (Fase A). Guarda las llaves que la extensión le pasa al puente (por ejemplo la
# de Lofty) para que los servicios trabajen aunque Brave esté cerrado.
#
# · En la Mac: Llavero de macOS (Keychain), servicio "com.christopher.navi". La llave NUNCA va en la
#   línea de comandos (se ve en `ps`): se le pasa a `security -i` por stdin.
# · Fuera de la Mac (pruebas) o si lo pides en ~/.navi/config.json ("llavero": "archivo"):
#   ~/.navi/llaves.json con permisos 600.
# · Solo se aceptan los nombres de la lista y valores con forma de llave (sin espacios ni comillas).
# · Nadie puede LEER una llave por HTTP: el puente solo dice si está puesta y sus últimos 4 caracteres.
# =====================================================================
import json
import os
import re
import subprocess
import sys
from pathlib import Path

SERVICIO = "com.christopher.navi"
# Las llaves que el puente puede guardar (la extensión ya las tiene; aquí solo se copian)
NOMBRES = {
    "loftyKey": "Lofty principal (Lofti, Anna)",
    "txKey": "Lofty de Texi / Resi / Rayo",
    "t2Key": "Lofty de Texi 2",
}
VALOR_RE = re.compile(r"^[A-Za-z0-9._\-+/=]{8,4096}$")


class LlaveError(ValueError):
    pass


def validar(nombre, valor=None):
    if nombre not in NOMBRES:
        raise LlaveError(f"esa llave no se guarda en el puente: {str(nombre)[:30]!r}")
    if valor is not None and (not isinstance(valor, str) or not VALOR_RE.fullmatch(valor.strip())):
        raise LlaveError("la llave no tiene la forma de una llave (sin espacios ni comillas)")


def pista(valor):
    return ("…" + valor[-4:]) if valor and len(valor) >= 12 else ("puesta" if valor else "")


class LlaveroArchivo:
    tipo = "archivo"

    def __init__(self, home):
        self.ruta = Path(home) / "llaves.json"

    def _leer(self):
        try:
            d = json.loads(self.ruta.read_text())
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def _escribir(self, d):
        self.ruta.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(self.ruta), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(d, f)
        os.chmod(self.ruta, 0o600)

    def guardar(self, nombre, valor):
        validar(nombre, valor)
        d = self._leer()
        d[nombre] = valor.strip()
        self._escribir(d)

    def leer(self, nombre):
        validar(nombre)
        return self._leer().get(nombre, "")

    def borrar(self, nombre):
        validar(nombre)
        d = self._leer()
        if d.pop(nombre, None) is not None:
            self._escribir(d)


class LlaveroMac:
    tipo = "keychain"

    def __init__(self, security="/usr/bin/security"):
        self.security = security

    def guardar(self, nombre, valor):
        validar(nombre, valor)
        # `security -i` lee los comandos de stdin: la llave no aparece en la lista de procesos
        cmd = f"add-generic-password -U -s {SERVICIO} -a {nombre} -l Centro-de-Mando-{nombre} -w {valor.strip()}\n"
        r = subprocess.run([self.security, "-i"], input=cmd, capture_output=True, text=True, timeout=20)
        if r.returncode != 0 or "error" in (r.stderr or "").lower():
            raise LlaveError("el Llavero de macOS no guardó la llave: " + (r.stderr or r.stdout or "").strip()[:200])

    def leer(self, nombre):
        validar(nombre)
        r = subprocess.run([self.security, "find-generic-password", "-s", SERVICIO, "-a", nombre, "-w"], capture_output=True, text=True, timeout=20)
        return r.stdout.strip() if r.returncode == 0 else ""

    def borrar(self, nombre):
        validar(nombre)
        subprocess.run([self.security, "delete-generic-password", "-s", SERVICIO, "-a", nombre], capture_output=True, text=True, timeout=20)


def abrir(home, config):
    """Keychain en la Mac; archivo 600 si no es Mac o si config/entorno lo pide."""
    modo = os.environ.get("NAVI_LLAVERO") or config.get("llavero") or ("keychain" if sys.platform == "darwin" else "archivo")
    if modo == "keychain":
        return LlaveroMac(config.get("security_bin") or "/usr/bin/security")
    return LlaveroArchivo(home)


def estado(llavero):
    """Qué llaves están puestas (sin regresar nunca el valor)."""
    out = {}
    for n, desc in NOMBRES.items():
        try:
            v = llavero.leer(n)
        except Exception:
            v = ""
        out[n] = {"descripcion": desc, "puesta": bool(v), "pista": pista(v)}
    return out
