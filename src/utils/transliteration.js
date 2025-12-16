import CyrillicToTranslit from "cyrillic-to-translit-js";

const cyrillicToTranslit = new CyrillicToTranslit({ preset: "uk" });

const isLatin = (str) => /[A-Za-z]/.test(str);

export function translitToUa(raw) {
    if (!raw) return "";
    // If it's already Cyrillic, return as is (capitalized)
    if (!isLatin(raw)) {
        return raw.charAt(0).toUpperCase() + raw.slice(1);
    }

    // Reverse transliteration: Latin -> Ukrainian
    let ua = cyrillicToTranslit.reverse(raw);

    // Fix common endings
    ua = ua.replace(/іі$/, "ій");
    ua = ua.replace(/іи$/, "ій");

    return ua.charAt(0).toUpperCase() + ua.slice(1);
}

export function splitName(raw) {
    const clean = String(raw || "")
        .replace(/[^A-Za-zА-Яа-яІіЇїЄєҐґ'\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!clean) return { first: "Клієнт", last: "Shopify" };

    const parts = clean.split(" ").filter(Boolean);
    let first = parts[0] || "Клієнт";
    let last = parts.slice(1).join(" ") || "Shopify";

    if (isLatin(first)) first = translitToUa(first);
    if (isLatin(last)) last = translitToUa(last);

    // Fallback if somehow still Latin (shouldn't happen with reverse(), but safety net)
    if (isLatin(first)) first = "Клієнт";
    if (isLatin(last)) last = "Shopify";

    return {
        first: String(first).slice(0, 30),
        last: String(last).slice(0, 30),
    };
}
