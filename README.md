# DharmaKart — Next.js Store

Fashion, footwear & accessories ecommerce site. Same tech stack/structure as jonacart-next
(Next.js 16 + Prisma + PostgreSQL), rebranded UI and theme (blue/gold, matching dharmakart.in),
seeded with 130 real products (7 categories, multi-image support, size options) pulled from the
DharmaKart product export.

Stack: Next.js (App Router) + PostgreSQL + Prisma + iron-session auth + Razorpay (test mode) +
Cash on Delivery checkout + admin dashboard.

## Local setup (Windows/Mac/Linux)

**Prerequisites:** Node.js 20+, and either Docker Desktop (easiest) or a local PostgreSQL install.

### 1. Install dependencies
```bash
cd dharmakart-next
npm install
```

### 2. Start PostgreSQL
Easiest way — Docker (starts a Postgres container on port 5434):
```bash
docker compose up -d
```
No Docker? Install PostgreSQL locally and create a database called `dharmakart`, then edit
`DATABASE_URL` in `.env` to match your local connection string.

### 3. Push the schema + seed the database
```bash
npm run db:push
npm run db:seed
```
This creates all tables and loads the 7 categories + 130 products + starter coupons.

### 4. Run the dev server
```bash
npm run dev
```
Open **http://localhost:3000**

### Admin panel
Go to **http://localhost:3000/admin** — login with:
- Username: `admin`
- Password: `admin123`

(Change `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` before going live.)

## Production build
```bash
npm run build
npm start
```
Or with pm2 on a VPS/cPanel Node.js app:
```bash
npm run build
pm2 start npm --name dharmakart -- start
```

## What's inside
- `src/app` — pages (home, shop, product detail, cart, checkout, account, admin, policy pages)
- `src/components` — SiteHeader, SiteFooter, ProductCard, CartProvider, AuthModal
- `src/lib` — db (Prisma client), session (auth), email, razorpay, policies (company info + T&Cs)
- `prisma/schema.prisma` — Product / Category / Coupon / Banner / User / Order models
- `prisma/data/*.json` — seed data (products.json has 130 real DharmaKart products with up to
  3 images + size options each; categories.json has the 7 categories)
- `public/css/style.css` — the full theme (blue `#0B40E0` + gold `#E0A526`, matching the
  dharmakart.in screenshot)

## Notes
- Product images are hot-linked from `dharmakart.in` (as exported). For production, download
  and re-host them (e.g. on your own storage/CDN) so the new site doesn't depend on the old one.
- Email (OTP/order confirmation) is off by default (`EMAIL_ENABLED=false`) — turn it on and add
  a Gmail app password in `.env` to enable it.
- Razorpay keys are blank — add test/live keys in `.env` to enable online payment; Cash on
  Delivery works out of the box.
