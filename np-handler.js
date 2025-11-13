import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const order = req.body; // Shopify order webhook JSON
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
    console.log("NP API response:", data);
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error sending NP request:", error.message);
    return res.status(500).json({ error: "Failed to contact Nova Poshta API" });
  }
}
