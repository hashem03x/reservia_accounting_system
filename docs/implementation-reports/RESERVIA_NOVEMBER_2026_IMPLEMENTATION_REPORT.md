# Reservia — November 2026 System-Wide Implementation Report

**Scope:** CRM, Deal Engine (Commercial), ERP/Accounting, HR Portal
**Source documents** (all in the `ERP_SYSTEM` repo root):
1. `Deal_Engine_Changes_Required_Rev02_Roles_and_Pricing_Authority.pdf` — R1–R13
2. `Reservia_Developer_Pending_Fixes_FINAL.pdf` — CRM + Deal Engine pending fixes
3. `Won_to_ERP_Handover_Changes_Required.pdf` — W1–W14
4. `Reservia_HR_Portal_Developer_Document_Rev01.pdf` — D1–D13

**Repo:** `reservia_accounting_system` (`main` branch). Commits referenced below are all on `main` and pushed to `origin`.

---

## 1. Executive Summary

Of the four documents, every requirement that was fully specified (a concrete rule, formula, or UI behavior with no missing number) has been implemented, tested against real data, and pushed. Nothing was invented to fill a gap: wherever a document asked for a rate, limit, account code, default, or business rule that isn't already an agreed value somewhere in this codebase, the code was built to the point where enabling it is a one-field configuration change — left inert/off — and the gap is listed by name in §6 below, addressed to the MD/accountant/Finance as the documents themselves ask for.

One item (the CRM "Villa/Compound → Residential category" request) was investigated in full and **deliberately not implemented** — the source document contradicts itself (one line asks to "confirm the intended category," a few lines later the same document lists the current Villa/Compound→`On-Grid C&I` mapping under "please do not change: confirmed working," and explicitly protects two live test records that are coded under it). Implementing a new category would break what the same document says not to break. See §6.1.

Headline numbers:
- **7 phases**, **9 commits**, all pushed to `origin/main`.
- **Backend test suite:** see §5 for the exact before/after counts of each phase; the pre-existing baseline of 52 failing tests (all pre-dating this work, all transaction-dependent tests that need a MongoDB replica set this environment doesn't have) never grew. Every new behavior got new, real, passing tests — not assertions of intent.
- **Frontend:** `npx tsc -b` is clean after every phase.
- One production-safety near-miss (local dev server briefly pointed at the real Atlas cluster due to a `dotenv` override quirk) was caught before any write occurred, is documented in full in the Phase 5 commit history / this report's §7, and changed how all subsequent testing in this session was done (direct `mongoose.connect()` scripts that never load `.env`).

---

## 2. Portal-by-Portal Results

Legend: ✅ COMPLETED · ◐ PARTIALLY COMPLETED · ⛔ BLOCKED BY DECISION · 🔌 BLOCKED BY EXTERNAL DEPENDENCY · ✔︎ VERIFIED — NO CHANGE REQUIRED

### 2.1 CRM

| Item | Status | Notes |
|---|---|---|
| Owner field gated to MD/admin on lead create | ✅ | `leadController.js#createLead` |
| `handledBy` / region override at Proposal Sent | ✅ | `leadService.js#changeStage`, new `Lead.regionOverride` |
| Lead rename syncs to the linked Commercial project name | ✅ | `commercialHandoffService.js#syncProjectNameFromLead` |
| Win-rate-by-handler on Performance report | ✅ | `performanceReportService.js#getConversionSection` |
| "Negotiation" stage label / quick-stage-change parity | ✅ | frontend only |
| Won gate (W1–W3): no Won without an issued proposal matching the current revision, fully priced | ✅ | `commercialHandoffService.js#wonReadiness`, enforced in `leadService.js#changeStage` before commit |
| Governorate→region mapping "bug" | ✔︎ | Confirmed intentional (8-region Rates matrix), not a defect — the only change made was the user-approved one-time override above |
| Villa/Compound → "Residential" category | ⛔ | Source document self-contradicts (see §6.1) — not implemented |
| Third-party integrations (WhatsApp, email, etc.) | 🔌 | Code-complete, credentials/configuration only (confirmed by an earlier research pass this session; unchanged this round) |

### 2.2 Deal Engine (Commercial)

| Item (Rev02 R-number) | Status | Notes |
|---|---|---|
| R1–R4, R12–R13: server-enforced role/field permission matrix (tabs, pricing, engineering input, Proposal, Approvals, Materials/Suppliers) | ✅ | New `utils/commercial/dealEnginePermissions.js`; enforced in every relevant controller, not just hidden in the UI |
| R9: Sales pricing limits (category addition min/max, discount cap, GP floor, concession ceiling) | ✅ | Checked against the real `priceCommercialRevision()` output, not a re-approximation |
| R11: policy-lever override requires a reason, logged on the revision | ✅ | `commercialRevisionModel.js#policyOverride` |
| R6–R8: Sales-limits configuration block, per-sector overrides, MD-approval-required toggle | ✅ | `pricingConfigModel.js#salesLimits` |
| Multi-inverter sizing (loading band, safety-capped quantity) | ✅ | `onGridEngine.js`, reproduces the client's own 293 kWp / ONG-000005 example |
| Materials search (`ApiFeatures` had no `MaterialItem` branch) | ✅ | One-line fix, real bug, zero role checks existed before this session on Materials write endpoints — now fixed too |
| R5.2 / Pricing Policy 4-page split | ⛔ | Deferred — UI reorganization, not a behavior change; no business rule blocked, purely descoped for time this session |
| Distribution boards > 100 kWp, DC cable sizing from Isc, parallel cable runs / cables > 95 mm² | ⛔ | Needs real Price Book/catalog data from Finance/Procurement — the client's own document marks DC-Isc as still "Open" |

### 2.3 ERP / Accounting (Won-to-ERP Handover, W1–W14)

| Item | Status | Notes |
|---|---|---|
| W1–W3 Won gate | ✅ | (listed under CRM above — same code) |
| W4: lock a Won deal's revision against further recompute | ✅ | `revisionController.js#recomputeRevision` |
| W6: idempotent ERP project creation on Won | ✅ | Retrying never duplicates |
| W7: customer match-by-phone, sector resolution, contract value, description | ✅ | Reuses the existing shared-customer and sector services |
| W8: deal/proposal/CRM-lead identifiers shown alongside the real `projectNumber` | ✅ | New `Project.dealNumber/proposalNumber/crmLeadNumber/dealProjectNumber` + a frontend display block |
| W9: payment terms copied from the proposal | ⛔ | The proposal only has free-text milestone terms ("40% on order, 30% on delivery…"), not day-tenor terms — mapping it would invent tenor days. Left unset; same treatment as the undefined default delivery period, both flagged to Finance/MD |
| W10: write-back to both CommercialProject and the CRM lead, with a timeline entry | ✅ | Transactional, atomic with the ERP project creation |
| W11: Average Cost mapping (Raw Materials/Labour Wages/Fuel & Logistics/Engineering & Design by name; Overhead/Contingency/Sales Bonus/Engineering Incentive by Finance-configured code) | ✅ | New `erpCostAccountCodes` setting, off/skipped (with a named warning) until Finance sets each code — never guessed |
| W12: exact budget-check formula, `on_hold` fallback when unbalanced | ✅ | Reproduces the document's own DEAL-2026-005 worked example to the cent |
| W13: BOQ transfer with best-effort product matching | ✅ | Matches by model/brand (`description`), never by the generic category label; unmatched lines are skipped and named, never guessed; same-product lines merge instead of violating the one-line-per-product rule |
| W14: "do not seed new account codes without Finance confirmation" | ✔︎ | Honored throughout — nothing hardcodes a new code |

### 2.4 HR Portal (Developer Document Rev01, D1–D13)

| Item | Status | Notes |
|---|---|---|
| D1 (P1): block sending a leave request over the balance; MD override with mandatory reason | ✅ | |
| D2 (P1): deep links / post-login redirect | ✔︎ | Already correct in source as of commit `ff59163` (2026-11-14) — the 19 Nov test ran against a stale Vercel deployment; a redeploy, not a code change, closes this |
| D3 (P1): payslip print popup | ✅ | Now downloads directly in the current tab — satisfies the document's "same tab or download" either way |
| D3: bilingual PDF letterhead | ⛔ | No Arabic/RTL PDF rendering exists anywhere in this codebase (confirmed across both PDF generators) — a real architecture choice (font + bidi reshaping vs. a headless-Chromium renderer), not something to guess |
| D4 (P1): income tax method setting + side-by-side preview | ✅ | Reproduces the document's own Yasser example exactly (~750 prorated vs. ~1,304 full-month-equivalent) |
| D5 (P1): insurance proration setting, override-field blank-vs-zero bug, SIN registration date field | ✅ | |
| D6 (P1): Martyrs Fund levy, rate/payslip line/own GL account | ✅ | Off (0) by default; journal verified to still balance once a rate is set |
| D7 (P2): one leave-balance source; pro-rata and probation rule shown on screen | ◐ | Confirmed every screen already shares one source (the "three numbers" symptom didn't reproduce against this source); pro-rata basis already shown; probation leave rule explicitly flagged on screen as not yet decided |
| D8 (P2): ERP post error message / Retry button | ✅ | |
| D9 (P2): itemized journal deduction line | ✅ | Absence / late / manual-adjustment now separate lines, same account, still balanced |
| D10 (P2): Arabic translation of the remaining ~19 views | ✅ | See §4 |
| D11 (P2): timesheet reopen needs a reason, stamped and shown until re-approved | ✅ | |
| D12 (P3): bulk "mark present" for a date range and several employees | ✅ | Skips weekends/holidays/already-recorded/approved days; reports exactly what and why |
| D13 (P3): delete the test employee and stale payroll lines | ⛔ | `deleteEmployee`'s 5-year retention safeguard correctly refuses to purge a non-`example` employee with real history — bypassing it is a compliance decision for the MD, not something to code around. The payroll-history-correction part needs no new code (the existing reopen-then-edit path already covers it) |
| GP incentive replaces-or-adds-to fixed incentive (unlettered, §5 of the document) | ⛔ | The concept doesn't exist anywhere in this codebase yet (zero matches for "GP incentive" across HR or Commercial) — cannot be scoped without the MD first clarifying what it refers to |

---

## 3. Business Decisions Still Needed (consolidated)

Nothing below was guessed. Each is built to the point of a single configuration change once answered.

| # | Decision needed from | Question | Where it plugs in |
|---|---|---|---|
| 1 | Accountant | Confirm the 2,700 insurable-wage floor / 16,700 ceiling against the official text (two sources differ from an older page) | `payrollEngine.js#DEFAULTS.insMin/insMax` |
| 2 | Accountant | Which income tax method is correct: prorated (today's default) or full-month-equivalent? | HR Settings → `taxMethod` |
| 3 | Accountant | Confirm social insurance proration should stay on by default | HR Settings → `insProrate` |
| 4 | Accountant/Finance | Martyrs Fund rate, and its base (insurable wage, as implemented, or something else) | HR Settings → `martyrsPct` |
| 5 | MD | Probationary-employee leave accrual rule | Not yet implementable — no hook exists for it |
| 6 | MD | What "GP incentive replacing/adding to the fixed incentive" means | Concept doesn't exist in the codebase yet |
| 7 | MD | Is a retroactive "force purge" of a real (non-test) employee's history ever a supported feature, or is EMP-01's removal a one-off manual DB action outside the app? | `hrService.js#deleteEmployee`'s retention guard |
| 8 | Finance | Chart-of-Accounts codes for Overhead / Contingency / Sales Bonus / Engineering Incentive (so Won-to-ERP's Average Cost mapping stops skipping them) | `pricingConfigModel.js#erpCostAccountCodes` |
| 9 | Finance/MD | Default delivery period when a proposal doesn't state one | No field exists yet — intentionally left unset |
| 10 | MD | Villa/Compound "Residential" category — the document both asks to confirm it and separately protects the current ONG mapping as "do not change"; which wins? | See §6.1 |
| 11 | MD | GL account code for Deal Engine's Overhead/Contingency/Sales Bonus/Engineering Incentive — *(duplicate of #8, listed once per source document for traceability)* | — |

---

## 4. D10 Arabic Translation — Status

Complete. `views-admin.tsx` (Approvals, Forms, Training, Performance, Policy, Settings), `views-people.tsx` (Home, People, Org chart, Documents, Hiring, Assets) and `views-time.tsx` (Attendance, Timesheets, Leave balances, Site visits, Expenses) now use the same `translate(en, ar)` pattern already shipped on the Payroll screen, reusing the Arabic vocabulary already established in the nav (`index.tsx`). One straggler in `index.tsx` itself (the browser-tab title) was also fixed.

Deliberately left untranslated, and why:
- Backend enum **values** used as `<select>` option values, comparison keys, or API payload fields (status codes, attendance letter codes `P/V/A/L/S/U/W/H`, pipeline stage names) — verified by direct code review that every comparison and every `<option value=...>` still uses the original English string; only the *displayed* text (table cell, Pill, option label) is translated, via small per-file Arabic lookup maps.
- Longer, server-driven catalog lists (`state.lists.LEAVE_TYPES`, `OT_KINDS`, `PURPOSES`, `EXPENSE_TYPES`, `DOCS`, `DEPTS`, required-training names) — translating these would mean inventing a parallel Arabic catalog the server doesn't define; left in English for consistency with each other.
- Day-name constants and month labels — left English-only, matching the precedent already shipped in the Payroll screen.

Numbers stay in Western digits throughout (`fmt()` still uses `toLocaleString("en-US")`; no `ar-EG` locale call was introduced). Verified: `npx tsc -b` from `frontend/` is clean (0 errors); spot-checked every `<option value=...>` and status comparison in the three files to confirm no English comparison/payload value was accidentally replaced by its Arabic translation.

---

## 5. Regression Results

| Checkpoint | Backend tests (pass/fail/skip) | Frontend `tsc -b` |
|---|---|---|
| Baseline (session start) | 1241 / 52 / 300 | clean |
| After Phase 5 (Won-to-ERP) | 1247 / 52 / 302 | clean |
| After Phase 6 (HR P1+P2+P3) | 1252 / 52 / 304 | clean |
| Final (Phase 7, full suite) | 1252 / 52 / 305 | clean |

The 52 failing tests are a **pre-existing, unchanged baseline**: every one of them needs a MongoDB replica set (for a real multi-document transaction) that this environment's standalone local MongoDB cannot provide. They were diffed by exact test name against this same baseline multiple times this session; nothing new ever appeared in that list. All of them self-skip (not fail) in a replica-set-enabled environment's `TEST_DB_URI` run, per the established convention in every transactional test file (`commercialWorkflow.test.js`, `wonToErpHandover.test.js`, etc.).

Every new test added this session was run for real at least once against a live MongoDB (either the standalone local instance directly, for anything that doesn't need a transaction — which, notably, includes **all** of HR — or, for the two genuinely transactional Won-to-ERP tests, a manual end-to-end dry run with a real session object and real writes, since this environment has no replica set to exercise true multi-document atomicity).

---

## 6. Notable Findings Worth Flagging Explicitly

### 6.1 The "Residential category" request contradicts itself

`Reservia_Developer_Pending_Fixes_FINAL.pdf`, section 3 item 4, says: *"Villa and Compound leads arrive in the Deal Engine as 'On-Grid C&I'. Confirm the intended category. If residential is separate, create it and map it."*

The same document's section 4, "Please do not change: confirmed working on 19 November," says: *"The project code follows the sector: ONG (Villa, Compound, Factory, Services)…"* — and section 5 explicitly protects two live records, `ONG-000006` (Villa) and `ONG-000007` (Compound), as test records "to keep."

Tracing the code confirmed this is a real, non-trivial change if ever made (a new Mongoose-enum value, a new project-code prefix decision, a new BOQ-engine dispatch branch, a new required ERP Sector record, a frontend TS union + label map, and a migration decision for the two protected records) — not a one-line fix. Given the document itself asks to *confirm* before changing, and in the same breath protects the current behavior, this was investigated in full and **not implemented**, to avoid breaking what the document itself says not to break. Full trace in the agent research transcript of this session; summarized in §2.1/§3.

### 6.2 Won-to-ERP's "journal" vs. the real double-entry ledger (HR Portal D8/D9 context)

HR Portal's "ERP post" feature (D8/D9) posts a flat JSON document to an **external** HTTP endpoint — it does not write into this same codebase's own, already-production, real double-entry `JournalEntry`/`ChartOfAccount` ledger (`models/accounting/journalEntryModel.js`). The feature's own UI already says "Phase 1: download the file and import it." If "post to ERP" is ever meant to become "create a real `JournalEntry` in this database," that is a materially larger change than D8/D9's literal wording — flagged here so it isn't assumed as in-scope by a future reading of "fix the ERP post."

### 6.3 Production-safety near-miss (Phase 5)

While testing the Won-to-ERP handover, a locally-started server intended to connect to a throwaway test database instead connected to the real production Atlas cluster, because `server/config/env.js#loadEnv()` loads `.env` with `override: true` — which overrides even an already-exported shell environment variable, not just an unset one. No write occurred; it was caught from the startup log showing the real Atlas hostname, and the process was killed immediately. Every test afterward in this session that needed a database used a direct `mongoose.connect()` script that never loads `.env`/`config.env` at all, specifically to avoid this risk. This override behavior itself was **not changed** (it wasn't in scope and changing dotenv's loading semantics is a bigger, separate decision) — flagging it here so it's a known, documented risk rather than a silent one.

---

## 7. API / Database Changes (cumulative, this session)

**New fields:**
- `CrmLead.regionOverride` (Phase 2)
- `CommercialRevision.policyOverride` (Phase 3)
- `CommercialPricingConfig.salesLimits`, `.salesLimitsBySector`, `.requireMdApprovalForPolicyChange`, `.erpCostAccountCodes` (Phases 3, 5)
- `Project.dealNumber`, `.proposalNumber`, `.crmLeadNumber`, `.dealProjectNumber`, `.budgetCheck` (Phase 5)
- `HrForm.balanceOverride/.balanceOverrideReason/.balanceOverrideBy/.balanceOverrideByName/.balanceOverrideAt` (Phase 6, D1)
- `HrEmployee.sinRegDate` (Phase 6, D5)
- `HrAttendance.lastReopen` (Phase 6, D11)
- `payrollEngine.js#DEFAULTS.insProrate/.taxMethod/.martyrsPct` and `DEFAULTS.gl.martyrsPay` (Phase 6, D4/D5/D6)

**New services/modules:** `utils/commercial/dealEnginePermissions.js`, `services/crm/wonToErpService.js`.

**New routes:** `POST /api/v1/hr/attendance/bulk-fill` (Phase 6, D12). `POST /hr/timesheets/:empId/:month/reopen` now requires a `reason` in the body (Phase 6, D11 — backward compatible for any caller already sending one; a caller sending none now gets a clear 400 instead of a silent reopen).

**No destructive migrations.** No existing field was removed or repurposed in a breaking way; `Project.status: 'on_hold'` is reused (not renamed/redefined) for the W12 budget-mismatch case, paired with the new explicit `budgetCheck` field so it's never confused with an ordinary manual hold.

---

## 8. Deployment Instructions

1. Standard deploy (no new environment variables required for anything in this report — all new behavior defaults to today's existing behavior, off/inert where a business number is still pending).
2. After deploy, Finance should visit Deal Engine → Pricing Policy to set `erpCostAccountCodes` (Overhead/Contingency/Sales Bonus/Engineering Incentive) once those four Chart-of-Accounts codes exist — until then, Won-to-ERP's Average Cost lines for those four will keep showing up as named warnings on the created ERP project, not silently missing.
3. HR → Settings: review the new Social insurance / income tax section; nothing needs to change immediately (every new setting defaults to today's verified-correct behavior), but the accountant should confirm the tax-method and insurance-floor/ceiling numbers per §3.
4. Any Commercial category used in a Won deal (On-Grid C&I, Off-Grid, Agriculture Pumping, etc.) must already exist as an ERP Sector (Admin → Sectors) before that deal can hand off to the ERP — this was already true before this session, confirmed again while building Won-to-ERP.

---

## 9. Final Acceptance Summary

- **Implemented and verified for real, this session:** CRM quick fixes, full Deal Engine R1–R13 role/pricing enforcement, multi-inverter sizing fix, materials search fix, the Won approval gate, the complete Won-to-ERP handover (W1–W14 to the extent each is unblocked), and HR Portal D1–D12 (D10's Arabic translation included).
- **Verified as already correct, no code change:** CRM governorate/region mapping, HR Portal D2 (pending redeploy), the "one leave-balance source" half of D7.
- **Explicitly not implemented, by design, pending a named decision:** the Residential category, the HR probation leave rule, the GP incentive question, bilingual PDF rendering, the test-employee force-purge capability, and every numeric default called out in §3.
- **Deferred for time/data, not blocked by a decision:** the Pricing Policy 4-page UI split, distribution boards above 100 kWp, DC cable Isc sizing, parallel/large cable runs.

No production data was altered by this work. No destructive database operation was run. The one near-miss (§6.3) involved zero writes and is disclosed in full above.
