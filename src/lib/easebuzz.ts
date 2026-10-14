import crypto from "crypto";
import { prisma } from "./db";
import { sendOrderConfirmationEmail } from "./email";

// Easebuzz hosted checkout. Hash sequences follow the official kit:
// https://github.com/easebuzz/paywitheasebuzz-nodejs-lib

const UDF_COUNT = 10;

function getConfig() {
  return {
    key: process.env.EASEBUZZ_KEY || "",
    salt: process.env.EASEBUZZ_SALT || "",
    env: process.env.EASEBUZZ_ENV === "prod" ? "prod" : "test",
  };
}

export function isEasebuzzConfigured() {
  const { key, salt } = getConfig();
  return !!(key && salt);
}

function payBaseUrl() {
  return getConfig().env === "prod" ? "https://pay.easebuzz.in/" : "https://testpay.easebuzz.in/";
}

function sha512(value: string) {
  return crypto.createHash("sha512").update(value).digest("hex").toLowerCase();
}

function udfs(params: Record<string, string | undefined>) {
  return Array.from({ length: UDF_COUNT }, (_, i) => params[`udf${i + 1}`] || "");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Easebuzz txnid for an order: unique per attempt, maps back to the order id. */
export function buildTxnId(orderId: number) {
  return `DK${orderId}T${Date.now()}`;
}

export function orderIdFromTxnId(txnid: string) {
  const match = /^DK(\d+)T\d+$/.exec(txnid);
  return match ? Number(match[1]) : null;
}

export type InitiateParams = {
  txnid: string;
  amount: number;
  productinfo: string;
  firstname: string;
  email: string;
  phone: string;
  surl: string;
  furl: string;
  udf1?: string;
};

/** Calls initiateLink and returns the hosted payment page URL. */
export async function initiatePayment(input: InitiateParams) {
  const { key, salt } = getConfig();
  const params: Record<string, string> = {
    key,
    txnid: input.txnid,
    amount: input.amount.toFixed(2),
    productinfo: input.productinfo.trim().slice(0, 100),
    firstname: input.firstname.trim().replace(/[^a-zA-Z0-9 .]/g, "").slice(0, 60) || "Customer",
    email: input.email.trim(),
    phone: input.phone.trim(),
    surl: input.surl,
    furl: input.furl,
    udf1: input.udf1 || "",
  };

  params.hash = sha512(
    [params.key, params.txnid, params.amount, params.productinfo, params.firstname, params.email, ...udfs(params), salt].join("|")
  );

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== "") body.append(k, v);

  const res = await fetch(`${payBaseUrl()}payment/initiateLink`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as { status?: number; data?: string; error_desc?: string } | null;

  if (!data || data.status !== 1 || !data.data) {
    throw new Error(data?.error_desc || data?.data || "Unable to start Easebuzz payment");
  }
  return `${payBaseUrl()}pay/${encodeURIComponent(data.data)}`;
}

export type EasebuzzResponse = Record<string, string>;

/** Verifies the reverse hash Easebuzz sends to surl/furl and the webhook. */
export function verifyResponseHash(resp: EasebuzzResponse) {
  const { key, salt } = getConfig();
  if (!resp.hash || resp.key !== key) return false;
  const expected = sha512(
    [
      salt,
      resp.status || "",
      ...udfs(resp).reverse(),
      resp.email || "",
      resp.firstname || "",
      resp.productinfo || "",
      resp.amount || "",
      resp.txnid || "",
      resp.key || "",
    ].join("|")
  );
  return safeEqual(expected, resp.hash.toLowerCase());
}

const FAILED_STATUSES = new Set(["failure", "usercancelled", "dropped", "bounced"]);

const MODE_LABELS: Record<string, string> = {
  UPI: "UPI",
  CC: "Credit Card",
  DC: "Debit Card",
  NB: "Net Banking",
  MW: "Wallet",
  EMI: "EMI",
  PL: "Pay Later",
};

function paymentModeLabel(mode?: string) {
  const key = (mode || "").toUpperCase();
  return MODE_LABELS[key] || key || "Online";
}

/**
 * Applies a verified Easebuzz response (browser callback or webhook) to its order.
 * Idempotent: the confirmation email goes out only on the first transition to paid.
 */
export async function settleEasebuzzPayment(resp: EasebuzzResponse) {
  if (!verifyResponseHash(resp)) return { ok: false as const, reason: "hash" };

  const orderId = orderIdFromTxnId(resp.txnid || "");
  const order = orderId ? await prisma.order.findUnique({ where: { id: orderId } }) : null;
  if (!order || order.easebuzzTxnId !== resp.txnid) return { ok: false as const, reason: "order" };

  const status = (resp.status || "").toLowerCase();

  if (status === "success") {
    if (Math.abs(parseFloat(resp.amount) - order.total) > 0.01) {
      return { ok: false as const, reason: "amount", orderId: order.id };
    }
    const paidAt = new Date();
    const paymentMode = paymentModeLabel(resp.mode);
    const updated = await prisma.order.updateMany({
      where: { id: order.id, paymentStatus: { not: "paid" } },
      data: { paymentStatus: "paid", status: "Confirmed", easebuzzPaymentId: resp.easepayid || null, paymentMode, paidAt },
    });
    if (updated.count === 1) {
      sendOrderConfirmationEmail({
        id: order.id,
        email: order.email,
        customerName: order.customerName,
        items: order.items as { name: string; qty: number; salePrice: number }[],
        total: order.total,
        subtotal: order.subtotal,
        discount: order.discount,
        couponCode: order.couponCode,
        address: order.address,
        phone: order.phone,
        paymentMethod: `Paid online · ${paymentMode}`,
        payment: { paymentId: resp.easepayid || "—", txnId: order.easebuzzTxnId || "", mode: paymentMode, paidAt },
      });
    }
    return { ok: true as const, paid: true, orderId: order.id };
  }

  if (FAILED_STATUSES.has(status)) {
    await prisma.order.updateMany({
      where: { id: order.id, paymentStatus: "pending" },
      data: { paymentStatus: "failed", status: "Cancelled", easebuzzPaymentId: resp.easepayid || null },
    });
  }
  return { ok: true as const, paid: false, orderId: order.id };
}
