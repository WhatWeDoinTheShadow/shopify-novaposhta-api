import axios from "axios";
import path from "path";
import fs from "fs";
import { config } from "../config.js";

const MONO_DB = path.resolve("./mono_invoices.json");
if (!fs.existsSync(MONO_DB)) fs.writeFileSync(MONO_DB, "{}");

export function saveMonoInvoice(invoiceId, order, paymentUrl) {
    let monoInvoices = {};
    try {
        monoInvoices = JSON.parse(fs.readFileSync(MONO_DB, "utf8"));
    } catch (e) {
        // ignore
    }

    monoInvoices[invoiceId] = {
        invoiceId,
        orderId: order.id,
        orderName: order.name,
        total_price: order.total_price,
        paymentUrl,
        status: "created",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(MONO_DB, JSON.stringify(monoInvoices, null, 2));
}

export async function createInvoice(order, baseUrl) {
    if (!config.monobank.token) {
        console.warn("⚠️ MONO_MERCHANT_TOKEN відсутній");
        return null;
    }

    try {
        const total = parseFloat(order?.total_price || "0");
        const amountInCents = Math.round(total * 100);

        const basketOrder = (order?.line_items || []).map((item) => {
            const lineTotal = parseFloat(item.price || "0") * Number(item.quantity || 0);
            return {
                name: String(item.name || "Товар").slice(0, 128),
                qty: Number(item.quantity || 0),
                sum: Math.round(lineTotal * 100),
                code: String(item.product_id || item.sku || item.variant_id || "").slice(0, 64),
            };
        });

        const monoBody = {
            amount: amountInCents,
            ccy: 980,
            merchantPaymInfo: {
                reference: String(order.id || order.name),
                destination: `Оплата замовлення ${order.name}`.slice(0, 140),
                basketOrder,
            },
            redirectUrl: `${baseUrl}/mono/payment/redirect`,
            successUrl: `${baseUrl}/mono/payment/success`,
            failUrl: `${baseUrl}/mono/payment/fail`,
            webHookUrl: `${baseUrl}/api/mono/webhook`,
        };

        console.log("📡 Sending to Monobank:", JSON.stringify(monoBody, null, 2));

        const monoRes = await axios.post(
            "https://api.monobank.ua/api/merchant/invoice/create",
            monoBody,
            {
                headers: {
                    "Content-Type": "application/json",
                    "X-Token": config.monobank.token,
                },
            }
        );

        const invoiceId = monoRes.data?.invoiceId;
        const pageUrl = monoRes.data?.pageUrl;

        if (invoiceId && pageUrl) {
            saveMonoInvoice(invoiceId, order, pageUrl);
            return { invoiceId, pageUrl };
        }
    } catch (err) {
        console.error("🚨 Помилка Monobank:", err.response?.data || err.message);
    }
    return null;
}
