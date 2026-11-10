/**
 * Change Request 2, item 0 - diagnose and restore a user's lost system access (the MD lost CRM and
 * Commercial between 8 and 9 November 2026).
 *
 * READ-ONLY BY DEFAULT. Without --apply it only prints:
 *   1. the user's current systemMemberships,
 *   2. every platform-admin audit entry for that user (who changed what, when, before -> after),
 *   3. for each requested system, the exact audit entry that removed or deactivated it,
 *   4. what --apply would restore.
 *
 * With --apply it restores ONLY the requested systems, ONLY to the role the audit log shows the
 * user previously held (or an explicit --role-<SYSTEM>=<role>, validated against the registry),
 * never touches any other system or any other user, and records the change in the platform audit
 * log like any admin edit. HR is never restored unless explicitly requested AND the audit log
 * shows it was held - and even then the portal keeps showing it as unavailable while the HR
 * system itself is `implemented: false` (utils/systemsRegistry.js).
 *
 * Usage:
 *   npm run db:restore-system-access -- --email=<user email>
 *   npm run db:restore-system-access -- --email=<user email> --apply --actor-email=<platform admin email>
 * Options:
 *   --systems=CRM,COMMERCIAL     systems to examine/restore (default CRM,COMMERCIAL)
 *   --role-CRM=md                explicit role when the audit log has no record of the old one
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');
const { SYSTEMS, isValidSystemId, isValidRoleForSystem } = require('../utils/systemsRegistry');

function arg(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const cairo = d => (d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'medium' }) + ' Cairo' : '-');
const describe = list => (Array.isArray(list) && list.length ? list.map(m => `${m.system}:${m.role}${m.isActive === false ? '(inactive)' : ''}`).join(', ') : '(none)');
const activeEntry = (list, system) => (Array.isArray(list) ? list.find(m => m.system === system && m.isActive !== false) : null);

/** Granted/removed/changed systems between two membership arrays. */
function diff(before, after) {
  const changes = [];
  const systems = new Set([...(before || []).map(m => m.system), ...(after || []).map(m => m.system)]);
  for (const s of systems) {
    const b = activeEntry(before, s);
    const a = activeEntry(after, s);
    if (b && !a) changes.push(`REMOVED ${s}:${b.role}`);
    else if (!b && a) changes.push(`granted ${s}:${a.role}`);
    else if (b && a && b.role !== a.role) changes.push(`role ${s}: ${b.role} -> ${a.role}`);
  }
  return changes;
}

async function restoreSystemAccess({ connect = true, argv } = {}) {
  if (argv) process.argv = argv;
  const email = (arg('email') || '').trim().toLowerCase();
  const apply = process.argv.includes('--apply');
  const actorEmail = (arg('actor-email') || '').trim().toLowerCase();
  const systems = (arg('systems') || 'CRM,COMMERCIAL').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!email) throw new SafetyError('Pass --email=<the user whose access to diagnose>.');
  for (const s of systems) if (!isValidSystemId(s)) throw new SafetyError(`Unknown system "${s}".`);
  if (apply && !actorEmail) throw new SafetyError('--apply needs --actor-email=<a platform administrator> so the change is attributed in the audit log.');

  if (connect) {
    loadEnv();
    assertDbUriConfigured();
    await mongoose.connect(process.env.DB_URI);
    const dbName = assertSafeDatabaseName(mongoose.connection);
    console.log(`Connected (host: ${mongoose.connection.host}, db: ${dbName}).`);
    await assertNotLeopardDatabase(mongoose.connection);
  }
  // eslint-disable-next-line global-require
  const User = require('../models/userModel');
  // eslint-disable-next-line global-require
  const PlatformAuditLog = require('../models/platformAuditLogModel');

  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const user = await User.findOne({ email: new RegExp(`^${escaped}$`, 'i') }).select('_id name email role isActive platformAdmin systemMemberships');
  if (!user) throw new SafetyError(`No user with email ${email}.`);

  console.log(`\nUser: ${user.name} <${user.email}>  active=${user.isActive}  platformAdmin=${user.platformAdmin}  ERP role=${user.role}`);
  console.log(`Current memberships: ${describe(user.systemMemberships)}`);

  const audit = await PlatformAuditLog.find({ targetUser: user._id }).sort({ createdAt: 1 }).lean();
  console.log(`\nPlatform audit trail for this user (${audit.length} entries):`);
  for (const e of audit) {
    const extra = e.action === 'user.systems.update' ? `  [${diff(e.before, e.after).join('; ') || 'no effective change'}]` : '';
    console.log(`  ${cairo(e.createdAt)}  ${e.action}  by ${e.actorName}${e.actorEmail ? ` <${e.actorEmail}>` : ''}${extra}`);
  }

  const plan = [];
  console.log('\nPer-system findings:');
  for (const system of systems) {
    const current = activeEntry(user.systemMemberships, system);
    const removal = [...audit].reverse().find(e => e.action === 'user.systems.update' && activeEntry(e.before, system) && !activeEntry(e.after, system));
    const previousRole = removal ? activeEntry(removal.before, system).role : null;
    if (current) {
      console.log(`  ${system}: currently ACTIVE as "${current.role}" - nothing to restore.`);
      continue;
    }
    if (removal) {
      const sameSave = diff(removal.before, removal.after).filter(c => !c.includes(`${system}:`));
      console.log(`  ${system}: removed ${cairo(removal.createdAt)} by ${removal.actorName} (was "${previousRole}").`);
      if (sameSave.length) console.log(`           Same save also: ${sameSave.join('; ')}`);
    } else {
      console.log(`  ${system}: no active membership, and NO audit entry ever removed one - either it was never granted through the portal, or it was changed outside the audited admin screen (direct DB edit/script).`);
    }
    const explicitRole = arg(`role-${system}`);
    const role = explicitRole || previousRole;
    if (!role) {
      console.log(`           Not restorable automatically - no evidence of a previous role. Pass --role-${system}=<role> if the business confirms one. Valid: ${SYSTEMS[system].roles.join(', ')}.`);
      continue;
    }
    if (!isValidRoleForSystem(system, role)) throw new SafetyError(`"${role}" is not a valid ${system} role. Valid: ${SYSTEMS[system].roles.join(', ')}.`);
    if (!SYSTEMS[system].implemented) console.log(`           Note: ${system} is not implemented yet (registry) - the portal will show it as unavailable even with a membership.`);
    plan.push({ system, role, basis: explicitRole ? 'explicit --role flag' : `audit entry ${cairo(removal.createdAt)}` });
  }

  if (!plan.length) {
    console.log('\nNothing to restore.');
    return { user, plan, applied: false };
  }
  console.log('\nWould restore:');
  for (const p of plan) console.log(`  ${p.system}: "${p.role}"  (basis: ${p.basis})`);

  if (!apply) {
    console.log('\nRead-only run - nothing changed. Re-run with --apply --actor-email=<platform admin> to restore.');
    return { user, plan, applied: false };
  }

  const actor = await User.findOne({ email: new RegExp(`^${actorEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), platformAdmin: true }).select('_id name email');
  if (!actor) throw new SafetyError(`--actor-email ${actorEmail} is not a platform administrator.`);

  const before = user.systemMemberships.map(m => ({ system: m.system, role: m.role, isActive: m.isActive }));
  for (const { system, role } of plan) {
    const existing = user.systemMemberships.find(m => m.system === system);
    if (existing) {
      existing.role = role;
      existing.isActive = true;
    } else {
      user.systemMemberships.push({ system, role, isActive: true });
    }
  }
  await user.save();
  const after = user.systemMemberships.map(m => ({ system: m.system, role: m.role, isActive: m.isActive }));
  await PlatformAuditLog.create({
    actor: actor._id,
    actorName: `${actor.name} (restoreSystemAccess script)`,
    actorEmail: actor.email,
    action: 'user.systems.update',
    targetUser: user._id,
    targetUserName: user.name,
    targetUserEmail: user.email,
    before,
    after,
  });
  console.log(`\nRestored. Memberships now: ${describe(after)}`);
  return { user, plan, applied: true };
}

if (require.main === module) {
  restoreSystemAccess()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\ndb:restore-system-access failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { restoreSystemAccess, diff };
