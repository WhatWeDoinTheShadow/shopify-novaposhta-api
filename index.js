import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { handleNovaPoshta } from "./np-handler.js";

dotenv.config();

const app = express();
app.use(express.json());

// ========================== LABELS FOLDER ==========================
const LABELS_DIR = path.resolve("./labels");
if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR);

// Роздаємо PDF з етикетками
app.use("/labels", express.static("labels"));

// ========================== DEBUG ROOT ==========================
app.get("/", (req, res) => {
  res.send("✅ Shopify → Nova Poshta API running");
});

// ========================== GET TEST ROUTE ==========================
app.get("/api/nova-poshta", (req, res) => {
  res.status(200).send(`
    <h2>🚚 Shopify → Nova Poshta API</h2>
    <p>Цей маршрут приймає POST із JSON замовлення Shopify.</p>
    <pre>{
  "name": "#1002",
  "total_price": "450",
  "shipping_address": {
    "city": "Київ",
    "address1": "Відділення 1",
    "name": "Ivan Petrov",
    "phone": "+380671234567"
  },
  "line_items": [{ "name": "Картина", "price": "450", "quantity": 1 }]
}</pre>
  `);
});

// ========================== MAIN POST ROUTE ==========================

app.post("/api/nova-poshta", async (req, res) => {
  try {
    console.log("📥 POST /api/nova-poshta отримано замовлення");

    const result = await handleNovaPoshta(req, res);

    // Якщо handleNovaPoshta сам вже надіслав відповідь → не дублюємо
    if (res.headersSent) return;

    // Якщо handleNovaPoshta повернув дані
    if (result && result.ttn) {
      const baseUrl = `${req.protocol}://${req.get("host")}`;

      return res.json({
        message: "✅ ТТН створено і етикетка згенерована",
        ttn: result.ttn,
        label_url: `${baseUrl}/labels/label-${result.ttn}.pdf`,
        payment_link: result.payment_link || "—",
        mono_invoice_id: result.mono_invoice_id || "—",
      });
    }

    return res.status(500).json({
      error: "❌ handleNovaPoshta не повернув результат",
    });

  } catch (err) {
    console.error("🚨 Помилка у маршруті /api/nova-poshta:", err);
    if (!res.headersSent)
      res.status(500).json({ error: err.message });
  }
});

// ========================== SERVER ==========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(
    `📦 Test GET: http://localhost:${PORT}/api/nova-poshta`
  );
});
