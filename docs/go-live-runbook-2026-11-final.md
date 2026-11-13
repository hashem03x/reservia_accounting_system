# Go-live runbook: CRM review, Deal Engine and ERP CHG-01 to CHG-14 (13 November 2026)

This runbook covers the delivery on branch `delivery-final-2026-11`, merged to `main`. That is
commits `0d6aeb4` to `53fdb66`:

* CRM Changes Required (12 Nov), items 1 to 7;
* Deal Engine Changes Required (12 Nov), C1 to C26;
* ERP Developer Modification Request, CHG-01 to CHG-14.

The Website CMS is not part of this delivery. The earlier runbook, [launch-runbook-2026-11.md](launch-runbook-2026-11.md),
still applies to the items it covers.

Nothing in this runbook has been run against production. Every step is for an operator with
production access.

## 1. Before deploying

1. **Take a full backup** (Admin -> Backup). Confirm that it completes and verifies.
2. **Check the target branch.** `main` must be at `53fdb66` or later.

## 2. Deploy order

1. **Backend** (`backend/`).
   * Every schema change is additive, so there is no migration. Mongoose creates these new
     collections on first use:
     * `companysettings`
     * `fiscalyearcloses`
     * `commercialsuppliers`
     * `commercialpricelistuploads`
   * New fields are optional, so existing documents stay valid.
   * New dependency: `pdfkit`, used for the proposal PDF. `vercel.json` bundles
     `server/assets` and pdfkit's font metrics.
2. **Portal frontend** (`frontend/`). Deploy it after the backend.

## 3. Environment variables

| Variable | Action |
| --- | --- |
| `INTEGRATION_SECRETS_KEY` | **Set it if it is not set yet.** Without it the CRM Integrations page cannot save credentials. This is the cause of the WhatsApp test failure on 11 Nov. See [crm-integrations.md](crm-integrations.md) section 12. |
| `INVOICE_TIMING_LOG` | Leave it unset (the default is on) for the first weeks after go-live, so that slow invoice saves (CHG-05) can be read from the logs. Set it to `off` afterwards. |

No other variables are new. The full list is in [environment-variables.md](environment-variables.md).

## 4. Configuration after the deploy (in the application)

| Where | What | Why |
| --- | --- | --- |
| ERP -> Admin -> Company settings | Check the defaults: VAT 14%, price variance warning 20%, "Prevent negative project stock" on. | CHG-06, CHG-07 and CHG-03. Every change is kept in the settings history. |
| ERP -> Chart of Accounts | Check that `20000002` (Retained Earnings) and `20000003` (Profit of the year) exist as **equity** accounts. | Year-end close (CHG-09) refuses to run without them. |
| Deal Engine -> Pricing Configuration -> Deal Engine settings | Enter the USD, EUR and CNY exchange rates. | Until a rate is entered, supplier price-list rows in that currency are refused (C23). |
| Same card | Enter the specific yield for every region except Cairo - 10th of Ramadan. | Other regions use the Egypt default, 1,734 kWh/kWp, until they are set (C4). |
| Same card | Set the MC4 rule and price, and the accessories rate, once the MD decides. | C1 and C2. The defaults are the current behaviour. |
| Deal Engine -> Pricing Configuration -> Proposal text | Review the cover, terms and warranty text printed on the proposal PDF. | C12 and C13. |
| Portal -> Admin -> Users -> System access | Grant these roles:<ul><li>CRM `sales` to the sales team (C27);</li><li>Deal Engine `procurement` to whoever maintains suppliers (C18);</li><li>Deal Engine `sales` or `technical` (approval stage 1) and `commercial_director` (stage 2).</li></ul> | Without them, leads stay unassigned, suppliers cannot be maintained, and revisions cannot pass stages 1 and 2. |

## 5. Data tasks (MD or administrator only, never the developer)

* **Deal Engine C28 test data.** Delete ONG-000002, ONG-000003, ONG-000004 and CRM leads
  RSV-1211-0012 and RSV-0811-0008. First confirm with the MD whether ONG-000001, PMP-000001 and
  PMP-000002 are real projects.
* **ERP test records** listed in the ERP request ("Data and reset tasks"). Take a backup before
  the reset, and test the restore.
* **Master data.** Load the real products, vendors and project managers before go-live.

## 6. Acceptance to repeat on the live build

Take a backup first, then run the ERP tests on a copy of the staging data. The ERP request
requires this.

* **CRM.** Run the five acceptance steps in section 7 of the CRM Changes Required document.
* **Deal Engine.**
  * Re-run attachment A4 and record the new baseline. A4 under these rules: 60 kW inverter,
    DC/AC 1.338, net 1,660,676.
  * Issue one proposal and compare it with A1.
  * Upload the A2 template for one approved supplier.
* **ERP.**
  * Run the acceptance tests table of the ERP request for CHG-03, CHG-05 to CHG-07 and CHG-09
    to CHG-14.
  * For CHG-05, read the `invoice_save_timing` lines for 20 saves and check the 95th percentile.
  * For CHG-09, close the year **on a copy** only.

## 7. Rollback

* **Code.** Promote the previous Vercel deployment, backend first and then frontend. No data
  migration is needed: new collections and fields are ignored by the old code.
* **Year-end close.** If a year was closed with CHG-09, **reopen it before rolling back**. The
  old code includes closing entries in the profit and loss statement.
* **Supplier uploads.** Each upload has its own rollback on the supplier record (C21/C22). Use that
  rather than restoring the database.

## 8. HR Portal (added 14 November 2026)

The HR Portal follows the HR Portal Developer Spec and its prototype. It runs inside this portal:
same login, same database. Commits `3680270` (backend) and `ff59163` (screens).

**New collections**, created on first use: `hremployees`, `hrattendances`, `hrvisits`,
`hrexpenses`, `hrforms`, `hrtargets`, `hradjustments`, `hrpayrollruns`, `hrpayslipfiles`,
`hremaillogs`, `hrtrainings`, `hrassets`, `hrperformances`, `hrcandidates`, `hrsettings`,
`hraudits`.

1. **Set `HR_PAY_ENCRYPTION_KEY`** on the backend before anyone enters pay. It is 32 random
   bytes, base64. Production refuses to store pay without it.
   * Keep a safe offline copy of the key. Without it, stored pay cannot be read.
2. **Optional variables:**
   * `HR_MAIL_FROM`, with SPF and DKIM for the sender domain, for payslip email.
     SMTP must already be configured.
   * `HR_ERP_API_TOKEN`, once the ERP API is chosen (Phase 2).
3. **Grant HR roles** in Portal -> Admin -> Users -> System access -> HR:
   * `md`: approves payroll, reopens months, sees all pay;
   * `hr`: the HR officer;
   * `manager`: line managers. Also link each manager's employee record to their login: People ->
     employee -> Portal login. A line manager sees only direct reports and never
   pay;
   * `finance`: the accountant.

   Old placeholder HR memberships (`MEMBER`) open nothing until they are re-granted.
4. **Settings, before the first live run** (HR -> Settings). Confirm each value with the
   accountant or lawyer; every change is dated by its effective month:
   * insurable wage floor and ceiling for 2026 and 2027;
   * tax brackets and exemption;
   * whether the incentive counts as wage for insurance and overtime;
   * whether site allowances and reimbursements are taxed;
   * public holidays, including the moving Islamic ones;
   * signatory names.
5. **Acceptance** (spec section 11):
   * run December 2026 payroll in parallel with the spreadsheet; net and totals must match to
     the EGP for every employee;
   * then remove the example team (Settings -> Data) if it was loaded.

**Rollback:** the HR collections are new, so the old code ignores them. Pay stays encrypted.

## 9. Decisions still open (the code is ready for either answer)

| Item | Decision | Today's behaviour |
| --- | --- | --- |
| ERP CHG-02 (and CHG-01 rules 1 to 3) | Is project cost recognised as units are sold, or as cost-to-cost against % executed? | Both mechanisms remain. The reconciliation report shows which one relieved what. |
| ERP CHG-04 | Do overdue receipts count in the forecast closing balance? | Excluded, with a toggle to include them. |
| ERP CHG-06 | Which contract invoices are VAT-exempt? | 14% by default. A 0% invoice needs a reason and appears on the 0% review list. |
| ERP CHG-08 | Goods receipt with 3-way match, or 2-way matching? | 2-way: the purchase invoice receives the stock. |
| Deal Engine C1 / C2 | MC4 rule and price; accessories rate | Current behaviour, held as configuration. |
