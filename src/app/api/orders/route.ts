import { NextRequest, NextResponse } from "next/server";
import { evaluateCoupon } from "@/lib/coupons";
import { prisma } from "@/lib/db";
import { isHiddenCategory } from "@/lib/hidden-categories";
import { buildTxnId, initiatePayment, isEasebuzzConfigured } from "@/lib/easebuzz";
import { sendOrderConfirmationEmail } from "@/lib/email";
import { isValidEmail, isValidPhone, normalizePhone } from "@/lib/password";
import { getSession } from "@/lib/session";

type OrderItem = { id: number; name: string; image: string; salePrice: number; qty: number };

/** Re-prices the cart from the database so the client can't change what gets charged. */
async function priceCart(rawItems: OrderItem[], couponCode?: string) {
  const ids = rawItems.map((i) => Number(i.id));
  const products = await prisma.product.findMany({ where: { id: { in: ids } } });
  const byId = new Map(products.map((p) => [p.id, p]));

  const items: OrderItem[] = [];
  for (const raw of rawItems) {
    const product = byId.get(Number(raw.id));
    const qty = Math.floor(Number(raw.qty));
    if (!product || isHiddenCategory(product.category) || !(qty > 0)) return null;
    items.push({ id: product.id, name: product.name, image: product.image, salePrice: product.salePrice, qty });
  }

  const subtotal = items.reduce((sum, item) => sum + item.salePrice * item.qty, 0);
  let discount = 0;
  let appliedCode = "";
  if (couponCode) {
    const coupon = await evaluateCoupon(couponCode, subtotal);
    if (coupon.ok) {
      discount = coupon.discount;
      appliedCode = coupon.code;
    }
  }

  return { items, subtotal, discount, couponCode: appliedCode, total: Math.max(0, subtotal - discount) };
}

function siteUrl(req: NextRequest) {
  return (process.env.SITE_URL || req.nextUrl.origin).replace(/\/$/, "");
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Please log in to place an order" }, { status: 401 });
    }

    const body = await req.json();
    const { items, customerName, phone, address, email, couponCode, paymentMethod } = body;

    if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    if (!customerName?.trim() || !phone?.trim() || !address?.trim()) {
      return NextResponse.json({ error: "Customer details incomplete" }, { status: 400 });
    }
    if (!isValidPhone(phone)) {
      return NextResponse.json({ error: "Please enter a valid 10-digit Indian mobile number" }, { status: 400 });
    }
    if (email && !isValidEmail(email)) {
      return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
    }

    const priced = await priceCart(items, couponCode);
    if (!priced) {
      return NextResponse.json({ error: "Some items in your cart are no longer available" }, { status: 400 });
    }

    const method = paymentMethod === "EASEBUZZ" ? "EASEBUZZ" : "COD";
    const orderData = {
      userId: session.userId,
      items: priced.items,
      customerName: customerName.trim(),
      phone: normalizePhone(phone),
      address: address.trim(),
      email: (email || "").trim().toLowerCase(),
      subtotal: priced.subtotal,
      couponCode: priced.couponCode,
      discount: priced.discount,
      total: priced.total,
      paymentMethod: method,
      paymentStatus: "pending",
      status: "Pending",
    };

    if (method === "EASEBUZZ") {
      if (!isEasebuzzConfigured()) {
        return NextResponse.json({ error: "Online payment is not configured yet" }, { status: 503 });
      }
      if (!orderData.email) {
        return NextResponse.json({ error: "Email is required for online payment" }, { status: 400 });
      }
      if (priced.total < 1) {
        return NextResponse.json({ error: "Order total is too low for online payment. Please choose Cash on Delivery." }, { status: 400 });
      }

      const order = await prisma.order.create({ data: orderData });
      const txnid = buildTxnId(order.id);
      await prisma.order.update({ where: { id: order.id }, data: { easebuzzTxnId: txnid } });

      const callback = `${siteUrl(req)}/api/payments/easebuzz/callback`;
      try {
        const payUrl = await initiatePayment({
          txnid,
          amount: priced.total,
          productinfo: `DharmaKart order ${order.id}`,
          firstname: orderData.customerName,
          email: orderData.email,
          phone: orderData.phone,
          surl: callback,
          furl: callback,
          udf1: String(order.id),
        });
        return NextResponse.json({ success: true, orderId: order.id, payUrl });
      } catch (err) {
        await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "failed", status: "Cancelled" } });
        console.error("Easebuzz initiate failed:", err);
        return NextResponse.json({ error: "Unable to start online payment. Please try again." }, { status: 502 });
      }
    }

    const order = await prisma.order.create({ data: orderData });

    sendOrderConfirmationEmail({
      id: order.id,
      email: order.email,
      customerName: order.customerName,
      items: priced.items,
      total: order.total,
      subtotal: order.subtotal,
      discount: order.discount,
      couponCode: order.couponCode,
      address: order.address,
      phone: order.phone,
      paymentMethod: "Cash on Delivery",
    });

    return NextResponse.json({ success: true, orderId: order.id });
  } catch {
    return NextResponse.json({ error: "Unable to place order. Please try again." }, { status: 500 });
  }
}
