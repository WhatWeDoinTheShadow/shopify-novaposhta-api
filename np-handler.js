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

    // === 1. CityRef
    const cityResponse = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "Address",
      calledMethod: "getCities",
      methodProperties: { FindByString: cityName },
    });
    const cityRef = cityResponse.data.data?.[0]?.Ref;
    if (!cityRef) throw new Error(`Не знайдено місто: ${cityName}`);

    // === 2. WarehouseRef
    const whResponse = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "AddressGeneral",
      calledMethod: "getWarehouses",
      methodProperties: { CityRef: cityRef, FindByString: warehouseName },
    });
    const warehouseRef = whResponse.data.data?.[0]?.Ref;
    if (!warehouseRef) throw new Error(`Не знайдено відділення: ${warehouseName}`);

    // === 3. Отримувач (очищення імені)
    let cleanName = recipientName.replace(/[^А-Яа-яІіЇїЄєҐґ'\s]/g, "").trim();
    if (!cleanName) cleanName = "Тестовий Отримувач";

    let [first, last] = cleanName.split(" ");
    if (!last) {
      last = first || "Отримувач";
      first = "Тест";
    }

    const firstName = first;
    const lastName = last;
    const middleName = "";

    const recipientResponse = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "Counterparty",
      calledMethod: "save",
      methodProperties: {
        CounterpartyProperty: "Recipient",
        CounterpartyType: "PrivatePerson",
        FirstName: firstName,
        MiddleName: middleName,
        LastName: lastName,
        Phone: recipientPhone,
        CityRef: cityRef,
      },
    });

    if (!recipientResponse.data.success) {
      throw new Error(
        `Не вдалося створити отримувача: ${recipientResponse.data.errors.join(", ")}`
      );
    }

    const RECIPIENT_REF = recipientResponse.data.data[0].Ref;

    // === 4. Контактна особа (створюємо, якщо немає)
    let contactResponse = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "ContactPerson",
      calledMethod: "getContactPersons",
      methodProperties: { CounterpartyRef: RECIPIENT_REF },
    });

    let CONTACT_RECIPIENT_REF = contactResponse.data.data?.[0]?.Ref;

    if (!CONTACT_RECIPIENT_REF) {
      console.log("ℹ️ Контактна особа не знайдена — створюємо нову...");
      const newContactResponse = await axios.post(
        "https://api.novaposhta.ua/v2.0/json/",
        {
          apiKey: process.env.NP_API_KEY,
          modelName: "ContactPerson",
          calledMethod: "save",
          methodProperties: {
            CounterpartyRef: RECIPIENT_REF,
            FirstName: firstName,
            MiddleName: middleName,
            LastName: lastName,
            Phone: recipientPhone,
          },
        }
      );
      if (!newContactResponse.data.success) {
        throw new Error(
          `Не вдалося створити контактну особу: ${newContactResponse.data.errors.join(", ")}`
        );
      }
      CONTACT_RECIPIENT_REF = newContactResponse.data.data[0].Ref;
    }

    // === 5. Визначаємо чи післяплата
    const isCOD = /cash|cod|налож/i.test(paymentMethod);
    const afterPaymentAmount = isCOD ? order.total_price : "0";

    // === 6. Створюємо ТТН
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

    const { data } = await axios.post(
      "https://api.novaposhta.ua/v2.0/json/",
      npRequest
    );

    if (!data.success) {
      console.error("❌ Нова Пошта повернула помилку:", data.errors || data.warnings);
      throw new Error(`Не вдалося створити ТТН: ${data.errors?.join(", ") || "невідома помилка"}`);
    }

    const ttnData = data.data?.[0];
    console.log("✅ ТТН створено:", ttnData.IntDocNumber);

    // === 7. Код маршруту
    let cargoCode = "";
    try {
      const routeInfo = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
        apiKey: process.env.NP_API_KEY,
        modelName: "InternetDocument",
        calledMethod: "getDocumentList",
        methodProperties: { IntDocNumber: ttnData.IntDocNumber },
      });
      cargoCode = routeInfo.data.data?.[0]?.CargoTrackingRef || "";
    } catch {}

    // === 8. PDF
    const pdfPath = await generateLabel(
      ttnData,
      order,
      cargoCode,
      isCOD,
      afterPaymentAmount,
      recipientPhone
    );

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.json({
      message: "✅ ТТН створено і етикетка згенерована",
      ttn: ttnData.IntDocNumber,
      cargo_code: cargoCode || null,
      label_url: `${baseUrl}/labels/label-${ttnData.IntDocNumber}.pdf`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ==================== PDF ====================
async function generateLabel(npData, order, cargoCode, isCOD, afterPaymentAmount, recipientPhone) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fs.readFileSync(`${FONTS_DIR}/DejaVuSans.ttf`));
  const boldFont = await pdfDoc.embedFont(fs.readFileSync(`${FONTS_DIR}/DejaVuSans-Bold.ttf`));
  const page = pdfDoc.addPage([283.46, 283.46]);
  const { width, height } = page.getSize();
  const black = rgb(0, 0, 0);

  // 🔲 Верхній чорний блок
  page.drawRectangle({ x: 0, y: height - 35, width, height: 35, color: black });
  page.drawText(npData.CityRecipientDescription || "КИЇВ СХІД", {
    x: 15, y: height - 23, size: 12, color: rgb(1, 1, 1), font: boldFont,
  });
  if (cargoCode) {
    page.drawText(cargoCode, {
      x: width - 75, y: height - 23, size: 9, color: rgb(1, 1, 1), font: boldFont,
    });
  }

  // 📋 ВІД
  page.drawText("ВІД:", { x: 10, y: height - 50, size: 8, font: boldFont });
  page.drawText("БУЗДИГАН ЛАРИСА ВАСИЛІВНА ФОП", { x: 35, y: height - 50, size: 7, font });
  page.drawText("Львів, Відділення №31", { x: 35, y: height - 60, size: 7, font });
  page.drawText("093 253 24 32", { x: 35, y: height - 70, size: 7, font });

  // 📦 КОМУ
  page.drawText("КОМУ:", { x: 10, y: height - 85, size: 8, font: boldFont });
  page.drawText(order.shipping_address?.name || "Отримувач", { x: 35, y: height - 85, size: 7, font });
  page.drawText(`${order.shipping_address?.city || ""}, ${order.shipping_address?.address1 || ""}`, {
    x: 35, y: height - 95, size: 7, font,
  });
  page.drawText(recipientPhone, { x: 35, y: height - 105, size: 7, font });

  // 💰 Вартість / опис
  const cost = npData.Cost || "0";
  const description = order.line_items?.map(i => i.name).join(", ") || order.name;
  const shortTTN = npData.IntDocNumber.slice(-3);
  let line = `Вартість дост.: ${cost} грн (одерж., безг-ка), ${description}`;
  if (isCOD) {
    line = `Вартість дост.: ${cost} грн (одерж., безг-ка), Конт. опл: ${afterPaymentAmount} грн, н/з: ${shortTTN}, ${description}`;
  }
  page.drawText(line, { x: 10, y: height - 122, size: 7, font });

  // 📏 Таблиця параметрів
  const volume = npData.VolumeGeneral || "0.001";
  page.drawLine({ start: { x: 0, y: height - 132 }, end: { x: width, y: height - 132 }, thickness: 1, color: black });
  page.drawText(volume, { x: 35, y: height - 145, size: 9, font: boldFont });
  page.drawText("Обʼєм", { x: 25, y: height - 155, size: 6.5, font });
  page.drawText("ДВ", { x: 120, y: height - 145, size: 9, font: boldFont });
  page.drawText("1", { x: 125, y: height - 155, size: 9, font: boldFont });
  page.drawText("1", { x: 210, y: height - 145, size: 9, font: boldFont });
  page.drawText("Місце", { x: 195, y: height - 155, size: 6.5, font });
  page.drawLine({ start: { x: 0, y: height - 162 }, end: { x: width, y: height - 162 }, thickness: 1, color: black });

  // 🧾 ТТН і штрихкод
  const formattedTTN = npData.IntDocNumber.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  page.drawText(formattedTTN, { x: 60, y: height - 190, size: 14, font: boldFont });

  const barcodeBuffer = await new Promise((resolve, reject) =>
    bwipjs.toBuffer({ bcid: "code128", text: npData.IntDocNumber, scale: 3, height: 25, includetext: false },
      (err, png) => (err ? reject(err) : resolve(png)))
  );
  const barcodeImage = await pdfDoc.embedPng(barcodeBuffer);
  page.drawImage(barcodeImage, { x: 25, y: height - 240, width: 230, height: 45 });

  const pdfBytes = await pdfDoc.save();
  const pdfPath = `${LABELS_DIR}/label-${npData.IntDocNumber}.pdf`;
  fs.writeFileSync(pdfPath, pdfBytes);
  return pdfPath;
}
