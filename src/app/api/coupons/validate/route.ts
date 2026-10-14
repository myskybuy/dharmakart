import { NextRequest, NextResponse } from "next/server";
import { evaluateCoupon } from "@/lib/coupons";

export async function POST(req: NextRequest) {
  const { code, orderTotal } = await req.json();
  const result = await evaluateCoupon(code, orderTotal);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({
    success: true,
    code: result.code,
    discount: result.discount,
    type: result.type,
    value: result.value,
  });
}
