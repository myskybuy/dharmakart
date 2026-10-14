import { NextRequest, NextResponse } from "next/server";
import { settleEasebuzzPayment } from "@/lib/easebuzz";

// Easebuzz POSTs the payment result here (surl/furl) from the customer's browser.
// It's a cross-site POST, so the session cookie isn't sent — the order is found via txnid.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const resp = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const base = (process.env.SITE_URL || req.nextUrl.origin).replace(/\/$/, "");

  const result = await settleEasebuzzPayment(resp).catch((err) => {
    console.error("Easebuzz callback error:", err);
    return null;
  });

  const target = new URL("/checkout", base);
  if (result?.ok && result.paid) {
    target.searchParams.set("payment", "success");
    target.searchParams.set("order", String(result.orderId));
  } else {
    target.searchParams.set("payment", "failed");
  }
  return NextResponse.redirect(target, 303);
}
