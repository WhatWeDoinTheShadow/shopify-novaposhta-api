import axios from "axios";
import fs from "fs";
import path from "path";
import { Parser } from "json2csv"; // для CSV по залишках

// =======================
// ENV для Shopify / Mono
// =======================

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;              // woman-jwlry.myshopify.com
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_API_KEY; // Admin API access token
const BASE_URL = process.env.BASE_URL;                        // https://shopify-novaposhta-api.onrender.com

// =======================
// Monobank local "DB"
// =======================

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

// =======================
// Labels + printed orders
// =======================

const LABELS_DIR = path.resolve("./labels");
if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR);

const PRINTED_DB = path.resolve("./printed_orders.json");
if (!fs.existsSync(PRINTED_DB)) fs.writeFileSync(PRINTED_DB, "{}");

let printedOrders = JSON.parse(fs.readFileSync(PRINTED_DB, "utf8"));

// =======================
// Мапінг імен
// =======================

const nameMap = {
  taras: "Тарас",
  ivan: "Іван",
  petro: "Петро",
  peter: "Пітер",
  oleksii: "Олексій",
  oleksiy: "Олексій",
  alexey: "Олексій",
  alexei: "Олексій",
  alex: "Олекс",
  oleksandr: "Олександр",
  alexander: "Олександр",
  andrii: "Андрій",
  andriy: "Андрій",
  andrew: "Ендрю",
  mykola: "Микола",
  nikolai: "Миколай",
  nicholas: "Ніколас",
  dmytro: "Дмитро",
  dmitro: "Дмитро",
  dmitry: "Дмитро",
  denys: "Денис",
  denis: "Денис",
  yurii: "Юрій",
  yuriy: "Юрій",
  yuri: "Юрій",
  oleg: "Олег",
  roman: "Роман",
  ruslan: "Руслан",
  vitalii: "Віталій",
  vitaliy: "Віталій",
  vladimir: "Володимир",
  volodymyr: "Володимир",
  vladyslav: "Владислав",
  vladislav: "Владислав",
  bogdan: "Богдан",
  bohdan: "Богдан",
  yevhen: "Євген",
  evgen: "Євген",
  maxim: "Максим",
  maksym: "Максим",
  artyom: "Артем",
  artem: "Артем",
  arthur: "Артур",
  artur: "Артур",
  anatolii: "Анатолій",
  anatoliy: "Анатолій",
  pavlo: "Павло",
  pavel: "Павло",
  stepan: "Степан",
  stanislav: "Станіслав",
  stas: "Стас",
  leonid: "Леонід",
  lev: "Лев",
  levko: "Левко",
  yegor: "Єгор",
  ihor: "Ігор",
  igor: "Ігор",
  yakiv: "Яків",
  yakov: "Яків",
  mark: "Марк",
  maks: "Макс",
  viktor: "Віктор",
  victor: "Віктор",
  anton: "Антон",
  vlad: "Влад",

  olga: "Ольга",
  olha: "Ольга",
  olena: "Олена",
  elena: "Олена",
  lena: "Лєна",
  anna: "Анна",
  anya: "Аня",
  ania: "Аня",
  hannah: "Ганна",
  marina: "Марина",
  maryna: "Марина",
  mary: "Мері",
  mariia: "Марія",
  maria: "Марія",
  marija: "Марія",
  viktoria: "Вікторія",
  victoria: "Вікторія",
  sofia: "Софія",
  sophia: "Софія",
  sofiia: "Софія",
  natalia: "Наталія",
  nataliia: "Наталія",
  natalya: "Наталя",
  yulia: "Юлія",
  julia: "Юлія",
  yuliia: "Юлія",
  julija: "Юлія",
  iryna: "Ірина",
  irina: "Ірина",
  oksana: "Оксана",
  tetiana: "Тетяна",
  tatiana: "Тетяна",
  tetyana: "Тетяна",
  larysa: "Лариса",
  larisa: "Лариса",
  halyna: "Галина",
  galina: "Галина",
  yolanta: "Йоланта",
  alina: "Аліна",
  alla: "Алла",
  lilia: "Лілія",
  liliia: "Лілія",
  lilya: "Ліля",
  nina: "Ніна",
  zina: "Зіна",
  jana: "Яна",
  yana: "Яна",
  yanna: "Яна",
  bohdana: "Богдана",
  sveta: "Свєта",
  svetlana: "Світлана",

  shevchenko: "Шевченко",
  bulba: "Бульба",
  petrov: "Петров",
  ivanov: "Іванов",
  melnyk: "Мельник",
  melnik: "Мельник",
  kovalenko: "Коваленко",
  bondar: "Бондар",
  tkachenko: "Ткаченко",
  voronov: "Воронов",
  romanov: "Романов",
};

const isLatin = (str) => /[A-Za-z]/.test(str);

function translitToUa(raw) {
  if (!raw) return "";
  const word = raw.toLowerCase();

  if (nameMap[word]) return nameMap[word];

  let s = word;
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

// =======================
// Nova Poshta + Mono handler
// =======================

export async function handleNovaPoshta(req, res) {
  const order = req.body;
  console.log("📦 Нове замовлення з Shopify:", order.name, "ID:", order.id);

  const now = Date.now();
  const lastPrinted = printedOrders[order.name];
  if (lastPrinted && now - lastPrinted < 10 * 60 * 1000) {
    console.log("⚠️ Замовлення вже було надруковане нещодавно:", order.name);
    return res.json({ message: "🟡 Вже надруковано", order: order.name });
  }

  if (!process.env.NP_API_KEY)
    return res.status(500).json({ error: "❌ NP_API_KEY is missing on server" });

  try {
    const SENDER_CITY_REF = "db5c88f5-391c-11dd-90d9-001a92567626";
    const SENDER_ADDRESS_REF = "c8025d1c-b36a-11e4-a77a-005056887b8d";
    const SENDER_REF = "6bcb6d88-16de-11ef-bcd0-48df37b921da";
    const CONTACT_SENDER_REF = "f8caa074-1740-11ef-bcd0-48df37b921da";
    const SENDERS_PHONE = "380932532432";

    const cityName = order.shipping_address?.city || "Київ";
    const warehouseName = order.shipping_address?.address1 || "Відділення №1";
    const recipientName = order.shipping_address?.name || "Тестовий Отримувач";
    let rawPhone = order.shipping_address?.phone || "";
    const paymentMethod = order.payment_gateway_names?.[0] || "";

    let recipientPhone = rawPhone.replace(/\D/g, "");
    if (recipientPhone.startsWith("0")) recipientPhone = "38" + recipientPhone;
    if (recipientPhone.startsWith("80")) recipientPhone = "3" + recipientPhone;
    if (!recipientPhone.startsWith("380"))
      recipientPhone = "380" + recipientPhone.replace(/^(\+)?(38)?/, "");
    if (recipientPhone.length > 12) recipientPhone = recipientPhone.slice(0, 12);
    if (!/^380\d{9}$/.test(recipientPhone)) {
      console.warn(
        `⚠️ Невірний номер телефону: ${recipientPhone} (${rawPhone}), замінюємо на тестовий`
      );
      recipientPhone = "380501112233";
    }

    console.log("🏙️ Місто:", cityName);
    console.log("🏤 Відділення (сире):", warehouseName);
    console.log("📞 Телефон:", recipientPhone);
    console.log("💰 Оплата:", paymentMethod);

    const cityRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "Address",
      calledMethod: "getCities",
      methodProperties: { FindByString: cityName },
    });
    const cityRef = cityRes.data.data?.[0]?.Ref;
    if (!cityRef) throw new Error(`Не знайдено місто: ${cityName}`);

    let warehouseRef = null;

    if (/^\d{5,}$/.test(warehouseName.trim())) {
      console.log("📦 Виявлено можливий Ref відділення:", warehouseName);
      const refRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
        apiKey: process.env.NP_API_KEY,
        modelName: "AddressGeneral",
        calledMethod: "getWarehouses",
        methodProperties: { Ref: warehouseName.trim() },
      });
      warehouseRef = refRes.data.data?.[0]?.Ref || null;
      if (warehouseRef) {
        console.log("✅ Відділення знайдене по Ref:", warehouseRef);
      }
    }

    if (!warehouseRef) {
      let cleanWarehouseName = warehouseName
        .replace(/нова\s?пошта/gi, "")
        .replace(/nova\s?poshta/gi, "")
        .replace(/відділення/gi, "")
        .replace(/№/g, "")
        .trim();

      const onlyNumber = cleanWarehouseName.match(/\d+/)?.[0] || "1";
      console.log(`🏤 Очищене відділення: ${onlyNumber}`);

      const whRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
        apiKey: process.env.NP_API_KEY,
        modelName: "AddressGeneral",
        calledMethod: "getWarehouses",
        methodProperties: { CityRef: cityRef, FindByString: onlyNumber },
      });
      warehouseRef = whRes.data.data?.[0]?.Ref || null;
    }

    if (!warehouseRef) throw new Error(`Не знайдено відділення: ${warehouseName}`);
    console.log("🏤 Використовуємо WarehouseRef:", warehouseRef);

    let cleanName = recipientName
      ?.replace(/[^A-Za-zА-Яа-яІіЇїЄєҐґ'\s]/g, "")
      ?.trim();
    if (!cleanName || cleanName.length < 2) cleanName = "Тест Отримувач";

    let [first, last] = cleanName.split(" ");
    if (!last) last = "Shopify";

    if (isLatin(first)) first = translitToUa(first);
    if (isLatin(last)) last = translitToUa(last);

    if (isLatin(first)) first = "Клієнт";
    if (isLatin(last)) last = "Shopify";

    console.log(`👤 Отримувач (UA): ${first} ${last}`);

    const recipientRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "Counterparty",
      calledMethod: "save",
      methodProperties: {
        CounterpartyProperty: "Recipient",
        CounterpartyType: "PrivatePerson",
        FirstName: first,
        LastName: last,
        Phone: recipientPhone,
        CityRef: cityRef,
      },
    });
    if (!recipientRes.data.success)
      throw new Error(
        `Не вдалося створити отримувача: ${recipientRes.data.errors.join(", ")}`
      );
    const RECIPIENT_REF = recipientRes.data.data[0].Ref;

    const contactRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "ContactPerson",
      calledMethod: "getContactPersons",
      methodProperties: { CounterpartyRef: RECIPIENT_REF },
    });
    let CONTACT_RECIPIENT_REF = contactRes.data.data?.[0]?.Ref;
    if (!CONTACT_RECIPIENT_REF) {
      const newContactRes = await axios.post(
        "https://api.novaposhta.ua/v2.0/json/",
        {
          apiKey: process.env.NP_API_KEY,
          modelName: "ContactPerson",
          calledMethod: "save",
          methodProperties: {
            CounterpartyRef: RECIPIENT_REF,
            FirstName: first,
            LastName: last,
            Phone: recipientPhone,
          },
        }
      );
      CONTACT_RECIPIENT_REF = newContactRes.data.data[0].Ref;
    }

    let paymentUrl = null;
    let monoInvoiceId = null;

    if (!process.env.MONO_MERCHANT_TOKEN) {
      console.warn(
        "⚠️ MONO_MERCHANT_TOKEN відсутній, пропускаємо створення інвойсу monobank"
      );
    } else {
      try {
        console.log("💳 Генеруємо payment link через Monobank...");

        const total = parseFloat(order.total_price || "0");
        const amountInCents = Math.round(total * 100);

        const basketOrder = (order.line_items || []).map((item) => {
          const lineTotal = parseFloat(item.price || "0") * item.quantity;
          return {
            name: item.name || "Товар",
            qty: item.quantity,
            sum: Math.round(lineTotal * 100),
            code: String(item.product_id || item.sku || item.variant_id || ""),
          };
        });

        const baseUrl =
          BASE_URL || `${req.protocol}://${req.get("host")}`;

        const monoBody = {
          amount: amountInCents,
          ccy: 980,
          merchantPaymInfo: {
            reference: String(order.id || order.name),
            destination: `Оплата замовлення ${order.name}`,
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
          }
        );

        monoInvoiceId = monoRes.data.invoiceId;
        paymentUrl = monoRes.data.pageUrl;

        console.log("✅ Monobank invoice:", monoInvoiceId);
        console.log("✅ Лінк для оплати (Monobank):", paymentUrl);

        saveMonoInvoice(monoInvoiceId, order, paymentUrl);
      } catch (err) {
        console.error(
          "🚨 Помилка при створенні payment link через Monobank:",
          err.response?.data || err.message
        );
      }
    }

    // === 5b. Записати payment link у метафілд Shopify (Order metafields → Payment link) ===
    if (paymentUrl && SHOPIFY_STORE && SHOPIFY_ADMIN_TOKEN && order.id) {
      try {
        console.log("🧷 Записуємо payment link у метафілд Shopify...");

        await axios.put(
          `https://${SHOPIFY_STORE}/admin/api/2024-10/orders/${order.id}.json`,
          {
            order: {
              id: order.id,
              metafields: [
                {
                  namespace: "custom",
                  key: "payment_link",
                  type: "url",          // у тебе metafield типу URL
                  value: paymentUrl,
                },
              ],
            },
          },
          {
            headers: {
              "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
              "Content-Type": "application/json",
            },
          }
        );

        console.log("🔗 Payment link успішно записаний у метафілд Shopify");
      } catch (err) {
        console.error(
          "⚠️ Не вдалось записати payment link в Shopify:",
          err.response?.data || err.message
        );
      }
    } else {
      console.warn(
        "⚠️ Пропускаємо запис метафілда Shopify: немає paymentUrl або SHOPIFY_STORE / SHOPIFY_ADMIN_API_KEY / order.id"
      );
    }

    const isCOD = /cash|cod|налож/i.test(paymentMethod);
    const afterPaymentAmount = isCOD ? order.total_price : "0";

    const npRequest = {
      apiKey: process.env.NP_API_KEY,
      modelName: "InternetDocument",
      calledMethod: "save",
      methodProperties: {
        PayerType: "Recipient",
        PaymentMethod: "Cash",
        CargoType: "Parcel",
        Weight: "0.3",
        VolumeGeneral: "0.001",
        ServiceType: "WarehouseWarehouse",
        SeatsAmount: "1",
        Seats: [
          {
            VolumetricWidth: "10",
            VolumetricHeight: "10",
            VolumetricLength: "10",
            Weight: "0.3",
          },
        ],
        Cost: order.total_price || "0",
        Description:
          order.line_items?.map((i) => i.name).join(", ") ||
          `Shopify order ${order.name}`,
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
      },
    };

    const { data: ttnRes } = await axios.post(
      "https://api.novaposhta.ua/v2.0/json/",
      npRequest
    );
    if (!ttnRes.success)
      throw new Error(`Не вдалося створити ТТН: ${ttnRes.errors?.join(", ")}`);

    const ttnData = ttnRes.data?.[0];
    console.log("✅ ТТН створено:", ttnData.IntDocNumber);

    const labelUrl = `https://my.novaposhta.ua/orders/printMarking100x100/orders[]/${ttnData.IntDocNumber}/type/pdf/apiKey/${process.env.NP_API_KEY}/zebra`;
    const pdfResponse = await axios.get(labelUrl, { responseType: "arraybuffer" });
    const pdfPath = path.join(
      LABELS_DIR,
      `label-${ttnData.IntDocNumber}.pdf`
    );
    fs.writeFileSync(pdfPath, pdfResponse.data);
    console.log("💾 PDF збережено:", pdfPath);

    if (process.env.PRINTNODE_API_KEY && process.env.PRINTNODE_PRINTER_ID) {
      const pdfBase64 = fs.readFileSync(pdfPath).toString("base64");
      await axios.post(
        "https://api.printnode.com/printjobs",
        {
          printerId: parseInt(process.env.PRINTNODE_PRINTER_ID),
          title: `Nova Poshta ${ttnData.IntDocNumber}`,
          contentType: "pdf_base64",
          content: pdfBase64,
          source: "Shopify AutoPrint",
        },
        { auth: { username: process.env.PRINTNODE_API_KEY, password: "" } }
      );
      console.log("✅ Етикетка відправлена на друк через PrintNode");
    }

    printedOrders[order.name] = Date.now();
    fs.writeFileSync(PRINTED_DB, JSON.stringify(printedOrders, null, 2));

    const publicUrl = `${req.protocol}://${req.get(
      "host"
    )}/labels/label-${ttnData.IntDocNumber}.pdf`;

    return res.json({
      message:
        "✅ ТТН створено, етикетка надрукована. Лінк на оплату — Monobank invoice",
      ttn: ttnData.IntDocNumber,
      label_url: publicUrl,
      payment_link: paymentUrl || "—",
      mono_invoice_id: monoInvoiceId || "—",
    });
  } catch (err) {
    console.error("🚨 Помилка:", err.message);
    res.status(500).json({ error: err.message });
  }
}

// =======================
// АВТОМАТИЗАЦІЯ ЗАЛИШКІВ СКЛАДУ
// =======================

const INVENTORY_THRESHOLD = Number(process.env.INVENTORY_THRESHOLD || 2);
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WHATSAPP_TO = process.env.WHATSAPP_TO;
const PUBLIC_URL = process.env.PUBLIC_URL;

async function fetchAllProducts() {
  if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN) {
    throw new Error("SHOPIFY_STORE або SHOPIFY_ADMIN_API_KEY не задані");
  }

  let products = [];
  let pageInfo = null;

  while (true) {
    const url = `https://${SHOPIFY_STORE}/admin/api/2024-10/products.json`;
    const params = { limit: 250 };
    if (pageInfo) params.page_info = pageInfo;

    const res = await axios.get(url, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      params,
    });

    products = products.concat(res.data.products || []);

    const linkHeader = res.headers["link"];
    if (!linkHeader || !linkHeader.includes('rel="next"')) break;

    const match = linkHeader.match(/<[^>]*page_info=([^&>]*)[^>]*>; rel="next"/);
    if (!match) break;
    pageInfo = match[1];
  }

  return products;
}

function getLowStockVariants(products) {
  const result = [];

  for (const p of products) {
    for (const v of p.variants || []) {
      const qty = v.inventory_quantity;
      if (typeof qty === "number" && qty < INVENTORY_THRESHOLD) {
        result.push({
          product_handle: p.handle,
          product_title: p.title,
          variant_title: v.title,
          sku: v.sku,
          inventory_quantity: qty,
          admin_link: `https://${SHOPIFY_STORE}/admin/products/${p.id}`,
        });
      }
    }
  }

  return result;
}

function buildCsv(rows) {
  const fields = [
    "product_handle",
    "product_title",
    "variant_title",
    "sku",
    "inventory_quantity",
    "admin_link",
  ];
  const parser = new Parser({ fields });
  return parser.parse(rows);
}

async function generateLowStockCsv() {
  const products = await fetchAllProducts();
  const lowStock = getLowStockVariants(products);
  const csv = buildCsv(lowStock);
  return { csv, count: lowStock.length };
}

async function sendWhatsappMessage(text) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID || !WHATSAPP_TO) {
    console.warn("⚠️ WHATSAPP_* env не задані, повідомлення не буде відправлене");
    return;
  }

  await axios.post(
    `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: WHATSAPP_TO,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

export async function inventoryCsvHandler(req, res) {
  try {
    const { csv } = await generateLowStockCsv();

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="low_stock_inventory.csv"'
    );
    res.send(csv);
  } catch (err) {
    console.error("Inventory CSV error:", err?.response?.data || err);
    res.status(500).send("Помилка формування CSV по залишках");
  }
}

export async function inventoryNotifyHandler(req, res) {
  try {
    const { count } = await generateLowStockCsv();

    const base =
      PUBLIC_URL?.replace(/\/$/, "") ||
      `${req.protocol}://${req.get("host")}`;
    const csvUrl = `${base}/inventory/low.csv`;

    if (count === 0) {
      await sendWhatsappMessage(
        `Щотижневий звіт по залишках: всі товари мають запас не менше ${INVENTORY_THRESHOLD} шт ✅`
      );
    } else {
      await sendWhatsappMessage(
        `Увага: знайдено ${count} позицій з залишком менше ${INVENTORY_THRESHOLD} шт.\nCSV зі списком: ${csvUrl}`
      );
    }

    res.json({ ok: true, count, csvUrl });
  } catch (err) {
    console.error("Inventory notify error:", err?.response?.data || err);
    res.status(500).json({ ok: false, error: "Помилка відправки повідомлення" });
  }
}
