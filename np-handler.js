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
    // === 1. Дані відправника
    const SENDER_CITY_REF = "db5c88f5-391c-11dd-90d9-001a92567626"; // Львів
    const SENDER_ADDRESS_REF = "c8025d1c-b36a-11e4-a77a-005056887b8d"; // Відділення №31
    const SENDER_REF = "6bcb6d88-16de-11ef-bcd0-48df37b921da";
    const CONTACT_SENDER_REF = "f8caa074-1740-11ef-bcd0-48df37b921da";
    const SENDERS_PHONE = "380932532432";

    // === 2. Дані з Shopify
    const cityName = order.shipping_address?.city || "Київ";
    const warehouseName = order.shipping_address?.address1 || "Відділення №1";
    const recipientName = order.shipping_address?.name || "Тестовий Отримувач";
    const recipientPhone =
      order.shipping_address?.phone?.replace(/\D/g, "") || "380501112233";

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

    // === 4. Розумний пошук відділення або поштомату
    let warehouseRef = null;
    const isLocker = /поштомат|locker|parcel/i.test(warehouseName);
    const cleanWarehouseName = (warehouseName || "")
      .toLowerCase()
      .replace(/нова пошта|np|новапошта|відділення|поштомат|postomat|locker|№|#/gi, "")
      .trim();

    console.log("🔍 Пошук відділення або поштомату:", cleanWarehouseName || "(порожнє)");

    const whResponse = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "AddressGeneral",
      calledMethod: isLocker ? "getParcelLockers" : "getWarehouses",
      methodProperties: { CityRef: cityRef },
    });

    const allWh = whResponse.data.data || [];

    const foundWh =
      allWh.find((wh) => wh.Description.toLowerCase().includes(cleanWarehouseName)) ||
      allWh.find((wh) => wh.ShortAddress.toLowerCase().includes(cleanWarehouseName)) ||
      allWh.find((wh) => wh.Number === cleanWarehouseName);

    if (foundWh) {
      warehouseRef = foundWh.Ref;
      console.log("✅ Знайдено відділення:", foundWh.Description);
    } else {
      console.log("⚠️ Не вдалося знайти відділення по тексту:", cleanWarehouseName);
      warehouseRef = allWh[0]?.Ref;
      console.log("🪄 Використано стандартне відділення:", allWh[0]?.Description);
    }

    console.log("✅ Місто Ref:", cityRef);
    console.log("✅ Відділення Ref:", warehouseRef);

    // === 5. Створюємо отримувача
    const [lastName, firstName, middleName = ""] = recipientName.split(" ");

    const recipientResponse = await axios.post(
      "https://api.novaposhta.ua/v2.0/json/",
      {
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
      }
    );

    if (!recipientResponse.data.success) {
      throw new Error(
        `Не вдалося створити отримувача: ${recipientResponse.data.errors.join(", ")}`
      );
    }

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

      const newContactResponse = await axios.post(
        "https://api.novaposhta.ua/v2.0/json/",
        {
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
        }
      );

      if (!newContactResponse.data.success) {
        throw new Error(
          `Не вдалося створити контактну особу: ${newContactResponse.data.errors.join(", ")}`
        );
      }

      CONTACT_RECIPIENT_REF = newContactResponse.data.data[0].Ref;
    }

    console.log("✅ Отримувач створений:", RECIPIENT_REF);
    console.log("✅ Контактна особа:", CONTACT_RECIPIENT_REF);

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
        ServiceType: isLocker ? "WarehouseWarehouse" : "WarehouseWarehouse",
        SeatsAmount: "1",
        Description:
          order.line_items?.map((i) => i.name).join(", ") ||
          `Shopify order ${order.name}`,
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

    const { data } = await axios.post(
      "https://api.novaposhta.ua/v2.0/json/",
      npRequest
    );

    if (!data.success)
      throw new Error(data.errors.join(", ") || "Unknown Nova Poshta error");

    const ttnData = data.data[0];
    console.log("✅ ТТН створено:", ttnData.IntDocNumber);

    // === 8. Отримуємо офіційний PDF з Нової Пошти
    const pdfRequest = {
      apiKey: process.env.NP_API_KEY,
      modelName: "InternetDocument",
      calledMethod: "printMarkings",
      methodProperties: {
        DocumentRefs: [ttnData.Ref],
        Type: "pdf",
      },
    };

    const pdfResponse = await axios.post(
      "https://api.novaposhta.ua/v2.0/json/",
      pdfRequest,
      { responseType: "arraybuffer" }
    );

    const pdfBytes = Buffer.from(pdfResponse.data);
    const pdfPath = `${LABELS_DIR}/label-${ttnData.IntDocNumber}.pdf`;
    fs.writeFileSync(pdfPath, pdfBytes);

    console.log("🖨️ Завантажено офіційний PDF з НП:", pdfPath);

    res.json({
      message: "✅ ТТН створено і офіційна етикетка згенерована",
      ttn: ttnData.IntDocNumber,
      ref: ttnData.Ref,
      label_path: pdfPath,
    });
  } catch (err) {
    console.error("🚨 Помилка:", err.message);
    res.status(500).json({ error: err.message });
  }
}
