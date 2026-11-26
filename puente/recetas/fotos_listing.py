# =====================================================================
# Receta: fotos_listing — todas las fotos (en el tamaño más grande) y los datos de UN listing de Homes.com.
# Guarda 01.jpg, 02.jpg… y datos.json (precio, dirección, ciudad, beds, baths, sq ft, garage, highlights,
# descripción, agente y DRE) en ~/Downloads/navi/fotos_listing/<fecha>/.
# El puente valida la URL antes de correr esto (solo https://www.homes.com/property/...).
# =====================================================================
META = {
    "nombre": "fotos_listing",
    "titulo": "Fotos y datos de un listing (Homes.com)",
    "descripcion": "Abre la galería completa, baja todas las fotos numeradas en el tamaño más grande y guarda datos.json.",
    "params": {
        "url": {"tipo": "url", "requerido": True, "etiqueta": "URL de la propiedad en Homes.com",
                "hosts": ["www.homes.com", "homes.com"], "ruta": r"/property/[a-z0-9-]+/[a-z0-9]+/",
                "ejemplo": "https://www.homes.com/property/12352-elmwood-st-garden-grove-ca/sp9g4fw1ndpwt/"},
    },
    "minutos_max": 10,
}

try:
    r = fotos_listing(PARAMS["url"], SALIDA)
    emitir("resultado", carpeta=r["carpeta"], fotos=r["fotos"],
           direccion=", ".join(x for x in [r["datos"].get("direccion"), r["datos"].get("ciudad")] if x),
           precio=r["datos"].get("precio"))
finally:
    cerrar_pestana()
