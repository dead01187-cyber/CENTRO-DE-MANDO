#!/usr/bin/env python3
# =====================================================================
# Puente de Navi (Fase 7): conecta la extensión con Browser Use en tu Mac.
#
# · Solo librería estándar de Python (no hay que instalar nada).
# · Escucha SOLO en 127.0.0.1:8765 (nadie de fuera de tu Mac lo ve).
# · Cada petición necesita el header X-Navi-Token (la clave vive en ~/.navi/token, permisos 600).
# · CORS solo para la extensión (chrome-extension://<ID> de ~/.navi/config.json).
# · NO ejecuta código que le manden: solo corre las recetas fijas de puente/recetas/*.py por nombre,
#   con los parámetros validados. Los parámetros llegan a la receta en la variable NAVI_PARAMS
#   (JSON), nunca pegados dentro del código.
# · Una tarea a la vez, en fila.
#
# Endpoints:
#   GET  /salud                 estado del puente y si Brave responde en el 9222
#   GET  /recetas               recetas con sus parámetros
#   POST /tarea                 {receta, params} → {id}
#   GET  /tarea/<id>            estado (en_cola / trabajando / terminado / error / ayuda / cancelado), log y resultado
#   POST /tarea/<id>/cancelar
#   POST /tarea/<id>/abrir      abre en Finder la carpeta del resultado (solo carpetas que creó el puente)
#   Fase A (servicios que trabajan solos aunque Brave esté cerrado):
#   GET  /llaves                qué llaves tiene el puente (NUNCA su valor; solo "puesta" y los últimos 4)
#   POST /llaves                {nombre, valor} guarda una llave en el Llavero de macOS
#   POST /llaves/borrar         {nombre}
#   GET  /servicios             servicios con su interruptor, estado, texto y log
#   GET  /servicios/<nombre>    uno con su log completo
#   POST /servicios/<nombre>/(prender|apagar|ahora)
#   Fase B (árbitro: una sola verdad para los robots de la extensión y los del puente):
#   GET  /cerebro/resumen       cuántos contactos y bajas conoce, e "instancia" (si cambia, la extensión re-sube lo suyo)
#   GET  /cerebro/contactos?desde=<ms>
#   POST /cerebro/anotar        {contacto} o {contactos: [...]}
#   POST /cerebro/revisar       {leadId, canal, robot, textos, anna, respetaAnna, esRespuesta} → {ok, codigo, motivo}
#   POST /cerebro/importar      {contactos, bajas, turnos}  (lo que ya tenía la extensión)
#   GET  /bajas                 todas las bajas permanentes
#   POST /bajas/(marcar|quitar|revisar)
#   POST /turno                 {cuenta, minimo_ms} → {esperar_ms}: turno del número de SMS
# =====================================================================
import ast
import collections
import datetime
import hmac
import http.server
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import llavero as llaves_mod  # noqa: E402
import arbitro as arbitro_mod  # noqa: E402
import servicios as servicios_mod  # noqa: E402

VERSION = "1.1.0"
HOST = "127.0.0.1"
PUERTO = int(os.environ.get("NAVI_PUERTO", "8765"))
AQUI = Path(__file__).resolve().parent
RECETAS_DIR = Path(os.environ.get("NAVI_RECETAS") or (AQUI / "recetas"))
HOME_NAVI = Path(os.environ.get("NAVI_HOME") or (Path.home() / ".navi"))
MAX_CUERPO = 64 * 1024          # una petición normal nunca necesita más que esto
MAX_IMPORTAR = 4 * 1024 * 1024  # /cerebro/importar: el historial de la extensión (hasta 8000 contactos)
MAX_LOG = 2000                  # líneas de log que se guardan por tarea
MAX_TAREAS = 50                 # tareas viejas que se recuerdan
ESTADOS_VIVOS = ("en_cola", "trabajando")
ESTADOS = ("en_cola", "trabajando", "terminado", "error", "ayuda", "cancelado")
ID_RE = re.compile(r"^[a-f0-9]{12}$")
ORIGEN_RE = re.compile(r"^chrome-extension://[a-p]{32}$")


# ---------------------------------------------------------------------
# Configuración y clave
# ---------------------------------------------------------------------
def leer_token(home=HOME_NAVI, crear=True):
    """La clave del puente. Se crea la primera vez (permisos 600) y nunca sale de la Mac salvo a la extensión."""
    home.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(home, 0o700)
    except OSError:
        pass
    p = home / "token"
    if p.exists():
        t = p.read_text().strip()
        if len(t) >= 24:
            return t
    if not crear:
        return ""
    t = secrets.token_urlsafe(32)
    fd = os.open(str(p), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(t + "\n")
    os.chmod(p, 0o600)
    return t


def leer_config(home=HOME_NAVI):
    p = home / "config.json"
    try:
        c = json.loads(p.read_text())
        return c if isinstance(c, dict) else {}
    except (OSError, ValueError):
        return {}


def origenes_permitidos(config):
    ids = config.get("extension_ids") or []
    if config.get("extension_id"):
        ids = [config["extension_id"], *ids]
    return {f"chrome-extension://{i}" for i in ids if isinstance(i, str) and re.fullmatch(r"[a-p]{32}", i)}


def carpeta_descargas(config):
    base = config.get("descargas") or str(Path.home() / "Downloads" / "navi")
    return Path(os.path.expanduser(base))


def buscar_browser_use(config):
    """launchd arranca con un PATH mínimo: se busca en los lugares donde lo deja `uv tool install`."""
    c = config.get("browser_use")
    if c and Path(c).exists():
        return c
    for p in (shutil.which("browser-use"), str(Path.home() / ".local/bin/browser-use"), "/opt/homebrew/bin/browser-use", "/usr/local/bin/browser-use"):
        if p and Path(p).exists():
            return p
    return None


def brave_responde(cdp_url, timeout=1.5):
    """¿Hay un navegador con depuración remota en el 9222? Regresa el nombre del navegador o None."""
    try:
        with urllib.request.urlopen(cdp_url.rstrip("/") + "/json/version", timeout=timeout) as r:
            v = json.loads(r.read().decode("utf-8", "replace"))
        if isinstance(v, dict) and v.get("webSocketDebuggerUrl"):
            return v.get("Browser") or "navegador"
    except (OSError, ValueError):
        pass
    return None


# ---------------------------------------------------------------------
# Recetas: se leen SIN ejecutarlas (ast), solo su diccionario META
# ---------------------------------------------------------------------
TIPOS = ("url", "bool", "int", "texto")


def leer_meta(archivo):
    arbol = ast.parse(Path(archivo).read_text(encoding="utf-8"), filename=str(archivo))
    for nodo in arbol.body:
        if isinstance(nodo, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "META" for t in nodo.targets):
            meta = ast.literal_eval(nodo.value)
            break
    else:
        raise ValueError(f"{archivo.name} no tiene META")
    if not isinstance(meta, dict) or meta.get("nombre") != Path(archivo).stem:
        raise ValueError(f"{archivo.name}: META.nombre debe ser '{Path(archivo).stem}'")
    for n, p in (meta.get("params") or {}).items():
        if not re.fullmatch(r"[a-z_]{1,30}", n) or p.get("tipo") not in TIPOS:
            raise ValueError(f"{archivo.name}: parámetro inválido {n}")
    return meta


def cargar_recetas(directorio=RECETAS_DIR):
    recetas = {}
    for f in sorted(Path(directorio).glob("*.py")):
        if f.name.startswith("_"):
            continue
        meta = leer_meta(f)
        recetas[meta["nombre"]] = {"meta": meta, "archivo": f}
    return recetas


class ParamError(ValueError):
    pass


def validar_params(meta, params):
    """Valida y limpia los parámetros. Rechaza los que la receta no conoce. Regresa un dict nuevo."""
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise ParamError("params debe ser un objeto")
    defs = meta.get("params") or {}
    sobran = [k for k in params if k not in defs]
    if sobran:
        raise ParamError(f"parámetros que la receta no conoce: {', '.join(map(str, sobran))}")
    limpio = {}
    for nombre, d in defs.items():
        v = params.get(nombre)
        if v is None or v == "":
            if d.get("requerido"):
                raise ParamError(f"falta {nombre}")
            if "defecto" in d:
                limpio[nombre] = d["defecto"]
            continue
        t = d["tipo"]
        if t == "bool":
            if isinstance(v, bool):
                limpio[nombre] = v
            elif isinstance(v, str) and v.lower() in ("true", "false", "si", "sí", "no", "1", "0"):
                limpio[nombre] = v.lower() in ("true", "si", "sí", "1")
            else:
                raise ParamError(f"{nombre} debe ser sí o no")
        elif t == "int":
            if isinstance(v, bool):
                raise ParamError(f"{nombre} debe ser un número")
            try:
                n = int(str(v).strip())
            except ValueError:
                raise ParamError(f"{nombre} debe ser un número entero")
            if ("min" in d and n < d["min"]) or ("max" in d and n > d["max"]):
                raise ParamError(f"{nombre} debe estar entre {d.get('min')} y {d.get('max')}")
            limpio[nombre] = n
        elif t == "texto":
            if not isinstance(v, str):
                raise ParamError(f"{nombre} debe ser texto")
            s = v.strip()
            if len(s) > int(d.get("max", 200)) or any(ord(c) < 32 for c in s):
                raise ParamError(f"{nombre} es demasiado largo o trae caracteres raros")
            if d.get("patron") and not re.fullmatch(d["patron"], s):
                raise ParamError(f"{nombre} no tiene el formato correcto")
            limpio[nombre] = s
        elif t == "url":
            limpio[nombre] = validar_url(nombre, v, d)
    return limpio


def validar_url(nombre, v, d):
    if not isinstance(v, str) or len(v) > 500 or any(ord(c) <= 32 or c in "\"'<>\\`" for c in v.strip()):
        raise ParamError(f"{nombre}: la dirección no es válida")
    u = urllib.parse.urlsplit(v.strip())
    if u.scheme != "https":
        raise ParamError(f"{nombre}: debe empezar con https://")
    if u.username or u.password or u.port:
        raise ParamError(f"{nombre}: la dirección no es válida")
    hosts = d.get("hosts") or []
    if (u.hostname or "").lower() not in hosts:
        raise ParamError(f"{nombre}: solo se aceptan direcciones de {', '.join(hosts)}")
    ruta = u.path if u.path.endswith("/") else u.path + "/"
    if d.get("ruta") and not re.fullmatch(d["ruta"], ruta):
        raise ParamError(f"{nombre}: no parece {d.get('etiqueta', 'la página correcta')}")
    # se reconstruye limpia: sin query ni fragmento
    return urllib.parse.urlunsplit(("https", "www.homes.com" if u.hostname.lower() == "homes.com" else u.hostname.lower(), ruta, "", ""))


def recetas_publicas(recetas):
    out = []
    for nombre, r in recetas.items():
        m = r["meta"]
        out.append({"nombre": nombre, "titulo": m.get("titulo", nombre), "descripcion": m.get("descripcion", ""),
                    "params": {k: {kk: vv for kk, vv in p.items() if kk in ("tipo", "requerido", "etiqueta", "defecto", "min", "max", "ejemplo", "hosts")}
                               for k, p in (m.get("params") or {}).items()}})
    return out


# ---------------------------------------------------------------------
# Tareas: fila y trabajador (una a la vez)
# ---------------------------------------------------------------------
class Tareas:
    def __init__(self, puente):
        self.p = puente
        self.lock = threading.Lock()
        self.cond = threading.Condition(self.lock)
        self.tareas = collections.OrderedDict()
        self.fila = collections.deque()
        self.actual = None
        self.proceso = None
        self.hilo = threading.Thread(target=self._trabajar, name="navi-trabajador", daemon=True)
        self.hilo.start()

    def crear(self, receta, params):
        t = {"id": uuid.uuid4().hex[:12], "receta": receta, "params": params, "estado": "en_cola", "log": [],
             "resultado": None, "error": None, "ayuda": None, "creada": time.time(), "inicio": None, "fin": None, "cancelar": False}
        with self.cond:
            self.tareas[t["id"]] = t
            self.fila.append(t["id"])
            self._podar()
            self.cond.notify()
        self.anotar(t, f"En fila: {receta}.")
        return t

    def _podar(self):
        while len(self.tareas) > MAX_TAREAS:
            viejo = next((k for k, v in self.tareas.items() if v["estado"] not in ESTADOS_VIVOS), None)
            if not viejo:
                break
            self.tareas.pop(viejo)

    def ver(self, tid):
        with self.lock:
            t = self.tareas.get(tid)
            if not t:
                return None
            pos = list(self.fila).index(tid) + 1 if tid in self.fila else 0
            return {k: (list(v) if k == "log" else v) for k, v in t.items() if k not in ("cancelar", "_progreso")} | {"en_fila": pos}

    def cancelar(self, tid):
        with self.lock:
            t = self.tareas.get(tid)
            if not t:
                return None
            if t["estado"] == "en_cola":
                self.fila.remove(tid)
                t["estado"], t["fin"] = "cancelado", time.time()
            elif t["estado"] == "trabajando":
                t["cancelar"] = True
                proc = self.proceso
            else:
                return t["estado"]
        if t["estado"] == "cancelado":
            self.anotar(t, "Cancelada antes de empezar.")
            return "cancelado"
        self.anotar(t, "Cancelando…")
        if proc and proc.poll() is None:
            parar_proceso(proc)
        return "cancelando"

    def anotar(self, t, linea):
        linea = str(linea).rstrip()[:500]
        if not linea:
            return
        with self.lock:
            t["log"].append(f"{time.strftime('%H:%M:%S')} {linea}")
            if len(t["log"]) > MAX_LOG:
                del t["log"][: len(t["log"]) - MAX_LOG]

    def resumen(self):
        with self.lock:
            return {"actual": self.actual, "en_cola": len(self.fila)}

    def _trabajar(self):
        while True:
            with self.cond:
                while not self.fila:
                    self.cond.wait()
                tid = self.fila.popleft()
                t = self.tareas.get(tid)
                if not t or t["estado"] != "en_cola":
                    continue
                t["estado"], t["inicio"] = "trabajando", time.time()
                self.actual = tid
            try:
                self.p.correr(t, self)
            except Exception as e:  # nunca se cae el trabajador
                with self.lock:
                    t["estado"], t["error"] = "error", f"Error del puente: {e}"
                self.anotar(t, f"Error del puente: {e}")
            finally:
                with self.lock:
                    if t["estado"] == "trabajando":
                        t["estado"] = "error"
                        t["error"] = t["error"] or "La receta terminó sin decir cómo le fue."
                    t["fin"] = time.time()
                    self.actual = None
                    self.proceso = None
                self.p.guardar_historial(t)


def parar_proceso(proc):
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (OSError, AttributeError):
        proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (OSError, AttributeError):
            proc.kill()


# ---------------------------------------------------------------------
# El puente
# ---------------------------------------------------------------------
class Puente:
    def __init__(self, home=HOME_NAVI, recetas_dir=RECETAS_DIR):
        self.home = Path(home)
        self.recetas_dir = Path(recetas_dir)
        self.token = leer_token(self.home)
        self.config = leer_config(self.home)
        self.origenes = origenes_permitidos(self.config)
        self.recetas = cargar_recetas(self.recetas_dir)
        self.cdp_url = self.config.get("cdp_url") or os.environ.get("BU_CDP_URL") or "http://127.0.0.1:9222"
        self.tareas = Tareas(self)
        self.carpetas = set()  # carpetas creadas por el puente (las únicas que se pueden abrir en Finder)
        # Fase A: llavero y servicios en segundo plano
        self.llavero = llaves_mod.abrir(self.home, self.config)
        self.arbitro = arbitro_mod.Arbitro(self.home)
        self.servicios = servicios_mod.Gestor(servicios_mod.Contexto(self.home, self.config, self.llavero), servicios_mod.todas())

    def token_ok(self, valor):
        return bool(valor) and hmac.compare_digest(str(valor).encode(), self.token.encode())

    def salud(self):
        navegador = brave_responde(self.cdp_url)
        return {"ok": True, "version": VERSION, "brave": bool(navegador), "navegador": navegador, "cdp_url": self.cdp_url,
                "browser_use": bool(buscar_browser_use(self.config)), "recetas": sorted(self.recetas),
                "origenes_configurados": len(self.origenes), "llavero": self.llavero.tipo,
                "servicios": {s["nombre"]: s["estado"] for s in self.servicios.lista()}, "cerebro": self.arbitro.resumen(), **self.tareas.resumen()}

    def guardar_historial(self, t):
        try:
            d = self.home / "tareas"
            d.mkdir(parents=True, exist_ok=True)
            (d / f"{t['id']}.json").write_text(json.dumps({k: v for k, v in t.items() if k not in ("cancelar", "_progreso")}, ensure_ascii=False, indent=1))
        except OSError:
            pass

    def preparar_salida(self, receta):
        fecha = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
        base = carpeta_descargas(self.config) / receta / fecha
        n = 2
        while base.exists():
            base = carpeta_descargas(self.config) / receta / f"{fecha}-{n}"
            n += 1
        base.mkdir(parents=True)
        return base

    def guion(self, receta):
        """El script que se le pasa a browser-use: las funciones comunes + la receta. Archivos fijos del repo, sin parámetros adentro."""
        comun = (self.recetas_dir / "_comun.py").read_text(encoding="utf-8")
        cuerpo = self.recetas[receta]["archivo"].read_text(encoding="utf-8")
        return comun + "\n\n# ===== receta: " + receta + " =====\n" + cuerpo + "\n"

    def correr(self, t, tareas):
        bu = buscar_browser_use(self.config)
        if not bu:
            t["estado"], t["error"] = "error", "No encuentro browser-use. Instálalo con: uv tool install browser-use"
            tareas.anotar(t, t["error"])
            return
        navegador = brave_responde(self.cdp_url)
        if not navegador:
            t["estado"], t["error"] = "error", "Brave no responde en el 9222. Abre Brave con brave-ia."
            tareas.anotar(t, t["error"])
            return
        try:
            salida = self.preparar_salida(t["receta"])
        except OSError as e:
            t["estado"], t["error"] = "error", f"No pude crear la carpeta de descargas ({e}). Revisa los permisos de la carpeta Descargas."
            tareas.anotar(t, t["error"])
            return
        self.carpetas.add(str(salida))
        tareas.anotar(t, f"Conectado a {navegador}. Guardo en {salida}")
        meta = self.recetas[t["receta"]]["meta"]
        env = {**os.environ,
               "NAVI_PARAMS": json.dumps(t["params"], ensure_ascii=False),
               "NAVI_SALIDA": str(salida),
               "NAVI_RECETA": t["receta"],
               "NAVI_HOME": str(self.home),
               "BU_CDP_URL": self.cdp_url,
               "BU_NAME": "navi",                    # daemon propio de Navi
               "BH_TELEMETRY": "0",                  # no mandar el código ni lo que imprime a la telemetría
               "BROWSER_USE_NO_UPDATE_CHECK": "1",
               "BH_TAB_MARKER": "0",
               "PYTHONUNBUFFERED": "1",
               "PYTHONIOENCODING": "utf-8"}
        env["PATH"] = os.pathsep.join([str(Path(bu).parent), env.get("PATH", "/usr/bin:/bin")])
        proc = subprocess.Popen([bu], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                env=env, cwd=str(salida), text=True, encoding="utf-8", errors="replace", bufsize=1,
                                start_new_session=True)
        with tareas.lock:
            tareas.proceso = proc
        limite = time.time() + 60 * int(meta.get("minutos_max", 20))
        vigia = threading.Timer(max(1, limite - time.time()), lambda: (tareas.anotar(t, "Se pasó del tiempo máximo; la detengo."), parar_proceso(proc)))
        vigia.daemon = True
        vigia.start()
        try:
            proc.stdin.write(self.guion(t["receta"]))
            proc.stdin.close()
        except OSError:
            pass
        ultimas = collections.deque(maxlen=8)
        try:
            for linea in proc.stdout:
                linea = linea.rstrip("\n")
                if linea.startswith("NAVI:"):
                    self._evento(t, tareas, linea[5:])
                    continue
                if linea.strip():
                    ultimas.append(linea)
                    tareas.anotar(t, linea)
            codigo = proc.wait()
        finally:
            vigia.cancel()
            try:
                proc.stdout.close()
            except OSError:
                pass
        with tareas.lock:
            if t["cancelar"]:
                t["estado"], t["error"] = "cancelado", None
            elif t["ayuda"]:
                t["estado"] = "ayuda"
            elif codigo == 0 and t["resultado"] is not None:
                t["estado"] = "terminado"
            else:
                t["estado"] = "error"
                t["error"] = t["error"] or explicar_error(codigo, list(ultimas))
        tareas.anotar(t, {"terminado": "¡Terminé!", "cancelado": "Cancelada.", "ayuda": "Necesito ayuda: " + str(t["ayuda"]),
                          "error": "Error: " + str(t["error"])}.get(t["estado"], t["estado"]))

    def _evento(self, t, tareas, texto):
        try:
            ev = json.loads(texto)
        except ValueError:
            tareas.anotar(t, texto)
            return
        tipo = ev.get("tipo")
        if tipo == "resultado":
            with tareas.lock:
                t["resultado"] = {k: v for k, v in ev.items() if k != "tipo"}
        elif tipo == "ayuda":
            with tareas.lock:
                t["ayuda"] = str(ev.get("motivo") or "la página pide verificación (CAPTCHA)")[:300]
            tareas.anotar(t, "CAPTCHA o verificación: me detengo. Resuélvela en Brave y vuelve a arrancar.")
        elif tipo == "error":
            with tareas.lock:
                t["error"] = str(ev.get("motivo") or "error")[:300]
        elif tipo == "carpeta":
            # una sub-carpeta dentro de la salida (ej. fotos de cada listing)
            p = Path(str(ev.get("ruta", "")))
            if str(p).startswith(str(carpeta_descargas(self.config))):
                self.carpetas.add(str(p))
        elif tipo == "progreso":
            # el avance (Foto 3 de 24…) se actualiza en la misma línea para no llenar el log
            linea = f"{time.strftime('%H:%M:%S')} {str(ev.get('txt') or '')[:200]}"
            with tareas.lock:
                if t["log"] and t.get("_progreso") and t["log"][-1] == t["_progreso"]:
                    t["log"][-1] = linea
                else:
                    t["log"].append(linea)
                t["_progreso"] = linea
        else:
            tareas.anotar(t, ev.get("txt") or texto)

    def abrir(self, tid):
        v = self.tareas.ver(tid)
        if not v or not v.get("resultado"):
            return "esa tarea no tiene carpeta"
        carpeta = str(v["resultado"].get("carpeta") or "")
        if carpeta not in self.carpetas or not Path(carpeta).is_dir():
            return "esa carpeta no la creó el puente"
        if sys.platform == "darwin":
            subprocess.Popen(["/usr/bin/open", carpeta])
            return None
        return "solo se puede abrir en macOS"


def explicar_error(codigo, ultimas):
    txt = " ".join(ultimas)[-600:]
    if re.search(r"9222|connect|ECONNREFUSED|remote debugging|DevTools", txt, re.I):
        return "Browser Use no pudo conectarse a Brave. Abre Brave con brave-ia."
    if re.search(r"Operation not permitted|Permission denied", txt, re.I):
        return "macOS no dejó guardar en Descargas. Dale permiso a Python (Ajustes → Privacidad → Archivos y carpetas)."
    return f"La receta falló (código {codigo}). Últimas líneas: {ultimas[-1] if ultimas else 'sin salida'}"


# ---------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------
def hacer_manejador(puente):
    class Manejador(http.server.BaseHTTPRequestHandler):
        server_version = "NaviPuente/" + VERSION
        sys_version = ""

        def log_message(self, fmt, *args):  # una línea por petición (nunca se escribe el token)
            if os.environ.get("NAVI_SIN_LOG"):
                return
            sys.stderr.write("%s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), fmt % args))

        # --- seguridad ---
        def _origen(self):
            return self.headers.get("Origin")

        def _host_ok(self):
            # Contra "DNS rebinding": solo se acepta si el navegador nos llamó por 127.0.0.1 o localhost
            h = (self.headers.get("Host") or "").lower()
            return h in (f"127.0.0.1:{self.server.server_address[1]}", f"localhost:{self.server.server_address[1]}")

        def _cors(self):
            o = self._origen()
            if o and o in puente.origenes:
                self.send_header("Access-Control-Allow-Origin", o)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Headers", "X-Navi-Token, Content-Type")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Access-Control-Max-Age", "600")

        def _json(self, codigo, datos):
            cuerpo = json.dumps(datos, ensure_ascii=False).encode("utf-8")
            self.send_response(codigo)
            self._cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(cuerpo)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(cuerpo)

        def _filtro(self):
            """True si la petición puede seguir. Si no, ya contestó."""
            if not self._host_ok():
                self._json(403, {"error": "host no permitido"})
                return False
            o = self._origen()
            if o and o not in puente.origenes:
                self._json(403, {"error": "origen no permitido; agrega el ID de la extensión en ~/.navi/config.json"})
                return False
            if not puente.token_ok(self.headers.get("X-Navi-Token")):
                self._json(401, {"error": "falta la clave del puente o no coincide"})
                return False
            return True

        def _cuerpo(self, maximo=MAX_CUERPO):
            n = int(self.headers.get("Content-Length") or 0)
            if n > maximo:
                raise ParamError("la petición es demasiado grande")
            datos = self.rfile.read(n) if n else b"{}"
            try:
                j = json.loads(datos.decode("utf-8") or "{}")
            except ValueError:
                raise ParamError("el cuerpo no es JSON")
            if not isinstance(j, dict):
                raise ParamError("el cuerpo debe ser un objeto JSON")
            return j

        # --- métodos ---
        def do_OPTIONS(self):
            o = self._origen()
            if not self._host_ok() or not o or o not in puente.origenes:
                self.send_response(403)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_response(204)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            if not self._filtro():
                return
            ruta = urllib.parse.urlsplit(self.path).path.rstrip("/") or "/"
            if ruta == "/salud":
                return self._json(200, puente.salud())
            if ruta == "/recetas":
                return self._json(200, {"recetas": recetas_publicas(puente.recetas)})
            m = re.fullmatch(r"/tarea/([a-f0-9]{12})", ruta)
            if m:
                v = puente.tareas.ver(m.group(1))
                return self._json(200, v) if v else self._json(404, {"error": "no existe esa tarea"})
            if ruta == "/llaves":
                return self._json(200, {"llavero": puente.llavero.tipo, "llaves": llaves_mod.estado(puente.llavero)})
            if ruta == "/cerebro/resumen":
                return self._json(200, puente.arbitro.resumen())
            if ruta == "/cerebro/contactos":
                q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                try:
                    desde = float((q.get("desde") or ["0"])[0])
                except ValueError:
                    return self._json(400, {"error": "desde debe ser un número"})
                return self._json(200, {"instancia": puente.arbitro.instancia, "contactos": puente.arbitro.contactos_desde(desde)})
            if ruta == "/bajas":
                return self._json(200, {"instancia": puente.arbitro.instancia, "bajas": puente.arbitro.bajas})
            if ruta == "/servicios":
                return self._json(200, {"servicios": puente.servicios.lista()})
            m = re.fullmatch(r"/servicios/([a-z_]{1,30})", ruta)
            if m:
                v = puente.servicios.uno(m.group(1))
                return self._json(200, v) if v else self._json(404, {"error": "no existe ese servicio"})
            self._json(404, {"error": "no existe"})

        def do_POST(self):
            if not self._filtro():
                return
            ruta = urllib.parse.urlsplit(self.path).path.rstrip("/")
            try:
                if ruta == "/tarea":
                    j = self._cuerpo()
                    receta = j.get("receta")
                    if not isinstance(receta, str) or receta not in puente.recetas:
                        return self._json(400, {"error": f"no existe la receta {str(receta)[:40]!r}", "recetas": sorted(puente.recetas)})
                    params = validar_params(puente.recetas[receta]["meta"], j.get("params"))
                    t = puente.tareas.crear(receta, params)
                    return self._json(201, {"id": t["id"], "estado": t["estado"], "params": params})
                m = re.fullmatch(r"/tarea/([a-f0-9]{12})/(cancelar|abrir)", ruta)
                if m:
                    if m.group(2) == "cancelar":
                        r = puente.tareas.cancelar(m.group(1))
                        return self._json(404, {"error": "no existe esa tarea"}) if r is None else self._json(200, {"estado": r})
                    err = puente.abrir(m.group(1))
                    return self._json(400, {"error": err}) if err else self._json(200, {"ok": True})
                if ruta == "/llaves":
                    j = self._cuerpo()
                    puente.llavero.guardar(j.get("nombre"), j.get("valor"))
                    puente.servicios.ahora("lofty_salud")  # que revise la llave nueva ya
                    return self._json(200, {"ok": True, "llaves": llaves_mod.estado(puente.llavero)})
                if ruta == "/llaves/borrar":
                    j = self._cuerpo()
                    puente.llavero.borrar(j.get("nombre"))
                    return self._json(200, {"ok": True, "llaves": llaves_mod.estado(puente.llavero)})
                m = re.fullmatch(r"/servicios/([a-z_]{1,30})/(prender|apagar|ahora)", ruta)
                if m:
                    n, accion = m.groups()
                    v = puente.servicios.ahora(n) if accion == "ahora" else puente.servicios.prender(n, accion == "prender")
                    return self._json(200, v) if v else self._json(404, {"error": "no existe ese servicio"})
                if ruta == "/cerebro/importar":
                    return self._json(200, puente.arbitro.importar(self._cuerpo(MAX_IMPORTAR)))
                if ruta == "/cerebro/anotar":
                    j = self._cuerpo()
                    lista = j.get("contactos") if isinstance(j.get("contactos"), list) else [j.get("contacto") or j]
                    nuevos = sum(1 for c in lista[:200] if puente.arbitro.anotar(c))
                    return self._json(200, {"ok": True, "nuevos": nuevos})
                if ruta == "/cerebro/revisar":
                    return self._json(200, puente.arbitro.revisar(self._cuerpo()))
                m = re.fullmatch(r"/bajas/(marcar|quitar|revisar)", ruta)
                if m:
                    j = self._cuerpo()
                    if m.group(1) == "marcar":
                        return self._json(200, {"ok": True, "nuevas": puente.arbitro.marcar_baja(j)})
                    if m.group(1) == "quitar":
                        return self._json(200, {"ok": True, "quitadas": puente.arbitro.quitar_baja(j)})
                    return self._json(200, {"baja": puente.arbitro.baja_de(j)})
                if ruta == "/turno":
                    j = self._cuerpo()
                    return self._json(200, {"esperar_ms": puente.arbitro.turno(j.get("cuenta"), j.get("minimo_ms") or 0)})
            except (ParamError, llaves_mod.LlaveError, arbitro_mod.ArbitroError) as e:
                return self._json(400, {"error": str(e)})
            self._json(404, {"error": "no existe"})

        def do_PUT(self):
            self._json(405, {"error": "método no permitido"})

        do_DELETE = do_PATCH = do_PUT

    return Manejador


def servidor(puente, puerto=PUERTO):
    srv = http.server.ThreadingHTTPServer((HOST, puerto), hacer_manejador(puente))
    srv.daemon_threads = True
    return srv


def main():
    puente = Puente()
    srv = servidor(puente)
    puente.servicios.arrancar()
    if not puente.origenes:
        print("Aviso: ~/.navi/config.json no tiene el ID de la extensión; la extensión no podrá hablar con el puente.", file=sys.stderr)
    print(f"Puente de Navi {VERSION} escuchando en http://{HOST}:{srv.server_address[1]} · recetas: {', '.join(sorted(puente.recetas))}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
