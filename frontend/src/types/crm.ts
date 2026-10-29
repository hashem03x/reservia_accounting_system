// Reservia CRM - mirrors backend/server/utils/crm/constants.js and
// backend/server/utils/crm/stageRules.js exactly, so the frontend's own copies of these
// vocabularies can never drift from what the API actually accepts/returns.

export type CrmRole = "md" | "admin" | "sales" | "technical";

export type CrmStage = "new" | "contacted" | "qualified" | "site_survey" | "proposal_sent" | "negotiation" | "won" | "lost";

export const CRM_STAGES: CrmStage[] = ["new", "contacted", "qualified", "site_survey", "proposal_sent", "negotiation", "won", "lost"];

export type CrmSegment = "villa" | "compound" | "farm" | "oil_gas" | "factory" | "services" | "other" | "unknown";

export const CRM_SEGMENTS: CrmSegment[] = ["villa", "compound", "farm", "oil_gas", "factory", "services", "other", "unknown"];

export type CrmChannel =
  | "phone"
  | "walk_in"
  | "dealer"
  | "referral"
  | "event"
  | "outreach"
  | "email"
  | "whatsapp"
  | "web_form"
  | "landing_page";

export const CRM_CHANNELS: CrmChannel[] = ["phone", "walk_in", "dealer", "referral", "event", "outreach", "email", "whatsapp", "web_form", "landing_page"];

export const CRM_LOST_REASONS = [
  "Price",
  "Chose a competitor",
  "Payback too long",
  "No roof or land space",
  "Financing not available",
  "Not the decision maker",
  "No response",
  "Not a fit (too small)",
  "Project postponed",
  "Other",
];

export type CrmActivityType = "note" | "call" | "email" | "survey" | "proposal" | "whatsapp_in" | "whatsapp_out" | "system";

export type CrmLead = {
  _id: string;
  refCode: string;
  name: string | null;
  phoneE164: string;
  segment: CrmSegment;
  governorate: string | null;
  source: string;
  channel: CrmChannel;
  partnerName: string | null;
  monthlyBillEgp: number | null;
  systemSizeKwp: number | null;
  valueEgp: number | null;
  owner: { _id: string; name: string; email?: string } | null;
  followUpAt: string | null;
  stage: CrmStage;
  stageChangedAt: string;
  lostReason: string | null;
  mdApproved: boolean;
  replyDueAt: string;
  firstReplyAt: string | null;
  createdBy: { _id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type CrmActivity = {
  _id: string;
  lead: string;
  type: CrmActivityType;
  body: string;
  whatsappMessageId?: string;
  author: { _id: string; name: string } | null;
  createdAt: string;
};

export type CrmStageHistory = {
  _id: string;
  lead: string;
  from: CrmStage | null;
  to: CrmStage;
  changedBy: { _id: string; name: string } | null;
  lostReason: string | null;
  valueEgpAtChange: number | null;
  mdApproved: boolean;
  createdAt: string;
};

export type CrmPipelineRow = { stage: CrmStage; count: number; valueEgp: number };
