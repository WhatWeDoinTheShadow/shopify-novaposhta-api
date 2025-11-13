import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const order = req.body;

  if (!process.env.NP_API_KEY) {
    return res.status(500).json({ error: "❌ NP_API_KEY is missing on server" });
  }

  // ⚙️ Дані відправника Нової Пошти (ФОП Буздиган)
  const SENDER_CITY_REF = "db5c88f5-391c-11dd-90d9-001a92567626";       // Львів
  const SENDER_ADDRESS_REF = "c8025d1c-b36a-11e4-a77a-005056887b8d";    // Відділення №31, вул. Тершаківців, 1
  const SENDER_REF = "6bcb6d88-16de-11ef-bcd0-48df37b921da";            // ФОП Буздиган
  const CONTACT_SENDER_REF = "f8caa074-1740-11ef-bcd0-48df37b921da";    // Контактна особа
  const SENDERS_PHONE = "380932532432";                                 // Телефон

  // ⚙️ Формуємо тіло запиту до API Нової Пошти
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
    console.log("📦 Надсилаємо запит до Нової Пошти:", npRequest);

    const { data } = await axios.post(
      "https://api.novaposhta.ua/v2.0/json/",
      npRequest
    );

    console.log("📨 Відповідь Нової Пошти:", data);

    if (data.success) {
      const responseData = {
        message: "✅ ТТН створено успішно",
        ttn: data.data[0]?.IntDocNumber,
        ref: data.data[0]?.Ref,
        cost: data.data[0]?.Cost,
        data: data.data[0]
      };

      return res.status(200).json(responseData);
    } else {
      return res.status(400).json({
        message: "⚠️ Помилка при створенні ТТН",
        errors: data.errors,
        warnings: data.warnings,
        raw: data
      });
    }
  } catch (error) {
    console.error("🚨 Помилка при зверненні до API Нової Пошти:", error.message);
    return res.status(500).json({ error: "Failed to contact Nova Poshta API" });
  }
}
