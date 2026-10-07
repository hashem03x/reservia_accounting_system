const { Schema, model } = require('mongoose');

// Generic atomic sequence counter. One document per named sequence (e.g. "customerNumber").
// `seq` is the last number handed out; `min`/`max` fence the configurable range a given sequence
// is allowed to issue numbers from. Incrementing is done exclusively via findOneAndUpdate($inc),
// which MongoDB executes atomically server-side - this is what makes concurrent
// createCustomer requests safe (see customerNumberService.js), unlike the pre-existing
// `countDocuments() + 1` pattern used elsewhere in this codebase for order/PO codes (see
// utils/helper.js) which is race-prone and was NOT reused here on purpose.
const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, required: true },
  min: { type: Number, required: true },
  max: { type: Number, required: true },
});

module.exports = model('Counter', counterSchema);
