# Launch runbook - Commercial QA fixes, CRM attribution & integrations (November 2026)

Covers the work done against `Reservia_Commercial_QA_Findings.pdf` (10 Nov 2026) and the CRM /
website launch blockers. Every step below is something only an operator with production access
should do; nothing here has been run against production yet.

## 1. Deploy order

1. **Backend** (`Reservia Portal/backend`) - deploy first. New collections/indexes are created
   automatically by Mongoose on start (no destructive migration):
   `commercialpricingconfigs`, `commercialpricingconfigaudits`, `commercialsyncevents`,
   `crmintegrationsettings`; new partial unique indexes `commercialprojects.dealNumber` and
   `commercialprojects.crmLead`; new indexes on `crmleads` (`gclid`, `commercial.project`).
   All new fields are optional - existing documents remain valid.
2. **Portal frontend** (`Reservia Portal/frontend`) - deploy after the backend.
3. **Website** (`reservia_website`) - deploy after the backend (it now sends `attribution` and
   `submittedFrom`; older backends ignore unknown fields, newer backends accept the old payload too).

## 2. Backend environment variables to add

| Variable | Needed for |
| --- | --- |
| `INTEGRATION_SECRETS_KEY` | Saving integration credentials from the CRM Integrations page (32 random bytes, base64). Without it, credentials can only come from the env vars below. |
| `WEBSITE_ALLOWED_ORIGINS` | Only if a website origin other than `https://reservia-energy.com` / `https://www.reservia-energy.com` must submit leads (e.g. a preview domain). |

All integration credentials can be entered on **CRM -> Integrations** (stored encrypted) instead of
as environment variables. The env-var names are listed in `docs/environment-variables.md`.

## 3. One-time data steps (production) - run after the backend deploy

Each script is dry-run by default; inspect the output, then re-run with the flag shown.

| Step | Command | What it does |
| --- | --- | --- |
| Off-grid Price Book items (QA U7) | `npm run db:seed-commercial-offgrid` (dry run: `-- --dry-run`) | Inserts 9 Lithium Batteries + 13 Off-Grid Inverter items from the Rev05 reference price list. Insert-only. |
| Approved CRM targets & ad spend (C9) | `npm run db:seed-crm-targets -- --dry-run`, then without the flag | Loads the Change Request 1 figures (Nov 2026: Enquiries 24, Qualified 7, Surveys 4, Proposals 2, Signed 0; Dec 2026: Surveys 4, Proposals 3, Signed 1, value EGP 990,000; ad spend Nov "Farm test" 7,000, Dec Farms 14,500 / Villas 2,700 / Compounds 800). Refuses to overwrite existing records. **Confirm these are the figures approved on 4 Nov before running.** |
| Region report (QA B2) | `npm run db:normalize-commercial-regions` | Lists Egyptian projects whose region is not a Rates matrix region (today: OFG-000001, ONG-000001, PMP-000001, ONG-000002) - fix them with **Edit Project**. `-- --apply` only renames the Rates matrix alias label (optional; the engine already resolves it). |
| QA test records (QA section 7) | `npm run db:commercial-qa-cleanup` then `-- --apply` | Backs up and deletes ONG-000002, ONG-000003 and lead RSV-0811-0008 (identity + dependency checks first). Run **after** the section 8 acceptance test has been repeated on a fresh project on the live build. |

## 4. CRM roles (C8 / U6) - business decision required

* **CRM Sales:** no active user holds the CRM `sales` role, so automated leads are unassigned. Until
  someone has it, every unassigned lead now emails the CRM MD/Admin users and says so on its timeline.
  Grant `sales` (Central Portal -> Admin -> Users -> System access -> CRM) to the sales team.
* **Commercial approvals (Developer Brief 4.1):** Stage 1 = `sales` or `technical`; Stage 2 =
  `commercial_director`; MD = `md`. A person can sign only one stage of a revision. Today only one
  user (Commercial `md`) exists, so Stage 1 and Stage 2 cannot be signed until those roles are granted.
* **Pricing configuration:** editable by Commercial `md` / `commercial_director` and ERP `admin`. To
  open the page in the portal a user also needs Commercial access (any role).

## 5. External credentials checklist

| Integration | What Reservia must provide | Where it goes |
| --- | --- | --- |
| WhatsApp Cloud API | Verify token (any random string), Meta app secret, System User permanent access token (`whatsapp_business_messaging`, `whatsapp_business_management`), phone number ID, WABA ID | CRM -> Integrations -> WhatsApp; callback URL `<backend>/api/v1/crm/whatsapp/webhook`, fields `messages` (+ `smb_message_echoes` if the Business app is used on the number) |
| Meta Lead Ads | Verify token, app secret, Page access token (System User, `leads_retrieval`, `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list`, `ads_read`), Page ID | CRM -> Integrations -> Meta; callback `<backend>/api/v1/crm/integrations/meta/webhook`, field `leadgen` |
| TikTok | A delivery path for lead forms (TikTok Leads Center CRM integration or a relay such as Zapier/Make) using a CRM API key for channel `tiktok`; optional Marketing API token, app ID/secret, advertiser ID for the connection test | Unified endpoint `<backend>/api/v1/crm/integrations/tiktok/leads` with `X-Api-Key` |
| Google Ads | Lead forms: webhook URL + a CRM API key for `google_ads`. Optional API test: developer token, OAuth client ID/secret, refresh token (scope `adwords`), manager + account customer IDs. Conversion action name for the offline-conversion export | Webhook `<backend>/api/v1/crm/integrations/google_ads/webhook` |

An integration shows **Connected** only after a webhook handshake, a successful **Test connection**
(real API call) or a processed lead - never because credentials were typed in.

## 6. Acceptance to repeat on the live build

Section 8 of the QA report on a **fresh** On-Grid project (80 kWp, JKM475M-7RL3, Hangar Roof, 20 m AC,
Cairo - 10th of Ramadan, 155,000 kWh) and the C1 journey
`https://www.reservia-energy.com/en/farms?utm_source=google&utm_medium=cpc&utm_campaign=test` ->
internal page -> Arabic -> contact -> submit; the CRM lead must show Google Ads / cpc / test,
landing page `/en/farms`.
