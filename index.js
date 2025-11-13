import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

app.post("/api/np-handler", async (req, res) => {
  const order = req.body;

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
      Description: `Shopify order ${order.name}`,
      Cost: order.total_price,
      RecipientName: order.shipping_address.name,
      RecipientCityName: order.shipping_address.city,
      RecipientsPhone: order.shipping_address.phone
    }
  };

  try {
    const { data } = await axios.post(
      "https://api.novaposhta.ua/v2.0/json/",
      npRequest
    );
    res.json(data);
  } catch (error) {
    console.error("Nova Poshta API error:", error.message);
    res.status(500).json({ error: "Failed to send request to Nova Poshta" });
  }
});

const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => {
  res.send("✅ Shopify → Nova Poshta API працює! 🚀");
});
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
