# =====================================================================
# Navi · funciones comunes de las recetas. El puente pone este archivo ANTES de cada receta y le pasa
# todo junto a `browser-use` por stdin. Las funciones de browser-use (new_tab, goto_url, js, wait_for_load,
# wait_for_element, close_tab…) ya vienen cargadas.
#
# · Los parámetros llegan YA VALIDADOS por el puente en la variable de entorno NAVI_PARAMS (JSON).
# · La carpeta de salida llega en NAVI_SALIDA (~/Downloads/navi/<receta>/<fecha>/).
# · Hablamos con el puente imprimiendo líneas "NAVI:{json}" (resultado, ayuda, progreso).
# · Ritmo humano: pausa de 1.5 a 4 s entre páginas.
# · Si una página pide CAPTCHA o verificación: NO se intenta resolver; se avisa "ayuda" y se sale.
# =====================================================================
import json as _json
import os as _os
import random as _random
import re as _re
import sys as _sys
import time as _time
import urllib.parse as _up
import urllib.request as _ur
from pathlib import Path as _Path

PARAMS = _json.loads(_os.environ.get("NAVI_PARAMS") or "{}")
SALIDA = _Path(_os.environ.get("NAVI_SALIDA") or ".").resolve()
NAVI_HOME = _Path(_os.environ.get("NAVI_HOME") or (_Path.home() / ".navi"))
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
_TAB = None


def emitir(tipo, **datos):
    print("NAVI:" + _json.dumps({"tipo": tipo, **datos}, ensure_ascii=False), flush=True)


def decir(txt):
    print(str(txt), flush=True)


def pausa(minimo=1.5, maximo=4.0):
    """Ritmo humano entre páginas, para que no nos bloqueen."""
    _time.sleep(_random.uniform(minimo, maximo))


# ---------- CAPTCHA / verificación ----------
JS_CAPTCHA = r"""
(() => {
  const t = (document.title || "").toLowerCase();
  if (/access denied|attention required|just a moment|are you a robot|verify you are human|pardon our interruption|security check|captcha/.test(t))
    return "La página pide verificación: " + document.title.trim();
  const visible = (el) => {
    if (el.closest(".grecaptcha-badge")) return false;
    if (/size=invisible/.test(el.getAttribute("src") || "")) return false;
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
    const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 40;
  };
  const sel = 'iframe[src*="captcha"], iframe[src*="challenges.cloudflare.com"], iframe[title*="challenge" i], #px-captcha, #challenge-form, iframe[src*="hcaptcha"], iframe[src*="geo.captcha-delivery"]';
  for (const el of document.querySelectorAll(sel)) if (visible(el)) return "Hay un CAPTCHA en la página";
  const body = ((document.body && document.body.innerText) || "").slice(0, 4000).toLowerCase();
  if (/press (and|&) hold|verify you are (a )?human|confirm you are (a )?human|unusual traffic|are you a robot/.test(body)) return "La página pide verificar que eres humano";
  return "";
})()
"""


def revisar_captcha():
    motivo = js(JS_CAPTCHA)
    if motivo:
        emitir("ayuda", motivo=motivo, url=(page_info() or {}).get("url", ""))
        cerrar_pestana()
        _sys.exit(3)


# ---------- Navegación (una sola pestaña, la nuestra) ----------
def abrir(url, esperar=None, timeout=30.0):
    global _TAB
    if _TAB is None:
        _TAB = new_tab(url)
    else:
        switch_tab(_TAB)
        goto_url(url)
    wait_for_load(timeout)
    if esperar:
        wait_for_element(esperar, timeout=15.0)
    _time.sleep(1.2)
    revisar_captcha()


def cerrar_pestana():
    global _TAB
    if _TAB is not None:
        try:
            close_tab(_TAB)
        except Exception:
            pass
        _TAB = None


# ---------- Archivos ----------
def slug(texto, largo=60):
    s = _re.sub(r"[^a-z0-9]+", "-", str(texto or "").lower()).strip("-")
    return s[:largo].strip("-") or "sin-nombre"


def descargar(url, destino, intentos=2):
    """Baja un archivo con cabeceras de navegador. Regresa los bytes guardados o 0."""
    for i in range(intentos):
        try:
            req = _ur.Request(url, headers={"User-Agent": UA, "Referer": "https://www.homes.com/", "Accept": "image/avif,image/webp,image/*,*/*;q=0.8"})
            with _ur.urlopen(req, timeout=30) as r:
                datos = r.read()
            if len(datos) < 500:
                raise ValueError("archivo vacío")
            _Path(destino).write_bytes(datos)
            return len(datos)
        except Exception as e:
            if i == intentos - 1:
                decir(f"  No pude bajar {url.rsplit('/', 1)[-1]}: {e}")
            _time.sleep(1.0 + i)
    return 0


def medidas_imagen(url):
    """(ancho, alto) leyendo solo el principio del archivo. (0, 0) si no se pudo."""
    try:
        req = _ur.Request(url, headers={"User-Agent": UA, "Referer": "https://www.homes.com/"})
        with _ur.urlopen(req, timeout=15) as r:
            if r.status != 200:
                return (0, 0)
            d = r.read(131072)
    except Exception:
        return (0, 0)
    if d[:2] == b"\xff\xd8":  # JPEG
        i = 2
        while i + 9 < len(d):
            if d[i] != 0xFF:
                i += 1
                continue
            marca = d[i + 1]
            if marca in (0xD8, 0x01) or 0xD0 <= marca <= 0xD7:
                i += 2
                continue
            largo = int.from_bytes(d[i + 2:i + 4], "big")
            if marca in (0xC0, 0xC1, 0xC2):
                return (int.from_bytes(d[i + 7:i + 9], "big"), int.from_bytes(d[i + 5:i + 7], "big"))
            i += 2 + largo
    if d[:8] == b"\x89PNG\r\n\x1a\n":
        return (int.from_bytes(d[16:20], "big"), int.from_bytes(d[20:24], "big"))
    if d[:4] == b"RIFF" and d[8:12] == b"WEBP" and d[12:16] == b"VP8 ":
        return (int.from_bytes(d[26:28], "little") & 0x3FFF, int.from_bytes(d[28:30], "little") & 0x3FFF)
    return (0, 0)


# ---------- Homes.com: fotos de un listing ----------
# Las fotos viven en https://images.homes.com/listings/<tamaño>/<clave-del-listing>/<nombre>.jpg
FOTO_RE = _re.compile(r"https://images\.homes\.com/listings/(\d+)/([0-9]+-[0-9]+)/([^/?#\"'\s<>)]+\.(?:jpe?g|png|webp))", _re.I)
CODIGOS_PRUEBA = [str(n) for n in list(range(100, 131)) + list(range(200, 231))]

JS_URLS = r"""
(() => {
  const out = [];
  const add = (s) => { if (s && s.includes("images.homes.com/listings/")) out.push(s); };
  for (const el of document.querySelectorAll("img, source, [data-src], [data-srcset], [data-image], [data-url], [style*='images.homes.com']")) {
    add(el.currentSrc); add(el.src);
    for (const a of ["srcset", "data-src", "data-srcset", "data-image", "data-url", "data-lazy", "style"]) {
      const v = el.getAttribute && el.getAttribute(a); if (v) v.split(/[\s,]+/).forEach(add);
      if (a === "style" && v) (v.match(/https:\/\/images\.homes\.com\/listings\/[^"')\s]+/g) || []).forEach(add);
    }
  }
  for (const s of document.querySelectorAll("script:not([src])")) (s.textContent.match(/https:\\?\/\\?\/images\.homes\.com\\?\/listings\\?\/[^"'\s<>]+/g) || []).forEach((x) => add(x.replace(/\\\//g, "/")));
  for (const e of performance.getEntriesByType("resource")) add(e.name);
  return out;
})()
"""

JS_DATOS = r"""
(() => {
  const limpio = (s) => (s || "").replace(/\s+/g, " ").trim();
  const txt = (sel) => { const e = document.querySelector(sel); return e ? limpio(e.textContent) : ""; };
  let L = {};
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { const j = JSON.parse(s.textContent); for (const x of (j["@graph"] || [j])) { const t = [].concat(x["@type"] || []); if (t.includes("RealEstateListing")) L = x; } } catch (e) {}
  }
  const M = L.mainEntity || {}, A = M.address || {}, O = L.offers || {}, G = [].concat(O.offeredBy || [])[0] || {};
  const meta = (document.querySelector('meta[name="description"]') || {}).content || "";
  const num = (s) => { const m = String(s || "").replace(/,/g, "").match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
  const highlights = [...document.querySelectorAll("#highlights-section .highlight-value, .highlights-container .highlight-value")].map((e) => limpio(e.textContent)).filter(Boolean);
  const amenidades = [...document.querySelectorAll(".amenities-detail")].map((e) => limpio(e.textContent)).filter(Boolean);
  const garage = [...highlights, ...amenidades].find((x) => /garage|carport|parking/i.test(x)) || "";
  const licencia = txt(".agent-information-license-number").replace(/^license\s*#?\s*:?\s*/i, "");
  const precioTxt = (meta.match(/\$[\d,]+/) || [""])[0];
  const fotoPrincipal = (L.primaryImageOfPage && L.primaryImageOfPage.url) || L.image || "";
  const totalAttr = (document.querySelector("[data-totalimgs]") || { dataset: {} }).dataset.totalimgs;
  return {
    url: location.href.split("#")[0],
    precio: O.price != null ? O.price : num(precioTxt),
    direccion: A.streetAddress || "",
    ciudad: A.addressLocality || "",
    estado: A.addressRegion || "",
    zip: A.postalCode || "",
    beds: M.numberOfBedrooms != null ? M.numberOfBedrooms : num((meta.match(/(\d+)\s*(bed|bd)/i) || [])[1]),
    baths: M.numberOfBathroomsTotal != null ? M.numberOfBathroomsTotal : null,
    sqft: (M.floorSize && M.floorSize.value) != null ? M.floorSize.value : num((meta.match(/([\d,]+)\s*sqft/i) || [])[1]),
    anio: M.yearBuilt || null,
    garage,
    highlights,
    descripcion: txt("#ldp-description-text") || txt(".ldp-description-text"),
    agente: G.name || txt(".agent-information-fullname") || "",
    telefono_agente: G.telephone || "",
    correo_agente: G.email || "",
    brokerage: txt(".agent-information-agency-name") || ((G.memberOf || {}).name || ""),
    dre: licencia,
    mls: (meta.match(/MLS#\s*([A-Z0-9-]+)/i) || [])[1] || "",
    foto_principal: fotoPrincipal,
    fotos_en_pagina: totalAttr ? Number(totalAttr) : null,
  };
})()
"""

# Abrir la galería completa: primero el botón de fotos; si no hay, la foto grande.
JS_ABRIR_GALERIA = r"""
(() => {
  const sels = ['[data-modal-tab="Photos"]', 'button.js-open-gallery[data-attachmenttypeid="Photo"]', '#gallery-primary-carousel .primary-carousel-slide img',
                '.primary-carousel-slide', '.js-open-gallery:not(#modal-map-btn):not([data-modal-tab="Map"])', '.hero-slide img'];
  for (const s of sels) { const el = document.querySelector(s); if (el) { el.scrollIntoView({ block: "center" }); el.click(); return s; } }
  return "";
})()
"""

# Recorre lo que se pueda desplazar dentro de la galería para que carguen las fotos perezosas
JS_RECORRER = r"""
(() => {
  let movidos = 0;
  const cajas = [...document.querySelectorAll('[role="dialog"], .modal, [class*="gallery"], [class*="Gallery"], [class*="modal"]')]
    .filter((e) => e.scrollHeight > e.clientHeight + 20);
  for (const c of cajas) { const antes = c.scrollTop; c.scrollTop = antes + Math.max(600, c.clientHeight * 0.9); if (c.scrollTop !== antes) movidos++; }
  // carruseles: botón "siguiente" dentro de la galería
  const sig = document.querySelector('[role="dialog"] .embla__button--next:not([disabled]), .modal .embla__button--next:not([disabled]), [aria-label="Next photo"], [aria-label="Next"]');
  if (sig && !movidos) { sig.click(); movidos++; }
  if (!movidos) window.scrollBy(0, 900);
  return movidos;
})()
"""


def _clave_listing(datos, urls):
    m = FOTO_RE.search(datos.get("foto_principal") or "")
    if m:
        return m.group(2)
    claves = {}
    for u in urls:
        mm = FOTO_RE.search(u)
        if mm:
            claves[mm.group(2)] = claves.get(mm.group(2), 0) + 1
    return max(claves, key=claves.get) if claves else ""


def _fotos_ordenadas(urls, clave):
    """Una entrada por foto (por nombre de archivo), en el orden en que aparecen."""
    vistas, out = {}, []
    for u in urls:
        m = FOTO_RE.search(u)
        if not m or m.group(2) != clave:
            continue
        nombre = m.group(3)
        if nombre not in vistas:
            vistas[nombre] = {"nombre": nombre, "codigos": [m.group(1)]}
            out.append(vistas[nombre])
        elif m.group(1) not in vistas[nombre]["codigos"]:
            vistas[nombre]["codigos"].append(m.group(1))
    return out


def _cache_tamano():
    p = NAVI_HOME / "homes_tamano.json"
    try:
        return _json.loads(p.read_text())
    except Exception:
        return {}


def _guardar_cache_tamano(d):
    try:
        NAVI_HOME.mkdir(parents=True, exist_ok=True)
        (NAVI_HOME / "homes_tamano.json").write_text(_json.dumps(d))
    except Exception:
        pass


def mejor_codigo(clave, foto):
    """Qué código de tamaño da la foto más grande. Se prueba con la primera foto y se recuerda en ~/.navi."""
    cache = _cache_tamano()
    candidatos = list(dict.fromkeys(([cache["codigo"]] if cache.get("codigo") else []) + foto["codigos"]))
    if not cache.get("probado"):
        candidatos += [c for c in CODIGOS_PRUEBA if c not in candidatos]
    mejor, area_mejor = foto["codigos"][0], 0
    for c in candidatos:
        w, h = medidas_imagen(f"https://images.homes.com/listings/{c}/{clave}/{foto['nombre']}")
        if w * h > area_mejor:
            mejor, area_mejor = c, w * h
        _time.sleep(0.15)
    if area_mejor and not cache.get("probado"):
        w, h = medidas_imagen(f"https://images.homes.com/listings/{mejor}/{clave}/{foto['nombre']}")
        _guardar_cache_tamano({"codigo": mejor, "ancho": w, "alto": h, "probado": True})
        decir(f"  El tamaño más grande es el código {mejor} ({w}×{h}); lo recuerdo para la próxima.")
    return mejor


def fotos_listing(url, carpeta):
    """Abre un listing de Homes.com, junta todas sus fotos en el tamaño más grande, las baja numeradas y guarda datos.json."""
    carpeta = _Path(carpeta)
    carpeta.mkdir(parents=True, exist_ok=True)
    emitir("carpeta", ruta=str(carpeta))
    decir(f"Abriendo {url}")
    abrir(url, esperar="h1, #ldp-page-app, script[type='application/ld+json']")
    datos = js(JS_DATOS) or {}
    decir(f"Propiedad: {datos.get('direccion') or '?'}, {datos.get('ciudad') or ''} · ${datos.get('precio') or '?'}")
    urls = list(js(JS_URLS) or [])
    # galería completa
    pausa(1.5, 3.0)
    abierto = js(JS_ABRIR_GALERIA)
    if abierto:
        decir("Abrí la galería de fotos.")
        _time.sleep(2.5)
        revisar_captcha()
        sin_nuevas = 0
        for _ in range(60):
            antes = len(set(urls))
            js(JS_RECORRER)
            _time.sleep(_random.uniform(0.6, 1.2))
            urls += list(js(JS_URLS) or [])
            sin_nuevas = sin_nuevas + 1 if len(set(urls)) == antes else 0
            if sin_nuevas >= 4:
                break
    else:
        decir("No encontré el botón de la galería; uso las fotos que se ven en la página.")
    clave = _clave_listing(datos, urls)
    fotos = _fotos_ordenadas(urls, clave) if clave else []
    if not fotos:
        _guardar_datos(carpeta, datos, [])
        decir("No encontré fotos de este listing.")
        return {"carpeta": str(carpeta), "fotos": 0, "datos": datos}
    if datos.get("fotos_en_pagina") and datos["fotos_en_pagina"] > len(fotos):
        decir(f"Aviso: la página dice {datos['fotos_en_pagina']} fotos y encontré {len(fotos)}.")
    codigo = mejor_codigo(clave, fotos[0])
    guardadas = []
    for i, f in enumerate(fotos, 1):
        ext = f["nombre"].rsplit(".", 1)[-1].lower().replace("jpeg", "jpg")
        destino = carpeta / f"{i:02d}.{ext}"
        url_grande = f"https://images.homes.com/listings/{codigo}/{clave}/{f['nombre']}"
        n = descargar(url_grande, destino) or descargar(f"https://images.homes.com/listings/{f['codigos'][0]}/{clave}/{f['nombre']}", destino)
        if n:
            guardadas.append({"archivo": destino.name, "url": url_grande, "bytes": n})
        emitir("progreso", txt=f"Foto {i} de {len(fotos)}", hecho=i, total=len(fotos))
        _time.sleep(_random.uniform(0.3, 0.9))
    _guardar_datos(carpeta, datos, guardadas)
    decir(f"Bajé {len(guardadas)} de {len(fotos)} fotos.")
    return {"carpeta": str(carpeta), "fotos": len(guardadas), "datos": datos}


def _guardar_datos(carpeta, datos, fotos):
    d = {k: v for k, v in datos.items() if k not in ("foto_principal", "fotos_en_pagina")}
    d["fotos"] = fotos
    d["fuente"] = "homes.com"
    d["bajado"] = _time.strftime("%Y-%m-%d %H:%M:%S")
    (_Path(carpeta) / "datos.json").write_text(_json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
