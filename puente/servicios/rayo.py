# =====================================================================
# Rayo en el puente (Fase C): llega antes que Anna a los leads nuevos AUNQUE BRAVE ESTÉ CERRADO.
# Es el mismo Rayo de ry.js, en Python:
#   · cada 60 s busca en Lofty los leads creados desde la última vez (solo de las fuentes elegidas);
#   · filtros: número de California, sin DNC / Do Not Text, sin cannotText / unsubscribe, sin duplicados;
#   · a cada lead que pasa le prepara SMS (nombre y ciudad), email y lugar en la fila de Marki;
#   · "Con mi OK": espera la aprobación (pantalla de Rayo o Capi). "Automático": sale solo;
#   · carrera con Anna: si ya le escribió (SMS "AI"), ganó Anna; si no, la silencia ANTES de contactar
#     (si no puede silenciarla, no contacta) y vigila 30 min por si Anna lo agarra tarde;
#   · todo pasa por el ÁRBITRO (Cerebro compartido: 24 h, persona, bajas) y la política (8–21 h, solo CA);
#     de noche queda "programado" y sale a las 8 am; el turno del número lo reparte el árbitro.
# Modos (los elige la pantalla de Rayo):
#   · puente: Rayo trabaja aquí y la extensión solo muestra y aprueba.
#   · sombra: la extensión trabaja como siempre y aquí solo se ANOTA lo que se haría (no manda, no silencia,
#     no llena la fila de Marki, no anota en el Cerebro). Sirve para comparar antes de cambiar.
# Las llaves salen del Llavero (llavero.py): la de la cuenta elegida y, para Anna, la principal.
# Estado en ~/.navi/rayo.json (600).
# =====================================================================
import datetime
import json
import os
import random
import re
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import reglas

from . import Servicio

VIGILAR_MS = 30 * 60e3
POOL_TTL = 10 * 60e3
MAX_TARJETAS = 500
OPTOUT = re.compile(r"unsubscrib|do not (text|call)|opt.?out|dnc", re.I)
DEF = {
    "modo": "ok", "cuenta": "txKey", "fuentes": "zBuyer", "sms": True, "email": True, "marki": True,
    "smsSeller": "Hi {nombre}, this is Mark with Rubio Real Estate. I saw your request about your home in {ciudad}. When's a good time for a quick call about its value? Reply STOP to opt out.",
    "smsBuyer": "Hi {nombre}, this is Mark with Rubio Real Estate. I saw you're looking for a home in {ciudad}. What are you looking for? I can send you the best options. Reply STOP to opt out.",
    "emailAsunto": "Your home in {ciudad}",
    "emailCuerpo": "Hi {nombre},\n\nThanks for reaching out about your home in {ciudad}. I'm Mark with Rubio Real Estate.\n\nWhat's a good time for a quick call?\n\nBest,\nMark\nRubio Real Estate",
    "politica": {"desde": 8, "hasta": 21},
}
TEXTOS = ("smsSeller", "smsBuyer", "emailAsunto", "emailCuerpo")


class SinLlave(Exception):
    pass


class LoftyError(Exception):
    def __init__(self, status, msg):
        super().__init__(f"Lofty respondió {status}{': ' + msg if msg else ''}")
        self.status = status


def ms():
    return time.time() * 1000


def tiempo(s):
    """Como `tiempo` de ry.js: "2026-01-15T17:58:00GMT" → ms. Sin zona = hora local de la Mac."""
    s = re.sub(r"(GMT|P[SD]T)$", lambda m: "Z" if m.group(1) == "GMT" else "", str(s or "").strip())
    m = re.match(r"^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d(?::\d\d)?)(\.\d+)?(Z|[+-]\d\d:?\d\d)?$", s)
    if not m:
        return 0
    base = datetime.datetime.fromisoformat(f"{m.group(1)}T{m.group(2)}")
    zona = m.group(4)
    if zona == "Z":
        base = base.replace(tzinfo=datetime.timezone.utc)
    elif zona:
        z = zona.replace(":", "")
        base = base.replace(tzinfo=datetime.timezone(datetime.timedelta(hours=int(z[:3]), minutes=int(z[0] + z[3:]))))
    return base.timestamp() * 1000


def tc(s):
    return re.sub(r"\b\w", lambda m: m.group(0).upper(), str(s or "").lower(), flags=re.A)


def bonito(d):
    return f"({d[:3]}) {d[3:6]}-{d[6:]}"


def de_lofty(x):
    d = str(x.get("direction") or "")
    return {"t": tiempo(x.get("textTime") or x.get("communicationTime") or x.get("createTime")),
            "direccion": "in" if re.search("in", d, re.I) and not re.search("out", d, re.I) else "out",
            "tipo": x.get("textType") or "", "agentId": x.get("agentId")}


def evaluar(l, ahora):
    """Igual que evaluar() de ry.js."""
    lid = str(l.get("leadId") or l.get("id"))
    tipos = [int(x) for x in list(l.get("leadTypes") or []) + ([l["leadType"]] if l.get("leadType") is not None else []) if str(x).lstrip("-").isdigit()]
    phones = [reglas.d10(p.get("phone") or p.get("number") if isinstance(p, dict) else p) for p in (l.get("phones") or [])]
    st = [int(x) if str(x).isdigit() else None for x in (l.get("phoneStatuses") or [])]
    cons = list(l.get("phoneConsentStates") or [])
    tels = []
    for i, p in enumerate(phones):
        if p and reglas.es_ca(p) and (st[i] if i < len(st) else None) not in (4, 5) and not OPTOUT.search(str(cons[i] if i < len(cons) else "")) and p not in tels:
            tels.append(p)
    props = l.get("leadPropertyList") or []
    p = next((x for x in props if re.search("home", x.get("label") or "", re.I) and x.get("city")), None) or next((x for x in props if x.get("city")), None) or l
    t = {"leadId": lid, "nombre": (tc(l.get("firstName") or "").split(" ")[0] or "there"), "apellido": tc(l.get("lastName") or ""),
         "ciudad": tc(p.get("city") or ""), "calle": tc(p.get("streetAddress") or ""), "tels": tels, "email": (list(l.get("emails") or []) or [""])[0],
         "fuente": l.get("source") or "", "comprador": 2 in tipos and 1 not in tipos, "creado": tiempo(l.get("createTime")) or ahora,
         "visto": ahora, "estado": "por aprobar", "motivo": "", "log": []}
    if l.get("cannotText") is True or l.get("unsubscription") is True:
        return {**t, "estado": "descartado", "motivo": "Lofty dice que no recibe textos (cannotText / unsubscribe)"}
    if not any(phones):
        return {**t, "estado": "descartado", "motivo": "no tiene teléfono"}
    if not tels:
        return {**t, "estado": "descartado", "motivo": "sus números no son de California" if any(x and not reglas.es_ca(x) for x in phones) else "sus números están como DNC / Do Not Text"}
    return t


def rellenar(txt, t):
    s = str(txt or "")
    for k, v in (("nombre", t["nombre"]), ("apellido", t["apellido"]), ("ciudad", t["ciudad"] or "your area"), ("direccion", t["calle"] or "your home")):
        s = re.sub(r"\{" + k + r"\}", lambda m, v=v: v, s, flags=re.I)
    return s.strip()


def limpiar_config(c, actual):
    out = dict(actual)
    if not isinstance(c, dict):
        return out
    if c.get("modo") in ("ok", "auto"):
        out["modo"] = c["modo"]
    if c.get("cuenta") in ("txKey", "loftyKey"):
        out["cuenta"] = c["cuenta"]
    if isinstance(c.get("fuentes"), str):
        out["fuentes"] = c["fuentes"][:200]
    for k in ("sms", "email", "marki"):
        if isinstance(c.get(k), bool):
            out[k] = c[k]
    for k in TEXTOS:
        if isinstance(c.get(k), str) and c[k].strip():
            out[k] = c[k][:3000]
    pol = c.get("politica")
    if isinstance(pol, dict):
        d = min(21, max(8, int(_num(pol.get("desde"), 8))))
        out["politica"] = {"desde": d, "hasta": min(21, max(d, int(_num(pol.get("hasta"), 21))))}
    return out


def _num(v, defecto):
    try:
        return float(v)
    except (TypeError, ValueError):
        return defecto


class Rayo(Servicio):
    nombre = "rayo"
    titulo = "Rayo (leads nuevos, en el puente)"
    descripcion = "Cada 60 s busca leads nuevos en Lofty y les llega antes que Anna (SMS, email y fila de Marki), aunque Brave esté cerrado. Se maneja desde la pantalla de Rayo."
    intervalo = 60
    activo_defecto = False

    def __init__(self, ctx):
        super().__init__(ctx)
        self.ruta = Path(ctx.home) / "rayo.json"
        self.mu = threading.RLock()
        d = self._leer()
        self.config = limpiar_config(d.get("config") or {}, DEF)
        self.sombra = bool(d.get("sombra"))
        self.ultimo = d.get("ultimo") or 0
        self.tarjetas = d.get("tarjetas") or {}
        self.cola = d.get("cola") or []
        self.vigilar = d.get("vigilar") or {}
        self.silenciados = d.get("silenciados") or {}
        self.registro = d.get("registro") or []
        self._pool = {"t": 0, "ids": set()}
        self.ms = ms  # reloj en milisegundos (las pruebas lo cambian)
        self.datos = self._datos()

    # ---------- disco ----------
    def _leer(self):
        try:
            d = json.loads(self.ruta.read_text())
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def guardar(self):
        with self.mu:
            ks = sorted(self.tarjetas, key=lambda k: self.tarjetas[k].get("creado", 0))
            for k in ks[: max(0, len(ks) - MAX_TARJETAS)]:
                del self.tarjetas[k]
            self.registro = self.registro[-1000:]
            datos = {"config": self.config, "sombra": self.sombra, "ultimo": self.ultimo, "tarjetas": self.tarjetas, "cola": self.cola,
                     "vigilar": self.vigilar, "silenciados": self.silenciados, "registro": self.registro}
            tmp = self.ruta.with_suffix(".tmp")
            fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                json.dump(datos, f)
            os.replace(tmp, self.ruta)
            self.datos = self._datos()

    def _datos(self):
        v = list(self.tarjetas.values())
        n = lambda e: sum(1 for x in v if x.get("estado") == e)  # noqa: E731
        return {"sombra": self.sombra, "por_aprobar": n("por aprobar"), "hechos": n("hecho"), "gano_anna": n("ganó Anna"), "cola": len(self.cola)}

    # ---------- Lofty ----------
    def api(self, path, llave=None, method="GET", body=None):
        nombre = llave or self.config["cuenta"]
        # Anna se revisa con la llave principal; si no está, con la de Texi (igual que el Cerebro de la extensión)
        key = (self.ctx.llavero.leer("loftyKey") or self.ctx.llavero.leer("txKey")) if nombre == "annaKey" else self.ctx.llavero.leer(nombre)
        if not key:
            raise SinLlave("falta la llave de Lofty en el puente (" + ("la de Texi" if nombre == "txKey" else "la principal") + "): mándala desde el Mando → Puente")
        data = json.dumps(body).encode() if body is not None else None
        for i in range(4):
            req = urllib.request.Request(self.ctx.lofty_api + path, data=data, method=method,
                                         headers={"Authorization": "token " + key, "X-Error-Status": "true", "Accept": "application/json",
                                                  **({"Content-Type": "application/json"} if data else {})})
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    txt = r.read().decode("utf-8", "replace")
                    return json.loads(txt) if txt else {}
            except urllib.error.HTTPError as e:
                if e.code == 429 and i < 3:
                    reset = int(_num(e.headers.get("X-RateLimit-Reset"), 0))
                    time.sleep(((reset if reset > 0 else 2000 * 2 ** i) + 200) / 1000)
                    continue
                try:
                    msg = str(json.loads(e.read().decode() or "{}").get("message") or "")[:140]
                except ValueError:
                    msg = ""
                raise LoftyError(e.code, msg)
        raise LoftyError(429, "demasiadas peticiones")

    # ---------- Anna ----------
    def pool_anna(self, forzar=False):
        if not forzar and self.ms() - self._pool["t"] < POOL_TTL:
            return self._pool["ids"]
        ids = set()
        for off in range(0, 5000, 100):
            d = self.api(f"/v2.0/working-leads?limit=100&offset={off}", "annaKey")
            fil = d.get("workingLeads") or d.get("leads") or d.get("data") or []
            ids.update(str(x.get("leadId")) for x in fil)
            total = (d.get("metadata") or {}).get("total") or 0
            if len(fil) < 100 or (total and len(ids) >= total):
                break
            time.sleep(0.3)
        self._pool = {"t": self.ms(), "ids": ids}
        return ids

    def muteado(self, lead_id):
        d = self.api(f"/v2.0/sales-agent/lead/mute-status?leadId={lead_id}", "annaKey")
        return bool(d.get("muted", (d.get("data") or {}).get("muted")))

    def silenciar(self, lead_id, motivo):
        self.api(f"/v2.0/sales-agents/working-lead/{lead_id}/mute", "annaKey", method="PUT")
        ok = self.muteado(lead_id)
        if ok:
            with self.mu:
                self.silenciados[lead_id] = {"t": self.ms(), "robot": "Rayo", "motivo": motivo[:120]}
        return ok

    # ---------- utilidades ----------
    def nota(self, t, s):
        t["log"] = (t.get("log") or [])[-11:] + [time.strftime("%d %b %H:%M") + " " + s]

    def registrar(self, ev):
        with self.mu:
            self.registro.append({"id": f"ry-{int(self.ms())}-{random.randint(0, 99999)}", "t": self.ms(), "fuente": "Rayo", **ev})

    def cuenta_sms(self):
        return "tx" if self.config["cuenta"] == "txKey" else "lofty"

    def duplicado(self, t):
        for tel in t["tels"]:
            d = self.api(f"/v1.0/leads?limit=5&phone={tel}")
            otro = next((x for x in (d.get("leads") or []) if str(x.get("leadId")) != t["leadId"]), None)
            if otro:
                return f"ya existe otro lead con el {bonito(tel)} ({tc(otro.get('firstName'))} {tc(otro.get('lastName'))}, id {otro.get('leadId')})"
            time.sleep(0.25)
        return ""

    # ---------- 1) buscar ----------
    def correr(self):
        try:
            self.buscar()
            if not self.sombra:
                self.procesar_aprobadas()
                self.vigilar_anna()
            pend = sum(1 for x in self.tarjetas.values() if x.get("estado") == "por aprobar")
            modo = "SOMBRA (solo anoto lo que haría)" if self.sombra else ("automático" if self.config["modo"] == "auto" else "con tu OK")
            self.poner("ayuda" if pend and not self.sombra else "feliz", f"Rayo en el puente, {modo}: {pend} por aprobar · {self.datos['hechos']} contactados · {self.datos['gano_anna']} ganó Anna.")
        except SinLlave as e:
            self.poner("error", str(e))
        except LoftyError as e:
            self.poner("error", f"Rayo no pudo revisar Lofty: {e}")
        finally:
            self.guardar()

    def buscar(self):
        ahora = self.ms()
        ultimo = self.ultimo or (ahora - 15 * 60e3)
        d = self.api("/v1.0/leads?limit=50&offset=0")
        fuentes = [s.strip().lower() for s in self.config["fuentes"].split(",") if s.strip()]
        nuevos = sorted((l for l in (d.get("leads") or []) if tiempo(l.get("createTime")) > ultimo and str(l.get("leadId")) not in self.tarjetas), key=lambda l: tiempo(l.get("createTime")))
        max_t = ultimo
        for l in nuevos:
            max_t = max(max_t, tiempo(l.get("createTime")))
            if fuentes and str(l.get("source") or "").lower() not in fuentes:
                continue
            t = evaluar(l, ahora)
            if t["estado"] != "descartado":
                try:
                    dup = self.duplicado(t)
                except (LoftyError, OSError) as e:
                    dup = f"no pude revisar duplicados ({e}); por seguridad no lo toco"
                if dup:
                    t = {**t, "estado": "descartado", "motivo": dup}
            if t["estado"] != "descartado":
                t["sms"] = rellenar(self.config["smsBuyer"] if t["comprador"] else self.config["smsSeller"], t)
                t["emailAsunto"] = rellenar(self.config["emailAsunto"], t)
                t["emailCuerpo"] = rellenar(self.config["emailCuerpo"], t)
            if self.sombra:
                t["sombra"] = True
            with self.mu:
                self.tarjetas[t["leadId"]] = t
            quien = f"{t['nombre']} {t['apellido']}".strip()
            if t["estado"] == "descartado":
                self.anotar(f"Lead nuevo {quien} descartado: {t['motivo']}.")
            else:
                self.anotar(f"Lead nuevo {quien} ({t['ciudad'] or 'sin ciudad'}){' — lo contacto ya' if self.config['modo'] == 'auto' and not self.sombra else ''}.")
            if self.sombra and t["estado"] == "por aprobar":
                self.simular(t)  # qué haría si lo aprobaran ya (sin tocar nada)
            elif t["estado"] == "por aprobar" and self.config["modo"] == "auto":
                t["estado"] = "aprobado"
        self.ultimo = max_t

    # ---------- 2) contactar ----------
    def procesar_aprobadas(self):
        for t in [x for x in list(self.tarjetas.values()) if x.get("estado") in ("aprobado", "programado")]:
            self.contactar(t)
            self.guardar()

    def aprobar(self, ids, por):
        n = 0
        with self.mu:
            for i in ids:
                t = self.tarjetas.get(str(i))
                if t and t.get("estado") == "por aprobar" and not self.sombra:
                    t["estado"] = "aprobado"
                    self.nota(t, f"aprobado por {por}")
                    n += 1
        if n:
            self.anotar(f"{n} lead(s) aprobados ({por}); los contacto ya.")
            self.guardar()
        return n

    def descartar(self, i):
        with self.mu:
            t = self.tarjetas.get(str(i))
            if t and t.get("estado") == "por aprobar":
                t["estado"], t["motivo"] = "descartado", "lo descartaste"
                self.guardar()
                return True
        return False

    def contactar(self, t):
        pol = self.config["politica"]
        if self.config["sms"] and not reglas.en_horario(pol, self.ms()):
            if t["estado"] != "programado":
                t["estado"] = "programado"
                self.nota(t, "fuera de horario: sale a las 8 am (California)")
            return
        t["estado"] = "contactando"
        quien = f"{t['nombre']} {t['apellido']}".strip()
        try:
            filas = self.api(f"/v1.0/communication/text?leadId={t['leadId']}&limit=40")
            textos = [de_lofty(x) for x in (filas.get("texts") or filas.get("data") or [])]
            if reglas.anna_ya_escribio(textos):
                t["estado"] = "ganó Anna"
                self.nota(t, "Anna ya le había escrito: no lo toco para no dar doble contacto")
                self.anotar(f"Anna llegó primero con {quien}.")
                return
            cb = self.ctx.arbitro.revisar({"leadId": t["leadId"], "canal": "sms", "robot": "Rayo", "textos": textos, "anna": {}, "respetaAnna": False})
            if not cb["ok"]:
                t["estado"], t["motivo"] = "saltado", cb["motivo"]
                self.nota(t, "Cerebro: " + cb["motivo"])
                return
            pool = self.pool_anna()
            if t["leadId"] in pool and not self.muteado(t["leadId"]):
                if not self.silenciar(t["leadId"], "Rayo llegó primero"):
                    t["estado"], t["motivo"] = "error", "no pude silenciar a Anna; no lo contacto para no dar doble contacto"
                    self.nota(t, t["motivo"])
                    return
                self.nota(t, "silencié a Anna en este lead")
            else:
                with self.mu:
                    self.vigilar[t["leadId"]] = self.ms()
            if self.config["marki"]:
                with self.mu:
                    if not any(str(x.get("leadId")) == t["leadId"] for x in self.cola):
                        self.cola.append({"leadId": t["leadId"], "t": self.ms(), "nombre": quien})
                self.nota(t, "en la cola de Marki para llamarlo")
            sms_ok = False
            if self.config["sms"] and t.get("sms"):
                num = t["tels"][0]
                cuenta = self.cuenta_sms()
                baja = self.ctx.arbitro.baja_de({"tel": num, "leadId": t["leadId"], "cuenta": cuenta})
                motivo = ("no es número de California" if not reglas.es_ca(num) else
                          f"baja permanente ({baja.get('motivo')})" if baja else
                          "fuera de horario" if not reglas.en_horario(pol, self.ms()) else "")
                if motivo:
                    self.registrar({"leadId": t["leadId"], "tel": num, "estado": "bloqueado", "motivo": motivo})
                    self.nota(t, "SMS no: " + motivo)
                else:
                    time.sleep(self.ctx.arbitro.turno(cuenta) / 1000)  # turno del número entre TODOS los robots
                    try:
                        self.api("/v1.0/message/sms/send", method="POST", body={"leadId": int(t["leadId"]), "content": t["sms"], "phoneNumber": num, "phoneCode": "1"})
                        self.ctx.arbitro.anotar({"leadId": t["leadId"], "canal": "sms", "robot": "Rayo", "tel": num})
                        self.registrar({"leadId": t["leadId"], "tel": num, "estado": "enviado", "texto": t["sms"]})
                        sms_ok = True
                        self.nota(t, f"SMS a {bonito(num)}")
                    except (LoftyError, OSError) as e:
                        self.registrar({"leadId": t["leadId"], "tel": num, "estado": "error", "motivo": str(e)})
                        self.nota(t, f"SMS falló: {e}")
            if self.config["email"] and t.get("email") and t.get("emailAsunto"):
                cbe = self.ctx.arbitro.revisar({"leadId": t["leadId"], "canal": "email", "robot": "Rayo", "textos": textos, "anna": {}, "respetaAnna": False})
                if not cbe["ok"]:
                    self.nota(t, "email no: " + cbe["motivo"])
                else:
                    try:
                        self.api("/v1.0/message/email/send", method="POST", body={"leadId": int(t["leadId"]), "subject": t["emailAsunto"], "content": t["emailCuerpo"].replace("\n", "<br>")})
                        self.ctx.arbitro.anotar({"leadId": t["leadId"], "canal": "email", "robot": "Rayo"})
                        self.nota(t, "email enviado")
                    except (LoftyError, OSError) as e:
                        self.nota(t, f"email falló: {e}")
            t["estado"] = "hecho" if sms_ok or not self.config["sms"] else "error"
            t["contactado"] = self.ms()
            t["segundos"] = round((t["contactado"] - t["creado"]) / 1000)
            self.anotar(f"Contacté a {quien} {round(t['segundos'] / 60)} min después de que entró a Lofty.")
        except (LoftyError, SinLlave, OSError) as e:
            t["estado"], t["motivo"] = "error", str(e)
            self.nota(t, f"error: {e}")
            self.anotar(f"No pude contactar a {quien}: {e}")

    # ---------- sombra: qué haría, sin tocar nada ----------
    def simular(self, t):
        try:
            filas = self.api(f"/v1.0/communication/text?leadId={t['leadId']}&limit=40")
            textos = [de_lofty(x) for x in (filas.get("texts") or filas.get("data") or [])]
            if reglas.anna_ya_escribio(textos):
                t["haria"] = "ganó Anna"
            else:
                cb = self.ctx.arbitro.revisar({"leadId": t["leadId"], "canal": "sms", "robot": "Rayo", "textos": textos, "anna": {}, "respetaAnna": False})
                if not cb["ok"]:
                    t["haria"], t["motivo"] = "saltar", cb["motivo"]
                else:
                    en_pool = t["leadId"] in self.pool_anna()
                    t["haria"] = "contactar"
                    t["motivo"] = ("silenciar a Anna, " if en_pool else "") + ("SMS" if self.config["sms"] else "") + (" + email" if self.config["email"] and t.get("email") else "") + (" + fila de Marki" if self.config["marki"] else "")
        except (LoftyError, SinLlave, OSError) as e:
            t["haria"], t["motivo"] = "error", str(e)
        t["simulado"] = self.ms()
        self.nota(t, f"sombra: haría {t['haria']}" + (f" ({t['motivo']})" if t.get("motivo") else ""))

    # ---------- 3) vigilar 30 min ----------
    def vigilar_anna(self):
        ahora = self.ms()
        with self.mu:
            ids = [k for k, v in self.vigilar.items() if ahora - v < VIGILAR_MS]
        if ids:
            try:
                pool = self.pool_anna(forzar=True)
            except (LoftyError, SinLlave, OSError):
                pool = set()
            for i in [x for x in ids if x in pool]:
                try:
                    if self.silenciar(i, "Rayo llegó primero (entró al pool después)"):
                        with self.mu:
                            self.vigilar.pop(i, None)
                        t = self.tarjetas.get(i)
                        if t:
                            self.nota(t, "Anna lo metió a su pool después: la silencié")
                except (LoftyError, OSError):
                    pass
        with self.mu:
            for k in [k for k, v in self.vigilar.items() if ahora - v >= VIGILAR_MS]:
                del self.vigilar[k]

    # ---------- lo que pide la pantalla de Rayo ----------
    def poner_config(self, config=None, modo=None):
        with self.mu:
            if config is not None:
                self.config = limpiar_config(config, self.config)
            if modo in ("puente", "sombra"):
                if self.sombra != (modo == "sombra"):
                    self.ultimo = 0  # al cambiar de modo empieza con los últimos 15 min
                self.sombra = modo == "sombra"
        self.guardar()

    def tomar_cola(self, ids):
        ids = {str(i) for i in ids}
        with self.mu:
            antes = len(self.cola)
            self.cola = [x for x in self.cola if str(x.get("leadId")) not in ids]
            n = antes - len(self.cola)
        self.guardar()
        return n

    def estado_publico(self):
        with self.mu:
            tarjetas = sorted(self.tarjetas.values(), key=lambda x: -x.get("creado", 0))[:200]
            return {"sombra": self.sombra, "config": self.config, "ultimo": self.ultimo, "tarjetas": tarjetas, "cola": list(self.cola),
                    "silenciados": dict(self.silenciados), **self.datos}

    def registro_desde(self, desde):
        with self.mu:
            return [e for e in self.registro if e["t"] >= desde]
