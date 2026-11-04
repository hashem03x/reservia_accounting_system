// Reservia CRM - mirrors backend/server/utils/crm/constants.js and
// backend/server/utils/crm/stageRules.js exactly, so the frontend's own copies of these
// vocabularies can never drift from what the API actually accepts/returns.

export type CrmRole = "md" | "admin" | "sales" | "technical";

export type CrmStage = "new" | "contacted" | "qualified" | "site_survey" | "proposal_sent" | "negotiation" | "won" | "lost";

export const CRM_STAGES: CrmStage[] = ["new", "contacted", "qualified", "site_survey", "proposal_sent", "negotiation", "won", "lost"];

export type CrmSegment = "villa" | "compound" | "farm" | "oil_gas" | "factory" | "services" | "other" | "unknown";

export const CRM_SEGMENTS: CrmSegment[] = ["villa", "compound", "farm", "oil_gas", "factory", "services", "other", "unknown"];

// The seven segments offered on the lead FORM (acceptance report finding 4) - 'unknown' stays a
// valid, displayable value on a lead nobody has classified yet, but is never something a person
// actively picks from a dropdown.
export const CRM_FORM_SEGMENTS: CrmSegment[] = ["villa", "compound", "farm", "oil_gas", "factory", "services", "other"];

// Fixed marketing-source list (acceptance report finding 4) - mirrors
// backend/server/utils/crm/constants.js's SOURCES exactly. The Lead.source field itself stays
// free text server-side (so historical values never break), but every NEW/edited lead from the
// CRM's own "New Lead" form is constrained to this list.
export const CRM_SOURCES = ["Google Ads", "Meta Ads", "Organic", "Referral", "WhatsApp Direct", "Other"] as const;
export type CrmSource = (typeof CRM_SOURCES)[number];

// The 27 official Egyptian governorates (acceptance report finding 4), English + Arabic - mirrors
// backend/server/utils/crm/constants.js's GOVERNORATES exactly.
export const CRM_GOVERNORATES: { en: string; ar: string }[] = [
  { en: "Cairo", ar: "القاهرة" },
  { en: "Giza", ar: "الجيزة" },
  { en: "Alexandria", ar: "الإسكندرية" },
  { en: "Dakahlia", ar: "الدقهلية" },
  { en: "Red Sea", ar: "البحر الأحمر" },
  { en: "Beheira", ar: "البحيرة" },
  { en: "Fayoum", ar: "الفيوم" },
  { en: "Gharbia", ar: "الغربية" },
  { en: "Ismailia", ar: "الإسماعيلية" },
  { en: "Menoufia", ar: "المنوفية" },
  { en: "Minya", ar: "المنيا" },
  { en: "Qalyubia", ar: "القليوبية" },
  { en: "New Valley", ar: "الوادي الجديد" },
  { en: "Suez", ar: "السويس" },
  { en: "Aswan", ar: "أسوان" },
  { en: "Assiut", ar: "أسيوط" },
  { en: "Beni Suef", ar: "بني سويف" },
  { en: "Port Said", ar: "بورسعيد" },
  { en: "Damietta", ar: "دمياط" },
  { en: "Sharqia", ar: "الشرقية" },
  { en: "South Sinai", ar: "جنوب سيناء" },
  { en: "Kafr El Sheikh", ar: "كفر الشيخ" },
  { en: "Matrouh", ar: "مطروح" },
  { en: "Luxor", ar: "الأقصر" },
  { en: "Qena", ar: "قنا" },
  { en: "North Sinai", ar: "شمال سيناء" },
  { en: "Sohag", ar: "سوهاج" },
];

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
  // Soft-delete (acceptance report finding 7) - MD only, see leads/[id]/index.tsx's archive action.
  archived: boolean;
  archivedAt: string | null;
  archivedBy: { _id: string; name: string } | null;
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

export type CrmPipelineRow = { stage: CrmStage; count: number; valueEgp: number; weightedValueEgp: number };
