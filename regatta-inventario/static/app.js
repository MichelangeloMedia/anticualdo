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

function abrirModal(id) { el(id).removeAttribute("hidden"); }
function cerrarModal(id) { el(id).setAttribute("hidden", ""); }

document.querySelectorAll("[data-cerrar-modal]").forEach((btn) => {
  btn.addEventListener("click", () => cerrarModal(btn.dataset.cerrarModal));
});

// Cerrar al clickear el fondo oscuro (fuera del recuadro del modal)
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.setAttribute("hidden", "");
  });
});

// Cerrar con la tecla Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay:not([hidden])").forEach((m) => {
      m.setAttribute("hidden", "");
    });
  }
});

// ---------------- Vistas ----------------

function mostrarVistaCajas() {
  el("vista-cajas").hidden = false;
  el("vista-productos").hidden = true;
  cajaActualId = null;
  if (location.hash.startsWith("#caja-")) {
    history.replaceState(null, "", location.pathname);
  }
  cargarCajas();
}

function mostrarVistaProductos(cajaId) {
  cajaActualId = cajaId;
  el("vista-cajas").hidden = true;
  el("vista-productos").hidden = false;
  if (location.hash !== `#caja-${cajaId}`) {
    history.replaceState(null, "", `#caja-${cajaId}`);
  }
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

// ---------------- Buscador ----------------

let debounceBuscar = null;

const inputBuscar = el("input-buscar");
if (inputBuscar) {
  inputBuscar.addEventListener("input", (e) => {
    const termino = e.target.value.trim();
    el("btn-limpiar-buscar").hidden = termino === "";
    clearTimeout(debounceBuscar);
    debounceBuscar = setTimeout(() => buscar(termino), 250);
  });

  el("btn-limpiar-buscar").addEventListener("click", () => {
    el("input-buscar").value = "";
    el("btn-limpiar-buscar").hidden = true;
    limpiarResultados();
  });
}

async function buscar(termino) {
  if (!termino) return limpiarResultados();
  const res = await fetch(`${API}/buscar?q=${encodeURIComponent(termino)}`);
  const data = await res.json();
  renderResultados(data.resultados, termino);
}

function limpiarResultados() {
  el("resultados-busqueda").hidden = true;
  el("resultados-busqueda").innerHTML = "";
  el("grid-cajas").hidden = false;
  el("msg-sin-cajas").hidden = true;
  cargarCajas();
}

function renderResultados(resultados, termino) {
  const cont = el("resultados-busqueda");
  el("grid-cajas").hidden = true;
  el("msg-sin-cajas").hidden = true;
  cont.hidden = false;

  if (resultados.length === 0) {
    cont.innerHTML = `<p class="msg-vacio">No se encontró ningún producto para "${escapeHtml(termino)}".</p>`;
    return;
  }

  cont.innerHTML = `<p class="resultados-titulo">${resultados.length} resultado(s)</p>`;
  const lista = document.createElement("div");
  lista.className = "resultados-lista";

  resultados.forEach((r) => {
    const fotoUrl = r.foto ? `/uploads/${r.foto}` : null;
    const fila = document.createElement("div");
    fila.className = "resultado-fila";
    fila.innerHTML = `
      <div class="resultado-foto" style="${fotoUrl ? `background-image:url('${fotoUrl}')` : ""}">
        ${fotoUrl ? "" : "—"}
      </div>
      <div class="resultado-info">
        <div class="resultado-nombre">${escapeHtml(r.nombre)}</div>
        <div class="resultado-meta">${r.codigo_interno ? escapeHtml(r.codigo_interno) + " · " : ""}stock ${r.stock} · $${r.precio}</div>
      </div>
      <button class="resultado-caja" title="Ir a la caja">📦 ${escapeHtml(r.caja_nombre)}</button>
    `;
    fila.querySelector(".resultado-caja").addEventListener("click", () => {
      el("input-buscar").value = "";
      el("btn-limpiar-buscar").hidden = true;
      cont.hidden = true;
      cont.innerHTML = "";
      el("grid-cajas").hidden = false;
      mostrarVistaProductos(r.caja_id);
    });
    lista.appendChild(fila);
  });

  cont.appendChild(lista);
}

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

// ---------------- QR de la caja ----------------

el("btn-qr-caja").addEventListener("click", () => {
  if (!cajaActualId) return;
  const nombreCaja = el("titulo-caja").textContent;
  const url = `${location.origin}/#caja-${cajaActualId}`;

  el("qr-imagen").innerHTML = "";
  new QRCode(el("qr-imagen"), {
    text: url,
    width: 220,
    height: 220,
    correctLevel: QRCode.CorrectLevel.M,
  });
  el("qr-nombre").textContent = nombreCaja;
  abrirModal("modal-qr");
});

el("btn-imprimir-qr").addEventListener("click", () => {
  const etiqueta = el("qr-etiqueta").innerHTML;
  const ventana = window.open("", "_blank", "width=400,height=500");
  ventana.document.write(`
    <html>
      <head>
        <title>QR ${el("qr-nombre").textContent}</title>
        <style>
          body { margin: 0; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; }
          .etiqueta { text-align: center; padding: 20px; border: 2px solid #000; border-radius: 8px; }
          .etiqueta img, .etiqueta canvas { display: block; margin: 0 auto; }
          .nombre { margin-top: 12px; font-size: 20px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="etiqueta">${etiqueta}</div>
        <script>
          window.onload = function () { window.print(); window.onafterprint = function(){ window.close(); }; };
        <\/script>
      </body>
    </html>
  `);
  ventana.document.close();
});

// ---------------- Contabilium ----------------

const btnContabilium = el("btn-contabilium");
if (btnContabilium) {
  btnContabilium.addEventListener("click", async () => {
    if (!cajaActualId) return;

    // chequear que el servidor tenga credenciales
    const estadoRes = await fetch(`${API}/contabilium/estado`);
    const estado = await estadoRes.json();

    if (!estado.configurado) {
      abrirModal("modal-contabilium");
      el("titulo-contabilium").textContent = "Subir a Contabilium";
      el("cuerpo-contabilium").innerHTML =
        `<p class="cont-aviso">Todavía no están cargadas las credenciales de Contabilium en el servidor. Configuralas en las variables de Railway para usar esta función.</p>`;
      el("btn-confirmar-contabilium").hidden = true;
      return;
    }

    ejecutarEmpuje(estado.dry_run);
  });
}

async function ejecutarEmpuje(dryRun) {
  const nombreCaja = el("titulo-caja").textContent;
  abrirModal("modal-contabilium");
  el("titulo-contabilium").textContent = `Subir "${nombreCaja}" a Contabilium`;
  el("cuerpo-contabilium").innerHTML = `<p class="cont-cargando">Procesando…</p>`;
  el("btn-confirmar-contabilium").hidden = true;

  const res = await fetch(`${API}/cajas/${cajaActualId}/empujar-contabilium`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json();
    el("cuerpo-contabilium").innerHTML = `<p class="cont-aviso">${escapeHtml(err.detail || "Error al subir a Contabilium")}</p>`;
    return;
  }
  const data = await res.json();
  renderResumenContabilium(data);
}

function renderResumenContabilium(data) {
  const creados = data.creados.length;
  const salteados = data.salteados.length;
  const errores = data.errores.length;

  let html = "";

  if (data.dry_run) {
    html += `<p class="cont-modo cont-modo-sim">Modo simulación — no se creó nada todavía. Esto es lo que se haría:</p>`;
  } else {
    html += `<p class="cont-modo cont-modo-real">Subida real completada.</p>`;
  }

  html += `<div class="cont-resumen">
    <div class="cont-stat cont-ok"><span>${creados}</span> ${data.dry_run ? "se crearían" : "creados"}</div>
    <div class="cont-stat cont-skip"><span>${salteados}</span> ya existen (saltados)</div>
    ${errores ? `<div class="cont-stat cont-err"><span>${errores}</span> con error</div>` : ""}
  </div>`;

  if (salteados) {
    html += `<details class="cont-detalle"><summary>Ver saltados (${salteados})</summary><ul>`;
    data.salteados.forEach((s) => {
      html += `<li>${escapeHtml(s.nombre)}${s.codigo ? " — " + escapeHtml(s.codigo) : ""}</li>`;
    });
    html += `</ul></details>`;
  }

  if (errores) {
    html += `<details class="cont-detalle"><summary>Ver errores (${errores})</summary><ul>`;
    data.errores.forEach((e) => {
      html += `<li>${escapeHtml(e.nombre)}: ${escapeHtml(e.error)}</li>`;
    });
    html += `</ul></details>`;
  }

  el("cuerpo-contabilium").innerHTML = html;
  // en simulación no ofrecemos "subir ahora" desde acá: el cambio a real
  // se hace desde las variables del servidor, a propósito, para máxima seguridad
  el("btn-confirmar-contabilium").hidden = true;
}

// ---------------- Utils ----------------

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ---------------- Init ----------------

function rutearDesdeHash() {
  const m = location.hash.match(/^#caja-(\d+)$/);
  if (m) {
    mostrarVistaProductos(parseInt(m[1], 10));
  } else {
    mostrarVistaCajas();
  }
}

// Si cambian el hash (ej. escanean otro QR con la app abierta), reruteamos
window.addEventListener("hashchange", rutearDesdeHash);

rutearDesdeHash();
