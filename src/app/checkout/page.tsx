"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import AuthModal from "@/components/AuthModal";
import PageLoader from "@/components/PageLoader";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import StoreShell from "@/components/StoreShell";
import { useCart } from "@/components/CartProvider";
import { orderCode } from "@/lib/order-code";
import { toast } from "sonner";

type User = { id: number; name: string; email: string; phone?: string };

function formatSavedAddress(a: {
  line1: string;
  city: string;
  state: string;
  pincode: string;
}) {
  return `${a.line1}, ${a.city}, ${a.state} - ${a.pincode}`;
}

export default function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Easebuzz returns here via /api/payments/easebuzz/callback with ?payment=success|failed
  const { payment, order } = use(searchParams);
  const paidOrderId = payment === "success" && order ? Number(order) : null;
  const { cart, cartTotal, clearCart, hydrated } = useCart();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [coupon, setCoupon] = useState("");
  const [couponMsg, setCouponMsg] = useState("");
  const [discount, setDiscount] = useState(0);
  const [appliedCode, setAppliedCode] = useState("");
  const [successId, setSuccessId] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"COD" | "EASEBUZZ">("EASEBUZZ");
  const [placing, setPlacing] = useState(false);

  // Wait for the cart to hydrate from storage, otherwise clearCart gets overwritten.
  useEffect(() => {
    if (!hydrated || !payment) return;
    if (paidOrderId) clearCart();
    else toast.error("Payment failed or was cancelled. Your cart is saved — please try again.");
  }, [hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(async (d) => {
        if (d.user) {
          setUser(d.user);
          setName(d.user.name || "");
          setEmail(d.user.email || "");
          if (d.user.phone) setPhone(d.user.phone);
          const addrRes = await fetch("/api/account/addresses");
          const addrs = await addrRes.json();
          if (Array.isArray(addrs) && addrs.length) {
            const def = addrs.find((a: { isDefault: boolean }) => a.isDefault) || addrs[0];
            if (def) {
              if (!d.user.phone && def.phone) setPhone(def.phone);
              setAddress(formatSavedAddress(def));
            }
          }
        }
      })
      .finally(() => setAuthChecked(true));
  }, []);

  const subtotal = cartTotal;
  const total = Math.max(0, subtotal - discount);
  const showAuthModal = authChecked && !user;

  async function applyCoupon() {
    setCouponMsg("");
    const res = await fetch("/api/coupons/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: coupon, orderTotal: subtotal }),
    });
    const data = await res.json();
    if (data.success) {
      setDiscount(data.discount);
      setAppliedCode(data.code);
      setCouponMsg(`Coupon applied: -₹${data.discount}`);
    } else {
      setDiscount(0);
      setAppliedCode("");
      setCouponMsg(data.error || "Invalid coupon");
    }
  }

  async function placeOrder() {
    if (!user) return;
    if (!cart.length) {
      toast.error("Cart is empty");
      return;
    }
    if (!name || !phone || !address) {
      toast.error("Please fill all required fields");
      return;
    }
    if (paymentMethod === "EASEBUZZ" && !email) {
      toast.error("Please enter your email for online payment");
      return;
    }
    if (placing) return;

    const payload = {
      items: cart,
      customerName: name,
      phone,
      address,
      email,
      couponCode: appliedCode,
      paymentMethod,
    };

    setPlacing(true);
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setPlacing(false);
      toast.error(data.error || "Order failed");
      return;
    }

    if (paymentMethod === "EASEBUZZ" && data.payUrl) {
      // Cart is cleared only after Easebuzz confirms payment and redirects back.
      window.location.href = data.payUrl;
      return;
    }

    setPlacing(false);
    clearCart();
    setSuccessId(data.orderId);
  }

  const confirmedId = successId ?? paidOrderId;
  if (confirmedId) {
    return (
      <StoreShell>
        <SiteHeader showSearch={false} />
        <div className="cart-page" style={{ textAlign: "center", padding: "40px 0" }}>
          <h2 style={{ color: "var(--color-primary)" }}>Your order is successfully completed</h2>
          <p>
            Your order id is <strong>{orderCode(confirmedId)}</strong>. We&apos;ve emailed you a confirmation.
          </p>
          <Link href="/shop" className="btn btn-accent">
            Continue shopping
          </Link>
        </div>
        <SiteFooter />
      </StoreShell>
    );
  }

  return (
    <StoreShell>
      <SiteHeader showSearch={false} />
      <AuthModal
        open={showAuthModal}
        title="Login to checkout"
        message="You must be logged in before placing an order. Sign in or create an account below."
        onSuccess={async (u) => {
          setUser(u);
          setName(u.name || "");
          setEmail(u.email || "");
          if (u.phone) setPhone(u.phone);
          const addrs = await fetch("/api/account/addresses").then((r) => r.json());
          if (Array.isArray(addrs) && addrs.length) {
            const def = addrs.find((a: { isDefault: boolean }) => a.isDefault) || addrs[0];
            if (def) {
              if (!u.phone && def.phone) setPhone(def.phone);
              setAddress(formatSavedAddress(def));
            }
          }
        }}
      />

      <div className={`cart-page ${showAuthModal ? "checkout-locked" : ""}`}>
        <h2>Checkout</h2>
        <p style={{ color: "var(--color-muted)" }}>
          Cash on Delivery or online payment. Order confirmation will be emailed to you.
        </p>

        {!cart.length ? (
          <p>
            Cart empty. <Link href="/shop">Shop now →</Link>
          </p>
        ) : user ? (
          <>
            <div className="form-group">
              <label>Full name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div className="form-group">
              <label>Phone number</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile number" />
            </div>
            <div className="form-group">
              <label>Email (order confirmation yahan aayega)</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="form-group">
              <label>Delivery address</label>
              <textarea value={address} rows={3} onChange={(e) => setAddress(e.target.value)} placeholder="House no, street, city, state, pincode" />
            </div>

            <div className="cart-summary" style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>Have a coupon code?</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={coupon}
                  onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                  placeholder="Enter coupon code"
                  style={{ flex: 1, padding: "11px 14px", border: "1px solid var(--color-border)", borderRadius: 8, textTransform: "uppercase" }}
                />
                <button className="btn btn-outline" style={{ border: "1px solid var(--color-primary)", color: "var(--color-primary)", whiteSpace: "nowrap" }} onClick={applyCoupon}>
                  Apply
                </button>
              </div>
              {couponMsg ? <p style={{ fontSize: 13, margin: "8px 0 0" }}>{couponMsg}</p> : null}
            </div>

            <div className="cart-summary">
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 8 }}>
                <span>Subtotal</span>
                <span>₹{subtotal}</span>
              </div>
              {discount > 0 ? (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 8, color: "var(--color-sale)" }}>
                  <span>Coupon discount</span>
                  <span>-₹{discount}</span>
                </div>
              ) : null}
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 17, marginBottom: 10, borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
                <span>Total</span>
                <span>₹{total}</span>
              </div>
              <div className="payment-options" role="radiogroup" aria-label="Payment method">
                <div className="payment-options-title">Payment method</div>
                <div className="payment-options-grid">
                  <label className={`payment-option ${paymentMethod === "EASEBUZZ" ? "is-selected" : ""}`}>
                    <input type="radio" name="pay" checked={paymentMethod === "EASEBUZZ"} onChange={() => setPaymentMethod("EASEBUZZ")} />
                    <span className="payment-option-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 9.5h19M6.5 15h4" /></svg>
                    </span>
                    <span className="payment-option-body">
                      <span className="payment-option-head">
                        <strong>Pay online</strong>
                        <span className="payment-option-badge">Instant confirmation</span>
                      </span>
                      <small>UPI, cards, netbanking &amp; wallets</small>
                      <span className="payment-option-chips">
                        <span>UPI</span><span>Cards</span><span>Netbanking</span><span>Wallets</span>
                      </span>
                    </span>
                  </label>
                  <label className={`payment-option ${paymentMethod === "COD" ? "is-selected" : ""}`}>
                    <input type="radio" name="pay" checked={paymentMethod === "COD"} onChange={() => setPaymentMethod("COD")} />
                    <span className="payment-option-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M6 9.5v5M18 9.5v5" /></svg>
                    </span>
                    <span className="payment-option-body">
                      <span className="payment-option-head">
                        <strong>Cash on Delivery</strong>
                      </span>
                      <small>Pay in cash or UPI when your order arrives</small>
                    </span>
                  </label>
                </div>
              </div>
            </div>

            <button className="btn btn-accent checkout-pay-btn" onClick={placeOrder} disabled={placing}>
              {placing ? (
                "Please wait…"
              ) : paymentMethod === "EASEBUZZ" ? (
                <>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></svg>
                  Pay ₹{total} securely
                </>
              ) : (
                `Place order · ₹${total} on delivery`
              )}
            </button>
            {paymentMethod === "EASEBUZZ" ? (
              <p className="checkout-pay-note">You&apos;ll be redirected to Easebuzz to complete the payment securely.</p>
            ) : null}
          </>
        ) : authChecked ? (
          <p style={{ color: "var(--color-muted)" }}>Complete login in the popup above to continue checkout.</p>
        ) : (
          <PageLoader message="Loading checkout…" />
        )}
      </div>
      <SiteFooter />
    </StoreShell>
  );
}
