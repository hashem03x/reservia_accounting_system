# Entity: Vendors

See [`../reversia-business-logic.md`](../reversia-business-logic.md) for the pre-existing
`bankInfo` gap this phase fixed.

## Schema (fields added to `backend/server/models/vendor/vendor.js`)

```text
taxInfo     { taxRegistrationNumber, commercialRegistrationNumber }
bankInfo    { bankName, branch, accountNumber, iban }
documents[] { documentType, url, publicId, filename, mimeType, uploadedAt }
```

Shared sub-schemas with Customer - see `backend/server/models/shared/businessPartnerSchemas.js`.
**No vendor-number field was added** - this phase's requirement was specifically for a Customer
Number; the existing Vendor model has no number/code concept and none was invented (see
`../reversia-roadmap.md`'s architectural principles on avoiding scope creep).

## The pre-existing `bankInfo` bug this phase fixed

`components/global/vendor-modal/index.tsx` already had a "Bank Info" section and captured
`bankName`/`branchName`/`accountNumber`/`iban` into component state **before this phase started**,
but two independent bugs meant none of it was ever actually persisted:

1. The backend `Vendor` schema had no `bankInfo` field at all - Mongoose's default strict mode
   silently dropped it from every `create`/`update` call.
2. The frontend's submit handler never even included `bankInfo` in the request body in the first
   place.

Both are fixed now: the schema field exists (renamed `branchName` → `branch` to match this phase's
literal field-name requirement, since the old field never worked anyway - there was no persisted
data to preserve compatibility with), and the payload actually sends it.

## Documents

Identical six-slot PDF setup as Customer - see [`customers.md`](customers.md)'s table, shared via
the same `BusinessDocumentsSection` component (`entityType="vendors"`).

## API

```text
POST   /api/v1/vendors/:id/documents              multipart: { documentType, document (PDF file) }
DELETE /api/v1/vendors/:id/documents/:documentType
```

Requires `vendors` / `update` permission. Same replace-on-re-upload semantics as Customer.

## Validator fix

`utils/validators/vendorValidators.js`'s `updateVendorValidators` chain was missing
`validatorMiddleware` entirely - every `check()` rule in that chain (email format, phone format)
was silently never enforced, since nothing converted the validation result into an actual error
response. Added, since "backend validation is mandatory" applies here too - this is a genuine
pre-existing gap, not new-in-this-phase behavior being introduced.

## List/table

`pages/admin/home/vendors/index.tsx` shows Name, Phone, Email, Type, Tax Info (registration
number), Balance (admin-only), Address. Bank info and documents remain detail/edit-view only.
