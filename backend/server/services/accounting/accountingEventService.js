const crypto = require('crypto');
const mongoose = require('mongoose');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const { getNextJournalEntryNumber } = require('./journalEntryNumberService');
const {
  AutomaticJournalAccountCodes,
  AccountingModuleByAction,
  ProjectRequiredAccountingActions,
  isPucAccountEligible,
  ProjectCostRecognitionDescription,
} = require('../../utils/accountingConstants');
const ApiError = require('../../utils/apiError');
const { applyEntryProjectToLines } = require('./journalEntryProjectService');
const { logAccountingEvent } = require('../../utils/accountingLogger');

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
 * Every line of an automatic entry gets the entry's own description (the parent description is the
 * single source of truth). Every line of a Sales Order / Purchase Order / Expense / Fixed Asset /
 * Equity entry (`withParty`) also gets the entry's business party as its Sub Account
 * (partyNumber/partyType - the Customer Number for a Sales Order, the Vendor Number for a Purchase
 * Order, Expense or Fixed Asset acquisition, the Shareholder Number for Equity): `party` when the caller passes one,
 * otherwise the party already stamped on the entry's control-account line. A line that already
 * carries its own party keeps it; an entry with no party has none.
 */
const PartyOnEveryLineModules = ['Sales Order', 'Purchase Order', 'Expense', 'Fixed Asset', 'Equity'];

function applyEntryDescriptionAndPartyToLines(lines, description, party, withParty) {
  const source = !withParty ? null : party?.number != null && party?.type ? party : (lines || []).find(l => l.partyNumber != null && l.partyType);
  return (lines || []).map(line => ({
    ...line,
    description,
    ...(source && !(line.partyNumber != null && line.partyType)
      ? { partyNumber: source.number ?? source.partyNumber, partyType: source.type ?? source.partyType }
      : {}),
  }));
}

/**
 * Idempotently posts ONE automatic JournalEntry for a given accounting action. Safe to call
 * repeatedly for the same (sourceType, sourceId, accountingAction) triple - returns the already-
 * existing entry without creating a duplicate (the idempotency check and the create below both run
 * inside the caller's session, so this participates correctly in the same transaction as the rest
 * of the business operation - see journalEntryModel.js's compound unique index, which is the real
 * backstop against a race duplicating this under concurrent requests).
 */
async function postAutomaticJournalEntry({ accountingAction, sourceType, sourceId, date, description, reference, project, lines, session, triggeredBySalesOrder, advancedPayment, party }) {
  const existing = await JournalEntry.findOne({ sourceType, sourceId, accountingAction }).session(session || null);
  if (existing) return existing;

  // Integrity guard: never even attempt to persist an unbalanced automatic entry (the model's own
  // pre('save') RULE 1 is the backstop - this gives a clear, action-specific error first).
  const totalDebit = round2((lines || []).reduce((sum, line) => sum + (line.debit || 0), 0));
  const totalCredit = round2((lines || []).reduce((sum, line) => sum + (line.credit || 0), 0));
  if (totalDebit !== totalCredit) {
    throw new ApiError(`Automatic accounting (${accountingAction}): journal entry is not balanced (debit ${totalDebit} != credit ${totalCredit}). Posting aborted.`, 500);
  }

  // Actions that only ever arise from a project-bound document (every new Purchase/Sales Order
  // requires a project, and recognition is per project) - posting one without its project would
  // be a project-less WIP/AR entry, so it fails instead.
  if (ProjectRequiredAccountingActions.includes(accountingAction) && !(project?._id || project)) {
    throw new ApiError(`Project is required for this automatic Journal Entry (${accountingAction}).`, 400);
  }

  // Every line carries the entry's Project and that Project's real Project Number (never only the
  // parent entry) - see journalEntryProjectService.js - plus the entry's description and Sub Account.
  const entryModule = AccountingModuleByAction[accountingAction] || null;
  const projectLines = applyEntryDescriptionAndPartyToLines(
    await applyEntryProjectToLines({ project, lines, session }),
    description,
    party,
    PartyOnEveryLineModules.includes(entryModule)
  );

  const entryNumber = await getNextJournalEntryNumber(session);
  const [entry] = await JournalEntry.create(
    [
      {
        entryNumber,
        date: date || new Date(),
        description,
        ...(reference ? { reference } : {}),
        source: 'automatic',
        // Normalized through the one accountingAction -> Module map (docs section "Module field") -
        // never a free-text/inconsistently-cased variation (see accountingConstants.js).
        module: entryModule,
        sourceType,
        sourceId,
        accountingAction,
        project: project || null,
        // Only ever set by postProjectRevenueRecognitionJE below,
        // which are the one case where `sourceId` itself can't point back at the triggering Sales
        // Order (docs section "Sales Order Source Link") - every other automatic entry leaves this
        // null, since its own sourceType/sourceId already is the real link.
        triggeredBySalesOrder: triggeredBySalesOrder || null,
        // Persisted link to the Advanced Payment this entry belongs to (its own creation entry, or
        // an entry that consumed it) - what the Advanced Payment details page lists, never a text
        // match. Null for every entry unrelated to an advance.
        advancedPayment: advancedPayment?._id || advancedPayment || null,
        status: 'posted',
        lines: projectLines,
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
    advancedPayment: advancedPayment._id,
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
    advancedPayment: advancedPayment._id,
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
 * Resolves, for every SERVICE line of a Purchase Order, the PUC account its cost must be posted
 * to - read from the Service record itself (Product.pucAccount), never from the request, never a
 * hardcoded/fallback account. Throws a clear 400 (and so aborts the whole PO transaction) when a
 * service has no PUC account configured, or its configured account is no longer usable.
 */
async function resolveServicePucAccounts(serviceProducts, session) {
  const pucIds = [...new Set(serviceProducts.map(p => (p.pucAccount?._id || p.pucAccount)?.toString()).filter(Boolean))];
  const accounts = pucIds.length ? await ChartOfAccount.find({ _id: { $in: pucIds } }).session(session || null).lean() : [];
  const accountsById = new Map(accounts.map(a => [a._id.toString(), a]));

  const pucByProductId = new Map();
  for (const product of serviceProducts) {
    const title = product.title?.en || product.title?.ar || product._id.toString();
    const pucId = (product.pucAccount?._id || product.pucAccount)?.toString();
    if (!pucId) {
      throw new ApiError(`The service "${title}" has no PUC account configured. Set a PUC account on the service before purchasing it.`, 400);
    }
    const account = accountsById.get(pucId);
    if (!account) {
      throw new ApiError(`The PUC account configured on the service "${title}" no longer exists. Update the service's PUC account before purchasing it.`, 400);
    }
    if (!isPucAccountEligible(account)) {
      throw new ApiError(`The PUC account "${account.code} - ${account.name}" on the service "${title}" is not an active PUC (asset) account. Update the service before purchasing it.`, 400);
    }
    pucByProductId.set(product._id.toString(), account._id);
  }
  return pucByProductId;
}

/**
 * PO_INVENTORY_RECEIPT + PO_INVENTORY_TO_WIP (JV003) for physical-product items, and
 * PO_SERVICE_TO_WIP (JV006/JV008) for service items. Called once, right after a Purchase Order is
 * saved (and, for product items, after applyPurchaseToProducts has run) - inside the same session.
 *
 * A single PO can mix product and service lines; each kind is posted as its own independent set of
 * JEs, grouped by accounting action, never merged.
 *
 *   PRODUCT lines: Dr Materials Inventory (+ Dr Input VAT) / Cr Suppliers (+ Cr WHT Payable), then
 *                  (with a project) Dr WIP Raw Materials / Cr Materials Inventory - unchanged.
 *   SERVICE lines: Dr the Service's own PUC account (+ Dr Input VAT) / Cr Suppliers
 *                  (+ Cr WHT Payable). Materials Inventory is never touched by a service.
 *
 * VAT/Withholding are split between the product and service portions in proportion to their
 * subtotals, with the service side taking the exact remainder - so the Suppliers credits of the two
 * entries always add up to the order's Total Amount (grandTotal) to the cent.
 */
async function postPurchaseOrderJournalEntries(purchaseOrder, session) {
  const Product = require('../../models/inventory/productModel'); // eslint-disable-line global-require
  const entries = [];
  const projectId = purchaseOrder.project?._id || purchaseOrder.project || null;

  // A Purchase Order always has a vendor (schema-required) - resolved ONCE here and stamped onto
  // every control-account (Suppliers) line below, never a second lookup per line (docs section
  // "Vendor Sub Account"). The PO "Supplier" is this Vendor; its Vendor Number is its Sub Account.
  const vendorNumber = await resolveVendorNumber(purchaseOrder.vendorId, { required: true }, session);

  const productIdOf = item => (item.productId?._id || item.productId).toString();
  const productIds = [...new Set(purchaseOrder.items.map(productIdOf))];
  const products = await Product.find({ _id: { $in: productIds } }).session(session || null).lean();
  const productById = new Map(products.map(p => [p._id.toString(), p]));
  const isServiceItem = item => productById.get(productIdOf(item))?.type === 'service';

  const physicalItems = purchaseOrder.items.filter(i => !isServiceItem(i));
  const serviceItems = purchaseOrder.items.filter(isServiceItem);

  const physicalSubtotal = round2(physicalItems.reduce((s, i) => s + (i.subtotal || 0), 0));
  const serviceSubtotal = round2(serviceItems.reduce((s, i) => s + (i.subtotal || 0), 0));
  const totalForTax = round2(physicalSubtotal + serviceSubtotal);
  const totalVat = round2(purchaseOrder.vatAmount || 0);
  const totalWht = round2(purchaseOrder.withholdingTaxAmount || 0);
  const physicalShare = totalForTax > 0 ? physicalSubtotal / totalForTax : 0;
  const physicalVat = serviceItems.length === 0 ? totalVat : round2(totalVat * physicalShare);
  const physicalWht = serviceItems.length === 0 ? totalWht : round2(totalWht * physicalShare);
  const serviceVat = round2(totalVat - physicalVat);
  const serviceWht = round2(totalWht - physicalWht);

  // Validate every service's PUC account BEFORE posting anything, so a misconfigured service never
  // leaves a half-posted PO behind (even outside a transaction).
  let pucByProductId = new Map();
  if (serviceItems.length > 0) {
    // Project is mandatory for every Purchase Order (purchaseOrder.js's `isNew` backstop) - a
    // service item reaching this point with no project would mean that invariant was bypassed.
    // Fail loudly rather than silently posting project-less WIP (docs section "Do not silently
    // continue if the source document has no Project").
    if (!projectId) {
      throw new ApiError('Project is required for this automatic Journal Entry (Purchase Order service cost posting).', 400);
    }
    const serviceProducts = [...new Set(serviceItems.map(productIdOf))].map(id => productById.get(id));
    pucByProductId = await resolveServicePucAccounts(serviceProducts, session);
  }

  // A zero-value portion (e.g. fully discounted lines) has nothing to post - a 0-amount journal line
  // is invalid by definition (journalLineSchema), so it is skipped rather than erroring.
  if (physicalItems.length > 0 && physicalSubtotal > 0) {
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
          party: { number: vendorNumber, type: 'vendor' },
          session,
        })
      );
    }
  }

  if (serviceItems.length > 0 && serviceSubtotal > 0) {
    // One debit line per distinct PUC account (two services sharing a PUC account are summed).
    const byPucAccount = new Map();
    for (const item of serviceItems) {
      const key = pucByProductId.get(productIdOf(item)).toString();
      byPucAccount.set(key, round2((byPucAccount.get(key) || 0) + (item.subtotal || 0)));
    }

    const suppliersId = await getAccountIdByCode(AutomaticJournalAccountCodes.suppliers, session);
    const lines = [];
    for (const [pucAccountId, amount] of byPucAccount) {
      if (amount > 0) lines.push({ account: pucAccountId, debit: amount, credit: 0, project: projectId });
    }
    if (serviceVat > 0) {
      const inputVatId = await getAccountIdByCode(AutomaticJournalAccountCodes.inputVat, session);
      lines.push({ account: inputVatId, debit: serviceVat, credit: 0, project: projectId });
    }
    const supplierOwed = round2(serviceSubtotal + serviceVat - serviceWht);
    if (supplierOwed > 0) {
      lines.push({ account: suppliersId, debit: 0, credit: supplierOwed, project: projectId, partyNumber: vendorNumber, partyType: 'vendor' });
    }
    if (serviceWht > 0) {
      const whtPayableId = await getAccountIdByCode(AutomaticJournalAccountCodes.withholdingTaxPayable, session);
      lines.push({ account: whtPayableId, debit: 0, credit: serviceWht, project: projectId });
    }

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
    advancedPayment: purchaseOrder.advancedPayment || null,
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
 * The Description of a journal entry created by an Add Payment: exactly what the user typed into
 * the payment's Notes field. Only when Notes is empty/blank does the entry fall back to the
 * system's default description for that kind of payment - never "undefined"/"null" text.
 */
function paymentJournalDescription(payment, fallback) {
  const notes = typeof payment?.notes === 'string' ? payment.notes.trim() : '';
  if (!notes || notes === 'undefined' || notes === 'null') return fallback;
  return notes;
}

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
    description: paymentJournalDescription(payment, 'Supplier payment'),
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
    description: paymentJournalDescription(payment, 'Customer payment'),
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
    description: paymentJournalDescription(payment, 'Customer advance applied via payment against accounts receivable'),
    project: projectId || null,
    advancedPayment: payment.advancedPayment || null,
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
    description: paymentJournalDescription(payment, 'Vendor advance applied via payment against supplier payable'),
    project: projectId || null,
    advancedPayment: payment.advancedPayment || null,
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
    advancedPayment: salesOrder.advancedPayment || null,
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

/**
 * The Customer Number (Sub Account) of a project's Sales Order entries (JV0010 / JV0011): the
 * project's customer, or - for a project with no linked customer - the triggering Sales Order's
 * customer. Null when there is neither.
 */
async function resolveProjectCustomerNumber(project, triggeredBySalesOrder, session) {
  if (project.customer) return resolveCustomerNumber(project.customer, { required: false }, session);
  const orderId = triggeredBySalesOrder?._id || triggeredBySalesOrder;
  if (!orderId) return null;
  const SalesOrder = require('../../models/sales/salesOrderModel'); // eslint-disable-line global-require
  const order = await SalesOrder.findById(orderId).select('customer').session(session || null).lean();
  return resolveCustomerNumber(order?.customer, { required: false }, session);
}

// ---------------------------------------------------------------------------
// 10. Project revenue recognition (JV0010)
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
async function postProjectRevenueRecognitionJE(project, session, triggeredBySalesOrder = null, date = new Date()) {
  if (!project.contractValue) return null;
  const previousPct = project.revenueRecognizedPercentage || 0;
  const currentPct = project.executedPercentage || 0;
  if (currentPct <= previousPct) return null;

  const deltaAmount = round2((project.contractValue * (currentPct - previousPct)) / 100);
  if (deltaAmount <= 0) return null;

  // VAT/Withholding Tax on the recognized revenue slice (docs section "Sales Order VAT fix") -
  // derived from the project's ACTUAL Sales Orders, never a hardcoded/invented rate. Executed % is
  // itself defined as Σ(this project's Sales Order totalAmount, pre-tax) / contractValue × 100 (see
  // projectAccountingService.js#recalculateExecutedPercentage), so `deltaAmount` is already
  // mathematically equal to the real pre-tax sales amount behind this recognition step. The
  // weighted-average VAT%/Withholding% across the SAME Sales Orders is what lets that exact amount
  // carry a proportionally correct tax effect, rather than silently posting none at all (the
  // engine's previous behavior).
  //
  // When a specific Sales Order triggered this recognition (the normal case - see
  // projectAccountingService.js#recalculateExecutedPercentage), the recognized slice IS that
  // order's own pre-tax amount, so it carries THAT order's own VAT/withholding rates - never a
  // project-wide average. A Sales Order created with no VAT/withholding therefore always
  // recognizes 0 tax, even on a project whose earlier orders were taxed (previously the
  // project-wide weighted average leaked those earlier orders' VAT into a no-tax order's entry).
  // Only a recognition with no triggering order (e.g. a contractValue change) falls back to the
  // weighted average across the project's orders.
  const SalesOrder = require('../../models/sales/salesOrderModel'); // eslint-disable-line global-require
  const triggeringOrderId = triggeredBySalesOrder?._id || triggeredBySalesOrder || null;
  let vatRatio = 0;
  let whtRatio = 0;
  const triggeringOrder = triggeringOrderId
    ? await SalesOrder.findById(triggeringOrderId).select('totalAmount vatAmount withholdingTaxAmount').session(session || null).lean()
    : null;
  if (triggeringOrder) {
    const base = triggeringOrder.totalAmount || 0;
    vatRatio = base > 0 ? (triggeringOrder.vatAmount || 0) / base : 0;
    whtRatio = base > 0 ? (triggeringOrder.withholdingTaxAmount || 0) / base : 0;
  } else {
    const [taxTotals] = await SalesOrder.aggregate([
      { $match: { project: project._id, orderStatus: { $ne: 'canceled' } } },
      { $group: { _id: null, totalAmount: { $sum: '$totalAmount' }, totalVat: { $sum: '$vatAmount' }, totalWht: { $sum: '$withholdingTaxAmount' } } },
    ]).session(session || null);
    const totalPreTax = taxTotals?.totalAmount || 0;
    vatRatio = totalPreTax > 0 ? (taxTotals.totalVat || 0) / totalPreTax : 0;
    whtRatio = totalPreTax > 0 ? (taxTotals.totalWht || 0) / totalPreTax : 0;
  }
  const deltaVat = round2(deltaAmount * vatRatio);
  const deltaWht = round2(deltaAmount * whtRatio);
  // The receivable side nets exactly like SalesOrder.grandTotal does (totalAmount + vatAmount -
  // withholdingTaxAmount) - never the plain revenue amount, so VAT/WHT never silently vanish from
  // what the customer is actually deemed to owe for this recognized slice.
  const arAmount = round2(deltaAmount + deltaVat - deltaWht);

  // A Project's customer is optional at the schema level (e.g. an imported/legacy project with no
  // linked customer) - `required: false` here means a genuinely absent relationship is not an
  // error (no Sub Account for this entry), but a PRESENT customer reference that fails to resolve
  // to a real, numbered Customer still fails safely (docs section "If the Vendor/Customer is
  // missing or does not have a valid number... fail safely").
  const customerNumber = await resolveProjectCustomerNumber(project, triggeredBySalesOrder, session);
  const [arProjectsId, revenueId] = await Promise.all([
    getAccountIdByCode(AutomaticJournalAccountCodes.accountsReceivableProjects, session),
    getAccountIdByCode(AutomaticJournalAccountCodes.revenue, session),
  ]);

  const lines = [
    {
      account: arProjectsId,
      debit: arAmount,
      credit: 0,
      project: project._id,
      partyNumber: customerNumber,
      partyType: customerNumber != null ? 'customer' : null,
    },
    { account: revenueId, debit: 0, credit: deltaAmount, project: project._id },
  ];
  if (deltaVat > 0) {
    const vatPayableId = await getAccountIdByCode(AutomaticJournalAccountCodes.vatPayable, session);
    lines.push({ account: vatPayableId, debit: 0, credit: deltaVat, project: project._id });
  }
  if (deltaWht > 0) {
    const withholdingTaxReceivableId = await getAccountIdByCode(AutomaticJournalAccountCodes.withholdingTaxReceivable, session);
    lines.push({ account: withholdingTaxReceivableId, debit: deltaWht, credit: 0, project: project._id });
  }

  const entry = await postAutomaticJournalEntry({
    accountingAction: 'PROJECT_REVENUE_RECOGNITION',
    sourceType: 'PROJECT',
    sourceId: deterministicSourceId(`${project._id}:PROJECT_REVENUE_RECOGNITION:${currentPct}`),
    date,
    description: `Revenue recognition - project ${project.projectNumber} (${previousPct}% -> ${currentPct}%)`,
    project: project._id,
    lines,
    session,
    triggeredBySalesOrder,
  });

  project.revenueRecognizedPercentage = currentPct;
  return entry;
}

// ---------------------------------------------------------------------------
// 11. Project cost recognition (JV0011)
// ---------------------------------------------------------------------------

/**
 * Normalized account name for pairing an Average Cost account with its PUC account: lower case,
 * single spaces, one dash style.
 */
const normalizeAccountName = name => (name || '').replace(/[–—]/g, '-').replace(/s+/g, ' ').trim().toLowerCase();

/**
 * The PUC account corresponding to a project Average Cost account, from the Chart of Accounts: the
 * one PUC-eligible account (isPucAccountEligible - the same rule a Service's PUC account follows)
 * whose name, after its "<PUC prefix> - " part, is exactly the cost account's name, in English or
 * Arabic (e.g. "مواد خام" -> "مشروعات تحت التنفيذ - مواد خام"). Null when there is no single match -
 * never a guess.
 */
function findCorrespondingPucAccount(costAccount, pucAccounts) {
  const costNames = [costAccount.name, costAccount.nameAr].map(normalizeAccountName).filter(Boolean);
  const matches = pucAccounts.filter(puc =>
    [puc.name, puc.nameAr].some(name => {
      const normalized = normalizeAccountName(name);
      const separator = normalized.lastIndexOf(' - ');
      return separator > 0 && costNames.includes(normalized.slice(separator + 3).trim());
    })
  );
  return matches.length === 1 ? matches[0] : null;
}

/**
 * PROJECT_COST_RECOGNITION - JV0011 of "AUTOMATIC ENTERIES.xlsx" ("charge the project with its
 * costs at the executed share of the contract"). For EVERY line of the project's Average Cost
 * (averageCostLines: a cost account + its real cost):
 *
 *   amount = real cost × Executed % - the part already recognized (real cost × costRecognizedPercentage)
 *   Dr  the Average Cost line's own account          amount
 *   Cr  its corresponding PUC account                amount   (findCorrespondingPucAccount)
 *
 * all in ONE balanced entry, e.g. Raw Materials 250,000 and Labour 150,000 at 20% executed:
 * Dr Raw Materials 50,000 / Cr PUC - Raw Materials 50,000, Dr Labour 30,000 / Cr PUC - Labour 30,000.
 * The total recognized for a line is therefore always real cost × the project's Executed %.
 * Same rules as revenue recognition above: the tracker only moves up, and the posting runs in the
 * caller's session. Lines with no cost to post are left out; a line whose account has no
 * corresponding PUC account is left out and logged. No lines -> no entry (tracker untouched).
 */
async function postProjectCostRecognitionJE(project, session, triggeredBySalesOrder = null, date = new Date()) {
  const previousPct = project.costRecognizedPercentage || 0;
  const currentPct = project.executedPercentage || 0;
  if (currentPct <= previousPct) return null;

  const costLines = (project.averageCostLines || []).filter(line => (line.account?._id || line.account) && line.amount > 0);
  if (costLines.length === 0) return null;
  const costAccounts = await ChartOfAccount.find({ _id: { $in: costLines.map(line => line.account?._id || line.account) } })
    .session(session || null)
    .lean();
  const costAccountsById = new Map(costAccounts.map(account => [String(account._id), account]));
  const pucAccounts = (await ChartOfAccount.find({ type: 'asset' }).session(session || null).lean()).filter(isPucAccountEligible);

  const description = ProjectCostRecognitionDescription;
  const debits = [];
  const credits = [];
  for (const line of costLines) {
    const costAccount = costAccountsById.get(String(line.account?._id || line.account));
    const amount = round2(round2((line.amount * currentPct) / 100) - round2((line.amount * previousPct) / 100));
    if (costAccount && amount > 0) {
      const pucAccount = findCorrespondingPucAccount(costAccount, pucAccounts);
      if (pucAccount) {
        debits.push({ account: costAccount._id, debit: amount, credit: 0, project: project._id });
        credits.push({ account: pucAccount._id, debit: 0, credit: amount, project: project._id });
      } else {
        logAccountingEvent('project_cost_recognition_no_puc_account', { projectNumber: project.projectNumber, account: costAccount.code, amount });
      }
    }
  }
  if (debits.length === 0) return null;

  const customerNumber = await resolveProjectCustomerNumber(project, triggeredBySalesOrder, session);
  const entry = await postAutomaticJournalEntry({
    accountingAction: 'PROJECT_COST_RECOGNITION',
    sourceType: 'PROJECT',
    // Distinct from the keys of earlier versions of this entry.
    sourceId: deterministicSourceId(`${project._id}:PROJECT_COST_RECOGNITION:COST-TO-PUC:${currentPct}`),
    date,
    description,
    project: project._id,
    lines: [...debits, ...credits],
    party: { number: customerNumber, type: 'customer' },
    session,
    triggeredBySalesOrder,
  });

  project.costRecognizedPercentage = currentPct;
  return entry;
}

/**
 * Posts revenue recognition (JV0010) and then cost recognition (JV0011) for a project whose
 * executedPercentage just increased - both with the same document date. Called from
 * projectAccountingService.js#recalculateExecutedPercentage (Sales Order create/cancel/return) and
 * projectController.js#updateProject, inside the same session as the project's own save (so the
 * percentage trackers and the JEs commit together or not at all). Returns the posted entries (0-2).
 */
async function postProjectExecutionRecognitionJEs(project, session, triggeredBySalesOrder = null) {
  const entries = [];
  const date = new Date();
  const revenueJE = await postProjectRevenueRecognitionJE(project, session, triggeredBySalesOrder, date);
  if (revenueJE) entries.push(revenueJE);
  const costJE = await postProjectCostRecognitionJE(project, session, triggeredBySalesOrder, date);
  if (costJE) entries.push(costJE);
  return entries;
}

module.exports = {
  deterministicSourceId,
  getAccountIdByCode,
  resolveVendorNumber,
  resolveCustomerNumber,
  postAutomaticJournalEntry,
  paymentJournalDescription,
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
