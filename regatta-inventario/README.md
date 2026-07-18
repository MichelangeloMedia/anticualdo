# Inventario de Cajas — Lamperti Repuestos

Herramienta a medida, aparte de Contabilium, para llevar el inventario de
productos guardados en cajas (arranca con la tanda del auto Regatta, pero
sirve para cualquier otra).

## Qué hace

- Vista con todas las cajas y cuánto tienen adentro.
- Por caja: lista de productos con foto, stock y precio editables al toque.
- Alta y baja de cajas y productos.
- Pide usuario y clave para entrar (una sola clave compartida, no hay
  usuarios individuales).

No sincroniza con Contabilium — es un sistema aparte. El día que quieran
empujar stock/precio a Contabilium automáticamente, el modelo de datos ya
tiene esos campos por producto, así que solo hay que agregar la conexión,
no rehacer nada.

## Deploy en Railway

1. Subí esta carpeta a un repo de GitHub (o usá `railway up` desde acá con
   la CLI de Railway).
2. En Railway: **New Project → Deploy from GitHub repo**, elegí el repo.
   Railway detecta Python solo y usa el `Procfile` para arrancar.
3. **Agregar un volumen** (importante — si no, se pierden los datos en
   cada deploy):
   - En el servicio → pestaña **Volumes** → **New Volume**.
   - Mount path: `/data`
4. **Variables de entorno** del servicio (pestaña **Variables**):
   - `DATA_DIR` = `/data`
   - `APP_USER` = el usuario que quieras (por defecto `lamperti`)
   - `APP_PASSWORD` = la clave compartida (obligatoria para que pida login)
5. Deploy. Railway te da una URL pública (`https://algo.up.railway.app`) —
   esa es la que comparten entre todos los que necesiten cargar o
   consultar el inventario.

No hace falta Vercel para esto: como el frontend son archivos estáticos
servidos por el mismo backend, un solo servicio en Railway alcanza. Vercel
tiene sentido para el catálogo web más grande que tenían pensado a futuro
(ese sí va a ser un proyecto React aparte).

## Correrlo en tu compu (para probar antes de subirlo)

```
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Entrás por `http://localhost:8000`. Localmente, si no seteás `APP_PASSWORD`
como variable de entorno, no pide clave.

## Datos y fotos

- Todo lo que tiene que persistir (base SQLite + fotos) vive en `DATA_DIR`
  (por defecto una carpeta `data/` al lado de `main.py`; en Railway, el
  volumen montado en `/data`).
- Para backup: alcanza con copiar esa carpeta.

## Sobre el QR por caja

Cuando quieras, armamos un QR por caja que apunte directo a la URL pública
de Railway filtrada por esa caja, para pegarlo físicamente y escanearlo con
la cámara. Convendría esperar a tener la URL definitiva de Railway antes de
generarlos (si no, después hay que reimprimir todo).
