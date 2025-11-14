import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { handleNovaPoshta } from "./np-handler.js";

dotenv.config();

// ========================== INIT SERVER ==========================
const app = express();
app.use(express.json());

// ========================== CONFIG ==========================
const LABELS_DIR = path.resolve("./labels");
if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR);

// 🔹 Роздаємо PDF через /labels
app.use("/labels", express.static("labels"));

// 🧠 Error handling
process.on("unhandledRejection", (reason) =>
  console.error("⚠️ Unhandled Rejection:", reason)
);
process.on("uncaughtException", (err) =>
  console.error("🔥 Uncaught Exception:", err)
);

// ========================== ROUTES ==========================

// 🔹 Кореневий маршрут
app.get("/", (req, res) =>
  res.send("✅ Shopify → Nova Poshta автоматична етикетка працює 🚀")
);

// 🔹 Fallback для тестів у браузері (GET)
app.get("/api/np-handler", (req, res) => {
  res.status(200).send(`
    <h2>🚚 Shopify → Нова Пошта API</h2>
    <p>Цей маршрут очікує <strong>POST</strong> запит із JSON-даними Shopify.</p>
    <pre>{
  "name": "#1002",
  "total_price": "450",
  "shipping_address": {
    "city": "Київ",
    "address1": "Відділення №1",
    "name": "Буздиган Лариса Василівна",
    "phone": "+380673334455"
  },
  "line_items": [{ "name": "Моносережка ОПОРА", "quantity": 1 }]
}</pre>
  `);
});

// 🔹 Основний POST маршрут (Shopify webhook)
app.post("/api/np-handler", async (req, res) => {
  try {
    const result = await handleNovaPoshta(req, res);

    // Якщо функція повернула результат — формуємо URL
    if (result && result.ttn && !res.headersSent) {
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const labelUrl = `${baseUrl}/labels/label-${result.ttn}.pdf`;

      res.json({
        message: "✅ ТТН створено і етикетка згенерована",
        ttn: result.ttn,
        ref: result.ref,
        label_path: result.label_path,
        label_url: labelUrl,
      });
    }
  } catch (err) {
    console.error("🚨 Помилка у головному маршруті:", err.message);
    if (!res.headersSent)
      res.status(500).json({ error: err.message });
  }
});

// ========================== SERVER ==========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Labels available at http://localhost:${PORT}/labels/<filename>.pdf`);
});
