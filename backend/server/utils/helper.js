/**
 * Generate a unique 12-digit sales order code
 * Format: sequential number padded with leading zeros
 * Example: 000000000001, 000000000002, etc.
 */
const generateSalesOrderCode = async () => {
  const SalesOrder = require('../models/sales/salesOrderModel');

  // Get the count of all sales orders
  const count = await SalesOrder.countDocuments({});

  // Generate sequence number (padded with zeros to 12 digits)
  const nextNumber = count + 1;
  const code = nextNumber.toString().padStart(12, '0');

  return code;
};

/**
 * Generate a unique 12-digit purchase order code
 * Format: sequential number padded with leading zeros
 * Example: 000000000001, 000000000002, etc.
 */
const generatePurchaseOrderCode = async () => {
  const PurchaseOrder = require('../models/vendor/purchaseOrder');

  // Get the count of all purchase orders
  const count = await PurchaseOrder.countDocuments({});

  // Generate sequence number (padded with zeros to 12 digits)
  const nextNumber = count + 1;
  const code = nextNumber.toString().padStart(12, '0');

  return code;
};

// =============================================================
// Order helper functions
// =============================================================

// calc unitPriceAfterDiscount
const calculateUnitPriceAfterDiscount = (type, value, unitPrice) => {
  const discount = type === 'percentage' ? (unitPrice * value) / 100 : value;
  return unitPrice - discount;
};

// calc starterSubtotal
const calculateStarterSubtotal = (unitPriceAfterDiscount, quantity) => {
  return unitPriceAfterDiscount * quantity;
};

// calc subtotal
const calculateSubtotal = (unitPriceAfterDiscount, quantity, returnedQuantity) => {
  return unitPriceAfterDiscount * (quantity - returnedQuantity);
};

// calc starterTotalAmount
const calculateStarterTotalAmount = items => {
  return items.reduce((acc, item) => acc + item.starterSubtotal, 0);
};

// calc totalAmount
const calculateTotalAmount = items => {
  return items.reduce((acc, item) => acc + item.subtotal, 0);
};

// calc remainingAmount
const calculateRemainingAmount = (totalAmount, paidAmount) => {
  return totalAmount - paidAmount;
};

const getPaymentStatus = (paidAmount, totalAmount) => {
  if (paidAmount === totalAmount) return 'paid';
  if (paidAmount > 0 && paidAmount < totalAmount) return 'partial';
  if (paidAmount === 0) return 'unpaid';
  return 'unknown';
};

// =============================================================

// Recovers the real tag(s) a corrupted stored value actually meant. Historical/legacy data (and
// any future bug that re-introduces the same shape) can leave a tag as a JSON-encoded array
// ('["t-shirts"]'), a JSON-quoted string ('"hoodies"'), or a Python-style single-quoted list
// literal ("['t-shirts']") instead of the plain string it should be - these all pass a naive
// "is this an array of strings?" check because the OUTER value is a fine array, it's the
// individual STRING ELEMENTS that are themselves malformed. Unwraps recursively (capped, so a
// pathological input can't loop forever) since corruption has been seen double- and triple-
// encoded. A corrupted element can expand into MORE than one real tag (e.g.
// "['t-shirts', 'summer']" -> two tags), which is why this returns an array, not a single string.
const unwrapCorruptedTag = (raw, depth = 0) => {
  if (depth > 5) return [raw];
  const trimmed = raw.trim();

  // Real JSON first - handles '["t-shirts"]' and '"hoodies"'.
  if (/^(\[.*\]|".*")$/.test(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.flatMap(item => (typeof item === 'string' ? unwrapCorruptedTag(item, depth + 1) : []));
      }
      if (typeof parsed === 'string') return unwrapCorruptedTag(parsed, depth + 1);
    } catch (err) {
      // Not valid JSON (e.g. single-quoted Python-style list) - fall through to the next case.
    }
  }

  // Python-style single-quoted list literal, e.g. "['t-shirts', 'summer']" - not valid JSON
  // (JSON requires double quotes), so this can't go through JSON.parse above.
  if (/^\[.*\]$/.test(trimmed)) {
    const inner = trimmed.slice(1, -1);
    if (inner.trim() === '') return [];
    return inner
      .split(',')
      .map(part => part.trim().replace(/^['"]|['"]$/g, ''))
      .flatMap(part => unwrapCorruptedTag(part, depth + 1));
  }

  return [trimmed];
};

// Trims whitespace, drops empty values, removes exact-duplicate tags (first occurrence wins,
// order otherwise preserved), and repairs any corrupted element via unwrapCorruptedTag - shared
// by the product create/update validators so "Summer", "Summer", "  Cotton ", '["t-shirts"]' all
// normalize the same way everywhere tags are accepted, whether from a fresh edit or legacy data.
const normalizeTags = tags => {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const normalized = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    for (const candidate of unwrapCorruptedTag(tag)) {
      const trimmed = candidate.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      normalized.push(trimmed);
    }
  }
  return normalized;
};

// =============================================================

const genBarcode = () => Math.floor(1000 + Math.random() * 9000);

// Helper function to delete image file
const deleteImage = async filename => {
  try {
    if (!filename) return;
    const filepath = path.join(process.cwd(), 'uploads', 'products', filename);
    await fs.unlink(filepath);
  } catch (error) {
    console.error('Error deleting file:', error);
  }
};

module.exports = {
  generateSalesOrderCode,
  generatePurchaseOrderCode,
  calculateUnitPriceAfterDiscount,
  calculateStarterSubtotal,
  calculateSubtotal,
  calculateStarterTotalAmount,
  calculateTotalAmount,
  calculateRemainingAmount,
  getPaymentStatus,
  normalizeTags,
  unwrapCorruptedTag,
  genBarcode,
  deleteImage,
};
