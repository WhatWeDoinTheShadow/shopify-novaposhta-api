import express from "express";
import axios from "axios";
import bwipjs from "bwip-js";
import { PDFDocument, rgb } from "pdf-lib";
import * as fontkit from "fontkit";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

// 🧠 Тестовий маршрут
app.get("/", (req, res) => res.send("✅ Shopify → Nova Poshta API працює!"));

// ✅ Генерація PDF етикетки
app.post("/api/np-label", async (req, res) => {
  const { ttn, recipientName, recipientCity, recipientPhone, cost, description } = req.body;

  if (!ttn) return res.status(400).json({ error: "TTN (tracking number) is required" });

  try {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    // 🧩 Підключення шрифтів
    const fontPath = path.resolve("./fonts/DejaVuSans.ttf");
    const boldFontPath = path.resolve("./fonts/DejaVuSans-Bold.ttf");
    const fontBytes = fs.readFileSync(fontPath);
    const boldFontBytes = fs.readFileSync(boldFontPath);
    const font = await pdfDoc.embedFont(fontBytes);
    const boldFont = await pdfDoc.embedFont(boldFontBytes);

    const page = pdfDoc.addPage([283.46, 283.46]); // 100x100mm
    const { width, height } = page.getSize();
    const black = rgb(0, 0, 0);

    // 🧩 Функція переносу рядків
    const wrapText = (text, font, size, maxWidth) => {
      const words = text.split(" ");
      const lines = [];
      let currentLine = "";

      for (let word of words) {
        const testLine = currentLine + word + " ";
        if (font.widthOfTextAtSize(testLine, size) < maxWidth) {
          currentLine = testLine;
        } else {
          lines.push(currentLine.trim());
          currentLine = word + " ";
        }
      }
      if (currentLine) lines.push(currentLine.trim());
      return lines;
    };

    // 🖤 Верхній чорний блок
    page.drawRectangle({ x: 0, y: height - 25, width, height: 25, color: black });
    page.drawText("КИЇВ СХІД ПОСИЛКОВИЙ", {
      x: 10,
      y: height - 18,
      size: 11,
      color: rgb(1, 1, 1),
      font: boldFont,
    });

    // 📦 Іконка коробки
    try {
      const iconUrl = "https://upload.wikimedia.org/wikipedia/commons/8/8e/Parcel_icon.png";
      const resp = await fetch(iconUrl);
      const iconBytes = await resp.arrayBuffer();
      const icon = await pdfDoc.embedPng(iconBytes);
      page.drawImage(icon, { x: width - 65, y: height - 22, width: 15, height: 15 });
    } catch {
      console.warn("⚠️ Іконка коробки не завантажилась.");
    }

    // 🏷️ Код Відділення
    page.drawText("д11/Б557", {
      x: width - 40,
      y: height - 18,
      size: 10,
      color: rgb(1, 1, 1),
      font: boldFont,
    });

    // 🧾 Таблиця ВІД / КОМУ
    const topY = height - 25;
    const bottomY = height - 85;
    page.drawRectangle({ x: 0, y: bottomY, width, height: 60, borderColor: black, borderWidth: 1 });
    page.drawLine({ start: { x: width / 2, y: bottomY }, end: { x: width / 2, y: topY }, thickness: 1, color: black });

    const timestamp = new Date().toLocaleString("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    // ВІД
    page.drawText(`ВІД: ${timestamp}`, { x: 10, y: height - 38, size: 9, font: boldFont });
    page.drawText("КОМУ:", { x: width / 2 + 10, y: height - 38, size: 9, font: boldFont });

    // Відправник
    page.drawText("БУЗДИГАН ЛАРИСА ВАСИЛІВНА ФОП", { x: 10, y: height - 50, size: 7.5, font: boldFont });
    page.drawText("Галун Сергій Сергійович", { x: 10, y: height - 60, size: 8, font });
    page.drawText("Львів, Відділення №31", { x: 10, y: height - 70, size: 8, font });
    page.drawText("067 461 40 67", { x: 10, y: height - 80, size: 8, font });

    // Отримувач
    page.drawText("Приватна особа", { x: width / 2 + 10, y: height - 50, size: 8, font: boldFont });
    page.drawText(recipientName || "Отримувач", { x: width / 2 + 10, y: height - 60, size: 8, font });
    page.drawText(`${recipientCity || "Київ"}, Відділення №557`, { x: width / 2 + 10, y: height - 70, size: 8, font });
    page.drawText(recipientPhone || "0939911203", { x: width / 2 + 10, y: height - 80, size: 8, font });

    // 🧾 Вартість доставки + опис
    page.drawLine({ start: { x: 0, y: height - 85 }, end: { x: width, y: height - 85 }, thickness: 1, color: black });
    const costLine = `Вартість дост.: ${cost || "94"} грн (одерж., г-ка), н/з: 725, ${description || "Моносережка ОПОРА - 1шт"}`;
    const lines = wrapText(costLine, font, 8, 260);
    lines.forEach((line, i) => {
      page.drawText(line, { x: 10, y: height - 98 - i * 10, size: 8, font });
    });

    // 📏 Таблиця 0.47 / ДВ / 1/1
    page.drawLine({ start: { x: 0, y: height - 120 }, end: { x: width, y: height - 120 }, thickness: 1, color: black });
    page.drawLine({ start: { x: 0, y: height - 150 }, end: { x: width, y: height - 150 }, thickness: 1, color: black });

    page.drawText("0.47", { x: 30, y: height - 137, size: 10, font: boldFont });
    page.drawText("(Об'єм)", { x: 30, y: height - 148, size: 7, font });
    page.drawText("ДВ", { x: 90, y: height - 137, size: 10, font: boldFont });
    page.drawText("1", { x: 140, y: height - 133, size: 10, font: boldFont });
    page.drawText("1", { x: 140, y: height - 145, size: 10, font: boldFont });

    // 🧾 TTN (номер)
    const formattedTTN = ttn.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
    page.drawText(formattedTTN, { x: 55, y: height - 175, size: 14, font: boldFont });

    // 🧾 Основний штрихкод
    const barcodeBuffer = await new Promise((resolve, reject) =>
      bwipjs.toBuffer(
        { bcid: "code128", text: ttn, scale: 3, height: 20, includetext: false },
        (err, png) => (err ? reject(err) : resolve(png))
      )
    );
    const barcodeImage = await pdfDoc.embedPng(barcodeBuffer);
    page.drawImage(barcodeImage, { x: 30, y: height - 220, width: 230, height: 40 });

    // 📤 Відправлення PDF
    const pdfBytes = await pdfDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="label-${ttn}.pdf"`);
    res.end(Buffer.from(pdfBytes));
  } catch (error) {
    console.error("🚨 Помилка при генерації етикетки:", error);
    res.status(500).json({ error: "Failed to generate label PDF", details: error.message });
  }
});

// 🚀 Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
