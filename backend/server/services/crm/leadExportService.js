'use strict';

const Lead = require('../../models/crm/leadModel');

// Reservia CRM - weekly Marketing Dashboard CSV export (Developer Brief: "weekly CSV export...
// Arabic/UTF-8... formula-injection protection"). Reuses utils/exportToCsv.js (the same BOM +
// quoted-UTF-8 CSV writer every other export in this codebase uses, so Arabic text round-trips
// identically) for the actual file-writing; this module only owns what's CRM-specific: which
// columns the Marketing Dashboard needs, and sanitizing the free-text ones.
//
// Formula-injection protection: utils/exportToCsv.js itself does not escape cell contents (it is a
// thin fast-csv wrapper) - a lead Name/Source/Governorate imported or typed in as literal text
// starting with =, +, -, @, a tab, or a carriage return would otherwise be interpreted as a live
// formula the moment the exported file is opened in Excel/Sheets (OWASP "CSV Injection"). Every
// FREE-TEXT column below is passed through `sanitizeCell` before being handed to the writer;
// enum-constrained columns (Stage, Channel, Segment) are left as-is since their values can never
// start with one of those characters. Phone is ALSO left unsanitized despite always starting with
// "+" (E.164) - it is not free text, it is the system-normalized output of
// utils/crm/phone.js#normalizeEgyptianPhone (a strict digits-only regex match), so it can never
// contain actual formula syntax; sanitizing it would instead corrupt every single phone number in
// the export by prefixing a visible stray quote character.

const FORMULA_LEAD_CHARS = /^[=+\-@\t\r]/;

/** Neutralizes a value that would otherwise be read as a spreadsheet formula on open. */
function sanitizeCell(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return FORMULA_LEAD_CHARS.test(str) ? `'${str}` : str;
}

const HEADERS = ['RefCode', 'Name', 'Phone', 'Channel', 'Segment', 'Source', 'Governorate', 'Stage', 'Owner', 'ValueEgp', 'CreatedAt', 'FirstReplyAt', 'FollowUpAt'];

const isoDate = d => (d ? new Date(d).toISOString() : '');

function rowFor(lead) {
  return [
    sanitizeCell(lead.refCode),
    sanitizeCell(lead.name),
    lead.phoneE164,
    sanitizeCell(lead.channel),
    sanitizeCell(lead.segment),
    sanitizeCell(lead.source),
    sanitizeCell(lead.governorate),
    sanitizeCell(lead.stage),
    sanitizeCell(lead.owner?.name),
    lead.valueEgp ?? '',
    isoDate(lead.createdAt),
    isoDate(lead.firstReplyAt),
    isoDate(lead.followUpAt),
  ];
}

/** Every lead, in this fixed Marketing Dashboard column order, ready for utils/exportToCsv.js. */
async function buildLeadExportRows(filter = {}) {
  const leads = await Lead.find(filter).sort({ createdAt: 1 }).lean();
  return leads.map(rowFor);
}

module.exports = { buildLeadExportRows, sanitizeCell, HEADERS, FORMULA_LEAD_CHARS };
