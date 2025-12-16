import { config } from "../config.js";
import { isOrderProcessed, markOrderProcessed } from "../services/order-registry.js";
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

    // 1. Check duplicate
    if (isOrderProcessed(orderKey)) {
        console.log("⚠️ Дублікат webhook — пропускаємо:", orderKey);
        return res.json({
            ok: true,
            duplicate: true,
            order_id: orderKey,
            message: "Дубль webhook — не друкуємо повторно",
        });
    }

    // Mark as processed immediately to prevent race conditions from double webhooks
    markOrderProcessed(orderKey);

    if (!config.novaPoshta.apiKey) {
        return res.status(500).json({ error: "❌ NP_API_KEY is missing on server" });
    }

    try {
        // 2. Extract Data
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
        console.log("👤 Отримувач (UA):", first, last);

        // 3. Find City & Warehouse
        const cityRef = await NovaPoshta.findCityRef(rawCityName);
        if (!cityRef) throw new Error(`Не знайдено місто: ${rawCityName}`);
        console.log("✅ CityRef:", cityRef);

        const warehouseRef = await NovaPoshta.findWarehouseRef(warehouseName, cityRef);
        if (!warehouseRef) throw new Error(`Не знайдено відділення: ${warehouseName}`);
        console.log("🏤 Використовуємо WarehouseRef:", warehouseRef);

        // 4. Create/Find Recipient & Contact
        const { recipientRef, contactRef } = await NovaPoshta.createRecipientAndContact(
            first,
            last,
            recipientPhone,
            cityRef
        );

        // 5. Monobank Invoice (Payment Link)
        const baseUrl = config.baseUrl || `${req.protocol}://${req.get("host")}`;
        const monoResult = await Monobank.createInvoice(order, baseUrl);
        const paymentUrl = monoResult?.pageUrl;

        if (monoResult) {
            console.log("✅ Monobank invoice:", monoResult.invoiceId);
            console.log("✅ Лінк для оплати (Monobank):", paymentUrl);
        }

        // 6. Update Shopify Metafield
        await Shopify.updatePaymentMetafield(order.id, paymentUrl);

        // 7. Create TTN
        const isCOD = /cash|cod|налож/i.test(paymentMethod);
        const ttnData = await NovaPoshta.createTTN({
            moneyAmount: order.total_price || "0",
            description: buildShortDescription(order),
            cityRef,
            warehouseRef,
            recipientRef,
            contactRef,
            phone: recipientPhone,
            isCOD
        });

        console.log("✅ ТТН створено:", ttnData?.IntDocNumber);

        // 8. Download Label
        const { pdfPath, publicUrl } = await NovaPoshta.downloadLabel(ttnData.IntDocNumber);
        console.log("💾 PDF збережено:", pdfPath);

        // 9. Print Label
        await printLabel(pdfPath, ttnData.IntDocNumber);

        // 10. Mark Processed - moved to start

        return res.json({
            ok: true,
            message: "✅ ТТН створено. Етикетка збережена.",
            order_id: orderKey,
            ttn: ttnData.IntDocNumber,
            label_url: publicUrl,
            payment_link: paymentUrl || "—",
            mono_invoice_id: monoResult?.invoiceId || "—",
        });

    } catch (err) {
        console.error("🚨 Помилка:", err.message);
        return res.status(500).json({ error: err.message });
    }
}
