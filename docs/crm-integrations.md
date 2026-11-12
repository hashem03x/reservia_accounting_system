# Reservia CRM - lead integrations and Change Request 2 operations

This is the setup and operations reference for the five lead "doors" into the CRM (Change Request 2,
section 4) and the one-off maintenance steps that shipped with Change Request 2. Status of every
door is visible to the MD and Admin on **CRM > Integrations**.

A door counts as working only when a **real lead** has come through it and shows up on that screen
as "Receiving leads". If the configuration is present but no lead has arrived yet, the screen says
"Waiting for the first lead".

---

## 1. How every door works (shared rules)

Every channel ends up in the same service (`backend/server/services/crm/leadIntakeService.js` ->
`leadService.intakeLead`), so the rules are identical everywhere:

| Rule | Behaviour |
|---|---|
| Phone | Normalized to `+20...` (`utils/crm/phone.js`). A non-Egyptian number is rejected. |
| Duplicates | Matched on the normalized phone. A repeat enquiry **never** creates a second lead. It adds a timeline entry with the new channel, source and campaign, and only fills fields that are still empty (name, email). It never overwrites stage, owner, first-touch source or campaign. |
| Source | Decided by the channel (the API key proves who is calling): Meta Ads / TikTok / Google Ads. The website maps UTM parameters (`google` + `cpc` = Google Ads, etc.). WhatsApp uses the Ref code, else WhatsApp Direct. |
| Original time | `submittedAt` = when the customer submitted. The 8-working-hour first-reply clock starts here, not at import or delivery time. |
| Owner | Automated doors (website, WhatsApp, ad lead forms, CSV rows from those channels) are assigned by the CRM's existing rules (round-robin across active CRM **sales** users, or `CRM_ASSIGNMENT_STRATEGY=single`). The owner gets an email. **If no active user has the CRM sales role, leads arrive unassigned and nobody is notified.** The Integrations screen warns about this. |
| Idempotency | Every delivery is keyed on the provider's own id (`CrmIntakeEvent`, unique per channel + id). A redelivered webhook returns the first result and writes nothing. A delivery that failed partway is resumed on retry: the lead is not created twice, and only the missing step runs. |

---

## 2. Unified intake endpoint (any channel, API key)

`POST /api/v1/crm/integrations/:channel/leads` - `:channel` is one of `website`, `whatsapp`,
`meta`, `tiktok`, `google_ads`.

**Authentication:** `X-Api-Key: <key>` or `Authorization: Bearer <key>`. Keys are created on
**CRM > Integrations** (MD only) and shown **once**. The server stores only a SHA-256 hash of the
secret. A key works for its own channel only.

- **Rotate:** create a new key, update the sender, then revoke the old key.
- **Revoke:** takes effect immediately.
- **Rate limit:** 120 requests per minute per channel and caller (`CRM_INTEGRATION_RATE_LIMIT_*`).
- Never put a key in website/browser code.

```json
{
  "externalId": "platform-lead-id-123",          // REQUIRED - the platform's own lead/event id
  "phone": "+201012345678",                       // REQUIRED - Egyptian number
  "name": "Ahmed Samir",
  "email": "ahmed@example.com",
  "segment": "villa",                             // villa|compound|farm|oil_gas|factory|services|other|unknown
  "governorate": "Giza",
  "campaign": "Villas November",
  "adSetName": "Cairo villas 35+",
  "adName": "Roof video",
  "formId": "778899",
  "platform": "instagram",
  "submittedAt": "2026-11-09T10:00:00+02:00",     // ISO 8601 WITH timezone, or Unix seconds/ms
  "message": "Free text from the form",
  "answers": { "Monthly bill": "2500" },          // extra form answers -> a timeline note
  "utm": { "utm_source": "google", "utm_medium": "cpc", "utm_campaign": "test", "utm_content": "", "utm_term": "" }
}
```

| Response | Meaning |
|---|---|
| `201` `{created: true, refCode}` | New lead |
| `200` `{created: false}` | Merged into the existing lead for that phone |
| `200` `{replay: true}` | This `externalId` was already received - nothing changed |
| `400` | Validation error naming the field (e.g. `submittedAt must be ISO 8601 with a timezone...`) |
| `401` | Missing, invalid, revoked or wrong-channel key |
| `404` | Unknown channel |
| `409` | The same event is being processed right now - retry shortly |
| `429` | Rate limited |

Contact data is never echoed back in the response.

---

## 3. Website form - LIVE (existing)

- **Endpoint (unchanged):** `POST /api/v1/crm/public/leads` (public, CORS-restricted to the real
  website origins, rate-limited, honeypot).
- **Change Request 2 changes:**
  - `utm_term` is now stored.
  - `utm_campaign` is shown as the lead's **Campaign**.
  - The website's per-submission `eventId` makes double submits and retries idempotent.
  - The website now goes through the unified intake service.
- **Acceptance:** open the farm page with `?utm_source=google&utm_medium=cpc&utm_campaign=test` and
  submit. Expected: Source **Google Ads**, Campaign **test**, an owner, and an owner email. This is
  covered by an automated test against the real service code.
- **To confirm on the website side:** the `reservia_website` checkout on the development machine
  does not contain the Change Request 1 website pieces the CRM expects:
  - the `waRefCode.ts` / `POST /crm/public/wa-ref` registration,
  - 30-day first-touch UTM storage (it uses `sessionStorage`, so the latest values win within one
    browser session),
  - sending `referrer`.

  The CRM accepts all of these. Confirm which website build is deployed before retesting
  Organic/Direct attribution and WhatsApp Ref codes.

## 4. WhatsApp Business Cloud API - built, needs Meta credentials

Endpoint (Meta calls it): `GET/POST /api/v1/crm/whatsapp/webhook`.

**What it does:**
- Verifies the signature (`X-Hub-Signature-256`, `WHATSAPP_APP_SECRET`).
- A new number creates a lead: Source from the Ref code in the message (`WA-DDMM-XXX-XXXX`, as
  registered by the website), else **WhatsApp Direct**. The Ref code's UTM campaign is also kept.
- The message text goes to the timeline. An owner is assigned and notified.
- A known number gets the message on its existing lead.
- A redelivered message is ignored before anything is written.

Inbound only - no messages are sent from the CRM.

Setup (the MD must own and verify the Meta Business account; nothing here can be done without it):

1. **Business Manager** (business.facebook.com): the MD creates/owns the Reservia business portfolio
   and completes **Business verification** (Security Center).
2. **WhatsApp Business Account + number:** add `+20 121 189 2995` to a WhatsApp Business Account
   (WABA) in that portfolio.
   - **Business decision needed:** a number that is in use in the WhatsApp Business *phone app*
     must either be migrated to the Cloud API, or onboarded with Meta's "coexistence" option
     where available. Otherwise the chat cannot stay on the phone and also reach the CRM.
3. **Meta app** (developers.facebook.com, type *Business*, owned by the Reservia portfolio): add
   the **WhatsApp** product and connect the WABA.
4. **Webhook:** WhatsApp > Configuration.
   - Callback URL: `https://<backend-domain>/api/v1/crm/whatsapp/webhook`.
   - Verify token: the value of `WHATSAPP_VERIFY_TOKEN` (a random string you choose).
   - Subscribe the **`messages`** field.
   - Make sure the app is subscribed to the WABA (`POST /<WABA_ID>/subscribed_apps`; the
     dashboard does this when you connect).
5. **Backend env (Vercel):**
   - `WHATSAPP_VERIFY_TOKEN`.
   - `WHATSAPP_APP_SECRET` = App settings > Basic > App secret.
6. **App mode:** Live. Development mode only delivers webhooks for test numbers.
7. **Permissions** (a System User token is needed later, for sending): `whatsapp_business_management`,
   `whatsapp_business_messaging`. Receiving needs only the subscription and the app secret.
8. **Test:** send "Hi" from a phone to the number. A lead should appear within seconds on CRM >
   Leads with Source **WhatsApp Direct** and an owner. The Integrations screen should change to
   "Receiving leads".

## 5. Meta Lead Ads (Facebook + Instagram instant forms) - built, needs Meta credentials

Endpoint (Meta calls it): `GET/POST /api/v1/crm/integrations/meta/webhook`.

**What it does:**
- Verifies the signature (`META_APP_SECRET`).
- For each `leadgen` change, fetches the lead from the Graph API (`GET /<leadgen_id>`) with the
  Page token. The token is sent in a header, with `appsecret_proof`.
- Creates or merges the lead with:
  - Source **Meta Ads**,
  - campaign, ad set and ad names,
  - form ID, platform (facebook/instagram), Meta lead ID,
  - Meta's **original `created_time`**.
- Other form answers go to a timeline note.
- Idempotent on the Meta lead ID.
- A transient Graph API failure answers 500, so Meta redelivers; leads that already succeeded are
  not duplicated.

Setup (Reservia owns the Page and grants access; Cangrow builds the forms):

1. Make sure Reservia's Business portfolio owns the **Facebook Page** and the linked **Instagram
   account**. Cangrow's agency portfolio gets **partner** access to the ad account and the Page.
   Cangrow creates the instant forms.
2. In the same Meta app as WhatsApp (or a second app in Reservia's portfolio), add **Webhooks** >
   object **Page** > field **`leadgen`**.
   - Callback URL: `https://<backend-domain>/api/v1/crm/integrations/meta/webhook`.
   - Verify token: `META_VERIFY_TOKEN`.
3. **System User:** Business settings > Users > System users. Create an Admin system user and
   assign it the **Page** (with Leads access) and the **app**.
   - Generate a token with `leads_retrieval`, `pages_show_list`, `pages_read_engagement`,
     `pages_manage_metadata`, `ads_read`.
   - Put the token in `META_PAGE_ACCESS_TOKEN`.
4. **Subscribe the app to the Page:** `POST /<page-id>/subscribed_apps?subscribed_fields=leadgen`
   with that token.
5. **Page > Settings > Leads access** (Leads Access Manager): if access is restricted, allow the
   CRM app / system user.
6. **App Review:** if the app is not in Live mode with Advanced Access for `leads_retrieval` and
   `pages_manage_metadata`, Meta only delivers leads for users with a role on the app. Request
   Advanced Access if Meta requires it for your setup.
7. **Backend env:** `META_VERIFY_TOKEN`, `META_APP_SECRET`, `META_PAGE_ACCESS_TOKEN` (optional
   `META_GRAPH_API_VERSION`).
8. **Test:** use the **Lead Ads Testing Tool** (developers.facebook.com/tools/lead-ads-testing).
   Pick the Page and form and submit with an Egyptian phone. Within seconds the lead should be in
   the CRM with Source **Meta Ads**, campaign / ad set and an owner. Afterwards, archive the test
   lead from its page.

## 6. TikTok Lead Generation - stopgap ready; native webhook needs TikTok credentials

The native TikTok webhook is **not built**. It needs a TikTok for Business developer app (app
id/secret), the advertiser's authorization and TikTok's lead-webhook payload contract. None of
these are available yet. These two paths work today:

- **Daily CSV** (the agreed stopgap; see section 9). Use `Source = TikTok` and include the original
  `SubmittedAt`.
- **Unified endpoint** with a `tiktok` key, for any relay Cangrow runs (TikTok's CRM integrations,
  Zapier/Make, a script): `POST /api/v1/crm/integrations/tiktok/leads`.

Needed to build the native door: a TikTok for Business developer app with Lead Generation access,
`app_id` + `secret`, the advertiser id, a long-term access token, and the webhook subscription
details.

## 7. Google Ads lead form - built, needs the Google Ads side configured

Endpoint (Google calls it): `POST /api/v1/crm/integrations/google_ads/webhook`.

1. On **CRM > Integrations**, the MD creates a key for channel **Google Ads lead form**.
2. In Google Ads: the campaign's **Lead form asset** > *Lead delivery option* > **Webhook
   integration**.
   - Webhook URL: the endpoint above.
   - Key: the key from step 1, pasted whole. Google sends it back in `google_key` and the CRM
     verifies it.
3. Click **Send test data**. Google's test submissions (`is_test`) are acknowledged and recorded as
   "ignored" on the Integrations screen. They never enter the sales pipeline unless
   `CRM_GOOGLE_ADS_ACCEPT_TEST_LEADS=true`; then they are named `TEST - ...`.
4. Leads arrive with Source **Google Ads**, the campaign **id** (Google does not send the name),
   form id, ad group / creative id and GCLID in the note, and Google's submit time when provided.
5. **Calls from ads** go to the sales phone and are entered by hand. No call-tracking number exists,
   so nothing in the CRM pretends to track them.

## 8. Ad spend, targets and cost per lead

- The **Change Request 1, section 5** figures are loaded by `npm run db:seed-crm-targets`:
  - November 2026 targets 24/7/4/2/0,
  - December 2026 targets 4/3/1 and EGP 990,000,
  - planned spend: Farm test 7,000 (Nov), Farms 14,500 / Villas 2,700 / Compounds 800 (Dec).

  December *Enquiries* and *Qualified* were deliberately left empty ("to be entered after week 1").
  The script never overwrites a record that already exists.
- **Spend lines:**
  - `amountEgp` is the **planned** budget.
  - `actualAmountEgp` is the actual amount the MD enters once known.
  - Cost per enquiry and cost per qualified lead use the actual amount when entered, otherwise the
    planned one, and the Dashboard says which.
  - With zero leads the cost is shown as "-", never 0 or infinity.

## 9. CSV import (stopgap for every channel)

**CRM > Leads > Import CSV** (`import/crm-leads`, Admin/MD). Download the template and the format
guide from the same dialog.

**Columns:** `Name, Phone, Email, Channel, Segment, Source, Campaign, SubmittedAt, ExternalId,
Governorate, PartnerName, MonthlyBillEgp, SystemSizeKwp, ValueEgp`.
- Only **Phone** is mandatory.
- **Channel** may be empty when Source is Meta Ads / TikTok / Google Ads (ad lead form) or WhatsApp
  Direct.
- Header names are matched leniently: "Submitted At", "Campaign Name", etc.

**SubmittedAt** is the **original** submission time:
- `YYYY-MM-DD HH:mm` is read as Cairo time, e.g. `2026-11-09 10:00`.
- ISO 8601 with a timezone is also accepted.
- Ambiguous formats (`09/11/2026`) are rejected with a clear row error, as are future times and
  times more than 120 days old.
- A lead submitted Monday 10:00 and imported Tuesday 09:00 is due Monday 18:00.

**Re-imports:**
- A row with a `SubmittedAt` or `ExternalId` is recognized when imported again and reported as
  "already imported (skipped)". Nothing changes.
- A row with neither keeps the original behaviour: it merges into the existing lead as a repeat
  enquiry.

**Owners:** rows from automated channels follow the CRM assignment rules and notify the owner.
Hand-entered channels (phone, walk-in, ...) keep the importer as the owner.

## 10. Pipeline rules, follow-ups and first reply (reference)

**Stages:** New -> Contacted -> Qualified -> Site survey -> Proposal sent (-> Negotiation) ->
Won/Lost.
- Stages move one at a time, forward or back.
- Lost is possible from any open stage.
- Won is only possible from Proposal sent / Negotiation.

**MD override:**
- The MD can override a *path* rule (a skip, more than one step back, Won without a proposal,
  reopening a lost lead to another stage) with a reason.
- The previous stage, new stage, who, when, why and which rules were overridden are stored in the
  stage history and shown in the timeline.
- Data rules are never overridable: lost reason, contract value, follow-up date, technical-role
  limits, a won deal stays won.

**Follow-up dates:**
- Stored and shown as calendar dates (`YYYY-MM-DD`), never as times.
- Overdue only after that day ends in Cairo.

**First reply:** the earliest of
- the first move out of New,
- the first logged call,
- the first WhatsApp message *sent*,
- the first email.

Not counted: notes, inbound messages, imports, assignments.

**First-reply metrics:**
- Measured in working hours (Sun-Thu 09:00-18:00 Cairo) from the original submission.
- **% within 8h** = replied within 8 working hours / (replied + unreplied leads already past their
  deadline). Leads still inside their 8 hours are left out until they resolve.

## 11. One-off operations for Change Request 2 (run in this order, dry run first)

All scripts use `backend/config.env` (`DB_URI`). All refuse a Leopard database. All are read-only
or dry-run unless `--apply` is given.

```bash
cd backend

# 0. MD access (item 0): diagnose (read-only), then repair. Roles are resolved by the documented
#    rules in scripts/restoreSystemAccess.js - the legacy placeholder "MEMBER" is never copied; a
#    platform administrator holding ERP admin gets each system's owner role (CRM md, COMMERCIAL md);
#    HR is never granted. --confirm-db must name the database the dry run printed.
npm run db:restore-system-access -- --email=<MD email>
npm run db:restore-system-access -- --email=<MD email> --apply --actor-email=<platform admin email> --confirm-db=<database name>

# 1. Data migration: follow-up dates -> calendar dates; backfill first replies from history.
npm run db:migrate-crm-cr2
npm run db:migrate-crm-cr2 -- --apply

# 2. Targets + planned spend from Change Request 1, section 5 (skips anything already entered).
npm run db:seed-crm-targets -- --dry-run
npm run db:seed-crm-targets

# 3. Test-lead cleanup (item 13): review the audit, then archive ONLY confirmed codes.
npm run db:audit-crm-test-leads
npm run db:audit-crm-test-leads -- --archive=RSV-0811-0008 --actor-email=<MD email>          # dry run
npm run db:audit-crm-test-leads -- --archive=RSV-0811-0008 --actor-email=<MD email> --apply
```

Archiving keeps the lead, its history and its timeline. It can be undone from the lead page
(Restore). Nothing is ever deleted.

## 12. CRM Changes Required, 12 November 2026 - what changed and what Reservia must do

| # | Change | Where |
|---|---|---|
| 1 | A lead needs a governorate to move to Qualified or later (and to Won). The stage dialog asks for it. Won is refused while the Deal Engine sync has failed, with the reason shown next to Retry. Lead details (governorate, name, email, segment, bill, size, partner) can be edited on the lead page. The website form's typed location is matched to the official governorate (English or Arabic); an unrecognized entry stays on the intake note instead. | `utils/crm/stageRules.js`, `services/crm/leadService.js`, `PATCH /api/v1/crm/leads/:id` |
| 2 | A repeat enquiry on a Lost lead reopens it to New, records it in the stage history and timeline, sets its Deal Engine deal back to Open, and emails the owner (or the CRM MD when unassigned). Archived leads are not reopened. | `leadService.js#reopenLostOnRepeat` |
| 3 | Archive / Restore and "Show archived leads" are for the **CRM MD role only** (server-enforced). A login holding CRM Admin sees a disabled "Archive (MD only)" button that says so. To give a login the MD role: Central Portal > Users > system access > CRM = MD. | lead page |
| 4 | Performance has a "Leads by source" table: Source (first touch), campaign, **Last touch** (source and campaign), leads, qualified, won. The leads CSV export appends `LastTouchSource`, `LastTouchCampaign`, `LastTouchAt`. | `performanceReportService.js#getSourceSection`, `leadExportService.js` |
| 5 | A connection test that fails because a token is missing while secrets cannot be stored now says that `INTEGRATION_SECRETS_KEY` is the fix. | `integrationSettingsService.js#testConnection` |
| 7 | CSV import shows **Ready (no import yet)** instead of "Awaiting verification". It already keeps Source, Campaign and the original time (`SubmittedAt`, section 9). | Integrations page |

### Item 5: setting `INTEGRATION_SECRETS_KEY` (server administrator, once)

1. Generate 32 random bytes on any machine and keep the value private:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
2. Vercel > the backend project > Settings > Environment Variables > Production:
   `INTEGRATION_SECRETS_KEY` = that value. Redeploy the backend.
3. Never change or lose it afterwards: the secrets saved on the Integrations page are encrypted with
   it and cannot be read with another key (they would have to be typed in again).

The values each platform needs, and where to find them, are in sections 4 (WhatsApp), 5 (Meta
Lead Ads), 6 (TikTok) and 7 (Google Ads) above; the Integrations page lists the same fields.

**Why the WhatsApp test of 11 November failed.** Without `INTEGRATION_SECRETS_KEY` the access token
cannot be saved on the Integrations page, so - unless `WHATSAPP_ACCESS_TOKEN` was set as a server
variable - the test ran without a token and stopped at "Enter the access token and phone number ID".
The exact recorded message is on the Integrations page (WhatsApp > Last test). If it instead shows a
Meta error code, that code is Meta's answer: 190 = expired or invalid token (use a System User
permanent token), 100 = wrong phone number ID, 10/200 = the token lacks the
`whatsapp_business_messaging` permission.

### Item 6: what connects each door (Reservia's side)

| Door | Built | Needs from Reservia |
|---|---|---|
| WhatsApp | Yes (webhook, signature check, auto-assign, original time) | Meta Business login holder (action D); System User token, phone number ID, app secret; webhook callback set in Meta |
| Meta Lead Ads | Yes (webhook, lead fetch, campaign/ad set/ad names, original `created_time`) | Page access token, app secret, page subscribed to `leadgen` |
| Google Ads lead form | Yes (webhook with the CRM API key) | The webhook URL and key entered on the lead form asset |
| TikTok | Through the unified intake endpoint with a CRM API key (section 2/6); the native TikTok webhook is not built | One API key per sender (action C); TikTok developer app if the native webhook is wanted |

Every door gives the lead its Source, campaign and the original submission time, and auto-assigns
an owner from the CRM **Sales** pool. With nobody holding the Sales role (action A), leads arrive
unassigned and the CRM managers are emailed - the Integrations page shows that warning.

### Test leads (section 6 of the change list)

Archive only after the MD confirms, with the audited script (dry run first, section 11 step 3):
`RSV-0811-0008`, `RSV-1011-0009`, `RSV-1211-0011`, `RSV-1111-0010`. Leave `RSV-1211-0012` until its
owner is known. The developer does not archive production leads.
