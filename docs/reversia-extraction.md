# Reversia Extraction

How the standalone **Reversia Accounting System** (frontend + backend) was extracted from the
original **Leopard** e-commerce monorepo. This is an extraction/rebrand/cleanup record, not a
design doc for new functionality — module behavior, data model, and business logic were
deliberately left unchanged except where removing storefront/Shopify infrastructure required it.

Both repos are git repositories under `RESERVIA/backend` and `RESERVIA/frontend`. Each has a
`leopard-original-baseline` branch holding the complete, untouched original source, and a
`reversia-extraction` branch (checked out) holding the work described below across two commits
per repo (storefront extraction, then Shopify removal).

## 1. Original Leopard structure

**Backend** (`backend/`, Node/Express/Mongoose): a single app serving both the Leopard storefront
(public product browsing, cart, checkout, reviews, wishlist, coupons-at-checkout, hero/about-us
CMS content) and the accounting/admin dashboard (inventory, purchase orders, sales orders,
vendors, customers, expenses, cash/treasury, reports, users/roles, a Shopify sync integration).

**Frontend** (`frontend/`, React/Vite/TS/Tailwind/Mantine): one SPA with two halves under a
shared `App.tsx` route tree — a public storefront (`pages/public`, `pages/inner`, a shared
`layout-home` header/footer) and an admin dashboard (`pages/admin`) gated by role.

Both repos already used `accounting.dev.leopardegy.com`-style naming in places (e.g.
`backend/nginx.conf`), because the accounting dashboard was already effectively "the admin app"
inside a monorepo that also happened to run the storefront.

## 2. Extracted functionality (kept)

**Backend:** auth (login/logout/refresh/forgot-reset password/Google OAuth — shared by all
roles), users + role/permission management, categories/subcategories/brands, products + variants
+ images, warehouses + transfers + inventory movements, vendors + purchase orders + PO returns,
sales orders (cashier creation, deliver, cancel, confirm-COD, admin-side returns), customers,
expenses, cash/treasury + transactions, coupons, fixed assets, CSV/Excel import (products,
customers, vendors, purchase orders), all financial reports, database export + automated backup,
governorates, and the logo + barcode-sticker-print settings (mixed-purpose model, see §6).

**Frontend:** the entire `pages/admin/**` tree unchanged, shared admin shell
(`navigation-admin`, `layout-admin`), auth pages (login/forgot/verify/reset — shared by all
roles), a generic account page (`/profile`, now usable by any role, not just customers), all
shared UI/hooks/utils actually used by the dashboard.

## 3. Removed functionality (and why)

### Leopard storefront (first extraction pass)

| Removed | Reasoning |
|---|---|
| `pages/public/**` (home, categories, products, cart, wishlist, contact, terms, privacy) | Public storefront browsing/shopping - not used by any admin page |
| `pages/inner/{checkout,confirm-order,order-received,payment-status,orders}` | Gated to `roles.user` (customer) only in the original `App.tsx`; no admin dependency |
| `pages/outer/register` | Customer self-signup; admin users are created via the Users page, not this form |
| `pages/routes/layout-home.tsx` + `components/global/{navigation-home,footer,product-card,product-price,products-list,wishlist-button,guarantee-labels,add-address}` | Storefront chrome/marketing components, zero admin imports |
| Dead UI cluster: `components/ui/{table,tabs,card}.tsx`, `utils/helpers/{cn,class-merger}.ts` | Imported by nobody at all, even before this extraction |
| `context/CartContext.tsx`, `types/cart.d.ts`, `utils/helpers/cart-helpers.ts` | Storefront cart state; the only non-storefront reference (`useLogout.ts` clearing the cart) was stripped first |
| `hooks/{useCheckTransaction,useGovernoratesHelpers}.ts` | **Correction during review:** `useGovernoratesHelpers` was restored after discovering `useStringifyOnlineAddress` (used by the kept sales-order print/invoice views) depends on it |
| Backend: `reviewRoute/Controller/Model`, `wishlistRoute/Controller`, `addressRoute/Controller`, `cartRoute/Controller/Model`, `slidesRoute/Controller/Model`, `aiLookRoute/Controller` + `services/ai/**`, `paymentController.js` (dead), `paymob.serviec.js` + `server/paymob/**`, `discord-bot/**` | Storefront browsing/shopping/AI-outfit-generator/Paymob-checkout/Discord-order-bot, no admin dependency |
| Backend: customer self-registration (`authController.signup`), guest checkout, Paymob checkout session, storefront cart-merge-on-login logic | Storefront-only auth/checkout flows; `login`/`googleLogin` kept but stripped of their cart/wishlist-merge side effects |

**Correction made during review — the About/Customization model is mixed-purpose:** the backend's
`aboutUsAndSubcatModel.js` was initially deleted as "storefront About-Us content," but it also
stores the site **logo** (shown in the admin header/sidebar) and **barcode-sticker print
settings** (used by three admin barcode-printing components). It was restored in full — the data
model is unchanged — and only the *frontend UI* for the storefront-only fields (Title/Content/
Social Links, the Hero Section tab, the Subcategory-banners tab) was removed from the
Customization page. See `frontend/src/pages/admin/customization/`.

**Correction made during review — two admin sales-order actions were wrongly cut:** the initial
pass removed `cancelOrder`/`confirmCodOrder` from the old customer-facing controller entirely.
Both are actually called from the admin Sales Order detail page (`cancel-order-modal.tsx`,
`confirm-cod-modal.tsx`) to cancel/confirm *website* orders with real refund/return accounting
side effects. Restored into `salesOrderController.js` at `PUT /api/v1/sale-orders/:id/cancel` and
`/:id/confirm-cod` (frontend updated to match, dropping the old `/online/` path prefix).

### Shopify integration (second, follow-up pass)

Per explicit follow-up instruction, Reversia must not depend on Shopify at all. Removed:

- **Backend:** `server/config/shopifyConfig.js`; `server/services/integration/**` in full
  (bootstrap, Shopify REST client, order/product/refund import, inventory/collection sync, queue +
  worker, webhook registration/verification, event bus/handlers, mapping service, nightly sync);
  `server/models/integration/**` in full (sync-job/log, webhook-event, store-init-run,
  product-sync-run, processed-refund, and all four Shopify-entity mapping models);
  `shopifySyncController.js`/`shopifyWebhookController.js` + their routes; `verifyShopifyWebhook.js`
  middleware; the `server.js` bootstrap call and raw-body capture that existed only for webhook
  HMAC verification; three Shopify-only maintenance scripts and 13 Shopify-sync test files.
  `websiteOrderCreation.service.js` was also removed - its only caller was the deleted
  order-import pipeline.
- **Backend schema fields removed** (exclusively Shopify infrastructure, confirmed unused by any
  admin/accounting feature before deletion): `Product.handle/status/compareAtPrice/weight/
  weightUnit/metaTitle/metaDescription`, `Product`/`Variant` post-save Shopify event-emit hooks,
  `Variant.barcode`, `Warehouse.shopifyLocationId`, `User.shopifyCustomerId`,
  `SalesOrder.shopifyOrderId/shopifyOrderNumber/currency/financialStatus/fulfillmentStatus`, the
  `Resources.shopify` RBAC resource, and `utils/constants/warehouse.js` (its sole purpose was
  resolving a default warehouse for Shopify order import). The now-obsolete
  `fixSparseNullIndexes.js` migration script (which existed only to fix a bug in the
  since-removed `shopifyCustomerId`/`shopifyOrderId` sparse indexes) was deleted too.
- **Frontend:** the entire `pages/admin/shopify-sync/**` page, its nav entry and `App.tsx` route,
  the `resources.shopify` permission constant (and its entry in the permission-editor's
  allowed-actions map), the product list's Shopify-sync-status filter/badge/bulk-sync bar and its
  supporting components, and all now-broken `translations.pages.shopifySync` references.
- **Dependencies removed:** `axios` (backend — its only remaining importer was the deleted
  Shopify client).

**Kept as legacy/historical data, not active Shopify code:** the `SalesOrder.orderSource` enum
still allows `'shopify'`/`'website'` (alongside the only reachable value now, `'cashier'`), the
`PaymentMethods` list still allows `'shopify-payments'`, and the frontend's
`order-sources.ts`/`payment-methods.ts` still have matching labels. These are pure data labels on
**existing historical records** — removing them from the enum wouldn't delete any data but would
make old documents fail schema validation on any future re-save, and would make the admin UI
render blank/broken badges for old website/Shopify orders. No code path can create a *new* record
with these values anymore.

## 4. Frontend dependencies

The dashboard's frontend code depends on: shared layout/auth infra (`pages/routes/*`), all
`context/**` providers except the removed `CartContext`/`HeroContext`, all `hooks/**` except the
storefront-only ones removed, `utils/constants/{paths,roles,resources,colors}.ts` (pruned of
storefront/Shopify-only keys), `utils/helpers/**` except the storefront-only helpers removed, and
`components/{ui,icons,global/{logo,navigation-admin,customer-*,vendor-*,product-search,
variant-search-modal,import-button,order-status,order-payment-status}}`.

## 5. Backend dependencies

The accounting API surface (`/api/v1/{categories,subCategories,brands,products,users,auth,
coupons,governorates,about-us,transactions,analytics,role,vendors,warehouses,fixed-assets,
transfer,purchaseOrder,payment,variants,files,import,movements,sale-orders,customers,expenses,
reports,bahrain-db-health,database-export,admin/backup}`) depends on: `middleware/{errorMiddleware,
hasPermission,validatorMiddleware,fileUploadMiddleware,uploadImageMiddleware,saveFileMiddleware}`,
`database/dbConnection.js`, `backup/**`, and the full `models/**` tree minus the storefront-only
and Shopify-only models removed.

## 6. Authentication

Unchanged implementation: JWT access + refresh tokens in cookies, `authController.protect`
middleware, role-based `RoleGuard`/`ResourceGuard` on the frontend, `checkUserPermissions`
middleware on the backend. Login/logout/refresh/forgot-password/reset-password/Google OAuth are
shared by every role (admin/moderator/operator/customer) exactly as before. What changed:
`signup` (customer self-registration) was removed since there's no register page left to call
it, and `login`/`googleLogin` had their cart/wishlist-merge side effects stripped (dead code once
the cart/wishlist features were removed) - the actual credential-check/token-issuance logic is
untouched.

The app now opens at `/` → redirects into `/admin` (or `/login` if not authenticated, or
`/profile` if authenticated as a non-admin role) — see `frontend/src/App.tsx` and the
`AuthGuard`/`RoleGuard` redirect-target fixes in `pages/routes/{auth-gaurd,role-guard}.tsx` (both
previously pointed at `"/"`, the now-deleted storefront home route).

## 7. Database

No schema redesign. Models retained exactly as they were except for the Shopify-only field
removals listed in §3 and the storefront-only model deletions (`cartModel`, `reviewModel`,
`slidesModel`, `heroSectionModel`, `orderDetailsModel`, `discount.js` [dead code, zero requires
anywhere]). The About/Customization model kept its full schema (title/content/socialLinks/
homeSubcategories fields still exist in Mongo, just no longer editable from any UI) — see §3's
correction note.

## 8. Integrations required

None. After the Shopify-removal pass, Reversia has zero third-party integration dependencies
beyond Cloudinary (image storage) and SMTP (email). See `docs/environment-variables.md` for the
full variable list.

## 9. Environment variables

See `docs/environment-variables.md` for the complete audited reference (every variable, its
purpose, required/optional/secret classification, and exact source file) plus
`backend/.env.example` and `frontend/.env.example`.

## 10. Known Leopard references intentionally remaining

| Location | Reference | Why it stays |
|---|---|---|
| `backend/server/scripts/updateProductImages.js` | `leopardegy.com`, `leopard-live.products_1.json` | A one-off, already-run data-migration script that pulled product images from the *original* Leopard image CDN by name. Renaming the domain/filename would be factually wrong (that's genuinely where the data came from) and could break the script if ever re-run against archival data. Not part of the running app. |
| `backend/check-variants.js` | (rebranded default DB name) | One-off inventory-validation dev script; kept, just had its localhost DB-name default updated. |
| `SalesOrder.orderSource` enum, `PaymentMethods` list, frontend `order-sources.ts`/`payment-methods.ts` | `'website'`, `'shopify'`, `'shopify-payments'` values | Legacy data labels for historical records - see §3. |
| `backend/server/utils/appConstant.js` comment | mentions "Shopify" | Historical/contextual comment explaining *why* the `paymob-*`/`shopify-payments` payment-method values get special fee handling for old records; no live Shopify code. |

Everything else found by the full-project search in §11 was rebranded or removed.

## 11. Full Leopard/Shopify reference search results

**MUST REMOVE, and removed:** Leopard logo/favicon (`frontend/public/logo.png`), GitHub Pages
`CNAME` (`www.leopardegy.com`), hardcoded GTM/gtag/Meta Pixel tracking IDs and hardcoded PostHog
API key (real Leopard analytics accounts - see the Security review in
`docs/environment-variables.md`), page titles/meta descriptions, admin dashboard title ("Leopard
Accounting System" → "Reversia Accounting System"), app name string, package names
(`leopard`/`leopard-clothing-store` → `reversia-accounting-frontend`/`-backend`), pm2 process
names, nginx `server_name`, docker-compose image/container names, email "from" name and signoff,
stray unrelated root files (`backend/index.html` Google-sign-in test page with a hardcoded
`client_id`, `packages.microsoft.gpg`, `sample_products_with_colors.csv`, a stray Vite-hashed
`logo-*.jpg`), the entire Shopify integration (backend + frontend, see §3).

**SAFE / INTENTIONAL, left as-is:** everything listed in §10.

## Verification

See the final deliverable report for build/lint/test status. Summary: backend boots and mounts
its full route tree with zero Shopify credentials configured, all 6 remaining (non-Shopify) test
suites pass; frontend builds and type-checks cleanly. Lint on both sides carries pre-existing
warnings/errors from before this extraction (confirmed against the `leopard-original-baseline`
branch) - none introduced by this work.
