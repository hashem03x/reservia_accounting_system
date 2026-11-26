'use strict';

const ExcelJS = require('exceljs');
const mongoose = require('mongoose');
const ApiError = require('../../utils/apiError');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const MaterialItem = require('../../models/commercial/materialItemModel');
const { PROJECT_TAB_MATRIX, widestLevel, canView, canSeePricing, scrubMoneyText } = require('../../utils/commercial/dealEnginePermissions');

// Deal Engine - export one revision's BOQ (Excel or CSV). Built from the STORED revision in MongoDB
// (never the dashboard's state), so the file is exactly what was calculated and saved. The current
// revision is exported unless the caller names a historical one. Cost columns follow the same R12
// matrix as the API (dealEnginePermissions.js#shapeRevisionForRole): a role that cannot see BOQ
// costs gets the quantities without prices, and the pricing summary needs Pricing access.

const PRICE_SOURCE_LABEL = {
  supplier: 'Supplier price list',
  reference: 'Price Book reference price',
};

const COLUMNS = [
  { key: 'lineNo', header: 'Item No', width: 8 },
  { key: 'category', header: 'Category', width: 20 },
  { key: 'subcategory', header: 'Subcategory', width: 24 },
  { key: 'product', header: 'Item / Product', width: 34 },
  { key: 'description', header: 'Description', width: 44 },
  { key: 'specs', header: 'Technical Specifications', width: 36 },
  { key: 'unit', header: 'Unit', width: 9 },
  { key: 'qty', header: 'Quantity', width: 11, num: '#,##0.###' },
  { key: 'unitPrice', header: 'Unit Price', width: 15, num: '#,##0.00', cost: true },
  { key: 'total', header: 'Total Price', width: 17, num: '#,##0.00', cost: true },
  { key: 'currency', header: 'Currency', width: 9, cost: true },
  { key: 'supplierName', header: 'Supplier Name', width: 28, cost: true },
  { key: 'supplierCode', header: 'Supplier Code', width: 12, cost: true },
  { key: 'quoteCurrency', header: 'Quote Currency', width: 10, cost: true },
  { key: 'foreignPrice', header: 'Quoted Price (foreign)', width: 14, num: '#,##0.00', cost: true },
  { key: 'fxRate', header: 'Exchange Rate', width: 11, num: '#,##0.0000', cost: true },
  { key: 'priceSource', header: 'Pricing Source', width: 24, cost: true },
  { key: 'priceReference', header: 'Pricing Reference', width: 44, cost: true },
  { key: 'lineSource', header: 'Line Source', width: 11 },
  { key: 'autoQty', header: 'Auto Quantity', width: 11, num: '#,##0.###' },
  { key: 'autoUnitPrice', header: 'Auto Unit Price', width: 14, num: '#,##0.00', cost: true },
  { key: 'engineeringReference', header: 'Engineering Reference', width: 44 },
  { key: 'priceNotes', header: 'Price Flags / Notes', width: 44, cost: true },
];

const SPEC_ATTRS = [
  ['pmaxW', 'W'], ['vmp', 'Vmp'], ['voc', 'Voc'], ['ratedKw', 'kW'], ['mpptCount', 'MPPT'], ['maxDcV', 'V max DC'],
  ['voltageV', 'V'], ['capacityAh', 'Ah'], ['sizeMm2', 'mm2'], ['ratingA', 'A'], ['hp', 'HP'],
];

const date = d => (d ? new Date(d).toISOString().slice(0, 10) : '');

function specText(item) {
  if (!item) return '';
  const a = item.attrs || {};
  const parts = SPEC_ATTRS.filter(([k]) => a[k] != null && a[k] !== '').map(([k, u]) => `${a[k]} ${u}`);
  return [item.spec, parts.length ? parts.join(', ') : null].filter(Boolean).join(' | ');
}

/** One export row per stored BOQ line. */
function toRow(line, item, currency, costs) {
  const ref = [
    line.materialItemKey ? `Price Book: ${line.materialItemKey}` : null,
    line.priceCheckedAt ? `checked ${date(line.priceCheckedAt)}` : null,
    line.priceValidUntil ? `valid until ${date(line.priceValidUntil)}` : null,
  ].filter(Boolean).join('; ');
  const row = {
    lineNo: line.lineNo,
    category: item?.category || line.costGroup || '',
    subcategory: line.component,
    product: item ? `${item.brand} ${item.model}` : line.component,
    description: costs ? line.description || '' : scrubMoneyText(line.description || ''),
    specs: specText(item),
    unit: line.unit,
    qty: line.qty ?? null,
    lineSource: line.source || 'auto',
    autoQty: line.source === 'override' ? line.autoQty ?? null : null,
    engineeringReference: [line.flag, line.notes].filter(Boolean).map(t => (costs ? t : scrubMoneyText(t))).join(' | '),
  };
  if (costs) {
    Object.assign(row, {
      unitPrice: line.unitPrice ?? null,
      total: line.total ?? null,
      currency,
      supplierName: line.supplierName || '',
      supplierCode: line.supplierCode || '',
      quoteCurrency: line.priceCurrency || (line.priceSource ? 'EGP' : ''),
      foreignPrice: line.foreignPrice ?? null,
      fxRate: line.fxRate ?? null,
      priceSource: line.source === 'override' ? 'Manual override' : PRICE_SOURCE_LABEL[line.priceSource] || (line.total != null ? 'Engineering rule / Rates matrix' : 'Not priced'),
      priceReference: ref,
      autoUnitPrice: line.source === 'override' ? line.autoUnitPrice ?? null : null,
      priceNotes: [...(line.priceFlags || []), line.priceStaleReason, line.priceNote, line.total == null ? 'NO PRICE - quotation required' : null].filter(Boolean).join(' | '),
    });
  }
  return row;
}

async function loadExport(revisionId, roles) {
  if (!mongoose.isValidObjectId(revisionId)) throw new ApiError('Invalid revision id.', 400);
  if (!canView(widestLevel(PROJECT_TAB_MATRIX.boqLines, roles))) throw new ApiError('You do not have access to the BOQ on this deal.', 403);
  const revision = await CommercialRevision.findById(revisionId)
    .populate({ path: 'project', select: 'projectCode name dealNumber category subCategory country region currency customer', populate: { path: 'customer', select: 'name' } })
    .lean();
  if (!revision) throw new ApiError('Revision not found.', 404);
  if (!revision.boqLines?.length) throw new ApiError('This revision has no BOQ lines to export yet - calculate it first.', 400);
  // Pricing confidentiality: a role that may not see prices gets the TECHNICAL BOQ - no price, total,
  // supplier, exchange rate or pricing column, no amount inside a description, no pricing summary.
  const costs = canSeePricing(roles) && canView(widestLevel(PROJECT_TAB_MATRIX.boqCosts, roles));
  const pricing = costs && canView(widestLevel(PROJECT_TAB_MATRIX.pricing, roles));
  const keys = [...new Set(revision.boqLines.map(l => l.materialItemKey).filter(Boolean))];
  const items = keys.length ? await MaterialItem.find({ key: { $in: keys } }).select('key category brand model spec attrs').lean() : [];
  const byKey = new Map(items.map(i => [i.key, i]));
  const currency = revision.project?.currency || 'EGP';
  const rows = revision.boqLines.map(l => toRow(l, byKey.get(l.materialItemKey), currency, costs));
  const columns = COLUMNS.filter(c => costs || !c.cost);
  const p = revision.project || {};
  const fileBase = `BOQ_${p.projectCode || 'project'}_Rev${revision.revisionNumber}${costs ? '' : '_technical'}`.replace(/[^A-Za-z0-9_.-]+/g, '-');
  return { revision, project: p, rows, columns, costs, pricing, currency, fileBase };
}

/** Category subtotals in the order the categories first appear. */
function subtotals(rows) {
  const map = new Map();
  for (const r of rows) {
    const s = map.get(r.category) || { category: r.category, lines: 0, total: 0, unpriced: 0 };
    s.lines += 1;
    if (r.total == null) s.unpriced += 1;
    else s.total += r.total;
    map.set(r.category, s);
  }
  return [...map.values()];
}

function infoRows({ revision, project, user, costs }) {
  return [
    ['Project', `${project.projectCode || ''} - ${project.name || ''}`],
    ['Deal number', project.dealNumber || ''],
    ['Customer', project.customer?.name || ''],
    ['Category', [project.category, project.subCategory].filter(Boolean).join(' - ')],
    ['Location', [project.country, project.region].filter(Boolean).join(', ')],
    ['Revision', `${revision.revisionNumber}${revision.isCurrent ? ' (current)' : ' (superseded - historical)'}`],
    ['Revision status', revision.status === 'Draft' ? `Draft - recalculation required${revision.invalidationReason ? `: ${revision.invalidationReason}` : ''}` : 'Calculated'],
    ['Calculated at (UTC)', revision.lastCalculatedAt ? new Date(revision.lastCalculatedAt).toISOString().replace('T', ' ').slice(0, 16) : date(revision.updatedAt)],
    ...(revision.priceChangedSinceCalculation && costs ? [['Warning', `Prices changed since this calculation (${(revision.priceChangedItems || []).join(', ')}) - these figures are outdated until the revision is recalculated.`]] : []),
    ['Exported at (UTC)', new Date().toISOString().replace('T', ' ').slice(0, 16)],
    ['Exported by', user?.name || ''],
  ];
}

async function buildXlsx(revisionId, { roles, user } = {}) {
  const data = await loadExport(revisionId, roles);
  const { revision, project, rows, columns, costs, pricing, currency } = data;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Reservia Deal Engine';
  wb.created = new Date();
  const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  const SOFT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  // BOQ sheet: a title block, then the table (header frozen, auto-filter), then the total row.
  const ws = wb.addWorksheet('BOQ', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.columns = columns.map(c => ({ key: c.key, width: c.width }));
  ws.getCell('A1').value = `Bill of Quantities - ${project.projectCode || ''} ${project.name || ''}`;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = `Revision ${revision.revisionNumber}${revision.isCurrent ? ' (current)' : ' (historical)'} - ${project.dealNumber || ''} - ${project.category || ''} - ${[project.country, project.region].filter(Boolean).join(', ')}${costs ? ` - prices in ${currency}` : ''}`;
  ws.getCell('A2').font = { color: { argb: 'FF475569' } };
  const header = ws.getRow(4);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEAD_FILL;
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  header.height = 30;
  rows.forEach((r, i) => {
    const row = ws.getRow(5 + i);
    columns.forEach((c, j) => {
      const cell = row.getCell(j + 1);
      cell.value = r[c.key] ?? null;
      if (c.num) cell.numFmt = c.num;
      if (['description', 'specs', 'priceReference', 'engineeringReference', 'priceNotes'].includes(c.key)) cell.alignment = { wrapText: true, vertical: 'top' };
      else cell.alignment = { vertical: 'top' };
    });
  });
  const last = 4 + rows.length;
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: last, column: columns.length } };
  if (costs) {
    const totalCol = columns.findIndex(c => c.key === 'total') + 1;
    const tr = ws.getRow(last + 1);
    tr.getCell(1).value = 'BOQ TOTAL';
    tr.getCell(totalCol).value = revision.boqTotal ?? rows.reduce((s, r) => s + (r.total || 0), 0);
    tr.getCell(totalCol).numFmt = '#,##0.00';
    tr.eachCell(c => { c.font = { bold: true }; c.fill = SOFT_FILL; });
  }

  // Summary sheet: deal/revision information, category subtotals, pricing (if visible).
  const ss = wb.addWorksheet('Summary');
  ss.columns = [{ width: 34 }, { width: 22 }, { width: 14 }, { width: 16 }];
  ss.addRow(['Reservia Deal Engine - BOQ summary']).font = { bold: true, size: 14 };
  ss.addRow([]);
  for (const [k, v] of infoRows({ revision, project, user, costs })) {
    const r = ss.addRow([k, v]);
    r.getCell(1).font = { bold: true };
  }
  ss.addRow([]);
  const h = ss.addRow(['Category', costs ? `Subtotal (${currency})` : 'Lines', costs ? 'Lines' : '', costs ? 'Unpriced lines' : '']);
  h.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD_FILL; });
  for (const s of subtotals(rows)) {
    const r = costs ? ss.addRow([s.category, s.total, s.lines, s.unpriced || '']) : ss.addRow([s.category, s.lines]);
    if (costs) r.getCell(2).numFmt = '#,##0.00';
  }
  if (costs) {
    const t = ss.addRow(['BOQ TOTAL (direct cost)', revision.boqTotal ?? null, rows.length]);
    t.getCell(2).numFmt = '#,##0.00';
    t.eachCell(c => { c.font = { bold: true }; c.fill = SOFT_FILL; });
  }
  if (pricing && revision.pricing) {
    const p = revision.pricing;
    ss.addRow([]);
    ss.addRow(['Pricing', `Amount (${currency})`]).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD_FILL; });
    for (const [label, v] of [
      ['Direct COGS (materials + site costs)', p.cogs],
      ['Net price (excl. VAT)', p.netExclVat],
      [`VAT (${p.vatPct != null ? Math.round(p.vatPct * 1000) / 10 : '-'}%)`, p.vatAmt],
      ['Final price (incl. VAT)', p.grossInclVat],
      [`Price per kWp (excl. VAT)${p.designKwp ? ` - ${p.designKwp} kWp` : ''}`, p.perKwpExclVat],
      ['Gross profit', p.grossProfit],
    ]) {
      const r = ss.addRow([label, v ?? null]);
      r.getCell(2).numFmt = '#,##0.00';
    }
  }
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, fileName: `${data.fileBase}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}

/** RFC 4180 field: quoted when it holds a comma, quote, CR or LF; quotes doubled. */
function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function buildCsv(revisionId, { roles } = {}) {
  const data = await loadExport(revisionId, roles);
  const { rows, columns, costs, revision } = data;
  const lines = [columns.map(c => csvField(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map(c => csvField(r[c.key])).join(','));
  if (costs) {
    const totalIdx = columns.findIndex(c => c.key === 'total');
    const t = columns.map(() => '');
    t[0] = 'BOQ TOTAL';
    t[totalIdx] = csvField(revision.boqTotal ?? rows.reduce((s, r) => s + (r.total || 0), 0));
    lines.push(t.join(','));
  }
  // UTF-8 with a BOM (Excel opens Arabic text and EGP amounts correctly) and CRLF row endings.
  const buffer = Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
  return { buffer, fileName: `${data.fileBase}.csv`, contentType: 'text/csv; charset=utf-8' };
}

module.exports = { buildXlsx, buildCsv, csvField, toRow, COLUMNS };
