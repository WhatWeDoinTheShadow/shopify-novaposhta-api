import express from "express";
import axios from "axios";
import bwipjs from "bwip-js";
import { PDFDocument, rgb } from "pdf-lib";
import * as fontkit from "fontkit";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { handleNovaPoshta } from "./np-handler.js";

dotenv.config();

// ініціалізуємо сервер ДО використання
const app = express();
app.use(express.json());
app.use("/labels", express.static("labels"));
// ========================== CONFIG ==========================
const FONTS_DIR = path.resolve("./fonts");
const LABELS_DIR = path.resolve("./labels");
if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR);

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

// головний маршрут для Shopify (використовує окремий модуль np-handler)
app.post("/api/np-handler", handleNovaPoshta);

// ==============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
