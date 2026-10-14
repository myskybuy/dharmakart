import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Please log in first" }, { status: 401 });

  const orders = await prisma.order.findMany({
    // Hide online orders whose payment never completed (abandoned or failed checkouts).
    where: { userId: session.userId, NOT: { paymentMethod: "EASEBUZZ", paymentStatus: { not: "paid" } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(orders);
}
