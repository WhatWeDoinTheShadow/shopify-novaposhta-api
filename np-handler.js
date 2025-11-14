import axios from "axios";
import bwipjs from "bwip-js";
import { PDFDocument, rgb } from "pdf-lib";
import * as fontkit from "fontkit";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";

const FONTS_DIR = path.resolve("./fonts");
const LABELS_DIR = path.resolve("./labels");
if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR);

export async function handleNovaPoshta(req, res) {
  const order = req.body;
  console.log("📦 Нове замовлення з Shopify:", order.name);

  if (!process.env.NP_API_KEY)
    return res.status(500).json({ error: "❌ NP_API_KEY is missing on server" });

  try {
    // === 1. Дані відправника
    const SENDER_CITY_REF = "db5c88f5-391c-11dd-90d9-001a92567626"; // Львів
    const SENDER_ADDRESS_REF = "c8025d1c-b36a-11e4-a77a-005056887b8d"; // Відділення №31
    const SENDER_REF = "6bcb6d88-16de-11ef-bcd0-48df37b921da";
    const CONTACT_SENDER_REF = "f8caa074-1740-11ef-bcd0-48df37b921da";
    const SENDERS_PHONE = "380932532432";

    // === 2. Дані Shopify
    const cityName = order.shipping_address?.city || "Київ";
    const warehouseName = order.shipping_address?.address1 || "Відділення №1";
    const recipientName = order.shipping_address?.name || "Тестовий Отримувач";
    const recipientPhone = order.shipping_address?.phone?.replace(/\D/g, "") || "380501112233";

    console.log("🏙️ Місто:", cityName);
    console.log("🏤 Відділення:", warehouseName);

    // === 3. Отримуємо CityRef
    const cityResponse = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "Address",
      calledMethod: "getCities",
      methodProperties: { FindByString: cityName },
    });
    const cityRef = cityResponse.data.data?.[0]?.Ref;
    if (!cityRef) throw new Error(`Не знайдено місто: ${cityName}`);

    // === 4. Отримуємо WarehouseRef
    const whResponse = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "AddressGeneral",
      calledMethod: "getWarehouses",
      methodProperties: { CityRef: cityRef, FindByString: warehouseName },
    });
    const warehouseRef = whResponse.data.data?.[0]?.Ref;
    if (!warehouseRef) throw new Error(`Не знайдено відділення: ${warehouseName}`);

    // === 5. Створюємо або оновлюємо отримувача
    const [lastName, firstName, middleName = ""] = recipientName.split(" ");

    const recipientResponse = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "Counterparty",
      calledMethod: "save",
      methodProperties: {
        CounterpartyProperty: "Recipient",
        CounterpartyType: "PrivatePerson",
        FirstName: firstName || recipientName,
        MiddleName: middleName,
        LastName: lastName || recipientName,
        Phone: recipientPhone,
        Email: "",
        CityRef: cityRef,
      },
    });

    if (!recipientResponse.data.success)
      throw new Error(
        `Не вдалося створити отримувача: ${recipientResponse.data.errors.join(", ")}`
      );

    const RECIPIENT_REF = recipientResponse.data.data[0].Ref;

    // === 6. Контактна особа
    let contactResponse = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "ContactPerson",
      calledMethod: "getContactPersons",
      methodProperties: { CounterpartyRef: RECIPIENT_REF },
    });

    let CONTACT_RECIPIENT_REF = contactResponse.data.data?.[0]?.Ref;

    if (!CONTACT_RECIPIENT_REF) {
      console.log("ℹ️ Контактна особа не знайдена — створюємо нову...");

      const newContactResponse = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
        apiKey: process.env.NP_API_KEY,
        modelName: "ContactPerson",
        calledMethod: "save",
        methodProperties: {
          CounterpartyRef: RECIPIENT_REF,
          FirstName: firstName || recipientName,
          MiddleName: middleName,
          LastName: lastName || recipientName,
          Phone: recipientPhone,
        },
      });

      if (!newContactResponse.data.success)
        throw new Error(
          `Не вдалося створити контактну особу: ${newContactResponse.data.errors.join(", ")}`
        );

      CONTACT_RECIPIENT_REF = newContactResponse.data.data[0].Ref;
    }

    // === 7. Створюємо ТТН
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
        Description:
          order.line_items?.map((i) => i.name).join(", ") || `Shopify order ${order.name}`,
        Cost: order.total_price || "0",
        CitySender: SENDER_CITY_REF,
        SenderAddress: SENDER_ADDRESS_REF,
        ContactSender: CONTACT_SENDER_REF,
        SendersPhone: SENDERS_PHONE,
        Sender: SENDER_REF,
        CityRecipient: cityRef,
        RecipientAddress: warehouseRef,
        RecipientName: recipientName,
        RecipientType: "PrivatePerson",
        RecipientsPhone: recipientPhone,
        Recipient: RECIPIENT_REF,
        ContactRecipient: CONTACT_RECIPIENT_REF,
      },
    };

    const { data } = await axios.post("https://api.novaposhta.ua/v2.0/json/", npRequest);
    if (!data.success)
      throw new Error(data.errors.join(", ") || "Unknown Nova Poshta error");

    const ttnData = data.data[0];
    console.log("✅ ТТН створено:", ttnData.IntDocNumber);

    const pdfPath = await generateLabel(ttnData, order);

    res.json({
      message: "✅ ТТН створено і етикетка згенерована",
      ttn: ttnData.IntDocNumber,
      ref: ttnData.Ref,
      label_path: pdfPath,
    });
  } catch (err) {
    console.error("🚨 Помилка:", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ========================== PDF генерація (100x100 мм) ==========================
async function generateLabel(npData, order) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font = await pdfDoc.embedFont(fs.readFileSync(`${FONTS_DIR}/DejaVuSans.ttf`));
  const boldFont = await pdfDoc.embedFont(fs.readFileSync(`${FONTS_DIR}/DejaVuSans-Bold.ttf`));

  const page = pdfDoc.addPage([283.46, 283.46]);
  const { width, height } = page.getSize();
  const black = rgb(0, 0, 0);

  // === Верхня чорна смуга
  page.drawRectangle({ x: 0, y: height - 28, width, height: 28, color: black });
  page.drawText(npData.CityRecipientDescription || "КИЇВ СХІД", {
    x: 15,
    y: height - 20,
    size: 11,
    color: rgb(1, 1, 1),
    font: boldFont,
  });

  // === Іконка коробки
  try {
    const iconBytes = await fetch(
      "https://upload.wikimedia.org/wikipedia/commons/8/8e/Parcel_icon.png"
    ).then((r) => r.arrayBuffer());
    const icon = await pdfDoc.embedPng(iconBytes);
    page.drawImage(icon, { x: width - 35, y: height - 22, width: 15, height: 15 });
  } catch {}

  // === Таблиця “ВІД / КОМУ”
  const tableTop = height - 28;
  const tableHeight = 62;
  const halfWidth = width / 2;

  page.drawRectangle({
    x: 0,
    y: tableTop - tableHeight,
    width,
    height: tableHeight,
    borderColor: black,
    borderWidth: 1,
  });
  page.drawLine({
    start: { x: halfWidth, y: tableTop },
    end: { x: halfWidth, y: tableTop - tableHeight },
    thickness: 1,
    color: black,
  });

  const timestamp = new Date().toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  // === ВІД
  let y = height - 42;
  page.drawText(`ВІД: ${timestamp}`, { x: 10, y, size: 8, font: boldFont });
  y -= 10;
  page.drawText("БУЗДИГАН ЛАРИСА ВАСИЛІВНА ФОП", { x: 10, y, size: 7.5, font: boldFont });
  y -= 9;
  page.drawText("Галун Сергій Сергійович", { x: 10, y, size: 7.5, font });
  y -= 9;
  page.drawText("Львів, Відділення №31", { x: 10, y, size: 7.5, font });
  y -= 9;
  page.drawText("067 461 40 67", { x: 10, y, size: 7.5, font });

  // === КОМУ
  let ry = height - 42;
  page.drawText("КОМУ:", { x: halfWidth + 10, y: ry, size: 8, font: boldFont });
  ry -= 10;
  page.drawText(npData.RecipientContactPerson || "Отримувач", { x: halfWidth + 10, y: ry, size: 7.5, font });
  ry -= 9;
  page.drawText(npData.CityRecipientDescription || "Київ", { x: halfWidth + 10, y: ry, size: 7.5, font });
  ry -= 9;
  page.drawText(npData.RecipientsPhone || "0939911203", { x: halfWidth + 10, y: ry, size: 7.5, font });
  ry -= 9;
  page.drawText("Відділення", { x: halfWidth + 10, y: ry, size: 7.5, font });

  // === Вартість + опис
  const desc = `Вартість дост.: ${npData.Cost || "0"} грн (одерж., г-ка), ${
    order.line_items?.map((i) => i.name).join(", ") || order.name
  }`;
  page.drawText(desc, { x: 10, y: height - 102, size: 7.5, font });

  // === Табличка характеристик
  page.drawLine({ start: { x: 0, y: height - 112 }, end: { x: width, y: height - 112 }, thickness: 1, color: black });
  page.drawText("0.47", { x: 30, y: height - 125, size: 9, font: boldFont });
  page.drawText("(Об'єм)", { x: 22, y: height - 135, size: 6.5, font });
  page.drawText("ДВ", { x: 120, y: height - 125, size: 9, font: boldFont });
  page.drawText("1", { x: 122, y: height - 135, size: 9, font: boldFont });
  page.drawText("1", { x: 210, y: height - 125, size: 9, font: boldFont });
  page.drawText("Місце", { x: 195, y: height - 135, size: 6.5, font });

  // === Роздільна лінія перед штрихкодом
  page.drawLine({ start: { x: 0, y: height - 145 }, end: { x: width, y: height - 145 }, thickness: 1, color: black });

  // === TTN і штрихкод
  const formattedTTN = npData.IntDocNumber.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  page.drawText(formattedTTN, { x: 60, y: height - 180, size: 14, font: boldFont });

  const barcodeBuffer = await new Promise((resolve, reject) =>
    bwipjs.toBuffer(
      { bcid: "code128", text: npData.IntDocNumber, scale: 3, height: 25, includetext: false },
      (err, png) => (err ? reject(err) : resolve(png))
    )
  );
  const barcodeImage = await pdfDoc.embedPng(barcodeBuffer);
  page.drawImage(barcodeImage, { x: 25, y: height - 230, width: 230, height: 45 });

  // === Зберігаємо PDF
  const pdfBytes = await pdfDoc.save();
  const pdfPath = `${LABELS_DIR}/label-${npData.IntDocNumber}.pdf`;
  fs.writeFileSync(pdfPath, pdfBytes);
  return pdfPath;
}
