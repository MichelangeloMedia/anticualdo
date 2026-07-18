const API = "/api";

const el = (id) => document.getElementById(id);

let cajaActualId = null;
let productoEditandoId = null;

// ---------------- Toast ----------------

function toast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2200);
}

// ---------------- Modales ----------------

function abrirModal(id) { el(id).hidden = false; }
function cerrarModal(id) { el(id).hidden = true; }

document.querySelectorAll("[data-cerrar-modal]").forEach((btn) => {
  btn.addEventListener("click", () => cerrarModal(btn.dataset.cerrarModal));
});

// ---------------- Vistas ----------------

function mostrarVistaCajas() {
  el("vista-cajas").hidden = false;
  el("vista-productos").hidden = true;
  cajaActualId = null;
  cargarCajas();
}

function mostrarVistaProductos(cajaId) {
  cajaActualId = cajaId;
  el("vista-cajas").hidden = true;
  el("vista-productos").hidden = false;
  cargarProductos(cajaId);
}

el("btn-volver").addEventListener("click", mostrarVistaCajas);

// ---------------- Cajas ----------------

async function cargarCajas() {
  const res = await fetch(`${API}/cajas`);
  const cajas = await res.json();
  renderCajas(cajas);
}

function renderCajas(cajas) {
  const grid = el("grid-cajas");
  grid.innerHTML = "";
  el("msg-sin-cajas").hidden = cajas.length !== 0;

  cajas.forEach((c) => {
    const card = document.createElement("div");
    card.className = "caja-card";
    card.innerHTML = `
      <button class="caja-borrar" title="Borrar caja">✕</button>
      <div class="caja-nombre">${escapeHtml(c.nombre)}</div>
      <div class="caja-meta">${c.cantidad_productos} producto(s) · stock total ${c.stock_total}</div>
    `;
    card.addEventListener("click", () => mostrarVistaProductos(c.id));
    card.querySelector(".caja-borrar").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`¿Borrar la caja "${c.nombre}" y todos sus productos?`)) return;
      await fetch(`${API}/cajas/${c.id}`, { method: "DELETE" });
      toast("Caja borrada");
      cargarCajas();
    });
    grid.appendChild(card);
  });
}

el("btn-nueva-caja").addEventListener("click", () => {
  el("input-nombre-caja").value = "";
  abrirModal("modal-caja");
});

el("btn-guardar-caja").addEventListener("click", async () => {
  const nombre = el("input-nombre-caja").value.trim();
  if (!nombre) return toast("Poné un nombre para la caja");
  const res = await fetch(`${API}/cajas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre }),
  });
  if (!res.ok) {
    const err = await res.json();
    return toast(err.detail || "No se pudo crear la caja");
  }
  cerrarModal("modal-caja");
  toast("Caja creada");
  cargarCajas();
});

// ---------------- Productos ----------------

async function cargarProductos(cajaId) {
  const res = await fetch(`${API}/cajas/${cajaId}/productos`);
  if (!res.ok) return mostrarVistaCajas();
  const data = await res.json();
  el("titulo-caja").textContent = data.caja.nombre;
  renderProductos(data.productos);
}

function renderProductos(productos) {
  const grid = el("grid-productos");
  grid.innerHTML = "";
  el("msg-sin-productos").hidden = productos.length !== 0;

  productos.forEach((p) => {
    const card = document.createElement("div");
    card.className = "producto-card";

    const fotoUrl = p.foto ? `/uploads/${p.foto}` : null;

    card.innerHTML = `
      <div class="producto-foto" style="${fotoUrl ? `background-image:url('${fotoUrl}')` : ""}">
        ${fotoUrl ? "" : "Sin foto · tocar para subir"}
        <input type="file" accept="image/png, image/jpeg, image/webp" data-foto="${p.id}">
      </div>
      <div class="producto-body">
        <div class="producto-nombre">${escapeHtml(p.nombre)}</div>
        <div class="producto-codigo">${p.codigo_interno ? escapeHtml(p.codigo_interno) : "sin código"}</div>
        <div class="fila-stock">
          <button data-stock-menos="${p.id}">−</button>
          <input type="number" step="1" value="${p.stock}" data-stock-input="${p.id}">
          <button data-stock-mas="${p.id}">+</button>
          <span>stock</span>
        </div>
        <div class="fila-precio">
          <span>$</span>
          <input type="number" step="0.01" value="${p.precio}" data-precio-input="${p.id}">
        </div>
        <div class="producto-acciones">
          <button class="link-borrar" data-borrar="${p.id}">Borrar producto</button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  // fotos
  grid.querySelectorAll("[data-foto]").forEach((input) => {
    input.addEventListener("change", (e) => subirFoto(input.dataset.foto, e.target.files[0]));
  });

  // stock +/-
  grid.querySelectorAll("[data-stock-menos]").forEach((btn) => {
    btn.addEventListener("click", () => ajustarStock(btn.dataset.stockMenos, -1));
  });
  grid.querySelectorAll("[data-stock-mas]").forEach((btn) => {
    btn.addEventListener("click", () => ajustarStock(btn.dataset.stockMas, +1));
  });
  grid.querySelectorAll("[data-stock-input]").forEach((input) => {
    input.addEventListener("change", () => actualizarProducto(input.dataset.stockInput, { stock: parseInt(input.value || "0", 10) }));
  });

  // precio
  grid.querySelectorAll("[data-precio-input]").forEach((input) => {
    input.addEventListener("change", () => actualizarProducto(input.dataset.precioInput, { precio: parseFloat(input.value || "0") }));
  });

  // borrar
  grid.querySelectorAll("[data-borrar]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Borrar este producto?")) return;
      await fetch(`${API}/productos/${btn.dataset.borrar}`, { method: "DELETE" });
      toast("Producto borrado");
      cargarProductos(cajaActualId);
    });
  });
}

async function ajustarStock(productoId, delta) {
  const input = document.querySelector(`[data-stock-input="${productoId}"]`);
  const nuevoValor = Math.max(0, parseInt(input.value || "0", 10) + delta);
  input.value = nuevoValor;
  await actualizarProducto(productoId, { stock: nuevoValor });
}

async function actualizarProducto(productoId, cambios) {
  await fetch(`${API}/productos/${productoId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cambios),
  });
  toast("Guardado");
}

async function subirFoto(productoId, archivo) {
  if (!archivo) return;
  const form = new FormData();
  form.append("archivo", archivo);
  const res = await fetch(`${API}/productos/${productoId}/foto`, { method: "POST", body: form });
  if (!res.ok) return toast("No se pudo subir la foto");
  toast("Foto actualizada");
  cargarProductos(cajaActualId);
}

// ---------------- Nuevo producto ----------------

el("btn-nuevo-producto").addEventListener("click", () => {
  el("titulo-modal-producto").textContent = "Nuevo producto";
  el("input-producto-nombre").value = "";
  el("input-producto-codigo").value = "";
  el("input-producto-stock").value = "0";
  el("input-producto-precio").value = "0";
  el("input-producto-foto").value = "";
  abrirModal("modal-producto");
});

el("btn-guardar-producto").addEventListener("click", async () => {
  const nombre = el("input-producto-nombre").value.trim();
  if (!nombre) return toast("Poné un nombre para el producto");

  const res = await fetch(`${API}/productos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      caja_id: cajaActualId,
      nombre,
      codigo_interno: el("input-producto-codigo").value.trim() || null,
      stock: parseInt(el("input-producto-stock").value || "0", 10),
      precio: parseFloat(el("input-producto-precio").value || "0"),
    }),
  });
  const data = await res.json();

  const archivo = el("input-producto-foto").files[0];
  if (archivo) await subirFoto(data.id, archivo);

  cerrarModal("modal-producto");
  toast("Producto creado");
  cargarProductos(cajaActualId);
});

// ---------------- Utils ----------------

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ---------------- Init ----------------

mostrarVistaCajas();
