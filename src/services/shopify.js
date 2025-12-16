import axios from "axios";
import { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN } from "../config.js";

export async function updateMetafields(orderId, metafields) {
    console.log("🛠️ updateMetafields call:", { orderId, metafieldsCount: metafields?.length });

    if (!SHOPIFY_STORE) console.warn("⚠️ MISSING SHOPIFY_STORE");
    if (!SHOPIFY_ADMIN_TOKEN) console.warn("⚠️ MISSING SHOPIFY_ADMIN_TOKEN");

    if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN || !orderId || !metafields || !metafields.length) {
        console.warn("⚠️ updateMetafields aborting due to missing args");
        return;
    }

    try {
        console.log("🧷 Оновлюємо метафілди Shopify:", metafields.map(m => m.key).join(", "));
        const url = `https://${SHOPIFY_STORE}/admin/api/2024-10/orders/${orderId}.json`;
        console.log("POST URL:", url);

        await axios.put(
            url,
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
    } catch (error) {
        console.error("Error updating metafields:", error);
    }
}

export async function getOrderMetafieldValue(orderId, namespace, key) {
    if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN) return null;

    const ownerId = `gid://shopify/Order/${orderId}`;
    const query = `
    query($id: ID!, $namespace: String!, $key: String!) {
      node(id: $id) {
        ... on Order {
          metafield(namespace: $namespace, key: $key) {
            value
          }
        }
      }
    }
  `;

    try {
        const resp = await axios.post(
            `https://${SHOPIFY_STORE}/admin/api/2024-10/graphql.json`,
            { query, variables: { id: ownerId, namespace, key } },
            {
                headers: {
                    "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
                    "Content-Type": "application/json",
                },
            }
        );

        return resp.data?.data?.node?.metafield?.value || null;
    } catch (e) {
        console.error("GraphQL check failed:", e.message);
        return null;
    }
}