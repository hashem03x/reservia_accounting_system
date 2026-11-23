/**
 * Go-live Developer Pack section 5.2: creates/updates the seven real staff logins and their
 * role assignments across ERP/HR/CRM/Deal Engine/Website. Does NOT deactivate, touch, or delete
 * any existing account (PRELAUNCH/test/Super Admin accounts included) - that is explicitly a
 * separate, later step the PDF's own order of work puts last ("Create real users and switch off
 * test accounts last").
 *
 * Two deliberate deviations from the PDF table's literal cells, both documented in
 * utils/commercial/dealEnginePermissions.js and utils/crm/stageRules.js's own comments:
 *   - The MD's CRM role is 'md', not the table's literal "admin" - the CRM Won-threshold MD-
 *     bypass check (stageRules.js) only ever recognizes the literal 'md' role, and section 4's
 *     own mandatory principle is that MD authority must be the explicit `md` role, never a
 *     generic admin-equivalent.
 *   - The MD's HR role is 'md' (HR has no "admin" role at all - its vocabulary is
 *     md/hr/manager/finance/employee/line_manager).
 *   - Ahmed Moubarek's HR role is 'line_manager' alone, not two separate entries for
 *     "employee + line_manager": middleware/hrAccess.js#hrMembership looks up the FIRST HR
 *     membership only (unlike Commercial, HR has no multi-role resolution), so a single role
 *     must carry both capabilities. services/hr/hrCore.js is written so line_manager (like the
 *     legacy manager role) gets full self-service PLUS approves their own direct reports.
 *
 * Menna (Marketing Coordinator) is deliberately NOT created - the PDF itself says her login is
 * "to be issued" with no real email yet, and the task's own instruction is "do not invent missing
 * email addresses or credentials." Her row is reported as BLOCKED every run until a real email is
 * supplied via --menna-email.
 *
 * Usage:
 *   node server/scripts/provisionGoLiveStaffAccounts.js --dry-run              # report only
 *   node server/scripts/provisionGoLiveStaffAccounts.js --yes                  # create the 6 ready accounts
 *   node server/scripts/provisionGoLiveStaffAccounts.js --yes --menna-email m@reservia-energy.com
 *   node server/scripts/provisionGoLiveStaffAccounts.js --yes --update-existing   # also fix role/
 *                                                                                  # memberships on
 *                                                                                  # accounts that
 *                                                                                  # already exist
 *                                                                                  # by email (never
 *                                                                                  # touches their
 *                                                                                  # password unless
 *                                                                                  # --reset-password
 *                                                                                  # is ALSO given)
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');
const { generateStrongPassword } = require('../utils/generatePassword');

const DOMAIN = 'reservia-energy.com';

// ERP access is the top-level User.role field (mirrored into a systemMemberships ERP entry of the
// same role value) - never a second vocabulary. null erp = no ERP access at all (no role
// elevation, no ERP membership) - a real, tested state (test/portal/userCreationLogin.test.js).
const STAFF = [
  {
    key: 'md', name: 'Ahmed A. Fattah', email: `Ahmed.Fattah@${DOMAIN}`, position: 'Managing Director',
    erp: 'admin', hr: 'md', crm: 'md', commercial: 'md', website: 'admin', platformAdmin: true,
  },
  {
    key: 'scDirector', name: 'Mohamed Basha', email: `M.Basha@${DOMAIN}`, position: 'Sales and Commercial Director',
    erp: 'viewer', hr: 'employee', crm: 'commercial_director', commercial: 'commercial_director', website: 'viewer',
  },
  {
    key: 'bdm', name: 'Ahmed Moubarek', email: `A.Moubarek@${DOMAIN}`, position: 'Business Development Manager',
    erp: 'po_drafter', hr: 'line_manager', crm: 'bdm', commercial: 'bdm', website: 'viewer',
  },
  {
    key: 'salesEng1', name: 'Mohamed Abdou', email: `Sales.MA@${DOMAIN}`, position: 'Sales Engineer',
    erp: 'po_drafter', hr: 'employee', crm: 'sales_viewer', commercial: 'sales', website: 'viewer',
  },
  {
    key: 'salesEng2', name: 'Yasser Helal', email: `Sales.YH@${DOMAIN}`, position: 'Sales Engineer',
    erp: 'po_drafter', hr: 'employee', crm: 'sales_viewer', commercial: 'sales', website: 'viewer',
  },
  {
    key: 'technical', name: 'Abdullah Mostafa', email: `Technical.AM@${DOMAIN}`, position: 'Technical Engineer',
    erp: null, hr: 'employee', crm: 'sales_viewer', commercial: 'technical', website: 'viewer',
  },
];

function buildMembershipsFor(staffer) {
  const memberships = [
    { system: 'HR', role: staffer.hr, isActive: true },
    { system: 'CRM', role: staffer.crm, isActive: true },
    { system: 'COMMERCIAL', role: staffer.commercial, isActive: true },
    { system: 'WEBSITE', role: staffer.website, isActive: true },
  ];
  if (staffer.erp) memberships.push({ system: 'ERP', role: staffer.erp, isActive: true });
  return memberships;
}

async function provision() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--yes');
  const updateExisting = args.includes('--update-existing');
  const resetPassword = args.includes('--reset-password');
  const mennaIdx = args.indexOf('--menna-email');
  const mennaEmail = mennaIdx !== -1 ? args[mennaIdx + 1] : null;

  loadEnv();
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const { connection } = await mongoose.connect(process.env.DB_URI);
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);
  await assertNotLeopardDatabase(connection);

  const User = require('../models/userModel');

  const roster = [...STAFF];
  if (mennaEmail) {
    roster.push({
      key: 'marketing', name: 'Menna', email: mennaEmail, position: 'Marketing Coordinator',
      erp: 'po_drafter', hr: 'employee', crm: 'marketing', commercial: 'marketing', website: 'viewer',
    });
  }

  const results = [];
  const credentials = [];

  for (const staffer of roster) {
    const email = staffer.email.toLowerCase();
    // eslint-disable-next-line no-await-in-loop
    const existing = await User.findOne({ email });
    const desiredMemberships = buildMembershipsFor(staffer);

    if (existing && !updateExisting) {
      results.push({ name: staffer.name, email, action: 'SKIPPED (already exists)', note: `role="${existing.role}", ${existing.systemMemberships.length} membership(s) - pass --update-existing to reconcile` });
      continue; // eslint-disable-line no-continue
    }

    if (dryRun) {
      results.push({ name: staffer.name, email, action: existing ? 'WOULD UPDATE' : 'WOULD CREATE', note: `role="${staffer.erp || 'user'}", memberships: ${desiredMemberships.map(m => `${m.system}:${m.role}`).join(', ')}` });
      continue; // eslint-disable-line no-continue
    }

    if (existing) {
      existing.name = staffer.name;
      existing.role = staffer.erp || 'user';
      existing.systemMemberships = desiredMemberships;
      existing.isActive = true;
      // eslint-disable-next-line no-await-in-loop
      await existing.savePermissions();
      if (resetPassword) {
        const plaintext = generateStrongPassword();
        existing.password = plaintext;
        existing.mustChangePassword = true;
        credentials.push({ name: staffer.name, email, password: plaintext });
      }
      // eslint-disable-next-line no-await-in-loop
      await existing.save();
      results.push({ name: staffer.name, email, action: 'UPDATED', note: resetPassword ? 'password reset - see credentials below' : 'password unchanged' });
    } else {
      const plaintext = generateStrongPassword();
      // eslint-disable-next-line no-await-in-loop
      const user = await User.create({
        name: staffer.name,
        email,
        type: 'online',
        role: staffer.erp || 'user',
        password: plaintext,
        mustChangePassword: true,
        platformAdmin: !!staffer.platformAdmin,
        systemMemberships: desiredMemberships,
      });
      // eslint-disable-next-line no-await-in-loop
      await user.savePermissions();
      // eslint-disable-next-line no-await-in-loop
      await user.save();
      credentials.push({ name: staffer.name, email, password: plaintext });
      results.push({ name: staffer.name, email, action: 'CREATED', note: 'see credentials below' });
    }
  }

  // Menna, unresolved.
  if (!mennaEmail) {
    results.push({ name: 'Menna', email: '(none - "to be issued")', action: 'BLOCKED', note: 'No real email address exists yet - re-run with --menna-email once one is issued. Never invented.' });
  }

  console.log(`\n${dryRun ? 'DRY RUN - ' : ''}Staff provisioning report:`);
  console.table(results);

  if (credentials.length) {
    console.log('\n=====================================================================');
    console.log('  NEW/RESET LOGIN CREDENTIALS - copy these now, they will not be shown again');
    console.log('  Every account has mustChangePassword=true - enforce a change on first login.');
    console.log('=====================================================================');
    for (const c of credentials) console.log(`  ${c.name.padEnd(20)} ${c.email.padEnd(32)} ${c.password}`);
    console.log('=====================================================================\n');
  }

  if (dryRun) console.log('Dry run: no changes made. Re-run with --yes to apply.');
  return { dryRun, results };
}

if (require.main === module) {
  provision()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\nprovisionGoLiveStaffAccounts failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      try {
        await mongoose.disconnect();
      } catch {
        // already disconnected / never connected
      }
      process.exit(1);
    });
}

module.exports = { provision, STAFF };
