import axios from "axios";
import fs from "fs";
import path from "path";
import { config } from "../config.js";

// =======================
// ENV для Shopify / Mono
// =======================

const SHOPIFY_STORE = config.shopify.store;
const SHOPIFY_ADMIN_TOKEN = config.shopify.token;
const BASE_URL = config.baseUrl;

// =======================
// Monobank local "DB"
// =======================

const MONO_DB = path.resolve("./mono_invoices.json");
if (!fs.existsSync(MONO_DB)) fs.writeFileSync(MONO_DB, "{}");
let monoInvoices = {};
try {
    monoInvoices = JSON.parse(fs.readFileSync(MONO_DB, "utf8"));
} catch (e) {
    monoInvoices = {};
}

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

let printedOrders = {};
try {
    printedOrders = JSON.parse(fs.readFileSync(PRINTED_DB, "utf8"));
} catch (e) {
    printedOrders = {};
}

// =======================
// Мапінг імен (UA)
// =======================

const nameMap = {
    // Чоловічі
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

    // Жіночі
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

    // Прізвища
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
// helpers
// =======================

function normalizePhone(rawPhone) {
    let recipientPhone = String(rawPhone || "").replace(/\D/g, "");
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

    return recipientPhone;
}

function buildShortDescription(order) {
    // NP часто ріже Description. Безпечний короткий варіант.
    const base = `Order ${order.name || ""}`.trim();
    const itemsCount = Array.isArray(order.line_items) ? order.line_items.length : 0;
    const qtySum = Array.isArray(order.line_items)
        ? order.line_items.reduce((acc, i) => acc + Number(i.quantity || 0), 0)
        : 0;

    let desc = base;
    if (itemsCount > 0) desc += ` | items:${itemsCount}`;
    if (qtySum > 0) desc += ` | qty:${qtySum}`;

    // запас по довжині
    return desc.slice(0, 90);
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

    // NP може не любити латиницю в PrivatePerson. Робимо м'який fallback:
    // 1) пробуємо трансліт по словнику/правилам
    // 2) якщо все ще латиниця — ставимо дефолт
    if (isLatin(first)) first = translitToUa(first);
    if (isLatin(last)) last = translitToUa(last);

    if (isLatin(first)) first = "Клієнт";
    if (isLatin(last)) last = "Shopify";

    // NP також може не любити довгі lastName
    return {
        first: String(first).slice(0, 30),
        last: String(last).slice(0, 30),
    };
}

async function findCityRef(rawCityName, apiKey) {
    const q1 = String(rawCityName || "Київ").replace(/[ʼ’`]/g, "'").trim();
    const q2 = String(rawCityName || "Київ")
        .replace(/[ʼ’'`]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const q3 = String(rawCityName || "Київ")
        .replace(/[^A-Za-zА-Яа-яІіЇїЄєҐґ\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const queries = [q1, q2, q3].filter(Boolean);

    for (const q of queries) {
        console.log("🏙️ Пошук міста:", q);
        const cityRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
            apiKey,
            modelName: "Address",
            calledMethod: "getCities",
            methodProperties: { FindByString: q },
        });
        const ref = cityRes.data?.data?.[0]?.Ref;
        if (ref) return ref;
    }

    return null;
}

async function findWarehouseRef(warehouseName, cityRef, apiKey) {
    let warehouseRef = null;

    // Якщо це просто цифри — інколи там номер, а не Ref.
    // Твій старий код пробував як Ref — залишимо, але якщо не знайде, йдемо в пошук по номеру.
    if (/^\d{5,}$/.test(String(warehouseName || "").trim())) {
        console.log("📦 Виявлено можливий Ref відділення:", warehouseName);
        const refRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
            apiKey,
            modelName: "AddressGeneral",
            calledMethod: "getWarehouses",
            methodProperties: { Ref: String(warehouseName).trim() },
        });
        warehouseRef = refRes.data?.data?.[0]?.Ref || null;
        if (warehouseRef) return warehouseRef;
    }

    // Пошук по номеру відділення
    const cleanWarehouseName = String(warehouseName || "")
        .replace(/нова\s?пошта/gi, "")
        .replace(/nova\s?poshta/gi, "")
        .replace(/відділення/gi, "")
        .replace(/№/g, "")
        .replace(/#/g, " ")
        .trim();

    const onlyNumber = cleanWarehouseName.match(/\d+/)?.[0] || "1";
    console.log(`🏤 Очищене відділення: ${onlyNumber}`);

    const whRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
        apiKey,
        modelName: "AddressGeneral",
        calledMethod: "getWarehouses",
        methodProperties: { CityRef: cityRef, FindByString: onlyNumber },
    });

    return whRes.data?.data?.[0]?.Ref || null;
}

// =======================
// Nova Poshta + Monobank handler
// =======================

export async function handleNovaPoshta(req, res) {
    const order = req.body;
    const orderKey = String(order?.id || order?.name || "unknown");

    console.log("📦 Нове замовлення з Shopify:", orderKey, order?.name);

    // антидубль по order.id (10 хв)
    const now = Date.now();
    const lastPrinted = printedOrders[orderKey];
    if (lastPrinted && now - lastPrinted < 10 * 60 * 1000) {
        console.log("⚠️ Дублікат webhook — пропускаємо:", orderKey);
        return res.json({
            ok: true,
            duplicate: true,
            order_id: orderKey,
            message: "Дубль webhook — не друкуємо повторно",
        });
    }

    if (!config.novaPoshta.apiKey) {
        return res.status(500).json({ error: "❌ NP_API_KEY is missing on server" });
    }

    try {
        // === Дані відправника ===
        const SENDER_CITY_REF = "db5c88f5-391c-11dd-90d9-001a92567626";
        const SENDER_ADDRESS_REF = "c8025d1c-b36a-11e4-a77a-005056887b8d";
        const SENDER_REF = "6bcb6d88-16de-11ef-bcd0-48df37b921da";
        const CONTACT_SENDER_REF = "f8caa074-1740-11ef-bcd0-48df37b921da";
        const SENDERS_PHONE = "380932532432";

        // === Дані з Shopify ===
        const rawCityName = order?.shipping_address?.city || "Київ";
        const warehouseName = order?.shipping_address?.address1 || "Відділення №1";
        const recipientName = order?.shipping_address?.name || "Тестовий Отримувач";
        const rawPhone = order?.shipping_address?.phone || "";
        const paymentMethod = order?.payment_gateway_names?.[0] || "";

        const recipientPhone = normalizePhone(rawPhone);

        console.log("🏙️ Місто (сире):", rawCityName);
        console.log("🏤 Відділення (сире):", warehouseName);
        console.log("📞 Телефон:", recipientPhone);
        console.log("💰 Оплата:", paymentMethod);

        // === 1. CityRef ===
        const cityRef = await findCityRef(rawCityName, config.novaPoshta.apiKey);
        if (!cityRef) throw new Error(`Не знайдено місто: ${rawCityName}`);
        console.log("✅ CityRef:", cityRef);

        // === 2. WarehouseRef ===
        const warehouseRef = await findWarehouseRef(
            warehouseName,
            cityRef,
            config.novaPoshta.apiKey
        );
        if (!warehouseRef) throw new Error(`Не знайдено відділення: ${warehouseName}`);
        console.log("🏤 Використовуємо WarehouseRef:", warehouseRef);

        // === 3. Отримувач ===
        const { first, last } = splitName(recipientName);
        console.log(`👤 Отримувач (UA): ${first} ${last}`);

        const recipientRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
            apiKey: config.novaPoshta.apiKey,
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

        if (!recipientRes.data?.success) {
            throw new Error(
                `Не вдалося створити отримувача: ${(recipientRes.data?.errors || []).join(", ")}`
            );
        }
        const RECIPIENT_REF = recipientRes.data.data?.[0]?.Ref;

        // === 4. Контактна особа ===
        const contactRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
            apiKey: config.novaPoshta.apiKey,
            modelName: "ContactPerson",
            calledMethod: "getContactPersons",
            methodProperties: { CounterpartyRef: RECIPIENT_REF },
        });

        let CONTACT_RECIPIENT_REF = contactRes.data?.data?.[0]?.Ref;

        if (!CONTACT_RECIPIENT_REF) {
            const newContactRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
                apiKey: config.novaPoshta.apiKey,
                modelName: "ContactPerson",
                calledMethod: "save",
                methodProperties: {
                    CounterpartyRef: RECIPIENT_REF,
                    FirstName: first,
                    LastName: last,
                    Phone: recipientPhone,
                },
            });

            CONTACT_RECIPIENT_REF = newContactRes.data?.data?.[0]?.Ref;
        }

        // === 5. Payment link через Monobank ===
        let paymentUrl = null;
        let monoInvoiceId = null;

        if (!config.monobank.token) {
            console.warn("⚠️ MONO_MERCHANT_TOKEN відсутній, пропускаємо створення інвойсу monobank");
        } else {
            try {
                console.log("💳 Генеруємо payment link через Monobank...");

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

                const baseUrl = BASE_URL || `${req.protocol}://${req.get("host")}`;

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

                monoInvoiceId = monoRes.data?.invoiceId;
                paymentUrl = monoRes.data?.pageUrl;

                console.log("✅ Monobank invoice:", monoInvoiceId);
                console.log("✅ Лінк для оплати (Monobank):", paymentUrl);

                if (monoInvoiceId && paymentUrl) {
                    saveMonoInvoice(monoInvoiceId, order, paymentUrl);
                }
            } catch (err) {
                console.error("🚨 Помилка при створенні payment link через Monobank:", err.response?.data || err.message);
            }
        }

        // === 5b. Записати payment link у метафілд Shopify ===
        // IMPORTANT: We use config.shopify.store / token from central config
        if (paymentUrl && SHOPIFY_STORE && SHOPIFY_ADMIN_TOKEN && order?.id) {
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
                                    type: "single_line_text_field", // CHANGED TO TEXT PER USER REQUEST
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
                console.error("⚠️ Не вдалось записати payment link в Shopify:", err.response?.data || err.message);
            }
        } else {
            console.warn("⚠️ Пропускаємо запис метафілда Shopify: немає paymentUrl або SHOPIFY_STORE / SHOPIFY_ADMIN_API_KEY / order.id");
        }

        // === 6. ТТН (ВАЖЛИВО: без Seats і без VolumeGeneral) ===
        const isCOD = /cash|cod|налож|money_order/i.test(paymentMethod);
        const afterPaymentAmount = isCOD ? order.total_price : "0";

        const npRequest = {
            apiKey: config.novaPoshta.apiKey,
            modelName: "InternetDocument",
            calledMethod: "save",
            methodProperties: {
                PayerType: "Recipient",
                PaymentMethod: "Cash",
                CargoType: "Parcel",
                ServiceType: "WarehouseWarehouse",

                SeatsAmount: "1",
                Weight: "0.3",

                Cost: order.total_price || "0",
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
            },
        };

        const { data: ttnRes } = await axios.post("https://api.novaposhta.ua/v2.0/json/", npRequest);

        if (!ttnRes?.success) {
            throw new Error(`Не вдалося створити ТТН: ${(ttnRes?.errors || []).join(", ")}`);
        }

        const ttnData = ttnRes.data?.[0];
        console.log("✅ ТТН створено:", ttnData?.IntDocNumber);

        // === 7. Етикетка (PDF) ===
        const labelUrl = `https://my.novaposhta.ua/orders/printMarking100x100/orders[]/${ttnData.IntDocNumber}/type/pdf/apiKey/${config.novaPoshta.apiKey}/zebra`;
        const pdfResponse = await axios.get(labelUrl, { responseType: "arraybuffer" });

        const pdfPath = path.join(LABELS_DIR, `label-${ttnData.IntDocNumber}.pdf`);
        fs.writeFileSync(pdfPath, pdfResponse.data);
        console.log("💾 PDF збережено:", pdfPath);

        // === 8. PrintNode (опціонально) ===
        if (config.printnode.apiKey && config.printnode.printerId) {
            const pdfBase64 = fs.readFileSync(pdfPath).toString("base64");
            await axios.post(
                "https://api.printnode.com/printjobs",
                {
                    printerId: parseInt(config.printnode.printerId, 10),
                    title: `Nova Poshta ${ttnData.IntDocNumber}`,
                    contentType: "pdf_base64",
                    content: pdfBase64,
                    source: "Shopify AutoPrint",
                },
                { auth: { username: config.printnode.apiKey, password: "" } }
            );
            console.log("✅ Етикетка відправлена на друк через PrintNode");
        }

        // позначаємо замовлення як оброблене
        printedOrders[orderKey] = Date.now();
        fs.writeFileSync(PRINTED_DB, JSON.stringify(printedOrders, null, 2));

        const publicUrl = `${req.protocol}://${req.get("host")}/labels/label-${ttnData.IntDocNumber}.pdf`;

        // === 8b. Записати TNN PDF в метафілд ===
        if (publicUrl && SHOPIFY_STORE && SHOPIFY_ADMIN_TOKEN && order?.id) {
            try {
                // Ensure full URL
                const fullLabelUrl = publicUrl.startsWith("http") ? publicUrl : `${BASE_URL}${publicUrl}`;

                await axios.put(
                    `https://${SHOPIFY_STORE}/admin/api/2024-10/orders/${order.id}.json`,
                    {
                        order: {
                            id: order.id,
                            metafields: [
                                {
                                    namespace: "custom",
                                    key: "np_ttn_pdf",
                                    type: "single_line_text_field", // Safe type
                                    value: fullLabelUrl,
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
                console.log("🔗 TTN PDF збережено в Shopify:", fullLabelUrl);
            } catch (e) {
                console.error("⚠️ Не вдалось записати ttn pdf в Shopify:", e.message);
            }
        }

        return res.json({
            ok: true,
            message: "✅ ТТН створено. Етикетка збережена. Лінк на оплату — Monobank invoice (якщо створився).",
            order_id: orderKey,
            ttn: ttnData.IntDocNumber,
            label_url: publicUrl,
            payment_link: paymentUrl || "—",
            mono_invoice_id: monoInvoiceId || "—",
        });
    } catch (err) {
        console.error("🚨 Помилка:", err.message);
        return res.status(500).json({ error: err.message });
    }
}