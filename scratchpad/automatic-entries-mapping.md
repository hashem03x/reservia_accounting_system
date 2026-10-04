# AUTOMATIC ENTERIES.xlsx — Business Event → Journal Entry Mapping

Source: `AUTOMATIC ENTERIES.xlsx`, sheet "AUTOMATIC ENTERIES", 12 JV groups (JV001–JV0012), 37 data rows.
Cross-checked against the **already-imported, live** Chart of Accounts (66 accounts).

## ⚠️ Account code conflicts found (must be resolved before implementation)

| Code used in XLSX | XLSX intends it as | What it **actually is** in the live Chart of Accounts | Used in |
|---|---|---|---|
| `30000001` | "الموردين" (Suppliers control account) | **Accumulated Depreciation – Fixed Assets** (asset, PP&E group) | JV004, JV005, JV006, JV007, JV008, JV009 — 6 of the 12 JVs |
| `11000011` | "عملاء مشروعات" (Accounts Receivable – Projects) *in JV010/011/012* | **PUC – Engineering & Design** (WIP asset) — and the XLSX itself uses `11000011` *correctly* as PUC-Engineering in JV006! The sheet reuses the same code for two different accounts. | JV010, JV011, JV012 (wrong); JV006 (correct) |
| `40000001` | "إيرادات تنفيذ أعمال من المشروع" (Project Execution Revenue) | **Operating Expenses** (expense type) | JV0010 |

The real Chart of Accounts has the accounts the XLSX actually *means* at different codes:
- Real "Suppliers" → `31000001` (Suppliers – Construction Materials) — **JV003 already uses this code correctly**, so JV004–JV009 reusing `30000001` instead looks like a copy/paste typo in the source file, not a deliberate second supplier account.
- Real "Accounts Receivable – Projects" → `11000004` — exists, correctly named, unused anywhere in the XLSX.
- No account resembling "Project Execution Revenue" exists at all. The only Revenue-type account is `60000001` (Revenue), generic/undifferentiated.

I have **not** posted anything or touched these accounts. Per standing instructions this session ("do not invent account codes," "report conflicts rather than silently creating incorrect accounting mappings"), stopping here rather than guessing.

## Full mapping: Business Event → Accounting Action(s) → JE(s)

Amounts in the sheet are illustrative (and internally inconsistent in a few rows — e.g. JV004's debit `1,000` doesn't reconcile with its own running balance `200,000`; JV012's second line debit `120,000` vs. balance `100,000`). Treating the sheet as defining **structure** (which accounts, debit/credit, grouping), not literal production amounts — real amounts come from the actual PO/SO/Payment/AdvancedPayment documents at posting time, consistent with how VAT/Withholding were implemented last phase.

| # | JV | Business Event (existing Reservia concept) | Accounting Action | JE | Dr | Cr | Project? | Customer/Vendor | VAT/WHT | Idempotency key |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | JV001 | **AdvancedPayment created**, `type: 'customer'` | Record customer advance | `ADVANCE_PAYMENT_RECEIVED_CUSTOMER` | Cash/Bank (payment account) | Customer Advances Payable (`31000004`) | required (AdvancedPayment.project) | Customer | — | `sourceType=ADVANCED_PAYMENT, sourceId=<AdvancedPayment._id>, accountingAction=ADVANCE_PAYMENT_RECEIVED_CUSTOMER` |
| 2 | JV002 | **AdvancedPayment created**, `type: 'vendor'` | Record vendor advance | `ADVANCE_PAYMENT_PAID_VENDOR` | Advance to Suppliers (`11000006`) | Cash/Bank | optional | Vendor | — | `sourceType=ADVANCED_PAYMENT, sourceId=<id>, accountingAction=ADVANCE_PAYMENT_PAID_VENDOR` |
| 3a | JV003 (part A) | **PurchaseOrder created**, item `type:'product'` | Receive physical inventory | `PO_INVENTORY_RECEIPT` | Inventory; Input VAT (`11000017`) | Suppliers (`31000001`); Withholding Tax Payable (`31000012`) | n/a | Vendor | both | `sourceType=PO, sourceId=<PO._id>, accountingAction=PO_INVENTORY_RECEIPT` |
| 3b | JV003 (part B) | same PurchaseOrder, **only if `PO.project` is set** | Transfer received stock into the project's WIP | `PO_INVENTORY_TO_WIP` | WIP – Raw Materials (`11000009`) | Inventory | **required** | — | — | `sourceType=PO, sourceId=<PO._id>, accountingAction=PO_INVENTORY_TO_WIP` |
| 4 | JV004 | **PO payment via vendor AdvancedPayment** (not yet implemented — PurchaseOrder.paymentMethod only supports `'account'` today) | Apply vendor advance against supplier payable | `PO_SUPPLIER_ADVANCE_APPLIED` | Suppliers (`31000001`, not `30000001`) | Advance to Suppliers (`11000006`) | n/a | Vendor | — | `sourceType=PO, sourceId=<PO._id>, accountingAction=PO_SUPPLIER_ADVANCE_APPLIED` |
| 5 | JV005 | **Payment created**, `paymentCategory:'purchase'`, via `paymentAccount` | Pay supplier from bank/cash | `PO_PAYMENT_RECORDED` | Suppliers (`31000001`) | Cash/Bank (Payment.paymentAccount) | n/a | Vendor | — | `sourceType=PAYMENT, sourceId=<Payment._id>, accountingAction=PO_PAYMENT_RECORDED` |
| 6 | JV006 | **PurchaseOrder created**, item `type:'service'` (e.g. Engineering), `PO.project` set | Post service cost straight to WIP (no inventory step — services aren't stocked) | `PO_SERVICE_TO_WIP` | WIP – Engineering & Design (`11000011`) *(sub-account depends on service category)* | Suppliers (`31000001`) | required | Vendor | — | `sourceType=PO, sourceId=<PO._id>, accountingAction=PO_SERVICE_TO_WIP` |
| 7 | JV007 | Payment for JV006's PO | same as #5 | `PO_PAYMENT_RECORDED` | Suppliers | Cash/Bank | n/a | Vendor | — | same pattern |
| 8 | JV008 | Same as JV006, Labour service | `PO_SERVICE_TO_WIP` | WIP – Labour Wages (`11000010`) | Suppliers | required | Vendor | — | same |
| 9 | JV009 | Payment for JV008's PO | `PO_PAYMENT_RECORDED` | — | — | n/a | Vendor | — | same |
| 10 | JV0010 | **? Project billing / revenue recognition at % complete** — no existing Reservia action currently triggers this (see Q1) | Recognize contract revenue for executed portion | `PROJECT_REVENUE_RECOGNITION` | Accounts Receivable – Projects (`11000004`, not `11000011`); WHT Receivable (`11000019`) | VAT Payable (`31000010`); Revenue (account TBD, not `40000001`) | **required** | Customer | both | `sourceType=PROJECT, sourceId=<Project._id>, accountingAction=PROJECT_REVENUE_RECOGNITION, sourceEvent=<period/executedPercentage-change id>` |
| 11 | JV0011 | **? Proportional cost recognition at % complete** — direction is ambiguous (see Q2) | Charge project with costs for executed portion | `PROJECT_COST_RECOGNITION` | *(direction unclear)* | *(direction unclear)* | required | — | — | `sourceType=PROJECT, sourceId=<Project._id>, accountingAction=PROJECT_COST_RECOGNITION, sourceEvent=<...>` |
| 12a | JV0012 (part A) | **SalesOrder created with `paymentMethod:'advanced_payment'`** (existing feature) | Apply customer advance against AR | `SO_CUSTOMER_ADVANCE_APPLIED` | Customer Advances Payable (`31000004`) | Accounts Receivable – Projects (`11000004`) | required | Customer | — | `sourceType=SO, sourceId=<SO._id>, accountingAction=SO_CUSTOMER_ADVANCE_APPLIED` |
| 12b | JV0012 (part B) | **Payment created**, `paymentCategory:'sales'`, via `paymentAccount` | Collect remaining cash from customer | `SO_PAYMENT_RECORDED` | Cash/Bank | Accounts Receivable – Projects (`11000004`) | n/a | Customer | — | `sourceType=PAYMENT, sourceId=<Payment._id>, accountingAction=SO_PAYMENT_RECORDED` |

## Key architectural confirmation

The multi-JE requirement maps cleanly onto the **existing** `JournalEntry` schema with no field renames:
- Each row above → one `JournalEntry` document, its own `entryNumber` via the existing `getNextJournalEntryNumber()` counter (never `JV00x`).
- `JournalEntry.lines[].project` / `.projectNumber` already exist — WIP/AR postings get tagged per-project without any new sub-account scheme.
- Idempotency: the existing partial unique index is `{sourceType, sourceId}` — too coarse, exactly as flagged. Plan: widen it to `{sourceType, sourceId, accountingAction}` so JV003's two JEs (and JV012's two JEs) can coexist under the same `sourceId` without colliding, while still blocking a genuine duplicate of the *same* action.
