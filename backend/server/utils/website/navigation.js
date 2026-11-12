'use strict';

const crypto = require('crypto');
const ApiError = require('../apiError');

// Website Management - header/footer navigation: validation of what the dashboard saves and the
// PUBLIC view the website renders. Shape (stored in websiteNavigationModel.js's Mixed arrays):
//
//   header entry  { id, type:'link'|'group', labelEn, labelAr, linkType:'page'|'external',
//                   pageSlug, externalUrl, target:'_self'|'_blank', visible, items:[entry...] }
//   footer column { id, titleEn, titleAr, visible, items:[link entry...] }
//
// Older documents (before linkType existed) are read with linkType inferred from which of
// pageSlug/externalUrl is set. The public view only ever links to PUBLISHED pages: a link to an
// unpublished, archived or deleted page silently disappears from the live menus (and a group left
// with nothing in it disappears with it) - the dashboard shows the same fact as a warning.

const MAX_DEPTH = 3; // top level -> dropdown -> nested dropdown
const MAX_ENTRIES = 80;
const SAFE_EXTERNAL = /^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|tel:[+0-9 ()-]+|\/[^\s<>"']*|#[A-Za-z0-9_-]+)$/i;

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const newId = () => crypto.randomBytes(6).toString('hex');

function normalizeEntry(raw, depth, ctx, where) {
  if (!raw || typeof raw !== 'object') throw new ApiError(`${where}: invalid menu item.`, 400);
  ctx.count += 1;
  if (ctx.count > MAX_ENTRIES) throw new ApiError(`A menu can hold at most ${MAX_ENTRIES} items.`, 400);
  const labelEn = text(raw.labelEn, 60);
  const labelAr = text(raw.labelAr, 60);
  if (!labelEn && !labelAr) throw new ApiError(`${where}: every menu item needs a label (English or Arabic).`, 400);
  const label = labelEn || labelAr;
  const hasChildren = Array.isArray(raw.items) && raw.items.length > 0;
  const type = raw.type === 'group' || (raw.type !== 'link' && hasChildren) ? 'group' : 'link';
  const entry = {
    id: typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ? raw.id : newId(),
    type,
    labelEn,
    labelAr,
    visible: raw.visible !== false,
  };
  if (type === 'group') {
    if (depth >= MAX_DEPTH) throw new ApiError(`"${label}": menus can be nested at most ${MAX_DEPTH} levels deep.`, 400);
    entry.items = (Array.isArray(raw.items) ? raw.items : []).map((c, i) => normalizeEntry(c, depth + 1, ctx, `"${label}" item ${i + 1}`));
    // A group may also be a link itself (clicking the parent opens a page) - optional.
    if (raw.pageSlug || raw.externalUrl) Object.assign(entry, normalizeTarget(raw, ctx, label));
    return entry;
  }
  return Object.assign(entry, normalizeTarget(raw, ctx, label, true));
}

function normalizeTarget(raw, ctx, label, required = false) {
  const linkType = raw.linkType === 'external' || (!raw.linkType && raw.externalUrl && !raw.pageSlug) ? 'external' : 'page';
  const target = raw.target === '_blank' ? '_blank' : '_self';
  if (linkType === 'external') {
    const externalUrl = text(raw.externalUrl, 500);
    if (!externalUrl && required) throw new ApiError(`"${label}": enter the link address.`, 400);
    if (externalUrl && !SAFE_EXTERNAL.test(externalUrl)) throw new ApiError(`"${label}": the link must start with https://, http://, mailto:, tel:, / or #.`, 400);
    return { linkType, externalUrl, pageSlug: '', target };
  }
  const pageSlug = text(raw.pageSlug, 100).toLowerCase();
  if (!pageSlug && required) throw new ApiError(`"${label}": choose the page this item opens.`, 400);
  if (pageSlug && ctx.knownSlugs && !ctx.knownSlugs.has(pageSlug)) throw new ApiError(`"${label}": the page "${pageSlug}" does not exist.`, 400);
  return { linkType, pageSlug, externalUrl: '', target };
}

/**
 * Validates and normalizes a navigation payload. `knownSlugs` = slugs of every active page (links
 * to a page that does not exist are refused; links to drafts are allowed - they appear once the
 * page is published).
 */
function normalizeNavigation({ headerEntries, footerColumns } = {}, { knownSlugs } = {}) {
  const ctx = { count: 0, knownSlugs };
  const out = {};
  if (headerEntries !== undefined) {
    if (!Array.isArray(headerEntries)) throw new ApiError('headerEntries must be a list.', 400);
    out.headerEntries = headerEntries.map((e, i) => normalizeEntry(e, 1, ctx, `Header item ${i + 1}`));
  }
  if (footerColumns !== undefined) {
    if (!Array.isArray(footerColumns)) throw new ApiError('footerColumns must be a list.', 400);
    if (footerColumns.length > 6) throw new ApiError('The footer can have at most 6 columns.', 400);
    out.footerColumns = footerColumns.map((col, i) => {
      if (!col || typeof col !== 'object') throw new ApiError(`Footer column ${i + 1} is invalid.`, 400);
      const titleEn = text(col.titleEn ?? col.labelEn, 60);
      const titleAr = text(col.titleAr ?? col.labelAr, 60);
      if (!titleEn && !titleAr) throw new ApiError(`Footer column ${i + 1} needs a title.`, 400);
      return {
        id: typeof col.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(col.id) ? col.id : newId(),
        titleEn,
        titleAr,
        visible: col.visible !== false,
        // Footer columns are one level: a column of links.
        items: (Array.isArray(col.items) ? col.items : []).map((e, j) => {
          const entry = normalizeEntry({ ...e, type: 'link', items: undefined }, MAX_DEPTH, ctx, `Footer "${titleEn || titleAr}" link ${j + 1}`);
          return entry;
        }),
      };
    });
  }
  return out;
}

/** Problems an editor should see (links to pages that are not live). Never blocks saving. */
function navigationWarnings(nav, pagesBySlug) {
  const warnings = [];
  const walk = (list, where) =>
    (list || []).forEach(e => {
      const label = e.labelEn || e.labelAr || e.titleEn || e.titleAr;
      if (e.pageSlug) {
        const p = pagesBySlug.get(e.pageSlug);
        if (!p) warnings.push(`${where} "${label}" links to a page that no longer exists - it is hidden on the website.`);
        else if (p.status !== 'published') warnings.push(`${where} "${label}" links to "${e.pageSlug}", which is not published - it is hidden on the website until that page is published.`);
      }
      if (Array.isArray(e.items)) walk(e.items, where);
    });
  walk(nav.headerEntries, 'Header item');
  (nav.footerColumns || []).forEach(col => walk(col.items, `Footer "${col.titleEn || col.titleAr}" link`));
  return warnings;
}

/**
 * The public menus: only visible items, page links resolved to the page's path and kept only when
 * that page is published (`publishedBySlug`: slug -> published page). Output entries:
 * { type, labelEn, labelAr, href, external, target, items? }.
 */
function publicNavigation(nav, publishedBySlug) {
  const resolve = e => {
    if (e.linkType === 'external' || (!e.pageSlug && e.externalUrl)) return e.externalUrl ? { href: e.externalUrl, external: /^(https?:|mailto:|tel:)/i.test(e.externalUrl) } : null;
    if (!e.pageSlug) return null;
    const page = publishedBySlug.get(e.pageSlug);
    return page ? { href: page.path || '/', external: false, pageSlug: page.slug } : null;
  };
  const walk = list =>
    (list || [])
      .filter(e => e && e.visible !== false)
      .map(e => {
        const base = { type: e.type === 'group' ? 'group' : 'link', labelEn: e.labelEn || '', labelAr: e.labelAr || '', target: e.target === '_blank' ? '_blank' : '_self' };
        if (base.type === 'group') {
          const items = walk(e.items);
          if (!items.length) return null;
          const link = resolve(e);
          return { ...base, ...(link || {}), items };
        }
        const link = resolve(e);
        return link ? { ...base, ...link } : null;
      })
      .filter(Boolean);
  return {
    header: walk(nav?.headerEntries),
    footer: (nav?.footerColumns || [])
      .filter(c => c && c.visible !== false)
      .map(c => ({ titleEn: c.titleEn || c.labelEn || '', titleAr: c.titleAr || c.labelAr || '', items: walk(c.items) }))
      .filter(c => c.items.length),
  };
}

module.exports = { normalizeNavigation, navigationWarnings, publicNavigation, MAX_DEPTH, SAFE_EXTERNAL };
