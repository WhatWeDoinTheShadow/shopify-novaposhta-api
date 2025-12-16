import axios from "axios";
import fs from "fs";
import { config } from "../config.js";

export async function printLabel(pdfPath, docNumber) {
    if (!config.printNode.apiKey || !config.printNode.printerId) {
        return;
    }

    try {
        const pdfBase64 = fs.readFileSync(pdfPath).toString("base64");
        await axios.post(
            "https://api.printnode.com/printjobs",
            {
                printerId: parseInt(config.printNode.printerId, 10),
                title: `Nova Poshta ${docNumber}`,
                contentType: "pdf_base64",
                content: pdfBase64,
                source: "Shopify AutoPrint",
            },
            { auth: { username: config.printNode.apiKey, password: "" } }
        );
        console.log("✅ Етикетка відправлена на друк через PrintNode");
    } catch (e) {
        console.error("PrintNode error:", e.message);
    }
}
