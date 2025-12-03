import axios from "axios";
import fs from "fs";
import path from "path";
import { Parser } from "json2csv";

// ============================================================
// ENV
// ============================================================

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;                     // woman-jwlry.myshopify.com
const SHOPIFY_ADMIN_API_KEY = process.env.SHOPIFY_ADMIN_API_KEY;   // shpat_...

const MONO_MERCHANT_TOKEN = process.env.MONO_MERCHANT_TOKEN;
const BASE_URL = process.env.BASE_URL;

// ============================================================
// LOCAL DBs
// ============================================================

const MONO_DB = path.resolve("./mono_invoices.json");
if (!fs.existsSync(MONO_DB)) fs.writeFileSync(MONO_DB, "{}");
let monoInvoices = JSON.parse(fs.readFileSync(MONO_DB, "utf8"));

function saveMonoInvoice(invoiceId, order, paymentUrl) {
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

const LABELS_DIR = path.resolve("./labels");
if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR);

const PRINTED_DB = path.resolve("./printed_orders.json");
if (!fs.existsSync(PRINTED_DB)) fs.writeFileSync(PRINTED_DB, "{}");
let printedOrders = JSON.parse(fs.readFileSync(PRINTED_DB, "utf8"));

// ============================================================
// HELPER: save metafield payment_link → Shopify
// ============================================================

async function savePaymentLinkMetafield(order, paymentUrl) {
  if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_API_KEY) {
    console.warn("⚠️ SHOPIFY env відсутні, пропускаємо metafield");
    return;
  }

  if (!order?.id || !paymentUrl) return;

  const adminUrl = `https://${SHOPIFY_STORE}/admin/api/2024-10/graphql.json`;
  const ownerId = `gid://shopify/Order/${order.id}`;

  const query = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key value }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    metafields: [
      {
        ownerId,
        namespace: "custom",
        key: "payment_link",
        type: "url",
        value: paymentUrl,
      },
    ],
  };

  try {
    const resp = await axios.post(adminUrl, { query, variables }, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
        "Content-Type": "application/json",
      },
    });

    const errors = resp.data?.data?.metafieldsSet?.userErrors || [];
    if (errors.length > 0) {
      console.error("🚨 Shopify metafield error:", errors);
    } else {
      console.log("✅ Метаполе payment_link записане в Shopify");
    }
  } catch (e) {
    console.error("🚨 Помилка Shopify metafield:", e.response?.data || e.message);
  }
}

// ============================================================
// TRANSLIT / NAME MAP
// ============================================================

const nameMap = { /* ← залишаю твій великий словник без змін */ };

const isLatin = (s) => /[A-Za-z]/.test(s);

function translitToUa(raw) {
  if (!raw) return "";
  const word = raw.toLowerCase();
  if (nameMap[word]) return nameMap[word];

  let s = word;

  s = s.replace(/sch/g, "щ")
       .replace(/shch/g, "щ")
       .replace(/ch/g, "ч")
       .replace(/sh/g, "ш")
       .replace(/ya/g, "я")
       .replace(/yu/g, "ю")
       .replace(/yo/g, "йо")
       .replace(/ye/g, "є")
       .replace(/yi/g, "ї");

  const dict = {
    a: "а", b: "б", v: "в", h: "г", g: "ґ", d: "д", e: "е", z: "з",
    y: "и", i: "і", j: "й", k: "к", l: "л", m: "м", n: "н", o: "о",
    p: "п", r: "р", s: "с", t: "т", u: "у", f: "ф", c: "к", x: "кс",
    w: "в", q: "к"
  };

  s = s.replace(/[a-z]/g, (m) => dict[m] || "");

  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ============================================================
// MAIN HANDLER
// ============================================================

export async function handleNovaPoshta(req, res) {
  const order = req.body;
  console.log("📦 Нове замовлення:", order.name);

  if (!order) return res.status(400).json({ error: "No order body" });

  const now = Date.now();
  if (printedOrders[order.name] && now - printedOrders[order.name] < 10 * 60 * 1000) {
    return res.json({ message: "🟡 Вже надруковано" });
  }

  // ======================
  // Nova Poshta preparation
  // ======================

  const {
    shipping_address = {},
    payment_gateway_names = [],
    line_items = []
  } = order;

  const cityName = shipping_address.city || "Київ";
  const warehouseName = shipping_address.address1 || "Відділення №1";
  let rawPhone = shipping_address.phone || "";
  const paymentMethod = payment_gateway_names[0] || "";
  const recipientName = shipping_address.name || "Тест Клієнт";

  // ---------------------- Clean phone ----------------------

  let phone = rawPhone.replace(/\D/g, "");
  if (phone.startsWith("0")) phone = "38" + phone;
  if (!phone.startsWith("380")) phone = "380" + phone.replace(/^(\+?38)?/, "");
  if (phone.length > 12) phone = phone.slice(0, 12);
  if (!/^380\d{9}$/.test(phone)) phone = "380501112233";

  // ---------------------- Clean name ----------------------

  let cleanName = recipientName.replace(/[^A-Za-zА-Яа-яІіЇїЄєҐґ'\s]/g, "").trim();
  let [first, last] = cleanName.split(" ");
  if (!last) last = "Shopify";

  if (isLatin(first)) first = translitToUa(first);
  if (isLatin(last)) last = translitToUa(last);

  // ============================================================
  // 1) GENERATE MONOBANK PAYMENT LINK
  // ============================================================

  let paymentUrl = null;
  let monoInvoiceId = null;

  if (!MONO_MERCHANT_TOKEN) {
    console.warn("⚠️ MONO_MERCHANT_TOKEN missing, skipping invoice");
  } else {
    try {
      console.log("💳 Monobank: generating invoice…");

      const total = parseFloat(order.total_price || "0");
      const monoBody = {
        amount: Math.round(total * 100),
        ccy: 980,
        merchantPaymInfo: {
          reference: String(order.id),
          destination: `Оплата замовлення ${order.name}`,
          basketOrder: line_items.map((i) => ({
            name: i.name,
            qty: i.quantity,
            sum: Math.round(parseFloat(i.price) * 100),
            code: String(i.variant_id),
          })),
        },
        redirectUrl: `${BASE_URL}/mono/payment/redirect`,
        successUrl: `${BASE_URL}/mono/payment/success`,
        failUrl: `${BASE_URL}/mono/payment/fail`,
        webHookUrl: `${BASE_URL}/api/mono/webhook`,
      };

      const resp = await axios.post(
        "https://api.monobank.ua/api/merchant/invoice/create",
        monoBody,
        {
          headers: { "X-Token": MONO_MERCHANT_TOKEN },
        }
      );

      monoInvoiceId = resp.data.invoiceId;
      paymentUrl = resp.data.pageUrl;

      console.log("✔ Monobank invoice:", monoInvoiceId);
      console.log("✔ Monobank link:", paymentUrl);

      saveMonoInvoice(monoInvoiceId, order, paymentUrl);

      await savePaymentLinkMetafield(order, paymentUrl);

    } catch (e) {
      console.error("❌ Monobank error:", e.response?.data || e.message);
    }
  }

  // ============================================================
  // NOVA POSHTA REQUEST + LABEL PRINTING (залишаю як було)
  // ============================================================

  // ---- місто ----
  const cityRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
    apiKey: process.env.NP_API_KEY,
    modelName: "Address",
    calledMethod: "getCities",
    methodProperties: { FindByString: cityName },
  });

  const cityRef = cityRes.data.data?.[0]?.Ref;
  if (!cityRef) throw new Error("City not found");

  // ---- відділення ----
  const whNum = warehouseName.replace(/[^\d]/g, "") || "1";

  const whRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
    apiKey: process.env.NP_API_KEY,
    modelName: "AddressGeneral",
    calledMethod: "getWarehouses",
    methodProperties: { CityRef: cityRef, FindByString: whNum },
  });

  const warehouseRef = whRes.data.data?.[0]?.Ref;
  if (!warehouseRef) throw new Error("Warehouse not found");

  // ---- створення ТТН ----

  const npRequest = {
    apiKey: process.env.NP_API_KEY,
    modelName: "InternetDocument",
    calledMethod: "save",
    methodProperties: {
      PayerType: "Recipient",
      PaymentMethod: "Cash",
      CargoType: "Parcel",
      Weight: "0.3",
      ServiceType: "WarehouseWarehouse",
      SeatsAmount: "1",
      Description: line_items.map((i) => i.name).join(", "),
      CitySender: "db5c88f5-391c-11dd-90d9-001a92567626",
      SenderAddress: "c8025d1c-b36a-11e4-a77a-005056887b8d",
      Sender: "6bcb6d88-16de-11ef-bcd0-48df37b921da",
      ContactSender: "f8caa074-1740-11ef-bcd0-48df37b921da",
      SendersPhone: "380932532432",
      CityRecipient: cityRef,
      RecipientAddress: warehouseRef,
      Recipient: "test",
      ContactRecipient: "test",
      RecipientsPhone: phone,
    },
  };

  const ttnRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", npRequest);
  const ttnData = ttnRes.data.data?.[0];

  const ttn = ttnData?.IntDocNumber;
  console.log("📦 ТТН:", ttn);

  // ---- етикетка ----

  const labelUrl = `https://my.novaposhta.ua/orders/printMarking100x100/orders[]/${ttn}/type/pdf/apiKey/${process.env.NP_API_KEY}/zebra`;
  const pdf = await axios.get(labelUrl, { responseType: "arraybuffer" });

  const pdfPath = path.join(LABELS_DIR, `label-${ttn}.pdf`);
  fs.writeFileSync(pdfPath, pdf.data);

  const publicUrl = `${req.protocol}://${req.get("host")}/labels/label-${ttn}.pdf`;

  printedOrders[order.name] = Date.now();
  fs.writeFileSync(PRINTED_DB, JSON.stringify(printedOrders, null, 2));

  return res.json({
    message: "OK",
    ttn,
    payment_link: paymentUrl,
    mono_invoice_id: monoInvoiceId,
    label_url: publicUrl,
  });
}

// ============================================================
// INVENTORY CODE (fixed SHOPIFY_TOKEN usage)
// ============================================================

const INVENTORY_THRESHOLD = Number(process.env.INVENTORY_THRESHOLD || 2);
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WHATSAPP_TO = process.env.WHATSAPP_TO;
const PUBLIC_URL = process.env.PUBLIC_URL;

async function fetchAllProducts() {
  if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_API_KEY) {
    throw new Error("SHOPIFY env missing");
  }

  let products = [];
  let pageInfo = null;

  while (true) {
    const url = `https://${SHOPIFY_STORE}/admin/api/2024-10/products.json`;
    const params = { limit: 250 };
    if (pageInfo) params.page_info = pageInfo;

    const res = await axios.get(url, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_KEY,
      },
      params,
    });

    products.push(...(res.data.products || []));

    const linkHeader = res.headers["link"];
    if (!linkHeader || !linkHeader.includes('rel="next"')) break;

    const match = linkHeader.match(/page_info=([^&>]*)/);
    if (!match) break;

    pageInfo = match[1];
  }

  return products;
}

function getLowStockVariants(products) {
  const result = [];

  for (const p of products) {
    for (const v of p.variants) {
      if (v.inventory_quantity < INVENTORY_THRESHOLD) {
        result.push({
          product_handle: p.handle,
          product_title: p.title,
          variant_title: v.title,
          sku: v.sku,
          inventory_quantity: v.inventory_quantity,
          admin_link: `https://${SHOPIFY_STORE}/admin/products/${p.id}`,
        });
      }
    }
  }

  return result;
}

function buildCsv(rows) {
  const parser = new Parser({
    fields: [
      "product_handle",
      "product_title",
      "variant_title",
      "sku",
      "inventory_quantity",
      "admin_link",
    ],
  });
  return parser.parse(rows);
}

export async function inventoryCsvHandler(req, res) {
  try {
    const products = await fetchAllProducts();
    const low = getLowStockVariants(products);
    const csv = buildCsv(low);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=low_stock.csv");
    res.send(csv);
  } catch (e) {
    res.status(500).send("Помилка CSV");
  }
}

export async function inventoryNotifyHandler(req, res) {
  try {
    const products = await fetchAllProducts();
    const low = getLowStockVariants(products);

    const base = PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    const csvUrl = `${base}/inventory/low.csv`;

    res.json({
      ok: true,
      count: low.length,
      csvUrl,
    });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
}
