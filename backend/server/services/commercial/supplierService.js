'use strict';

const mongoose = require('mongoose');
const ApiError = require('../../utils/apiError');
const Supplier = require('../../models/commercial/supplierModel');
const Counter = require('../../models/config/counterModel');
const Vendor = require('../../models/vendor/vendor');
const { normalizeEgyptianPhone } = require('../../utils/crm/phone');

const { SUPPLIER_STATUSES, DOCUMENT_KINDS } = Supplier;

// Deal Engine C18 / Spec Part 2 section 4 - the approved supplier list.
//
// Who may do what (server-side, from the DB-loaded Deal Engine role):
//   - create, edit, propose, documents, scorecard, notes, price list uploads: Procurement, the
//     Commercial Director, the MD ("Procurement proposes");
//   - Approved / Conditional: the MD only ("MD approves");
//   - Suspended / Removed: the MD or the Commercial Director;
//   - back to Candidate: the MD.
// Every status change, scorecard update and document change is appended to the notes log.

// Go-live Developer Pack section 5.4/5.8/D9: "Propose suppliers" gains bdm (Edit). Approval moves
// to the S&C Director as the PRIMARY approver (D9: "Supplier approval by the S&C Director, never
// by the person who proposed it"), with md kept for the explicit MD override the brief allows.
const EDIT_ROLES = ['md', 'commercial_director', 'procurement', 'bdm'];
const STATUS_ROLES = {
  Approved: ['md', 'commercial_director'],
  Conditional: ['md', 'commercial_director'],
  Suspended: ['md', 'commercial_director'],
  Removed: ['md', 'commercial_director'],
  Candidate: ['md', 'commercial_director'],
};
const REVIEW_WINDOW_DAYS = 30;

const text = (v, max) => String(v ?? '').trim().slice(0, max);

async function nextCode() {
  const name = 'commercial_supplier_code';
  let c = await Counter.findOneAndUpdate({ _id: name, $expr: { $lt: ['$seq', '$max'] } }, { $inc: { seq: 1 } }, { new: true });
  if (!c) {
    try {
      await Counter.create({ _id: name, seq: 0, min: 1, max: 9999 });
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
    c = await Counter.findOneAndUpdate({ _id: name, $expr: { $lt: ['$seq', '$max'] } }, { $inc: { seq: 1 } }, { new: true });
  }
  if (!c) throw new ApiError('The supplier code range (SUP-0001 to SUP-9999) is exhausted.', 400);
  return `SUP-${String(c.seq).padStart(4, '0')}`;
}

function assertRole(role, allowed, what) {
  if (!allowed.includes(role)) throw new ApiError(`${what} is for: ${allowed.map(r => r.replace('_', ' ')).join(', ')}. Your Deal Engine role is "${role || 'none'}".`, 403);
}

/** Review flags: a document past (or within 30 days of) its expiry, or the annual review date passed. */
function reviewFlags(supplier, now = new Date()) {
  const flags = [];
  for (const d of supplier.documents || []) {
    if (!d.expiry) continue;
    const days = Math.floor((new Date(d.expiry).getTime() - now.getTime()) / 86400000);
    if (days < 0) flags.push(`${d.kind} expired on ${new Date(d.expiry).toISOString().slice(0, 10)}`);
    else if (days <= REVIEW_WINDOW_DAYS) flags.push(`${d.kind} expires in ${days} day(s)`);
  }
  if (supplier.approval?.reviewDate && new Date(supplier.approval.reviewDate).getTime() < now.getTime()) flags.push('Annual review is due');
  return flags;
}

function shape(doc) {
  const s = doc.toObject ? doc.toObject() : doc;
  return { ...s, reviewFlags: reviewFlags(s) };
}

function cleanBody(body, current = {}) {
  const out = {};
  if (body.legalName !== undefined) {
    out.legalName = text(body.legalName, 200);
    if (!out.legalName) throw new ApiError('The legal name is required.', 400);
  }
  for (const k of ['tradeName', 'country', 'city']) if (body[k] !== undefined) out[k] = text(body[k], k === 'tradeName' ? 200 : 80);
  for (const k of ['categories', 'brands']) {
    if (body[k] === undefined) continue;
    if (!Array.isArray(body[k])) throw new ApiError(`${k} must be a list.`, 400);
    out[k] = [...new Set(body[k].map(v => text(v, 80)).filter(Boolean))].slice(0, 40);
  }
  if (body.contacts !== undefined) {
    if (!Array.isArray(body.contacts)) throw new ApiError('contacts must be a list.', 400);
    out.contacts = body.contacts.slice(0, 20).map((c, i) => {
      const name = text(c?.name, 120);
      if (!name) throw new ApiError(`Contact ${i + 1} needs a name.`, 400);
      const email = text(c?.email, 160).toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(`Contact ${i + 1}: "${email}" is not an email address.`, 400);
      return { name, role: text(c?.role, 80), phone: text(c?.phone, 40), email };
    });
  }
  if (body.terms !== undefined) {
    const t = body.terms || {};
    const currency = t.currency ?? current.terms?.currency ?? 'EGP';
    if (!['EGP', 'USD', 'EUR', 'CNY'].includes(currency)) throw new ApiError('Currency must be EGP, USD, EUR or CNY.', 400);
    const lead = t.leadTimeDays === '' || t.leadTimeDays == null ? null : Number(t.leadTimeDays);
    if (lead !== null && !(lead >= 0)) throw new ApiError('Lead time must be zero or more days.', 400);
    out.terms = { paymentTerms: text(t.paymentTerms, 200), currency, incoterms: text(t.incoterms, 40), leadTimeDays: lead, minimumOrder: text(t.minimumOrder, 120) };
  }
  return out;
}

async function listSuppliers({ status, q } = {}) {
  const filter = {};
  if (status && SUPPLIER_STATUSES.includes(status)) filter.status = status;
  if (q) filter.$or = [{ legalName: new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { tradeName: new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { code: String(q).toUpperCase() }];
  const rows = await Supplier.find(filter).select('-notes -columnMapping').sort({ code: 1 }).lean();
  return rows.map(shape);
}

async function getSupplier(id) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError('Invalid supplier id.', 400);
  const s = await Supplier.findById(id);
  if (!s) throw new ApiError('Supplier not found.', 404);
  return s;
}

async function createSupplier(body, { user, role }) {
  assertRole(role, EDIT_ROLES, 'Adding a supplier');
  const values = cleanBody({ legalName: '', ...body });
  const supplier = await Supplier.create({
    ...values,
    code: await nextCode(),
    status: 'Candidate',
    approval: { proposedBy: user._id, proposedByName: user.name || null, proposedAt: new Date() },
    notes: [{ by: user._id, byName: user.name || null, kind: 'status', text: 'Proposed as a Candidate supplier.' }],
    createdBy: user._id,
  });
  return shape(supplier);
}

async function updateSupplier(id, body, { user, role }) {
  assertRole(role, EDIT_ROLES, 'Editing a supplier');
  const supplier = await getSupplier(id);
  const values = cleanBody(body, supplier);
  const changed = Object.keys(values).filter(k => JSON.stringify(supplier[k]) !== JSON.stringify(values[k]));
  Object.assign(supplier, values);
  if (changed.length) supplier.notes.push({ by: user._id, byName: user.name || null, kind: 'edit', text: `Updated: ${changed.join(', ')}.` });
  await supplier.save();
  return shape(supplier);
}

/** Status change with the approval record and a note (a reason is required except for approval). */
async function setStatus(id, { status, note, reviewDate }, { user, role }) {
  if (!SUPPLIER_STATUSES.includes(status)) throw new ApiError(`Status must be one of: ${SUPPLIER_STATUSES.join(', ')}.`, 400);
  assertRole(role, STATUS_ROLES[status], `Setting a supplier to ${status}`);
  const supplier = await getSupplier(id);
  if (supplier.status === status) throw new ApiError(`The supplier is already ${status}.`, 400);
  const reason = text(note, 500);

  // D9: "Supplier approval by the S&C Director, never by the person who proposed it; the MD may
  // override with a reason." Applies to both approval-track decisions (Approved/Conditional) -
  // the proposer is blocked outright unless they are the md role, and even the MD override
  // requires an explicit reason (normally optional for a plain Approved decision - see below).
  const isProposer = supplier.approval?.proposedBy && String(supplier.approval.proposedBy) === String(user._id);
  if (isProposer && ['Approved', 'Conditional'].includes(status)) {
    if (role !== 'md') {
      throw new ApiError('You proposed this supplier - a different person (the Sales and Commercial Director) must approve it.', 403);
    }
    if (!reason) {
      throw new ApiError('You proposed this supplier yourself - overriding that as the MD requires a reason.', 400);
    }
  }

  if (['Suspended', 'Removed', 'Conditional', 'Candidate'].includes(status) && !reason) throw new ApiError(`Give the reason for ${status}.`, 400);
  const before = supplier.status;
  supplier.status = status;
  if (status === 'Approved' || status === 'Conditional') {
    supplier.approval.approvedBy = user._id;
    supplier.approval.approvedByName = user.name || null;
    supplier.approval.approvedAt = new Date();
    supplier.approval.reviewDate = reviewDate ? new Date(reviewDate) : new Date(Date.now() + 365 * 86400000);
  }
  supplier.notes.push({ by: user._id, byName: user.name || null, kind: 'status', text: `${before} -> ${status}${reason ? `: ${reason}` : '.'}` });
  await supplier.save();
  // Approving (or suspending) a supplier changes which price every item it quotes contributes to a
  // BOQ (supplierPricing.effectivePrice) - open revisions using those items are flagged "price
  // changed since calculation" (C24), exactly like a price list upload, never silently stale.
  const pricing = s => s === 'Approved' || s === 'Conditional';
  if (pricing(before) !== pricing(status)) {
    // eslint-disable-next-line global-require
    const MaterialItem = require('../../models/commercial/materialItemModel');
    // eslint-disable-next-line global-require
    const { flagOpenRevisions } = require('./priceListUploadService');
    const items = await MaterialItem.find({ archived: false, 'supplierPrices.supplier': supplier._id }).select('key model').lean();
    if (items.length) await flagOpenRevisions(items);
  }
  return shape(supplier);
}

async function addNote(id, body, { user, role }) {
  assertRole(role, [...EDIT_ROLES, 'sales'], 'Adding a supplier note');
  const supplier = await getSupplier(id);
  const t = text(body.text, 2000);
  if (!t) throw new ApiError('The note is empty.', 400);
  supplier.notes.push({ by: user._id, byName: user.name || null, kind: 'note', text: t });
  await supplier.save();
  return shape(supplier);
}

async function setScorecard(id, body, { user, role }) {
  assertRole(role, EDIT_ROLES, 'Updating the scorecard');
  const supplier = await getSupplier(id);
  const next = {};
  for (const k of ['price', 'quality', 'delivery', 'documentation', 'support']) {
    if (body[k] === undefined || body[k] === null || body[k] === '') continue;
    const v = Number(body[k]);
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new ApiError(`Scorecard ${k} must be a whole number from 1 to 5.`, 400);
    next[k] = v;
  }
  Object.assign(supplier.scorecard, next, { updatedAt: new Date() });
  supplier.notes.push({ by: user._id, byName: user.name || null, kind: 'scorecard', text: `Scorecard: ${Object.entries(next).map(([k, v]) => `${k} ${v}`).join(', ') || 'no change'}.${body.note ? ` ${text(body.note, 300)}` : ''}` });
  await supplier.save();
  return shape(supplier);
}

async function upsertDocument(id, body, { user, role }) {
  assertRole(role, EDIT_ROLES, 'Recording a supplier document');
  const supplier = await getSupplier(id);
  if (!DOCUMENT_KINDS.includes(body.kind)) throw new ApiError(`Document type must be one of: ${DOCUMENT_KINDS.join(', ')}.`, 400);
  const values = {
    kind: body.kind,
    name: text(body.name, 200),
    receivedAt: body.receivedAt ? new Date(body.receivedAt) : null,
    expiry: body.expiry ? new Date(body.expiry) : null,
    attachmentId: body.attachmentId && mongoose.isValidObjectId(body.attachmentId) ? body.attachmentId : null,
  };
  for (const k of ['receivedAt', 'expiry']) if (values[k] && Number.isNaN(values[k].getTime())) throw new ApiError(`${k} is not a valid date.`, 400);
  if (body.documentId) {
    const d = supplier.documents.id(body.documentId);
    if (!d) throw new ApiError('Document not found on this supplier.', 404);
    Object.assign(d, values);
  } else supplier.documents.push(values);
  supplier.notes.push({ by: user._id, byName: user.name || null, kind: 'document', text: `${values.kind}${values.expiry ? ` (expires ${values.expiry.toISOString().slice(0, 10)})` : ''} recorded.` });
  await supplier.save();
  return shape(supplier);
}

// ---------------------------------------------------------------- Feature 1.3: ERP Vendor sync
//
// CommercialSupplier (Deal Engine's approved-supplier master) and Vendor (the ERP procurement/
// accounting entity) are deliberately NEVER merged - see supplierModel.js#erpVendor's own comment.
// This section only manages the stable link between them: finding a real candidate to review (never
// auto-linking), linking an existing Vendor, or creating a new one from this supplier's own data.

/** Every stored spelling an Egyptian number may appear under - mirrors sharedCustomerService.js's identical helper for the same reason (a vendor's phone may be saved in any of them). */
function phoneVariants(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return [];
  const out = new Set([raw]);
  const e164 = normalizeEgyptianPhone(raw);
  if (e164) {
    out.add(e164);
    out.add(e164.slice(1)); // 201211892995
    out.add(`0${e164.slice(3)}`); // 01211892995
  }
  return [...out];
}

/**
 * Real ERP Vendor candidates for this supplier, for a human to review and confirm - NEVER
 * auto-linked. Matches by phone (any contact, any stored spelling) first (strongest signal, since
 * Vendor.contact.phone is unique), then by legal/trade name (case-insensitive, either direction),
 * excluding any Vendor already linked to a DIFFERENT supplier (the unique index would refuse it
 * anyway; this just keeps it out of the candidate list in the first place).
 */
async function findVendorCandidates(id) {
  const supplier = await getSupplier(id);
  const linkedElsewhere = await Supplier.find({ erpVendor: { $ne: null }, _id: { $ne: supplier._id } }).select('erpVendor').lean();
  const excludeIds = linkedElsewhere.map(s => s.erpVendor);

  const phones = (supplier.contacts || []).flatMap(c => phoneVariants(c.phone));
  const byPhone = phones.length ? await Vendor.find({ _id: { $nin: excludeIds }, 'contact.phone': { $in: phones } }).select('name vendorNumber contact.phone').lean() : [];

  const names = [supplier.legalName, supplier.tradeName].filter(Boolean).map(n => n.trim()).filter(Boolean);
  const nameRegexes = names.map(n => new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  const byName = nameRegexes.length ? await Vendor.find({ _id: { $nin: excludeIds }, name: { $in: nameRegexes } }).select('name vendorNumber contact.phone').lean() : [];

  const seen = new Map();
  for (const v of [...byPhone, ...byName]) seen.set(String(v._id), v);
  return [...seen.values()];
}

/** Links this supplier to an EXISTING ERP Vendor - never creates one. Refuses a Vendor already linked elsewhere (the unique index is the real backstop; this gives a clean message instead of a raw E11000). */
async function linkVendor(id, vendorId, { user, role }) {
  assertRole(role, EDIT_ROLES, 'Linking an ERP vendor');
  if (!mongoose.isValidObjectId(vendorId)) throw new ApiError('Invalid vendor id.', 400);
  const vendor = await Vendor.findById(vendorId).select('name vendorNumber').lean();
  if (!vendor) throw new ApiError('ERP vendor not found.', 404);
  const supplier = await getSupplier(id);
  const already = await Supplier.findOne({ erpVendor: vendorId, _id: { $ne: supplier._id } }).select('code legalName').lean();
  if (already) throw new ApiError(`Vendor "${vendor.name}" is already linked to supplier ${already.code} (${already.legalName}).`, 400);

  supplier.erpVendor = vendorId;
  supplier.notes.push({ by: user._id, byName: user.name || null, kind: 'vendor_sync', text: `Linked to existing ERP vendor #${vendor.vendorNumber} "${vendor.name}".` });
  await supplier.save();
  return shape(supplier);
}

/** Clears the link - never deletes the ERP Vendor itself, never touches its data. For correcting a mistaken link. */
async function unlinkVendor(id, { user, role }) {
  assertRole(role, EDIT_ROLES, 'Unlinking an ERP vendor');
  const supplier = await getSupplier(id);
  if (!supplier.erpVendor) throw new ApiError('This supplier has no linked ERP vendor.', 400);
  const was = supplier.erpVendor;
  // undefined (not null) - the sparse unique index only skips a field that is genuinely MISSING,
  // see erpVendor's own schema comment.
  supplier.erpVendor = undefined;
  supplier.notes.push({ by: user._id, byName: user.name || null, kind: 'vendor_sync', text: `Unlinked from ERP vendor ${was._id || was}.` });
  await supplier.save();
  return shape(supplier);
}

/**
 * Creates a NEW ERP Vendor from explicit fields the caller confirms (never silently copied from
 * the supplier - legalName often has characters/length Vendor.name's stricter validation rejects,
 * see vendor.js's own pattern; the frontend prefills, the user can edit, before this ever runs).
 * Vendor.contact.phone is required and unique - fails cleanly (via the schema's own validation)
 * rather than guessing one when the supplier's own contacts list is empty.
 */
async function createVendorFromSupplier(id, body, { user, role }) {
  assertRole(role, EDIT_ROLES, 'Creating an ERP vendor');
  const supplier = await getSupplier(id);
  if (supplier.erpVendor) throw new ApiError('This supplier is already linked to an ERP vendor - unlink it first if you need a different one.', 400);
  const name = text(body.name, 50);
  if (!name) throw new ApiError('Vendor name is required.', 400);
  const phone = text(body.phone, 40);
  if (!phone) throw new ApiError('Vendor phone is required.', 400);
  const email = text(body.email, 160).toLowerCase();

  const vendor = await Vendor.create({ name, contact: { phone, ...(email ? { email } : {}) } });
  supplier.erpVendor = vendor._id;
  supplier.notes.push({ by: user._id, byName: user.name || null, kind: 'vendor_sync', text: `Created and linked new ERP vendor #${vendor.vendorNumber} "${vendor.name}".` });
  await supplier.save();
  return shape(supplier);
}

module.exports = {
  listSuppliers, getSupplier, createSupplier, updateSupplier, setStatus, addNote, setScorecard, upsertDocument,
  findVendorCandidates, linkVendor, unlinkVendor, createVendorFromSupplier,
  reviewFlags, shape, EDIT_ROLES, STATUS_ROLES, DOCUMENT_KINDS, SUPPLIER_STATUSES,
};
