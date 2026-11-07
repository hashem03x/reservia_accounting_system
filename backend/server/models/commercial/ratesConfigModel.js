const { Schema, model } = require('mongoose');

// Reservia Commercial - per-country Rates Matrix (On_Grid.xlsx `Material Price List`!A104:F123,
// the only rates table any of the three workbooks define). One document per country, versioned by
// `effectiveDate` so a future rate change never alters a past revision's already-resolved numbers
// (every revision stores the exact install/transport rate it used - see commercialRevisionModel.js
// - so this collection only needs to answer "what does this region/band cost TODAY").
const ratesConfigSchema = new Schema(
  {
    country: { type: String, required: true, trim: true },
    regions: { type: [String], required: true },
    // Each array below is parallel to `regions`, one row of 5 size-band values per region (bands:
    // <=15, >15-30, >30-50, >50-100, >100 kWp - the Rates Matrix's own header labels).
    installRatesEgpPerKwpByRegion: { type: [[Number]], required: true },
    transportRatesEgpByRegion: { type: [[Number]], required: true },
    mountingStructureRatesEgpPerKwp: {
      Rooftop: { type: Number, required: true },
      'Ground Mounted': { type: Number, required: true },
      'Hangar Roof': { type: Number, required: true },
    },
    earthingRateEgpPerKwp: { type: Number, required: true, default: 100 },
    accessoriesRateEgpPerKwp: { type: Number, required: true, default: 85 },
    dcCableRouteMPerKwp: { type: Number, required: true, default: 8 },
    effectiveDate: { type: Date, required: true, default: Date.now },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

ratesConfigSchema.index({ country: 1, effectiveDate: -1 });

module.exports = model('CommercialRatesConfig', ratesConfigSchema);
