/**
 * Vendor Payment Terms - Lump Sum and Installments (docs section "Vendor Payment Terms").
 * Pure, DB-free validation of a `paymentTermsConfig` value - the single source of truth shared by
 * the Mongoose model (vendor.js) and the request validator (vendorValidators.js), the same
 * "pure function, shared by both layers" convention as utils/productTypeValidation.js.
 *
 * Shape:
 *   { kind: 'lump_sum', lumpSum: { timing: 'immediate' } }
 *   { kind: 'lump_sum', lumpSum: { timing: 'deferred', durationDays: 30 } }
 *   { kind: 'installments', installments: [{ durationDays: 30, percentage: 40 }, ...] }
 *
 * An installment's durationDays counts from the PREVIOUS installment (the first from the document
 * date) - e.g. 20 + 10 = due on day 20 and day 30 (utils/helpers/paymentSchedule.js).
 *
 * Returns an error message string, or null when the config is valid.
 */

const { PaymentTerms } = require('./paymentTerms');

const PERCENTAGE_TOLERANCE = 0.01; // Explicit, small floating-point tolerance for the 100% sum check.

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validatePaymentTermsConfig(config) {
  if (config == null) return null; // Not provided - caller keeps whatever default/existing value applies.

  if (!config || typeof config !== 'object') return 'paymentTermsConfig must be an object.';

  if (!['lump_sum', 'installments'].includes(config.kind)) {
    return 'paymentTermsConfig.kind must be either "lump_sum" or "installments".';
  }

  if (config.kind === 'lump_sum') {
    const lumpSum = config.lumpSum || {};
    if (!['immediate', 'deferred'].includes(lumpSum.timing)) {
      return 'A lump-sum payment term requires timing to be "immediate" or "deferred".';
    }
    if (lumpSum.timing === 'immediate') {
      if (lumpSum.durationDays != null && lumpSum.durationDays !== 0) {
        return 'An immediate lump-sum payment must have a duration of zero.';
      }
    } else {
      // deferred
      if (!isNonNegativeInteger(lumpSum.durationDays) || lumpSum.durationDays <= 0) {
        return 'A deferred lump-sum payment requires a positive, whole number of days.';
      }
    }
    return null;
  }

  // config.kind === 'installments'
  const installments = config.installments;
  if (!Array.isArray(installments) || installments.length === 0) {
    return 'An installment payment term requires at least one installment.';
  }

  let percentageTotal = 0;
  for (let i = 0; i < installments.length; i += 1) {
    const installment = installments[i];
    const label = `Installment ${i + 1}`;
    if (!installment || typeof installment !== 'object') return `${label} is invalid.`;
    if (!isNonNegativeInteger(installment.durationDays)) {
      return `${label}: duration must be a non-negative whole number of days.`;
    }
    if (typeof installment.percentage !== 'number' || Number.isNaN(installment.percentage)) {
      return `${label}: percentage must be a number.`;
    }
    if (!(installment.percentage > 0)) {
      return `${label}: percentage must be greater than zero.`;
    }
    percentageTotal += installment.percentage;
  }

  if (Math.abs(percentageTotal - 100) > PERCENTAGE_TOLERANCE) {
    return `Installment percentages must sum to 100% (currently ${percentageTotal.toFixed(2)}%).`;
  }

  return null;
}

<<<<<<< HEAD
/**
 * Cross-field rule: whenever installments are enabled (paymentTermsConfig.kind ===
 * 'installments'), the vendor's own Payment Terms (paymentTerms / customPaymentDays) become
 * mandatory - the installment schedule's own validation (above) only checks the installment rows
 * themselves, it never looks at the sibling paymentTerms field, so this is deliberately separate.
 * Pure, DB-free - callers (vendor.js's pre-save hook, vendorValidators.js) are responsible for
 * resolving the EFFECTIVE values first (e.g. falling back to the stored document on a partial
 * update that doesn't touch these fields).
 *
 * Returns an error message, or null when the rule doesn't apply / is satisfied.
 */
function validateInstallmentsRequirePaymentTerms(paymentTermsConfig, paymentTerms, customPaymentDays) {
  if (!paymentTermsConfig || paymentTermsConfig.kind !== 'installments') return null;

  if (!paymentTerms) {
    return 'Payment terms are required when installments are enabled.';
  }
  if (!PaymentTerms.includes(paymentTerms)) {
    return `Invalid payment term. Choose from ${PaymentTerms.map(t => `"${t}"`).join(', ')}`;
  }
  if (paymentTerms === 'Custom' && (customPaymentDays === undefined || customPaymentDays === null || customPaymentDays === '')) {
    return 'customPaymentDays is required when paymentTerms is "Custom" and installments are enabled.';
  }
  return null;
}

module.exports = { validatePaymentTermsConfig, validateInstallmentsRequirePaymentTerms, PERCENTAGE_TOLERANCE };
=======
// Immediate payment terms always mean one payment due at once - whatever schedule was sent.
const IMMEDIATE_PAYMENT_TERMS_CONFIG = Object.freeze({ kind: 'lump_sum', lumpSum: { timing: 'immediate', durationDays: 0 }, installments: [] });

/**
 * The schedule against the vendor's Payment Terms: with Custom terms, installment days (each from
 * the previous installment) must add up to the custom number of days. Returns an error or null.
 * Mirrored by the vendor modal (vendor-modal/payment-terms-config-section.tsx).
 */
function validateScheduleAgainstPaymentTerms(paymentTerms, customPaymentDays, config) {
  if (paymentTerms !== 'Custom' || !config || config.kind !== 'installments') return null;
  const termDays = Number(customPaymentDays);
  if (customPaymentDays == null || customPaymentDays === '' || !Number.isInteger(termDays) || termDays < 0) return null;
  const totalDays = (config.installments || []).reduce((sum, i) => sum + (Number(i?.durationDays) || 0), 0);
  if (totalDays > termDays) return `Installment days total ${totalDays}, which exceeds the ${termDays}-day payment term by ${totalDays - termDays} day(s).`;
  if (totalDays < termDays) return `Installment days total ${totalDays} - ${termDays - totalDays} day(s) remaining to complete the ${termDays}-day payment term.`;
  return null;
}

module.exports = { validatePaymentTermsConfig, validateScheduleAgainstPaymentTerms, IMMEDIATE_PAYMENT_TERMS_CONFIG, PERCENTAGE_TOLERANCE };
>>>>>>> origin/main
