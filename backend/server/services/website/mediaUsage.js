'use strict';

const WebsitePage = require('../../models/website/websitePageModel');
const WebsiteSection = require('../../models/website/websiteSectionModel');
const WebsiteRevision = require('../../models/website/websiteRevisionModel');
const WebsiteSettings = require('../../models/website/websiteSettingsModel');

// Website Management - where is a media file used? One scan of everything that can reference a
// media URL, answering for every URL at once (the library list shows a usage count per file):
//   - LIVE:      published (and scheduled) page snapshots, and the site settings (logo, favicon,
//                default share image) - these are on, or about to be on, the public website;
//   - DRAFT:     the editable sections and page SEO images.
// Deleting a file that is LIVE is refused (it would break the public site); a draft-only file
// may be removed after an explicit confirmation.

function collectStrings(value, out) {
  if (!value) return out;
  if (typeof value === 'string') {
    out.add(value);
  } else if (Array.isArray(value)) {
    value.forEach(v => collectStrings(v, out));
  } else if (typeof value === 'object') {
    Object.values(value).forEach(v => collectStrings(v, out));
  }
  return out;
}

function add(map, url, use) {
  if (!url) return;
  if (!map.has(url)) map.set(url, []);
  const list = map.get(url);
  if (!list.some(u => u.scope === use.scope && u.where === use.where && String(u.pageId || '') === String(use.pageId || ''))) list.push(use);
}

/** Map<url, [{ scope:'live'|'draft', where, pageId, pageSlug }]> for every referenced string. */
async function buildUsageIndex() {
  const pages = await WebsitePage.find({ isActive: true }).select('slug seo.ogImage publishedRevision scheduledRevision status').lean();
  const pageById = new Map(pages.map(p => [String(p._id), p]));
  const map = new Map();

  const sections = await WebsiteSection.find({ page: { $in: pages.map(p => p._id) } }).select('page type content settings').lean();
  for (const s of sections) {
    const p = pageById.get(String(s.page));
    for (const str of collectStrings([s.content, s.settings], new Set())) add(map, str, { scope: 'draft', where: `Section (${s.type})`, pageId: p._id, pageSlug: p.slug });
  }
  for (const p of pages) if (p.seo?.ogImage?.url) add(map, p.seo.ogImage.url, { scope: 'draft', where: 'Page share image', pageId: p._id, pageSlug: p.slug });

  const liveRevisionIds = pages.flatMap(p => [p.status === 'published' ? p.publishedRevision : null, p.scheduledRevision]).filter(Boolean);
  if (liveRevisionIds.length) {
    const revisions = await WebsiteRevision.find({ _id: { $in: liveRevisionIds } }).select('page snapshot').lean();
    for (const r of revisions) {
      const p = pageById.get(String(r.page));
      if (!p) continue;
      const scheduled = String(r._id) === String(p.scheduledRevision);
      for (const str of collectStrings(r.snapshot, new Set())) add(map, str, { scope: 'live', where: scheduled ? 'Scheduled version' : 'Published page', pageId: p._id, pageSlug: p.slug });
    }
  }

  const settings = await WebsiteSettings.findById(WebsiteSettings.SINGLETON_ID).lean();
  if (settings) {
    const labels = { logo: 'Site logo', logoDark: 'Site logo (dark)', favicon: 'Favicon', defaultOgImage: 'Default share image' };
    for (const [key, label] of Object.entries(labels)) if (settings[key]?.url) add(map, settings[key].url, { scope: 'live', where: label, pageId: null, pageSlug: null });
  }
  return map;
}

async function usageOf(url) {
  const index = await buildUsageIndex();
  return index.get(url) || [];
}

const summarize = uses => ({ total: uses.length, live: uses.filter(u => u.scope === 'live').length, draft: uses.filter(u => u.scope === 'draft').length });

/** Replaces every DRAFT reference to `fromUrl` with `to` ({url, publicId}); live snapshots are frozen. */
async function replaceDraftReferences(fromUrl, to) {
  const swap = value => {
    if (Array.isArray(value)) return value.map(swap);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = swap(v);
      if (out.url === to.url && value.url === fromUrl && 'publicId' in value) out.publicId = to.publicId;
      return out;
    }
    return value === fromUrl ? to.url : value;
  };
  let changed = 0;
  const sections = await WebsiteSection.find({}).select('content settings').lean();
  for (const s of sections) {
    const hits = collectStrings([s.content, s.settings], new Set());
    if (!hits.has(fromUrl)) continue;
    // eslint-disable-next-line no-await-in-loop
    await WebsiteSection.updateOne({ _id: s._id }, { $set: { content: swap(s.content || {}), settings: swap(s.settings || {}) } });
    changed += 1;
  }
  const pageRes = await WebsitePage.updateMany({ 'seo.ogImage.url': fromUrl }, { $set: { 'seo.ogImage.url': to.url, 'seo.ogImage.publicId': to.publicId } });
  changed += pageRes.modifiedCount || 0;
  const settings = await WebsiteSettings.findById(WebsiteSettings.SINGLETON_ID);
  if (settings) {
    let touched = false;
    for (const key of ['logo', 'logoDark', 'favicon', 'defaultOgImage']) {
      if (settings[key]?.url === fromUrl) {
        settings[key] = { url: to.url, publicId: to.publicId };
        touched = true;
        changed += 1;
      }
    }
    if (touched) await settings.save();
  }
  return changed;
}

module.exports = { buildUsageIndex, usageOf, summarize, replaceDraftReferences, collectStrings };
