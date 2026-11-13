'use strict';

const mongoose = require('mongoose');

// Reservia HR Portal (HR Portal Developer Spec section 4). One model per table of the spec, mapped
// one to one to the reference prototype's collections so its example data loads unchanged (field
// names follow the prototype: hire, end, cstart, cend, probEnd, paym, ...).
//
// Built inside the existing portal (one login, one database, systemMemberships role 'HR') instead of
// the spec's PostgreSQL schema - the project brief requires the existing architecture; see the
// delivery report. Every collection is prefixed `hr`.
//
// Pay fields (basic, transport, incentive, commission, other, insurable wage override) never sit in
// clear: they are one AES-256-GCM box per employee (`payBox`, services/hr/hrCrypto.js), as are the
// frozen payroll lines. National ID and bank account numbers are deliberately NOT fields (spec
// section 10: "Not stored").

const { Schema } = mongoose;
const ref = name => ({ type: Schema.Types.ObjectId, ref: name });
const audit = { createdBy: ref('User'), updatedBy: ref('User') };
const opts = { timestamps: true, minimize: false };
const exampleFields = { example: { type: Boolean, default: false }, key: { type: String, default: null } };

const docEntry = new Schema({ st: { type: String, enum: ['pending', 'ok', 'na'] }, date: String, exp: String, loc: String }, { _id: false });

const employeeSchema = new Schema(
  {
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, default: '' }, // job title
    dept: { type: String, default: 'Admin' },
    status: { type: String, enum: ['Active', 'Probation', 'Left'], default: 'Probation' },
    type: { type: String, default: 'Full time' },
    hire: { type: String, required: true }, // YYYY-MM-DD
    end: { type: String, default: '' },
    city: { type: String, default: '' },
    mgr: { type: String, default: '' }, // "Reports to" as printed (the MD is not an employee record)
    mgrId: ref('HrEmployee'),
    user: ref('User'), // the portal login of this person, when they have one (line-manager scope)
    phone: String,
    email: String,
    emg: String,
    emgp: String,
    file: String, // personnel file location
    nat: { type: String, default: 'Egyptian' },
    sin: String, // social insurance number
    edu: String,
    // Contract (one current contract; earlier versions kept in `contractHistory`).
    cno: String,
    offerDate: String,
    cstart: String,
    cend: String,
    probEnd: String,
    paym: { type: String, default: 'Bank transfer' },
    insured: { type: Boolean, default: true },
    signedFile: String,
    payBox: { type: String, default: null }, // encrypted { basic, transport, incentive, commission, other, insBase }
    contractHistory: [{ at: Date, by: ref('User'), cno: String, cstart: String, cend: String, payBox: String, _id: false }],
    docs: { type: Map, of: docEntry, default: {} },
    exit: { last: String, reason: String, steps: { type: Map, of: Boolean, default: {} } },
    ...exampleFields,
    ...audit,
  },
  opts
);
employeeSchema.index({ code: 1 }, { unique: true });

const attendanceSchema = new Schema(
  {
    employee: { ...ref('HrEmployee'), required: true },
    month: { type: String, required: true },
    // DD -> { s, in, out, n, src }. src: manual | form | device (the device API comes in Phase 3).
    days: { type: Schema.Types.Mixed, default: {} },
    approval: { at: Date, by: ref('User'), byName: String },
    ...exampleFields,
    ...audit,
  },
  opts
);
attendanceSchema.index({ employee: 1, month: 1 }, { unique: true });

const visitSchema = new Schema(
  {
    employee: { ...ref('HrEmployee'), required: true },
    date: { type: String, required: true },
    city: String,
    site: String,
    purpose: String,
    status: { type: String, enum: ['Planned', 'Done', 'Cancelled'], default: 'Planned' },
    days: { type: Number, default: 1 },
    nights: { type: Number, default: 0 },
    transport: Number,
    accom: Number,
    meals: Number,
    mealsProvided: { type: Boolean, default: false },
    ref: String, // CRM lead or project reference
    notes: String,
    report: String, // HR-F04, due within 24 hours of return
    form: ref('HrForm'),
    ...exampleFields,
    ...audit,
  },
  opts
);
visitSchema.index({ date: 1 });

const expenseSchema = new Schema(
  {
    employee: { ...ref('HrEmployee'), required: true },
    date: String,
    type: String,
    amount: { type: Number, required: true },
    payMonth: String,
    ref: String,
    desc: String,
    receipt: { type: Boolean, default: false },
    receiptFile: String,
    receiptOverride: { type: Boolean, default: false }, // MD let it through without a receipt
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    by: String, // decided by (name)
    decidedBy: ref('User'),
    decided: String,
    note: String,
    created: String,
    ...exampleFields,
    ...audit,
  },
  opts
);

const formSchema = new Schema(
  {
    ft: { type: String, enum: ['leave', 'ot', 'visit'], required: true }, // HR-F01, F02, F03 (F04-F06 live on their records)
    employee: { ...ref('HrEmployee'), required: true },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    // leave
    ltype: String, from: String, to: String, days: Number, cover: String, phone: String,
    // overtime
    odate: String, kind: String, hours: Number, site: String,
    // visit (from / days / site shared above)
    city: String, purpose: String, nights: Number, back: String, transport: String, stay: String, meals: String, ref: String,
    reason: String,
    exception: { type: Boolean, default: false }, // an overtime request dated in the past
    by: String, // decided by (name)
    decidedBy: ref('User'),
    decided: String,
    dnote: String,
    created: String,
    visit: ref('HrVisit'),
    ...exampleFields,
    ...audit,
  },
  opts
);

const targetSchema = new Schema(
  { employee: { ...ref('HrEmployee'), required: true }, month: { type: String, required: true }, pct: { type: Number, required: true }, setBy: ref('User'), setByName: String, ...exampleFields },
  opts
);
targetSchema.index({ employee: 1, month: 1 }, { unique: true });

const adjustmentSchema = new Schema(
  { employee: { ...ref('HrEmployee'), required: true }, month: { type: String, required: true }, label: String, type: { type: String, enum: ['add', 'ded'] }, amount: Number, taxable: { type: Boolean, default: true }, ...audit },
  opts
);

const payrollRunSchema = new Schema(
  {
    month: { type: String, required: true },
    status: { type: String, enum: ['draft', 'review', 'approved', 'closed'], default: 'draft' },
    log: [{ s: String, by: ref('User'), byName: String, at: Date, note: String, _id: false }],
    rowsBox: { type: String, default: null }, // encrypted frozen payroll_lines, written on close
    closedAt: Date,
    version: { type: Number, default: 0 }, // incremented on every close; payslip PDFs keep each version
    erp: { at: Date, by: ref('User'), byName: String, ok: Boolean, status: Number, reference: String, error: String, attempts: { type: Number, default: 0 }, version: Number },
    ...audit,
  },
  opts
);
payrollRunSchema.index({ month: 1 }, { unique: true });

const payslipFileSchema = new Schema(
  { month: String, employee: ref('HrEmployee'), code: String, version: Number, pdf: Buffer, sha256: String, createdBy: ref('User') },
  { timestamps: true }
);
payslipFileSchema.index({ month: 1, employee: 1, version: 1 }, { unique: true });

const emailLogSchema = new Schema(
  { month: String, employee: ref('HrEmployee'), to: String, status: { type: String, enum: ['sent', 'failed'] }, error: String, by: ref('User'), byName: String },
  { timestamps: true }
);

const trainingSchema = new Schema(
  { employee: { ...ref('HrEmployee'), required: true }, kind: String, course: String, provider: String, date: String, hours: Number, exp: String, cost: Number, cert: Boolean, certificateFile: String, ...exampleFields, ...audit },
  opts
);

const assetSchema = new Schema(
  { employee: { ...ref('HrEmployee'), required: true }, type: String, desc: String, serial: String, issued: String, returned: String, cond: String, value: Number, note: String, ...exampleFields, ...audit },
  opts
);

const performanceSchema = new Schema(
  { employee: { ...ref('HrEmployee'), required: true }, cycle: String, date: String, by: String, goals: [{ t: String, w: Number, s: Number, _id: false }], rating: Number, note: String, ...exampleFields, ...audit },
  opts
);

const candidateSchema = new Schema(
  { name: { type: String, required: true }, role: String, dept: String, stage: { type: String, default: 'Applied' }, src: String, phone: String, email: String, offer: Number, start: String, notes: String, employee: ref('HrEmployee'), ...exampleFields, ...audit },
  opts
);

// Settings (spec section 5): versioned - a change keeps the old values with the month they applied
// from, so a reopened month recalculates with the rates of its own time.
const settingsSchema = new Schema({ effectiveMonth: { type: String, required: true }, values: { type: Schema.Types.Mixed, default: {} }, note: String, by: ref('User'), byName: String }, { timestamps: true, minimize: false });
settingsSchema.index({ effectiveMonth: 1, createdAt: 1 });

// Audit log (spec section 10): every write - who, when, before and after. Pay values inside
// before/after are boxed the same way as on the record.
const auditSchema = new Schema(
  { table: String, rowId: String, action: String, before: Schema.Types.Mixed, after: Schema.Types.Mixed, user: ref('User'), userName: String, note: String },
  { timestamps: { createdAt: 'at', updatedAt: false } }
);
auditSchema.index({ table: 1, rowId: 1, at: -1 });

const model = (name, schema, collection) => mongoose.models[name] || mongoose.model(name, schema, collection);

module.exports = {
  HrEmployee: model('HrEmployee', employeeSchema, 'hremployees'),
  HrAttendance: model('HrAttendance', attendanceSchema, 'hrattendances'),
  HrVisit: model('HrVisit', visitSchema, 'hrvisits'),
  HrExpense: model('HrExpense', expenseSchema, 'hrexpenses'),
  HrForm: model('HrForm', formSchema, 'hrforms'),
  HrTarget: model('HrTarget', targetSchema, 'hrtargets'),
  HrAdjustment: model('HrAdjustment', adjustmentSchema, 'hradjustments'),
  HrPayrollRun: model('HrPayrollRun', payrollRunSchema, 'hrpayrollruns'),
  HrPayslipFile: model('HrPayslipFile', payslipFileSchema, 'hrpayslipfiles'),
  HrEmailLog: model('HrEmailLog', emailLogSchema, 'hremaillogs'),
  HrTraining: model('HrTraining', trainingSchema, 'hrtrainings'),
  HrAsset: model('HrAsset', assetSchema, 'hrassets'),
  HrPerformance: model('HrPerformance', performanceSchema, 'hrperformances'),
  HrCandidate: model('HrCandidate', candidateSchema, 'hrcandidates'),
  HrSettings: model('HrSettings', settingsSchema, 'hrsettings'),
  HrAudit: model('HrAudit', auditSchema, 'hraudits'),
};
