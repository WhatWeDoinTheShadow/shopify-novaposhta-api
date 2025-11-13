import express from "express";
import axios from "axios";
import bwipjs from "bwip-js";
import { PDFDocument } from "pdf-lib";
import * as fontkit from "fontkit";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

// 🧠 Логування помилок
process.on("unhandledRejection", (reason) => console.error("⚠️ Unhandled Rejection:", reason));
process.on("uncaughtException", (err) => console.error("🔥 Uncaught Exception:", err));

// ✅ Перевірка
app.get("/", (req, res) => {
  res.send("✅ Shopify → Nova Poshta Label API працює! 🚀");
});

// ✅ Генерація PDF етикетки
app.post("/api/np-label", async (req, res) => {
  const {
    ttn = "20451294145336",
    recipientName = "Андрій Суходолов",
    recipientCity = "Київ",
    recipientWarehouse = "Відділення №557",
    recipientPhone = "0939911203",
    orderDescription = "Моносережка ОПОРА - 1шт",
    orderCost = "94",
    orderNumber = "725",
    branchCode = "Д11/В557"
  } = req.body;

  try {
    // 🧩 Генеруємо штрихкод основний
    const mainBarcode = await new Promise((resolve, reject) => {
      bwipjs.toBuffer(
        { bcid: "code128", text: String(ttn), scale: 4, height: 15, includetext: false },
        (err, png) => (err ? reject(err) : resolve(png))
      );
    });

    // 🧩 Бічний штрихкод (повернутий)
    const sideBarcode = await new Promise((resolve, reject) => {
      bwipjs.toBuffer(
        { bcid: "code128", text: String(ttn), scale: 2, height: 60, includetext: false, rotate: "R" },
        (err, png) => (err ? reject(err) : resolve(png))
      );
    });

    // 🧱 Шрифти DejaVuSans
    const fontPath = path.resolve("./fonts/DejaVuSans.ttf");
    const boldPath = path.resolve("./fonts/DejaVuSans-Bold.ttf");
    const fontBytes = fs.readFileSync(fontPath);
    const boldBytes = fs.readFileSync(boldPath);

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const font = await pdfDoc.embedFont(fontBytes);
    const bold = await pdfDoc.embedFont(boldBytes);

    const page = pdfDoc.addPage([283.46, 283.46]); // 100x100 мм
    const { width } = page.getSize();

    // 🎯 Верхня чорна смуга
page.drawRectangle({ x: 0, y: 250, width, height: 33, color: [0, 0, 0] });
page.drawText(`${recipientCity.toUpperCase()} ПОСИЛКОВИЙ`, {
  x: 10,
  y: 260,
  size: 14,
  font: bold,
  color: [1, 1, 1],
});
page.drawText(branchCode, {
  x: width - 85,
  y: 260,
  size: 12,
  font: bold,
  color: [1, 1, 1],
});

    // 🕒 Поточна дата та час
    const now = new Date();
    const date = now.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
    const time = now.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });

    // 🔲 Блок "ВІД" та "КОМУ"
    const blockY = 185;
    page.drawText(`ВІД: ${date}/${time}`, { x: 10, y: blockY + 45, size: 9, font: bold });
    page.drawText("КОМУ:", { x: 145, y: blockY + 45, size: 9, font: bold });

    // Відправник (статичний)
    page.drawText("БУЗДИГАН ЛАРИСА ВАСИЛІВНА ФОП", { x: 10, y: blockY + 32, size: 8, font: bold });
    page.drawText("Галун Сергій Сергійович", { x: 10, y: blockY + 22, size: 8, font });
    page.drawText("Львів, Відділення №31", { x: 10, y: blockY + 12, size: 8, font });
    page.drawText("067 461 40 67", { x: 10, y: blockY + 2, size: 8, font });

    // Отримувач (динамічний)
    page.drawText("Приватна особа", { x: 145, y: blockY + 32, size: 8, font: bold });
    page.drawText(recipientName, { x: 145, y: blockY + 22, size: 8, font });
    page.drawText(`${recipientCity}, ${recipientWarehouse}`, { x: 145, y: blockY + 12, size: 8, font });
    page.drawText(recipientPhone, { x: 145, y: blockY + 2, size: 8, font });

    // 🔹 Лінія вартості
    const lineText = `Вартість дост.: ${orderCost} грн (одерж., г-ка), н/з: ${orderNumber}, ${orderDescription}`;
    page.drawText(lineText, { x: 10, y: 168, size: 8, font });

    // 🔹 Таблиця (обʼєм, ДВ, місця)
    page.drawText("0.47", { x: 20, y: 140, size: 10, font: bold });
    page.drawText("ДВ", { x: 70, y: 140, size: 10, font: bold });
    page.drawText("1", { x: 120, y: 145, size: 10, font: bold });
    page.drawText("1", { x: 120, y: 130, size: 10, font: bold });
    page.drawText("(Об'єм)", { x: 20, y: 130, size: 6, font });

    // 🔹 Основний ТТН
    const formattedTTN = ttn.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
    page.drawText(formattedTTN, { x: 60, y: 105, size: 14, font: bold });

    // 🔹 Основний штрихкод
    const barcodeImage = await pdfDoc.embedPng(mainBarcode);
    page.drawImage(barcodeImage, { x: 40, y: 50, width: 200, height: 40 });

    // 🔹 Вертикальний штрихкод (праворуч)
    const sideImage = await pdfDoc.embedPng(sideBarcode);
    page.drawImage(sideImage, { x: width - 20, y: 50, width: 15, height: 140 });

    // 🎉 Готово
    const pdfBytes = await pdfDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="label-${ttn}.pdf"`);
    res.end(Buffer.from(pdfBytes));
  } catch (error) {
    console.error("🚨 Помилка при генерації етикетки:", error);
    res.status(500).json({ error: "Failed to generate label PDF", details: error.message });
  }
});

// ✅ Запуск
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
