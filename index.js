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

// 🧠 Глобальний логгер
process.on("unhandledRejection", (reason) => console.error("⚠️ Unhandled Rejection:", reason));
process.on("uncaughtException", (err) => console.error("🔥 Uncaught Exception:", err));

// ✅ Тест
app.get("/", (req, res) => res.send("✅ Shopify → Nova Poshta API працює! 🚀"));

// ✅ Створення ТТН
app.post("/api/np-handler", async (req, res) => {
  const order = req.body;

  const npRequest = {
    apiKey: process.env.NP_API_KEY,
    modelName: "InternetDocument",
    calledMethod: "save",
    methodProperties: {
      PayerType: "Sender",
      PaymentMethod: "Cash",
      CargoType: "Parcel",
      Weight: "1",
      ServiceType: "WarehouseWarehouse",
      SeatsAmount: "1",
      Description: order.line_items?.map(i => `${i.name} - ${i.quantity}шт`).join(", ") || "Товар",
      Cost: order.total_price || "0",
      CitySender: "db5c88f5-391c-11dd-90d9-001a92567626",
      SenderAddress: "c8025d1c-b36a-11e4-a77a-005056887b8d",
      ContactSender: "f8caa074-1740-11ef-bcd0-48df37b921da",
      SendersPhone: "380932532432",
      Sender: "6bcb6d88-16de-11ef-bcd0-48df37b921da",
      RecipientCityName: order.shipping_address?.city || "Київ",
      RecipientName: order.shipping_address?.name || "Тестовий Отримувач",
      RecipientType: "PrivatePerson",
      RecipientsPhone: order.shipping_address?.phone || "380501112233",
      RecipientAddressName: "Відділення №1",
    },
  };

  try {
    const { data } = await axios.post("https://api.novaposhta.ua/v2.0/json/", npRequest);
    if (!data.success) {
      return res.status(400).json({ error: "Nova Poshta error", details: data.errors });
    }

    res.json({
      message: "✅ ТТН створено успішно",
      ttn: data.data[0]?.IntDocNumber,
      ref: data.data[0]?.Ref,
      npData: data.data[0],
    });
  } catch (err) {
    console.error("🚨 Nova Poshta API error:", err.message);
    res.status(500).json({ error: "Failed to contact Nova Poshta API" });
  }
});

// ✅ Генерація PDF
app.post("/api/np-label", async (req, res) => {
  const { ttn, recipientName, recipientCity, recipientPhone, cost, description } = req.body;
  if (!ttn) return res.status(400).json({ error: "TTN required" });

  try {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const fontPath = path.resolve("./fonts/DejaVuSans.ttf");
    const boldFontPath = path.resolve("./fonts/DejaVuSans-Bold.ttf");
    const fontBytes = fs.readFileSync(fontPath);
    const boldFontBytes = fs.readFileSync(boldFontPath);

    const font = await pdfDoc.embedFont(fontBytes);
    const boldFont = await pdfDoc.embedFont(boldFontBytes);

    const page = pdfDoc.addPage([283.46, 283.46]);
    const { width, height } = page.getSize();

    const black = rgb(0, 0, 0);
    const border = rgb(0, 0, 0);

    // 🖤 Верхній чорний блок
    page.drawRectangle({ x: 0, y: height - 25, width, height: 25, color: black });
    page.drawText("КИЇВ СХІД ПОСИЛКОВИЙ", {
      x: 10,
      y: height - 18,
      size: 11,
      color: rgb(1, 1, 1),
      font: boldFont,
    });

    // 🧩 Іконка коробки
    try {
      const boxIconUrl = "https://upload.wikimedia.org/wikipedia/commons/8/8e/Parcel_icon.png";
      const boxIconRes = await fetch(boxIconUrl);
      const boxIconBytes = await boxIconRes.arrayBuffer();
      const boxIcon = await pdfDoc.embedPng(boxIconBytes);
      page.drawImage(boxIcon, { x: width - 85, y: height - 22, width: 16, height: 16 });
    } catch (e) {
      console.warn("⚠️ Іконка коробки не завантажилась:", e.message);
    }

    page.drawText("д11/Б557", {
      x: width - 55,
      y: height - 18,
      size: 10,
      color: rgb(1, 1, 1),
      font: boldFont,
    });

    // 📦 Блок ВІД і КОМУ
    page.drawRectangle({ x: 0, y: height - 85, width, height: 60, borderColor: border, borderWidth: 1 });
    page.drawLine({ start: { x: width / 2, y: height - 85 }, end: { x: width / 2, y: height - 25 }, thickness: 1, color: border });

    page.drawText("ВІД: " + new Date().toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }), {
      x: 10,
      y: height - 38,
      size: 9,
      font: boldFont,
    });
    page.drawText("КОМУ:", { x: width / 2 + 10, y: height - 38, size: 9, font: boldFont });

    // Відправник
    page.drawText("БУЗДИГАН ЛАРИСА ВАСИЛІВНА ФОП", { x: 10, y: height - 50, size: 8, font: boldFont });
    page.drawText("Галун Сергій Сергійович", { x: 10, y: height - 60, size: 8, font });
    page.drawText("Львів, Відділення №31", { x: 10, y: height - 70, size: 8, font });
    page.drawText("067 461 40 67", { x: 10, y: height - 80, size: 8, font });

    // Отримувач
    page.drawText("Приватна особа", { x: width / 2 + 10, y: height - 50, size: 8, font: boldFont });
    page.drawText(recipientName || "Отримувач", { x: width / 2 + 10, y: height - 60, size: 8, font });
    page.drawText(`${recipientCity || "Київ"}, Відділення №557`, { x: width / 2 + 10, y: height - 70, size: 8, font });
    page.drawText(recipientPhone || "0939911203", { x: width / 2 + 10, y: height - 80, size: 8, font });

    // 🧾 Вартість / опис
    page.drawLine({ start: { x: 0, y: height - 85 }, end: { x: width, y: height - 85 }, thickness: 1, color: border });
    page.drawText(
      `Вартість дост.: ${cost || "94"} грн (одерж., г-ка), н/з: 725, ${description || "Моносережка ОПОРА - 1шт"}`,
      { x: 10, y: height - 98, size: 8, font }
    );

    // 🧮 Об'єм, ДВ, кількість
    page.drawLine({ start: { x: 0, y: height - 120 }, end: { x: width, y: height - 120 }, thickness: 1, color: border });
    page.drawLine({ start: { x: 0, y: height - 150 }, end: { x: width, y: height - 150 }, thickness: 1, color: border });
    page.drawText("0.47", { x: 30, y: height - 137, size: 10, font: boldFont });
    page.drawText("(Об'єм)", { x: 30, y: height - 148, size: 7, font });
    page.drawText("ДВ", { x: 90, y: height - 137, size: 10, font: boldFont });
    page.drawText("1", { x: 140, y: height - 133, size: 10, font: boldFont });
    page.drawText("1", { x: 140, y: height - 145, size: 10, font: boldFont });

    // 🔢 TTN
    const formattedTTN = ttn.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
    page.drawText(formattedTTN, { x: 60, y: height - 170, size: 14, font: boldFont });

    // 🧾 Штрихкод
    const barcode = await new Promise((resolve, reject) =>
      bwipjs.toBuffer({ bcid: "code128", text: ttn, scale: 3, height: 20, includetext: false }, (err, png) =>
        err ? reject(err) : resolve(png)
      )
    );
    const barcodeImage = await pdfDoc.embedPng(barcode);
    page.drawImage(barcodeImage, { x: 30, y: height - 210, width: 230, height: 40 });

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
