import { NextRequest, NextResponse } from "next/server";
import { syncPhonePeOrder } from "@/lib/phonepe";

// PhonePe sends the customer back here after the payment page. The redirect carries
// no trusted status, so the order is confirmed with the Order Status API.
async function handle(req: NextRequest) {
  const orderId = Number(req.nextUrl.searchParams.get("order"));
  const base = (process.env.SITE_URL || req.nextUrl.origin).replace(/\/$/, "");

  const state = orderId
    ? await syncPhonePeOrder(orderId).catch((err) => {
        console.error("PhonePe return sync error:", err);
        return "PENDING" as const;
      })
    : null;

  const target = new URL("/checkout", base);
  if (state === "COMPLETED") {
    target.searchParams.set("payment", "success");
    target.searchParams.set("order", String(orderId));
  } else if (state === "PENDING") {
    target.searchParams.set("payment", "pending");
    target.searchParams.set("order", String(orderId));
  } else {
    target.searchParams.set("payment", "failed");
  }
  return NextResponse.redirect(target, 303);
}

export const GET = handle;
export const POST = handle;
