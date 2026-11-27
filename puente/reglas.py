# =====================================================================
# Reglas del Cerebro y de la política de SMS en Python (Fase B).
# Son una COPIA EXACTA de cerebro-core.js y de las partes puras de politica-sms.js: el puente las usa
# como árbitro para que los robots de la extensión y los del puente decidan igual.
# Las dos versiones se prueban con los mismos casos: tests/casos/reglas.json (generado del JavaScript).
# Si cambias una regla en JavaScript, cámbiala aquí, corre `node tests/casos/generar-reglas.js` y las pruebas.
# =====================================================================
import datetime
import math
import re

try:
    from zoneinfo import ZoneInfo
    CA = ZoneInfo("America/Los_Angeles")
except Exception:  # pragma: no cover
    CA = None

H24 = 24 * 3600e3
EMPAREJE = 5 * 60e3
ROBOTS_SMS = ["Texi", "Compri", "Texi 2", "Resi", "Resi 2", "Marki", "Rayo"]


def _redondo(x):  # Math.round de JavaScript (Python redondea .5 al par)
    return int(math.floor(x + 0.5))


def _num(v, defecto=0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return defecto


# ---------------------------------------------------------------------
# Cerebro (cerebro-core.js)
# ---------------------------------------------------------------------
def es_de_robot(x, contactos, lead_id):
    return any(str(c.get("leadId")) == str(lead_id) and c.get("canal") == "sms" and abs(_num(c.get("t")) - _num(x.get("t"))) <= EMPAREJE for c in contactos)


def persona_escribio(textos, contactos, lead_id, ahora):
    for x in textos:
        if x.get("direccion") == "out" and ahora - _num(x.get("t")) < H24 and str(x.get("tipo") or "").lower() == "manual" and not es_de_robot(x, contactos, lead_id):
            return x
    return None


def anna_ya_escribio(textos):
    return any(x.get("direccion") == "out" and str(x.get("tipo") or "").upper() == "AI" for x in textos)


def revisar(ahora, leadId, canal="sms", contactos=(), textos=(), anna=None, respetaAnna=True, esRespuesta=False):
    contactos, textos, anna = list(contactos or []), list(textos or []), dict(anna or {})
    mios = [c for c in contactos if str(c.get("leadId")) == str(leadId)]
    p = persona_escribio(textos, contactos, leadId, ahora)
    if p:
        return {"ok": False, "codigo": "persona", "motivo": f"una persona le escribió hace {_redondo((ahora - _num(p.get('t'))) / 60e3)} min (agente {p.get('agentId') or '?'}); no lo toco en 24 h"}
    if respetaAnna and anna.get("enPool") and not anna.get("silenciado"):
        return {"ok": False, "codigo": "anna", "motivo": "está con Anna (AI Sales Agent de Lofty); no lo toco"}
    if canal == "sms":
        ultimo_in = max([0] + [_num(x.get("t")) for x in textos if x.get("direccion") == "in"])
        salidas = [_num(c.get("t")) for c in mios if c.get("canal") == "sms"] + [_num(x.get("t")) for x in textos if x.get("direccion") == "out"]
        ultimo_out = max([0] + salidas)
        if esRespuesta and ultimo_in > ultimo_out:
            return {"ok": True, "codigo": "respuesta"}
        if ultimo_out and ahora - ultimo_out < H24:
            t_out = next((x for x in textos if x.get("direccion") == "out" and _num(x.get("t")) == ultimo_out), {})
            if t_out.get("tipo") == "AI":
                quien = "Anna"
            else:
                quien = (next((c for c in mios if _num(c.get("t")) == ultimo_out), {}) or {}).get("robot") or "alguien"
            return {"ok": False, "codigo": "24h", "motivo": f"ya recibió un SMS hace {_redondo((ahora - ultimo_out) / 60e3)} min ({quien}); máximo 1 cada 24 h"}
    return {"ok": True, "codigo": "ok"}


# ---------------------------------------------------------------------
# Política de SMS (partes puras de politica-sms.js)
# ---------------------------------------------------------------------
LADAS_CA = set("209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951".split())


def d10(t):
    d = re.sub(r"\D", "", str(t if t is not None else ""))
    if len(d) == 11 and d[0] == "1":
        d = d[1:]
    return d if len(d) == 10 else ""


def es_ca(t):
    d = d10(t)
    return bool(d) and d[:3] in LADAS_CA


def hora_ca(ms):
    dt = datetime.datetime.fromtimestamp(ms / 1000, CA) if CA else datetime.datetime.fromtimestamp(ms / 1000)
    return dt.hour + dt.minute / 60


def en_horario(cfg, ms):
    h = hora_ca(ms)
    return cfg.get("desde", 8) <= h < cfg.get("hasta", 21)


def dia_ca(ms):
    dt = datetime.datetime.fromtimestamp(ms / 1000, CA) if CA else datetime.datetime.fromtimestamp(ms / 1000)
    return dt.strftime("%Y-%m-%d")


# Misma expresión que SMS.RE_BAJA (re.ASCII para que \b y \w se porten como en JavaScript)
RE_BAJA = re.compile(r"\b(stop|stop ?all|unsubscribe|remove me|take me off|opt[ -]?out|revoke|do ?n[o']?t (text|contact|message)|no (more )?(texts|messages)|no me (escrib\w*|mand\w*|contact\w*)|d[eé]jame de (escribir|mandar)|b[oó]rrame|baja|darme de baja|cancelar suscripci[oó]n)\b|^\s*(stop|quit|end|cancel|alto|para|pare|cancelar|basta)\s*[.!]*\s*$", re.I | re.A)


def es_baja(texto):
    return bool(RE_BAJA.search(str(texto or "")))


def clave_lead(cuenta, lead_id):
    return f"{cuenta or 'tx'}:{lead_id}"
