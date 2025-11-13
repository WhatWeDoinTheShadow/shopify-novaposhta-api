import express from "express";
import axios from "axios";
import bwipjs from "bwip-js";
import { PDFDocument } from "pdf-lib";
import dotenv from "dotenv";
import fetch from "node-fetch"; // для Node.js < 18

dotenv.config();
const app = express();
app.use(express.json());

// 🧠 Глобальний логгер для відлову будь-яких збоїв
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("🔥 Uncaught Exception:", err);
});

// ✅ Перевірка роботи сервера
app.get("/", (req, res) => {
  res.send("✅ Shopify → Nova Poshta API працює! 🚀");
});

// ✅ Створення ТТН
app.post("/api/np-handler", async (req, res) => {
  const order = req.body;
  console.log("📦 Отримано запит:", order);

  if (!process.env.NP_API_KEY) {
    return res.status(500).json({ error: "❌ NP_API_KEY is missing on server" });
  }

  // ⚙️ Дані відправника
  const SENDER_CITY_REF = "db5c88f5-391c-11dd-90d9-001a92567626";
  const SENDER_ADDRESS_REF = "c8025d1c-b36a-11e4-a77a-005056887b8d";
  const SENDER_REF = "6bcb6d88-16de-11ef-bcd0-48df37b921da";
  const CONTACT_SENDER_REF = "f8caa074-1740-11ef-bcd0-48df37b921da";
  const SENDERS_PHONE = "380932532432";

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
      Description: `Shopify order ${order.name || "Без назви"}`,
      Cost: order.total_price || "0",
      CitySender: SENDER_CITY_REF,
      SenderAddress: SENDER_ADDRESS_REF,
      ContactSender: CONTACT_SENDER_REF,
      SendersPhone: SENDERS_PHONE,
      Sender: SENDER_REF,
      RecipientCityName: order.shipping_address?.city || "Київ",
      RecipientName: order.shipping_address?.name || "Тестовий Отримувач",
      RecipientType: "PrivatePerson",
      RecipientsPhone: order.shipping_address?.phone || "380501112233",
      RecipientAddressName: "Відділення №1",
    },
  };

  try {
    const { data } = await axios.post("https://api.novaposhta.ua/v2.0/json/", npRequest);
    console.log("📨 Відповідь Нової Пошти:", data);

    if (data.success) {
      res.json({
        message: "✅ ТТН створено успішно",
        ttn: data.data[0]?.IntDocNumber,
        ref: data.data[0]?.Ref,
        data: data.data[0],
      });
    } else {
      res.status(400).json({ message: "⚠️ Помилка при створенні ТТН", errors: data.errors });
    }
  } catch (err) {
    console.error("🚨 Помилка при зверненні до API:", err.message);
    res.status(500).json({ error: "Failed to contact Nova Poshta API" });
  }
});

// ✅ Генерація PDF етикетки 100x100 з логами
app.post("/api/np-label", async (req, res) => {
  const { ttn, recipientName, recipientCity } = req.body;

  if (!ttn) return res.status(400).json({ error: "TTN (tracking number) is required" });

  try {
    console.log("🧾 Початок генерації етикетки для ТТН:", ttn);

    // 🧩 Генерація штрихкоду
    const barcodeBuffer = await new Promise((resolve, reject) => {
      bwipjs.toBuffer(
        {
          bcid: "code128",
          text: String(ttn),
          scale: 4,
          height: 15,
          includetext: false,
        },
        (err, png) => (err ? reject(err) : resolve(png))
      );
    });
    console.log("✅ Штрихкод створено.");

    // 🧾 Створення PDF
    const pdfDoc = await PDFDocument.create();
    const fontkit = await import("fontkit");
    pdfDoc.registerFontkit(fontkit.default);

    // ✅ Завантажуємо кириличний шрифт Roboto
    const fontUrl =
      "https://github.com/google/fonts/raw/main/apache/roboto/Roboto-Regular.ttf";
    console.log("🔠 Завантаження шрифту:", fontUrl);
    const fontResponse = await fetch(fontUrl);
    if (!fontResponse.ok) {
      throw new Error(`Не вдалося завантажити шрифт (${fontResponse.status})`);
    }
    const fontBytes = await fontResponse.arrayBuffer();
    const font = await pdfDoc.embedFont(fontBytes);
    console.log("✅ Шрифт завантажено і вбудовано.");

    // 🧱 Формуємо сторінку 100×100 мм
    const page = pdfDoc.addPage([283.46, 283.46]);
    const pngImage = await pdfDoc.embedPng(barcodeBuffer);

    // 🖨️ Додаємо контент
    page.drawImage(pngImage, { x: 40, y: 150, width: 200, height: 50 });
    page.drawText(`ТТН: ${ttn}`, { x: 60, y: 220, size: 12, font });
    page.drawText(`Отримувач: ${recipientName || "—"}`, { x: 60, y: 200, size: 10, font });
    page.drawText(`Місто: ${recipientCity || "—"}`, { x: 60, y: 185, size: 10, font });
    page.drawText(`Дата: ${new Date().toLocaleString("uk-UA")}`, {
      x: 60,
      y: 170,
      size: 8,
      font,
    });

    const pdfBytes = await pdfDoc.save();
    console.log("✅ PDF етикетка згенерована успішно.");

    // 📤 Відправка PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="label-${ttn}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error("🚨 Помилка при генерації етикетки:", error.message, error.stack);
    res.status(500).json({
      error: "Failed to generate label PDF",
      details: error.message,
    });
  }
});

// ✅ Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
