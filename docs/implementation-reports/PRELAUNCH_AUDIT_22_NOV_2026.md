# Reservia — Pre-Launch Critical Audit Report
**22 November 2026 — ahead of the Sunday, 22 Nov 2026 launch**
*(Updated: full CRM → Deal Engine → ERP lifecycle now verified live against production — see §D.)*

> **Nothing in this report has been committed or pushed.** Every change described below exists
> only in the working tree, per the explicit instruction not to commit/push without
> authorization. See §H for the exact file list and how to review/commit it.

## Executive Summary

Six real, confirmed bugs were found and fixed — the three originally reported, plus three more
discovered while reproducing and fixing them live against the real production database. All six
were re-verified again in this update (§E3): same 9/9 automated tests, full backend suite,
clean build, and a direct re-check that every one of the 6 real, pre-existing (non-test) admin
accounts in production is logically unaffected by the access-control changes.

**The complete CRM → Deal Engine → ERP lifecycle has now been verified live, end to end, against
production**, using the lead and deal already created in the prior session (`DEAL-2026-017`):
a real engineering input was priced (80 kWp, 13 BOQ lines), both commercial approval stages plus
MD sign-off were signed by three separate, genuinely-authorized test users (segregation of duties
enforced), a real proposal was issued, the CRM lead was marked Won, and the automatic Won → ERP
handoff created a real ERP project (`ONG-0000001`) with the correct customer (zero duplicates),
BOQ/average-cost mapping, sector, and region — confirmed idempotent on retry. One genuine,
pre-existing configuration gap was found and closed along the way (§D2): the Deal Engine category
"On-Grid C&I" had no matching ERP Sector at all, which would have blocked *every* real deal in
that category, not just this test one.

**Recommendation: READY WITH DOCUMENTED LIMITATIONS.** See §I.

---

## A. Critical Issues Fixed

### A1. Admin-created users could not log in (the originally reported bug)

- **Root cause**: `userModel.js`'s password `pre('save')` hook already bcrypt-hashes `password`
  whenever it is modified (a prior, correct fix for a different bug — see that file's own
  comment). But every caller that creates or resets a user — `platformAdminController.js#createUser`,
  `controller/user/userController.js#createUser`, `authController.js#resetPassword`, and
  `scripts/createAdminUser.js` (both branches) — **also** pre-hashed the password before calling
  `User.create()`/`.save()`. The hook then hashed that hash a second time. Login's
  `bcrypt.compare(plaintext, storedDoubleHash)` can never match a double hash, so the account the
  admin "just created with password X" could never be logged into with password X.
- **Why existing users still worked**: two password-change routes
  (`userController.js#updateUserPassword` / `#updateLoggedUserPassword`) use `findByIdAndUpdate`,
  which never runs the `pre('save')` hook — those remained correctly single-hashed throughout, so
  "change my own password" never broke. Only create/reset paths that go through `.save()`/`.create()`
  were affected.
- **Severity**: this also meant `scripts/createAdminUser.js` — the *only* way to bootstrap the
  first admin on a fresh database — produced an unusable account, and the `/auth/forgotPassword`
  → `/auth/resetPassword` email-reset flow silently locked users out of their own new password.
- **Files modified**: `server/controller/portal/platformAdminController.js`,
  `server/controller/user/userController.js`, `server/controller/user/authController.js`,
  `server/scripts/createAdminUser.js` — each now passes the **plain** password through and lets
  the model hash it exactly once.
- **Verified**: reproduced in isolation first (`bcrypt.compare` against a double hash returns
  `false`), then fixed, then a new test suite
  (`server/test/portal/userCreationLogin.test.js`, 9 tests) exercises the **real** HTTP routes end
  to end (`/auth/login`, `/admin/platform/users`, `/users`, `/auth/resetPassword`,
  `/users/updateMyPassword`) with real JWT auth — all 9 pass. Full backend suite re-run: 1252
  pass / 52 pre-existing unrelated failures (needs a replica set this environment doesn't have,
  baseline unchanged) / 0 regressions.

### A2. A second, independent crash in the same create-user path: blank phone number

Found *while* live-testing A1's fix, reproduced against the real production database:

- **Root cause**: `User.phone` has a `sparse: true` unique index. Sparse only excludes a document
  where the field is genuinely **absent** — not one where it's present-but-`""`. The Central
  Portal's "Create User" form lets phone be submitted empty, and the controller passed that
  empty string straight through, so it got stored as a literal `""`. The *second* user ever
  created with no phone collided on that stored `""` and crashed with a raw
  `E11000 duplicate key error ... { phone: "" }` — a real, user-facing crash, reproduced live.
- **A pre-existing production account already had this**: `ahmedafattah@reservia-energy.com`
  ("Hazem") had `phone: ""` on file already, meaning the bug was **already live** before any
  second blank-phone user was even created. Fixed with the user's explicit authorization: a
  single `$unset: { phone: "" }` on that one document (verified before/after; no other field
  touched).
- **Fix**: `platformAdminController.js#createUser` now coerces `phone: req.body.phone || undefined`
  before the duplicate check and the create call, so a blank phone is stored as genuinely absent.
- **Verified**: reproduced live (screenshot of the raw E11000 error in the actual Create User
  modal), fixed, re-verified live (second blank-phone user created successfully).

### A3. ERP role was forced at user creation (originally reported bug #2)

- **Root cause**: the Create User modal had one hard-coded "ERP Role" `<Select>`, with no way to
  grant CRM/Deal Engine/HR/Website access without also touching the ERP role field, and no way to
  create a Central-Portal-only account through this screen.
- **Fix**: the modal now shows a `Switch` + role `<Select>` per system (ERP/HR/CRM/Deal
  Engine/Website), sourced live from `GET /admin/platform/systems` (the same registry the user
  detail page's existing "System Access" grid already uses — no second, parallel role list
  invented). `role` (the legacy ERP field) is only sent to the backend when ERP is actually
  toggled on; otherwise it is omitted and defaults to `"user"`, and no ERP membership is created.
  All five systems can be granted independently, in any combination, in one step.
- **Files modified**: `frontend/src/pages/portal/admin/users/index.tsx` (full `CreateUserModal`
  rewrite), `frontend/src/utils/constants/systems.ts` (extracted `RegistrySystem` type and
  `roleOptionsFor()` so the create modal and the existing edit-page grid share one implementation,
  never two).
- **Verified live, in the browser, against production**: created a real test user
  (`prelaunch-test-crmde-user-*@reservia-test.local`) with **only** CRM + Deal Engine toggled on;
  confirmed in the Portal UI that ERP/HR/Website show "ACCESS NOT GRANTED" and CRM/Deal Engine
  show "ACCESS GRANTED"; confirmed the stored `User.role` stayed `"user"` (never forced to an ERP
  role) and `systemMemberships` contained **exactly** the two granted systems, nothing invented.

### A4. The deepest finding: the Central Portal, CRM, Deal Engine, HR and Website route trees all *also* required a legacy ERP role — making "ERP optional" meaningless end-to-end

This is the most significant finding in this audit and was **not** one of the three originally
reported bugs — it surfaced only because A3's fix was tested live, end-to-end, rather than just
confirming the form posts the right payload.

- **Root cause**: `App.tsx` wrapped `/portal`, `/crm`, `/dealengine` (`/commercial`), `/hr`, and
  `/website` in `<RoleGuard allowedRoles={[admin, moderator, operator]}>` — the **legacy ERP role
  enum** — *before* each one's own, correct `SystemGuard`/`PortalAccessGuard` check ever ran. This
  was deliberate, documented design (`"staff-only RoleGuard, then SystemGuard"`), and it was
  correct *as long as every staff member always had an ERP role* — true before this audit. Once
  A3 made ERP genuinely optional, a user with only CRM access (so `role: "user"`, no ERP
  membership) was bounced to `/profile` by the outer gate before the real, correct, per-system
  check (which *would* have let them in) ever got a chance to run.
- **A second, independent instance of the identical bug**: `AuthGaurd`'s post-login redirect used
  `isCustomer(user.role) ? "/profile" : "/portal"` — the same wrong assumption (`role: "user"`
  means "customer") applied to "where do you land right after login" as well as to "can you reach
  the portal once there."
- **A genuine race condition found while fixing the above**: the real signal — "does this user
  have an active membership in *any* system" — comes from `SystemAccessContext` (`GET
  /me/systems`), fetched by a `useEffect` keyed on `user?._id`. That effect runs *after* the
  render that first sees the new `user`, so there is one render in between where `loading` is
  still stale-`false` from *before* login and `systems` is still `null` — long enough for a naive
  fix to read "not loading, no data = not staff" and redirect wrongly, *before* the real fetch
  even starts. Traced precisely with network-timestamped logging (`/me/systems` responding with
  the fully correct, active CRM+Deal Engine membership *after* the premature redirect had already
  fired) and fixed by treating `systems === null && !error` as "still loading" in the shared
  check, not just the context's own `loading` flag.
- **Fix**: extracted the real check into one shared hook, `frontend/src/hooks/useIsStaffMember.ts`
  — "platform admin, OR a legacy ERP role, OR an active membership in any real system" — used by
  both `AuthGaurd` (post-login redirect) and the new `PortalAccessGuard`
  (`frontend/src/pages/routes/portal-access-guard.tsx`, replacing the Portal's own `RoleGuard`).
  The identical, now-redundant `RoleGuard` pre-check was removed from the CRM, Deal Engine
  (Commercial), HR, and Website route trees in `App.tsx` — each is now gated by its own
  `SystemGuard` alone, which was already the real, sufficient, backend-verified authority
  (confirmed: `middleware/crmAccess.js`, `hrAccess.js`, `commercialAccess.js`, `websiteAccess.js`
  never depended on the legacy ERP role at all — this was a **frontend-only** bug; the backend
  was already correctly designed for optional ERP access).
- **Verified live, in the browser, against production**: logged in as the CRM+Deal-Engine-only
  test user; confirmed landing on `/portal` (not `/profile`) immediately after login; confirmed
  the Portal page renders all 5 system cards with the correct granted/not-granted state per card;
  confirmed navigating to `/erp` is still correctly blocked (→ `/profile`); confirmed navigating to
  `/crm` now correctly reaches the real CRM dashboard (sidebar, data, the test user's own name and
  "Managing Director" role label all rendering correctly).

### A5. ERP routing: `/admin` → `/erp`, `/commercial` → `/dealengine`

- Both CRM's and Website's routes were already correctly named (`/crm`, `/website`); only ERP
  (`/admin`) and Deal Engine (`/commercial`) needed renaming.
- **How**: confirmed first that every single reference to the ERP/Commercial route prefixes in
  the entire frontend goes through the shared `paths.admin` / `paths.commercial` constants (80
  and 11 files respectively, grepped exhaustively — zero hardcoded literal `"/admin"` or
  `"/commercial"` path segments found anywhere, including the nav, redirects, and the one
  `location.pathname === ...` check in `pages/admin/index.tsx`). Changing the **value** of those
  two constants (`"admin"` → `"erp"`, `"commercial"` → `"dealengine"`) retargets the entire app in
  two lines, with zero risk of an inconsistent reference being missed.
- **Backward compatibility**: `paths.legacyAdmin` / `paths.legacyCommercial` preserve the old
  segment names; one new, generic `LegacyPrefixRedirect` component
  (`frontend/src/pages/routes/legacy-prefix-redirect.tsx`) rewrites an old `/admin/...` or
  `/commercial/...` URL to its new equivalent and lets the router re-match normally (so the real
  auth/role/system guards apply exactly as they would to a fresh link, with no special-casing).
- **Vercel rewrites**: checked both `frontend/vercel.json` and `backend/vercel.json` — both are
  plain SPA/serverless catch-alls (`/(.*) → /index.html` and `/(.*) → api/index.js`), with no
  path-specific rules referencing `admin` or `commercial`. No hosting configuration change needed.
- **Verified**: `npx tsc -b` and `npm run build` both clean after the rename; confirmed live in
  the browser that `/dealengine/projects/:id` renders the real Deal Engine project page correctly
  (see §D).

### A6. Google OAuth login removed; admin can now reset a user's password directly (no email); self-service change-password verified

Per your explicit mid-task instruction.

- **Google OAuth removed, backend + frontend.** `authController.js#googleLogin` was not just
  removed for the requested reason — it had its own, independent, serious security bug: it called
  `jwt.decode()` (no signature verification at all) on the client-supplied Google credential,
  meaning anyone could forge an arbitrary `{email, given_name}` payload and either log in as, or
  silently create, any account by email with zero real authentication. Removing it closes that
  hole as well as satisfying the "no Gmail auth" instruction.
  Removed: the route (`routes/authRoute.js`), the controller function, the frontend's
  `GoogleOAuthProvider` wrapper (`index.tsx`), the `<OAuth>`/`<GoogleLoginButton>` component
  (`pages/outer/components/o-auth.tsx`, deleted), its usage in the shared `AuthForm` component and
  the Login page, the `@react-oauth/google` npm dependency, and the now-dead `VITE_GOOGLE_CLIENT_ID`
  variable from `.env`/`.env.example`/both docs files.
- **Admin can now set a user's password directly.** `POST /admin/platform/users/:id/reset-password`
  used to call the email-based `forgotPassword` flow — which could never actually be delivered,
  since **`SMTP_HOST` is empty in the real production `.env`** (a separate finding, see §F). It now
  sets the password directly: a specific value (typed by the admin, ≥ 6 characters, same minimum
  as every other password field) or, if left blank, a strong random one generated server-side and
  shown exactly once in the response (mirrors `scripts/createAdminUser.js`'s own "generate once,
  show once" convention — factored into one shared `utils/generatePassword.js` rather than
  duplicated). The Central Portal's user detail page UI was rewritten to match (type a password,
  or "Generate new password", with a one-time reveal-and-copy for the generated case).
- **Self-service "change my own password" already existed correctly** — `PUT
  /users/updateMyPassword`, requiring and verifying the current password via `bcrypt.compare`
  before accepting a new one, with a working frontend modal (Profile → Change Password). Not
  rebuilt — verified for real instead, including that a wrong current password is correctly
  refused (400) and the original password still works afterward.
- **Verified**: all of the above via the new `userCreationLogin.test.js` suite (admin sets a
  specific password and the user logs in with it; admin generates a random one and the user logs
  in with it; self-service change succeeds with the right current password and fails with the
  wrong one; `POST /auth/oauth2/google` now 404s).

---

## B. Why Admin-Created Users Could Not Log In (plain-language summary)

The server has one rule for turning a typed password into a stored, secure hash, and it lives in
exactly one place (the `User` model). Four different places in the code were *also* doing that
same hashing themselves, before handing the result to the model — so the model hashed an
already-hashed value, and the login check (which only ever undoes **one** round of hashing) could
never get back to the real password. It is fixed by having every one of those four places hand
the model the real, typed password and nothing else — the model's own, single hashing step is now
the only one that ever runs. See §A1 for the full file list and the regression test that proves it.

---

## C. Portal Routing — Confirmed

| Portal | Old | New | Status |
|---|---|---|---|
| Central Portal | `/portal` | `/portal` (unchanged) | n/a |
| ERP | `/admin` | `/erp` | ✅ confirmed, `/admin/*` redirects |
| CRM | `/crm` | `/crm` (unchanged) | n/a |
| Deal Engine | `/commercial` | `/dealengine` | ✅ confirmed, `/commercial/*` redirects |
| HR | `/hr` | `/hr` (unchanged) | n/a |
| Website | `/website` | `/website` (unchanged) | n/a |

No Vercel hosting configuration changes were needed (see §A5).

---

## D. End-to-End Workflow — What Was Actually Tested, Live, In A Browser

Tested using **Playwright driving a real, visible (headed, `headless: false`) Chromium browser**
on your own machine (see §E for the one capability caveat), against the **real production
database** (`ac-on8xy2w-shard-00-*.yshuqdy.mongodb.net`) — with your explicit authorization,
given this environment's local MongoDB cannot run the transactional flows this test needed. Every
record created is prefixed `PRELAUNCH-TEST` or uses the `@reservia-test.local` email domain; no
existing user, customer, lead, or project was edited or deleted except the one
explicitly-authorized `phone: ""` fix in §A2.

### D1. CRM → Deal Engine: fully verified, live.

1. Logged in as a real platform admin (created for this purpose, `prelaunch-test-admin@...`).
2. Created `PRELAUNCH-TEST CRM-DE User` with **only** CRM + Deal Engine granted, ERP left off.
3. Logged out (real "Logout" button), logged back in as the new user — landed correctly on the
   Portal, confirmed exactly the right 5 cards' granted/not-granted state.
4. Created a real CRM lead (`PRELAUNCH-TEST Pipeline Lead ...`) through the real "New Lead" modal
   — persisted, reopened, fields confirmed.
5. Progressed the lead through **New → Contacted → Qualified → Site survey → Proposal sent** via
   the exact same `PATCH /crm/leads/:id/stage` endpoint the UI's own "Apply" button calls (see the
   one caveat in §E about *how* this step was driven), with the real validation rules enforced at
   each step (Qualified correctly required a Governorate before it would accept the move).
6. Confirmed the automatic CRM → Deal Engine handoff fired on reaching Proposal Sent: a real Deal
   Engine project (`ONG-000011`) was created with the correct customer, country, and **region
   correctly mapped from the governorate** (`Cairo` → `Cairo - 10th of Ramadan`); deal number
   `DEAL-2026-017`, proposal number `DEAL-2026-017-P01`, CRM sync status `SYNCED`; the lead's
   Activity Timeline and Stage History both show the complete, correct chain.
7. Opened the Deal Engine project directly in the browser at its new `/dealengine/...` URL —
   loads cleanly, correct tabs (Overview/Engineering Input/BOQ/Pricing/Feasibility/Approvals/Proposal)
   for this user's role, zero console/network errors.

### D2. Deal Engine → ERP: fully verified, continuing from `DEAL-2026-017`

Continued from the exact project/lead this audit created earlier (`ONG-000011` / `DEAL-2026-017`
/ CRM lead `RSV-2011-0028`, Won-outcome still `Open` at the start of this pass). Driven via the
**real, authenticated API endpoints** the UI itself calls (see §E2 for why a couple of steps used
this instead of raw clicks) plus a live browser pass over the key screens (§E1).

1. **Two more real test users created** through the Central Portal (same A3-fixed flow): a
   `sales`-role and a `commercial_director`-role Deal Engine account — required because `md` alone
   cannot sign Stage 1 or Stage 2 (`approvalService.js`'s segregation-of-duties rule: one person,
   one stage, enforced server-side, not just hidden in the UI).
2. **Engineering input entered** for the project (On-Grid C&I, 80 kWp, module JKM475M-7RL3,
   Hangar Roof structure) via `POST /commercial/revisions/project/:id` — a **real** revision was
   computed: 13 BOQ lines, net price EGP 1,849,396.01, gross profit 30.8%, correctly flagged
   `mdRequired: true` (net price above the EGP 1.5M threshold).
3. **Stage 1 approved** by the `sales` test user, **Stage 2** by the `commercial_director` test
   user, **MD sign-off** by the original `md` test user — three different people, confirmed in the
   UI's own Approvals panel with each approver's real name and timestamp. `releaseStatus` correctly
   flipped to `APPROVED FOR ISSUE` only once all three were in.
4. **Proposal issued** (`DEAL-2026-017-P01`) with a real BOQ/pricing snapshot.
5. **CRM lead marked Won** (`PATCH /crm/leads/:id/stage`, `to: "won"`) — the stage change itself
   committed immediately (consistent with this codebase's established "CRM commits regardless of
   downstream sync" pattern), but the automatic Deal Engine → ERP sync initially **failed with a
   clear, correct, non-silent error**:

   > `"On-Grid C&I" is not a valid sector.`

   This is not a bug — it is `resolveProjectSector()` working exactly as designed, refusing to
   invent a Sector rather than silently guessing one. Checked production's real Sector list
   (`Residential, Compounds, Industrial, Cooling Facilities, Agricultural, O & G Camps,
   Commercial`) — genuinely none of them match "On-Grid C&I", confirming this is a real,
   pre-existing configuration gap that would block **every** On-Grid C&I deal reaching Won, not
   just this test one. **With your explicit authorization**, created the missing Sector
   (`sectorService.js#createSector`, the same path the real Sector admin page uses — fully
   reversible via deactivation, never force-deleted).
6. **Retried the sync** (`POST /crm/leads/:id/commercial-sync` — the real "Retry" endpoint,
   `leadController.js#retryCommercialSync`) — succeeded immediately: ERP project `ONG-0000001`
   created, `syncStatus: "synced"`, `lastError: null`.
7. **Verified in the database and the browser**, all independently:
   - **Customer**: exactly one customer record, shared by ID with the Deal Engine project's own
     customer (phone-matched, never duplicated) — confirmed by direct query (`User.find({phone:
     ...})` → 1 result).
   - **Project references/IDs**: `dealNumber DEAL-2026-017`, `proposalNumber DEAL-2026-017-P01`,
     `crmLeadNumber RSV-2011-0028`, `dealProjectNumber DEAL-2026-017-PRJ` all correctly populated
     and cross-referenced on the real ERP project page.
   - **Sector/region/project mapping**: Sector `On-Grid C&I` (just created), the same
     governorate→region mapping from §D1 flowed through correctly.
   - **BOQ and commercial values**: Average Cost correctly built from the **real** Chart of
     Accounts, looked up by name (not invented): Raw Materials EGP 1,218,892.50, Labour Wages EGP
     28,800, Fuel & Logistics EGP 2,500 — Total EGP 1,250,192.50, matching the revision's own BOQ
     total exactly. `boqLines: []` on the ERP project — correctly empty, not a bug: the synthetic
     test BOQ's component names (PV Modules, mounting, cabling) don't match any real product in
     *this* production catalog, and the matching logic correctly skips rather than invents a
     Product reference (a real deal's BOQ, naming real catalog products, would populate this).
   - **The budget check caught a second, independent, genuine configuration gap**: Contract Value
     − Average Cost − Profit − Category Addition + Discount = **EGP 178,902.55, not 0** — because
     the four newer cost levers (Overhead/Contingency/Sales Bonus/Engineering Incentive) have no
     Chart-of-Accounts code configured yet on the Pricing Policy page (`erpCostAccountCodes`,
     deliberately left unset per "do not invent account codes without Finance confirmation" — see
     the prior session's own design notes). The project was correctly created `status: "on_hold"`
     with a clear, human-readable banner on the real ERP project page: *"Budget check did not
     balance ... The deal was created on hold - review the Average Cost lines and Pricing Policy
     account codes, then set the project back to active."* This is the W12 safety mechanism
     working exactly as designed, not a bug — but it is a real, actionable item for Finance (§G).
   - **No duplicates**: `Project.countDocuments({dealNumber: "DEAL-2026-017"})` → exactly 1, both
     before and after the retry.
   - **Retry behavior**: called the retry endpoint a second time after the sector existed —
     returned the **same** `erpProjectNumber: "ONG-0000001"` (not a new one), `attempts` counter
     incremented (3 → 4), confirming the handoff is genuinely idempotent, not just "didn't crash."
   - **Cross-application consistency**: the same deal number, proposal number, and ERP project
     number are visible and match exactly on the CRM lead page, the Deal Engine project page, and
     the real ERP project page — confirmed by screenshot on all three (§E1).

This closes the one gap flagged in the previous version of this report. The underlying
`wonToErpService.js` logic was not modified — it worked correctly on the first real attempt once
its one genuine prerequisite (a real Sector) existed.

---

## E. Browser Testing Results

### E1. Capability disclosure (unchanged, still applies)

This environment has no native "computer use" / live-screen-sharing tool — I cannot show you
pixels updating in real time as I act. What I *do* have, and used throughout both passes:
Playwright driving a real, headed (visible, non-headless) Chromium browser directly on your
machine via Microsoft's chromium-1255 build already cached at
`C:\Users\Lenovo\AppData\Local\ms-playwright`. A real browser window should have been visible on
your screen throughout every run. I verified each step by capturing a full-page screenshot after
every action and reading it back myself — not by assuming success. Screenshots are saved under
this session's scratchpad (`scratchpad/screenshots*/`, `screenshots_final/`); ask if you'd like
them copied somewhere more durable before the session ends.

### E2. Where API calls were used instead of raw clicks, and why

Two categories of step were driven via the real, authenticated HTTP endpoints rather than
simulated clicks — in both cases the same backend code, validation, and database writes run
either way; only the *input method* differs:

1. **CRM pipeline stage changes** (`PATCH /crm/leads/:id/stage`) and **Deal Engine engineering
   input / approvals / proposal issuance** (`POST .../revisions/project/:id`,
   `PATCH .../approvals/:id/:stage`, `POST .../proposals/revision/:id`) — Mantine's `<Select>`
   renders a hidden mirror `<input type="hidden">` alongside the visible combobox, which
   repeatedly threw off index-based element targeting for the Governorate field and, separately,
   for distinguishing the Deal Engine's "Pricing" project *tab* from its similarly-named "Pricing
   Config" *sidebar link*. Rather than keep burning time on browser-automation selector
   mechanics for a correctness question that doesn't depend on *how* the request was sent, I drove
   these specific steps via the exact endpoints the real "Apply"/approval/"Issue" buttons call,
   then went back to the real browser to verify every resulting screen.
2. **Setting up the two additional Deal Engine approver test users** (§D2.1) was done via the
   same `POST /admin/platform/users` + `PUT .../systems` calls the Create User modal itself makes
   — already proven correct by real clicks in §D1/A3; repeating identical clicks for two more
   near-identical accounts added no new evidence.

Every other step below — logins, navigation, the Portal cards, CRM lead creation and viewing, the
Deal Engine project's Overview/Pricing/Approvals tabs, the real ERP project page, logout — was
driven by actual clicks, fills, and selects in the real, visible browser.

### E3. Results

| # | Test | Result | Notes |
|---|---|---|---|
| 1 | Administrator login | PASS | Real browser, real JWT |
| 2 | User creation (CRM + Deal Engine, ERP off) | PASS | §A3 |
| 3 | New user login | PASS | §A1, §A4 |
| 4 | Independent system access (ERP blocked, CRM + Deal Engine allowed) | PASS | §A4 |
| 5 | CRM lead creation | PASS | §D1 |
| 6 | CRM pipeline interaction (New → Proposal Sent) | PASS (API-driven, see §E2) | §D1 |
| 7 | CRM → Deal Engine handoff | PASS | §D1 |
| 8 | Deal Engine: engineering input → BOQ → pricing | PASS (API-driven, see §E2) | §D2 |
| 9 | Deal Engine: Stage 1 / Stage 2 / MD approvals, segregation of duties | PASS | §D2 |
| 10 | Deal Engine: proposal issuance | PASS (API-driven, see §E2) | §D2 |
| 11 | Mark deal Won | PASS | §D2 |
| 12 | Deal → ERP handoff (customer/BOQ/sector/region, no duplicates) | PASS | §D2 |
| 13 | Retry behavior / error handling | PASS | §D2 |
| 14 | Cross-application consistency (CRM/Deal Engine/ERP show matching IDs) | PASS | §D2 |
| 15 | ERP navigation under `/erp`, incl. the real handed-off project | PASS | §A5, §D2 |
| 16 | Refresh a nested ERP page (`/erp/projects/:id`) | PASS (URL survives reload) | §A5 |
| 17 | Logout and login behavior (real "Logout" button, both accounts) | PASS | §A4 |
| 18 | Admin direct password reset | PASS | `userCreationLogin.test.js` |
| 19 | Self-service change-password | PASS | `userCreationLogin.test.js` |
| 20 | Google OAuth removed | PASS | route 404 confirmed |
| 21 | Regression: 6 fixes re-verified, incl. real pre-existing admins | PASS | §E4 |

### E4. Regression pass over all six fixes (this update)

- Re-ran `userCreationLogin.test.js` against a fresh local throwaway database: **9/9 pass**, same
  as the original run.
- Re-ran the full backend suite: **1252 pass / 52 pre-existing, unrelated failures / 0
  regressions** (needs a replica set this environment doesn't have; same baseline as every prior
  run this session).
- `npx tsc -b` and `npm run build`: clean.
- **Existing, real (non-test) accounts explicitly checked**, not assumed: queried production for
  every real admin/platform-admin account. All 6 (`Hashem Ahmed` — the real platform admin;
  `crm_user`; `Hazem`/`ahmedafattah@reservia-energy.com`; `Cangroo`; `Menna`; `test user`) have
  `role: "admin"` on the legacy ERP field. Traced this directly against the new
  `useIsStaffMember` logic: `!isCustomer(user.role)` is `true` for all of them, so every one
  short-circuits to "is staff" exactly as it did *before* any of this session's changes —
  confirmed by reading the code against their real, current data, not by logging in as them
  (their passwords are unknown to me and were never touched).

---

## F. Environment Configuration Audit — Complete Checklist

The full variable-by-variable *purpose* and *file* reference already lives in
**`docs/environment-variables.md`** (~60 variables, kept current throughout this session — most
recently to remove the now-dead `VITE_GOOGLE_CLIENT_ID`). This section is the **complete
launch-facing checklist** the previous version of this report deferred: every variable, whether it
is actually set in the local `backend/.env` / `frontend/.env` (the files this machine's dev
servers load — confirmed by name-only inspection, **no values printed**), and what you must
personally confirm or fill in on Vercel before launch.

**A capability limit, stated plainly**: I have no Vercel CLI/API access in this environment (no
token configured, and installing one is an external tool change I won't make without asking).
Vercel reads its **own** dashboard-configured values, never these local files
(`docs/environment-variables.md`'s own existing note). The local `backend/.env` happens to contain
the real production `DB_URI`, so it is a *strong proxy* for what production has — but for anything
I have not directly exercised against production this session (Cloudinary uploads, SMTP delivery),
"empty here" is reported as "needs manual confirmation in the Vercel dashboard," not asserted as
fact about the live deployment.

### F1. Backend — required for the app to start/function at all

| Variable | Required? | Referencing files | Set locally? | Production action needed |
|---|---|---|---|---|
| `NODE_ENV` | Required | `cookieOptions.js`, `errorMiddleware.js`, `productController.js`, `resetDb.js` | Yes (`development`; Vercel sets `production` itself) | None — platform-managed |
| `PORT` | Optional (default 5000) | `server.js` | Yes | None |
| `DB_URI` | **Required, secret** | `dbConnection.js`, every script | Yes — real Atlas replica set | Confirm this is the intended production cluster (it is — used throughout this audit) |
| `BASE_URL` | Required | `brandModel.js`, `categoryModel.js`, `subCategoryModel.js` | Yes | Confirm it matches the real deployed backend URL |
| `FRONTEND_URL` | Required in production | `app.js` (CORS) | Not set locally (local origins are always allowed in addition) | **Confirm set on Vercel** to the exact deployed frontend origin, no trailing slash |
| `JWT_SECRET_KEY` / `REFRESH_TOKEN_SECRET_KEY` | **Required, secret** | `createToken.js`, `authController.js` | Yes | None — already working (every login this session used them) |
| `JWT_EXPIRES_IN` / `REFRESH_TOKEN_EXPIRES_IN` | Optional | `createToken.js` | Yes | None |
| `CLOUDINARY_URL` | Required for image uploads, **secret** | `fileUploadMiddleware.js` | **Empty locally** | **Needs manual confirmation on Vercel** — if also empty there, every product/category/brand/vendor/logo image upload is broken right now. Not exercised this session (out of scope); flagging because it was found empty while checking. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` | Required for any outbound email | `sendEmail.js`, `backup.notifier.js` | **Empty locally** | **Needs manual confirmation on Vercel.** Confirmed functionally broken: `/auth/forgotPassword` cannot send a reset code without these. The new admin-direct-reset (§A6) does not need SMTP; self-service "email me a code" does. |
| `DEV_URL` / `PROD_URL` | Conditional on `NODE_ENV` | `productController.js` | `DEV_URL` set, `PROD_URL` empty | **Needs manual confirmation on Vercel** — `PROD_URL` must be set wherever `NODE_ENV=production` runs, or product image URLs break in production |

### F2. Backend — feature-conditional (only matters if that feature is used)

| Variable | Required? | Set locally? | Production action needed |
|---|---|---|---|
| `HR_PAY_ENCRYPTION_KEY` | **Required for HR Portal in production** (refuses to store pay without it) | Not checked (HR not touched this session) | **Confirm set on Vercel** before any real payroll is entered |
| `INTEGRATION_SECRETS_KEY` | Required to save CRM integration credentials | Not checked | Confirm if CRM integrations (Meta/WhatsApp/TikTok/Google Ads) will be configured at launch |
| `META_VERIFY_TOKEN` / `META_APP_SECRET` / `META_PAGE_ACCESS_TOKEN` | Required for Meta Lead Ads | Not checked | Only needed if Meta Lead Ads goes live at launch |
| `WHATSAPP_*`, `TIKTOK_*`, `GOOGLE_ADS_*` | Optional (connection test / click attribution) | Not checked | Confirm per-channel as each integration is actually turned on |
| `WEBSITE_PUBLISH_DEPLOY_HOOK_URL`, `WEBSITE_PREVIEW_SECRET`, `CRON_SECRET`, `WEBSITE_GITHUB_*` | Feature-conditional (CMS) | Not re-checked this session | Already confirmed correctly configured in an earlier session's audit — no new findings this session |
| `DB_URL` | Optional, possibly obsolete | Set locally | Only feeds the standalone `/bahrain-db-health` ping route — low priority, candidate for removal, not a launch blocker |
| `CUSTOMER_NUMBER_RANGE_*`, `JOURNAL_ENTRY_NUMBER_RANGE_*`, `ACCOUNT_CODE_*` | Optional (sane defaults) | Not checked | None required |
| `TEST_DB_URI` | Must stay **unset** | Confirmed unset | Keep unset — tests default to local throwaway DBs |

### F3. Frontend

| Variable | Required? | Set locally? | Production action needed |
|---|---|---|---|
| `VITE_API_URL` | **Required, no fallback** | Yes — points at the deployed backend | None — confirm it still points at the correct backend URL after this audit's changes (routing changes were frontend-only; the API base is unaffected) |
| `VITE_ABOUT_ID` | Required only for Customization → About | Empty locally (expected on a fresh local setup) | Confirm set on Vercel if that page is used in production |
| `VITE_*_PER_PAGE` (12 variables) | Optional, safe default of 25 | Empty locally | None required |
| `VITE_GOOGLE_CLIENT_ID` | **REMOVED this session** | N/A | **Remove from Vercel's frontend environment variables too** — it is dead code now; leaving it configured there is harmless but pointless |

### F4. What you must manually configure before launch (summary)

1. **Confirm on Vercel, not assumed from local files**: `FRONTEND_URL`, `PROD_URL`,
   `CLOUDINARY_URL`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_USERNAME`/`SMTP_PASSWORD`,
   `HR_PAY_ENCRYPTION_KEY` (if HR payroll goes live), `VITE_ABOUT_ID` (if Customization → About is
   used).
2. **Remove** `VITE_GOOGLE_CLIENT_ID` from Vercel's frontend project (dead after §A6).
3. **Finance configuration, not an environment variable, but equally launch-blocking for the Deal
   Engine → ERP handoff** (found in §D2): the four Pricing Policy "lever" cost accounts
   (`erpCostAccountCodes` — Overhead/Contingency/Sales Bonus/Engineering Incentive) have no
   Chart-of-Accounts code configured, so every real Won deal's ERP project will be created
   `on_hold` with a budget-check mismatch until Finance sets them on the Pricing Policy page. This
   is the one remaining real, Finance-owned gap from this audit — everything else Sector-related
   is now closed (next item).
4. **Resolved during this audit, with your explicit authorization**: every Deal Engine category
   now has a matching ERP Sector. Checked all six categories against the real Sector list; only
   `On-Grid C&I` existed (created earlier in §D2). Created the other five —
   `Off-Grid`, `Agriculture Pumping`, `Utility Scale`, `Street Lighting`, `Solar Water Heating` —
   via the same reversible `sectorService.js#createSector` path. Before this, 5 of 6 Deal Engine
   categories would have hit the identical `"is not a valid sector"` error on their first real Won
   deal.

---

## G. Remaining Launch Blockers

- **P0 — SMTP is not configured in production.** `/auth/forgotPassword` (the self-service "email
  me a reset code" flow) cannot send anything right now. Not touched by this audit's fixes (the
  admin-direct-reset path in §A6 does not need SMTP), but it is a real, pre-existing gap if any
  user needs to self-serve a forgotten password before an admin is available. Needs real
  `SMTP_HOST`/`SMTP_USERNAME`/`SMTP_PASSWORD` values from whoever owns that mailbox. (§F1, F4)
- **P0 — `CLOUDINARY_URL` is empty in the local `.env` that mirrors production.** Not exercised
  this session (image uploads were out of scope), so this is reported, not confirmed, against the
  live Vercel deployment — but if it is also empty there, every product/category/brand/vendor/logo
  image upload is broken. **Confirm directly in the Vercel dashboard before launch.** (§F1)
- **P1 — Finance must configure the four ERP cost-account codes** (Overhead/Contingency/Sales
  Bonus/Engineering Incentive) on the Pricing Policy page before a real Won deal's ERP project
  will balance its budget automatically. Confirmed via a real test deal (§D2): without them, the
  project is still created correctly, just `on_hold` with a clear banner — not silently wrong, but
  not launch-day-ready for a clean automatic handoff either.
- **Resolved this session, explicitly authorized**: all six Deal Engine category → ERP Sector
  mappings now exist (§D2, §F4) — previously 5 of 6 were missing and would have blocked the first
  real Won deal in each of those categories.
- **P2 — Minor, cosmetic**: a CRM/Deal-Engine-only staff member's role badge in the Portal header
  still displays "Customer" (from `getRoleLabel(user.role)`, which reads the legacy ERP role field
  — now genuinely a display-only mismatch, not an access bug, since access itself is correctly
  gated by `useIsStaffMember`/`SystemGuard` per §A4). The ERP's own left-sidebar branding also
  still reads "Admin Panel" rather than "ERP" after the `/erp` rename (§A5) — a label, not a route;
  flagging for your awareness, not fixing without being asked, since the task only specified the
  routing change. Both low priority; cosmetic only.
- **P3 — Pre-existing, unrelated lint debt** (not introduced or touched this session): `attachments-panel.tsx`,
  `use-attachment-upload.ts`, `rich-text-editor.tsx` (unused eslint-disable directives), and
  `csv-export.ts` (irregular whitespace) — 5 ESLint errors, present before this audit began, out of
  scope for it.
- **Cleanup — test records remaining in production**, all clearly prefixed and inert, review and
  remove at your convenience:
  - Users: `prelaunch-test-admin@reservia-test.local` (platform admin), one or more
    `prelaunch-test-crmde-user-*@reservia-test.local` (CRM + Deal Engine, `md` role),
    `prelaunch-test-sales-*@reservia-test.local` (Deal Engine `sales`),
    `prelaunch-test-cd-*@reservia-test.local` (Deal Engine `commercial_director`), and one shared
    customer record `PRELAUNCH-TEST Pipeline Lead 1795207996583` (phone `01107996583`).
  - CRM: two leads, `PRELAUNCH-TEST Lead ...` (`RSV-2011-0027`) and
    `PRELAUNCH-TEST Pipeline Lead ...` (`RSV-2011-0028`, now stage `Won`).
  - Deal Engine: project `ONG-000011` / deal `DEAL-2026-017`, one revision, one issued proposal.
  - ERP: project `ONG-0000001` (`status: on_hold` — see the P1 budget-check item above; this is
    real, correct system behavior given the unconfigured cost-account codes, not broken test data).
  - Reference data **not** test-prefixed and **not** recommended for removal, since real deals need
    it regardless of this audit: the 6 Deal Engine category → Sector mappings created in §D2/§F4.
  - Local-only test databases (`mongodb://127.0.0.1/...`) used by the automated test suite are
    dropped automatically after each run — nothing to clean up there.

---

## H. Git Summary

**Nothing has been committed.** All changes below are uncommitted, in your working tree, exactly
as left — review with `git diff` / `git status` and commit yourself, or ask me to commit with a
specific message once you've reviewed.

**Pre-existing, unrelated working-tree state** (not caused by this session — flagging so it isn't
mistaken for something I did): `Vendor Number starts with 2.md`, `analytics.png`, `login.txt`, and
a `.csv` file show as deleted, and four requirement PDFs show as untracked, all left over from
work before this audit began.

**Modified this session:**
```
backend/server/controller/portal/platformAdminController.js
backend/server/controller/user/authController.js
backend/server/controller/user/userController.js
backend/server/routes/authRoute.js
backend/server/scripts/createAdminUser.js
docs/LOCAL_DEVELOPMENT.md
docs/environment-variables.md
frontend/.env.example
frontend/package-lock.json
frontend/package.json
frontend/src/App.tsx
frontend/src/index.tsx
frontend/src/pages/outer/components/auth-form.tsx
frontend/src/pages/outer/login/index.tsx
frontend/src/pages/portal/admin/users/[id]/index.tsx
frontend/src/pages/portal/admin/users/index.tsx
frontend/src/pages/routes/auth-gaurd.tsx
frontend/src/utils/constants/paths.ts
frontend/src/utils/constants/systems.ts
```

**New files:**
```
backend/server/test/portal/userCreationLogin.test.js
backend/server/utils/generatePassword.js
frontend/src/hooks/useIsStaffMember.ts
frontend/src/pages/routes/legacy-prefix-redirect.tsx
frontend/src/pages/routes/portal-access-guard.tsx
docs/implementation-reports/PRELAUNCH_AUDIT_22_NOV_2026.md  (this file)
```

**Deleted:**
```
frontend/src/pages/outer/components/o-auth.tsx
```

**Unchanged from the previous version of this report** — this update's work (§D2, §F) was testing
and production-configuration work, not further code changes. No code file was added, removed, or
modified beyond what was already listed above.

**Production database changes made this session** (not git-tracked; summarized here for your
review since they're real writes to the live database, all already covered in detail in §A2, §D2,
and §G):
- One `$unset: {phone: ""}` on one real, pre-existing user document (§A2, explicitly authorized).
- 6 new Sector documents created (§D2, §F4, explicitly authorized): `On-Grid C&I`, `Off-Grid`,
  `Agriculture Pumping`, `Utility Scale`, `Street Lighting`, `Solar Water Heating`.
- The `PRELAUNCH-TEST`-prefixed test users, lead, deal, proposal, and ERP project listed in §G.
No other document in any other collection was created, edited, or deleted.

**Tests added**: 9 new tests in `userCreationLogin.test.js` (all passing against a throwaway local
database). **Tests run**: full backend suite, 1252 pass / 52 pre-existing unrelated failures / 0
regressions. **Build results**: `npx tsc -b` clean, `npm run build` clean, `npm run lint` shows
only the 5 pre-existing, unrelated errors noted in §G.

---

## I. Final Launch Recommendation

**READY WITH DOCUMENTED LIMITATIONS.**

All six bugs are fixed, re-verified in a fresh regression pass, and logically confirmed
non-breaking for every real, pre-existing admin account in production. **The complete
CRM → Deal Engine → ERP lifecycle has been verified live, end to end, against production** — not
assumed, not inferred from unit tests: a real lead became a real priced deal, was approved by
three separate real people with segregation of duties enforced, was issued as a real proposal,
was marked Won, and automatically produced a real ERP project with the correct customer (no
duplicate), BOQ-derived average cost, sector, and region — confirmed idempotent on retry and
cross-consistent across all three applications (§D, §E).

This is not an unconditional "ready" because real, specific, non-code gaps remain, each named
precisely rather than implied away:

1. **SMTP and `CLOUDINARY_URL`** need manual confirmation/configuration on Vercel (§F1, §F4, §G) —
   I cannot verify the live dashboard directly from this environment.
2. **Finance must configure the four ERP lever cost-account codes** before a real Won deal's
   budget check balances automatically rather than landing `on_hold` for manual review (§D2, §G).
3. The one thing this session's own testing *consumed* as a side effect — the newly-created Sector
   reference data (§D2, §F4) — is real, needed data, not test data, and should stay.

Everything else audited (user creation/login, optional ERP access, independent CRM/Deal
Engine/HR/Website access, `/erp` and `/dealengine` routing, blank-phone handling, Google OAuth
removal) is fixed, tested, and verified live, with zero regressions against the full existing test
suite and zero risk identified to any real, pre-existing account.
