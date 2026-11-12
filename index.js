import express from "express";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { handleNovaPoshta } from "./np-handler.js";
import monoPayRouter from "./mono-pay.js";

dotenv.config();

// ========================== PATH HELPERS ==========================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========================== INIT SERVER ==========================
const app = express();
app.use(express.json());

// ========================== LABELS FOLDER ==========================
const LABELS_DIR = path.resolve(__dirname, "./labels");
if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR);

// роздаємо PDF з етикетками
app.use("/labels", express.static(LABELS_DIR));

// ========================== MONOBANK PAYMENT (customer-facing) ==========================
// GET /pay/:orderId → redirect to Monobank payment page
app.use(monoPayRouter);

// ========================== HEALTHCHECK ==========================
app.get("/", (req, res) => {
  res.send(`
    <h2>🚚 Shopify → Nova Poshta + Monobank API</h2>
    <p>Сервіс працює. Основні маршрути:</p>
    <ul>
      <li>GET <code>/api/nova-poshta</code> — тестова сторінка</li>
      <li>POST <code>/api/nova-poshta</code> — вебхук з Shopify (order/create)</li>
      <li>GET <code>/labels/&lt;filename&gt;.pdf</code> — доступ до збережених етикеток</li>
    </ul>
  `);
});

// ========================== TEST PAGE (GET) ==========================
app.get("/api/nova-poshta", (req, res) => {
  res.status(200).send(`
    <h2>🚚 Shopify → Нова Пошта API</h2>
    <p>Цей маршрут очікує <strong>POST</strong> запит із JSON-даними Shopify (order/create).</p>
    <p>Приклад payload:</p>
    <pre>{
  "id": 1234567890,
  "name": "#1002",
  "total_price": "450",
  "shipping_address": {
    "city": "Київ",
    "address1": "Відділення №1",
    "name": "Буздиган Лариса Василівна",
    "phone": "+380673334455"
  },
  "line_items": [{ "name": "Моносережка ОПОРА", "quantity": 1, "price": "450" }],
  "payment_gateway_names": ["Cash on Delivery (COD)"]
}</pre>
  `);
});

// ========================== MAIN WEBHOOK (POST) ==========================
// Shopify Webhook: Orders → order/create → POST https://.../api/nova-poshta
app.post("/api/nova-poshta", async (req, res) => {
  try {
    await handleNovaPoshta(req, res);
  } catch (err) {
    console.error("🚨 Помилка у головному маршруті /api/nova-poshta:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// ========================== ERROR HANDLERS ==========================
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("🔥 Uncaught Exception:", err);
});

// ========================== SERVER START ==========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📦 Test GET (Nova Poshta): http://localhost:${PORT}/api/nova-poshta`);
  console.log(`🌐 Labels:                 http://localhost:${PORT}/labels/<filename>.pdf`);
});
