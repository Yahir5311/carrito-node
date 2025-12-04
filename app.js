// app.js
const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const db = require('./config/db');

// 👇 Motor de layouts para EJS
const engine = require('ejs-mate');

const app = express();

// ========= CONFIGURACIÓN DE VISTAS =========
app.engine('ejs', engine);              // usar ejs-mate
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ========= MIDDLEWARES =========
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sesiones
app.use(
  session({
    secret: 'mi_super_secreto',
    resave: false,
    saveUninitialized: false
  })
);

// Variables globales para las vistas
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.cart = req.session.cart || { items: {}, totalQty: 0, totalPrice: 0 };
  next();
});

// ========= FUNCIONES AUXILIARES =========
function initCart(req) {
  if (!req.session.cart) {
    req.session.cart = { items: {}, totalQty: 0, totalPrice: 0 };
  }
}

async function getAllProducts() {
  const [rows] = await db.query('SELECT * FROM products');
  return rows;
}

// ========= RUTAS PRINCIPALES =========

// Página principal - listar productos
app.get('/', async (req, res) => {
  try {
    const products = await getAllProducts();
    res.render('index', { products });
  } catch (err) {
    console.error(err);
    res.send('Error cargando productos');
  }
});

// ========= AUTENTICACIÓN =========

// Registro - GET
app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

// Registro - POST
app.post('/register', async (req, res) => {
  const { nombre, email, password } = req.body;
  if (!nombre || !email || !password) {
    return res.render('register', { error: 'Todos los campos son obligatorios.' });
  }

  try {
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.render('register', { error: 'Ese correo ya está registrado.' });
    }

    const hash = await bcrypt.hash(password, 10);
    await db.query(
      'INSERT INTO users (nombre, email, password_hash) VALUES (?, ?, ?)',
      [nombre, email, hash]
    );

    res.redirect('/login');
  } catch (err) {
    console.error(err);
    res.render('register', { error: 'Error al registrar usuario.' });
  }
});

// Login - GET
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// Login - POST
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.render('login', { error: 'Todos los campos son obligatorios.' });
  }

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.render('login', { error: 'Correo o contraseña incorrectos.' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.render('login', { error: 'Correo o contraseña incorrectos.' });
    }

    req.session.user = { id: user.id, nombre: user.nombre, email: user.email };
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('login', { error: 'Error al iniciar sesión.' });
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// Middleware para proteger rutas
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

// ========= CARRITO =========

// Ver carrito
app.get('/cart', (req, res) => {
  initCart(req);
  const cart = req.session.cart;
  res.render('cart', { cart });
});

// Agregar producto al carrito
app.post('/cart/add/:id', async (req, res) => {
  initCart(req);
  const productId = req.params.id;
  const quantity = parseInt(req.body.quantity) || 1;

  try {
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [productId]);
    if (rows.length === 0) {
      return res.redirect('/');
    }
    const product = rows[0];

    const cart = req.session.cart;

    if (!cart.items[productId]) {
      cart.items[productId] = {
        productId: product.id,
        nombre: product.nombre,
        // aseguramos número
        precio: Number(product.precio),
        quantity: 0
      };
    }

    cart.items[productId].quantity += quantity;

    // Recalcular totales
    cart.totalQty = 0;
    cart.totalPrice = 0;
    Object.values(cart.items).forEach(item => {
      cart.totalQty += item.quantity;
      cart.totalPrice += item.quantity * item.precio;
    });

    res.redirect('/cart');
  } catch (err) {
    console.error(err);
    res.redirect('/');
  }
});

// Actualizar cantidad de producto en carrito
app.post('/cart/update/:id', (req, res) => {
  initCart(req);
  const productId = req.params.id;

  // Puede venir de form (urlencoded) o de fetch(JSON)
  const quantity = parseInt(req.body.quantity);

  const cart = req.session.cart;
  if (cart.items[productId]) {
    if (isNaN(quantity) || quantity <= 0) {
      delete cart.items[productId];
    } else {
      cart.items[productId].quantity = quantity;
    }

    cart.totalQty = 0;
    cart.totalPrice = 0;
    Object.values(cart.items).forEach(item => {
      cart.totalQty += item.quantity;
      cart.totalPrice += item.quantity * item.precio;
    });
  }

  // Si viene de AJAX devolvemos JSON
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    return res.json({
      totalQty: cart.totalQty,
      totalPrice: cart.totalPrice
    });
  }

  // Si es un form normal, redirigimos
  res.redirect('/cart');
});

// Eliminar producto del carrito
app.post('/cart/remove/:id', (req, res) => {
  initCart(req);
  const productId = req.params.id;

  const cart = req.session.cart;
  if (cart.items[productId]) {
    delete cart.items[productId];

    cart.totalQty = 0;
    cart.totalPrice = 0;
    Object.values(cart.items).forEach(item => {
      cart.totalQty += item.quantity;
      cart.totalPrice += item.quantity * item.precio;
    });
  }

  res.redirect('/cart');
});

// ========= COMPRAS / HISTORIAL =========

// Finalizar compra
app.post('/cart/checkout', requireLogin, async (req, res) => {
  initCart(req);
  const cart = req.session.cart;

  if (!cart || cart.totalQty === 0) {
    return res.redirect('/cart');
  }

  const userId = req.session.user.id;

  try {
    // Crear orden
    const [result] = await db.query(
      'INSERT INTO orders (user_id, total) VALUES (?, ?)',
      [userId, cart.totalPrice]
    );

    const orderId = result.insertId;

    // Insertar detalles
    const items = Object.values(cart.items);
    for (const item of items) {
      await db.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
        [orderId, item.productId, item.quantity, item.precio]
      );
    }

    // Limpiar carrito
    req.session.cart = { items: {}, totalQty: 0, totalPrice: 0 };

    // Redirigir a ticket
    res.redirect(`/orders/${orderId}/ticket`);
  } catch (err) {
    console.error(err);
    res.redirect('/cart');
  }
});

// Historial de compras
app.get('/orders/history', requireLogin, async (req, res) => {
  const userId = req.session.user.id;

  try {
    const [orders] = await db.query(
      'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    res.render('history', { orders });
  } catch (err) {
    console.error(err);
    res.send('Error al cargar historial');
  }
});

// Ticket HTML
app.get('/orders/:id/ticket', requireLogin, async (req, res) => {
  const orderId = req.params.id;
  const userId = req.session.user.id;

  try {
    const [[order]] = await db.query(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?',
      [orderId, userId]
    );
    if (!order) return res.send('Orden no encontrada');

    const [items] = await db.query(
      `SELECT oi.*, p.nombre 
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    res.render('ticket', { order, items, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.send('Error al cargar ticket');
  }
});

// Ticket PDF
app.get('/orders/:id/ticket/pdf', requireLogin, async (req, res) => {
  const orderId = req.params.id;
  const userId = req.session.user.id;

  try {
    const [[order]] = await db.query(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?',
      [orderId, userId]
    );
    if (!order) return res.send('Orden no encontrada');

    const [items] = await db.query(
      `SELECT oi.*, p.nombre 
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="ticket_${orderId}.pdf"`
    );

    doc.pipe(res);

    doc.fontSize(20).text('Ticket de compra', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Cliente: ${req.session.user.nombre}`);
    doc.text(`Correo: ${req.session.user.email}`);
    doc.text(`Fecha: ${order.created_at}`);
    doc.moveDown();

    doc.text(`Número de orden: ${order.id}`);
    doc.text(`Total: $${order.total.toFixed(2)}`);
    doc.moveDown();

    doc.fontSize(14).text('Detalle de productos:');
    doc.moveDown();

    items.forEach((item) => {
      doc
        .fontSize(12)
        .text(
          `${item.nombre} - Cant: ${item.quantity} x $${item.price.toFixed(
            2
          )} = $${(item.quantity * item.price).toFixed(2)}`
        );
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.send('Error al generar PDF');
  }
});

// ========= SERVIDOR =========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
