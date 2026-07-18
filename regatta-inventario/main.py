"""
Inventario de cajas — Lamperti Repuestos
Backend FastAPI + SQLite. Un solo proceso: sirve la API y el frontend.

Local:
    uvicorn main:app --host 0.0.0.0 --port 8000

Railway:
    Ver README.md — usa la variable DATA_DIR apuntando a un volumen
    persistente, y APP_PASSWORD para proteger el acceso.
"""

import base64
import os
import secrets
import shutil
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

BASE_DIR = Path(__file__).parent

# DATA_DIR es donde vive todo lo que tiene que persistir (base y fotos).
# En Railway, esto apunta a un volumen montado (ver README); localmente
# usa una carpeta al lado de main.py.
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "inventario.db"
UPLOADS_DIR = DATA_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

APP_USER = os.environ.get("APP_USER", "lamperti")
APP_PASSWORD = os.environ.get("APP_PASSWORD")  # si no está seteada, no pide clave (uso local)

app = FastAPI(title="Inventario de Cajas - Lamperti")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class BasicAuthMiddleware(BaseHTTPMiddleware):
    """Pide usuario/clave (login nativo del navegador) si APP_PASSWORD está seteada."""

    async def dispatch(self, request, call_next):
        if not APP_PASSWORD:
            return await call_next(request)

        auth = request.headers.get("Authorization")
        if auth:
            try:
                scheme, credenciales = auth.split(" ", 1)
                if scheme.lower() == "basic":
                    decoded = base64.b64decode(credenciales).decode("utf-8")
                    usuario, _, clave = decoded.partition(":")
                    if secrets.compare_digest(usuario, APP_USER) and secrets.compare_digest(clave, APP_PASSWORD):
                        return await call_next(request)
            except Exception:
                pass

        return Response(
            content="Autenticación requerida",
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="Inventario Lamperti"'},
        )


app.add_middleware(BasicAuthMiddleware)


# --------------------------------------------------------------------------
# DB helpers
# --------------------------------------------------------------------------

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS cajas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL UNIQUE,
                creado_en TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS productos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                caja_id INTEGER NOT NULL REFERENCES cajas(id) ON DELETE CASCADE,
                nombre TEXT NOT NULL,
                codigo_interno TEXT,
                stock INTEGER NOT NULL DEFAULT 0,
                precio REAL NOT NULL DEFAULT 0,
                foto TEXT,
                actualizado_en TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)


init_db()


# --------------------------------------------------------------------------
# Schemas
# --------------------------------------------------------------------------

class CajaIn(BaseModel):
    nombre: str


class ProductoIn(BaseModel):
    caja_id: int
    nombre: str
    codigo_interno: str | None = None
    stock: int = 0
    precio: float = 0


class ProductoUpdate(BaseModel):
    caja_id: int | None = None
    nombre: str | None = None
    codigo_interno: str | None = None
    stock: int | None = None
    precio: float | None = None


# --------------------------------------------------------------------------
# Cajas
# --------------------------------------------------------------------------

@app.get("/api/cajas")
def listar_cajas():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT c.id, c.nombre, c.creado_en,
                   COUNT(p.id) AS cantidad_productos,
                   COALESCE(SUM(p.stock), 0) AS stock_total
            FROM cajas c
            LEFT JOIN productos p ON p.caja_id = c.id
            GROUP BY c.id
            ORDER BY c.nombre
        """).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/cajas")
def crear_caja(caja: CajaIn):
    nombre = caja.nombre.strip()
    if not nombre:
        raise HTTPException(400, "El nombre de la caja no puede estar vacío")
    with get_db() as conn:
        try:
            cur = conn.execute("INSERT INTO cajas (nombre) VALUES (?)", (nombre,))
        except sqlite3.IntegrityError:
            raise HTTPException(409, f"Ya existe una caja llamada '{nombre}'")
        return {"id": cur.lastrowid, "nombre": nombre}


@app.delete("/api/cajas/{caja_id}")
def borrar_caja(caja_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT id FROM cajas WHERE id=?", (caja_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Caja no encontrada")
        # borrar fotos de los productos de la caja
        fotos = conn.execute(
            "SELECT foto FROM productos WHERE caja_id=? AND foto IS NOT NULL", (caja_id,)
        ).fetchall()
        for f in fotos:
            _borrar_archivo_foto(f["foto"])
        conn.execute("DELETE FROM cajas WHERE id=?", (caja_id,))
    return {"ok": True}


# --------------------------------------------------------------------------
# Productos
# --------------------------------------------------------------------------

@app.get("/api/cajas/{caja_id}/productos")
def listar_productos_de_caja(caja_id: int):
    with get_db() as conn:
        caja = conn.execute("SELECT * FROM cajas WHERE id=?", (caja_id,)).fetchone()
        if not caja:
            raise HTTPException(404, "Caja no encontrada")
        productos = conn.execute(
            "SELECT * FROM productos WHERE caja_id=? ORDER BY nombre", (caja_id,)
        ).fetchall()
        return {
            "caja": dict(caja),
            "productos": [dict(p) for p in productos],
        }


@app.post("/api/productos")
def crear_producto(producto: ProductoIn):
    with get_db() as conn:
        caja = conn.execute("SELECT id FROM cajas WHERE id=?", (producto.caja_id,)).fetchone()
        if not caja:
            raise HTTPException(404, "La caja indicada no existe")
        cur = conn.execute(
            """INSERT INTO productos (caja_id, nombre, codigo_interno, stock, precio)
               VALUES (?, ?, ?, ?, ?)""",
            (producto.caja_id, producto.nombre.strip(), producto.codigo_interno, producto.stock, producto.precio),
        )
        return {"id": cur.lastrowid}


@app.put("/api/productos/{producto_id}")
def actualizar_producto(producto_id: int, cambios: ProductoUpdate):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM productos WHERE id=?", (producto_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Producto no encontrado")

        datos = dict(row)
        for campo, valor in cambios.model_dump(exclude_unset=True).items():
            datos[campo] = valor

        if cambios.caja_id is not None:
            existe = conn.execute("SELECT id FROM cajas WHERE id=?", (cambios.caja_id,)).fetchone()
            if not existe:
                raise HTTPException(404, "La caja destino no existe")

        conn.execute(
            """UPDATE productos
               SET caja_id=?, nombre=?, codigo_interno=?, stock=?, precio=?,
                   actualizado_en=CURRENT_TIMESTAMP
               WHERE id=?""",
            (datos["caja_id"], datos["nombre"], datos["codigo_interno"],
             datos["stock"], datos["precio"], producto_id),
        )
        return {"ok": True}


@app.delete("/api/productos/{producto_id}")
def borrar_producto(producto_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT foto FROM productos WHERE id=?", (producto_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Producto no encontrado")
        if row["foto"]:
            _borrar_archivo_foto(row["foto"])
        conn.execute("DELETE FROM productos WHERE id=?", (producto_id,))
    return {"ok": True}


@app.post("/api/productos/{producto_id}/foto")
async def subir_foto(producto_id: int, archivo: UploadFile = File(...)):
    with get_db() as conn:
        row = conn.execute("SELECT foto FROM productos WHERE id=?", (producto_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Producto no encontrado")

        extension = Path(archivo.filename or "").suffix.lower() or ".jpg"
        if extension not in (".jpg", ".jpeg", ".png", ".webp"):
            raise HTTPException(400, "Formato de imagen no soportado")

        nombre_archivo = f"{uuid.uuid4().hex}{extension}"
        destino = UPLOADS_DIR / nombre_archivo
        with destino.open("wb") as f:
            shutil.copyfileobj(archivo.file, f)

        if row["foto"]:
            _borrar_archivo_foto(row["foto"])

        conn.execute(
            "UPDATE productos SET foto=?, actualizado_en=CURRENT_TIMESTAMP WHERE id=?",
            (nombre_archivo, producto_id),
        )
        return {"foto": nombre_archivo}


def _borrar_archivo_foto(nombre_archivo: str):
    ruta = UPLOADS_DIR / nombre_archivo
    if ruta.exists():
        try:
            ruta.unlink()
        except OSError:
            pass


# --------------------------------------------------------------------------
# Fotos (desde DATA_DIR, para que persistan en el volumen de Railway)
# y frontend estático (al final, para no pisar las rutas /api ni /uploads)
# --------------------------------------------------------------------------

app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
app.mount("/", StaticFiles(directory=BASE_DIR / "static", html=True), name="static")
