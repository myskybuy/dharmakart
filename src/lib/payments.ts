import type { Order, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { sendOrderConfirmationEmail } from "./email";

/** Online payment methods, as stored in `Order.paymentMethod`. */
export const ONLINE_METHODS = ["PHONEPE", "EASEBUZZ"];

/**
 * Marks an online order paid. Idempotent: the confirmation email goes out only on
 * the first transition to paid, so browser return and webhook can both call this.
 */
export async function markOrderPaid(
  order: Order,
  payment: { paymentId: string; txnRef: string; mode: string; extra?: Prisma.OrderUpdateManyMutationInput }
) {
  const paidAt = new Date();
  const updated = await prisma.order.updateMany({
    where: { id: order.id, paymentStatus: { not: "paid" } },
    data: { ...payment.extra, paymentStatus: "paid", status: "Confirmed", paymentMode: payment.mode, paidAt },
  });
  if (updated.count !== 1) return;

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
    paymentMethod: `Paid online · ${payment.mode}`,
    payment: { paymentId: payment.paymentId || "—", txnId: payment.txnRef, mode: payment.mode, paidAt },
  });
}

/** Marks a still-pending online order as failed; never touches an order that got paid. */
export async function markOrderFailed(orderId: number, extra?: Prisma.OrderUpdateManyMutationInput) {
  await prisma.order.updateMany({
    where: { id: orderId, paymentStatus: "pending" },
    data: { ...extra, paymentStatus: "failed", status: "Cancelled" },
  });
}
