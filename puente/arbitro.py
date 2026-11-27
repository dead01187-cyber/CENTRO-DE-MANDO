# =====================================================================
# Árbitro del puente (Fase B): una sola fuente de verdad para TODOS los robots, estén en la extensión
# o en el puente:
#   · contactos del Cerebro  (quién le escribió/llamó a qué lead y cuándo)
#   · bajas permanentes      (STOP, número equivocado, DNC…), por teléfono y por lead
#   · turno del número de SMS (6–12 s entre SMS que salen del mismo número de Lofty)
# Las reglas son las de reglas.py (copia exacta de cerebro-core.js / politica-sms.js).
# Se guarda en ~/.navi/cerebro.json (permisos 600). Nunca llama a Lofty: lo que el robot ya leyó de Lofty
# (textos del lead, Anna) se lo manda el robot.
# =====================================================================
import json
import os
import random
import threading
import time
import uuid
from pathlib import Path

import reglas

MAX_CONTACTOS = 8000
CANALES = ("sms", "llamada", "email")
TURNO_MIN, TURNO_MAX = 6000, 12000   # ms entre SMS del mismo número (igual que Texi, Resi y Rayo)


class ArbitroError(ValueError):
    pass


def _ms():
    return time.time() * 1000


def _texto(v, n=60):
    return str(v if v is not None else "")[:n]


def _id_contacto(c):
    return c.get("id") or f"{c.get('leadId')}|{c.get('canal')}|{int(float(c.get('t') or 0))}"


class Arbitro:
    def __init__(self, home, reloj=_ms):
        self.ruta = Path(home) / "cerebro.json"
        self.reloj = reloj
        self.lock = threading.RLock()
        d = self._leer()
        self.instancia = d.get("instancia") or uuid.uuid4().hex[:12]
        self.contactos = d.get("contactos") or []
        self.bajas = d.get("bajas") or {"tels": {}, "leads": {}}
        self.bajas.setdefault("tels", {})
        self.bajas.setdefault("leads", {})
        self.turnos = d.get("turnos") or {}
        self.ids = {_id_contacto(c) for c in self.contactos}
        self.ultima_import = d.get("ultima_import")
        self._guardar()

    # ---------- disco ----------
    def _leer(self):
        try:
            d = json.loads(self.ruta.read_text())
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def _guardar(self):
        tmp = self.ruta.with_suffix(".tmp")
        datos = {"instancia": self.instancia, "contactos": self.contactos, "bajas": self.bajas, "turnos": self.turnos, "ultima_import": self.ultima_import}
        fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(datos, f)
        os.replace(tmp, self.ruta)
        os.chmod(self.ruta, 0o600)

    # ---------- contactos ----------
    def _limpiar_contacto(self, c):
        if not isinstance(c, dict):
            raise ArbitroError("contacto inválido")
        lead = _texto(c.get("leadId"), 40).strip()
        if not lead:
            raise ArbitroError("falta leadId")
        canal = c.get("canal") or "sms"
        if canal not in CANALES:
            raise ArbitroError("canal inválido")
        t = float(c.get("t") or self.reloj())
        if t > self.reloj() + 60e3:
            t = self.reloj()  # nadie anota en el futuro
        out = {"t": t, "leadId": lead, "canal": canal, "robot": _texto(c.get("robot"), 30), "tel": reglas.d10(c.get("tel")) or ""}
        out["id"] = _texto(c.get("id"), 40) or _id_contacto(out)
        return out

    def anotar(self, c, guardar=True):
        c = self._limpiar_contacto(c)
        with self.lock:
            if c["id"] in self.ids:
                return False
            self.contactos.append(c)
            self.ids.add(c["id"])
            if len(self.contactos) > MAX_CONTACTOS:
                self.contactos.sort(key=lambda x: x["t"])
                fuera = self.contactos[: len(self.contactos) - MAX_CONTACTOS]
                self.contactos = self.contactos[-MAX_CONTACTOS:]
                for x in fuera:
                    self.ids.discard(x["id"])
            if guardar:
                self._guardar()
        return True

    def contactos_desde(self, desde=0):
        with self.lock:
            return [c for c in self.contactos if c["t"] >= float(desde or 0)]

    def revisar(self, p):
        """La pregunta antes de contactar, con TODOS los contactos que conoce el árbitro."""
        lead = _texto(p.get("leadId"), 40).strip()
        if not lead:
            raise ArbitroError("falta leadId")
        canal = p.get("canal") or "sms"
        if canal not in CANALES:
            raise ArbitroError("canal inválido")
        textos = [x for x in (p.get("textos") or []) if isinstance(x, dict)][:500]
        with self.lock:
            contactos = list(self.contactos)
        r = reglas.revisar(self.reloj(), lead, canal=canal, contactos=contactos, textos=textos, anna=p.get("anna") or {},
                           respetaAnna=p.get("respetaAnna", True) is not False, esRespuesta=bool(p.get("esRespuesta")))
        r["fuente"] = "puente"
        return r

    # ---------- bajas ----------
    def marcar_baja(self, p):
        tels = [reglas.d10(x) for x in ([p.get("tel")] + list(p.get("tels") or [])) if x]
        tels = [x for x in tels if x]
        lead = _texto(p.get("leadId"), 40).strip()
        reg = {"t": float(p.get("t") or self.reloj()), "motivo": _texto(p.get("motivo") or "baja", 120), "fuente": _texto(p.get("fuente"), 30)}
        n = 0
        with self.lock:
            for d in tels:
                if d not in self.bajas["tels"]:
                    self.bajas["tels"][d] = reg
                    n += 1
            if lead:
                k = reglas.clave_lead(_texto(p.get("cuenta"), 10) or "tx", lead)
                if k not in self.bajas["leads"]:
                    self.bajas["leads"][k] = reg
                    n += 1
            if n:
                self._guardar()
        return n

    def quitar_baja(self, p):
        d = reglas.d10(p.get("tel"))
        lead = _texto(p.get("leadId"), 40).strip()
        n = 0
        with self.lock:
            if d and self.bajas["tels"].pop(d, None) is not None:
                n += 1
            if lead and self.bajas["leads"].pop(reglas.clave_lead(_texto(p.get("cuenta"), 10) or "tx", lead), None) is not None:
                n += 1
            if n:
                self._guardar()
        return n

    def baja_de(self, p):
        d = reglas.d10(p.get("tel"))
        lead = _texto(p.get("leadId"), 40).strip()
        with self.lock:
            if d and d in self.bajas["tels"]:
                return self.bajas["tels"][d]
            k = reglas.clave_lead(_texto(p.get("cuenta"), 10) or "tx", lead)
            if lead and k in self.bajas["leads"]:
                return self.bajas["leads"][k]
        return None

    # ---------- turno del número ----------
    def turno(self, cuenta, minimo_ms=0):
        """Aparta el siguiente lugar para mandar un SMS desde el número de esa cuenta. Regresa cuánto esperar (ms)."""
        cuenta = _texto(cuenta, 10) or "tx"
        if not all(ch.isalnum() or ch in "_-" for ch in cuenta):
            raise ArbitroError("cuenta inválida")
        ahora = self.reloj()
        with self.lock:
            ultimo = float(self.turnos.get(cuenta) or 0)
            siguiente = max(ahora + max(0.0, float(minimo_ms or 0)), ultimo + random.uniform(TURNO_MIN, TURNO_MAX))
            self.turnos[cuenta] = siguiente
            self._guardar()
        return max(0, int(siguiente - ahora))

    # ---------- importar lo que ya tenía la extensión ----------
    def importar(self, p):
        nuevos = 0
        with self.lock:
            for c in (p.get("contactos") or [])[-MAX_CONTACTOS:]:
                try:
                    nuevos += 1 if self.anotar(c, guardar=False) else 0
                except ArbitroError:
                    pass
            b = p.get("bajas") or {}
            nb = 0
            for d, reg in (b.get("tels") or {}).items():
                dd = reglas.d10(d)
                if dd and dd not in self.bajas["tels"] and isinstance(reg, dict):
                    self.bajas["tels"][dd] = {"t": float(reg.get("t") or self.reloj()), "motivo": _texto(reg.get("motivo") or "baja", 120), "fuente": _texto(reg.get("fuente"), 30)}
                    nb += 1
            for k, reg in (b.get("leads") or {}).items():
                k = _texto(k, 60)
                if ":" in k and k not in self.bajas["leads"] and isinstance(reg, dict):
                    self.bajas["leads"][k] = {"t": float(reg.get("t") or self.reloj()), "motivo": _texto(reg.get("motivo") or "baja", 120), "fuente": _texto(reg.get("fuente"), 30)}
                    nb += 1
            for cuenta, t in (p.get("turnos") or {}).items():
                if isinstance(t, (int, float)) and float(t) > float(self.turnos.get(cuenta) or 0):
                    self.turnos[_texto(cuenta, 10)] = float(t)
            self.ultima_import = self.reloj()
            self._guardar()
        return {"contactos_nuevos": nuevos, "bajas_nuevas": nb}

    def resumen(self):
        with self.lock:
            hace24 = self.reloj() - reglas.H24
            return {"instancia": self.instancia, "contactos": len(self.contactos), "contactos_24h": sum(1 for c in self.contactos if c["t"] >= hace24),
                    "bajas_tels": len(self.bajas["tels"]), "bajas_leads": len(self.bajas["leads"]), "ultima_import": self.ultima_import}
