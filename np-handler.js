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

    // === 3. Отримувач
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

    // === 4. Контактна особа
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

    // === 5. Післяплата
    const isCOD = /cash|cod|налож/i.test(paymentMethod);
    const afterPaymentAmount = isCOD ? order.total_price : "0";

    // === 6. ТТН
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

    // === 7. Маршрут
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

    // === 8. PDF
    try {
      const pdfPath = await generateLabel(
        ttnData,
        order,
        cargoCode,
        isCOD,
        afterPaymentAmount,
        recipientPhone
      );

      console.log("🖨️ Етикетка збережена:", pdfPath);
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const labelUrl = `${baseUrl}/labels/${path.basename(pdfPath)}`;
      console.log("🌐 Лінк на етикетку:", labelUrl);

      return res.json({
        message: "✅ ТТН створено і етикетка згенерована",
        ttn: ttnData.IntDocNumber,
        cargo_code: cargoCode,
        label_url: labelUrl,
      });
    } catch (pdfErr) {
      console.error("🚨 Помилка при створенні PDF:", pdfErr.message);
      return res.json({
        message: "✅ ТТН створено, але не вдалося створити PDF",
        ttn: ttnData.IntDocNumber,
        cargo_code: cargoCode,
        error: pdfErr.message,
      });
    }
  } catch (err) {
    console.error("🚨 Помилка:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
