# =====================================================================
# Receta: listings_agente — todos los listings ACTIVOS del perfil de un agente en Homes.com.
# Guarda listings.csv (url, dirección, precio, estado) y resumen.json en ~/Downloads/navi/listings_agente/<fecha>/.
# Con fotos = sí, corre fotos_listing para cada uno (una sub-carpeta por listing), con pausas de ritmo humano.
# =====================================================================
META = {
    "nombre": "listings_agente",
    "titulo": "Listings activos de un agente (Homes.com)",
    "descripcion": "Junta los listings activos del perfil (URL, dirección, precio, estado) en un CSV. Opcional: baja las fotos de cada uno.",
    "params": {
        "url": {"tipo": "url", "requerido": True, "etiqueta": "URL del perfil del agente en Homes.com",
                "hosts": ["www.homes.com", "homes.com"], "ruta": r"/real-estate-agents/[a-z0-9-]+/[a-z0-9]+/",
                "ejemplo": "https://www.homes.com/real-estate-agents/christopher-rubio-novack/rpbcje3/"},
        "fotos": {"tipo": "bool", "defecto": False, "etiqueta": "Bajar también las fotos de cada listing"},
        "maximo": {"tipo": "int", "defecto": 60, "min": 1, "max": 200, "etiqueta": "Máximo de listings"},
    },
    "minutos_max": 120,
}

JS_LISTINGS = r"""
(() => {
  const limpio = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vistos = new Set(), out = [];
  // secciones del perfil con listings del agente (activos y open houses); nunca las de vendidos
  const zonas = [...document.querySelectorAll('#listings-container, [id*="active-listings"], [id*="open-houses"]')].filter((z) => !/sold/i.test(z.id));
  const tarjetas = (zonas.length ? zonas : [document]).flatMap((z) => [...z.querySelectorAll("article[data-pk], article.search-placard, article.for-sale-placard")]);
  for (const a of tarjetas) {
    const link = a.querySelector('a[href*="/property/"]');
    if (!link) continue;
    const url = link.href.split(/[?#]/)[0];
    if (vistos.has(url)) continue;
    const pill = a.querySelector(".status-pill");
    const pillTxt = pill ? limpio(pill.textContent) : "";
    const vendido = /sold|off market|closed/i.test(pillTxt) || (pill && /tag-type-sold/.test(pill.className)) || a.matches(".sold-placard");
    if (vendido) continue;
    vistos.add(url);
    const img = a.querySelector("img[alt]");
    const lineas = [...link.querySelectorAll("li")].map((li) => limpio(li.textContent)).filter(Boolean);
    const precioEl = a.querySelector(".price-container");
    let precio = "";
    if (precioEl) { const c = precioEl.cloneNode(true); c.querySelectorAll(".status-pill").forEach((x) => x.remove()); precio = (limpio(c.textContent).match(/\$[\d,.]+[KMkm]?/) || [""])[0]; }
    out.push({
      url,
      direccion: (img && limpio(img.alt)) || lineas.join(", ") || limpio(link.title) || "",
      precio,
      // estado: Pending / Contingent; todo lo demás está activo (las etiquetas de open house van en "nota")
      estado: /pending/i.test(pillTxt) ? "Pending" : /contingent|under contract/i.test(pillTxt) ? "Contingent" : "Active",
      nota: /pending|contingent|under contract/i.test(pillTxt) ? "" : pillTxt,
    });
  }
  return out;
})()
"""

JS_TAB_ACTIVOS = r"""
(() => {
  const b = document.querySelector('#listings-sales [data-name="active"], #listings-container [role="tab"][data-name="active"]');
  if (!b) return false;
  b.scrollIntoView({ block: "center" }); b.click(); return true;
})()
"""

import csv as _csv

try:
    url = PARAMS["url"]
    decir(f"Abriendo el perfil {url}")
    abrir(url, esperar="#listings-container, #active-listings-carousel-container, article[data-pk]")
    pausa()
    if js(JS_TAB_ACTIVOS):
        decir("Pestaña Active.")
        _time.sleep(2.5)
        try:
            wait_for_element("#listings-container article[data-pk]", timeout=10.0)
        except Exception:
            pass
    # que se carguen todas las tarjetas del carrusel
    for _ in range(4):
        js("window.scrollBy(0, 1200)")
        _time.sleep(0.8)
    revisar_captcha()
    listings = list(js(JS_LISTINGS) or [])[: int(PARAMS.get("maximo") or 60)]
    decir(f"Encontré {len(listings)} listing(s) activos.")
    csv_path = SALIDA / "listings.csv"

    def guardar_csv(con_columnas_fotos):
        campos = ["url", "direccion", "precio", "estado", "nota"] + (["fotos", "carpeta"] if con_columnas_fotos else [])
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            w = _csv.DictWriter(f, fieldnames=campos, extrasaction="ignore")
            w.writeheader()
            w.writerows(listings)

    guardar_csv(False)  # se guarda ya, por si una foto pide CAPTCHA a medio camino
    decir(f"Guardé {csv_path.name}.")
    con_fotos = 0
    if PARAMS.get("fotos"):
        for i, l in enumerate(listings, 1):
            pausa()
            decir(f"[{i}/{len(listings)}] {l['direccion'] or l['url']}")
            try:
                r = fotos_listing(l["url"], SALIDA / slug(l["direccion"] or l["url"].rstrip("/").split("/")[-2]))
                l["fotos"], l["carpeta"] = r["fotos"], r["carpeta"]
                con_fotos += 1 if r["fotos"] else 0
            except SystemExit:
                guardar_csv(True)
                raise
            except Exception as e:
                l["fotos"], l["carpeta"] = 0, ""
                decir(f"  No pude con este listing: {e}")
            guardar_csv(True)
            emitir("progreso", txt=f"Listing {i} de {len(listings)}", hecho=i, total=len(listings))
    resumen = {"perfil": url, "activos": len(listings), "con_fotos": con_fotos,
               "por_estado": {e: sum(1 for l in listings if l["estado"] == e) for e in sorted({l["estado"] for l in listings})},
               "fecha": _time.strftime("%Y-%m-%d %H:%M:%S")}
    (SALIDA / "resumen.json").write_text(_json.dumps({**resumen, "listings": listings}, ensure_ascii=False, indent=2), encoding="utf-8")
    emitir("resultado", carpeta=str(SALIDA), csv=str(csv_path), total=len(listings), con_fotos=con_fotos, por_estado=resumen["por_estado"])
finally:
    cerrar_pestana()
