'use strict';

const path = require('path');
const PDFDocument = require('pdfkit');

// Deal Engine C12-C16 / Spec Part 2 section 3 - the proposal PDF on the Reservia letterhead.
//
// Content, in order (attachment A1 is the visual target): cover block, 1 summary, 2 scope of supply
// (no unit prices on the customer copy), 3 technical design, 4 customer feasibility (scenario table,
// cumulative cash chart, basis, abbreviated year-by-year), 5 price and payment, 6 delivery and
// warranty, 7 terms and conditions, signature block. Every figure comes from the revision snapshot
// passed in; every text block from the proposal settings (dealEngineSettings.PROPOSAL_DEFAULTS).
//
// `copy: 'internal'` adds the priced BOQ, the pricing stack and the approval log. `draft: true`
// writes "DRAFT, NOT FOR ISSUE" across every page (the preview before issue).

const LOGO = path.join(__dirname, '..', '..', 'assets', 'reservia-logo-full.png');
const NAVY = '#0f3550';
const AMBER = '#f0a500';
const GREEN = '#1d5e3a';
const GREY = '#5f6b76';
const LIGHT = '#e8edf2';
const PAGE = { w: 595.28, h: 841.89, left: 56, right: 56, top: 140, bottom: 92 };
const CONTENT_W = PAGE.w - PAGE.left - PAGE.right;

const egp = v => (v == null || !Number.isFinite(v) ? '-' : Math.round(v).toLocaleString('en-US'));
const egpText = v => (v == null || !Number.isFinite(v) ? '-' : `EGP ${egp(v)}`);
const pct = (v, dp = 1) => (v == null || !Number.isFinite(v) ? '-' : `${(v * 100).toFixed(dp)}%`);
const kwh = v => (v == null ? '-' : Math.round(v).toLocaleString('en-US'));
const dateText = d =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' }) : '-';

// BOQ component -> customer-facing scope item (A1 section 2). Lines of the same item are merged.
const SCOPE_ITEMS = [
  [/^PV Modules/i, 'PV modules'],
  [/^Solar Inverters|Inverter/i, 'Inverter'],
  [/^Mounting Structure/i, 'Mounting structure'],
  [/^DC Solar Cable|^DC Cable|^MC4/i, 'DC cabling'],
  [/^AC Cable/i, 'AC cabling'],
  [/^AC Distribution Board|^AC Circuit Breaker|Protection|Combiner/i, 'Protection'],
  [/^Cable Tray/i, 'Cable management'],
  [/^Earthing|^Accessories/i, 'Earthing and accessories'],
  [/^Installation/i, 'Installation'],
  [/^Transportation/i, 'Transport'],
  [/^Travel|Personnel/i, 'Site logistics'],
];

const ORDER = SCOPE_ITEMS.map(([, item]) => item);
const PLURAL = { pcs: ['pc', 'pcs'], pc: ['pc', 'pcs'], roll: ['roll', 'rolls'], pair: ['pair', 'pairs'], lot: ['lot', 'lots'], set: ['set', 'sets'] };
function qtyText(qty, unit) {
  const q = Number.isInteger(qty) ? qty : Math.round(qty * 100) / 100;
  const u = PLURAL[unit] ? PLURAL[unit][q === 1 ? 0 : 1] : unit || '';
  return `${q.toLocaleString('en-US')} ${u}`.trim();
}

/**
 * Customer-facing scope: one row per item, in A1's order, with a plain description and the
 * quantity - and NO price or rate anywhere (A6 3.2: "No unit prices on the customer copy"; BOQ
 * descriptions such as "Earthing works - 100 EGP per design kWp" are never copied through).
 */
function scopeRows(boqLines, eng = {}) {
  const items = new Map();
  for (const l of boqLines || []) {
    const hit = SCOPE_ITEMS.find(([rx]) => rx.test(l.component));
    const item = hit ? hit[1] : l.component;
    const e = items.get(item) || { item, lines: [] };
    e.lines.push(l);
    items.set(item, e);
  }
  const byComponent = (e, rx) => e.lines.find(l => rx.test(l.component));
  const describe = e => {
    const first = e.lines[0];
    switch (e.item) {
      case 'PV modules':
        return [eng.moduleBrand, first.description].filter(Boolean).join(' ') + (eng.moduleW ? `, ${eng.moduleW} Wp` : '');
      case 'Inverter':
        return eng.inverterModel ? `${[eng.inverterBrand, eng.inverterModel].filter(Boolean).join(' ')}, ${eng.inverterKw} kW` : first.description;
      case 'Mounting structure':
        return `${String(first.description || eng.structure || '').replace(/\s+mounting$/i, '')} mounting`.trim();
      case 'DC cabling': {
        const dc = byComponent(e, /DC/i);
        return `Solar DC cable${dc && dc.description ? ` ${dc.description}` : ''}${byComponent(e, /MC4/i) ? ', with MC4 connectors' : ''}`;
      }
      case 'AC cabling':
        return `${first.description ? `${first.description} mm2 ` : ''}copper feeder to the main distribution board`;
      case 'Protection': {
        const adb = byComponent(e, /Distribution Board/i);
        const brk = byComponent(e, /Breaker/i);
        return [adb && `AC distribution board ${adb.description}`, brk && brk.description].filter(Boolean).join(' and ');
      }
      case 'Cable management':
        return 'Galvanised cable tray';
      case 'Earthing and accessories':
        return 'Earthing works and system accessories';
      case 'Installation':
        return 'Installation, testing and commissioning by Reservia crew';
      case 'Transport':
        return 'Delivery to site';
      case 'Site logistics':
        return 'Travel, accommodation and site personnel';
      default:
        // Other engines' lines: the description only if it carries no price wording.
        return /EGP|price|rate/i.test(first.description || '') ? '' : first.description || '';
    }
  };
  const quantity = e => {
    if (['Earthing and accessories', 'Installation', 'Transport', 'Site logistics'].includes(e.item)) return '1 lot';
    if (e.item === 'Protection') return '1 set';
    const main = e.item === 'DC cabling' ? byComponent(e, /DC/i) || e.lines[0] : e.lines[0];
    return main.qty != null ? qtyText(main.qty, main.unit) : '-';
  };
  return [...items.values()]
    .sort((a, b) => (ORDER.indexOf(a.item) === -1 ? 99 : ORDER.indexOf(a.item)) - (ORDER.indexOf(b.item) === -1 ? 99 : ORDER.indexOf(b.item)))
    .map(e => [e.item, describe(e).slice(0, 160), quantity(e)]);
}

const article = n => (/^(8|11|18)/.test(String(n)) ? 'an' : 'a');
const escalationWords = label => (label ? label.replace(/^\+(\S+) per year$/, 'a $1 yearly').replace(/^Flat tariff$/, 'a flat').replace(/^\+/, 'a ') : 'the headline');

class Writer {
  constructor(doc) {
    this.doc = doc;
    this.y = PAGE.top;
  }

  ensure(h) {
    if (this.y + h > PAGE.h - PAGE.bottom) {
      this.doc.addPage();
      this.y = PAGE.top;
    }
  }

  title(text, sub) {
    this.ensure(60);
    this.doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(22).text(text, PAGE.left, this.y, { width: CONTENT_W });
    this.y = this.doc.y + 2;
    if (sub) {
      this.doc.fillColor(GREY).font('Helvetica').fontSize(12).text(sub, PAGE.left, this.y, { width: CONTENT_W });
      this.y = this.doc.y + 10;
    }
  }

  heading(text) {
    this.ensure(40);
    this.y += 6;
    this.doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(14).text(text, PAGE.left, this.y, { width: CONTENT_W });
    this.y = this.doc.y + 6;
  }

  subheading(text) {
    this.ensure(28);
    this.doc.fillColor('#2e7d6b').font('Helvetica-Bold').fontSize(10.5).text(text, PAGE.left, this.y, { width: CONTENT_W });
    this.y = this.doc.y + 4;
  }

  para(text, { size = 9.5, color = '#222', italic = false } = {}) {
    if (!text) return;
    this.doc.font(italic ? 'Helvetica-Oblique' : 'Helvetica').fontSize(size);
    const h = this.doc.heightOfString(text, { width: CONTENT_W });
    this.ensure(h + 4);
    this.doc.fillColor(color).text(text, PAGE.left, this.y, { width: CONTENT_W });
    this.y = this.doc.y + 6;
  }

  bullets(list, { numbered = false } = {}) {
    list.forEach((t, i) => {
      const mark = numbered ? `${i + 1}.` : '•';
      this.doc.font('Helvetica').fontSize(9.5);
      const h = this.doc.heightOfString(t, { width: CONTENT_W - 18 });
      this.ensure(h + 4);
      this.doc.fillColor('#222').text(mark, PAGE.left + 2, this.y, { width: 14 });
      this.doc.text(t, PAGE.left + 18, this.y, { width: CONTENT_W - 18 });
      this.y = this.doc.y + 4;
    });
    this.y += 2;
  }

  /**
   * columns: [{ header, width (fraction), align }]. rows: arrays of cell text. `boldRows`: indexes of
   * rows drawn bold on a light fill (totals). Repeats the header on a new page.
   */
  table(columns, rows, { boldRows = [], size = 9, headerAlignFromCols = true } = {}) {
    const doc = this.doc;
    const widths = columns.map(c => c.width * CONTENT_W);
    const pad = 4;
    const drawHeader = () => {
      doc.font('Helvetica-Bold').fontSize(size);
      const h = Math.max(...columns.map((c, i) => doc.heightOfString(c.header || '', { width: widths[i] - pad * 2 }))) + pad * 2;
      this.ensure(h + 18);
      doc.rect(PAGE.left, this.y, CONTENT_W, h).fill(NAVY);
      let x = PAGE.left;
      columns.forEach((c, i) => {
        doc.fillColor('white').text(c.header || '', x + pad, this.y + pad, { width: widths[i] - pad * 2, align: headerAlignFromCols ? c.align || 'left' : 'left' });
        x += widths[i];
      });
      this.y += h;
    };
    drawHeader();
    rows.forEach((row, r) => {
      const bold = boldRows.includes(r);
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
      const h = Math.max(...row.map((cell, i) => doc.heightOfString(String(cell ?? ''), { width: widths[i] - pad * 2 }))) + pad * 2;
      if (this.y + h > PAGE.h - PAGE.bottom) {
        doc.addPage();
        this.y = PAGE.top;
        drawHeader();
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
      }
      if (bold) doc.rect(PAGE.left, this.y, CONTENT_W, h).fill(LIGHT);
      let x = PAGE.left;
      row.forEach((cell, i) => {
        doc.fillColor('#1f2933').text(String(cell ?? ''), x + pad, this.y + pad, { width: widths[i] - pad * 2, align: columns[i].align || 'left' });
        x += widths[i];
      });
      doc.lineWidth(0.5).strokeColor('#9aa7b3');
      doc.rect(PAGE.left, this.y, CONTENT_W, h).stroke();
      x = PAGE.left;
      for (let i = 0; i < widths.length - 1; i++) {
        x += widths[i];
        doc.moveTo(x, this.y).lineTo(x, this.y + h).stroke();
      }
      this.y += h;
    });
    this.y += 8;
  }

  /** Cumulative cash position of each scenario over the years (A1 section 4 chart). */
  chart(series, capex) {
    const doc = this.doc;
    const h = 190;
    this.ensure(h + 30);
    const x0 = PAGE.left + 46;
    const y0 = this.y + 16;
    const w = CONTENT_W - 70;
    const ih = h - 40;
    doc.fillColor(NAVY).font('Helvetica').fontSize(9).text('Cumulative savings against the system price (incl. VAT)', PAGE.left, this.y, { width: CONTENT_W, align: 'center' });
    const all = series.flatMap(s => s.points);
    const maxV = Math.max(...all, 0);
    const minV = Math.min(...all, -capex);
    const toX = n => x0 + (n / 25) * w;
    const toY = v => y0 + ih - ((v - minV) / (maxV - minV || 1)) * ih;
    // grid + axes
    doc.lineWidth(0.4).strokeColor('#d5dde5');
    const step = niceStep((maxV - minV) / 6);
    for (let v = Math.ceil(minV / step) * step; v <= maxV; v += step) {
      doc.moveTo(x0, toY(v)).lineTo(x0 + w, toY(v)).stroke();
      doc.fillColor(GREY).fontSize(7).text((v / 1e6).toFixed(Math.abs(step) < 1e6 ? 1 : 0), x0 - 40, toY(v) - 3, { width: 36, align: 'right' });
    }
    doc.lineWidth(0.8).strokeColor(NAVY).moveTo(x0, toY(0)).lineTo(x0 + w, toY(0)).stroke();
    for (let n = 0; n <= 25; n += 5) doc.fillColor(GREY).fontSize(7).text(String(n), toX(n) - 10, y0 + ih + 4, { width: 20, align: 'center' });
    doc.fillColor(GREY).fontSize(7.5).text('Year', x0, y0 + ih + 14, { width: w, align: 'center' });
    doc.save().rotate(-90, { origin: [PAGE.left + 4, y0 + ih / 2] }).fillColor(GREY).fontSize(7.5).text('Cash position (EGP million)', PAGE.left - 50, y0 + ih / 2 - 4, { width: 110, align: 'center' }).restore();
    // series
    const styles = [
      { color: '#0f6f6a', dash: null },
      { color: AMBER, dash: null },
      { color: '#8a96a3', dash: [3, 3] },
      { color: '#6b4fa0', dash: [1, 2] },
    ];
    series.forEach((s, i) => {
      const st = styles[i % styles.length];
      doc.lineWidth(1.4).strokeColor(st.color);
      if (st.dash) doc.dash(st.dash[0], { space: st.dash[1] });
      else doc.undash();
      s.points.forEach((v, n) => (n === 0 ? doc.moveTo(toX(n), toY(v)) : doc.lineTo(toX(n), toY(v))));
      doc.stroke();
      doc.undash();
      // legend
      const ly = y0 + 4 + i * 11;
      doc.lineWidth(1.4).strokeColor(st.color).moveTo(x0 + 8, ly + 3).lineTo(x0 + 24, ly + 3).stroke();
      doc.fillColor('#333').fontSize(7).text(s.label, x0 + 28, ly, { width: 200 });
    });
    this.y = y0 + ih + 30;
  }

  signatures(company) {
    const doc = this.doc;
    this.ensure(150);
    const half = CONTENT_W / 2;
    doc.rect(PAGE.left, this.y, CONTENT_W, 20).fill(NAVY);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(9.5).text(`For ${company.name.replace(/ LLC$/, '')}`, PAGE.left + 6, this.y + 6, { width: half - 12 });
    doc.text('For the Customer', PAGE.left + half + 6, this.y + 6, { width: half - 12 });
    const top = this.y + 20;
    doc.lineWidth(0.5).strokeColor('#9aa7b3').rect(PAGE.left, top, CONTENT_W, 110).stroke();
    doc.moveTo(PAGE.left + half, top).lineTo(PAGE.left + half, top + 110).stroke();
    doc.fillColor('#222').font('Helvetica').fontSize(9);
    const lines = (title, x) => ['Name:', `Title: ${title}`, 'Signature and stamp:', 'Date:'].forEach((t, i) => doc.text(t, x + 6, top + 50 + i * 14, { width: half - 12 }));
    lines(company.signatoryTitle || '', PAGE.left);
    lines('', PAGE.left + half);
    this.y = top + 120;
  }
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(Math.abs(raw) || 1));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function frame(doc, { company, mailbox, proposalNumber, pageNo, draft, internal }) {
  // Header
  try {
    doc.image(LOGO, PAGE.left, 26, { height: 74 });
  } catch {
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(20).text('Reservia', PAGE.left, 50);
  }
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(company.name, PAGE.left, 54, { width: CONTENT_W, align: 'right' });
  doc.fillColor(GREY).font('Helvetica').fontSize(8).text(company.registry, PAGE.left, 68, { width: CONTENT_W, align: 'right' });
  doc.fillColor('#0f6f6a').fontSize(8).text(company.website, PAGE.left, 79, { width: CONTENT_W, align: 'right' });
  doc.rect(PAGE.left, 112, CONTENT_W, 5).fill(NAVY);
  doc.rect(PAGE.left, 117, CONTENT_W, 2.5).fill(AMBER);
  if (internal) doc.fillColor('#b42318').font('Helvetica-Bold').fontSize(8).text('INTERNAL COPY - NOT FOR THE CUSTOMER', PAGE.left, 124, { width: CONTENT_W, align: 'right' });
  // Footer
  const fy = PAGE.h - 70;
  doc.lineWidth(1).strokeColor(AMBER).moveTo(PAGE.left, fy).lineTo(PAGE.left + CONTENT_W, fy).stroke();
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8).text(company.slogan, PAGE.left, fy + 6, { width: CONTENT_W, align: 'center' });
  doc.fillColor(GREY).font('Helvetica').fontSize(7).text(`${company.address} | ${company.phones}`, PAGE.left, fy + 18, { width: CONTENT_W, align: 'center' });
  doc.text(`${mailbox} | Proposal ${proposalNumber} | Page ${pageNo}`, PAGE.left, fy + 29, { width: CONTENT_W, align: 'center' });
  // Watermark
  if (draft) {
    doc.save();
    doc.rotate(-35, { origin: [PAGE.w / 2, PAGE.h / 2] });
    doc.fillColor('#c0392b').opacity(0.13).font('Helvetica-Bold').fontSize(64).text('DRAFT, NOT FOR ISSUE', 0, PAGE.h / 2 - 40, { width: PAGE.w, align: 'center' });
    doc.restore();
    doc.opacity(1);
  }
}

/**
 * Renders a proposal. `data` (proposalService.buildProposalData) carries everything as plain values:
 *   { proposalNumber, dealNumber, issueDate, validUntil, customerName, site, category, title, approvedBy,
 *     pricing, feasibility, engineering, boqLines, approvals, settings, preparedBy, smallDeal }
 * @returns {Promise<Buffer>}
 */
function renderProposalPdf(data, { copy = 'customer', draft = false } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: PAGE.top, bottom: 20, left: PAGE.left, right: PAGE.right }, bufferPages: true, info: { Title: `Proposal ${data.proposalNumber}`, Author: data.settings.company.name, Subject: data.title } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      writeBody(new Writer(doc), data, copy === 'internal');
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        frame(doc, { company: data.settings.company, mailbox: data.settings.senderMailbox, proposalNumber: data.proposalNumber, pageNo: i + 1, draft, internal: copy === 'internal' });
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function writeBody(w, d, internal) {
  const { pricing: p, feasibility: f, engineering: e, settings: s } = d;
  w.title(internal ? 'Commercial Proposal - internal copy' : 'Commercial Proposal', d.title);
  w.table(
    [{ header: 'Item', width: 0.3 }, { header: 'Detail', width: 0.7 }],
    [
      ['Customer', d.customerName],
      ['Site', d.site],
      ['Proposal No.', d.proposalNumber],
      ['Commercial deal No.', d.dealNumber || '-'],
      ['Date', dateText(d.issueDate)],
      ['Valid until', `${dateText(d.validUntil)} (${s.validityDays} days)`],
      ['Prepared by', d.preparedBy],
      ['Approved for issue', d.approvedBy || 'Pending approvals'],
    ]
  );

  // 1. Summary
  w.heading('1. Summary');
  const h = f && f.headline;
  if (h) {
    const coverage = f.year1CoverageOfConsumption != null ? ` and cover about ${Math.round(f.year1CoverageOfConsumption * 100)}% of the site's annual electricity consumption of ${kwh(f.annualConsumptionKwh)} kWh` : '';
    w.para(
      `Reservia proposes ${article(e.designKwp)} ${e.designKwp} kWp ${d.systemNoun} that will generate about ${kwh(h.year1GenerationKwh)} kWh in its first year${coverage}. ` +
        `At today's tariff of EGP ${f.assumptions.tariffEgpPerKwh.toFixed(2)} per kWh and ${escalationWords(h.label)} tariff escalation, the system pays for itself in ${h.paybackLabel} ` +
        `and saves about EGP ${(h.lifetimeSavings / 1e6).toFixed(1)} million over 25 years.`
    );
  } else {
    w.para(`Reservia proposes ${e.designKwp ? `${article(e.designKwp)} ${e.designKwp} kWp ` : 'a '}${d.systemNoun}, supply and installation, as detailed below.`);
  }
  const summaryRows = [
    ['Total system price, excl. VAT', egpText(p.netExclVat)],
    [`VAT ${pct(p.vatPct, 0).replace('.0', '')}`, egpText(p.vatAmt)],
    ['Total system price, incl. VAT', egpText(p.grossInclVat)],
  ];
  if (p.perKwpExclVat) summaryRows.push(['Price per kWp, excl. VAT', egpText(p.perKwpExclVat)]);
  if (h) summaryRows.push(['Simple payback', h.paybackLabel], ['Return on investment (IRR, 25 years)', pct(h.irr)]);
  w.table([{ header: '', width: 0.5 }, { header: 'Value', width: 0.5, align: 'right' }], summaryRows, { boldRows: h ? [summaryRows.length - 1] : [] });

  // 2. Scope
  w.heading('2. Scope of supply and installation');
  w.table([{ header: 'Item', width: 0.24 }, { header: 'Description', width: 0.58 }, { header: 'Qty', width: 0.18, align: 'right' }], scopeRows(d.boqLines, e));
  w.para(`${s.inclusions} ${s.exclusions}`);

  // 3. Technical design
  if (e.designKwp) {
    w.heading('3. Technical design');
    const rows = [['Design capacity', `${Number(e.designKwp).toFixed(1)} kWp DC`, 'Sized to cover the annual consumption from the bills provided']];
    if (e.moduleCount) rows.push(['Module count', String(e.moduleCount), e.moduleW ? `ceil(${(e.designKwp * 1000).toLocaleString('en-US')} W / ${e.moduleW} W)` : '']);
    if (e.inverterKw) rows.push(['Inverter', `${e.inverterKw} kW AC`, `Price Book selection; DC/AC ratio ${e.dcAcRatio != null ? e.dcAcRatio.toFixed(2) : '-'}`]);
    if (e.structure) rows.push(['Mounting structure', e.structure, '']);
    if (f) {
      rows.push(['Specific yield', `${kwh(f.assumptions.yieldKwhPerKwp)} kWh per kWp per year`, f.assumptions.yieldBasis || 'Reference value; site-specific simulation on request']);
      rows.push(['Year-1 generation', `${kwh(h.year1GenerationKwh)} kWh`, `${e.designKwp} kWp x ${kwh(f.assumptions.yieldKwhPerKwp)}`]);
      rows.push(['Degradation', `${pct(f.assumptions.degradationPct)} per year`, 'Industry reference (NREL ATB 2024)']);
      if (f.year1CoverageOfConsumption != null) rows.push(['Coverage of consumption', pct(f.year1CoverageOfConsumption, 0), `${kwh(h.year1GenerationKwh)} / ${kwh(f.annualConsumptionKwh)} kWh`]);
      if (f.performance && f.performance.performanceRatio != null) rows.push(['Performance ratio', pct(f.performance.performanceRatio), `IEC 61724-1: yield / in-plane irradiation (${kwh(f.performance.annualIrradiationKwhPerM2)} kWh/m2)`]);
    }
    w.table([{ header: 'Parameter', width: 0.26 }, { header: 'Value', width: 0.3 }, { header: 'Basis', width: 0.44 }], rows);
  }

  // 4. Feasibility
  if (h) {
    w.heading('4. Customer feasibility');
    w.para(
      `The feasibility compares what you pay for the system today (the total price incl. VAT) with the electricity bills it avoids over 25 years. ` +
        `${f.assumptions.omIncludedInEpc ? 'O&M is included in the Reservia offer, so nothing is deducted for it. ' : ''}` +
        `The headline case uses ${escalationWords(h.label)} tariff escalation; ${f.sensitivities.length} sensitivities are shown.` +
        `${h.inverterReplacement ? ` The case includes an inverter replacement in year ${h.inverterReplacement.year} (EGP ${egp(h.inverterReplacement.costEgp)}, today's price).` : ''}`
    );
    const scen = [h, ...f.sensitivities];
    w.table(
      [{ header: 'Scenario', width: 0.31 }, { header: 'Simple payback', width: 0.17, align: 'right' }, { header: 'IRR (25 yr)', width: 0.12, align: 'right' }, { header: `NPV at ${pct(f.assumptions.discountRate, 0).replace('.0', '')}`, width: 0.18, align: 'right' }, { header: '25-year savings', width: 0.22, align: 'right' }],
      scen.map((sc, i) => [`${i === 0 ? 'Headline' : 'Sensitivity'}: ${sc.label || ''}`, sc.paybackLabel, pct(sc.irr), egpText(sc.npv), egpText(sc.lifetimeSavings)])
    );
    w.chart(
      scen.map((sc, i) => ({ label: `${i === 0 ? 'Headline' : 'Sensitivity'}: ${sc.label || ''}`, points: [-f.priceBasis.capex, ...sc.years.map(y => y.cumulative)] })),
      f.priceBasis.capex
    );
    const tariffBasis =
      f.assumptions.tariffSource === 'bill'
        ? 'from your bills: annual bill / annual kWh'
        : f.assumptions.tariffSource === 'default'
          ? 'reference value - no bills were provided'
          : f.assumptions.tariffNote || 'as agreed with you';
    w.table(
      [{ header: 'Basis', width: 0.38 }, { header: 'Value', width: 0.62 }],
      [
        ['Capital cost (year 0)', `${egpText(f.priceBasis.capex)} (total price incl. VAT)`],
        ['Tariff, year 1', `EGP ${f.assumptions.tariffEgpPerKwh.toFixed(2)} per kWh - ${tariffBasis}`],
        ['Year-1 savings', egpText(h.year1Savings)],
        ['Solution cost per kWh over 25 years', `EGP ${(h.simpleCostPerKwh ?? h.levelisedCostPerKwh ?? 0).toFixed(2)} (price / 25-year generation, undiscounted)`],
        ['Discounted payback', h.discountedPaybackLabel || '-'],
        ['Discount rate for NPV', pct(f.assumptions.discountRate, 0).replace('.0', '')],
      ]
    );
    w.subheading('Year by year (headline case)');
    const keep = [1, 2, 3, 4, 5, 10, 15, 20, 25];
    const rows = [['0', '', '', '', egp(-f.priceBasis.capex)]];
    for (const y of h.years.filter(r => keep.includes(r.n) || r.inverterReplacement)) {
      rows.push([String(y.n), kwh(y.generationKwh), y.tariff.toFixed(2), `${egp(y.savings)}${y.inverterReplacement ? ` (-${egp(y.inverterReplacement)} inverter)` : ''}`, egp(y.cumulative)]);
    }
    w.table(
      [{ header: 'Year', width: 0.12 }, { header: 'Generation (kWh)', width: 0.2, align: 'right' }, { header: 'Tariff (EGP/kWh)', width: 0.18, align: 'right' }, { header: 'Savings (EGP)', width: 0.26, align: 'right' }, { header: 'Cumulative (EGP)', width: 0.24, align: 'right' }],
      rows
    );
    w.para(
      `Years not listed are omitted for brevity; the full table is available on request. Generation declines ${pct(f.assumptions.degradationPct)} a year. The tariff path is an assumption, not a forecast; your actual savings follow the tariff the utility charges.`,
      { italic: true, size: 8.5, color: GREY }
    );
  }

  // 5. Price and payment
  w.heading(`${h ? 5 : 4}. Price and payment`);
  w.table(
    [{ header: '', width: 0.72 }, { header: 'EGP', width: 0.28, align: 'right' }],
    [
      ['Supply, installation, testing and commissioning, excl. VAT', egp(p.netExclVat)],
      [`VAT ${pct(p.vatPct, 0).replace('.0', '')}`, egp(p.vatAmt)],
      ['Total, incl. VAT', egp(p.grossInclVat)],
    ],
    { boldRows: [2] }
  );
  w.para(`Payment terms: ${d.smallDeal ? s.paymentTerms.small : s.paymentTerms.standard} Prices are in Egyptian pounds and valid until ${dateText(d.validUntil)}. ${s.priceNote}`);

  // 6. Delivery and warranty
  w.heading(`${h ? 6 : 5}. Delivery and warranty`);
  w.bullets(s.deliveryWarranty);

  // 7. Terms
  w.heading(`${h ? 7 : 6}. Terms and conditions`);
  w.bullets(s.terms, { numbered: true });
  w.y += 6;
  w.signatures(s.company);

  if (internal) {
    w.doc.addPage();
    w.y = PAGE.top;
    w.heading('Internal: BOQ with prices');
    w.table(
      [{ header: '#', width: 0.06 }, { header: 'Component', width: 0.22 }, { header: 'Description', width: 0.32 }, { header: 'Qty', width: 0.1, align: 'right' }, { header: 'Unit price', width: 0.14, align: 'right' }, { header: 'Total', width: 0.16, align: 'right' }],
      (d.boqLines || []).map(l => [String(l.lineNo ?? l.no ?? ''), l.component, l.description || '', l.qty != null ? `${Math.round(l.qty * 100) / 100} ${l.unit || ''}` : '-', egp(l.unitPrice), egp(l.total)]).concat([['', 'BOQ total (COGS)', '', '', '', egp(p.cogs)]]),
      { boldRows: [(d.boqLines || []).length], size: 8 }
    );
    w.heading('Internal: pricing stack');
    w.table(
      [{ header: 'Line', width: 0.55 }, { header: 'Rate', width: 0.15, align: 'right' }, { header: 'EGP', width: 0.3, align: 'right' }],
      [
        ['COGS (BOQ)', '', egp(p.cogs)],
        ['Overhead', pct(p.overheadPct), egp(p.overheadAmt)],
        ['Contingency', pct(p.contingencyPct), egp(p.contingencyAmt)],
        ['Profit (on COGS)', pct(p.profitPct), egp(p.profitAmt)],
        ['Base price', '', egp(p.basePrice)],
        ['Sales bonus (of the pool)', pct(p.salesBonusPct), egp(p.salesBonusAmt)],
        ['Engineering incentive (of the pool)', pct(p.engineeringIncentivePct), egp(p.engineeringIncentiveAmt)],
        ['Category addition', pct(p.categoryAdditionPct), egp(p.categoryAdditionAmt)],
        ['Discount', pct(p.discountPct), egp(p.discountAmt ? -p.discountAmt : 0)],
        ['Net price, excl. VAT', '', egp(p.netExclVat)],
        ['VAT', pct(p.vatPct), egp(p.vatAmt)],
        ['Final price, incl. VAT', '', egp(p.grossInclVat)],
        ['Gross profit', pct(p.grossProfitPct), egp(p.grossProfit)],
      ],
      { boldRows: [9, 11] }
    );
    w.heading('Internal: approval log');
    w.table(
      [{ header: 'Stage', width: 0.3 }, { header: 'Status', width: 0.14 }, { header: 'By', width: 0.22 }, { header: 'Date', width: 0.16 }, { header: 'Note', width: 0.18 }],
      (d.approvals || []).map(a => [a.stage, a.status, a.by || '-', a.at ? dateText(a.at) : '-', a.note || ''])
    );
    if (d.releaseOverride) w.para(`Release override: ${d.releaseOverride}`, { color: '#b42318' });
  }
}

module.exports = { renderProposalPdf, scopeRows };
