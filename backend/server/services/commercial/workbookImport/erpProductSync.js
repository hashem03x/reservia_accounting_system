'use strict';

const MaterialItem = require('../../../models/commercial/materialItemModel');
const Product = require('../../../models/inventory/productModel');
const Category = require('../../../models/categoryModel');
const SubCategory = require('../../../models/subCategoryModel');
const { canonicalizePart } = require('../../../utils/commercial/materialKey');
const { hasActiveErpMembership } = require('../../../utils/systemAccess');
const { userHasPermission } = require('../../../middleware/hasPermission');
const { Resources, Actions } = require('../../../utils/appConstant');

// ERP side of the workbook import: every Price Book item gets its ERP inventory Product, linked
// through MaterialItem.erpProduct - the one exact link the Won -> ERP BOQ transfer and "Create PR"
// use (services/commercial/boqProductMatchingService.js). So a Won deal's BOQ lines arrive in the ERP
// project, and Purchasing can raise requisitions, without anyone matching products by hand.
//   - An existing ERP product is reused only when it is unmistakably the same item: same model
//     (canonical) AND same brand (its Brand subcategory) or the exact same title. Nothing fuzzy.
//   - Otherwise a product is created the way the product form / CSV import creates one: Category =
//     the Price Book category, Brand = a subcategory of it (both created when missing), Model,
//     Specifications, Capacity. Cost and selling price are left empty on purpose: the Price Book's
//     reference price is not a purchase cost (a purchase sets the cost - productModel.js), and a
//     product's price is the selling price.
// Needs ERP access with Products "create" - the same right the ERP product form needs.

const AR = {
  'PV Modules': 'الألواح الشمسية',
  'On-Grid Inverter': 'عاكسات الربط بالشبكة',
  'Off-Grid Inverter': 'عاكسات الأنظمة المنفصلة',
  'Hybrid Inverter': 'العاكسات الهجينة',
  'Lithium Batteries': 'بطاريات الليثيوم',
  'DC Cable': 'كابلات التيار المستمر',
  'AC Cable': 'كابلات التيار المتردد',
  'AC Breaker': 'قواطع التيار المتردد',
  'Electrical Protection': 'الحمايات الكهربائية',
  'MC4 Connectors': 'موصلات MC4',
  'AC Distribution Board': 'لوحات توزيع التيار المتردد',
  'Mounting Structure': 'هياكل التثبيت',
  'Submersible Pump': 'المضخات الغاطسة',
  'Pump Motor': 'مواتير المضخات',
  'Solar Pump Drive': 'محولات تشغيل المضخات الشمسية',
  Pipe: 'المواسير',
  'Metallic Panel': 'اللوحات المعدنية',
  'AC Reactor': 'مفاعلات التيار المتردد',
  'DC Charge Controller': 'منظمات الشحن',
};
const CAPACITY = {
  'PV Modules': ['pmaxW', 'W'],
  'On-Grid Inverter': ['ratedKw', 'kW'],
  'Off-Grid Inverter': ['ratedKw', 'kW'],
  'Hybrid Inverter': ['ratedKw', 'kW'],
  'Solar Pump Drive': ['ratedKw', 'kW'],
  'Lithium Batteries': ['capacityAh', 'Ah'],
  'DC Cable': ['sizeMm2', 'mm2'],
  'AC Cable': ['sizeMm2', 'mm2'],
  'Submersible Pump': ['hp', 'HP'],
  'Pump Motor': ['hp', 'HP'],
};

const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
const canon = s => canonicalizePart(s);

/** Whether `user` may create ERP products, and why not. */
async function status(user) {
  const missing = await MaterialItem.countDocuments({ archived: false, erpProduct: null });
  if (!hasActiveErpMembership(user)) return { canApply: false, reason: 'Creating ERP products needs ERP access with Products - create.', unlinked: missing };
  if (!userHasPermission(user, Resources.products, Actions.create)) return { canApply: false, reason: 'Creating ERP products needs the ERP Products - create permission.', unlinked: missing };
  return { canApply: true, reason: null, unlinked: missing };
}

async function ensureCategory(name, cache) {
  if (cache.has(name)) return cache.get(name);
  let cat = await Category.findOne({ 'name.en': name });
  if (cat && cat.isDeleted) await Category.updateOne({ _id: cat._id }, { $set: { isDeleted: false } }); // names are unique - bring it back rather than fail
  if (!cat) cat = await Category.create({ name: { en: name, ar: AR[name] || name }, slug: slugify(name) });
  cache.set(name, cat);
  return cat;
}

async function ensureBrand(category, brand, cache) {
  const k = `${category._id}#${canon(brand)}`;
  if (cache.has(k)) return cache.get(k);
  const all = await SubCategory.find({ mainCategory: category._id }).lean();
  let sub = all.find(s => canon(s.name?.en ?? s.name) === canon(brand));
  if (!sub) sub = (await SubCategory.create({ name: { en: brand, ar: brand }, slug: slugify(brand), mainCategory: category._id })).toObject();
  cache.set(k, sub);
  return sub;
}

/** Creates/links an ERP product for every non-archived Price Book item that has none. */
async function apply(user) {
  const st = await status(user);
  if (!st.canApply) return { ...st, created: 0, linked: 0 };
  const items = await MaterialItem.find({ archived: false, erpProduct: null }).select('category brand model spec unit attrs n1 key').lean();
  if (!items.length) return { canApply: true, created: 0, linked: 0, failed: 0, errors: [] };

  // Existing catalog: titles (unique in both languages) and model+brand pairs.
  const products = await Product.find({ isDeleted: { $ne: true } }).select('title model subcategory type').populate({ path: 'subcategory', select: 'name' }).lean();
  const takenTitles = new Set();
  const byTitle = new Map();
  const byModelBrand = new Map();
  for (const p of products) {
    const en = p.title?.en ?? p.title;
    const ar = p.title?.ar;
    if (en) {
      takenTitles.add(canon(en));
      byTitle.set(canon(en), [...(byTitle.get(canon(en)) || []), p]);
    }
    if (ar) takenTitles.add(canon(ar));
    if (p.model && p.type !== 'service') {
      const brand = p.subcategory?.name?.en ?? p.subcategory?.name ?? '';
      const k = `${canon(p.model)}#${canon(brand)}`;
      byModelBrand.set(k, [...(byModelBrand.get(k) || []), p]);
    }
  }

  const catCache = new Map();
  const brandCache = new Map();
  const links = [];
  const toCreate = [];
  // Two Price Book items with the same brand + model (e.g. a pump in cast iron and in SS304) are two
  // products - an existing product is reused for one only when that pair is unique on our side too.
  const pairCount = new Map();
  for (const it of items) {
    const k = `${canon(it.model)}#${canon(it.brand)}`;
    pairCount.set(k, (pairCount.get(k) || 0) + 1);
  }
  for (const it of items) {
    const baseTitle = `${it.brand} ${it.model}`.trim();
    const pair = `${canon(it.model)}#${canon(it.brand)}`;
    const exact = pairCount.get(pair) === 1 ? byModelBrand.get(pair) || byTitle.get(canon(baseTitle)) || [] : [];
    if (exact.length === 1) {
      links.push({ itemId: it._id, productId: exact[0]._id });
      continue;
    }
    // A unique title: brand + model, then + spec, then + the Price Book key.
    let title = baseTitle;
    if (takenTitles.has(canon(title)) && it.spec) title = `${baseTitle} - ${it.spec}`;
    if (takenTitles.has(canon(title))) title = `${baseTitle} (${it.key})`;
    if (takenTitles.has(canon(title))) continue; // cannot be made unique - left for Purchasing
    takenTitles.add(canon(title));
    // eslint-disable-next-line no-await-in-loop
    const category = await ensureCategory(it.category, catCache);
    // eslint-disable-next-line no-await-in-loop
    const brand = await ensureBrand(category, it.brand, brandCache);
    const cap = CAPACITY[it.category];
    const capValue = cap ? (it.attrs?.[cap[0]] ?? null) : null;
    const desc = it.spec ? `${it.category} - ${it.spec}` : it.category;
    toCreate.push({
      itemId: it._id,
      doc: {
        type: 'product',
        title: { en: title, ar: title },
        description: { en: desc, ar: AR[it.category] ? `${AR[it.category]} - ${it.spec || it.model}` : desc },
        category: category._id,
        subcategory: brand._id,
        model: it.model,
        specifications: it.spec || undefined,
        ...(typeof capValue === 'number' && capValue > 0 ? { capacity: { value: capValue, unit: cap[1] } } : {}),
        createdBy: user._id,
      },
    });
  }

  let created = 0;
  const errors = [];
  for (let i = 0; i < toCreate.length; i += 300) {
    const batch = toCreate.slice(i, i + 300);
    try {
      // eslint-disable-next-line no-await-in-loop
      await Product.insertMany(batch.map(b => b.doc), { ordered: false });
    } catch (err) {
      // ordered:false - the rest of the batch is inserted; a row that failed (e.g. a title someone
      // created meanwhile) is reported and left unlinked.
      for (const we of err.writeErrors || []) errors.push(we.errmsg || we.err?.errmsg || String(we));
      if (!err.writeErrors) throw err;
    }
    // What was actually inserted, read back by its (unique) title.
    // eslint-disable-next-line no-await-in-loop
    const docs = await Product.find({ 'title.en': { $in: batch.map(b => b.doc.title.en) } }).select('title').lean();
    const byNewTitle = new Map(docs.map(d => [canon(d.title?.en ?? d.title), d._id]));
    for (const b of batch) {
      const id = byNewTitle.get(canon(b.doc.title.en));
      if (id) {
        links.push({ itemId: b.itemId, productId: id });
        created += 1;
      }
    }
  }
  if (links.length) {
    const ops = links.map(l => ({ updateOne: { filter: { _id: l.itemId, erpProduct: null }, update: { $set: { erpProduct: l.productId } } } }));
    for (let i = 0; i < ops.length; i += 500) {
      // eslint-disable-next-line no-await-in-loop
      await MaterialItem.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
  }
  return { canApply: true, created, linked: links.length, reused: links.length - created, failed: errors.length, errors: errors.slice(0, 10), remaining: await MaterialItem.countDocuments({ archived: false, erpProduct: null }) };
}

module.exports = { status, apply };
