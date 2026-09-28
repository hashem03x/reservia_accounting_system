# Reversia Accounting System — Frontend

The frontend for **Reversia**, an internal accounting/inventory dashboard extracted from the
original Leopard e-commerce platform's admin panel. Built with React, TypeScript, Vite, Tailwind
CSS, and Mantine UI. Supports English/Arabic.

This app is admin-only: there is no public storefront. The root route leads straight into
login/authentication and then the accounting dashboard.

## Modules

Inventory (products, variants, warehouses, transfers), sales orders, purchase orders, vendors,
customers, expenses, cash/treasury, coupons, fixed assets, users & role-based permissions,
analytics, and a full set of financial reports (income statement, balance sheet, profit
breakdowns, inventory summaries, and more).

## Getting started

```bash
npm install
cp .env.example .env   # fill in VITE_API_URL and VITE_ABOUT_ID at minimum
npm run dev
```

See [.env.example](.env.example) for every environment variable this app reads, and
[../docs/environment-variables.md](../docs/environment-variables.md) for the full audit
(frontend + backend).

## Scripts

- `npm run dev` — start the Vite dev server
- `npm run build` — type-check (`tsc -b`) and build for production
- `npm run lint` — ESLint
- `npm run preview` — preview a production build locally

## Provenance

This app was extracted from the Leopard storefront/admin monorepo's admin panel. See
[../docs/reversia-extraction.md](../docs/reversia-extraction.md) for what was kept, what was
removed (storefront pages, Shopify integration UI, marketing/analytics scripts), and why.
