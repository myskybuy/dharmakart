import crypto from "crypto";
import { prisma } from "./db";
import { markOrderFailed, markOrderPaid } from "./payments";

// PhonePe PG Standard Checkout (v2, OAuth). Docs:
// https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/create-payment

function getConfig() {
  const prod = ["prod", "production", "live"].includes((process.env.PHONEPE_ENV || "").trim().toLowerCase());
  return {
    clientId: process.env.PHONEPE_CLIENT_ID || "",
    clientSecret: process.env.PHONEPE_CLIENT_SECRET || "",
    clientVersion: process.env.PHONEPE_CLIENT_VERSION || "1",
    webhookUser: process.env.PHONEPE_WEBHOOK_USERNAME || "",
    webhookPass: process.env.PHONEPE_WEBHOOK_PASSWORD || "",
    tokenUrl: prod
      ? "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"
      : "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token",
    pgBase: prod ? "https://api.phonepe.com/apis/pg" : "https://api-preprod.phonepe.com/apis/pg-sandbox",
  };
}

export function isPhonePeConfigured() {
  const { clientId, clientSecret } = getConfig();
  return !!(clientId && clientSecret);
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.token;

  const cfg = getConfig();
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_version: cfg.clientVersion,
      client_secret: cfg.clientSecret,
      grant_type: "client_credentials",
    }).toString(),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as { access_token?: string; expires_at?: number } | null;
  if (!res.ok || !data?.access_token) {
    throw new Error(`PhonePe auth failed (${res.status})`);
  }
  cachedToken = { token: data.access_token, expiresAt: data.expires_at || now + 300 };
  return cachedToken.token;
}

async function pgFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${getConfig().pgBase}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `O-Bearer ${token}`, ...init.headers },
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

/** merchantOrderId for an order: unique per attempt, letters/digits only. */
export function buildMerchantOrderId(orderId: number) {
  return `DK${orderId}T${Date.now()}`;
}

/** Creates a checkout order and returns the PhonePe payment page URL. */
export async function createPayment(input: { merchantOrderId: string; amountRupees: number; redirectUrl: string; orderId: number }) {
  const { ok, status, data } = await pgFetch("/checkout/v2/pay", {
    method: "POST",
    body: JSON.stringify({
      merchantOrderId: input.merchantOrderId,
      amount: Math.round(input.amountRupees * 100),
      expireAfter: 1200,
      metaInfo: { udf1: String(input.orderId) },
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: `DharmaKart order ${input.orderId}`,
        merchantUrls: { redirectUrl: input.redirectUrl },
      },
    }),
  });
  if (!ok || !data?.redirectUrl) {
    throw new Error(`PhonePe create payment failed (${status}): ${data?.message || data?.code || "no redirectUrl"}`);
  }
  return data.redirectUrl as string;
}

type PaymentDetail = { transactionId?: string; paymentMode?: string; state?: string; amount?: number; timestamp?: number };
type OrderStatus = { orderId?: string; state?: "PENDING" | "COMPLETED" | "FAILED"; amount?: number; paymentDetails?: PaymentDetail[] };

async function fetchOrderStatus(merchantOrderId: string) {
  const { ok, status, data } = await pgFetch(`/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status?details=false`, {
    method: "GET",
  });
  if (!ok || !data?.state) throw new Error(`PhonePe status failed (${status})`);
  return data as OrderStatus;
}

const MODE_LABELS: Record<string, string> = {
  UPI_INTENT: "UPI",
  UPI_COLLECT: "UPI",
  UPI_QR: "UPI",
  CARD: "Card",
  NET_BANKING: "Net Banking",
};

function paymentModeLabel(mode?: string) {
  return MODE_LABELS[mode || ""] || (mode ? mode.replace(/_/g, " ") : "Online");
}

/**
 * Asks PhonePe for the real state of an order and applies it. Used by both the
 * browser return URL and the webhook, so neither has to trust what it was sent.
 */
export async function syncPhonePeOrder(orderId: number) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.paymentMethod !== "PHONEPE" || !order.phonepeOrderId) return null;
  if (order.paymentStatus === "paid") return "COMPLETED" as const;

  const status = await fetchOrderStatus(order.phonepeOrderId);
  const attempt = status.paymentDetails?.find((p) => p.state === "COMPLETED") || status.paymentDetails?.[0];

  if (status.state === "COMPLETED") {
    if (status.amount !== order.total * 100) {
      console.error("PhonePe amount mismatch", order.id, status.amount, order.total);
      return "PENDING" as const;
    }
    await markOrderPaid(order, {
      paymentId: attempt?.transactionId || status.orderId || "",
      txnRef: order.phonepeOrderId,
      mode: paymentModeLabel(attempt?.paymentMode),
      extra: { phonepeTxnId: attempt?.transactionId || null },
    });
  } else if (status.state === "FAILED") {
    await markOrderFailed(order.id, { phonepeTxnId: attempt?.transactionId || null });
  }
  return status.state || "PENDING";
}

/** Webhook Authorization header is SHA256(username:password) as configured on the PhonePe dashboard. */
export function verifyWebhookAuth(header: string | null) {
  const { webhookUser, webhookPass } = getConfig();
  if (!header || !webhookUser || !webhookPass) return false;
  const expected = crypto.createHash("sha256").update(`${webhookUser}:${webhookPass}`).digest("hex");
  const received = header.replace(/^SHA256\s+/i, "").trim().toLowerCase();
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function orderIdFromMerchantOrderId(merchantOrderId: string) {
  const match = /^DK(\d+)T\d+$/.exec(merchantOrderId);
  return match ? Number(match[1]) : null;
}
