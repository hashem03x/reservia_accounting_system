const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const ExcelJS = require('exceljs');
const DisclosureNote = require('../../models/reports/disclosureNoteModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { REPORTS_BY_KEY, CATEGORIES, catalog } = require('../../services/reports/reportRegistry');
const { taxAccountOptions } = require('../../services/reports/taxReports');

// Accounting reports (services/reports/*): read-only - running, exporting or printing a report
// never creates, updates or deletes an accounting record.

const PAGE_SIZE_DEFAULT = 100;
const PAGE_SIZE_MAX = 1000;

async function runReport(key, query) {
  const report = REPORTS_BY_KEY.get(key);
  if (!report) throw new ApiError(`Unknown report "${key}".`, 404);
  const result = await report.run(query);
  const appliedFilters = Object.fromEntries(Object.entries(query).filter(([k, v]) => !['page', 'pageSize', 'lang', 'all'].includes(k) && v !== '' && v != null));
  return {
    key: report.key,
    category: report.category,
    categoryTitle: CATEGORIES.find(c => c.key === report.category).title,
    kind: report.kind,
    title: report.title,
    filters: appliedFilters,
    generatedAt: new Date().toISOString(),
    currency: 'EGP',
    ...result,
  };
}

const getCatalog = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Reports retrieved successfully', true, catalog()));
});

// GET /accounting-reports/tax-accounts - the tax accounts found in the Chart of Accounts and the
// tax reports each belongs to (the tax reports' account filter).
const getTaxAccounts = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Tax accounts retrieved successfully', true, await taxAccountOptions()));
});

// GET /accounting-reports/:key - sections flagged `paginate` return one page of rows (totals are
// always computed over every row); `all=true` (printing) returns every row.
const getReport = asyncHandler(async (req, res) => {
  const result = await runReport(req.params.key, req.query);
  if (req.query.all === 'true') return res.status(200).json(apiResponse('Report generated successfully', true, result));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(req.query.pageSize, 10) || PAGE_SIZE_DEFAULT));
  result.sections = (result.sections || []).map(section => {
    if (!section.paginate) return section;
    const totalRows = section.rows.length;
    return { ...section, rows: section.rows.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, totalRows, totalPages: Math.max(1, Math.ceil(totalRows / pageSize)) } };
  });
  res.status(200).json(apiResponse('Report generated successfully', true, result));
});

// ---------------------------------------------------------------- Excel export (every row)
const text = (row, key, lang) => (lang === 'ar' && row[`${key}Ar`] != null ? row[`${key}Ar`] : row[key]);

function cellValue(column, row, lang) {
  const value = text(row, column.key, lang);
  if (value === null || value === undefined) return column.type === 'money' || column.type === 'percent' ? (lang === 'ar' ? 'غير متاح' : 'n/a') : '';
  if (column.type === 'date') return new Date(value);
  if (column.type === 'percent') return value / 100;
  return value;
}

function describeFilters(result, lang) {
  const f = result.filters || {};
  const period = result.period ? `${result.period.from} → ${result.period.to}` : null;
  const asOf = result.asOf || null;
  const rest = Object.entries(f).filter(([k]) => !['from', 'to', 'asOf'].includes(k));
  return [
    ...(period ? [[lang === 'ar' ? 'الفترة' : 'Period', period]] : []),
    ...(asOf ? [[lang === 'ar' ? 'في تاريخ' : 'As of', asOf]] : []),
    ...(rest.length ? [[lang === 'ar' ? 'الفلاتر' : 'Filters', rest.map(([k, v]) => `${k}: ${v}`).join(', ')]] : []),
    [lang === 'ar' ? 'تاريخ الإنشاء' : 'Generated', new Date(result.generatedAt).toISOString().replace('T', ' ').slice(0, 16)],
    [lang === 'ar' ? 'العملة' : 'Currency', result.currency],
  ];
}

async function buildWorkbook(result, lang) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Reservia';
  const usedNames = new Set();
  const sheetName = name => {
    let base = String(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 28) || 'Sheet';
    let candidate = base;
    for (let i = 2; usedNames.has(candidate); i += 1) candidate = `${base.slice(0, 25)} ${i}`;
    usedNames.add(candidate);
    return candidate;
  };
  const title = result.title[lang] || result.title.en;

  for (const section of result.sections || []) {
    const ws = workbook.addWorksheet(sheetName(section.title[lang] || section.title.en), { views: [{ rightToLeft: lang === 'ar' }] });
    ws.addRow([title]).font = { bold: true, size: 14 };
    ws.addRow([section.title[lang] || section.title.en]).font = { bold: true };
    describeFilters(result, lang).forEach(r => ws.addRow(r));
    ws.addRow([]);
    const header = ws.addRow(section.columns.map(c => c.label[lang] || c.label.en));
    header.font = { bold: true };
    header.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    });
    const formatRow = (excelRow, isTotal) => {
      section.columns.forEach((c, i) => {
        const cell = excelRow.getCell(i + 1);
        if (c.type === 'money') cell.numFmt = '#,##0.00;[Red]-#,##0.00';
        if (c.type === 'percent') cell.numFmt = '0.00%';
        if (c.type === 'date') cell.numFmt = 'yyyy-mm-dd';
        if (isTotal) cell.font = { bold: true };
      });
    };
    section.rows.forEach(row => {
      const excelRow = ws.addRow(section.columns.map(c => cellValue(c, row, lang)));
      formatRow(excelRow, row._rowType === 'subtotal' || row._rowType === 'total' || row._rowType === 'header');
    });
    if (section.totals) {
      const totalsRow = ws.addRow(section.columns.map(c => cellValue(c, section.totals, lang)));
      formatRow(totalsRow, true);
      totalsRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      });
    }
    section.columns.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.type === 'money' ? 18 : c.type === 'longtext' ? 60 : c.type === 'percent' || c.type === 'number' ? 12 : 28;
    });
  }

  const info = workbook.addWorksheet(sheetName(lang === 'ar' ? 'المراجعة والملاحظات' : 'Checks and Notes'), { views: [{ rightToLeft: lang === 'ar' }] });
  info.addRow([title]).font = { bold: true, size: 14 };
  (result.summary || []).forEach(s => info.addRow([s.label[lang] || s.label.en, s.value ?? (lang === 'ar' ? 'غير متاح' : 'n/a')]));
  info.addRow([]);
  (result.checks || []).forEach(c => info.addRow([c.label[lang] || c.label.en, c.ok ? (lang === 'ar' ? 'متطابق' : 'OK') : lang === 'ar' ? 'غير متطابق' : 'MISMATCH', c.detail || '']));
  info.addRow([]);
  (result.notes || []).forEach(n => info.addRow([n[lang] || n.en]));
  info.getColumn(1).width = 60;
  info.getColumn(2).width = 20;
  info.getColumn(3).width = 30;
  return workbook;
}

// GET /accounting-reports/:key/export?lang=en|ar - the same report with every row, as .xlsx.
const exportReport = asyncHandler(async (req, res) => {
  const lang = req.query.lang === 'ar' ? 'ar' : 'en';
  const result = await runReport(req.params.key, req.query);
  const workbook = await buildWorkbook(result, lang);
  const filename = `${result.key}-${(result.period?.to || result.asOf || new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, '')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
});

// ---------------------------------------------------------------- disclosure notes (text only)
const pickNote = body => {
  const out = {};
  ['title', 'titleAr', 'body', 'bodyAr', 'sortOrder', 'isActive'].forEach(k => {
    if (body[k] !== undefined) out[k] = body[k];
  });
  return out;
};

const getDisclosureNotes = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Disclosure notes retrieved successfully', true, await DisclosureNote.find({}).sort({ sortOrder: 1, createdAt: 1 }).lean()));
});

const createDisclosureNote = asyncHandler(async (req, res) => {
  const note = await DisclosureNote.create({ ...pickNote(req.body), createdBy: req.user._id });
  res.status(201).json(apiResponse('Disclosure note created successfully', true, note));
});

const updateDisclosureNote = asyncHandler(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return next(new ApiError('Invalid note id', 400));
  const note = await DisclosureNote.findByIdAndUpdate(req.params.id, { $set: { ...pickNote(req.body), updatedBy: req.user._id } }, { new: true, runValidators: true });
  if (!note) return next(new ApiError('Disclosure note not found', 404));
  res.status(200).json(apiResponse('Disclosure note updated successfully', true, note));
});

const deleteDisclosureNote = asyncHandler(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return next(new ApiError('Invalid note id', 400));
  const note = await DisclosureNote.findByIdAndDelete(req.params.id);
  if (!note) return next(new ApiError('Disclosure note not found', 404));
  res.status(204).send();
});

module.exports = { getCatalog, getTaxAccounts, getReport, exportReport, runReport, buildWorkbook, getDisclosureNotes, createDisclosureNote, updateDisclosureNote, deleteDisclosureNote };
