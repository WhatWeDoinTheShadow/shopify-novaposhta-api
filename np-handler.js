import axios from "axios";
import fs from "fs";
import path from "path";

// =======================
// ENV
// =======================
const SHOPIFY_STORE = process.env.SHOPIFY_STORE; // woman-jwlry.myshopify.com
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_API_KEY; // Admin API token
const BASE_URL = process.env.BASE_URL; // https://shopify-novaposhta-api.onrender.com

// =======================
// Local DB
// =======================
const MONO_DB = path.resolve("./mono_invoices.json");
if (!fs.existsSync(MONO_DB)) fs.writeFileSync(MONO_DB, "{}");
let monoInvoices = JSON.parse(fs.readFileSync(MONO_DB, "utf8"));

function saveMonoInvoice(invoiceId, order, paymentUrl) {
  monoInvoices[invoiceId] = {
    invoiceId,
    orderId: order?.id,
    orderName: order?.name,
    total_price: order?.total_price,
    paymentUrl,
    status: "created",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(MONO_DB, JSON.stringify(monoInvoices, null, 2));
}

// =======================
// Labels + printed orders
// =======================
const LABELS_DIR = path.resolve("./labels");
if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR);

const PRINTED_DB = path.resolve("./printed_orders.json");
if (!fs.existsSync(PRINTED_DB)) fs.writeFileSync(PRINTED_DB, "{}");
let printedOrders = JSON.parse(fs.readFileSync(PRINTED_DB, "utf8"));

// =======================
// CONSTANT PARCEL SIZE (from NP cabinet)
// 1 place: 0.3 kg, 22 x 15 x 5 cm
// =======================
const PARCEL = {
  weightKg: 0.3,
  lengthCm: 22,
  widthCm: 15,
  heightCm: 5,
};

// m³: (cm³)/1e6
function calcVolumeM3({ lengthCm, widthCm, heightCm }) {
  const v = (Number(lengthCm) * Number(widthCm) * Number(heightCm)) / 1_000_000;
  return Number(v.toFixed(6));
}

// =======================
// helpers: phone + description + name split
// =======================
const isLatin = (str) => /[A-Za-z]/.test(String(str || ""));

// мінімальний трансліт
function translitToUaLite(raw) {
  if (!raw) return "";
  let s = String(raw).toLowerCase();

  s = s.replace(/shch/g, "щ");
  s = s.replace(/sch/g, "щ");
  s = s.replace(/ch/g, "ч");
  s = s.replace(/sh/g, "ш");
  s = s.replace(/ya/g, "я");
  s = s.replace(/yu/g, "ю");
  s = s.replace(/yo/g, "йо");
  s = s.replace(/ye/g, "є");
  s = s.replace(/yi/g, "ї");

  s = s.replace(/a/g, "а");
  s = s.replace(/b/g, "б");
  s = s.replace(/v/g, "в");
  s = s.replace(/h/g, "г");
  s = s.replace(/g/g, "ґ");
  s = s.replace(/d/g, "д");
  s = s.replace(/e/g, "е");
  s = s.replace(/z/g, "з");
  s = s.replace(/y/g, "и");
  s = s.replace(/i/g, "і");
  s = s.replace(/j/g, "й");
  s = s.replace(/k/g, "к");
  s = s.replace(/l/g, "л");
  s = s.replace(/m/g, "м");
  s = s.replace(/n/g, "н");
  s = s.replace(/o/g, "о");
  s = s.replace(/p/g, "п");
  s = s.replace(/r/g, "р");
  s = s.replace(/s/g, "с");
  s = s.replace(/t/g, "т");
  s = s.replace(/u/g, "у");
  s = s.replace(/f/g, "ф");
  s = s.replace(/c/g, "к");
  s = s.replace(/x/g, "кс");
  s = s.replace(/w/g, "в");
  s = s.replace(/q/g, "к");

  return s.charAt(0).toUpperCase() + s.slice(1);
}

function splitName(raw) {
  const clean = String(raw || "")
    .replace(/[^A-Za-zА-Яа-яІіЇїЄєҐґ'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return { first: "Клієнт", last: "Shopify" };

  const parts = clean.split(" ").filter(Boolean);
  let first = parts[0] || "Клієнт";
  let last = parts.slice(1).join(" ") || "Shopify";

  if (isLatin(first)) first = translitToUaLite(first);
  if (isLatin(last)) last = translitToUaLite(last);

  if (isLatin(first)) first = "Клієнт";
  if (isLatin(last)) last = "Shopify";

  return { first: String(first).slice(0, 30), last: String(last).slice(0, 30) };
}

function normalizePhone(rawPhone) {
  let p = String(rawPhone || "").replace(/\D/g, "");
  if (p.startsWith("0")) p = "38" + p;
  if (p.startsWith("80")) p = "3" + p;
  if (!p.startsWith("380")) p = "380" + p.replace(/^(\+)?(38)?/, "");
  if (p.length > 12) p = p.slice(0, 12);

  if (!/^380\d{9}$/.test(p)) {
    console.warn(`⚠️ Невірний номер телефону: ${p} (${rawPhone}), ставлю тестовий`);
    p = "380501112233";
  }
  return p;
}

function buildShortDescription(order) {
  const base = `Order ${order?.name || ""}`.trim();
  const itemsCount = Array.isArray(order?.line_items) ? order.line_items.length : 0;
  const qtySum = Array.isArray(order?.line_items)
    ? order.line_items.reduce((acc, i) => acc + Number(i?.quantity || 0), 0)
    : 0;

  let desc = base;
  if (itemsCount > 0) desc += ` | items:${itemsCount}`;
  if (qtySum > 0) desc += ` | qty:${qtySum}`;
  return desc.slice(0, 90);
}

// =======================
// detect COD + locker
// =======================
function isCODPayment(paymentMethod) {
  return /cash|cod|налож/i.test(String(paymentMethod || ""));
}

function isParcelLocker(address1) {
  const s = String(address1 || "").toLowerCase();
  return /поштомат|parcel\s*locker|locker/.test(s);
}

// =======================
// FIX #A: extract NP point number from address1 correctly
// "Тарнавського 7 4244" -> 4244 (NOT 7)
// =======================
function extractNpPointNumber(raw) {
  const s = String(raw || "");
  const nums = s.match(/\d{1,6}/g) || [];
  if (!nums.length) return null;

  // prefer last number with length >= 3 (most NP numbers are 3-6 digits)
  for (let i = nums.length - 1; i >= 0; i--) {
    if (nums[i].length >= 3) return nums[i];
  }
  return nums[nums.length - 1];
}

// =======================
// Shopify helpers
// =======================
async function shopifyPutOrder(orderId, payload) {
  if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN || !orderId) return null;

  const url = `https://${SHOPIFY_STORE}/admin/api/2024-10/orders/${orderId}.json`;
  return axios.put(
    url,
    { order: { id: orderId, ...payload } },
    {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );
}

async function shopifySetMetafields(orderId, metafields) {
  if (
    !SHOPIFY_STORE ||
    !SHOPIFY_ADMIN_TOKEN ||
    !orderId ||
    !Array.isArray(metafields) ||
    metafields.length === 0
  ) {
    return;
  }

  const ownerId = `gid://shopify/Order/${orderId}`;
  const mutation = `
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key value type }
        userErrors { field message }
      }
    }
  `;

  const inputs = metafields.map((m) => ({
    ownerId,
    namespace: String(m.namespace || "custom"),
    key: String(m.key),
    type: String(m.type || "single_line_text_field"),
    value: String(m.value ?? ""),
  }));

  const resp = await axios.post(
    `https://${SHOPIFY_STORE}/admin/api/2024-10/graphql.json`,
    { query: mutation, variables: { metafields: inputs } },
    {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  const errs = resp.data?.data?.metafieldsSet?.userErrors || [];
  if (errs.length) console.error("❌ Shopify metafieldsSet userErrors:", errs);
}

async function shopifyTagAndNote(orderId, tagToAdd, noteLine) {
  if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN || !orderId) return;

  const getUrl = `https://${SHOPIFY_STORE}/admin/api/2024-10/orders/${orderId}.json?fields=id,tags,note_attributes`;
  const getResp = await axios.get(getUrl, {
    headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN },
    timeout: 20000,
  });

  const ord = getResp.data?.order;
  const currentTags = String(ord?.tags || "");
  const tagsArr = currentTags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (tagToAdd && !tagsArr.includes(tagToAdd)) tagsArr.push(tagToAdd);

  const note_attributes = Array.isArray(ord?.note_attributes) ? ord.note_attributes : [];
  const key = "np_cod_block";
  const filtered = note_attributes.filter((x) => x?.name !== key);
  filtered.push({ name: key, value: noteLine });

  await shopifyPutOrder(orderId, {
    tags: tagsArr.join(", "),
    note_attributes: filtered,
  });
}

// =======================
// Nova Poshta client with retry (502)
// =======================
async function npPost(apiKey, modelName, calledMethod, methodProperties, tries = 4) {
  const url = "https://api.novaposhta.ua/v2.0/json/";
  let lastErr = null;

  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const resp = await axios.post(
        url,
        { apiKey, modelName, calledMethod, methodProperties },
        { timeout: 20000 }
      );

      const contentType = String(resp.headers?.["content-type"] || "");
      if (contentType.includes("text/html")) throw new Error("NP returned HTML (likely 502)");

      return resp.data;
    } catch (e) {
      lastErr = e;
      const wait = 450 * attempt * attempt;
      console.warn(`⚠️ NP retry ${attempt}/${tries}:`, e?.message || e);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// =======================
// FIX #1: better city match (avoid Львів -> Київ)
// =======================
function normCity(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[ʼ’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function findCityRef(rawCityName, apiKey) {
  const qRaw = String(rawCityName || "Київ").trim();
  const q = normCity(qRaw);

  console.log("🏙️ Пошук міста:", qRaw);
  const cityData = await npPost(apiKey, "Address", "getCities", { FindByString: qRaw });
  const list = Array.isArray(cityData?.data) ? cityData.data : [];
  if (!list.length) return null;

  const exact =
    list.find((c) => normCity(c?.Description) === q) ||
    list.find((c) => normCity(c?.DescriptionRu) === q);

  if (exact?.Ref) return exact.Ref;

  const starts =
    list.find((c) => normCity(c?.Description).startsWith(q)) ||
    list.find((c) => normCity(c?.DescriptionRu).startsWith(q));

  if (starts?.Ref) return starts.Ref;

  const contains =
    list.find((c) => normCity(c?.Description).includes(q)) ||
    list.find((c) => normCity(c?.DescriptionRu).includes(q));

  return (contains?.Ref || list[0]?.Ref || null);
}

// =======================
// FIX #A: warehouse search using extracted number + exact match by Number
// =======================
async function findWarehouseRef(warehouseName, cityRef, apiKey) {
  const wh = String(warehouseName || "").trim();

  // If it's already a Ref
  if (/^[0-9a-fA-F-]{20,}$/.test(wh)) {
    console.log("📦 Пробуємо як Ref відділення:", wh);
    const data = await npPost(apiKey, "AddressGeneral", "getWarehouses", { Ref: wh });
    const ref = data?.data?.[0]?.Ref;
    if (ref) return ref;
  }

  const num = extractNpPointNumber(wh) || "1";
  console.log(`🏤 NП номер точки: ${num}`);

  const data = await npPost(apiKey, "AddressGeneral", "getWarehouses", {
    CityRef: cityRef,
    FindByString: String(num),
    Limit: "20",
  });

  const list = Array.isArray(data?.data) ? data.data : [];
  if (!list.length) return null;

  const exact = list.find((w) => String(w?.Number || "") === String(num));
  return (exact?.Ref || list[0]?.Ref || null);
}

// =======================
// FIX #2: Seats block for NP validator
// - Use STRINGS only
// - Try PascalCase first, then camelCase fallback if OptionsSeat rejected
// =======================
function buildSeatsBlocksFixed() {
  const w = String(PARCEL.widthCm); // "15"
  const h = String(PARCEL.heightCm); // "5"
  const l = String(PARCEL.lengthCm); // "22"
  const weight = String(PARCEL.weightKg); // "0.3"
  const volume = String(calcVolumeM3(PARCEL)); // "0.00165"

  // Variant A (PascalCase)
  const seatsA = {
    SeatsAmount: "1",
    Weight: weight,
    VolumeGeneral: volume,
    OptionsSeat: [
      {
        VolumetricWidth: w,
        VolumetricHeight: h,
        VolumetricLength: l,
        Weight: weight,
      },
    ],
  };

  // Variant B (camelCase)
  const seatsB = {
    SeatsAmount: "1",
    Weight: weight,
    VolumeGeneral: volume,
    OptionsSeat: [
      {
        volumetricWidth: w,
        volumetricHeight: h,
        volumetricLength: l,
        weight: weight,
      },
    ],
  };

  return { seatsA, seatsB };
}

// =======================
// Monobank
// =======================
async function createMonoInvoice(order, baseUrl) {
  if (!process.env.MONO_MERCHANT_TOKEN) return null;

  const total = parseFloat(order?.total_price || "0");
  const amountInCents = Math.max(0, Math.round(total * 100));

  const basketOrder = (order?.line_items || []).map((item) => {
    const lineTotal = parseFloat(item?.price || "0") * Number(item?.quantity || 0);
    return {
      name: String(item?.name || "Товар").slice(0, 128),
      qty: Number(item?.quantity || 0),
      sum: Math.max(0, Math.round(lineTotal * 100)),
      code: String(item?.product_id || item?.sku || item?.variant_id || "").slice(0, 64),
    };
  });

  const monoBody = {
    amount: amountInCents,
    ccy: 980,
    merchantPaymInfo: {
      reference: String(order?.id || order?.name || ""),
      destination: `Оплата замовлення ${order?.name || ""}`.slice(0, 140),
      basketOrder,
    },
    redirectUrl: `${baseUrl}/mono/payment/redirect`,
    successUrl: `${baseUrl}/mono/payment/success`,
    failUrl: `${baseUrl}/mono/payment/fail`,
    webHookUrl: `${baseUrl}/api/mono/webhook`,
  };

  const monoRes = await axios.post(
    "https://api.monobank.ua/api/merchant/invoice/create",
    monoBody,
    {
      headers: {
        "Content-Type": "application/json",
        "X-Token": process.env.MONO_MERCHANT_TOKEN,
      },
      timeout: 20000,
    }
  );

  return {
    invoiceId: monoRes.data?.invoiceId || null,
    pageUrl: monoRes.data?.pageUrl || null,
  };
}

// =======================
// PrintNode
// =======================
async function printViaPrintNode(pdfPath, ttnNumber) {
  if (!process.env.PRINTNODE_API_KEY || !process.env.PRINTNODE_PRINTER_ID) return;

  const pdfBase64 = fs.readFileSync(pdfPath).toString("base64");
  await axios.post(
    "https://api.printnode.com/printjobs",
    {
      printerId: parseInt(process.env.PRINTNODE_PRINTER_ID, 10),
      title: `Nova Poshta ${ttnNumber}`,
      contentType: "pdf_base64",
      content: pdfBase64,
      source: "Shopify AutoPrint",
    },
    { auth: { username: process.env.PRINTNODE_API_KEY, password: "" }, timeout: 25000 }
  );

  console.log("✅ Етикетка відправлена на друк через PrintNode");
}

// =======================
// MAIN HANDLER
// =======================
export async function handleNovaPoshta(req, res) {
  const order = req.body;
  const orderKey = String(order?.id || order?.name || "unknown");

  console.log("📦 Нове замовлення з Shopify:", orderKey, order?.name);

  // антидубль 10 хв
  const now = Date.now();
  const last = printedOrders[orderKey];
  if (last && now - last < 10 * 60 * 1000) {
    console.log("⚠️ Дублікат webhook — пропускаємо:", orderKey);
    return res.json({ ok: true, duplicate: true, order_id: orderKey });
  }

  if (!process.env.NP_API_KEY) {
    return res.status(500).json({ ok: false, error: "❌ NP_API_KEY is missing on server" });
  }

  try {
    // sender refs
    const SENDER_CITY_REF = "db5c88f5-391c-11dd-90d9-001a92567626";
    const SENDER_ADDRESS_REF = "c8025d1c-b36a-11e4-a77a-005056887b8d";
    const SENDER_REF = "6bcb6d88-16de-11ef-bcd0-48df37b921da";
    const CONTACT_SENDER_REF = "f8caa074-1740-11ef-bcd0-48df37b921da";
    const SENDERS_PHONE = "380932532432";

    // Shopify data
    const rawCityName = order?.shipping_address?.city || "Київ";
    const address1 = order?.shipping_address?.address1 || "";
    const warehouseName = address1 || "Відділення №1";
    const recipientName = order?.shipping_address?.name || "Тестовий Отримувач";
    const rawPhone = order?.shipping_address?.phone || "";
    const paymentMethod = order?.payment_gateway_names?.[0] || "";

    const recipientPhone = normalizePhone(rawPhone);
    const cod = isCODPayment(paymentMethod);
    const locker = isParcelLocker(address1);

    console.log("🏙️ Місто:", rawCityName);
    console.log("🏤 Address1:", address1);
    console.log("📞 Телефон:", recipientPhone);
    console.log("💰 Оплата:", paymentMethod);
    console.log("📦 COD:", cod, "| LOCKER:", locker);

    // IMPORTANT: prefer BASE_URL for public links
    const baseUrl = BASE_URL || `https://${req.get("host")}`;

    // ========= RULE: LOCKER + COD => NO TTN =========
    if (locker && cod) {
      console.log("⛔ Поштомат + COD: ТТН НЕ створюємо. Створюємо payment link і позначаємо Shopify.");

      let paymentUrl = null;
      let monoInvoiceId = null;

      try {
        const mono = await createMonoInvoice(order, baseUrl);
        monoInvoiceId = mono?.invoiceId || null;
        paymentUrl = mono?.pageUrl || null;

        if (monoInvoiceId && paymentUrl) {
          saveMonoInvoice(monoInvoiceId, order, paymentUrl);
          console.log("✅ Monobank invoice:", monoInvoiceId);
          console.log("✅ Payment URL:", paymentUrl);
        } else {
          console.warn("⚠️ Monobank не повернув invoiceId/pageUrl");
        }
      } catch (e) {
        console.error("🚨 Monobank create invoice failed:", e?.response?.data || e?.message || e);
      }

      if (SHOPIFY_STORE && SHOPIFY_ADMIN_TOKEN && order?.id) {
        const reason =
          "COD недоступний для поштоматів Нової Пошти. Оберіть передоплату або доставку у відділення.";

        try {
          await shopifyTagAndNote(order.id, "cod_blocked_np_locker", reason);

          const mfs = [
            { namespace: "custom", key: "np_point_type", type: "single_line_text_field", value: "locker" },
            { namespace: "custom", key: "cod_blocked", type: "boolean", value: "true" },
            { namespace: "custom", key: "cod_block_reason", type: "single_line_text_field", value: reason.slice(0, 255) },
          ];

          if (paymentUrl) {
            mfs.push({ namespace: "custom", key: "payment_link", type: "url", value: paymentUrl });
            mfs.push({
              namespace: "custom",
              key: "mono_invoice_id",
              type: "single_line_text_field",
              value: String(monoInvoiceId || ""),
            });
          }

          await shopifySetMetafields(order.id, mfs);
          console.log("✅ Shopify marked: tag+note+metafields");
        } catch (e) {
          console.error("🚨 Shopify mark failed:", e?.response?.data || e?.message || e);
        }
      }

      printedOrders[orderKey] = Date.now();
      fs.writeFileSync(PRINTED_DB, JSON.stringify(printedOrders, null, 2));

      return res.json({
        ok: true,
        blocked: true,
        reason: "locker_cod_not_allowed",
        message:
          "⛔ Поштомат + COD: ТТН не створено. Створено payment link / order помічено в Shopify.",
        order_id: orderKey,
        payment_link: paymentUrl || "—",
        mono_invoice_id: monoInvoiceId || "—",
      });
    }

    // ========= NORMAL FLOW (TTN) =========

    // 1) CityRef + WarehouseRef
    const cityRef = await findCityRef(rawCityName, process.env.NP_API_KEY);
    if (!cityRef) throw new Error(`Не знайдено місто: ${rawCityName}`);
    console.log("✅ CityRef:", cityRef);

    const warehouseRef = await findWarehouseRef(warehouseName, cityRef, process.env.NP_API_KEY);
    if (!warehouseRef) throw new Error(`Не знайдено відділення/поштомат: ${warehouseName}`);
    console.log("✅ WarehouseRef:", warehouseRef);

    // 2) Recipient + Contact
    const { first, last } = splitName(recipientName);
    console.log(`👤 Отримувач (UA): ${first} ${last}`);

    const recipientRes = await npPost(process.env.NP_API_KEY, "Counterparty", "save", {
      CounterpartyProperty: "Recipient",
      CounterpartyType: "PrivatePerson",
      FirstName: first,
      LastName: last,
      Phone: recipientPhone,
      CityRef: cityRef,
    });

    if (!recipientRes?.success) {
      throw new Error(`Не вдалося створити отримувача: ${(recipientRes?.errors || []).join(", ")}`);
    }

    const RECIPIENT_REF = recipientRes?.data?.[0]?.Ref;
    if (!RECIPIENT_REF) throw new Error("Не вдалося отримати RECIPIENT_REF");

    const contactRes = await npPost(process.env.NP_API_KEY, "ContactPerson", "getContactPersons", {
      CounterpartyRef: RECIPIENT_REF,
    });

    let CONTACT_RECIPIENT_REF = contactRes?.data?.[0]?.Ref || null;

    if (!CONTACT_RECIPIENT_REF) {
      const newContactRes = await npPost(process.env.NP_API_KEY, "ContactPerson", "save", {
        CounterpartyRef: RECIPIENT_REF,
        FirstName: first,
        LastName: last,
        Phone: recipientPhone,
      });
      CONTACT_RECIPIENT_REF = newContactRes?.data?.[0]?.Ref || null;
    }

    if (!CONTACT_RECIPIENT_REF) throw new Error("Не вдалося отримати CONTACT_RECIPIENT_REF");

    // 3) payment link
    // правило: створюємо тільки якщо НЕ COD (як було), але:
    // якщо створили — записуємо в Shopify гарантовано
    let paymentUrl = null;
    let monoInvoiceId = null;

    if (!cod) {
      try {
        const mono = await createMonoInvoice(order, baseUrl);
        monoInvoiceId = mono?.invoiceId || null;
        paymentUrl = mono?.pageUrl || null;

        if (monoInvoiceId && paymentUrl) {
          saveMonoInvoice(monoInvoiceId, order, paymentUrl);
          console.log("✅ Monobank invoice:", monoInvoiceId);
          console.log("✅ Payment URL:", paymentUrl);
        }
      } catch (e) {
        console.error("🚨 Monobank create invoice failed:", e?.response?.data || e?.message || e);
      }
    }

    // IMPORTANT: write payment link when it exists (even if later you change invoice rules)
    if (paymentUrl && SHOPIFY_STORE && SHOPIFY_ADMIN_TOKEN && order?.id) {
      await shopifySetMetafields(order.id, [
        { namespace: "custom", key: "payment_link", type: "url", value: paymentUrl },
        { namespace: "custom", key: "mono_invoice_id", type: "single_line_text_field", value: String(monoInvoiceId || "") },
      ]);
      console.log("✅ Shopify saved payment link");
    }

    // 4) Create TTN (Seats FIX with fallback)
    const afterPaymentAmount = cod ? String(order?.total_price || "0") : "0";
    const { seatsA, seatsB } = buildSeatsBlocksFixed();

    const baseProps = {
      PayerType: "Recipient",
      PaymentMethod: "Cash",
      CargoType: "Parcel",
      ServiceType: "WarehouseWarehouse",

      Cost: String(order?.total_price || "0"),
      Description: buildShortDescription(order),

      CitySender: SENDER_CITY_REF,
      SenderAddress: SENDER_ADDRESS_REF,
      ContactSender: CONTACT_SENDER_REF,
      Sender: SENDER_REF,
      SendersPhone: SENDERS_PHONE,

      CityRecipient: cityRef,
      RecipientAddress: warehouseRef,
      Recipient: RECIPIENT_REF,
      ContactRecipient: CONTACT_RECIPIENT_REF,
      RecipientsPhone: recipientPhone,

      AfterpaymentOnGoodsCost: afterPaymentAmount,
    };

    console.log("🧾 NP seatsA:", JSON.stringify(seatsA, null, 2));

    let ttnRes = await npPost(process.env.NP_API_KEY, "InternetDocument", "save", {
      ...baseProps,
      ...seatsA,
    });

    if (!ttnRes?.success) {
      const errText = String((ttnRes?.errors || []).join(", "));
      if (/OptionsSeat is empty/i.test(errText)) {
        console.warn("⚠️ OptionsSeat rejected in A-format, retry with B-format...");
        console.log("🧾 NP seatsB:", JSON.stringify(seatsB, null, 2));

        ttnRes = await npPost(process.env.NP_API_KEY, "InternetDocument", "save", {
          ...baseProps,
          ...seatsB,
        });
      }
    }

    if (!ttnRes?.success) {
      throw new Error(`Не вдалося створити ТТН: ${(ttnRes?.errors || []).join(", ")}`);
    }

    const ttnNumber = ttnRes?.data?.[0]?.IntDocNumber;
    if (!ttnNumber) throw new Error("Не вдалося отримати номер ТТН");

    console.log("✅ ТТН створено:", ttnNumber);

    // 5) Label PDF download (retry)
    const labelUrl = `https://my.novaposhta.ua/orders/printMarking100x100/orders[]/${ttnNumber}/type/pdf/apiKey/${process.env.NP_API_KEY}/zebra`;

    let pdfResponse = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        pdfResponse = await axios.get(labelUrl, {
          responseType: "arraybuffer",
          timeout: 30000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          headers: { Accept: "application/pdf" },
        });
        break;
      } catch (e) {
        console.warn(`⚠️ Label retry ${attempt}/4:`, e?.message || e);
        await new Promise((r) => setTimeout(r, 450 * attempt * attempt));
      }
    }

    if (!pdfResponse?.data) throw new Error("Не вдалося завантажити PDF етикетки (NP)");

    const pdfPath = path.join(LABELS_DIR, `label-${ttnNumber}.pdf`);
    fs.writeFileSync(pdfPath, pdfResponse.data);
    console.log("💾 PDF збережено:", pdfPath);

    const publicUrlPath = `/labels/label-${ttnNumber}.pdf`;
    const fullLabelUrl = `${baseUrl}${publicUrlPath}`;

    // 6) Shopify save TTN + label url + parcel meta
    if (SHOPIFY_STORE && SHOPIFY_ADMIN_TOKEN && order?.id) {
      await shopifySetMetafields(order.id, [
        { namespace: "custom", key: "ttn_number", type: "single_line_text_field", value: String(ttnNumber) },
        { namespace: "custom", key: "ttn_label_url", type: "url", value: fullLabelUrl },
        { namespace: "custom", key: "np_point_type", type: "single_line_text_field", value: locker ? "locker" : "branch" },
        { namespace: "custom", key: "np_point_number", type: "single_line_text_field", value: String(extractNpPointNumber(address1) || "") },
        { namespace: "custom", key: "np_seat_weight", type: "number_decimal", value: String(PARCEL.weightKg) },
        { namespace: "custom", key: "np_seat_dims_cm", type: "single_line_text_field", value: `${PARCEL.lengthCm}x${PARCEL.widthCm}x${PARCEL.heightCm}` },
        { namespace: "custom", key: "np_seat_volume_m3", type: "number_decimal", value: String(calcVolumeM3(PARCEL)) },
      ]);
      console.log("✅ Shopify saved TTN/label:", fullLabelUrl);
    }

    // 7) PrintNode
    await printViaPrintNode(pdfPath, ttnNumber);

    // 8) mark processed
    printedOrders[orderKey] = Date.now();
    fs.writeFileSync(PRINTED_DB, JSON.stringify(printedOrders, null, 2));

    return res.json({
      ok: true,
      message: "✅ ТТН створено. Етикетка збережена/надрукована.",
      order_id: orderKey,
      ttn: ttnNumber,
      label_url: fullLabelUrl,
      payment_link: paymentUrl || "—",
      mono_invoice_id: monoInvoiceId || "—",
      parcel: {
        weightKg: PARCEL.weightKg,
        dimsCm: [PARCEL.lengthCm, PARCEL.widthCm, PARCEL.heightCm],
        volumeM3: calcVolumeM3(PARCEL),
      },
    });
  } catch (err) {
    console.error("🚨 Помилка:", err?.response?.data || err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "Internal error" });
  }
}
