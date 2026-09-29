# Entity: Customers

See [`../reversia-business-logic.md`](../reversia-business-logic.md) for the "Customer is a User"
rationale and the Customer Number concurrency design.

## Schema (fields added to `backend/server/models/userModel.js`)

```text
customerNumber  Number, unique, sparse, immutable   server-generated only, role: "user" only
taxInfo         { taxRegistrationNumber, commercialRegistrationNumber }
bankInfo        { bankName, branch, accountNumber, iban }
documents[]     { documentType, url, publicId, filename, mimeType, uploadedAt }
```

(`taxInfo`/`bankInfo` schemas are shared with Vendor - see
`backend/server/models/shared/businessPartnerSchemas.js`.)

## Customer Number

- Never sent by the client, never trusted even if sent - see
  `../reversia-business-logic.md`'s "Customer Number" section for the exact mechanism
  (`services/customer/customerNumberService.js`) and why it's safe under concurrency.
- Configurable range: `CUSTOMER_NUMBER_RANGE_START` / `CUSTOMER_NUMBER_RANGE_END` in
  `backend/.env.example` (seeds the `counters` collection the first time only).
- Frontend display: a read-only gray box (`Customer Number: <value>` or "Automatically generated"
  before the first save), in `components/global/customer-modal/index.tsx` - never an editable
  input, on either create or edit.

## Documents

Six fixed, optional PDF slots, shared with Vendor via
`components/global/business-documents-section/index.tsx`:

| Internal `documentType` | English | Arabic |
|---|---|---|
| `commercial_registration` | Commercial Registration | السجل التجاري |
| `tax_card` | Tax Card | البطاقة الضريبية |
| `electronic_invoice_registration` | Electronic Invoice Registration | شهادة تسجيل الفاتورة الإلكترونية |
| `vat_registration` | VAT Registration | شهادة تسجيل القيمة المضافة |
| `advance_payments_certificate` | Advance Payments Certificate | شهادة الدفعات المقدمة |
| `authorized_bank_details` | Authorized Bank Details | مستند معتمد ببيانات البنك |

Labels live only in `utils/constants/document-types.ts` - the database only ever stores the
internal key. Upload requires an existing customer `_id`, so the modal keeps itself open after a
successful create (rather than auto-closing, as it did before this phase) so documents can be
attached immediately without a separate edit step.

## API

```text
POST   /api/v1/customers/:id/documents              multipart: { documentType, document (PDF file) }
DELETE /api/v1/customers/:id/documents/:documentType
```

Both require `Resources.customers` / `Actions.update` permission. Uploading a `documentType` that
already exists on the customer **replaces** it (old Cloudinary asset destroyed first).

## Editing semantics

`updateCustomer` merges `taxInfo`/`bankInfo` field-by-field onto the existing subdocument rather
than replacing it wholesale - sending only `taxInfo.taxRegistrationNumber` in a PUT will never wipe
`taxInfo.commercialRegistrationNumber`. Documents are entirely separate endpoints, so the main
customer PUT can never accidentally drop an uploaded document.

## List/table

`pages/admin/home/customers/index.tsx` shows Customer Number, Name, Phone, Additional Phone, Email,
Type, Tax Info (registration number), Balance (admin-only), Address. Detailed bank info and
documents are only in the create/edit modal, per the "don't overload the table" requirement.
