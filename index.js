import express from "express";
import axios from "axios";
import fetch from "node-fetch";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import bwipjs from "bwip-js";

const app = express();
app.use(express.json());

// ✅ Головна сторінка
app.get("/", (req, res) => {
  res.send("✅ Shopify → Nova Poshta API працює! 🚀");
});


// ===============================
// 🧩 1️⃣ СТВОРЕННЯ ТТН
// ===============================
app.post("/api/np-handler", async (req, res) => {
  console.log("📦 Отримано запит:", req.body);
  const order = req.body;

  if (!process.env.NP_API_KEY) {
    return res.status(500).json({ error: "❌ NP_API_KEY is missing on server" });
  }

  // ⚙️ Дані відправника Нової пошти
  const SENDER_CITY_REF = "db5c88f5-391c-11dd-90d9-001a92567626";       // Львів
  const SENDER_ADDRESS_REF = "c8025d1c-b36a-11e4-a77a-005056887b8d";    // Відділення №31, вул. Тершаківців, 1
  const SENDER_REF = "6bcb6d88-16de-11ef-bcd0-48df37b921da";            // ФОП Буздиган
  const CONTACT_SENDER_REF = "f8caa074-1740-11ef-bcd0-48df37b921da";    // Контактна особа
  const SENDERS_PHONE = "380932532432";                                 // Телефон

  const npRequest = {
    apiKey: process.env.NP_API_KEY,
    modelName: "InternetDocument",
    calledMethod: "save",
    methodProperties: {
      NewAddress: "1",
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
      RecipientAddressName: "Відділення №1"
    }
  };

  try {
    const { data } = await axios.post("https://api.novaposhta.ua/v2.0/json/", npRequest);
    console.log("📨 Відповідь Нової Пошти:", data);

    if (data.success) {
      res.json({
        message: "✅ ТТН створено успішно",
        ttn: data.data[0]?.IntDocNumber,
        cost: data.data[0]?.Cost,
        ref: data.data[0]?.Ref,
        data: data.data[0]
      });
    } else {
      res.status(400).json({
        message: "⚠️ Помилка при створенні ТТН",
        errors: data.errors,
        warnings: data.warnings
      });
    }
  } catch (error) {
    console.error("🚨 Помилка при зверненні до API Нової Пошти:", error.message);
    res.status(500).json({ error: "Failed to contact Nova Poshta API" });
  }
});


// ===============================
// 🧾 2️⃣ СТВОРЕННЯ ЕТИКЕТКИ 100x100 ММ
// ===============================
app.get("/api/label/:orderId/:ref", async (req, res) => {
  try {
    const { orderId, ref } = req.params;
    console.log(`📦 Формуємо етикетку для Shopify order ${orderId} / TTN Ref ${ref}`);

    // ⚙️ Отримуємо деталі ТТН з Нової пошти
    const npRequest = {
      apiKey: process.env.NP_API_KEY,
      modelName: "InternetDocument",
      calledMethod: "getDocumentList",
      methodProperties: { Ref: ref }
    };

    const npRes = await fetch("https://api.novaposhta.ua/v2.0/json/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(npRequest)
    });

    const npData = await npRes.json();
    if (!npData.success) throw new Error(npData.errors?.join(", ") || "Помилка отримання ТТН");
    const ttn = npData.data[0]?.IntDocNumber || "00000000000000";

    // ⚙️ Отримувач (тестові або Shopify)
    const recipient = {
      name: npData.data[0]?.RecipientContactPerson || "Отримувач",
      phone: npData.data[0]?.RecipientsPhone || "380000000000",
      city: npData.data[0]?.CityRecipient || "Невідомо",
      address: npData.data[0]?.RecipientAddressName || "Відділення №1"
    };

    // Генеруємо штрихкод
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: "code128",
      text: ttn,
      scale: 3,
      height: 15,
      includetext: true
    });

    // Створюємо PDF 100x100 мм
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([283.46, 283.46]); // 100x100 мм
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const barcodeImage = await pdfDoc.embedPng(barcodeBuffer);

    // Малюємо етикетку
    page.drawImage(barcodeImage, { x: 40, y: 170, width: 200, height: 50 });

    page.drawText(`Отримувач: ${recipient.name}`, { x: 20, y: 130, size: 10, font, color: rgb(0, 0, 0) });
    page.drawText(`Телефон: ${recipient.phone}`, { x: 20, y: 115, size: 10, font, color: rgb(0, 0, 0) });
    page.drawText(`Місто: ${recipient.city}`, { x: 20, y: 100, size: 10, font, color: rgb(0, 0, 0) });
    page.drawText(`Адреса: ${recipient.address}`, { x: 20, y: 85, size: 10, font, color: rgb(0, 0, 0) });
    page.drawText(`ТТН: ${ttn}`, { x: 20, y: 70, size: 10, font, color: rgb(0.2, 0.2, 0.2) });

    const pdfBytes = await pdfDoc.save();

    // Відправляємо результат
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="label_${orderId}_${ttn}.pdf"`
    });
    res.send(Buffer.from(pdfBytes));

    console.log(`✅ Етикетка створена для ${recipient.name} (${ttn})`);
  } catch (err) {
    console.error("❌ Помилка:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// ✅ Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
