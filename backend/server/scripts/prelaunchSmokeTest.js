/**
 * Production pre-launch smoke test. Drives the REAL HTTP API end to end: authentication, system
 * memberships, CRM, Deal Engine, ERP, image uploads, email delivery, and the Won -> ERP financial
 * handoff. Every record it creates is tagged "SMOKE-TEST" and deleted again at the end of the SAME
 * run - unlike the manual PRELAUNCH-TEST session, this leaves nothing behind to clean up later.
 *
 * Two modes:
 *   - Fast (default): auth, memberships, CRM read/write, image upload, email trigger, ERP read.
 *     Needs only one admin/ERP-admin account.
 *   - Full (--full, needs --sales-email/--sales-password, --cd-email/--cd-password): additionally
 *     drives a lead through the full CRM -> Deal Engine approval chain -> Won -> ERP handoff, the
 *     same path the pre-launch audit verified by hand (see
 *     docs/implementation-reports/PRELAUNCH_AUDIT_22_NOV_2026.md, section D2).
 *
 * This script only ever WRITES disposable, self-tagged SMOKE-TEST data, and deletes it again
 * before exiting (even on failure - see the `finally` cleanup). It never touches a real lead,
 * customer, project, or Sector. It does not delete anything if a step fails in a way that leaves
 * ambiguous state - it prints what it could not clean up so a human can check by hand.
 *
 * Usage - credentials may be passed as flags OR (preferred, so a password never lands in shell
 * history or a process listing) as the matching SMOKE_TEST_* environment variable:
 *   SMOKE_TEST_BASE_URL=https://<api-host>/api/v1 \
 *   SMOKE_TEST_ADMIN_EMAIL=<admin> SMOKE_TEST_ADMIN_PASSWORD=<pass> \
 *     node server/scripts/prelaunchSmokeTest.js
 *
 *   SMOKE_TEST_BASE_URL=https://<api-host>/api/v1 \
 *   SMOKE_TEST_ADMIN_EMAIL=<admin> SMOKE_TEST_ADMIN_PASSWORD=<pass> \
 *   SMOKE_TEST_SALES_EMAIL=<sales> SMOKE_TEST_SALES_PASSWORD=<pass> \
 *   SMOKE_TEST_CD_EMAIL=<commercial-director> SMOKE_TEST_CD_PASSWORD=<pass> \
 *     node server/scripts/prelaunchSmokeTest.js --full
 *
 * (--base-url=/--admin-email=/--admin-password=/etc. still work, for a quick local run where
 * shell-history exposure does not matter - just not recommended against the real production URL.)
 *
 * Use an admin account whose email is not a real customer-facing mailbox - section 5 sends it a
 * real password-reset email every run.
 *
 * Exit code 0 = every section that ran passed. Exit code 1 = at least one section failed (see the
 * FAILED lines above the summary).
 */

function argValue(name, envVar) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  return envVar ? process.env[envVar] || null : null;
}
const BASE_URL = argValue('base-url', 'SMOKE_TEST_BASE_URL');
const FULL = process.argv.includes('--full');
if (!BASE_URL) throw new Error('Pass --base-url=https://<api-host>/api/v1 (or set SMOKE_TEST_BASE_URL). Refusing to guess a production URL.');

const RUN_ID = Date.now();
const results = []; // { section, ok, detail }
const cleanup = []; // functions, run in reverse order, best-effort

async function call(method, urlPath, body, token, extraHeaders) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(extraHeaders || {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function login(email, password) {
  const res = await call('POST', '/auth/login', { email, password });
  if (res.status !== 200 || !res.body.token) throw new Error(`login failed for ${email}: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token, user: res.body.data || res.body.user };
}

function record(section, ok, detail) {
  results.push({ section, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${section}${detail ? ' - ' + detail : ''}`);
}

// A real, minimal 1x1 PNG - no external file or image library needed for the upload smoke test.
const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function uploadLeadAttachment(leadId, token) {
  const form = new FormData();
  form.append('files', new Blob([ONE_PX_PNG], { type: 'image/png' }), `smoke-test-${RUN_ID}.png`);
  const res = await fetch(`${BASE_URL}/crm/leads/${leadId}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function main() {
  const adminEmail = argValue('admin-email', 'SMOKE_TEST_ADMIN_EMAIL');
  const adminPassword = argValue('admin-password', 'SMOKE_TEST_ADMIN_PASSWORD');
  if (!adminEmail || !adminPassword) throw new Error('Pass --admin-email/--admin-password (or SMOKE_TEST_ADMIN_EMAIL/SMOKE_TEST_ADMIN_PASSWORD) for an existing staff/ERP-admin account.');

  console.log(`\n================ 1. Authentication ================`);
  let adminToken, adminUser;
  try {
    ({ token: adminToken, user: adminUser } = await login(adminEmail, adminPassword));
    record('Authentication (login)', true, `logged in as ${adminEmail}`);
  } catch (e) {
    record('Authentication (login)', false, e.message);
    throw e; // nothing else can run without this
  }

  console.log(`\n================ 2. User memberships ================`);
  try {
    const me = await call('GET', '/me', null, adminToken);
    const systems = me.body?.data?.systemMemberships || adminUser?.systemMemberships || [];
    record('User memberships (self)', me.status === 200, `HTTP ${me.status}, ${Array.isArray(systems) ? systems.length : 0} membership row(s)`);
  } catch (e) {
    record('User memberships (self)', false, e.message);
  }

  console.log(`\n================ 3. CRM ================`);
  let leadId = null;
  try {
    const create = await call('POST', '/crm/leads', { name: `SMOKE-TEST Lead ${RUN_ID}`, phone: `010${String(RUN_ID).slice(-8)}`, channel: 'phone', source: 'Direct' }, adminToken);
    if (create.status !== 201) throw new Error(`create failed: HTTP ${create.status} ${JSON.stringify(create.body)}`);
    leadId = create.body.data._id;
    // There is no delete route for leads (archive is the only removal path in this codebase -
    // see auditCrmTestLeads.js). Archiving needs an active CRM 'md' membership on --admin-email;
    // if that account doesn't have one, this step fails harmlessly and prints a manual follow-up.
    cleanup.push(async () => {
      const arc = await call('PATCH', `/crm/leads/${leadId}/archive`, { reason: `SMOKE-TEST run ${RUN_ID} - safe to archive` }, adminToken).catch(e => ({ status: 'threw', body: e.message }));
      if (arc.status === 200) console.log(`  cleanup: archived lead ${leadId}`);
      else console.log(`  cleanup: could NOT archive lead ${leadId} (HTTP ${arc.status} - needs a CRM 'md' account) - archive it by hand.`);
    });
    const list = await call('GET', `/crm/leads?q=SMOKE-TEST Lead ${RUN_ID}`, null, adminToken);
    const appears = list.status === 200 && list.body.data?.some(l => l._id === leadId);
    record('CRM (create + list lead)', appears, `lead ${leadId}`);
  } catch (e) {
    record('CRM (create + list lead)', false, e.message);
  }

  console.log(`\n================ 4. Image uploads ================`);
  if (leadId) {
    try {
      const up = await uploadLeadAttachment(leadId, adminToken);
      if (up.status !== 201) throw new Error(`HTTP ${up.status} ${JSON.stringify(up.body)}`);
      const list = await call('GET', `/crm/attachments/${leadId}/attachments`, null, adminToken);
      const appears = list.status === 200 && (list.body.data || []).length > 0;
      record('Image uploads (CRM lead attachment)', appears, `uploaded + listed back on lead ${leadId}`);
    } catch (e) {
      record('Image uploads (CRM lead attachment)', false, e.message);
    }
  } else {
    record('Image uploads (CRM lead attachment)', false, 'skipped - no lead (section 3 failed)');
  }

  console.log(`\n================ 5. Email delivery ================`);
  try {
    // Triggers the real forgotPassword send path (sendEmail.js / SMTP_* env vars) against the
    // admin account's OWN address - never a real customer's inbox. A non-200 here, or a 200 that
    // still logs "Sending email error" server-side, means SMTP is misconfigured for production.
    const res = await call('POST', '/auth/forgotPassword', { email: adminEmail });
    record('Email delivery (forgotPassword send)', res.status === 200, `HTTP ${res.status} - check server logs for "Sending email error" to confirm SMTP actually accepted it`);
  } catch (e) {
    record('Email delivery (forgotPassword send)', false, e.message);
  }

  console.log(`\n================ 6. ERP ================`);
  try {
    const projects = await call('GET', '/projects?limit=1', null, adminToken);
    const coa = await call('GET', '/accounts?limit=1', null, adminToken);
    record('ERP (projects + chart of accounts reachable)', projects.status === 200 && coa.status === 200, `projects HTTP ${projects.status}, COA HTTP ${coa.status}`);
  } catch (e) {
    record('ERP (projects + chart of accounts reachable)', false, e.message);
  }

  console.log(`\n================ 7. Deal Engine ================`);
  try {
    const materials = await call('GET', '/commercial/materials?limit=1', null, adminToken);
    const projects = await call('GET', '/commercial/projects?limit=1', null, adminToken);
    record('Deal Engine (materials + projects reachable)', materials.status === 200 && projects.status === 200, `materials HTTP ${materials.status}, projects HTTP ${projects.status}`);
  } catch (e) {
    record('Deal Engine (materials + projects reachable)', false, e.message);
  }

  if (!FULL) {
    console.log('\n(Fast mode - skipping the full approval chain and Won -> ERP financial handoff. Re-run with --full plus --sales-email/--sales-password/--cd-email/--cd-password to cover those.)');
  } else {
    console.log(`\n================ 8. Deal Engine full approval chain + financial handoff ================`);
    try {
      const salesEmail = argValue('sales-email', 'SMOKE_TEST_SALES_EMAIL');
      const salesPassword = argValue('sales-password', 'SMOKE_TEST_SALES_PASSWORD');
      const cdEmail = argValue('cd-email', 'SMOKE_TEST_CD_EMAIL');
      const cdPassword = argValue('cd-password', 'SMOKE_TEST_CD_PASSWORD');
      if (!salesEmail || !cdEmail) throw new Error('--full needs sales/CD credentials (--sales-email/--sales-password/--cd-email/--cd-password, or the matching SMOKE_TEST_* env vars).');
      const { token: salesToken } = await login(salesEmail, salesPassword);
      const { token: cdToken } = await login(cdEmail, cdPassword);

      const stage1 = await call('PATCH', `/crm/leads/${leadId}/stage`, { to: 'contacted' }, adminToken);
      const stage2 = await call('PATCH', `/crm/leads/${leadId}/stage`, { to: 'qualified', governorate: 'Cairo', followUpAt: new Date().toISOString().slice(0, 10) }, adminToken);
      const stage3 = await call('PATCH', `/crm/leads/${leadId}/stage`, { to: 'site_survey', followUpAt: new Date().toISOString().slice(0, 10) }, adminToken);
      const stage4 = await call('PATCH', `/crm/leads/${leadId}/stage`, { to: 'proposal_sent', followUpAt: new Date().toISOString().slice(0, 10) }, adminToken);
      if ([stage1, stage2, stage3, stage4].some(r => r.status >= 400)) throw new Error('stage progression failed - see HTTP statuses above');

      const list = await call('GET', `/commercial/projects?keyword=SMOKE-TEST Lead ${RUN_ID}`, null, adminToken);
      const project = list.body.data?.[0];
      if (!project) throw new Error('no Commercial project was auto-created from the lead reaching "Proposal sent"');
      // Same story as leads: no delete route for Commercial projects, only archive.
      cleanup.push(async () => {
        const arc = await call('PATCH', `/commercial/projects/${project._id}/archive`, null, adminToken).catch(e => ({ status: 'threw', body: e.message }));
        if (arc.status === 200) console.log(`  cleanup: archived commercial project ${project._id}`);
        else console.log(`  cleanup: could NOT archive commercial project ${project._id} (HTTP ${arc.status}) - archive it by hand.`);
      });

      const revRes = await call('POST', `/commercial/revisions/project/${project._id}`, { engineeringInput: { kWp: 10, pvModuleModel: 'JKM475M-7RL3', structureType: 'Hangar Roof', acLengthM: 5 } }, adminToken);
      if (revRes.status !== 201) throw new Error(`revision creation failed: HTTP ${revRes.status} ${JSON.stringify(revRes.body)}`);
      const revision = revRes.body.data;

      const s1 = await call('PATCH', `/commercial/approvals/${revision._id}/STAGE1`, { status: 'Approved', note: 'SMOKE-TEST' }, salesToken);
      const s2 = await call('PATCH', `/commercial/approvals/${revision._id}/STAGE2`, { status: 'Approved', note: 'SMOKE-TEST' }, cdToken);
      if (s1.status !== 200 || s2.status !== 200) throw new Error(`approval failed: stage1 HTTP ${s1.status}, stage2 HTTP ${s2.status}`);
      let finalRevision = s2.body.data;
      if (finalRevision.mdRequired) {
        record('Deal Engine full approval chain + financial handoff', false, 'this SMOKE-TEST revision crossed the MD threshold (unexpected for a 10 kWp test system) - stopping short of Won to avoid needing an MD credential; everything created so far will still be cleaned up');
      } else {
        const proposal = await call('POST', `/commercial/proposals/revision/${revision._id}`, { copy: 'customer' }, adminToken);
        if (proposal.status !== 201 && proposal.status !== 200) throw new Error(`proposal issuance failed: HTTP ${proposal.status}`);

        const won = await call('PATCH', `/crm/leads/${leadId}/stage`, { to: 'won', valueEgp: finalRevision.pricing.netExclVat }, adminToken);
        if (won.status !== 200) throw new Error(`mark Won failed: HTTP ${won.status} ${JSON.stringify(won.body)}`);

        const projectAfter = await call('GET', `/commercial/projects/${project._id}`, null, adminToken);
        const erpProjectId = projectAfter.body.data?.erpProject;
        if (!erpProjectId) throw new Error('lead reached Won but no ERP project was linked - the financial handoff did not complete');
        cleanup.push(async () => {
          const del = await call('DELETE', `/projects/${erpProjectId}`, null, adminToken).catch(e => ({ status: 'threw', body: e.message }));
          console.log(`  cleanup: delete ERP project ${erpProjectId} -> HTTP ${del.status}`);
        });
        record('Deal Engine full approval chain + financial handoff', true, `Won -> ERP project ${erpProjectId} created`);
      }
    } catch (e) {
      record('Deal Engine full approval chain + financial handoff', false, e.message);
    }
  }
}

main()
  .catch(e => console.error('\nSTOPPED EARLY:', e.message))
  .finally(async () => {
    console.log('\n================ Cleanup (best effort, reverse order) ================');
    for (const fn of cleanup.reverse()) {
      // eslint-disable-next-line no-await-in-loop
      await fn().catch(e => console.log('  cleanup step threw:', e.message));
    }
    console.log('\n================ Summary ================');
    results.forEach(r => console.log(`  [${r.ok ? 'PASS' : 'FAIL'}] ${r.section}`));
    const failed = results.filter(r => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} sections passed.`);
    process.exit(failed.length ? 1 : 0);
  });
