/**
 * Diagnose and repair a user's CRM / Commercial system access (Change Request 2, item 0).
 *
 * READ-ONLY UNLESS --apply. A dry run (the default) never writes anything: it prints the user's
 * memberships exactly as STORED (raw document - no schema defaults filled in), the platform audit
 * trail, and the exact change that --apply would make for each system.
 *
 * Role resolution, per requested system, in this order (first match wins):
 *   0. More than one membership entry for the system           -> AMBIGUOUS, stop.
 *   1. Membership exists, not switched off, role valid now     -> keep (never downgraded/changed).
 *      ("switched off" = isActive: false. A stored entry with no isActive is active - the same
 *      rule the app applies when it reads the user, via the schema default.)
 *   2. Membership exists with a valid role but isActive: false -> deliberately switched off by an
 *                                                                 admin: left alone unless --reactivate.
 *   3. Explicit --role-<SYSTEM>=<role> (validated)             -> use it.
 *   4. The most recent role in the audit trail that is VALID in today's registry -> restore it.
 *   5. The user is a platform administrator AND holds ERP "admin" -> the system's owner role
 *      (utils/systemsRegistry.js SYSTEM_OWNER_ROLES: CRM md, COMMERCIAL md - the same roles the
 *      admin screen's "never remove the last owner" guard protects).
 *   6. Otherwise                                               -> UNRESOLVED, stop.
 * Never copied: an undefined role, or the historical placeholder "MEMBER" (LEGACY_PLACEHOLDER_ROLE).
 * "MEMBER" was stored while CRM/Commercial were still placeholders; it carries no permission level,
 * so it is never mapped to md - or to Commercial's lower-case "member" - by itself. A user whose
 * only history is "MEMBER" gets a role only through rule 3 or rule 5.
 *
 * If ANY requested system is ambiguous or unresolved, NOTHING is written for any system.
 * HR is never handled by this script (not implemented; access must not be granted automatically).
 * Writes touch only the planned membership entries (positional/array-filter updates, never a
 * replacement of the whole array), are recorded in the platform audit log, and re-running after a
 * successful apply finds nothing to do (idempotent).
 *
 * Usage (from backend/):
 *   npm run db:restore-system-access -- --email=<user email>
 *   npm run db:restore-system-access -- --email=<user email> --apply --actor-email=<platform admin> --confirm-db=<database name printed by the dry run>
 * Options:
 *   --systems=CRM,COMMERCIAL   systems to examine (default; HR is refused)
 *   --role-CRM=<role>          explicit role (rule 3)
 *   --reactivate               also re-enable a valid membership that is switched off (rule 2)
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');
const { SYSTEMS, isValidSystemId, isValidRoleForSystem, SYSTEM_OWNER_ROLES, LEGACY_PLACEHOLDER_ROLE } = require('../utils/systemsRegistry');

const DEFAULT_SYSTEMS = ['CRM', 'COMMERCIAL'];
const REFUSED_SYSTEMS = { HR: 'HR is not implemented and its access must not be granted automatically.' };

function argValue(argv, name) {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const cairo = d => (d ? `${new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' })} Cairo` : '-');
const showRole = r => (r === undefined ? 'undefined' : r === null ? 'null' : `"${r}"`);
const showEntry = m => `${m.system}: role=${showRole(m.role)} isActive=${m.isActive === undefined ? 'MISSING' : m.isActive}`;
const isActiveEntry = m => m && m.isActive !== false;

/** Granted / removed / changed systems between two stored membership arrays (audit display). */
function diff(before, after) {
  const changes = [];
  const systems = new Set([...(before || []).map(m => m.system), ...(after || []).map(m => m.system)]);
  for (const s of systems) {
    const b = (before || []).find(m => m.system === s && isActiveEntry(m));
    const a = (after || []).find(m => m.system === s && isActiveEntry(m));
    if (b && !a) changes.push(`REMOVED ${s}:${b.role}`);
    else if (!b && a) changes.push(`granted ${s}:${a.role}`);
    else if (b && a && b.role !== a.role) changes.push(`role ${s}: ${b.role} -> ${a.role}`);
  }
  return changes;
}

/**
 * Pure planner - decides, without any I/O, what should happen to each requested system.
 * @param {object} args
 * @param {object} args.user - the RAW stored user ({ platformAdmin, systemMemberships })
 * @param {object[]} args.audit - PlatformAuditLog entries for the user, any order
 * @param {string[]} args.systems
 * @param {Record<string,string>} [args.explicitRoles]
 * @param {boolean} [args.reactivate]
 * @returns {{ items: object[], ok: boolean }} items: { system, action, role?, from?, basis, problem? }
 *   action: 'keep' | 'skip_inactive' | 'set' | 'add' | 'ambiguous' | 'unresolved' | 'refused'
 */
function planRestoration({ user, audit = [], systems, explicitRoles = {}, reactivate = false }) {
  const memberships = Array.isArray(user.systemMemberships) ? user.systemMemberships : [];
  const erpAdmin = memberships.some(m => m.system === 'ERP' && m.role === 'admin' && isActiveEntry(m));
  const ordered = [...audit].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const items = [];

  for (const system of systems) {
    if (REFUSED_SYSTEMS[system]) {
      items.push({ system, action: 'refused', problem: REFUSED_SYSTEMS[system] });
      continue;
    }
    if (!isValidSystemId(system)) {
      items.push({ system, action: 'refused', problem: `Unknown system "${system}".` });
      continue;
    }
    const entries = memberships.filter(m => m.system === system);
    const current = entries[0] || null;
    if (entries.length > 1) {
      items.push({ system, action: 'ambiguous', problem: `${entries.length} membership entries exist for ${system} - fix the duplicates by hand first.` });
      continue;
    }
    const currentValid = !!current && isValidRoleForSystem(system, current.role);
    if (current && currentValid && isActiveEntry(current)) {
      items.push({ system, action: 'keep', role: current.role, basis: 'valid, active membership - not changed' });
      continue;
    }
    if (current && currentValid && !isActiveEntry(current)) {
      if (!reactivate) {
        items.push({ system, action: 'skip_inactive', role: current.role, basis: 'valid role but switched off - pass --reactivate to re-enable it' });
        continue;
      }
      items.push({ system, action: 'set', role: current.role, from: current, basis: 'reactivated (--reactivate)' });
      continue;
    }

    // Missing, or malformed (undefined / obsolete role) - resolve a role.
    let role = null;
    let basis = null;
    const explicit = explicitRoles[system];
    if (explicit !== undefined) {
      if (!isValidRoleForSystem(system, explicit)) {
        items.push({ system, action: 'unresolved', problem: `--role-${system}="${explicit}" is not valid. Valid: ${SYSTEMS[system].roles.join(', ')}.` });
        continue;
      }
      role = explicit;
      basis = 'explicit --role flag';
    }
    if (!role) {
      for (const e of ordered) {
        if (e.action !== 'user.systems.update') continue;
        for (const list of [e.after, e.before]) {
          const hit = (Array.isArray(list) ? list : []).find(m => m.system === system && isValidRoleForSystem(system, m.role));
          if (hit) {
            role = hit.role;
            basis = `last valid role in the audit trail (${cairo(e.createdAt)})`;
            break;
          }
        }
        if (role) break;
      }
    }
    if (!role && user.platformAdmin === true && erpAdmin && SYSTEM_OWNER_ROLES[system]) {
      role = SYSTEM_OWNER_ROLES[system];
      basis = `platform administrator with ERP admin -> ${system} owner role (SYSTEM_OWNER_ROLES)`;
    }
    if (!role) {
      const seen = [...new Set(ordered.flatMap(e => [...(e.before || []), ...(e.after || [])]).filter(m => m.system === system).map(m => m.role))];
      items.push({
        system,
        action: 'unresolved',
        problem: `No valid ${system} role can be determined${seen.length ? ` (history only has ${seen.map(showRole).join(', ')}${seen.includes(LEGACY_PLACEHOLDER_ROLE) ? ' - the legacy placeholder, which has no permission level' : ''})` : ''}. Pass --role-${system}=<${SYSTEMS[system].roles.join('|')}> if the business confirms one.`,
      });
      continue;
    }
    items.push({ system, action: current ? 'set' : 'add', role, from: current, basis });
  }

  const ok = items.every(i => ['keep', 'skip_inactive', 'set', 'add'].includes(i.action));
  return { items, ok };
}

async function restoreSystemAccess({ connect = true, argv = process.argv, log = console.log } = {}) {
  const email = (argValue(argv, 'email') || '').trim().toLowerCase();
  const apply = argv.includes('--apply');
  const reactivate = argv.includes('--reactivate');
  const actorEmail = (argValue(argv, 'actor-email') || '').trim().toLowerCase();
  const confirmDb = argValue(argv, 'confirm-db');
  const systems = (argValue(argv, 'systems') || DEFAULT_SYSTEMS.join(',')).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const explicitRoles = {};
  for (const s of systems) {
    const r = argValue(argv, `role-${s}`);
    if (r !== null) explicitRoles[s] = r.trim();
  }
  if (!email) throw new SafetyError('Pass --email=<the user whose access to diagnose>.');
  if (apply && !actorEmail) throw new SafetyError('--apply needs --actor-email=<a platform administrator> so the change is attributed in the audit log.');

  if (connect) {
    loadEnv();
    assertDbUriConfigured();
    await mongoose.connect(process.env.DB_URI);
  }
  const dbName = assertSafeDatabaseName(mongoose.connection);
  log(`Connected (host: ${mongoose.connection.host}, db: ${dbName}).`);
  if (dbName === 'test') log('NOTE: database "test" is the MongoDB driver default - DB_URI names no database. Make sure this is the database the live backend uses.');
  if (connect) await assertNotLeopardDatabase(mongoose.connection);
  if (apply && confirmDb !== dbName) {
    throw new SafetyError(`--apply refused: add --confirm-db=${dbName} to confirm you mean to write to database "${dbName}" on ${mongoose.connection.host}.`);
  }

  // eslint-disable-next-line global-require
  const User = require('../models/userModel');
  // eslint-disable-next-line global-require
  const PlatformAuditLog = require('../models/platformAuditLogModel');

  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // RAW read - Mongoose would fill schema defaults (e.g. a missing isActive becomes true) and hide
  // a malformed entry. What is printed and planned here is exactly what is stored.
  const user = await User.collection.findOne({ email: new RegExp(`^${escaped}$`, 'i') }, { projection: { name: 1, email: 1, role: 1, isActive: 1, platformAdmin: 1, systemMemberships: 1 } });
  if (!user) throw new SafetyError(`No user with email ${email}.`);

  log(`\nUser: ${user.name} <${user.email}>  active=${user.isActive}  platformAdmin=${user.platformAdmin === true}  ERP role=${user.role}`);
  log('Stored memberships:');
  for (const m of user.systemMemberships || []) {
    const valid = isValidRoleForSystem(m.system, m.role);
    log(`  ${showEntry(m)}${valid ? '' : `   <-- INVALID role for ${m.system} (valid: ${SYSTEMS[m.system]?.roles.join(', ') || '?'})`}`);
  }

  const audit = await PlatformAuditLog.find({ targetUser: user._id }).sort({ createdAt: 1 }).lean();
  log(`\nPlatform audit trail (${audit.length} entries):`);
  for (const e of audit) {
    const extra = e.action === 'user.systems.update' ? `  [${diff(e.before, e.after).join('; ') || 'no effective change'}]` : '';
    log(`  ${cairo(e.createdAt)}  ${e.action}  by ${e.actorName}${extra}`);
  }

  const plan = planRestoration({ user, audit, systems, explicitRoles, reactivate });
  log(`\nPlan${apply ? '' : ' (dry run - nothing will be written)'}:`);
  for (const i of plan.items) {
    if (i.action === 'keep') log(`  ${i.system}: keep "${i.role}" - ${i.basis}`);
    else if (i.action === 'skip_inactive') log(`  ${i.system}: no change - ${i.basis}`);
    else if (i.action === 'set') log(`  ${i.system}: REPAIR ${showEntry(i.from)}  ->  role="${i.role}" isActive=true   (${i.basis})`);
    else if (i.action === 'add') log(`  ${i.system}: ADD role="${i.role}" isActive=true   (${i.basis})`);
    else log(`  ${i.system}: ${i.action.toUpperCase()} - ${i.problem}`);
  }
  const others = (user.systemMemberships || []).filter(m => !systems.includes(m.system));
  if (others.length) log(`  Untouched: ${others.map(m => `${m.system}:${m.role}`).join(', ')}`);

  if (!plan.ok) {
    log('\nNot every system could be resolved unambiguously - NOTHING was written. Resolve the items above (e.g. --role-<SYSTEM>=<role>) and run again.');
    return { user, plan, applied: false, changed: [] };
  }
  const changes = plan.items.filter(i => i.action === 'set' || i.action === 'add');
  if (!changes.length) {
    log('\nNothing to do - every requested system already has a valid, active membership.');
    return { user, plan, applied: false, changed: [] };
  }
  if (!apply) {
    log(`\nDry run complete - nothing was written. To apply exactly the changes above:\n  --apply --actor-email=<platform admin> --confirm-db=${dbName}`);
    return { user, plan, applied: false, changed: [] };
  }

  const actor = await User.findOne({ email: new RegExp(`^${actorEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), platformAdmin: true }).select('_id name email');
  if (!actor) throw new SafetyError(`--actor-email ${actorEmail} is not a platform administrator.`);

  for (const c of changes) {
    // Targeted: only this system's entry is touched; every other membership stays byte-for-byte.
    // The filter re-checks the stored state the plan was made from, so a concurrent edit makes the
    // update a no-op instead of being overwritten.
    const res =
      c.action === 'add'
        ? // eslint-disable-next-line no-await-in-loop
          await User.collection.updateOne(
            { _id: user._id, 'systemMemberships.system': { $ne: c.system } },
            { $push: { systemMemberships: { _id: new mongoose.Types.ObjectId(), system: c.system, role: c.role, isActive: true } } }
          )
        : // eslint-disable-next-line no-await-in-loop
          await User.collection.updateOne(
            { _id: user._id, systemMemberships: { $elemMatch: { system: c.system, role: c.from.role === undefined ? { $exists: false } : c.from.role } } },
            { $set: { 'systemMemberships.$[m].role': c.role, 'systemMemberships.$[m].isActive': true } },
            { arrayFilters: [{ 'm.system': c.system }] }
          );
    if (res.modifiedCount !== 1) throw new SafetyError(`${c.system}: the stored membership changed since it was read - nothing written for it. Re-run the dry run.`);
  }

  const after = await User.collection.findOne({ _id: user._id }, { projection: { systemMemberships: 1 } });
  const strip = list => (list || []).map(({ system, role, isActive }) => ({ system, role, isActive }));
  await PlatformAuditLog.create({
    actor: actor._id,
    actorName: `${actor.name} (restoreSystemAccess script)`,
    actorEmail: actor.email,
    action: 'user.systems.update',
    targetUser: user._id,
    targetUserName: user.name,
    targetUserEmail: user.email,
    before: strip(user.systemMemberships),
    after: strip(after.systemMemberships),
  });
  log(`\nApplied. Memberships now: ${strip(after.systemMemberships).map(m => `${m.system}:${m.role}`).join(', ')}`);
  return { user, plan, applied: true, changed: changes.map(c => c.system) };
}

if (require.main === module) {
  restoreSystemAccess()
    .then(async result => {
      await mongoose.disconnect();
      process.exit(result.plan.ok ? 0 : 2);
    })
    .catch(async err => {
      console.error('\ndb:restore-system-access failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { restoreSystemAccess, planRestoration, diff };
