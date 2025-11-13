import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ✅ Головна сторінка для перевірки (GET /)
app.get("/", (req, res) => {
  res.send("✅ Shopify → Nova Poshta API працює! 🚀");
});

// ✅ Основний маршрут (Shopify або тест через Reqbin)
app.post("/api/np-handler", async (req, res) => {
  console.log("📦 Отримано запит:", req.body);

  const order = req.body;

  // Перевіряємо, чи задано API ключ
  if (!process.env.NP_API_KEY) {
    console.error("❌ Помилка: NP_API_KEY не знайдено у змінних середовища");
    return res.status(500).json({ error: "NP_API_KEY is missing on server" });
  }

  // Формуємо запит до Нової Пошти
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
      RecipientName: order.shipping_address?.name || "Тестовий Отримувач",
      RecipientCityName: order.shipping_address?.city || "Київ",
      RecipientsPhone: order.shipping_address?.phone || "380501112233"
    }
  };

  try {
    const { data } = await axios.post(
      "https://api.novaposhta.ua/v2.0/json/",
      npRequest
    );

    console.log("📨 Відповідь Нової Пошти:", data);

    if (data.success) {
      res.json({
        message: "✅ ТТН створено успішно",
        data: data.data[0] || {},
        warnings: data.warnings || []
      });
    } else {
      res.status(400).json({
        message: "⚠️ Помилка при створенні ТТН",
        errors: data.errors || [],
        warnings: data.warnings || []
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
