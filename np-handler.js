import axios from "axios";
import fs from "fs";
import path from "path";

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
    const isCOD = /cash|cod|налож/i.test(paymentMethod);
    const afterPaymentAmount = isCOD ? order.total_price : "0";

    console.log("🏙️ Місто:", cityName);
    console.log("🏤 Відділення:", warehouseName);
    console.log("💰 Оплата:", paymentMethod);

    // === 1. Отримуємо CityRef
    const cityRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "Address",
      calledMethod: "getCities",
      methodProperties: { FindByString: cityName },
    });
    const cityRef = cityRes.data.data?.[0]?.Ref;
    if (!cityRef) throw new Error(`Не знайдено місто: ${cityName}`);

    // === 2. Отримуємо WarehouseRef
    const whRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "AddressGeneral",
      calledMethod: "getWarehouses",
      methodProperties: { CityRef: cityRef, FindByString: warehouseName },
    });
    const warehouseRef = whRes.data.data?.[0]?.Ref;
    if (!warehouseRef) throw new Error(`Не знайдено відділення: ${warehouseName}`);

    // === 3. Створюємо отримувача
    let cleanName = recipientName.replace(/[^А-Яа-яІіЇїЄєҐґ'\s]/g, "").trim();
    if (!cleanName) cleanName = "Тестовий Отримувач";
    let [first, last] = cleanName.split(" ");
    if (!last) {
      last = first || "Отримувач";
      first = "Тест";
    }

    const recipientRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "Counterparty",
      calledMethod: "save",
      methodProperties: {
        CounterpartyProperty: "Recipient",
        CounterpartyType: "PrivatePerson",
        FirstName: first,
        LastName: last,
        Phone: recipientPhone,
        CityRef: cityRef,
      },
    });
    if (!recipientRes.data.success)
      throw new Error(`Не вдалося створити отримувача: ${recipientRes.data.errors.join(", ")}`);
    const RECIPIENT_REF = recipientRes.data.data[0].Ref;

    // === 4. Контактна особа
    const contactRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "ContactPerson",
      calledMethod: "getContactPersons",
      methodProperties: { CounterpartyRef: RECIPIENT_REF },
    });
    const CONTACT_RECIPIENT_REF = contactRes.data.data?.[0]?.Ref;

    // === 5. Створюємо ТТН
    const ttnReq = {
      apiKey: process.env.NP_API_KEY,
      modelName: "InternetDocument",
      calledMethod: "save",
      methodProperties: {
        PayerType: "Sender",
        PaymentMethod: "Cash",
        CargoType: "Parcel",
        Weight: "0.3", // конверт
        VolumeGeneral: "0.001",
        ServiceType: "WarehouseWarehouse",
        SeatsAmount: "1",
        Cost: order.total_price || "0",
        Description: order.line_items?.map((i) => i.name).join(", ") || order.name,
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

    const { data: ttnRes } = await axios.post("https://api.novaposhta.ua/v2.0/json/", ttnReq);
    if (!ttnRes.success)
      throw new Error(`Не вдалося створити ТТН: ${ttnRes.errors?.join(", ")}`);

    const ttnData = ttnRes.data?.[0];
    console.log("✅ ТТН створено:", ttnData.IntDocNumber);

    // === 6. Отримуємо офіційну етикетку PDF
    const pdfRes = await axios.post(
      "https://api.novaposhta.ua/v2.0/json/",
      {
        apiKey: process.env.NP_API_KEY,
        modelName: "InternetDocument",
        calledMethod: "getDocumentPdf",
        methodProperties: {
          DocumentRefs: [ttnData.Ref],
          Type: "pdf",
        },
      },
      { responseType: "arraybuffer" }
    );

    const pdfPath = `${LABELS_DIR}/label-${ttnData.IntDocNumber}.pdf`;
    fs.writeFileSync(pdfPath, pdfRes.data);
    console.log("🖨️ Офіційна етикетка збережена:", pdfPath);

    // === 7. Повертаємо URL
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const labelUrl = `${baseUrl}/labels/label-${ttnData.IntDocNumber}.pdf`;

    return res.json({
      message: "✅ ТТН створено і офіційна етикетка отримана",
      ttn: ttnData.IntDocNumber,
      label_url: labelUrl,
    });

  } catch (err) {
    console.error("🚨 Помилка:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
