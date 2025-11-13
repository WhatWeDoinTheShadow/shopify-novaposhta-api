import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ✅ Головна сторінка для перевірки
app.get("/", (req, res) => {
  res.send("✅ Shopify → Nova Poshta API працює! 🚀");
});

// ✅ Основний маршрут для створення ТТН
app.post("/api/np-handler", async (req, res) => {
  console.log("📦 Отримано запит:", req.body);
  const order = req.body;

  // Перевіряємо наявність API ключа
  if (!process.env.NP_API_KEY) {
    return res.status(500).json({ error: "❌ NP_API_KEY is missing on server" });
  }

// ⚙️ Дані відправника Нової пошти (ФОП Буздиган Лариса Василівна)
const SENDER_CITY_REF = "db5c88f5-391c-11dd-90d9-001a92567626";       // Львів
const SENDER_ADDRESS_REF = "c8025d1c-b36a-11e4-a77a-005056887b8d";    // Відділення №31, вул. Тершаківців, 1
const SENDER_REF = "6bcb6d88-16de-11ef-bcd0-48df37b921da";            // ФОП Буздиган
const CONTACT_SENDER_REF = "f8caa074-1740-11ef-bcd0-48df37b921da";    // Контактна особа
const SENDERS_PHONE = "380932532432";                                 // Телефон

  // ⚙️ Формування запиту до API Нової пошти
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
    // 🔹 Надсилаємо запит до Нової пошти
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

// ✅ Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
