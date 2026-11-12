import express from "express";
import axios from "axios";

// =======================
// Customer-facing Monobank payment routes
//
//   GET /pay/:orderId                 -> 302 to pay.monobank.ua (link from order metafield custom.payment_link)
//   GET /mono/payment/redirect|success|fail?order=ID -> back to the Shopify order status page
//
// :orderId is the numeric Shopify order id ({{ order.id }} in Liquid, or the id part of the order GID).
// =======================

// read env lazily: dotenv.config() in index.js runs after ESM imports are evaluated
const env = () => ({
  SHOPIFY_STORE: process.env.SHOPIFY_STORE,
  SHOPIFY_ADMIN_TOKEN: process.env.SHOPIFY_ADMIN_API_KEY,
  SHOP_PUBLIC_URL: process.env.SHOP_PUBLIC_URL || "https://tobimozhna.com",
});

const router = express.Router();

function cleanOrderId(raw) {
  const m = String(raw || "").match(/(\d{6,})$/); // supports "gid://shopify/Order/123" and "123"
  return m ? m[1] : null;
}

async function fetchOrderPaymentInfo(orderId) {
  const { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN } = env();
  if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN) throw new Error("Shopify env missing");

  const query = `query($id: ID!) {
    order(id: $id) {
      name
      displayFinancialStatus
      statusPageUrl
      paymentGatewayNames
      metafield(namespace: "custom", key: "payment_link") { value }
    }
  }`;

  const res = await axios.post(
    `https://${SHOPIFY_STORE}/admin/api/2024-10/graphql.json`,
    { query, variables: { id: `gid://shopify/Order/${orderId}` } },
    {
      headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN, "Content-Type": "application/json" },
      timeout: 15000,
    }
  );

  const order = res.data?.data?.order;
  if (!order) return null;

  return {
    name: order.name,
    status: order.displayFinancialStatus,
    statusPageUrl: order.statusPageUrl,
    paymentLink: order.metafield?.value || null,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitPage(attempt, orderName) {
  const next = attempt + 1;
  return `<!doctype html>
<html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="3;url=?try=${next}">
<title>Готуємо оплату…</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#fafafa;color:#222;text-align:center;padding:24px}</style>
</head><body><div>
<h2>Готуємо сторінку оплати${orderName ? ` для замовлення ${orderName}` : ""}…</h2>
<p>Це займе кілька секунд. Сторінка оновиться автоматично.</p>
</div></body></html>`;
}

function errorPage(text) {
  return `<!doctype html>
<html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Оплата</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#fafafa;color:#222;text-align:center;padding:24px}</style>
</head><body><div>
<h2>${text}</h2>
<p><a href="${env().SHOP_PUBLIC_URL}">Повернутися в магазин</a></p>
</div></body></html>`;
}

// ---------- /pay/:orderId ----------
router.get("/pay/:orderId", async (req, res) => {
  const orderId = cleanOrderId(req.params.orderId);
  const attempt = Number(req.query.try || 0);

  if (!orderId) return res.status(400).send(errorPage("Невірний номер замовлення"));

  try {
    // The order webhook may still be creating the invoice -> poll a few seconds before showing the wait page
    let info = null;
    for (let i = 0; i < 4; i++) {
      info = await fetchOrderPaymentInfo(orderId);
      if (!info || info.paymentLink || info.status === "PAID") break;
      await sleep(1500);
    }

    if (!info) return res.status(404).send(errorPage("Замовлення не знайдено"));

    if (info.status === "PAID") {
      console.log(`💳 /pay ${info.name}: вже оплачено → order status page`);
      return res.redirect(302, info.statusPageUrl || env().SHOP_PUBLIC_URL);
    }

    if (info.paymentLink) {
      console.log(`💳 /pay ${info.name} → ${info.paymentLink}`);
      return res.redirect(302, info.paymentLink);
    }

    if (attempt < 10) {
      console.log(`⏳ /pay ${info.name}: payment link ще не готовий (спроба ${attempt})`);
      return res.status(200).send(waitPage(attempt, info.name));
    }

    console.warn(`⚠️ /pay ${info.name}: payment link так і не з'явився`);
    return res
      .status(200)
      .send(errorPage(`Не вдалося сформувати посилання на оплату для ${info.name}. Ми зв'яжемося з вами найближчим часом.`));
  } catch (e) {
    console.error("🚨 /pay error:", e?.response?.data || e?.message || e);
    return res.status(500).send(errorPage("Сталася помилка. Спробуйте ще раз за хвилину."));
  }
});

// ---------- Monobank return URLs ----------
async function backToOrder(req, res) {
  const orderId = cleanOrderId(req.query.order);
  if (orderId) {
    try {
      const info = await fetchOrderPaymentInfo(orderId);
      if (info?.statusPageUrl) return res.redirect(302, info.statusPageUrl);
    } catch (e) {
      console.error("🚨 mono return lookup failed:", e?.response?.data || e?.message || e);
    }
  }
  return res.redirect(302, env().SHOP_PUBLIC_URL);
}

router.get("/mono/payment/redirect", backToOrder);
router.get("/mono/payment/success", backToOrder);
router.get("/mono/payment/fail", backToOrder);

export default router;
