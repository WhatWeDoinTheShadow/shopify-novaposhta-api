import express from "express";
import axios from "axios";
import crypto from "crypto";

// =======================
// Monobank invoice webhook → Shopify
//
//   POST /api/mono/webhook
//
// 1. Verify X-Sign (ECDSA SHA-256 over the raw body, pubkey from /api/merchant/pubkey)
// 2. Re-read the invoice status from Monobank (webhooks can arrive out of order — the API is the source of truth)
// 3. success  → orderMarkAsPaid in Shopify (+ tag mono_paid), only if the paid amount covers the outstanding amount
//    reversed → tag mono_reversed (refunds are not processed automatically)
//    failure  → tag mono_failed
//
// Order id is taken from invoice.reference (set to Shopify order.id in createMonoInvoice).
// =======================

const MONO_API = "https://api.monobank.ua";

const env = () => ({
  MONO_TOKEN: process.env.MONO_MERCHANT_TOKEN,
  SHOPIFY_STORE: process.env.SHOPIFY_STORE,
  SHOPIFY_ADMIN_TOKEN: process.env.SHOPIFY_ADMIN_API_KEY,
});

const router = express.Router();

// ---------- signature ----------
let cachedPubKeyPem = null;

async function getPubKey(force = false) {
  if (cachedPubKeyPem && !force) return cachedPubKeyPem;
  const res = await axios.get(`${MONO_API}/api/merchant/pubkey`, {
    headers: { "X-Token": env().MONO_TOKEN },
    timeout: 15000,
  });
  cachedPubKeyPem = Buffer.from(res.data.key, "base64").toString("utf8");
  return cachedPubKeyPem;
}

function verifySignature(rawBody, xSign, pem) {
  try {
    const verify = crypto.createVerify("SHA256");
    verify.update(rawBody);
    verify.end();
    return verify.verify(pem, Buffer.from(xSign, "base64"));
  } catch {
    return false;
  }
}

async function isSignatureValid(rawBody, xSign) {
  if (!xSign || !rawBody) return false;
  if (verifySignature(rawBody, xSign, await getPubKey())) return true;
  // key may have rotated — refetch once
  return verifySignature(rawBody, xSign, await getPubKey(true));
}

// ---------- Monobank ----------
async function getInvoiceStatus(invoiceId) {
  const res = await axios.get(`${MONO_API}/api/merchant/invoice/status`, {
    params: { invoiceId },
    headers: { "X-Token": env().MONO_TOKEN },
    timeout: 15000,
  });
  return res.data;
}

// ---------- Shopify ----------
async function shopifyGql(query, variables) {
  const { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN } = env();
  const res = await axios.post(
    `https://${SHOPIFY_STORE}/admin/api/2024-10/graphql.json`,
    { query, variables },
    {
      headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN, "Content-Type": "application/json" },
      timeout: 20000,
    }
  );
  if (res.data?.errors?.length) throw new Error(`Shopify GraphQL: ${JSON.stringify(res.data.errors)}`);
  return res.data?.data;
}

async function getShopifyOrder(gid) {
  const data = await shopifyGql(
    `query($id: ID!) {
      order(id: $id) {
        id
        name
        displayFinancialStatus
        totalOutstandingSet { shopMoney { amount currencyCode } }
      }
    }`,
    { id: gid }
  );
  return data?.order || null;
}

async function addTags(gid, tags) {
  const data = await shopifyGql(
    `mutation($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
    }`,
    { id: gid, tags }
  );
  const errs = data?.tagsAdd?.userErrors || [];
  if (errs.length) console.warn("⚠️ tagsAdd:", errs);
}

async function markAsPaid(gid) {
  const data = await shopifyGql(
    `mutation($input: OrderMarkAsPaidInput!) {
      orderMarkAsPaid(input: $input) {
        order { name displayFinancialStatus }
        userErrors { field message }
      }
    }`,
    { input: { id: gid } }
  );
  const errs = data?.orderMarkAsPaid?.userErrors || [];
  if (errs.length) throw new Error(`orderMarkAsPaid: ${errs.map((e) => e.message).join(", ")}`);
  return data?.orderMarkAsPaid?.order;
}

// ---------- processing ----------
async function processInvoice(invoiceId) {
  const inv = await getInvoiceStatus(invoiceId);
  const orderId = String(inv?.reference || "").match(/^\d{6,}$/)?.[0];

  console.log("🏦 Mono invoice:", {
    invoiceId,
    status: inv?.status,
    amount: inv?.amount,
    finalAmount: inv?.finalAmount,
    reference: inv?.reference,
    modifiedDate: inv?.modifiedDate,
  });

  if (!orderId) {
    console.warn(`⚠️ Mono ${invoiceId}: reference "${inv?.reference}" не схожий на Shopify order id — пропускаю`);
    return { skipped: "no_order_ref" };
  }

  const gid = `gid://shopify/Order/${orderId}`;

  if (inv.status === "success") {
    const order = await getShopifyOrder(gid);
    if (!order) {
      console.warn(`⚠️ Mono ${invoiceId}: замовлення ${orderId} не знайдено в Shopify`);
      return { skipped: "order_not_found" };
    }

    if (order.displayFinancialStatus === "PAID") {
      console.log(`ℹ️ ${order.name}: вже PAID, нічого не робимо`);
      return { ok: true, already: true };
    }

    const paidUah = Number(inv.finalAmount ?? inv.amount ?? 0) / 100;
    const outstanding = Number(order.totalOutstandingSet?.shopMoney?.amount || 0);

    if (outstanding > 0 && paidUah + 0.009 < outstanding) {
      console.warn(`⚠️ ${order.name}: оплачено ${paidUah} UAH, а до сплати ${outstanding} — не позначаю PAID`);
      await addTags(gid, ["mono_paid", "mono_amount_mismatch"]);
      return { ok: false, mismatch: true };
    }

    const updated = await markAsPaid(gid);
    await addTags(gid, ["mono_paid"]);
    console.log(`✅ ${order.name}: позначено ${updated?.displayFinancialStatus} (Mono ${invoiceId}, ${paidUah} UAH)`);
    return { ok: true, paid: true };
  }

  if (inv.status === "reversed") {
    await addTags(gid, ["mono_reversed"]);
    console.warn(`↩️ Mono ${invoiceId}: платіж повернуто — замовлення ${orderId} позначено тегом mono_reversed`);
    return { ok: true, reversed: true };
  }

  if (inv.status === "failure") {
    await addTags(gid, ["mono_failed"]);
    console.log(`❌ Mono ${invoiceId}: оплата не пройшла (${inv.failureReason || "—"})`);
    return { ok: true, failed: true };
  }

  // created / processing / hold — nothing to do yet
  return { ok: true, status: inv.status };
}

// ---------- route ----------
router.post("/api/mono/webhook", async (req, res) => {
  const xSign = req.get("X-Sign");
  const invoiceId = req.body?.invoiceId;

  if (!env().MONO_TOKEN) {
    console.error("🚨 Mono webhook: MONO_MERCHANT_TOKEN не задано");
    return res.status(500).json({ error: "not_configured" });
  }

  try {
    const valid = await isSignatureValid(req.rawBody, xSign);
    if (!valid) {
      console.warn("⛔ Mono webhook: невалідний X-Sign", { invoiceId });
      return res.status(401).json({ error: "bad_signature" });
    }
  } catch (e) {
    // pubkey unavailable — we still re-check the invoice via Mono API below, so it is safe to continue
    console.error("⚠️ Mono pubkey fetch failed, continue with status API check:", e?.response?.data || e?.message || e);
  }

  if (!invoiceId) return res.status(400).json({ error: "no_invoiceId" });

  try {
    const result = await processInvoice(invoiceId);
    return res.status(200).json(result);
  } catch (e) {
    // non-200 → Monobank retries the webhook
    console.error("🚨 Mono webhook processing failed:", e?.response?.data || e?.message || e);
    return res.status(500).json({ error: "processing_failed" });
  }
});

export { processInvoice };
export default router;
