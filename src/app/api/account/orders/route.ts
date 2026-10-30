import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ONLINE_METHODS } from "@/lib/payments";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Please log in first" }, { status: 401 });

  const orders = await prisma.order.findMany({
    // Hide online orders whose payment never completed (abandoned or failed checkouts).
    where: { userId: session.userId, NOT: { paymentMethod: { in: ONLINE_METHODS }, paymentStatus: { not: "paid" } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(orders);
}
