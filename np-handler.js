import axios from "axios";
import bwipjs from "bwip-js";
import { PDFDocument, rgb } from "pdf-lib";
import * as fontkit from "fontkit";
import fs from "fs";
import path from "path";

const FONTS_DIR = path.resolve("./fonts");
const LABELS_DIR = path.resolve("./labels");
if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR);

export async function handleNovaPoshta(req, res) {
  const order = req.body;
  console.log("📦 Нове замовлення з Shopify:", order.name);

  if (!process.env.NP_API_KEY)
    return res.status(500).json({ error: "❌ NP_API_KEY is missing on server" });

  try {
    // === Дані відправника
    const SENDER_CITY_REF = "db5c88f5-391c-11dd-90d9-001a92567626"; // Львів
    const SENDER_ADDRESS_REF = "c8025d1c-b36a-11e4-a77a-005056887b8d"; // Відділення №31
    const SENDER_REF = "6bcb6d88-16de-11ef-bcd0-48df37b921da";
    const CONTACT_SENDER_REF = "f8caa074-1740-11ef-bcd0-48df37b921da";
    const SENDERS_PHONE = "380932532432";

    // === Дані з Shopify
    const cityName = order.shipping_address?.city || "Київ";
    const warehouseName = order.shipping_address?.address1 || "Відділення №1";
    const recipientName = order.shipping_address?.name || "Тестовий Отримувач";
    const recipientPhone =
      order.shipping_address?.phone?.replace(/\D/g, "") || "380501112233";
    const paymentMethod = order.payment_gateway_names?.[0] || "";

    console.log("🏙️ Місто:", cityName);
    console.log("🏤 Відділення:", warehouseName);
    console.log("💰 Оплата:", paymentMethod);

    // === City & Warehouse
    const cityResponse = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "Address",
      calledMethod: "getCities",
      methodProperties: { FindByString: cityName },
    });
    const cityRef = cityResponse.data.data?.[0]?.Ref;
    if (!cityRef) throw new Error(`Не знайдено місто: ${cityName}`);

    const whResponse = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "AddressGeneral",
      calledMethod: "getWarehouses",
      methodProperties: { CityRef: cityRef, FindByString: warehouseName },
    });
    const warehouseRef = whResponse.data.data?.[0]?.Ref;
    if (!warehouseRef) throw new Error(`Не знайдено відділення: ${warehouseName}`);

    // === Отримувач
    let cleanName = recipientName.replace(/[^А-Яа-яІіЇїЄєҐґ'\s]/g, "").trim();
    if (!cleanName) cleanName = "Тестовий Отримувач";
    let [first, last] = cleanName.split(" ");
    if (!last) {
      last = first || "Отримувач";
      first = "Тест";
    }

    const recipientResponse = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "Counterparty",
      calledMethod: "save",
      methodProperties: {
        CounterpartyProperty: "Recipient",
        CounterpartyType: "PrivatePerson",
        FirstName: first,
        MiddleName: "",
        LastName: last,
        Phone: recipientPhone,
        CityRef: cityRef,
      },
    });

    if (!recipientResponse.data.success)
      throw new Error(`Не вдалося створити отримувача: ${recipientResponse.data.errors.join(", ")}`);

    const RECIPIENT_REF = recipientResponse.data.data[0].Ref;

    // === Контактна особа
    let contactResponse = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "ContactPerson",
      calledMethod: "getContactPersons",
      methodProperties: { CounterpartyRef: RECIPIENT_REF },
    });
    let CONTACT_RECIPIENT_REF = contactResponse.data.data?.[0]?.Ref;
    if (!CONTACT_RECIPIENT_REF) {
      const newContactResponse = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
        apiKey: process.env.NP_API_KEY,
        modelName: "ContactPerson",
        calledMethod: "save",
        methodProperties: {
          CounterpartyRef: RECIPIENT_REF,
          FirstName: first,
          MiddleName: "",
          LastName: last,
          Phone: recipientPhone,
        },
      });
      CONTACT_RECIPIENT_REF = newContactResponse.data.data[0].Ref;
    }

    const isCOD = /cash|cod|налож/i.test(paymentMethod);
    const afterPaymentAmount = isCOD ? order.total_price : "0";

    // === ТТН
    const npRequest = {
      apiKey: process.env.NP_API_KEY,
      modelName: "InternetDocument",
      calledMethod: "save",
      methodProperties: {
        PayerType: "Sender",
        PaymentMethod: "Cash",
        CargoType: "Parcel",
        Weight: "0.3",
        VolumeGeneral: "0.001",
        ServiceType: "WarehouseWarehouse",
        SeatsAmount: "1",
        Cost: order.total_price || "0",
        Description:
          order.line_items?.map((i) => i.name).join(", ") ||
          `Shopify order ${order.name}`,
        CitySender: SENDER_CITY_REF,
        SenderAddress: SENDER_ADDRESS_REF,
        ContactSender: CONTACT_SENDER_REF,
        Sender: SENDER_REF,
        SendersPhone: SENDERS_PHONE,
        CityRecipient: cityRef,
        RecipientAddress: warehouseRef,
        Recipient: RECIPIENT_REF,
        ContactRecipient: CONTACT_RECIPIENT_REF,
        RecipientsPhone: recipientPhone,
        AfterpaymentOnGoodsCost: afterPaymentAmount,
      },
    };

    const { data } = await axios.post("https://api.novaposhta.ua/v2.0/json/", npRequest);
    if (!data.success)
      throw new Error(`Не вдалося створити ТТН: ${data.errors?.join(", ")}`);

    const ttnData = data.data?.[0];
    console.log("✅ ТТН створено:", ttnData.IntDocNumber);

    // === Маршрут
    let cargoCode = "";
    try {
      const routeInfo = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
        apiKey: process.env.NP_API_KEY,
        modelName: "InternetDocument",
        calledMethod: "getDocumentList",
        methodProperties: { IntDocNumber: ttnData.IntDocNumber },
      });
      cargoCode = routeInfo.data.data?.[0]?.CargoTrackingRef || "";
    } catch (err) {
      console.warn("⚠️ Не вдалося отримати маршрут:", err.message);
    }

    // === PDF
    const pdfPath = await generateLabel(
      ttnData,
      order,
      cargoCode,
      isCOD,
      afterPaymentAmount,
      recipientPhone
    );

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const labelUrl = `${baseUrl}/labels/${path.basename(pdfPath)}`;
    console.log("🌐 Лінк на етикетку:", labelUrl);

    return res.json({
      message: "✅ ТТН створено і етикетка згенерована",
      ttn: ttnData.IntDocNumber,
      cargo_code: cargoCode,
      label_url: labelUrl,
    });
  } catch (err) {
    console.error("🚨 Помилка:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ==================== PDF ====================
async function generateLabel(npData, order, cargoCode, isCOD, afterPaymentAmount, recipientPhone) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fs.readFileSync(`${FONTS_DIR}/DejaVuSans.ttf`));
  const boldFont = await pdfDoc.embedFont(fs.readFileSync(`${FONTS_DIR}/DejaVuSans-Bold.ttf`));
  const page = pdfDoc.addPage([283.46, 283.46]); // 100x100 мм
  const { width, height } = page.getSize();
  const black = rgb(0, 0, 0);
  const margin = 10;
  let y = height - 50;

  // 🔲 Верхній чорний блок
  page.drawRectangle({ x: 0, y: height - 40, width, height: 40, color: black });
  page.drawText(npData.CityRecipientDescription || "КИЇВ СХІД", {
    x: 12,
    y: height - 25,
    size: 13,
    font: boldFont,
    color: rgb(1, 1, 1),
  });
  if (cargoCode) {
    page.drawText(cargoCode, {
      x: width - 90,
      y: height - 25,
      size: 10,
      font: boldFont,
      color: rgb(1, 1, 1),
    });
  }

  // 🧾 Відправник
  const senderBlock = [
    "ВІД: БУЗДИГАН ЛАРИСА ВАСИЛІВНА ФОП",
    "Львів, Відділення №31",
    "093 253 24 32",
  ];
  senderBlock.forEach((text, i) =>
    page.drawText(text, {
      x: margin,
      y: y - i * 9,
      size: 7,
      font,
    })
  );

  // 📦 Одержувач
  const receiverBlock = [
    `КОМУ: ${order.shipping_address?.name || "Отримувач"}`,
    `${order.shipping_address?.city || ""}, ${order.shipping_address?.address1 || ""}`,
    recipientPhone,
  ];
  receiverBlock.forEach((text, i) =>
    page.drawText(text, {
      x: width / 2,
      y: y - i * 9,
      size: 7,
      font,
    })
  );
  y -= 35;

  // 💰 Вартість / опис
  const cost = npData.Cost || "0";
  const description = order.line_items?.map((i) => i.name).join(", ") || order.name;
  const shortTTN = npData.IntDocNumber.slice(-3);
  const line = isCOD
    ? `Вартість дост.: ${cost} грн (одерж., г-ка), Конт. опл: ${afterPaymentAmount} грн, н/з: ${shortTTN}, ${description}`
    : `Вартість дост.: ${cost} грн (одерж., г-ка), н/з: ${shortTTN}, ${description}`;
  page.drawText(line.substring(0, 115), { x: margin, y: (y -= 10), size: 7, font });

  // 📏 Таблиця параметрів
  const volume = npData.VolumeGeneral || "0.001";
  y -= 18;
  page.drawLine({ start: { x: 0, y: y + 15 }, end: { x: width, y: y + 15 }, thickness: 1, color: black });
  page.drawText(`${volume}`, { x: margin + 10, y: y, size: 9, font: boldFont });
  page.drawText("(Об'єм)", { x: margin + 5, y: y - 10, size: 6, font });
  page.drawText("ДВ", { x: width / 2 - 20, y: y, size: 9, font: boldFont });
  page.drawText("1", { x: width / 2 - 15, y: y - 10, size: 8, font: boldFont });
  page.drawText("1", { x: width - 50, y: y, size: 9, font: boldFont });
  page.drawText("Місце", { x: width - 58, y: y - 10, size: 6, font });
  page.drawLine({ start: { x: 0, y: y - 20 }, end: { x: width, y: y - 20 }, thickness: 1, color: black });

  // 🧾 ТТН і штрихкод
  const formattedTTN = npData.IntDocNumber.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  const barcodeBuffer = await new Promise((resolve, reject) =>
    bwipjs.toBuffer(
      { bcid: "code128", text: npData.IntDocNumber, scale: 3, height: 25, includetext: false },
      (err, png) => (err ? reject(err) : resolve(png))
    )
  );
  const barcodeImage = await pdfDoc.embedPng(barcodeBuffer);
  page.drawImage(barcodeImage, { x: 25, y: 45, width: 230, height: 45 });
  page.drawText(formattedTTN, { x: width / 2 - 60, y: 30, size: 13, font: boldFont });

  // 💾 Збереження PDF
  const pdfBytes = await pdfDoc.save();
  const pdfPath = `${LABELS_DIR}/label-${npData.IntDocNumber}.pdf`;
  fs.writeFileSync(pdfPath, pdfBytes);
  return pdfPath;
}
