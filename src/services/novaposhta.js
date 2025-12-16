import axios from "axios";
import path from "path";
import fs from "fs";
import { config } from "../config.js";

const LABELS_DIR = path.resolve("./labels");
if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR);

export async function findCityRef(rawCityName) {
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
            apiKey: config.novaPoshta.apiKey,
            modelName: "Address",
            calledMethod: "getCities",
            methodProperties: { FindByString: q },
        });
        const ref = cityRes.data?.data?.[0]?.Ref;
        if (ref) return ref;
    }

    return null;
}

export async function findWarehouseRef(warehouseName, cityRef) {
    // If it's a Ref (digits check removed as Ref is typically UUID, but keeping logic compatible if used)
    // Actually original code checked /^\d{5,}$/.
    if (/^\d{5,}$/.test(String(warehouseName || "").trim())) {
        console.log("📦 Виявлено можливий Ref відділення:", warehouseName);
        const refRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
            apiKey: config.novaPoshta.apiKey,
            modelName: "AddressGeneral",
            calledMethod: "getWarehouses",
            methodProperties: { Ref: String(warehouseName).trim() },
        });
        const warehouseRef = refRes.data?.data?.[0]?.Ref || null;
        if (warehouseRef) return warehouseRef;
    }

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
        apiKey: config.novaPoshta.apiKey,
        modelName: "AddressGeneral",
        calledMethod: "getWarehouses",
        methodProperties: { CityRef: cityRef, FindByString: onlyNumber },
    });

    return whRes.data?.data?.[0]?.Ref || null;
}

export async function createRecipientAndContact(first, last, phone, cityRef) {
    // 1. Create/Find Counterparty
    const recipientRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
        apiKey: config.novaPoshta.apiKey,
        modelName: "Counterparty",
        calledMethod: "save",
        methodProperties: {
            CounterpartyProperty: "Recipient",
            CounterpartyType: "PrivatePerson",
            FirstName: first,
            LastName: last,
            Phone: phone,
            CityRef: cityRef,
        },
    });

    if (!recipientRes.data?.success) {
        throw new Error(
            `Не вдалося створити отримувача: ${(recipientRes.data?.errors || []).join(", ")}`
        );
    }
    const recipientRef = recipientRes.data.data?.[0]?.Ref;

    // 2. Contact Person
    const contactRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
        apiKey: config.novaPoshta.apiKey,
        modelName: "ContactPerson",
        calledMethod: "getContactPersons",
        methodProperties: { CounterpartyRef: recipientRef },
    });

    let contactRef = contactRes.data?.data?.[0]?.Ref;

    if (!contactRef) {
        const newContactRes = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
            apiKey: config.novaPoshta.apiKey,
            modelName: "ContactPerson",
            calledMethod: "save",
            methodProperties: {
                CounterpartyRef: recipientRef,
                FirstName: first,
                LastName: last,
                Phone: phone,
            },
        });
        contactRef = newContactRes.data?.data?.[0]?.Ref;
    }

    return { recipientRef, contactRef };
}

export async function createTTN(orderData) {
    const {
        moneyAmount,
        description,
        cityRef,
        warehouseRef,
        recipientRef,
        contactRef,
        phone,
        isCOD
    } = orderData;

    const afterPaymentAmount = isCOD ? moneyAmount : "0";

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
            Cost: moneyAmount,
            Description: description,
            CitySender: config.novaPoshta.senderCityRef,
            SenderAddress: config.novaPoshta.senderAddressRef,
            ContactSender: config.novaPoshta.contactSenderRef,
            Sender: config.novaPoshta.senderRef,
            SendersPhone: config.novaPoshta.sendersPhone,
            CityRecipient: cityRef,
            RecipientAddress: warehouseRef,
            Recipient: recipientRef,
            ContactRecipient: contactRef,
            RecipientsPhone: phone,
            AfterpaymentOnGoodsCost: afterPaymentAmount,
        },
    };

    const { data: ttnRes } = await axios.post("https://api.novaposhta.ua/v2.0/json/", npRequest);

    if (!ttnRes?.success) {
        throw new Error(`Не вдалося створити ТТН: ${(ttnRes?.errors || []).join(", ")}`);
    }

    return ttnRes.data?.[0];
}

export async function downloadLabel(intDocNumber) {
    const labelUrl = `https://my.novaposhta.ua/orders/printMarking100x100/orders[]/${intDocNumber}/type/pdf/apiKey/${config.novaPoshta.apiKey}/zebra`;
    const pdfResponse = await axios.get(labelUrl, { responseType: "arraybuffer" });
    const pdfPath = path.join(LABELS_DIR, `label-${intDocNumber}.pdf`);
    fs.writeFileSync(pdfPath, pdfResponse.data);
    return { pdfPath, publicUrl: `/labels/label-${intDocNumber}.pdf` };
}
