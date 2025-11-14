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
app.get("/", (req, res) =>
  res.send("✅ Shopify → Nova Poshta автоматична етикетка працює 🚀")
);

// 🔹 Головний маршрут для Shopify
app.post("/api/np-handler", async (req, res) => {
  try {
    // Викликаємо логіку з np-handler.js
    const result = await handleNovaPoshta(req, res);

    // Якщо функція повернула результат (а не відправила res сама)
    if (result && result.ttn && !res.headersSent) {
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const labelUrl = `${baseUrl}/labels/label-${result.ttn}.pdf`;

      res.json({
        ...result,
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
