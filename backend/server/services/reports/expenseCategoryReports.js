const Expense = require('../../models/expense/expenseModel');
const ExpenseCategory = require('../../models/expense/expenseCategoryModel');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const { AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');
const C = require('./reportCommon');

const { round2, col, check, note, summaryItem, L } = C;

const NO_CATEGORY = L('No category', 'بدون تصنيف');

/**
 * Expenses by Expense Category for the period (by expense date): amount excluding VAT, VAT, total
 * owed, paid and outstanding per category, and every expense behind each category (drill-down).
 * Only vendor expenses posted to the ledger count - an expense whose entry was reversed is listed
 * but excluded from the totals. Amount, VAT and paid are kept apart, never interchanged.
 */
async function expensesByCategory(query) {
  const period = C.resolvePeriod(query);
  const categoryParam = query.category === 'none' ? 'none' : C.objectIdParam(query.category, 'expense category');
  const vendorId = C.objectIdParam(query.vendor, 'supplier');

  const filter = { vendor: { $ne: null }, date: { $gte: period.start, $lte: period.end } };
  if (categoryParam === 'none') filter.category = null;
  else if (categoryParam) filter.category = categoryParam;
  if (vendorId) filter.vendor = vendorId;

  const [expenses, categories] = await Promise.all([
    Expense.find(filter).sort({ date: 1, _id: 1 }).lean(),
    ExpenseCategory.find({}).lean(),
  ]);
  const categoryById = new Map(categories.map(c => [String(c._id), c]));
  const entries = await JournalEntry.collection
    .find({ _id: { $in: expenses.map(e => e.journalEntry).filter(Boolean) } }, { projection: { entryNumber: 1, status: 1, lines: 1 } })
    .toArray();
  const entryById = new Map(entries.map(e => [String(e._id), e]));

  // The amount the ledger shows for each expense: its entry's debits other than input VAT.
  const accounts = await C.loadAccounts();
  const inputVatId = [...accounts.values()].find(a => a.code === AutomaticJournalAccountCodes.inputVat)?._id;

  const detail = [];
  const byCategory = new Map();
  let ledgerAmount = 0;
  for (const e of expenses) {
    const entry = entryById.get(String(e.journalEntry));
    const counted = entry?.status === 'posted';
    const category = e.category ? categoryById.get(String(e.category._id || e.category)) : null;
    const key = category ? String(category._id) : 'none';
    const amount = round2(e.amount || 0);
    const vat = round2(e.vatAmount || 0);
    const total = round2(e.totalAmount || 0);
    const paid = round2(e.paidAmount || 0);
    const outstanding = round2(total - paid);
    detail.push({
      date: e.date,
      reference: e.reference || null,
      category: category ? category.name : NO_CATEGORY.en,
      categoryAr: category ? category.nameAr || category.name : NO_CATEGORY.ar,
      vendor: e.vendor ? `${e.vendor.vendorNumber != null ? `${e.vendor.vendorNumber} - ` : ''}${e.vendor.name}` : null,
      expenseAccount: e.expenseAccount ? `${e.expenseAccount.code} - ${e.expenseAccount.name}` : null,
      amount,
      vat,
      total,
      paid,
      outstanding,
      entryNumber: entry?.entryNumber ?? null,
      status: !entry ? 'No journal entry' : counted ? 'Posted' : entry.status === 'reversed' ? 'Reversed - not counted' : entry.status,
      statusAr: !entry ? 'بدون قيد' : counted ? 'مرحل' : entry.status === 'reversed' ? 'معكوس - غير محتسب' : entry.status,
      _rowType: counted ? undefined : 'muted',
      _links: { ...(entry ? { entryNumber: { kind: 'journalEntry', id: String(entry._id) } } : {}), ...(e.vendor?._id ? { vendor: { kind: 'vendor', id: String(e.vendor._id) } } : {}) },
    });
    if (counted) {
      if (!byCategory.has(key)) byCategory.set(key, { category, count: 0, amount: 0, vat: 0, total: 0, paid: 0 });
      const g = byCategory.get(key);
      g.count += 1;
      g.amount = round2(g.amount + amount);
      g.vat = round2(g.vat + vat);
      g.total = round2(g.total + total);
      g.paid = round2(g.paid + paid);
      ledgerAmount += entry.lines.filter(l => l.debit > 0 && String(l.account) !== String(inputVatId)).reduce((s, l) => s + l.debit, 0);
    }
  }

  const grand = [...byCategory.values()].reduce((s, g) => s + g.amount, 0);
  const summaryRows = [...byCategory.values()]
    .map(g => ({
      category: g.category ? g.category.name : NO_CATEGORY.en,
      categoryAr: g.category ? g.category.nameAr || g.category.name : NO_CATEGORY.ar,
      active: g.category ? (g.category.isActive ? 'Active' : 'Inactive') : '-',
      activeAr: g.category ? (g.category.isActive ? 'نشط' : 'غير نشط') : '-',
      count: g.count,
      amount: g.amount,
      vat: g.vat,
      total: g.total,
      paid: g.paid,
      outstanding: round2(g.total - g.paid),
      share: C.pct(g.amount, grand),
    }))
    .sort((a, b) => b.amount - a.amount);

  const sums = { count: summaryRows.reduce((s, r) => s + r.count, 0), amount: C.sumBy(summaryRows, 'amount'), vat: C.sumBy(summaryRows, 'vat'), total: C.sumBy(summaryRows, 'total'), paid: C.sumBy(summaryRows, 'paid'), outstanding: C.sumBy(summaryRows, 'outstanding') };
  const money = (k, en, ar) => col(k, en, ar, 'money');
  return {
    period,
    summary: [
      summaryItem('amount', 'Expenses excl. VAT', 'المصروفات بدون الضريبة', sums.amount),
      summaryItem('vat', 'VAT', 'ضريبة القيمة المضافة', sums.vat),
      summaryItem('total', 'Total owed', 'الإجمالي المستحق', sums.total),
      summaryItem('paid', 'Paid', 'المدفوع', sums.paid),
      summaryItem('outstanding', 'Outstanding', 'المتبقي', sums.outstanding),
      summaryItem('count', 'Expenses', 'عدد المصروفات', sums.count, 'number'),
    ],
    checks: [check('Expense amounts equal their posted journal entries', 'مبالغ المصروفات تساوي قيودها المرحلة', round2(ledgerAmount) === sums.amount, `${sums.amount} / ${round2(ledgerAmount)}`)],
    sections: [
      {
        key: 'categories',
        title: L('Expenses by Category', 'المصروفات حسب التصنيف'),
        columns: [col('category', 'Category', 'التصنيف'), col('active', 'Status', 'الحالة', 'status'), col('count', 'Expenses', 'العدد', 'number'), money('amount', 'Amount excl. VAT', 'المبلغ بدون الضريبة'), money('vat', 'VAT', 'الضريبة'), money('total', 'Total', 'الإجمالي'), money('paid', 'Paid', 'المدفوع'), money('outstanding', 'Outstanding', 'المتبقي'), col('share', '% of Expenses', 'النسبة من المصروفات', 'percent')],
        rows: summaryRows,
        totals: { category: 'Total', categoryAr: 'الإجمالي', ...sums, share: summaryRows.length ? 100 : null },
      },
      {
        key: 'expenses',
        title: L('Expenses in Each Category', 'المصروفات في كل تصنيف'),
        paginate: true,
        columns: [col('date', 'Date', 'التاريخ', 'date'), col('category', 'Category', 'التصنيف'), col('reference', 'Reference', 'المرجع'), col('vendor', 'Supplier', 'المورد'), col('expenseAccount', 'Expense Account', 'حساب المصروف'), money('amount', 'Amount excl. VAT', 'المبلغ بدون الضريبة'), money('vat', 'VAT', 'الضريبة'), money('total', 'Total', 'الإجمالي'), money('paid', 'Paid', 'المدفوع'), money('outstanding', 'Outstanding', 'المتبقي'), col('entryNumber', 'Entry No.', 'رقم القيد'), col('status', 'Status', 'الحالة', 'status')],
        rows: detail,
        totals: { date: null, category: 'Total (counted)', categoryAr: 'الإجمالي (المحتسب)', ...sums },
      },
    ],
    notes: [
      note(
        'Vendor expenses dated in the period, grouped by their Expense Category. Amount excludes VAT; Total = amount + VAT (what is owed to the supplier); Paid and Outstanding come from the expense\'s recorded payments. Expenses whose journal entry was reversed are listed but not counted. Legacy cash expenses (created before vendor expenses) have no category and are not included.',
        'مصروفات الموردين المؤرخة في الفترة مجمعة حسب تصنيفها. المبلغ بدون ضريبة القيمة المضافة؛ الإجمالي = المبلغ + الضريبة (المستحق للمورد)؛ المدفوع والمتبقي من مدفوعات المصروف المسجلة. المصروفات التي عُكس قيدها تظهر ولا تُحتسب. المصروفات النقدية القديمة (قبل مصروفات الموردين) ليس لها تصنيف ولا تدخل في التقرير.'
      ),
    ],
  };
}

module.exports = { expensesByCategory };
