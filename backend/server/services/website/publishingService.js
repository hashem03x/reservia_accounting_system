'use strict';

const mongoose = require('mongoose');
const ApiError = require('../../utils/apiError');
const WebsitePage = require('../../models/website/websitePageModel');
const WebsiteSection = require('../../models/website/websiteSectionModel');
const WebsiteRevision = require('../../models/website/websiteRevisionModel');
const { publishProblems } = require('../../utils/website/seoResolver');
const { loadSettings } = require('./publishedSite');
const { triggerPublishDeploy } = require('./deployService');
const { logWebsiteActivity } = require('../../utils/website/activityLog');
const { validateContent } = require('../../utils/website/sectionValidation');
const { SECTION_TYPE_FIELDS } = require('../../utils/website/sectionTypes');

// Website Management - the publishing workflow. Draft edits (page fields + sections) never touch
// what is live: the public feed reads ONLY `publishedRevision` snapshots. Publishing freezes the
// current draft into a new WebsiteRevision and moves the pointer in ONE transaction (both writes
// or neither). Scheduling freezes the draft at scheduling time too - so what goes live at the
// scheduled moment is exactly what the publisher reviewed, never edits made afterwards.

function pageSnapshot(page, sections) {
  return {
    seo: page.seo && typeof page.seo.toObject === 'function' ? page.seo.toObject() : page.seo || {},
    sections: sections.map(s => ({ type: s.type, sortOrder: s.sortOrder, isVisible: s.isVisible, content: s.content || {}, settings: s.settings || {}, adminLabel: s.adminLabel || '' })),
    locales: [...(page.locales || [])],
    titleEn: page.titleEn || '',
    titleAr: page.titleAr || '',
    layout: page.layout || 'default',
  };
}

async function draftSnapshotOrFail(page) {
  const sections = await WebsiteSection.find({ page: page._id }).sort({ sortOrder: 1 }).lean();
  const problems = publishProblems(typeof page.toObject === 'function' ? page.toObject() : page, sections, await loadSettings());
  // Every visible section must be complete (a section added but never filled in cannot go live).
  sections
    .filter(s => s.isVisible !== false)
    .forEach((s, i) => {
      try {
        validateContent(s.type, s.content || {}, { allowHtml: true });
      } catch (err) {
        problems.push(`section ${i + 1} (${SECTION_TYPE_FIELDS[s.type]?.labelEn || s.type}) - ${err.message}`);
      }
    });
  if (problems.length) throw new ApiError(`This page cannot be published yet. It needs: ${problems.join('; ')}.`, 400);
  return pageSnapshot(page, sections);
}

async function inTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let out;
    await session.withTransaction(async () => {
      out = await fn(session);
    });
    return out;
  } finally {
    await session.endSession();
  }
}

/** Publishes the page's current draft now. */
async function publishNow(pageId, { user, label = null } = {}) {
  const page = await WebsitePage.findById(pageId);
  if (!page || !page.isActive) throw new ApiError('No page found with that id', 404);
  if (page.status === 'archived') throw new ApiError('Restore this page from the archive before publishing it.', 400);
  const snapshot = await draftSnapshotOrFail(page);
  const before = { status: page.status, publishedRevision: page.publishedRevision };

  const revision = await inTransaction(async session => {
    const [rev] = await WebsiteRevision.create([{ page: page._id, label: label || null, snapshot, publishedBy: user._id }], { session });
    await WebsitePage.updateOne(
      { _id: page._id },
      { $set: { status: 'published', publishedAt: new Date(), publishedBy: user._id, publishedRevision: rev._id, scheduledPublishAt: null, scheduledRevision: null, scheduledBy: null } },
      { session }
    );
    return rev;
  });

  await logWebsiteActivity({ actor: user, action: 'page.publish', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug, before, after: { status: 'published', publishedRevision: revision._id } });
  const deploy = await triggerPublishDeploy();
  return { page: await WebsitePage.findById(page._id), revision, deploy };
}

/** Freezes the current draft and schedules it to go live at `publishAt` (must be in the future). */
async function schedule(pageId, publishAt, { user, label = null } = {}) {
  const when = new Date(publishAt);
  if (Number.isNaN(when.getTime())) throw new ApiError('Choose a valid publish date and time.', 400);
  if (when.getTime() <= Date.now() + 60 * 1000) throw new ApiError('The scheduled time must be at least a minute in the future.', 400);
  const page = await WebsitePage.findById(pageId);
  if (!page || !page.isActive) throw new ApiError('No page found with that id', 404);
  if (page.status === 'archived') throw new ApiError('Restore this page from the archive before scheduling it.', 400);
  const snapshot = await draftSnapshotOrFail(page);

  const revision = await inTransaction(async session => {
    // A previously scheduled (never-applied) revision is replaced - it was never live.
    if (page.scheduledRevision && String(page.scheduledRevision) !== String(page.publishedRevision)) await WebsiteRevision.deleteOne({ _id: page.scheduledRevision }, { session });
    const [rev] = await WebsiteRevision.create([{ page: page._id, label: label || `Scheduled for ${when.toISOString()}`, snapshot, publishedBy: user._id, publishedAt: when }], { session });
    await WebsitePage.updateOne({ _id: page._id }, { $set: { scheduledPublishAt: when, scheduledRevision: rev._id, scheduledBy: user._id } }, { session });
    return rev;
  });
  await logWebsiteActivity({ actor: user, action: 'page.schedule', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug, after: { scheduledPublishAt: when, revision: revision._id } });
  return { page: await WebsitePage.findById(page._id), revision };
}

async function cancelSchedule(pageId, { user } = {}) {
  const page = await WebsitePage.findById(pageId);
  if (!page || !page.isActive) throw new ApiError('No page found with that id', 404);
  if (!page.scheduledRevision) throw new ApiError('This page has no scheduled publish.', 400);
  await inTransaction(async session => {
    await WebsiteRevision.deleteOne({ _id: page.scheduledRevision }, { session });
    await WebsitePage.updateOne({ _id: page._id }, { $set: { scheduledPublishAt: null, scheduledRevision: null, scheduledBy: null } }, { session });
  });
  await logWebsiteActivity({ actor: user, action: 'page.schedule', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug, after: { cancelled: true } });
  return WebsitePage.findById(page._id);
}

/**
 * Applies every schedule that is due. Safe to run repeatedly and concurrently: each page is
 * claimed with a conditional update, so a schedule is applied exactly once. Returns the pages
 * published; triggers ONE rebuild when anything changed.
 */
async function runDueSchedules(now = new Date()) {
  const due = await WebsitePage.find({ isActive: true, scheduledRevision: { $ne: null }, scheduledPublishAt: { $lte: now } }).select('_id slug scheduledRevision scheduledBy status').lean();
  const published = [];
  for (const p of due) {
    // eslint-disable-next-line no-await-in-loop
    const res = await WebsitePage.updateOne(
      { _id: p._id, scheduledRevision: p.scheduledRevision },
      { $set: { status: 'published', publishedAt: now, publishedBy: p.scheduledBy, publishedRevision: p.scheduledRevision, scheduledPublishAt: null, scheduledRevision: null, scheduledBy: null } }
    );
    if (res.modifiedCount === 1) published.push(p.slug);
  }
  const deploy = published.length ? await triggerPublishDeploy() : null;
  return { published, deploy };
}

async function unpublish(pageId, { user } = {}) {
  const page = await WebsitePage.findById(pageId);
  if (!page || !page.isActive) throw new ApiError('No page found with that id', 404);
  if (page.status !== 'published') throw new ApiError('This page is not currently published.', 400);
  page.status = 'unpublished';
  await page.save();
  await logWebsiteActivity({ actor: user, action: 'page.unpublish', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug });
  const deploy = await triggerPublishDeploy();
  return { page, deploy };
}

/** Archive: off the public site (and its navigation/sitemap), kept with its history; restorable. */
async function archive(pageId, { user } = {}) {
  const page = await WebsitePage.findById(pageId);
  if (!page || !page.isActive) throw new ApiError('No page found with that id', 404);
  if (page.isHomePage) throw new ApiError('The home page cannot be archived.', 400);
  const wasLive = page.status === 'published';
  page.archivedFromStatus = page.status;
  page.status = 'archived';
  page.scheduledPublishAt = null;
  if (page.scheduledRevision) await WebsiteRevision.deleteOne({ _id: page.scheduledRevision });
  page.scheduledRevision = null;
  await page.save();
  await logWebsiteActivity({ actor: user, action: 'page.archive', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug });
  const deploy = wasLive ? await triggerPublishDeploy() : null;
  return { page, deploy };
}

async function restoreFromArchive(pageId, { user } = {}) {
  const page = await WebsitePage.findById(pageId);
  if (!page || !page.isActive) throw new ApiError('No page found with that id', 404);
  if (page.status !== 'archived') throw new ApiError('This page is not archived.', 400);
  // Back as an unpublished draft - going live again is a deliberate Publish.
  page.status = page.publishedRevision ? 'unpublished' : 'never_published';
  page.archivedFromStatus = null;
  await page.save();
  await logWebsiteActivity({ actor: user, action: 'page.restore', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug });
  return { page };
}

module.exports = { publishNow, schedule, cancelSchedule, runDueSchedules, unpublish, archive, restoreFromArchive, pageSnapshot };
