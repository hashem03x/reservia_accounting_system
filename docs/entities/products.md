# Entity: Products / Services

See [`../reversia-business-logic.md`](../reversia-business-logic.md) for the event-flow rationale
behind everything here.

## Schema (`backend/server/models/inventory/productModel.js`)

```text
type            "product" | "service"   default "product", required
title           { en, ar }              required (i18n)
description     { en, ar }              required (i18n)
cost            Number                  required only when type === "product"
price           Number                  required always (doubles as the service's selling price)
priceAfterDiscount Number|null
category        ObjectId ref Category   required only when type === "product"
subcategory     ObjectId ref SubCategory required only when type === "product"
durationValue   Number (min 1)          required only when type === "service"
durationUnit    "month"                 defaults to "month" when type === "service"
colors[]        embedded                product-only; always [] for a service
variants[]      ObjectId ref Variant    product-only; a service can NEVER have any (see below)
tags[]          String[]
isAvailable, isDeleted, totalSold, season, brand, createdBy, ratingsQuantity/Average - unchanged
```

## Business rules

1. **A product and a service are validated by one shared, pure function**:
   `backend/server/utils/productTypeValidation.js#validateProductTypeFields`. It is used by both
   `createProductValidator` and `updateProductValidator` (`utils/validators/productValidator.js`)
   so the two can never drift apart. Unit-tested directly in
   `server/test/productTypeValidation.test.js` (no DB needed).
2. **A service can never acquire inventory variants.** Enforced in three places, deliberately
   redundant because they cover different code paths:
   - `varaintController.js#createVariant`/`updateVariant` - rejects with a 400 before touching the
     database, for the variant-creation endpoint itself.
   - `productModel.js`'s `pre('save')` hook - rejects if a service is ever `.save()`d with a
     non-empty `variants` array (covers any future/internal code path that isn't the controller).
   - `productValidator.js`'s `updateProductValidator` - separately checks, on *update*, that
     converting an existing product (with variants already attached) to `type: 'service'` is
     rejected. This exists because `updateProduct` uses a raw `findByIdAndUpdate`, which does not
     run the `.save()` hook above - without this check, the model-level guard would be silently
     bypassed for updates specifically.
3. **The product type is effectively immutable after creation** in the UI (the frontend's type
   radio is disabled once `currentProduct` exists) - not because the backend flatly forbids
   switching type in every case (see #2 above: switching a *variant-free* product to `service` is
   technically allowed by the backend), but because there's no legitimate business reason to do so
   and it avoids UI confusion. If a future phase needs to relax this, the backend already has the
   correct guard in place.

## API

`backend/server/routes/inventory/productRoute.js` - unchanged endpoint list. `type`,
`durationValue`, `durationUnit` are additional fields on the existing `POST /products` / `PUT
/products/:id` bodies (multipart form, same as before - `type` is a plain string field, not JSON).

## Frontend

- `pages/admin/home/products/_components/product-handler/basic/_components/type-selection.tsx` -
  the Product/Service radio choice, first thing on the form, disabled once editing an existing
  product.
- `.../service-information.tsx` - duration value + unit, shown only for `type: 'service'`.
- `.../general-information.tsx` - the Cost field is hidden for a service.
- `.../categoreies-information.tsx` and `.../colors-information.tsx` - not rendered at all for a
  service (conditionally excluded in `basic/index.tsx`'s layout, not modified themselves).
- The **Variants tab is hidden entirely** for a service
  (`product-handler/index.tsx`'s `ProductHandlerBody`, which had to move `NavigationTabs` *inside*
  `ProductFormProvider` so the tab list can react to the live `type` value).
- Product list (`pages/admin/home/products/index.tsx`): a Type badge column (+ duration text for
  services); Cost/Quantity/Total-Cost/Season/Category/Subcategory columns show `-` for a service
  instead of blowing up on `undefined` fields.

## Known follow-up (not implemented, intentionally)

Services cannot appear in sales or purchase orders under the current schema - see
`../reversia-business-logic.md`'s "Open question for a future phase".
