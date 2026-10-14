import { NextRequest, NextResponse } from "next/server";
import { settleEasebuzzPayment } from "@/lib/easebuzz";

// Server-to-server notification from Easebuzz; covers customers who close the
// browser before being redirected back to surl/furl.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const resp = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));

  const result = await settleEasebuzzPayment(resp);
  if (!result.ok) {
    console.error("Easebuzz webhook rejected:", result.reason, resp.txnid);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
