import nodemailer from "nodemailer";
import { orderCode } from "./order-code";
import { COMPANY } from "./policies";

const EMAIL_ENABLED = String(process.env.EMAIL_ENABLED || "false").toLowerCase() === "true";
const EMAIL_USER = process.env.EMAIL_USER || "";
const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD || "";

const transporter =
  EMAIL_ENABLED && EMAIL_USER && EMAIL_APP_PASSWORD
    ? nodemailer.createTransport({
        service: "gmail",
        auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD },
      })
    : null;

type OrderItem = { name: string; qty: number; salePrice: number };

type OrderEmail = {
  id: number;
  email: string;
  customerName: string;
  items: OrderItem[];
  total: number;
  paymentMethod: string;
  subtotal?: number;
  discount?: number;
  couponCode?: string;
  address?: string;
  phone?: string;
  /** Present for prepaid orders — renders the payment receipt section. */
  payment?: { paymentId: string; txnId: string; mode: string; paidAt: Date };
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatIST(date: Date) {
  return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST";
}

const cell = "padding:6px 0;";
const labelCell = `${cell}color:#6b7280;`;
const valueCell = `${cell}text-align:right;`;

function row(label: string, value: string, extra = "") {
  return `<tr><td style="${labelCell}">${label}</td><td style="${valueCell}${extra}">${value}</td></tr>`;
}

export async function sendOrderConfirmationEmail(order: OrderEmail) {
  if (!transporter || !order.email) return;

  const code = orderCode(order.id);
  const itemsHTML = order.items
    .map(
      (item) =>
        `<tr><td style="padding:8px 0;">${escapeHtml(item.name)} × ${item.qty}</td><td style="padding:8px 0; text-align:right;">₹${item.salePrice * item.qty}</td></tr>`
    )
    .join("");

  const subtotal = order.subtotal ?? order.items.reduce((sum, i) => sum + i.salePrice * i.qty, 0);
  const totalsHTML = [
    row("Subtotal", `₹${subtotal}`),
    order.discount ? row(`Coupon discount${order.couponCode ? ` (${escapeHtml(order.couponCode)})` : ""}`, `−₹${order.discount}`, "color:#b91c1c;") : "",
    `<tr><td style="padding:10px 0;border-top:1px solid #e5e7eb;font-size:17px;font-weight:700;">${order.payment ? "Amount paid" : "Total"}</td><td style="padding:10px 0;border-top:1px solid #e5e7eb;font-size:17px;font-weight:700;text-align:right;">₹${order.total}</td></tr>`,
  ].join("");

  const receiptHTML = order.payment
    ? `
        <h3 style="margin:24px 0 8px;color:#0d5c53;">Payment receipt</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          ${row("Status", "Paid ✅", "color:#15803d;font-weight:600;")}
          ${row("Amount", `₹${order.total}`)}
          ${row("Payment mode", escapeHtml(order.payment.mode))}
          ${row("Payment ID", escapeHtml(order.payment.paymentId))}
          ${row("Transaction ref", escapeHtml(order.payment.txnId))}
          ${row("Paid on", formatIST(order.payment.paidAt))}
        </table>`
    : "";

  const addressHTML = order.address
    ? `
        <h3 style="margin:24px 0 8px;color:#0d5c53;">Delivery address</h3>
        <p style="margin:0;font-size:14px;line-height:1.5;">${escapeHtml(order.customerName)}<br />${escapeHtml(order.address)}${order.phone ? `<br />Phone: ${escapeHtml(order.phone)}` : ""}</p>`
    : "";

  await transporter.sendMail({
    from: `"DharmaKart" <${EMAIL_USER}>`,
    to: order.email,
    subject: order.payment ? `Payment received · Order ${code} confirmed — DharmaKart` : `Order ${code} confirmed — DharmaKart`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827;">
        <h2 style="color:#0d5c53;">Your order successfully completed ✅</h2>
        <p>Hi ${escapeHtml(order.customerName)}, thanks for shopping at DharmaKart.</p>
        <p><strong>${code}</strong> · ${escapeHtml(order.paymentMethod)}</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">${itemsHTML}</table>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">${totalsHTML}</table>
        ${receiptHTML}
        ${addressHTML}
        <p style="margin-top:28px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;line-height:1.5;">
          ${COMPANY.brand} is operated by ${COMPANY.name}<br />
          ${COMPANY.address}<br />
          ${COMPANY.phone} · ${COMPANY.email}${order.payment ? "<br />This is a computer-generated receipt and does not require a signature." : ""}
        </p>
      </div>
    `,
  });
}

export function isEmailConfigured() {
  return Boolean(transporter);
}

export async function sendLoginOtpEmail(user: { name: string; email: string }, otp: string) {
  if (!transporter) return;

  await transporter.sendMail({
    from: `"DharmaKart" <${EMAIL_USER}>`,
    to: user.email,
    subject: "Your DharmaKart login OTP",
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;">
        <h2 style="color:#0d5c53;">Verify it's you</h2>
        <p>Hi ${user.name}, use the OTP below to complete your login to DharmaKart.</p>
        <p style="font-size:32px;font-weight:800;letter-spacing:6px;margin:20px 0;">${otp}</p>
        <p>This OTP is valid for 10 minutes. If you didn't try to log in, you can safely ignore this email.</p>
      </div>
    `,
  });
}

export async function sendWelcomeEmail(user: { name: string; email: string }) {
  if (!transporter) return;

  await transporter.sendMail({
    from: `"DharmaKart" <${EMAIL_USER}>`,
    to: user.email,
    subject: "Welcome to DharmaKart",
    html: `<p>Hi ${user.name}, your DharmaKart account is ready. Happy shopping!</p>`,
  });
}
