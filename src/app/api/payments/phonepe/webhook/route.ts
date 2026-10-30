import { NextRequest, NextResponse } from "next/server";
import { orderIdFromMerchantOrderId, syncPhonePeOrder, verifyWebhookAuth } from "@/lib/phonepe";

// Server-to-server notification from PhonePe (configured on the PhonePe dashboard).
// The payload only tells us which order changed; its state is re-read from the API.
export async function POST(req: NextRequest) {
  if (!verifyWebhookAuth(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const merchantOrderId: string = body?.payload?.merchantOrderId || body?.payload?.originalMerchantOrderId || "";
  const orderId = orderIdFromMerchantOrderId(merchantOrderId);
  if (!orderId) return NextResponse.json({ ok: true, ignored: true });

  try {
    await syncPhonePeOrder(orderId);
  } catch (err) {
    console.error("PhonePe webhook sync error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
