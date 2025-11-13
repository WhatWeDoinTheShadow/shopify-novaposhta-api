import express from "express";
import axios from "axios";
import bwipjs from "bwip-js";
import { PDFDocument, rgb } from "pdf-lib";
import * as fontkit from "fontkit";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

// 🧠 Глобальний логгер
process.on("unhandledRejection", (reason) => console.error("⚠️ Unhandled Rejection:", reason));
process.on("uncaughtException", (err) => console.error("🔥 Uncaught Exception:", err));

// ✅ Перевірка
app.get("/", (req, res) => res.send("✅ Shopify → Nova Poshta API працює! 🚀"));

// ✅ Генерація PDF
app.post("/api/np-label", async (req, res) => {
  try {
    // 🧾 Дані з Shopify + НП
    const {
      ttn = "20451294145336",
      recipientName = "Андрій Суходолов",
      recipientPhone = "0939911203",
      recipientCity = "Київ",
      recipientWarehouse = "Відділення №557",
      orderCost = "94",
      orderNumber = "725",
      orderDescription = "Моносережка ОПОРА - 1шт",
      senderBranchCode = "Д11/В557",
      cityLabel = "КИЇВ СХІД",
      deliveryType = "ПОСИЛКОВИЙ",
    } = req.body;

    // 🧩 Штрихкод основний
    const mainBarcode = await new Promise((resolve, reject) => {
      bwipjs.toBuffer(
        { bcid: "code128", text: String(ttn), scale: 4, height: 15, includetext: false },
        (err, png) => (err ? reject(err) : resolve(png))
      );
    });

    // 🧩 Штрихкод боковий
    const sideBarcode = await new Promise((resolve, reject) => {
      bwipjs.toBuffer(
        { bcid: "code128", text: String(ttn), scale: 2, height: 60, includetext: false, rotate: "R" },
        (err, png) => (err ? reject(err) : resolve(png))
      );
    });

    // 🧩 Підключення шрифтів
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

    // 🟧 Верхній чорний банер
    page.drawRectangle({ x: 0, y: 250, width, height: 33, color: rgb(0, 0, 0) });
    page.drawText(`${cityLabel.toUpperCase()} ${deliveryType.toUpperCase()}`, {
      x: 10,
      y: 260,
      size: 14,
      font: bold,
      color: rgb(1, 1, 1),
    });
    page.drawText(senderBranchCode, {
      x: width - 85,
      y: 260,
      size: 12,
      font: bold,
      color: rgb(1, 1, 1),
    });

    // 🕒 Дата
    const now = new Date();
    const date = now.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
    const time = now.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });

    // 🟩 Контур таблиці
    const drawLine = (x1, y1, x2, y2) =>
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 1, color: rgb(0, 0, 0) });

    // Основна рамка
    drawLine(0, 175, width, 175);
    drawLine(0, 155, width, 155);
    drawLine(0, 125, width, 125);
    drawLine(0, 90, width, 90);
    drawLine(0, 50, width, 50);
    drawLine(width - 18, 50, width - 18, 175);

    // Вертикальні роздільники (блок “ВІД/КОМУ”)
    drawLine(140, 175, 140, 250);

    // 🟦 Текст “ВІД / КОМУ”
    page.drawText(`ВІД: ${date}/${time}`, { x: 10, y: 232, size: 9, font: bold });
    page.drawText(`КОМУ:`, { x: 150, y: 232, size: 9, font: bold });

    // 🟩 Відправник (фіксований)
    page.drawText(`БУЗДИГАН ЛАРИСА ВАСИЛІВНА ФОП`, { x: 10, y: 220, size: 7.5, font: bold });
    page.drawText(`Галун Сергій Сергійович`, { x: 10, y: 210, size: 7.5, font });
    page.drawText(`Львів, Відділення №31`, { x: 10, y: 200, size: 7.5, font });
    page.drawText(`067 461 40 67`, { x: 10, y: 190, size: 7.5, font });

    // 🟨 Отримувач (динамічно)
    page.drawText(`Приватна особа`, { x: 150, y: 220, size: 7.5, font: bold });
    page.drawText(recipientName, { x: 150, y: 210, size: 7.5, font });
    page.drawText(`${recipientCity}, ${recipientWarehouse}`, { x: 150, y: 200, size: 7.5, font });
    page.drawText(recipientPhone, { x: 150, y: 190, size: 7.5, font });

    // 🟧 Вартість і опис
    const costText = `Вартість дост.: ${orderCost} грн (одерж., г-ка), н/з: ${orderNumber}, ${orderDescription}`;
    const costLines = costText.match(/.{1,60}/g) || [];
    costLines.forEach((line, i) =>
      page.drawText(line, { x: 10, y: 172 - i * 9, size: 7.5, font, color: rgb(0, 0, 0) })
    );

    // 🟨 Таблиця нижня
    page.drawText("0.47", { x: 20, y: 135, size: 10, font: bold });
    page.drawText("(Об'єм)", { x: 20, y: 125, size: 6, font });
    page.drawText("ДВ", { x: 70, y: 135, size: 10, font: bold });
    page.drawText("1", { x: 120, y: 140, size: 10, font: bold });
    page.drawText("1", { x: 120, y: 128, size: 10, font: bold });

    // 🧾 TTN
    const formattedTTN = ttn.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
    page.drawText(formattedTTN, { x: 50, y: 100, size: 14, font: bold });

    // 🧩 Основний штрихкод
    const barcodeImage = await pdfDoc.embedPng(mainBarcode);
    page.drawImage(barcodeImage, { x: 40, y: 55, width: 200, height: 35 });

    // 🧩 Бічний штрихкод
    const sideImage = await pdfDoc.embedPng(sideBarcode);
    page.drawImage(sideImage, { x: width - 15, y: 50, width: 12, height: 120 });

    // 📤 Відправка
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
