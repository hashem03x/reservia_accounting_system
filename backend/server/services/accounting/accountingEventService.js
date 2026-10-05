const crypto = require('crypto');
const mongoose = require('mongoose');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const { getNextJournalEntryNumber } = require('./journalEntryNumberService');
const { AutomaticJournalAccountCodes, CogsToWipAccountCodeMap, AccountingModuleByAction } = require('../../utils/accountingConstants');
const ApiError = require('../../utils/apiError');

// The automatic accounting engine - see docs/entities/automatic-accounting.md and
// scratchpad/automatic-entries-mapping.md for the full Business Event -> Accounting Action -> JE
// mapping this file implements (derived from "AUTOMATIC ENTERIES.xlsx"). One business event (a
// Purchase/Sales Order, an Advanced Payment, a Payment, a Project) can legitimately produce MORE
// THAN ONE JournalEntry - each accounting action below posts its own independent entry, never
// merged, each independently idempotent via (sourceType, sourceId, accountingAction).

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

// Resolves a well-known account code (AutomaticJournalAccountCodes) to its live ChartOfAccount id.
// Throws loudly (never fabricates/guesses an id) if the account is missing from the live Chart of
// Accounts - a missing control account is a configuration problem that must stop the posting, not
// a reason to silently skip half of a transaction.
// A deterministic, stable ObjectId derived from a string seed - used as `sourceId` for accounting
// actions that don't have a natural single source document to key off of (PROJECT_REVENUE_
// RECOGNITION/PROJECT_COST_RECOGNITION can legitimately fire more than once over a project's
// lifetime, once per executedPercentage increase - a plain `project._id` as sourceId would let only
// the FIRST ever recognition through, silently no-op on every later one, since the idempotency
// index is unique per (sourceType, sourceId, accountingAction)). Hashing in the target percentage
// makes each distinct recognition event its own idempotency key - re-processing the SAME target
// percentage is still correctly blocked as a duplicate, while a later, higher percentage gets its
// own new key. `project` field on JournalEntry (unaffected by this) remains the real relational
// link for "all journal entries for this project" queries.
function deterministicSourceId(seed) {
  return new mongoose.Types.ObjectId(crypto.createHash('md5').update(seed).digest().subarray(0, 12));
}

async function getAccountIdByCode(code, session) {
  const account = await ChartOfAccount.findOne({ code }).session(session || null);
  if (!account) {
    throw new ApiError(`Automatic accounting: required Chart of Accounts account "${code}" was not found. Posting aborted.`, 500);
  }
  return account._id;
}

// Resolves a Vendor/Customer reference (raw id OR an already-populated object - every caller here
// normalizes via `?._id || ref` first, mirroring generalLedgerService.js's established `idOf()`
// pattern) down to that party's real Vendor Number / Customer Number, for stamping onto the one JE
// line that represents that party's control account (docs section "Sub Account behavior").
//
// `required: true` (the default) throws a clear ApiError - never silently creates an incorrect JE
// with a missing/blank Sub Account - when:
//   - no reference was given at all (the business document has no vendor/customer), or
//   - the referenced Vendor/Customer document no longer exists, or
//   - it exists but has no number assigned (a legacy record predating the auto-numbering feature).
// `required: false` is for the one flow where the party relationship is genuinely optional at the
// business-document level (Project.customer, for PROJECT_REVENUE_RECOGNITION) - there, a missing
// reference is not an error, just "no Sub Account for this entry", matching existing behavior.
async function resolveVendorNumber(vendorRef, { required = true } = {}, session) {
  const Vendor = require('../../models/vendor/vendor'); // eslint-disable-line global-require
  const vendorId = vendorRef?._id || vendorRef;
  if (!vendorId) {
    if (required) throw new ApiError('The vendor for this automatic journal entry is missing or invalid.', 400);
    return null;
  }
  const vendor = await Vendor.findById(vendorId).select('vendorNumber name').session(session || null);
  if (!vendor) {
    if (required) throw new ApiError('The vendor for this automatic journal entry does not exist.', 400);
    return null;
  }
  if (vendor.vendorNumber == null) {
    throw new ApiError(`The vendor "${vendor.name}" does not have a valid Vendor Number.`, 400);
  }
  return vendor.vendorNumber;
}

async function resolveCustomerNumber(customerRef, { required = true } = {}, session) {
  const User = require('../../models/userModel'); // eslint-disable-line global-require
  const customerId = customerRef?._id || customerRef;
  if (!customerId) {
    if (required) throw new ApiError('The customer for this automatic journal entry is missing or invalid.', 400);
    return null;
  }
  const customer = await User.findById(customerId).select('customerNumber name').session(session || null);
  if (!customer) {
    if (required) throw new ApiError('The customer for this automatic journal entry does not exist.', 400);
    return null;
  }
  if (customer.customerNumber == null) {
    throw new ApiError(`The customer "${customer.name}" does not have a valid Customer Number.`, 400);
  }
  return customer.customerNumber;
}

/**
 * Idempotently posts ONE automatic JournalEntry for a given accounting action. Safe to call
 * repeatedly for the same (sourceType, sourceId, accountingAction) triple - returns the already-
 * existing entry without creating a duplicate (the idempotency check and the create below both run
 * inside the caller's session, so this participates correctly in the same transaction as the rest
 * of the business operation - see journalEntryModel.js's compound unique index, which is the real
 * backstop against a race duplicating this under concurrent requests).
 */
async function postAutomaticJournalEntry({ accountingAction, sourceType, sourceId, date, description, project, lines, session }) {
  const existing = await JournalEntry.findOne({ sourceType, sourceId, accountingAction }).session(session || null);
  if (existing) return existing;

  const entryNumber = await getNextJournalEntryNumber(session);
  const [entry] = await JournalEntry.create(
    [
      {
        entryNumber,
        date: date || new Date(),
        description,
        source: 'automatic',
        // Normalized through the one accountingAction -> Module map (docs section "Module field") -
        // never a free-text/inconsistently-cased variation (see accountingConstants.js).
        module: AccountingModuleByAction[accountingAction] || null,
        sourceType,
        sourceId,
        accountingAction,
        project: project || null,
        status: 'posted',
        lines,
      },
    ],
    { session }
  );
  return entry;
}

// ---------------------------------------------------------------------------
// 1-2. Advanced Payments (JV001/JV002)
// ---------------------------------------------------------------------------

/**
 * ADVANCE_PAYMENT_RECEIVED_CUSTOMER (JV001): Dr Cash/Bank (the advance's own paymentAccount),
 * Cr Customer Advances Payable. No-ops (returns null) if the advance has no paymentAccount set -
 * legacy advances created before that field existed never trigger an automatic entry.
 */
async function postAdvancePaymentReceivedCustomerJE(advancedPayment, session) {
  if (!advancedPayment.paymentAccount) return null;
  const paymentAccountId = advancedPayment.paymentAccount?._id || advancedPayment.paymentAccount;
  const projectId = advancedPayment.project?._id || advancedPayment.project || null;

  // A customer AdvancedPayment always has a customer (schema-required for type: 'customer') - the
  // real Customer Number must be resolvable, or this fails safely rather than posting a Sub
  // Account-less entry (docs section "Do not hardcode Vendor/Customer numbers").
  const customerNumber = await resolveCustomerNumber(advancedPayment.customer, { required: true }, session);
  const customerAdvancesPayableId = await getAccountIdByCode(AutomaticJournalAccountCodes.customerAdvancesPayable, session);

  return postAutomaticJournalEntry({
    accountingAction: 'ADVANCE_PAYMENT_RECEIVED_CUSTOMER',
    sourceType: 'ADVANCED_PAYMENT',
    sourceId: advancedPayment._id,
    date: advancedPayment.createdAt || new Date(),
    description: `Customer advance payment received${advancedPayment.reference ? ` - ${advancedPayment.reference}` : ''}`,
    project: projectId,
    lines: [
      { account: paymentAccountId, debit: advancedPayment.amount, credit: 0, project: projectId },
      {
        account: customerAdvancesPayableId,
        debit: 0,
        credit: advancedPayment.amount,
        project: projectId,
        partyNumber: customerNumber,
        partyType: 'customer',
      },
    ],
    session,
  });
}

/**
 * ADVANCE_PAYMENT_PAID_VENDOR (JV002): Dr Advance to Suppliers, Cr Cash/Bank.
 */
async function postAdvancePaymentPaidVendorJE(advancedPayment, session) {
  if (!advancedPayment.paymentAccount) return null;
  const paymentAccountId = advancedPayment.paymentAccount?._id || advancedPayment.paymentAccount;
  // A vendor AdvancedPayment's project is optional (not every vendor advance is tied to a specific
  // project) - BUT when one IS attached, it must flow through to the JE (docs section "Project
  // Number is mandatory for automatic Journal Entries"/"whenever the originating event is
  // project-related"). Previously hardcoded to `null` unconditionally, silently discarding a real
  // project reference - fixed here.
  const projectId = advancedPayment.project?._id || advancedPayment.project || null;

  const vendorNumber = await resolveVendorNumber(advancedPayment.vendor, { required: true }, session);
  const advanceToSuppliersId = await getAccountIdByCode(AutomaticJournalAccountCodes.advanceToSuppliers, session);

  return postAutomaticJournalEntry({
    accountingAction: 'ADVANCE_PAYMENT_PAID_VENDOR',
    sourceType: 'ADVANCED_PAYMENT',
    sourceId: advancedPayment._id,
    date: advancedPayment.createdAt || new Date(),
    description: `Vendor advance payment paid${advancedPayment.reference ? ` - ${advancedPayment.reference}` : ''}`,
    project: projectId,
    lines: [
      {
        account: advanceToSuppliersId,
        debit: advancedPayment.amount,
        credit: 0,
        project: projectId,
        partyNumber: vendorNumber,
        partyType: 'vendor',
      },
      { account: paymentAccountId, debit: 0, credit: advancedPayment.amount, project: projectId },
    ],
    session,
  });
}

/**
 * Dispatches to the right advance JE based on `type` - called once right after an AdvancedPayment
 * is created, inside the same session as that creation.
 */
async function postAdvancedPaymentJournalEntry(advancedPayment, session) {
  if (advancedPayment.type === 'customer') return postAdvancePaymentReceivedCustomerJE(advancedPayment, session);
  if (advancedPayment.type === 'vendor') return postAdvancePaymentPaidVendorJE(advancedPayment, session);
  return null;
}

// ---------------------------------------------------------------------------
// 3-4-6. Purchase Order (JV003 parts A/B, JV004, JV006/JV008)
// ---------------------------------------------------------------------------

/**
 * PO_INVENTORY_RECEIPT + PO_INVENTORY_TO_WIP (JV003) for physical-product items, and
 * PO_SERVICE_TO_WIP (JV006/JV008) for service items. Called once, right after a Purchase Order is
 * saved (and, for product items, after applyPurchaseToProducts has run) - inside the same session.
 *
 * A single PO can mix product and service lines; each kind is posted as its own independent set of
 * JEs, grouped by accounting action, never merged.
 */
async function postPurchaseOrderJournalEntries(purchaseOrder, session) {
  const Product = require('../../models/inventory/productModel'); // eslint-disable-line global-require
  const entries = [];
  const projectId = purchaseOrder.project?._id || purchaseOrder.project || null;

  // A Purchase Order always has a vendor (schema-required) - resolved ONCE here and stamped onto
  // every control-account (Suppliers) line below, never a second lookup per line (docs section
  // "Vendor Sub Account").
  const vendorNumber = await resolveVendorNumber(purchaseOrder.vendorId, { required: true }, session);

  const productIds = [...new Set(purchaseOrder.items.map(i => (i.productId?._id || i.productId).toString()))];
  const products = await Product.find({ _id: { $in: productIds } }).session(session || null).lean();
  const typeById = new Map(products.map(p => [p._id.toString(), p.type]));

  const physicalItems = purchaseOrder.items.filter(i => typeById.get((i.productId?._id || i.productId).toString()) !== 'service');
  const serviceItems = purchaseOrder.items.filter(i => typeById.get((i.productId?._id || i.productId).toString()) === 'service');

  const totalForTax = purchaseOrder.totalAmount || 0;
  const physicalSubtotal = round2(physicalItems.reduce((s, i) => s + (i.subtotal || 0), 0));
  const serviceSubtotal = round2(serviceItems.reduce((s, i) => s + (i.subtotal || 0), 0));
  // VAT/Withholding are computed on the PO's full totalAmount - allocated proportionally between
  // the physical and service portions for a mixed PO, so a mixed PO doesn't silently misattribute
  // tax to only one side.
  const physicalShare = totalForTax > 0 ? physicalSubtotal / totalForTax : 0;
  const physicalVat = round2((purchaseOrder.vatAmount || 0) * physicalShare);
  const physicalWht = round2((purchaseOrder.withholdingTaxAmount || 0) * physicalShare);

  if (physicalItems.length > 0) {
    const [inventoryId, inputVatId, suppliersId, whtPayableId] = await Promise.all([
      getAccountIdByCode(AutomaticJournalAccountCodes.materialsInventory, session),
      getAccountIdByCode(AutomaticJournalAccountCodes.inputVat, session),
      getAccountIdByCode(AutomaticJournalAccountCodes.suppliers, session),
      getAccountIdByCode(AutomaticJournalAccountCodes.withholdingTaxPayable, session),
    ]);

    const receiptLines = [{ account: inventoryId, debit: physicalSubtotal, credit: 0 }];
    if (physicalVat > 0) receiptLines.push({ account: inputVatId, debit: physicalVat, credit: 0 });
    const supplierOwed = round2(physicalSubtotal + physicalVat - physicalWht);
    receiptLines.push({ account: suppliersId, debit: 0, credit: supplierOwed, partyNumber: vendorNumber, partyType: 'vendor' });
    if (physicalWht > 0) receiptLines.push({ account: whtPayableId, debit: 0, credit: physicalWht });

    entries.push(
      await postAutomaticJournalEntry({
        accountingAction: 'PO_INVENTORY_RECEIPT',
        sourceType: 'PO',
        sourceId: purchaseOrder._id,
        date: purchaseOrder.createdAt || new Date(),
        description: `Inventory receipt - PO ${purchaseOrder.code || purchaseOrder._id}`,
        project: projectId,
        lines: receiptLines,
        session,
      })
    );

    if (projectId) {
      const wipRawMaterialsId = await getAccountIdByCode(AutomaticJournalAccountCodes.wipRawMaterials, session);
      entries.push(
        await postAutomaticJournalEntry({
          accountingAction: 'PO_INVENTORY_TO_WIP',
          sourceType: 'PO',
          sourceId: purchaseOrder._id,
          date: purchaseOrder.createdAt || new Date(),
          description: `Transfer received inventory to project WIP - PO ${purchaseOrder.code || purchaseOrder._id}`,
          project: projectId,
          lines: [
            { account: wipRawMaterialsId, debit: physicalSubtotal, credit: 0, project: projectId },
            { account: inventoryId, debit: 0, credit: physicalSubtotal, project: projectId },
          ],
          session,
        })
      );
    }
  }

  if (serviceItems.length > 0) {
    // Project is mandatory for every Purchase Order (salesOrderModel.js's sibling `isNew` backstop
    // on purchaseOrder.js) - a service item reaching this point with no project would mean that
    // invariant was somehow bypassed. Fail loudly rather than silently skipping the WIP posting
    // (docs section "Do not silently continue if the source document has no Project").
    if (!projectId) {
      throw new ApiError('Project is required for this automatic Journal Entry (Purchase Order service cost posting).', 400);
    }

    const byCostAccount = new Map();
    for (const item of serviceItems) {
      const costAccountId = item.costAccount?._id || item.costAccount;
      if (!costAccountId) {
        throw new ApiError('Each service item on a Purchase Order with a project must have a cost (WIP) account selected.', 400);
      }
      const key = costAccountId.toString();
      byCostAccount.set(key, round2((byCostAccount.get(key) || 0) + (item.subtotal || 0)));
    }

    const suppliersId = await getAccountIdByCode(AutomaticJournalAccountCodes.suppliers, session);
    const lines = [];
    for (const [costAccountId, amount] of byCostAccount) {
      lines.push({ account: costAccountId, debit: amount, credit: 0, project: projectId });
    }
    lines.push({ account: suppliersId, debit: 0, credit: serviceSubtotal, project: projectId, partyNumber: vendorNumber, partyType: 'vendor' });

    entries.push(
      await postAutomaticJournalEntry({
        accountingAction: 'PO_SERVICE_TO_WIP',
        sourceType: 'PO',
        sourceId: purchaseOrder._id,
        date: purchaseOrder.createdAt || new Date(),
        description: `Service cost posted to project WIP - PO ${purchaseOrder.code || purchaseOrder._id}`,
        project: projectId,
        lines,
        session,
      })
    );
  }

  return entries;
}

/**
 * PO_SUPPLIER_ADVANCE_APPLIED (JV004): Dr Suppliers, Cr Advance to Suppliers. Called when a
 * Purchase Order is paid via a vendor AdvancedPayment (paymentMethod === 'advanced_payment').
 */
async function postPurchaseOrderAdvanceAppliedJE(purchaseOrder, consumedAmount, session) {
  const projectId = purchaseOrder.project?._id || purchaseOrder.project || null;
  const vendorNumber = await resolveVendorNumber(purchaseOrder.vendorId, { required: true }, session);
  const [suppliersId, advanceToSuppliersId] = await Promise.all([
    getAccountIdByCode(AutomaticJournalAccountCodes.suppliers, session),
    getAccountIdByCode(AutomaticJournalAccountCodes.advanceToSuppliers, session),
  ]);

  return postAutomaticJournalEntry({
    accountingAction: 'PO_SUPPLIER_ADVANCE_APPLIED',
    sourceType: 'PO',
    sourceId: purchaseOrder._id,
    date: new Date(),
    description: `Vendor advance applied against supplier payable - PO ${purchaseOrder.code || purchaseOrder._id}`,
    project: projectId,
    lines: [
      { account: suppliersId, debit: consumedAmount, credit: 0, project: projectId, partyNumber: vendorNumber, partyType: 'vendor' },
      { account: advanceToSuppliersId, debit: 0, credit: consumedAmount, project: projectId },
    ],
    session,
  });
}

// ---------------------------------------------------------------------------
// 5/7/9/12b. Payment (JV005/007/009, JV012 part B)
// ---------------------------------------------------------------------------

/**
 * PO_PAYMENT_RECORDED (JV005/007/009): Dr Suppliers, Cr Cash/Bank (payment.paymentAccount).
 * No-ops if the payment has no paymentAccount (a legacy string paymentMethod payment has no real
 * ChartOfAccount to post to - posting would require fabricating a mapping, which is not done).
 *
 * `projectId`: the originating Purchase Order's project, passed by the caller (which already has
 * the order loaded - see PaymentController.js) rather than re-fetched here. Previously hardcoded to
 * `null` unconditionally, silently discarding a real project reference even though every Purchase
 * Order has one (docs section "Project Number is mandatory for automatic Journal Entries").
 */
async function postPurchasePaymentRecordedJE(payment, projectId, session) {
  if (!payment.paymentAccount) return null;
  const paymentAccountId = payment.paymentAccount?._id || payment.paymentAccount;
  const vendorNumber = await resolveVendorNumber(payment.vendorId, { required: true }, session);
  const suppliersId = await getAccountIdByCode(AutomaticJournalAccountCodes.suppliers, session);

  return postAutomaticJournalEntry({
    accountingAction: 'PO_PAYMENT_RECORDED',
    sourceType: 'PAYMENT',
    sourceId: payment._id,
    date: payment.createdAt || new Date(),
    description: `Supplier payment${payment.notes ? ` - ${payment.notes}` : ''}`,
    project: projectId || null,
    lines: [
      { account: suppliersId, debit: payment.amountPaid, credit: 0, project: projectId || null, partyNumber: vendorNumber, partyType: 'vendor' },
      { account: paymentAccountId, debit: 0, credit: payment.amountPaid, project: projectId || null },
    ],
    session,
  });
}

/**
 * SO_PAYMENT_RECORDED (JV012 part B): Dr Cash/Bank (payment.paymentAccount),
 * Cr Accounts Receivable - Projects.
 *
 * `projectId`: the originating Sales Order's project, passed by the caller (which already has the
 * order loaded). Previously hardcoded to `null` unconditionally - see
 * postPurchasePaymentRecordedJE's identical fix/comment above.
 */
async function postSalesPaymentRecordedJE(payment, projectId, session) {
  if (!payment.paymentAccount) return null;
  const paymentAccountId = payment.paymentAccount?._id || payment.paymentAccount;
  const customerNumber = await resolveCustomerNumber(payment.customerId, { required: true }, session);
  const arProjectsId = await getAccountIdByCode(AutomaticJournalAccountCodes.accountsReceivableProjects, session);

  return postAutomaticJournalEntry({
    accountingAction: 'SO_PAYMENT_RECORDED',
    sourceType: 'PAYMENT',
    sourceId: payment._id,
    date: payment.createdAt || new Date(),
    description: `Customer payment${payment.notes ? ` - ${payment.notes}` : ''}`,
    project: projectId || null,
    lines: [
      { account: paymentAccountId, debit: payment.amountPaid, credit: 0, project: projectId || null },
      {
        account: arProjectsId,
        debit: 0,
        credit: payment.amountPaid,
        project: projectId || null,
        partyNumber: customerNumber,
        partyType: 'customer',
      },
    ],
    session,
  });
}

/**
 * PAYMENT_CUSTOMER_ADVANCE_APPLIED: Dr Customer Advances Payable, Cr Accounts Receivable -
 * Projects. Same accounting shape as SO_CUSTOMER_ADVANCE_APPLIED, but for a later Add Payment
 * against an EXISTING Sales Order funded from the customer's Advanced Payment balance (docs
 * section "Add Payment - Advanced Payment") rather than the order's own creation - kept as its own
 * accountingAction/sourceType so its idempotency key never collides with that order's own entry.
 */
async function postPaymentCustomerAdvanceAppliedJE(payment, consumedAmount, projectId, session) {
  const customerNumber = await resolveCustomerNumber(payment.customerId, { required: true }, session);
  const [customerAdvancesPayableId, arProjectsId] = await Promise.all([
    getAccountIdByCode(AutomaticJournalAccountCodes.customerAdvancesPayable, session),
    getAccountIdByCode(AutomaticJournalAccountCodes.accountsReceivableProjects, session),
  ]);

  return postAutomaticJournalEntry({
    accountingAction: 'PAYMENT_CUSTOMER_ADVANCE_APPLIED',
    sourceType: 'PAYMENT',
    sourceId: payment._id,
    date: payment.createdAt || new Date(),
    description: `Customer advance applied via payment against accounts receivable${payment.notes ? ` - ${payment.notes}` : ''}`,
    project: projectId || null,
    lines: [
      {
        account: customerAdvancesPayableId,
        debit: consumedAmount,
        credit: 0,
        project: projectId || null,
        partyNumber: customerNumber,
        partyType: 'customer',
      },
      { account: arProjectsId, debit: 0, credit: consumedAmount, project: projectId || null },
    ],
    session,
  });
}

/**
 * PAYMENT_VENDOR_ADVANCE_APPLIED: Dr Suppliers, Cr Advance to Suppliers. Same accounting shape as
 * PO_SUPPLIER_ADVANCE_APPLIED, but for a later Add Payment against an EXISTING Purchase Order
 * funded from the vendor's Advanced Payment balance, rather than the order's own creation.
 *
 * `projectId`: the originating Purchase Order's project, passed by the caller - previously
 * hardcoded to `null` unconditionally, same bug/fix as postPurchasePaymentRecordedJE above.
 */
async function postPaymentVendorAdvanceAppliedJE(payment, consumedAmount, projectId, session) {
  const vendorNumber = await resolveVendorNumber(payment.vendorId, { required: true }, session);
  const [suppliersId, advanceToSuppliersId] = await Promise.all([
    getAccountIdByCode(AutomaticJournalAccountCodes.suppliers, session),
    getAccountIdByCode(AutomaticJournalAccountCodes.advanceToSuppliers, session),
  ]);

  return postAutomaticJournalEntry({
    accountingAction: 'PAYMENT_VENDOR_ADVANCE_APPLIED',
    sourceType: 'PAYMENT',
    sourceId: payment._id,
    date: payment.createdAt || new Date(),
    description: `Vendor advance applied via payment against supplier payable${payment.notes ? ` - ${payment.notes}` : ''}`,
    project: projectId || null,
    lines: [
      { account: suppliersId, debit: consumedAmount, credit: 0, project: projectId || null, partyNumber: vendorNumber, partyType: 'vendor' },
      { account: advanceToSuppliersId, debit: 0, credit: consumedAmount, project: projectId || null },
    ],
    session,
  });
}

// ---------------------------------------------------------------------------
// 12a. Sales Order (JV012 part A)
// ---------------------------------------------------------------------------

/**
 * SO_CUSTOMER_ADVANCE_APPLIED (JV012 part A): Dr Customer Advances Payable,
 * Cr Accounts Receivable - Projects. Called right after a Sales Order consumes a customer advance.
 */
async function postSalesOrderAdvanceAppliedJE(salesOrder, consumedAmount, session) {
  const projectId = salesOrder.project?._id || salesOrder.project || null;
  const customerNumber = await resolveCustomerNumber(salesOrder.customer, { required: true }, session);
  const [customerAdvancesPayableId, arProjectsId] = await Promise.all([
    getAccountIdByCode(AutomaticJournalAccountCodes.customerAdvancesPayable, session),
    getAccountIdByCode(AutomaticJournalAccountCodes.accountsReceivableProjects, session),
  ]);

  return postAutomaticJournalEntry({
    accountingAction: 'SO_CUSTOMER_ADVANCE_APPLIED',
    sourceType: 'SO',
    sourceId: salesOrder._id,
    date: new Date(),
    description: `Customer advance applied against accounts receivable - SO ${salesOrder.code || salesOrder._id}`,
    project: projectId,
    lines: [
      {
        account: customerAdvancesPayableId,
        debit: consumedAmount,
        credit: 0,
        project: projectId,
        partyNumber: customerNumber,
        partyType: 'customer',
      },
      { account: arProjectsId, debit: 0, credit: consumedAmount, project: projectId },
    ],
    session,
  });
}

// ---------------------------------------------------------------------------
// 10-11. Project revenue/cost recognition (JV0010/JV0011)
// ---------------------------------------------------------------------------

/**
 * PROJECT_REVENUE_RECOGNITION (JV0010): Dr Accounts Receivable - Projects, Cr Revenue, for the
 * INCREMENTAL executed-percentage share of the project's contractValue since the last recognition.
 * No-ops if there is no contractValue to compute from, or no incremental percentage to recognize.
 *
 * Simplification (reported, not invented): the source sheet's VAT/Withholding lines on this entry
 * are not posted here - there is no project-level VAT/withholding rate field to derive them from,
 * and fabricating one would violate "do not invent a mapping without a real source". Revenue
 * recognition here is the plain Dr AR / Cr Revenue amount. Extend Project with its own
 * vatPercentage/withholdingTaxPercentage if that treatment is required later.
 */
async function postProjectRevenueRecognitionJE(project, session) {
  if (!project.contractValue) return null;
  const previousPct = project.revenueRecognizedPercentage || 0;
  const currentPct = project.executedPercentage || 0;
  if (currentPct <= previousPct) return null;

  const deltaAmount = round2((project.contractValue * (currentPct - previousPct)) / 100);
  if (deltaAmount <= 0) return null;

  // A Project's customer is optional at the schema level (e.g. an imported/legacy project with no
  // linked customer) - `required: false` here means a genuinely absent relationship is not an
  // error (no Sub Account for this entry), but a PRESENT customer reference that fails to resolve
  // to a real, numbered Customer still fails safely (docs section "If the Vendor/Customer is
  // missing or does not have a valid number... fail safely").
  const customerNumber = await resolveCustomerNumber(project.customer, { required: false }, session);
  const [arProjectsId, revenueId] = await Promise.all([
    getAccountIdByCode(AutomaticJournalAccountCodes.accountsReceivableProjects, session),
    getAccountIdByCode(AutomaticJournalAccountCodes.revenue, session),
  ]);

  const entry = await postAutomaticJournalEntry({
    accountingAction: 'PROJECT_REVENUE_RECOGNITION',
    sourceType: 'PROJECT',
    sourceId: deterministicSourceId(`${project._id}:PROJECT_REVENUE_RECOGNITION:${currentPct}`),
    date: new Date(),
    description: `Revenue recognition - project ${project.projectNumber} (${previousPct}% -> ${currentPct}%)`,
    project: project._id,
    lines: [
      {
        account: arProjectsId,
        debit: deltaAmount,
        credit: 0,
        project: project._id,
        partyNumber: customerNumber,
        partyType: customerNumber != null ? 'customer' : null,
      },
      { account: revenueId, debit: 0, credit: deltaAmount, project: project._id },
    ],
    session,
  });

  project.revenueRecognizedPercentage = currentPct;
  return entry;
}

/**
 * PROJECT_COST_RECOGNITION (JV0011): for each of the project's averageCostLines, Dr the COGS
 * account / Cr the matching WIP account (via CogsToWipAccountCodeMap), for the incremental
 * executed-percentage share of that line's amount. Throws if a line's COGS account code has no
 * mapped WIP account (an unmapped category is a configuration gap, not something to silently skip
 * and leave the entry incomplete).
 */
async function postProjectCostRecognitionJE(project, session) {
  if (!project.averageCostLines || project.averageCostLines.length === 0) return null;
  const previousPct = project.costRecognizedPercentage || 0;
  const currentPct = project.executedPercentage || 0;
  if (currentPct <= previousPct) return null;

  const deltaPct = currentPct - previousPct;
  const accountIds = project.averageCostLines.map(line => (line.account?._id || line.account).toString());
  const accounts = await ChartOfAccount.find({ _id: { $in: accountIds } }).session(session || null).lean();
  const accountsById = new Map(accounts.map(a => [a._id.toString(), a]));

  const lines = [];
  let totalDelta = 0;
  for (const costLine of project.averageCostLines) {
    const accountId = (costLine.account?._id || costLine.account).toString();
    const account = accountsById.get(accountId);
    if (!account) throw new ApiError('One of the project\'s Average Cost accounts no longer exists.', 500);

    const wipCode = CogsToWipAccountCodeMap[account.code];
    if (!wipCode) {
      throw new ApiError(`No WIP account is mapped for COGS account "${account.code} - ${account.name}". Extend CogsToWipAccountCodeMap.`, 500);
    }
    const wipAccountId = await getAccountIdByCode(wipCode, session);

    const deltaAmount = round2((costLine.amount * deltaPct) / 100);
    if (deltaAmount <= 0) continue;
    totalDelta += deltaAmount;

    lines.push({ account: accountId, debit: deltaAmount, credit: 0, project: project._id });
    lines.push({ account: wipAccountId, debit: 0, credit: deltaAmount, project: project._id });
  }

  if (lines.length === 0) return null;

  const entry = await postAutomaticJournalEntry({
    accountingAction: 'PROJECT_COST_RECOGNITION',
    sourceType: 'PROJECT',
    sourceId: deterministicSourceId(`${project._id}:PROJECT_COST_RECOGNITION:${currentPct}`),
    date: new Date(),
    description: `Cost recognition - project ${project.projectNumber} (${previousPct}% -> ${currentPct}%)`,
    project: project._id,
    lines,
    session,
  });

  project.costRecognizedPercentage = currentPct;
  return entry;
}

/**
 * Posts both revenue and cost recognition for a project whose executedPercentage just increased.
 * Called from projectController.js#updateProject, inside the same session as the project's own
 * save (so the percentage trackers below and the JEs commit together or not at all).
 */
async function postProjectExecutionRecognitionJEs(project, session) {
  const entries = [];
  const revenueJE = await postProjectRevenueRecognitionJE(project, session);
  if (revenueJE) entries.push(revenueJE);
  const costJE = await postProjectCostRecognitionJE(project, session);
  if (costJE) entries.push(costJE);
  return entries;
}

module.exports = {
  getAccountIdByCode,
  resolveVendorNumber,
  resolveCustomerNumber,
  postAutomaticJournalEntry,
  postAdvancedPaymentJournalEntry,
  postPurchaseOrderJournalEntries,
  postPurchaseOrderAdvanceAppliedJE,
  postPurchasePaymentRecordedJE,
  postSalesPaymentRecordedJE,
  postPaymentCustomerAdvanceAppliedJE,
  postPaymentVendorAdvanceAppliedJE,
  postSalesOrderAdvanceAppliedJE,
  postProjectExecutionRecognitionJEs,
};
