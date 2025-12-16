import axios from "axios";
import { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN } from "../config.js";

export async function updateMetafields(orderId, metafields) {
    if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN || !orderId || !metafields || !metafields.length) {
        return;
    }

    try {
        console.log("🧷 Оновлюємо метафілди Shopify:", metafields.map(m => m.key).join(", "));
        await axios.put(
            `https://${SHOPIFY_STORE}/admin/api/2024-10/orders/${orderId}.json`,
            {
                order: {
                    id: orderId,
                    metafields: metafields,
                },
            },
            {
                headers: {
                    "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
                    "Content-Type": "application/json",
                },
            }
        );
        console.log("🔗 Метафілди успішно оновлено");
    } catch (err) {
        console.error("⚠️ Не вдалось оновити метафілди в Shopify:", err.response?.data || err.message);
    }
}