import axios from "axios";
import fs from "fs";
import path from "path";

const LABELS_DIR = path.resolve("./labels");
if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR);

const PRINTED_DB = path.resolve("./printed_orders.json");
if (!fs.existsSync(PRINTED_DB)) fs.writeFileSync(PRINTED_DB, "{}");

let printedOrders = JSON.parse(fs.readFileSync(PRINTED_DB, "utf8"));

export async function handleNovaPoshta(req, res) {
  const order = req.body;
  console.log("📦 Нове замовлення з Shopify:", order.name);

  const now = Date.now();
  const lastPrinted = printedOrders[order.name];
  if (lastPrinted && now - lastPrinted < 10 * 60 * 1000) {
    console.log("⚠️ Замовлення вже було надруковане нещодавно:", order.name);
    return res.json({ message: "🟡 Вже надруковано", order: order.name });
  }

  if (!process.env.NP_API_KEY)
    return res.status(500).json({ error: "❌ NP_API_KEY is missing on server" });

  try {
    // === Дані відправника ===
    const SENDER_CITY_REF = "db5c88f5-391c-11dd-90d9-001a92567626"; // Львів
    const SENDER_ADDRESS_REF = "c8025d1c-b36a-11e4-a77a-005056887b8d"; // Відділення №31
    const SENDER_REF = "6bcb6d88-16de-11ef-bcd0-48df37b921da";
    const CONTACT_SENDER_REF = "f8caa074-1740-11ef-bcd0-48df37b921da";
    const SENDERS_PHONE = "380932532432";

    // === Дані з Shopify ===
    const cityName = order.shipping_address?.city || "Київ";
    const warehouseName = order.shipping_address?.address1 || "Відділення №1";
    const recipientName = order.shipping_address?.name || "Тестовий Отримувач";
    const recipientPhone =
      order.shipping_address?.phone?.replace(/\D/g, "") || "380501112233";
    const paymentMethod = order.payment_gateway_names?.[0] || "";

    console.log("🏙️ Місто:", cityName);
    console.log("🏤 Відділення:", warehouseName);
    console.log("💰 Оплата:", paymentMethod);

    // === 1. CityRef ===
    const cityRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "Address",
      calledMethod: "getCities",
      methodProperties: { FindByString: cityName },
    });
    const cityRef = cityRes.data.data?.[0]?.Ref;
    if (!cityRef) throw new Error(`Не знайдено місто: ${cityName}`);

    // === 2. WarehouseRef ===
    const whRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "AddressGeneral",
      calledMethod: "getWarehouses",
      methodProperties: { CityRef: cityRef, FindByString: warehouseName },
    });
    const warehouseRef = whRes.data.data?.[0]?.Ref;
    if (!warehouseRef) throw new Error(`Не знайдено відділення: ${warehouseName}`);

    // === 3. Отримувач ===
    let cleanName = recipientName
      ?.replace(/[^A-Za-zА-Яа-яІіЇїЄєҐґ'\s]/g, "")
      ?.trim();
    if (!cleanName || cleanName.length < 2) cleanName = "Тест Отримувач";
    let [first, last] = cleanName.split(" ");
    if (!last) {
      last = first || "Отримувач";
      first = "Тест";
    }
    first = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    last = last.charAt(0).toUpperCase() + last.slice(1).toLowerCase();
    console.log(`👤 Отримувач: ${first} ${last}`);

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

    // === 4. Контактна особа ===
    let contactRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NP_API_KEY,
      modelName: "ContactPerson",
      calledMethod: "getContactPersons",
      methodProperties: { CounterpartyRef: RECIPIENT_REF },
    });

    let CONTACT_RECIPIENT_REF = contactRes.data.data?.[0]?.Ref;

    if (!CONTACT_RECIPIENT_REF) {
      console.log("ℹ️ Контактна особа не знайдена — створюємо нову...");
      const newContactRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
        apiKey: process.env.NP_API_KEY,
        modelName: "ContactPerson",
        calledMethod: "save",
        methodProperties: {
          CounterpartyRef: RECIPIENT_REF,
          FirstName: first,
          LastName: last,
          Phone: recipientPhone,
        },
      });

      if (!newContactRes.data.success) {
        throw new Error(
          `Не вдалося створити контактну особу: ${newContactRes.data.errors.join(", ")}`
        );
      }

      CONTACT_RECIPIENT_REF = newContactRes.data.data[0].Ref;
      console.log("✅ Контактна особа створена:", CONTACT_RECIPIENT_REF);
    } else {
      console.log("✅ Контактна особа знайдена:", CONTACT_RECIPIENT_REF);
    }

    // === 5. Післяплата ===
    const isCOD = /cash|cod|налож/i.test(paymentMethod);
    const afterPaymentAmount = isCOD ? order.total_price : "0";

    // === 6. Створення ТТН ===
    const npRequest = {
      apiKey: process.env.NP_API_KEY,
      modelName: "InternetDocument",
      calledMethod: "save",
      methodProperties: {
        PayerType: "Sender",
        PaymentMethod: "Cash",
        CargoType: "Parcel",
        Weight: "0.3",
        VolumeGeneral: "0.001",
        ServiceType: "WarehouseWarehouse",
        SeatsAmount: "1",
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

    // === 7. Отримуємо офіційний PDF від НП ===
    const labelUrl = `https://my.novaposhta.ua/orders/printMarking100x100/orders[]/${ttnData.IntDocNumber}/type/pdf/apiKey/${process.env.NP_API_KEY}/zebra`;
    console.log("📎 Етикетка:", labelUrl);

    const pdfResponse = await axios.get(labelUrl, { responseType: "arraybuffer" });
    const pdfPath = path.join(LABELS_DIR, `label-${ttnData.IntDocNumber}.pdf`);
    fs.writeFileSync(pdfPath, pdfResponse.data);
    console.log("💾 PDF збережено:", pdfPath);

    // === 8. Автодрук через PrintNode ===
    if (process.env.PRINTNODE_API_KEY && process.env.PRINTNODE_PRINTER_ID) {
      try {
        console.log("🖨️ Відправляю PDF через PrintNode...");

        const pdfBuffer = fs.readFileSync(pdfPath);
        const pdfBase64 = pdfBuffer.toString("base64");

        await axios.post(
          "https://api.printnode.com/printjobs",
          {
            printerId: parseInt(process.env.PRINTNODE_PRINTER_ID),
            title: `Nova Poshta ${ttnData.IntDocNumber}`,
            contentType: "pdf_base64",
            content: pdfBase64,
            source: "Shopify AutoPrint",
            options: {
              copies: 1,
              fit_to_page: true, // ✅ автоматичне підлаштування під сторінку
              scale: 1.03, // ✅ трохи менший масштаб, щоб не обрізало
              paper: "100x100mm", // ✅ явний розмір
              dpi: "203x203",
              margins: "none",
              color: false,
              duplex: "one-sided",
              rotate: 0,
            },
          },
          {
            auth: {
              username: process.env.PRINTNODE_API_KEY,
              password: "",
            },
          }
        );

        console.log("✅ Етикетка відправлена на друк через PrintNode");
      } catch (printErr) {
        console.error(
          "🚨 Помилка друку через PrintNode:",
          printErr.response?.data || printErr.message
        );
      }
    }

    // 🧠 Записуємо, щоб не друкувати повторно
    printedOrders[order.name] = Date.now();
    fs.writeFileSync(PRINTED_DB, JSON.stringify(printedOrders, null, 2));

    const publicUrl = `${req.protocol}://${req.get("host")}/labels/label-${ttnData.IntDocNumber}.pdf`;
    return res.json({
      message: "✅ ТТН створено, етикетка надрукована без обрізання",
      ttn: ttnData.IntDocNumber,
      label_url: publicUrl,
    });
  } catch (err) {
    console.error("🚨 Помилка:", err.message);
    res.status(500).json({ error: err.message });
  }
}
