import axios from "axios";
import { config } from "../config.js";

export async function updatePaymentMetafield(orderId, paymentUrl) {
    if (!paymentUrl || !config.shopify.store || !config.shopify.adminToken || !orderId) {
        return;
    }

    try {
        console.log("🧷 Записуємо payment link у метафілд Shopify...");
        await axios.put(
            `https://${config.shopify.store}/admin/api/2024-10/orders/${orderId}.json`,
            {
                order: {
                    id: orderId,
                    metafields: [
                        {
                            namespace: "custom",
                            key: "payment_link",
                            type: "url",
                            value: paymentUrl,
                        },
                    ],
                },
            },
            {
                headers: {
                    "X-Shopify-Access-Token": config.shopify.adminToken,
                    "Content-Type": "application/json",
                },
            }
        );
        console.log("🔗 Payment link успішно записаний у метафілд Shopify");
    } catch (err) {
        console.error("⚠️ Не вдалось записати payment link в Shopify:", err.response?.data || err.message);
    }
}
