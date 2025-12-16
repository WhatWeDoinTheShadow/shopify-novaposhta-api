import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}/api/nova-poshta`;

const payload = {
    id: 999999999,
    name: "#TEST-101",
    total_price: "1250.00",
    shipping_address: {
        city: "Львів",
        address1: "Відділення №1",
        name: "Andrew Shevchenko", // Testing transliteration
        phone: "+380509998877"
    },
    line_items: [
        { name: "Test Item 1", quantity: 1, price: "1000.00" },
        { name: "Test Item 2", quantity: 2, price: "125.00" }
    ],
    payment_gateway_names: ["Cash on Delivery (COD)"]
};

console.log(`🚀 Sending Webhook to ${URL}...`);

try {
    const res = await axios.post(URL, payload);
    console.log("✅ Response:", res.status, res.data);
} catch (err) {
    console.error("❌ Error:", err.message);
    if (err.response) {
        console.error("Data:", err.response.data);
    }
}
