import fs from "fs";
import path from "path";

const PRINTED_DB = path.resolve("./printed_orders.json");
if (!fs.existsSync(PRINTED_DB)) fs.writeFileSync(PRINTED_DB, "{}");

export function isOrderProcessed(orderKey) {
    try {
        const data = JSON.parse(fs.readFileSync(PRINTED_DB, "utf8"));
        const lastPrinted = data[orderKey];
        if (lastPrinted && Date.now() - lastPrinted < 10 * 60 * 1000) {
            return true;
        }
    } catch (e) { }
    return false;
}

export function markOrderProcessed(orderKey) {
    try {
        const data = JSON.parse(fs.readFileSync(PRINTED_DB, "utf8"));
        data[orderKey] = Date.now();
        fs.writeFileSync(PRINTED_DB, JSON.stringify(data, null, 2));
    } catch (e) { }
}
