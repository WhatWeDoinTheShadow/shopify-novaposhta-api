export function normalizePhone(rawPhone) {
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

export function buildShortDescription(order) {
    const base = `Order ${order.name || ""}`.trim();
    const itemsCount = Array.isArray(order.line_items) ? order.line_items.length : 0;
    const qtySum = Array.isArray(order.line_items)
        ? order.line_items.reduce((acc, i) => acc + Number(i.quantity || 0), 0)
        : 0;

    let desc = base;
    if (itemsCount > 0) desc += ` | items:${itemsCount}`;
    if (qtySum > 0) desc += ` | qty:${qtySum}`;

    return desc.slice(0, 90);
}
