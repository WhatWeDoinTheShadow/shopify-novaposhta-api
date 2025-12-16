import { config } from "../config.js";
import {
    isOrderProcessed,
    markOrderProcessed,
    unmarkOrderProcessed,
} from "../services/order-registry.js";
import { normalizePhone, buildShortDescription } from "../utils/formatters.js";
import { splitName } from "../utils/transliteration.js";
import * as NovaPoshta from "../services/novaposhta.js";
import * as Monobank from "../services/monobank.js";
import * as Shopify from "../services/shopify.js";
import { printLabel } from "../services/printnode.js";

export async function handleNovaPoshta(req, res) {
    const order = req.body;
    const orderKey = String(order?.id || order?.name || "unknown");

    console.log("📦 Нове замовлення з Shopify:", orderKey, order?.name);

    // 1) Anti-duplicate (registry)
    if (isOrderProcessed(orderKey)) {
        console.log("⚠️ Дублікат webhook — пропускаємо:", orderKey);
        return res.json({
            ok: true,
            duplicate: true,
            order_id: orderKey,
            message: "Дубль webhook — не друкуємо повторно",
        });
    }

    // Mark early to avoid race double-webhooks
    markOrderProcessed(orderKey);

    const rollbackProcessed = () => {
        try {
            if (typeof unmarkOrderProcessed === "function") unmarkOrderProcessed(orderKey);
        } catch (e) { }
    };

    const fail = (status, message, extra = undefined) => {
        rollbackProcessed();
        if (extra) console.log("❌ fail extra:", extra);
        return res.status(status).json({ ok: false, error: message });
    };

    try {
        if (!config?.novaPoshta?.apiKey) {
            return fail(500, "❌ NP_API_KEY is missing on server");
        }

        if (!order?.id) {
            return fail(400, "❌ order.id is missing (Shopify webhook payload)");
        }

        // 2) Extract & normalize input
        const rawCityName = order?.shipping_address?.city || "Київ";
        const warehouseName = order?.shipping_address?.address1 || "Відділення №1";
        const recipientName = order?.shipping_address?.name || "Тестовий Отримувач";
        const rawPhone = order?.shipping_address?.phone || "";
        const paymentMethod = order?.payment_gateway_names?.[0] || "";

        const recipientPhone = normalizePhone(rawPhone);
        const { first, last } = splitName(recipientName);

        console.log("🏙️ Місто (сире):", rawCityName);
        console.log("🏤 Відділення (сире):", warehouseName);
        console.log("📞 Телефон:", recipientPhone);
        console.log("👤 Отримувач:", first, last);
        console.log("💰 Оплата:", paymentMethod);

        // Base URL for redirects + public links
        const baseUrl = config.baseUrl || `${req.protocol}://${req.get("host")}`;

        // 3) City & Warehouse
        const cityRef = await NovaPoshta.findCityRef(rawCityName);
        if (!cityRef) throw new Error(`Не знайдено місто: ${rawCityName}`);
        console.log("✅ CityRef:", cityRef);

        const warehouseRef = await NovaPoshta.findWarehouseRef(warehouseName, cityRef);
        if (!warehouseRef) throw new Error(`Не знайдено відділення: ${warehouseName}`);
        console.log("🏤 WarehouseRef:", warehouseRef);

        // 4) Recipient & Contact (NP)
        const { recipientRef, contactRef } = await NovaPoshta.createRecipientAndContact(
            first,
            last,
            recipientPhone,
            cityRef
        );

        // 5) Monobank invoice (ONLY if not COD)
        let monoResult = null;
        let paymentUrl = null;

        const isCOD = /cash|cod|налож/i.test(paymentMethod);

        if (!isCOD) {
            monoResult = await Monobank.createInvoice(order, baseUrl);
            paymentUrl = monoResult?.pageUrl || null;

            if (monoResult?.invoiceId) console.log("✅ Monobank invoice:", monoResult.invoiceId);
            if (paymentUrl) console.log("✅ Лінк для оплати (Monobank):", paymentUrl);

            if (paymentUrl) {
                // IMPORTANT: updateMetafields must be GraphQL metafieldsSet (NOT REST order update)
                await Shopify.updateMetafields(order.id, [
                    { namespace: "custom", key: "payment_link", type: "url", value: paymentUrl },
                ]);

                // Optional verify (won't break if service doesn't have it)
                if (typeof Shopify.getOrderMetafieldValue === "function") {
                    const saved = await Shopify.getOrderMetafieldValue(order.id, "custom", "payment_link");
                    console.log("🔎 Shopify saved payment_link:", saved);
                }
            }
        } else {
            console.log("💡 COD — payment link не створюємо");
        }

        // 6) Create TTN (ensure Seats passed/created inside NovaPoshta.createTTN)
        const ttnData = await NovaPoshta.createTTN({
            moneyAmount: order?.total_price || "0",
            description: buildShortDescription(order),
            cityRef,
            warehouseRef,
            recipientRef,
            contactRef,
            phone: recipientPhone,
            isCOD,
        });

        const ttnNumber = ttnData?.IntDocNumber;
        if (!ttnNumber) throw new Error("Не вдалося отримати номер ТТН");
        console.log("✅ ТТН створено:", ttnNumber);

        // 7) Download label PDF
        const { pdfPath, publicUrl } = await NovaPoshta.downloadLabel(ttnNumber);
        console.log("💾 PDF збережено:", pdfPath);

        // 8) Save label URL + TTN number to Shopify metafields
        // publicUrl should be like /labels/label-XXXX.pdf (path) or full url depending on service
        const fullLabelUrl = publicUrl?.startsWith("http")
            ? publicUrl
            : `${baseUrl}${publicUrl || ""}`;

        await Shopify.updateMetafields(order.id, [
            { namespace: "custom", key: "ttn_label_url", type: "url", value: fullLabelUrl },
            { namespace: "custom", key: "ttn_number", type: "single_line_text_field", value: String(ttnNumber) },
        ]);

        console.log("🔗 TTN metafields saved in Shopify:", fullLabelUrl);

        // Optional verify (won't break if service doesn't have it)
        if (typeof Shopify.getOrderMetafieldValue === "function") {
            const savedLabel = await Shopify.getOrderMetafieldValue(order.id, "custom", "ttn_label_url");
            const savedTtn = await Shopify.getOrderMetafieldValue(order.id, "custom", "ttn_number");
            console.log("🔎 Shopify saved ttn_label_url:", savedLabel);
            console.log("🔎 Shopify saved ttn_number:", savedTtn);
        }

        // 9) Print
        await printLabel(pdfPath, ttnNumber);

        return res.json({
            ok: true,
            message: "✅ ТТН створено. Етикетка збережена/надрукована.",
            order_id: orderKey,
            ttn: ttnNumber,
            label_url: publicUrl,
            payment_link: paymentUrl || "—",
            mono_invoice_id: monoResult?.invoiceId || "—",
        });
    } catch (err) {
        const details = err?.response?.data || err;
        console.error("🚨 Помилка:", details?.message || err?.message || details);

        rollbackProcessed();

        return res.status(500).json({
            ok: false,
            error: err?.message || "Internal error",
        });
    }
}