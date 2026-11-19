'use strict';

const mongoose = require('mongoose');
const ApiError = require('../../utils/apiError');
const WebsiteBlogPost = require('../../models/website/websiteBlogPostModel');
const WebsiteBlogPostRevision = require('../../models/website/websiteBlogPostRevisionModel');
const { triggerPublishDeploy } = require('./deployService');
const { logWebsiteActivity } = require('../../utils/website/activityLog');

// Website Management - the blog post publishing workflow. A direct sibling of
// services/website/publishingService.js (pages'), simplified because a blog post has no section
// tree to assemble: draft edits never touch what is live, the public feed reads ONLY
// `publishedRevision` snapshots, and publishing freezes the current draft into a new
// WebsiteBlogPostRevision and moves the pointer in ONE transaction.

function blogPostSnapshot(post) {
  return {
    seo: post.seo && typeof post.seo.toObject === 'function' ? post.seo.toObject() : post.seo || {},
    titleEn: post.titleEn || '',
    titleAr: post.titleAr || '',
    excerptEn: post.excerptEn || '',
    excerptAr: post.excerptAr || '',
    bodyEn: post.bodyEn || '',
    bodyAr: post.bodyAr || '',
    category: post.category || '',
    tags: [...(post.tags || [])],
    author: post.author && typeof post.author.toObject === 'function' ? post.author.toObject() : post.author || {},
    featuredImage: post.featuredImage && typeof post.featuredImage.toObject === 'function' ? post.featuredImage.toObject() : post.featuredImage || null,
    showRecentSidebar: post.showRecentSidebar !== false,
    locales: [...(post.locales || [])],
  };
}

/** A post needs, for at least one of its declared locales, a title and a non-empty body. */
function draftSnapshotOrFail(post) {
  const problems = [];
  if (!post.locales || !post.locales.length) problems.push('at least one language');
  const locales = post.locales && post.locales.length ? post.locales : ['ar', 'en'];
  const usable = locales.some(l => {
    const title = l === 'ar' ? post.titleAr : post.titleEn;
    const body = l === 'ar' ? post.bodyAr : post.bodyEn;
    return (title || '').trim() && (body || '').trim();
  });
  if (!usable) problems.push('a title and body in at least one of its languages');
  if (problems.length) throw new ApiError(`This blog post cannot be published yet. It needs: ${problems.join('; ')}.`, 400);
  return blogPostSnapshot(post);
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

async function publishBlogPostNow(postId, { user, label = null } = {}) {
  const post = await WebsiteBlogPost.findById(postId);
  if (!post || !post.isActive) throw new ApiError('No blog post found with that id', 404);
  if (post.status === 'archived') throw new ApiError('Restore this post from the archive before publishing it.', 400);
  const snapshot = draftSnapshotOrFail(post);
  const before = { status: post.status, publishedRevision: post.publishedRevision };

  const revision = await inTransaction(async session => {
    const [rev] = await WebsiteBlogPostRevision.create([{ post: post._id, label: label || null, snapshot, publishedBy: user._id }], { session });
    await WebsiteBlogPost.updateOne(
      { _id: post._id },
      { $set: { status: 'published', publishedAt: new Date(), publishedBy: user._id, publishedRevision: rev._id, scheduledPublishAt: null, scheduledRevision: null, scheduledBy: null } },
      { session }
    );
    return rev;
  });

  await logWebsiteActivity({ actor: user, action: 'blogPost.publish', targetType: 'WebsiteBlogPost', targetId: post._id, targetLabel: post.slug, before, after: { status: 'published', publishedRevision: revision._id } });
  const deploy = await triggerPublishDeploy();
  return { post: await WebsiteBlogPost.findById(post._id), revision, deploy };
}

async function scheduleBlogPost(postId, publishAt, { user, label = null } = {}) {
  const when = new Date(publishAt);
  if (Number.isNaN(when.getTime())) throw new ApiError('Choose a valid publish date and time.', 400);
  if (when.getTime() <= Date.now() + 60 * 1000) throw new ApiError('The scheduled time must be at least a minute in the future.', 400);
  const post = await WebsiteBlogPost.findById(postId);
  if (!post || !post.isActive) throw new ApiError('No blog post found with that id', 404);
  if (post.status === 'archived') throw new ApiError('Restore this post from the archive before scheduling it.', 400);
  const snapshot = draftSnapshotOrFail(post);

  const revision = await inTransaction(async session => {
    if (post.scheduledRevision && String(post.scheduledRevision) !== String(post.publishedRevision)) await WebsiteBlogPostRevision.deleteOne({ _id: post.scheduledRevision }, { session });
    const [rev] = await WebsiteBlogPostRevision.create([{ post: post._id, label: label || `Scheduled for ${when.toISOString()}`, snapshot, publishedBy: user._id, publishedAt: when }], { session });
    await WebsiteBlogPost.updateOne({ _id: post._id }, { $set: { scheduledPublishAt: when, scheduledRevision: rev._id, scheduledBy: user._id } }, { session });
    return rev;
  });
  await logWebsiteActivity({ actor: user, action: 'blogPost.schedule', targetType: 'WebsiteBlogPost', targetId: post._id, targetLabel: post.slug, after: { scheduledPublishAt: when, revision: revision._id } });
  return { post: await WebsiteBlogPost.findById(post._id), revision };
}

async function cancelBlogPostSchedule(postId, { user } = {}) {
  const post = await WebsiteBlogPost.findById(postId);
  if (!post || !post.isActive) throw new ApiError('No blog post found with that id', 404);
  if (!post.scheduledRevision) throw new ApiError('This blog post has no scheduled publish.', 400);
  await inTransaction(async session => {
    await WebsiteBlogPostRevision.deleteOne({ _id: post.scheduledRevision }, { session });
    await WebsiteBlogPost.updateOne({ _id: post._id }, { $set: { scheduledPublishAt: null, scheduledRevision: null, scheduledBy: null } }, { session });
  });
  await logWebsiteActivity({ actor: user, action: 'blogPost.schedule', targetType: 'WebsiteBlogPost', targetId: post._id, targetLabel: post.slug, after: { cancelled: true } });
  return WebsiteBlogPost.findById(post._id);
}

/**
 * Applies every blog schedule that is due. Safe to run repeatedly and concurrently: each post is
 * claimed with a conditional update, so a schedule is applied exactly once. Called from the
 * EXISTING pages cron tick (controller/website/pageController.js#runScheduledPublishes) rather than
 * a second cron route - there is no second external scheduler configured for this repo.
 */
async function runDueBlogSchedules(now = new Date()) {
  const due = await WebsiteBlogPost.find({ isActive: true, scheduledRevision: { $ne: null }, scheduledPublishAt: { $lte: now } }).select('_id slug scheduledRevision scheduledBy status').lean();
  const published = [];
  for (const p of due) {
    // eslint-disable-next-line no-await-in-loop
    const res = await WebsiteBlogPost.updateOne(
      { _id: p._id, scheduledRevision: p.scheduledRevision },
      { $set: { status: 'published', publishedAt: now, publishedBy: p.scheduledBy, publishedRevision: p.scheduledRevision, scheduledPublishAt: null, scheduledRevision: null, scheduledBy: null } }
    );
    if (res.modifiedCount === 1) published.push(p.slug);
  }
  const deploy = published.length ? await triggerPublishDeploy() : null;
  return { published, deploy };
}

async function unpublishBlogPost(postId, { user } = {}) {
  const post = await WebsiteBlogPost.findById(postId);
  if (!post || !post.isActive) throw new ApiError('No blog post found with that id', 404);
  if (post.status !== 'published') throw new ApiError('This blog post is not currently published.', 400);
  post.status = 'unpublished';
  await post.save();
  await logWebsiteActivity({ actor: user, action: 'blogPost.unpublish', targetType: 'WebsiteBlogPost', targetId: post._id, targetLabel: post.slug });
  const deploy = await triggerPublishDeploy();
  return { post, deploy };
}

async function archiveBlogPost(postId, { user } = {}) {
  const post = await WebsiteBlogPost.findById(postId);
  if (!post || !post.isActive) throw new ApiError('No blog post found with that id', 404);
  const wasLive = post.status === 'published';
  post.archivedFromStatus = post.status;
  post.status = 'archived';
  post.scheduledPublishAt = null;
  if (post.scheduledRevision) await WebsiteBlogPostRevision.deleteOne({ _id: post.scheduledRevision });
  post.scheduledRevision = null;
  await post.save();
  await logWebsiteActivity({ actor: user, action: 'blogPost.archive', targetType: 'WebsiteBlogPost', targetId: post._id, targetLabel: post.slug });
  const deploy = wasLive ? await triggerPublishDeploy() : null;
  return { post, deploy };
}

async function restoreBlogPostFromArchive(postId, { user } = {}) {
  const post = await WebsiteBlogPost.findById(postId);
  if (!post || !post.isActive) throw new ApiError('No blog post found with that id', 404);
  if (post.status !== 'archived') throw new ApiError('This blog post is not archived.', 400);
  post.status = post.publishedRevision ? 'unpublished' : 'never_published';
  post.archivedFromStatus = null;
  await post.save();
  await logWebsiteActivity({ actor: user, action: 'blogPost.restore', targetType: 'WebsiteBlogPost', targetId: post._id, targetLabel: post.slug });
  return { post };
}

module.exports = {
  blogPostSnapshot,
  publishBlogPostNow,
  scheduleBlogPost,
  cancelBlogPostSchedule,
  runDueBlogSchedules,
  unpublishBlogPost,
  archiveBlogPost,
  restoreBlogPostFromArchive,
};
