/**
 * Website Management - registers the website's EXISTING pages in the CMS, so their SEO can be
 * managed from the dashboard (SEO brief 2.1-2.6).
 *
 * The public website's pages are hand-written code (Reservia_Website src/pages/*, route inventory
 * src/content/seoHead.ts#ROUTES). Each one becomes a `legacy` CMS page with the same path, parent
 * and languages - and EMPTY SEO fields. An empty field means "keep the website's own text", so
 * creating these pages changes nothing on the live site. They are created unpublished; nothing
 * reaches the website until an editor fills in a field and presses Publish.
 *
 * Safe by construction:
 *   - dry run by default (prints what it would create, writes nothing);
 *   - only ever CREATES pages whose path is not already in the CMS - an existing page (and every
 *     field an editor set on it) is never modified;
 *   - idempotent: a second run finds nothing to create;
 *   - `--apply` needs `--actor-email` (recorded as the creator and in the activity log) and
 *     `--confirm-db=<database name printed by the dry run>`.
 *
 * Usage:
 *   npm run db:seed-website-pages
 *   npm run db:seed-website-pages -- --apply --actor-email=<website admin> --confirm-db=<database name>
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

// Mirrors Reservia_Website src/content/seoHead.ts#ROUTES (path '' there is '/' here). Keep the two
// in step when a page is added to the website.
const WEBSITE_PAGES = [
  { slug: 'home', path: '/', isHomePage: true },
  { slug: 'residential', path: '/residential', parentSlug: 'home' },
  { slug: 'agriculture', path: '/agriculture', parentSlug: 'home' },
  { slug: 'industrial', path: '/industrial', parentSlug: 'home' },
  { slug: 'oil-gas', path: '/oil-gas', parentSlug: 'industrial' },
  { slug: 'service', path: '/service', parentSlug: 'home' },
  { slug: 'solar-irrigation-guide', path: '/solar-irrigation-guide', parentSlug: 'agriculture', locales: ['ar'] },
  { slug: 'calculator', path: '/calculator', parentSlug: 'home' },
  { slug: 'how-we-work', path: '/how-we-work', parentSlug: 'home' },
  { slug: 'about', path: '/about', parentSlug: 'home' },
  { slug: 'contact', path: '/contact', parentSlug: 'home' },
  // Campaign landing pages: never indexed (the website already treats them so).
  { slug: 'lp-villas', path: '/lp/villas', noindex: true },
  { slug: 'lp-compounds', path: '/lp/compounds', noindex: true },
  { slug: 'lp-agriculture', path: '/lp/agriculture', noindex: true },
  { slug: 'lp-industrial', path: '/lp/industrial', noindex: true },
  { slug: 'lp-service', path: '/lp/service', noindex: true },
];

const argValue = (argv, name) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

/** Which website pages are missing from the CMS (by path or slug). Pure. */
function planSeed(existing) {
  const paths = new Set(existing.map(p => p.path));
  const slugs = new Set(existing.map(p => p.slug));
  const create = [];
  const skip = [];
  for (const def of WEBSITE_PAGES) {
    if (paths.has(def.path)) skip.push({ ...def, reason: 'path already in the CMS' });
    else if (slugs.has(def.slug)) skip.push({ ...def, reason: `slug "${def.slug}" already used by another page` });
    else create.push(def);
  }
  return { create, skip };
}

async function seedWebsitePages({ connect = true, argv = process.argv, log = console.log } = {}) {
  const apply = argv.includes('--apply');
  const actorEmail = (argValue(argv, 'actor-email') || '').trim().toLowerCase();
  const confirmDb = argValue(argv, 'confirm-db');
  if (apply && !actorEmail) throw new SafetyError('--apply needs --actor-email=<a Website Management admin> - the pages are created in their name.');

  if (connect) {
    loadEnv();
    assertDbUriConfigured();
    await mongoose.connect(process.env.DB_URI);
  }
  const dbName = assertSafeDatabaseName(mongoose.connection);
  log(`Connected (host: ${mongoose.connection.host}, db: ${dbName}).`);
  if (dbName === 'test') log('NOTE: database "test" is the MongoDB driver default - DB_URI names no database. Make sure this is the database the live backend uses.');
  if (connect) await assertNotLeopardDatabase(mongoose.connection);
  if (apply && confirmDb !== dbName) throw new SafetyError(`--apply refused: add --confirm-db=${dbName} to confirm you mean to write to database "${dbName}".`);

  // eslint-disable-next-line global-require
  const WebsitePage = require('../models/website/websitePageModel');
  // eslint-disable-next-line global-require
  const User = require('../models/userModel');
  // eslint-disable-next-line global-require
  const { logWebsiteActivity } = require('../utils/website/activityLog');

  // Deleted (inactive) pages count too: re-creating a page someone deliberately removed is an
  // editor's decision, not a script's.
  const existing = await WebsitePage.find({}).select('slug path isActive').lean();
  const { create, skip } = planSeed(existing);

  log(`\nCMS pages already present: ${existing.length}`);
  for (const s of skip) log(`  SKIP   ${s.path.padEnd(26)} ${s.reason}`);
  for (const c of create) log(`  CREATE ${c.path.padEnd(26)} slug=${c.slug} type=legacy languages=${(c.locales || ['ar', 'en']).join('+')}${c.noindex ? ' noindex' : ''}`);
  if (!create.length) {
    log('\nNothing to do - every website page is already in the CMS.');
    return { create, skip, applied: false };
  }
  if (!apply) {
    log(`\nDry run complete - nothing was written. To create the ${create.length} page(s) above:\n  --apply --actor-email=<website admin> --confirm-db=${dbName}`);
    return { create, skip, applied: false };
  }

  const escaped = actorEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const actor = await User.findOne({ email: new RegExp(`^${escaped}$`, 'i') });
  if (!actor) throw new SafetyError(`No user with email ${actorEmail}.`);
  const membership = (actor.systemMemberships || []).find(m => m.system === 'WEBSITE');
  if (!membership || membership.isActive === false || membership.role !== 'admin') {
    throw new SafetyError(`${actorEmail} is not an active Website Management admin - the pages must be created by one.`);
  }

  const created = [];
  for (const def of create) {
    const page = await WebsitePage.create({
      slug: def.slug,
      path: def.path,
      isHomePage: !!def.isHomePage,
      pageType: 'legacy',
      parentSlug: def.parentSlug || null,
      sortOrder: WEBSITE_PAGES.indexOf(def),
      locales: def.locales || ['ar', 'en'],
      seo: { noindex: !!def.noindex },
      createdBy: actor._id,
    });
    await logWebsiteActivity({ actor, action: 'page.create', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug, after: { seededFrom: 'website route inventory', path: page.path } });
    created.push(page.slug);
  }
  log(`\nApplied - created ${created.length} unpublished legacy page(s): ${created.join(', ')}.`);
  return { create, skip, applied: true, created };
}

if (require.main === module) {
  seedWebsitePages()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\ndb:seed-website-pages failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { seedWebsitePages, planSeed, WEBSITE_PAGES };
