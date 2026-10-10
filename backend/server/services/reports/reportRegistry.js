const FS = require('./financialStatements');
const PR = require('./projectReports');
const PA = require('./partyReports');
const LR = require('./ledgerReports');
const TX = require('./taxReports');
const EC = require('./expenseCategoryReports');
const GL = require('./generalLedgerReport');
const PC = require('./projectCostReports');
const { L } = require('./reportCommon');

// The accounting reports catalog (from the reports list "تقارير.csv"): category, bilingual title,
// kind (period = movements between two dates; asOf = position at a date; list = records matching
// the filters) and the filters that are meaningful for each report.
const CATEGORIES = [
  { key: 'financial-statements', title: L('Financial Statements', 'القوائم المالية') },
  { key: 'projects', title: L('Projects', 'المشروعات') },
  { key: 'customers', title: L('Customers', 'العملاء') },
  { key: 'suppliers', title: L('Suppliers', 'الموردين') },
  { key: 'banks', title: L('Banks and Cash Equivalents', 'البنوك وما في حكمها') },
  { key: 'fixed-assets', title: L('Fixed Assets', 'الأصول الثابتة') },
  { key: 'expenses', title: L('Expenses', 'المصروفات') },
  { key: 'taxes', title: L('Taxes Reports', 'تقارير الضرائب') },
];

const PROJECT_FILTERS = ['customer', 'project', 'sector', 'projectStatus'];
const TAX_FILTERS = ['period', 'taxAccount', 'taxMovement', 'taxSource', 'customer', 'vendor', 'project', 'taxReference'];

const REPORTS = [
  { key: 'general-ledger', category: 'financial-statements', kind: 'period', title: L('General Ledger - Line Items', 'دفتر الأستاذ العام - تفصيلي'), filters: ['period', 'glAccount', 'project', 'customer', 'vendor', 'entryNumber', 'glSearch', 'glSort'], run: GL.generalLedgerLines },
  { key: 'trial-balance', category: 'financial-statements', kind: 'period', title: L('Trial Balance', 'ميزان المراجعة'), filters: ['period', 'includeZero'], run: FS.trialBalance },
  { key: 'financial-position', category: 'financial-statements', kind: 'asOf', title: L('Statement of Financial Position', 'قائمة المركز المالي'), filters: ['asOf'], run: FS.financialPosition },
  { key: 'profit-loss', category: 'financial-statements', kind: 'period', title: L('Statement of Profit or Loss', 'قائمة الدخل'), filters: ['period'], run: FS.profitLoss },
  { key: 'cash-flow', category: 'financial-statements', kind: 'period', title: L('Statement of Cash Flows', 'قائمة التدفقات النقدية'), filters: ['period'], run: FS.cashFlow },
  { key: 'changes-in-equity', category: 'financial-statements', kind: 'period', title: L('Statement of Changes in Equity', 'قائمة التغير في حقوق الملكية'), filters: ['period'], run: FS.changesInEquity },
  { key: 'disclosure-notes', category: 'financial-statements', kind: 'asOf', title: L('Notes to the Financial Statements', 'الإيضاحات المتممة للقوائم المالية'), filters: ['asOf'], run: LR.disclosureNotes },

  { key: 'projects-status', category: 'projects', kind: 'list', title: L('Projects and Their Status', 'بيان بالمشروعات وحالتها'), filters: PROJECT_FILTERS, run: PR.projectsStatus },
  { key: 'projects-by-status', category: 'projects', kind: 'list', title: L('Number of Projects by Status', 'بيان بعدد المشروعات في كل حالة'), filters: ['customer', 'sector'], run: PR.projectsByStatus },
  { key: 'project-profitability', category: 'projects', kind: 'period', title: L('Project Profitability and Gross Profit Margin', 'بيان بربحية كل مشروع ونسبة مجمل الربح'), filters: ['period', ...PROJECT_FILTERS], run: PR.projectProfitability },
  { key: 'project-cash-flows', category: 'projects', kind: 'period', title: L('Cash Flows by Project', 'بيان بالتدفقات النقدية لكل مشروع'), filters: ['period', ...PROJECT_FILTERS], run: PR.projectCashFlows },
  { key: 'project-costs', category: 'projects', kind: 'period', title: L('PUC / Project Cost Report', 'تقرير تكاليف المشروعات (مشروعات تحت التنفيذ)'), filters: ['period', ...PROJECT_FILTERS, 'pucCategory', 'pucAccount', 'vendor', 'pucSource'], run: PC.projectCosts },
  { key: 'projects-by-sector', category: 'projects', kind: 'list', title: L('Number of Projects by Sector', 'بيان بعدد المشروعات في كل سيكتور'), filters: ['customer', 'projectStatus'], run: PR.projectsBySector },
  { key: 'sector-profitability', category: 'projects', kind: 'period', title: L('Profitability by Sector', 'بيان بربحية كل سيكتور'), filters: ['period', 'customer', 'projectStatus'], run: PR.sectorProfitability },
  { key: 'sector-cash-flows', category: 'projects', kind: 'period', title: L('Cash Flows by Sector', 'بيان بالتدفقات النقدية لكل سيكتور'), filters: ['period', 'customer', 'projectStatus'], run: PR.sectorCashFlows },

  { key: 'customer-balances', category: 'customers', kind: 'period', title: L('Customer Balances', 'بيان بأرصدة العملاء'), filters: ['period', 'customer', 'byProject'], run: PA.customerBalances },
  { key: 'customer-aging', category: 'customers', kind: 'asOf', title: L('Accounts Receivable Aging', 'بيان بأعمار المديونية للعملاء'), filters: ['asOf', 'customer', 'termDays'], run: PA.customerAging },
  { key: 'sales-orders', category: 'customers', kind: 'period', title: L('Sales Orders', 'بيان بأوامر البيع'), filters: ['period', 'customer', 'project', 'orderStatus', 'paymentStatus'], run: PA.salesOrders },
  { key: 'sales-order-profitability', category: 'customers', kind: 'period', title: L('Sales Order Profitability', 'بيان بربحية كل أمر بيع'), filters: ['period', 'customer', 'project', 'orderStatus'], run: PA.salesOrderProfitability },
  { key: 'customer-profitability', category: 'customers', kind: 'period', title: L('Customer Profitability', 'بيان بربحية كل عميل'), filters: ['period', 'customer', 'sector'], run: PA.customerProfitability },

  { key: 'supplier-balances', category: 'suppliers', kind: 'period', title: L('Supplier Balances', 'بيان بأرصدة الموردين'), filters: ['period', 'vendor', 'byProject'], run: PA.supplierBalances },
  { key: 'supplier-aging', category: 'suppliers', kind: 'asOf', title: L('Accounts Payable Aging', 'بيان بأعمار دائنية الموردين'), filters: ['asOf', 'vendor', 'termDays'], run: PA.supplierAging },
  { key: 'purchase-orders', category: 'suppliers', kind: 'period', title: L('Purchase Orders', 'بيان بأوامر الشراء'), filters: ['period', 'vendor', 'project', 'paymentStatus'], run: PA.purchaseOrders },

  { key: 'bank-cash', category: 'banks', kind: 'period', title: L('Bank and Cash Accounts Statement', 'بيان بالبنوك وما في حكمها وحركة كل بنك وأرصدته'), filters: ['period', 'cashAccount'], run: LR.bankCash },

  { key: 'fixed-asset-register', category: 'fixed-assets', kind: 'asOf', title: L('Fixed Assets Register', 'بيان بالأصول الثابتة'), filters: ['asOf', 'assetStatus', 'assetClass', 'vendor'], run: LR.fixedAssetRegister },
  { key: 'depreciation-by-asset', category: 'fixed-assets', kind: 'period', title: L('Depreciation and Amortization by Asset', 'بيان بالإهلاكات والاستهلاكات لكل أصل'), filters: ['period', 'assetStatus', 'assetClass'], run: LR.depreciationByAsset },

  { key: 'expenses-by-account', category: 'expenses', kind: 'period', title: L('Expenses by Account with Counterpart Accounts', 'بيان بالمصروفات والحساب المقابل ونسبتها لإجمالي المصروفات'), filters: ['period', 'expenseAccount', 'expenseType'], run: LR.expensesByAccount },
  { key: 'expenses-by-category', category: 'expenses', kind: 'period', title: L('Expenses by Category', 'بيان بالمصروفات حسب التصنيف'), filters: ['period', 'expenseCategory', 'vendor'], run: EC.expensesByCategory },

  { key: 'tax-wht-debit', category: 'taxes', kind: 'period', title: L('Commercial and Industrial Profit Tax - Debit', 'ضرائب الأرباح التجارية والصناعية - مدين'), filters: TAX_FILTERS, run: TX.whtDebit },
  { key: 'tax-wht-credit', category: 'taxes', kind: 'period', title: L('Commercial and Industrial Profit Tax - Credit', 'ضرائب الأرباح التجارية والصناعية - دائن'), filters: TAX_FILTERS, run: TX.whtCredit },
  { key: 'tax-vat-debit', category: 'taxes', kind: 'period', title: L('Value Added Tax - Debit', 'ضرائب القيمة المضافة - مدين'), filters: TAX_FILTERS, run: TX.vatDebit },
  { key: 'tax-vat-credit', category: 'taxes', kind: 'period', title: L('Value Added Tax - Credit', 'ضرائب القيمة المضافة - دائن'), filters: TAX_FILTERS, run: TX.vatCredit },
  { key: 'tax-accounts-overview', category: 'taxes', kind: 'period', title: L('Tax Accounts Overview', 'ملخص حسابات الضرائب'), filters: ['period'], run: TX.taxAccountsOverview },
];

const REPORTS_BY_KEY = new Map(REPORTS.map(r => [r.key, r]));

const catalog = () => ({
  categories: CATEGORIES.map(c => ({ ...c, reports: REPORTS.filter(r => r.category === c.key).map(({ key, kind, title, filters }) => ({ key, kind, title, filters })) })),
});

module.exports = { CATEGORIES, REPORTS, REPORTS_BY_KEY, catalog };
