/**
 * Change Request 2 - one-off, idempotent data migration for EXISTING CRM leads. Dry run by default.
 *
 *   Step 1 - follow-up dates (item 2): legacy `followUpAt` values are BSON Dates written as
 *     `new Date('2026-11-12')` (UTC midnight = 02:00 Cairo). Each is rewritten as the Cairo
 *     calendar day it falls on ('2026-11-12'). The Lead model already reads legacy values that
 *     way (models/crm/leadModel.js#castFollowUpDate), so this only makes the STORED value match
 *     and lets date queries compare like with like. Values already stored as strings are skipped.
 *
 *   Step 2 - first reply (item 3): for every lead, the earliest qualifying event already in its
 *     history - the first stage move out of New, or the first call / email / outbound WhatsApp
 *     activity. `firstReplyAt` is set only when it is missing or LATER than that event, so an
 *     existing first reply is never moved later and nothing is invented: a lead with no such
 *     event stays unreplied. Import/assignment/system entries never count.
 *
 * Never deletes anything; touches only `followUpAt`, `firstReplyAt`, `firstReplyVia`.
 *
 * Usage:
 *   npm run db:migrate-crm-cr2              # dry run: report what would change
 *   npm run db:migrate-crm-cr2 -- --apply   # write the changes
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');
const { cairoDateOf } = require('../utils/crm/businessDate');

const REPLY_ACTIVITY_TYPES = { call: 'call', email: 'email', whatsapp_out: 'whatsapp_out' };

async function migrateCrmChangeRequest2({ apply = process.argv.includes('--apply'), connect = true, log = console.log } = {}) {
  if (connect) {
    loadEnv();
    assertDbUriConfigured();
    await mongoose.connect(process.env.DB_URI);
    const dbName = assertSafeDatabaseName(mongoose.connection);
    log(`Connected (host: ${mongoose.connection.host}, db: ${dbName}).`);
    await assertNotLeopardDatabase(mongoose.connection);
  }
  const db = mongoose.connection.db;
  const leads = db.collection('crmleads');
  const history = db.collection('crmstagehistories');
  const activities = db.collection('crmactivities');

  // ---- Step 1: follow-up dates
  const legacy = await leads.find({ followUpAt: { $type: 'date' } }, { projection: { refCode: 1, followUpAt: 1 } }).toArray();
  log(`\nStep 1 - follow-up dates stored as timestamps: ${legacy.length}`);
  for (const lead of legacy) {
    const day = cairoDateOf(lead.followUpAt);
    log(`  ${lead.refCode}: ${lead.followUpAt.toISOString()} -> ${day}`);
    // eslint-disable-next-line no-await-in-loop
    if (apply) await leads.updateOne({ _id: lead._id, followUpAt: { $type: 'date' } }, { $set: { followUpAt: day } });
  }

  // ---- Step 2: first reply
  const firstMoves = await history
    .aggregate([{ $match: { from: 'new', to: { $ne: 'new' } } }, { $group: { _id: '$lead', at: { $min: '$createdAt' } } }])
    .toArray();
  const firstActs = await activities
    .aggregate([
      { $match: { type: { $in: Object.keys(REPLY_ACTIVITY_TYPES) } } },
      { $sort: { createdAt: 1 } },
      { $group: { _id: '$lead', at: { $first: '$createdAt' }, type: { $first: '$type' } } },
    ])
    .toArray();
  const earliest = new Map();
  for (const m of firstMoves) earliest.set(String(m._id), { at: m.at, via: 'stage_change' });
  for (const a of firstActs) {
    const key = String(a._id);
    const prev = earliest.get(key);
    if (!prev || a.at < prev.at) earliest.set(key, { at: a.at, via: REPLY_ACTIVITY_TYPES[a.type] });
  }

  const candidates = await leads
    .find({ _id: { $in: [...earliest.keys()].map(id => new mongoose.Types.ObjectId(id)) } }, { projection: { refCode: 1, firstReplyAt: 1 } })
    .toArray();
  let changed = 0;
  log(`\nStep 2 - leads with a qualifying first-reply event in their history: ${candidates.length}`);
  for (const lead of candidates) {
    const best = earliest.get(String(lead._id));
    if (lead.firstReplyAt && lead.firstReplyAt <= best.at) continue; // already correct (or earlier)
    changed += 1;
    log(`  ${lead.refCode}: firstReplyAt ${lead.firstReplyAt ? lead.firstReplyAt.toISOString() : '(none)'} -> ${best.at.toISOString()} via ${best.via}`);
    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      await leads.updateOne(
        { _id: lead._id, $or: [{ firstReplyAt: null }, { firstReplyAt: { $gt: best.at } }] },
        { $set: { firstReplyAt: best.at, firstReplyVia: best.via } }
      );
    }
  }
  log(`  ${changed} lead(s) ${apply ? 'updated' : 'would be updated'}.`);

  if (!apply) log('\nDry run - nothing was written. Re-run with --apply to write these changes.');
  return { followUpsConverted: legacy.length, firstRepliesSet: changed, applied: apply };
}

if (require.main === module) {
  migrateCrmChangeRequest2()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\ndb:migrate-crm-cr2 failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { migrateCrmChangeRequest2 };
