"""
contabilium.py — Integración con la API de Contabilium
-------------------------------------------------------
Solo CREA productos nuevos. Si un código ya existe en Contabilium,
lo SALTEA (no lo actualiza) para nunca disparar el sync a MercadoLibre
sobre publicaciones vivas.

Config por variables de entorno (Railway):
  CONTABILIUM_CLIENT_ID      client_id de la API (Mi cuenta > Config > API)
  CONTABILIUM_CLIENT_SECRET  client_secret de la API
  CONTABILIUM_RUBRO          rubro a asignar (default "Regatta")
  CONTABILIUM_DRY_RUN        "true" (default) = simula, no crea nada real
                             "false" = crea de verdad

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
RUBRO = os.environ.get("CONTABILIUM_RUBRO", "Regatta")
DRY_RUN = os.environ.get("CONTABILIUM_DRY_RUN", "true").lower() != "false"

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


def crear_producto(producto: dict) -> dict:
    """
    Crea un producto nuevo en Contabilium con rubro RUBRO.
    'producto' es un dict de la app: nombre, codigo_interno, stock, precio.
    En DRY_RUN no hace el POST: devuelve el payload que se enviaría.
    """
    payload = {
        "Tipo": "Producto",
        "Nombre": producto["nombre"],
        "Codigo": producto.get("codigo_interno") or "",
        "Precio": float(producto.get("precio") or 0),
        "Rubro": RUBRO,
        "Estado": "Activo",
        # el stock inicial se maneja aparte según el flujo de inventarios;
        # se deja en el payload para referencia del dry-run
        "StockInicial": int(producto.get("stock") or 0),
    }

    if DRY_RUN:
        return {"simulado": True, "payload": payload}

    resp = httpx.post(
        f"{BASE_URL}/conceptos",
        json=payload,
        headers=_headers_auth(),
        timeout=30,
    )
    time.sleep(0.4)
    if resp.status_code not in (200, 201):
        raise ContabiliumError(
            f"No se pudo crear '{producto['nombre']}' (HTTP {resp.status_code}): {resp.text[:200]}"
        )
    return {"simulado": False, "respuesta": resp.json()}


def empujar_caja(productos: list[dict]) -> dict:
    """
    Recorre los productos de una caja. Crea los nuevos, saltea los que ya
    existen por código. Devuelve un resumen.
    """
    creados = []
    salteados = []
    errores = []

    for p in productos:
        codigo = (p.get("codigo_interno") or "").strip()
        try:
            if codigo and buscar_por_codigo(codigo):
                salteados.append({"nombre": p["nombre"], "codigo": codigo, "motivo": "ya existe"})
                continue
            resultado = crear_producto(p)
            creados.append({"nombre": p["nombre"], "codigo": codigo, **resultado})
        except ContabiliumError as e:
            errores.append({"nombre": p["nombre"], "codigo": codigo, "error": str(e)})

    return {
        "dry_run": DRY_RUN,
        "rubro": RUBRO,
        "creados": creados,
        "salteados": salteados,
        "errores": errores,
        "total": len(productos),
    }
