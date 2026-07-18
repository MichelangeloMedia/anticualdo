"""
contabilium.py — Integración con la API de Contabilium
-------------------------------------------------------
Solo CREA productos nuevos. Si un código ya existe en Contabilium,
lo SALTEA (no lo actualiza) para nunca disparar el sync a MercadoLibre
sobre publicaciones vivas.

Config por variables de entorno (Railway):
  CONTABILIUM_CLIENT_ID      client_id (el mail de la cuenta)
  CONTABILIUM_CLIENT_SECRET  la API key
  CONTABILIUM_IVA            alícuota de IVA por defecto (default "21")
  CONTABILIUM_DRY_RUN        "true" (default) = simula, no crea nada real
                             "false" = crea de verdad

El rubro se pasa por caja (nombre); la app resuelve su IdRubro contra
Contabilium. Los rubros deben existir previamente en Contabilium.

Mientras CONTABILIUM_DRY_RUN sea "true", este módulo NUNCA hace un POST
de creación: solo consulta (búsqueda) y reporta qué haría.
"""

import os
import time

import httpx

BASE_URL = "https://rest.contabilium.com/api"
TOKEN_URL = "https://rest.contabilium.com/token"

CLIENT_ID = os.environ.get("CONTABILIUM_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("CONTABILIUM_CLIENT_SECRET", "")
DRY_RUN = os.environ.get("CONTABILIUM_DRY_RUN", "true").lower() != "false"

# IVA por defecto para los productos que se crean (Contabilium lo exige).
IVA_DEFAULT = float(os.environ.get("CONTABILIUM_IVA", "21"))

# Cloudflare bloquea requests sin User-Agent de navegador (ver notas del proyecto)
HEADERS_BASE = {"User-Agent": "Mozilla/5.0 Chrome/120"}

# Cache del token en memoria
_token = {"valor": None, "expira": 0}


class ContabiliumError(Exception):
    pass


def configurado() -> bool:
    """True si hay credenciales cargadas."""
    return bool(CLIENT_ID and CLIENT_SECRET)


def _obtener_token() -> str:
    ahora = time.time()
    if _token["valor"] and ahora < _token["expira"]:
        return _token["valor"]

    if not configurado():
        raise ContabiliumError("Faltan credenciales de Contabilium (CLIENT_ID / CLIENT_SECRET)")

    resp = httpx.post(
        TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
        },
        headers=HEADERS_BASE,
        timeout=20,
    )
    if resp.status_code != 200:
        raise ContabiliumError(f"No se pudo autenticar con Contabilium (HTTP {resp.status_code})")

    data = resp.json()
    _token["valor"] = data.get("access_token")
    # renovar un minuto antes de que expire
    _token["expira"] = ahora + int(data.get("expires_in", 3600)) - 60
    if not _token["valor"]:
        raise ContabiliumError("Contabilium no devolvió un token válido")
    return _token["valor"]


def _headers_auth() -> dict:
    return {**HEADERS_BASE, "Authorization": f"Bearer {_obtener_token()}"}


def buscar_por_codigo(codigo: str) -> dict | None:
    """Devuelve el concepto si existe un producto con ese código (SKU), o None."""
    if not codigo:
        return None
    resp = httpx.get(
        f"{BASE_URL}/conceptos/search",
        params={"filtro": codigo, "pageSize": 50},
        headers=_headers_auth(),
        timeout=20,
    )
    time.sleep(0.4)  # respetar rate limit / evitar bloqueos
    if resp.status_code != 200:
        raise ContabiliumError(f"Error buscando '{codigo}' (HTTP {resp.status_code})")

    items = resp.json().get("Items", [])
    # match exacto por código, no parcial
    for item in items:
        if str(item.get("Codigo", "")).strip().upper() == codigo.strip().upper():
            return item
    return None


# cache de rubros: nombre_normalizado -> id
_rubros_cache = {}


def resolver_id_rubro(nombre_rubro: str) -> str | None:
    """
    Devuelve el IdRubro de Contabilium para un nombre de rubro, o None si no
    existe. Los rubros deben estar creados previamente en Contabilium.
    """
    clave = nombre_rubro.strip().upper()
    if clave in _rubros_cache:
        return _rubros_cache[clave]

    resp = httpx.get(
        f"{BASE_URL}/rubros",
        headers=_headers_auth(),
        timeout=20,
    )
    time.sleep(0.4)
    if resp.status_code != 200:
        raise ContabiliumError(f"No se pudieron traer los rubros (HTTP {resp.status_code}): {resp.text[:200]}")

    data = resp.json()
    # la respuesta puede venir como lista directa o como {"Items": [...]}
    rubros = data.get("Items", data) if isinstance(data, dict) else data

    encontrado = None
    for r in rubros:
        nombre = str(r.get("Nombre", r.get("nombre", ""))).strip().upper()
        rid = r.get("Id", r.get("id"))
        if nombre:
            _rubros_cache[nombre] = str(rid)
        if nombre == clave:
            encontrado = str(rid)

    return encontrado


def crear_producto(producto: dict, id_rubro: str, descripcion: str | None = None) -> dict:
    """
    Crea un producto nuevo en Contabilium siguiendo el formato de la API.
    'id_rubro' es el ID del rubro en Contabilium (obligatorio).
    En DRY_RUN no hace el POST: devuelve el payload que se enviaría.
    """
    nombre = producto["nombre"]
    payload = {
        "nombre": nombre,
        "Tipo": "P",  # P=Producto, S=Servicio, C=Combo
        "Codigo": producto.get("codigo_interno") or "",
        "Descripcion": descripcion or nombre,
        "Precio": float(producto.get("precio") or 0),
        "Iva": IVA_DEFAULT,
        "StockMinimo": 0,
        "Observaciones": "",
        "Estado": "A",  # A=Activo, I=Inactivo
        "IdRubro": str(id_rubro),
    }

    if DRY_RUN:
        return {"simulado": True, "payload": payload}

    resp = httpx.post(
        f"{BASE_URL}/conceptos/",
        json=payload,
        headers=_headers_auth(),
        timeout=30,
    )
    time.sleep(0.4)
    if resp.status_code not in (200, 201):
        raise ContabiliumError(
            f"No se pudo crear '{nombre}' (HTTP {resp.status_code}): {resp.text[:400]}"
        )
    return {"simulado": False, "respuesta": resp.json()}


def empujar_caja(productos: list[dict], rubro: str) -> dict:
    """
    Recorre los productos de una caja. Crea los nuevos, saltea los que ya
    existen por código. Devuelve un resumen.
    'rubro' es el nombre del rubro (debe existir ya en Contabilium).
    """
    # resolver el ID del rubro una sola vez
    id_rubro = resolver_id_rubro(rubro)
    if not id_rubro:
        raise ContabiliumError(
            f"El rubro '{rubro}' no existe en Contabilium. Crealo primero en "
            f"Contabilium (Administración de rubros) y volvé a intentar."
        )

    creados = []
    salteados = []
    errores = []

    for p in productos:
        codigo = (p.get("codigo_interno") or "").strip()
        try:
            if codigo and buscar_por_codigo(codigo):
                salteados.append({"nombre": p["nombre"], "codigo": codigo, "motivo": "ya existe"})
                continue
            resultado = crear_producto(p, id_rubro=id_rubro)
            creados.append({"nombre": p["nombre"], "codigo": codigo, **resultado})
        except ContabiliumError as e:
            errores.append({"nombre": p["nombre"], "codigo": codigo, "error": str(e)})

    return {
        "dry_run": DRY_RUN,
        "rubro": rubro,
        "id_rubro": id_rubro,
        "creados": creados,
        "salteados": salteados,
        "errores": errores,
        "total": len(productos),
    }
