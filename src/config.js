import dotenv from "dotenv";
dotenv.config();

export const config = {
    shopify: {
        store: process.env.SHOPIFY_STORE,
        adminToken: process.env.SHOPIFY_ADMIN_API_KEY,
    },
    novaPoshta: {
        apiKey: process.env.NP_API_KEY,
        senderCityRef: "db5c88f5-391c-11dd-90d9-001a92567626",
        senderAddressRef: "c8025d1c-b36a-11e4-a77a-005056887b8d",
        senderRef: "6bcb6d88-16de-11ef-bcd0-48df37b921da",
        contactSenderRef: "f8caa074-1740-11ef-bcd0-48df37b921da",
        sendersPhone: "380932532432",
    },
    monobank: {
        token: process.env.MONO_MERCHANT_TOKEN,
    },
    printNode: {
        apiKey: process.env.PRINTNODE_API_KEY,
        printerId: process.env.PRINTNODE_PRINTER_ID,
    },
    baseUrl: process.env.BASE_URL,
};
