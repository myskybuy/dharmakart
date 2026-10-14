import { prisma } from "./db";

type CouponResult = { ok: true; code: string; discount: number; type: string; value: number } | { ok: false; error: string; status: number };

export async function evaluateCoupon(code: string, orderTotal: number): Promise<CouponResult> {
  const coupon = await prisma.coupon.findFirst({
    where: { code: (code || "").toUpperCase(), active: true },
  });

  if (!coupon) return { ok: false, error: "Invalid or inactive coupon code", status: 404 };
  if (coupon.expiry && coupon.expiry < new Date()) {
    return { ok: false, error: "This coupon has expired", status: 400 };
  }
  if (orderTotal < coupon.minOrder) {
    return { ok: false, error: `Minimum order of ₹${coupon.minOrder} required`, status: 400 };
  }

  const discount =
    coupon.type === "percent" ? Math.round((orderTotal * coupon.value) / 100) : coupon.value;

  return { ok: true, code: coupon.code, discount, type: coupon.type, value: coupon.value };
}
