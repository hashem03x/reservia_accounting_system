const CompanySetting = require('../../models/config/companySettingModel');
const ApiError = require('../../utils/apiError');

// ERP company-level controls - see models/config/companySettingModel.js.
const DEFAULTS = Object.freeze({ vatDefaultPct: 14, priceVarianceWarnPct: 20, preventNegativeProjectStock: true });
const FIELDS = Object.keys(DEFAULTS);

function shape(doc) {
  const out = { ...DEFAULTS };
  if (doc) for (const k of FIELDS) if (doc[k] !== undefined && doc[k] !== null) out[k] = doc[k];
  return out;
}

/** The current settings, with defaults for anything never saved. */
async function getCompanySettings({ session } = {}) {
  const doc = await CompanySetting.findById('company').session(session || null).lean();
  return shape(doc);
}

/** The settings plus the last changes, for the settings page. */
async function getCompanySettingsWithHistory() {
  const doc = await CompanySetting.findById('company').lean();
  return { ...shape(doc), history: (doc?.history || []).slice(-20).reverse(), updatedAt: doc?.updatedAt || null };
}

function validate(patch) {
  const clean = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!FIELDS.includes(k)) continue;
    if (k === 'preventNegativeProjectStock') {
      if (typeof v !== 'boolean') throw new ApiError('preventNegativeProjectStock must be true or false.', 400);
      clean[k] = v;
    } else {
      const n = Number(v);
      if (v === '' || v === null || !Number.isFinite(n)) throw new ApiError(`${k} must be a number.`, 400);
      if (k === 'vatDefaultPct' && (n < 0 || n > 100)) throw new ApiError('The default VAT rate must be between 0 and 100%.', 400);
      if (k === 'priceVarianceWarnPct' && (n < 1 || n > 1000)) throw new ApiError('The price variance warning must be between 1 and 1000%.', 400);
      clean[k] = Math.round(n * 100) / 100;
    }
  }
  if (!Object.keys(clean).length) throw new ApiError('Nothing to change.', 400);
  return clean;
}

/** Changes some settings and records who changed what. */
async function updateCompanySettings(patch, user) {
  const clean = validate(patch);
  const before = await getCompanySettings();
  const changes = {};
  for (const [k, v] of Object.entries(clean)) if (before[k] !== v) changes[k] = { from: before[k], to: v };
  if (!Object.keys(changes).length) return getCompanySettingsWithHistory();
  await CompanySetting.updateOne(
    { _id: 'company' },
    { $set: clean, $push: { history: { at: new Date(), by: user?._id || null, byName: user?.name || null, changes } } },
    { upsert: true }
  );
  return getCompanySettingsWithHistory();
}

module.exports = { DEFAULTS, getCompanySettings, getCompanySettingsWithHistory, updateCompanySettings };
