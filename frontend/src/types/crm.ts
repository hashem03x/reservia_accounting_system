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

// Fixed marketing-source list (acceptance report finding 4; extended by Change Request 1, Feature
// 4: adds TikTok and splits Direct out of Organic) - mirrors backend/server/utils/crm/constants.js's
// SOURCES exactly. The Lead.source field itself stays free text server-side (so historical values
// never break), but every NEW/edited lead from the CRM's own "New Lead" form is constrained to
// this list.
export const CRM_SOURCES = ["Google Ads", "Meta Ads", "TikTok", "Organic", "Direct", "Referral", "WhatsApp Direct", "Other"] as const;
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
  | "landing_page"
  // Change Request 2: an ad platform's own lead form (Meta / TikTok / Google Ads).
  | "ad_lead_form";

export const CRM_CHANNELS: CrmChannel[] = ["phone", "walk_in", "dealer", "referral", "event", "outreach", "email", "whatsapp", "web_form", "landing_page", "ad_lead_form"];

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
  email?: string | null;
  // Change Request 2, item 2: a CALENDAR DATE "YYYY-MM-DD" - never parse it with new Date();
  // always format it with pages/crm/_shared/business-date.ts#formatFollowUpDate.
  followUpAt: string | null;
  stage: CrmStage;
  stageChangedAt: string;
  lostReason: string | null;
  mdApproved: boolean;
  replyDueAt: string;
  firstReplyAt: string | null;
  // Change Request 2, item 3: which qualifying event set firstReplyAt.
  firstReplyVia?: "stage_change" | "call" | "whatsapp_out" | "email" | null;
  // Change Request 2, item 12: when the customer originally submitted the enquiry.
  submittedAt?: string | null;
  createdBy: { _id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  // Soft-delete (acceptance report finding 7) - MD only, see leads/[id]/index.tsx's archive action.
  archived: boolean;
  archivedAt: string | null;
  archivedBy: { _id: string; name: string } | null;
  archiveReason: string | null;
  // First-touch attribution (Change Request 1, Feature 1) - displayed on the lead detail page.
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm?: string | null;
  campaign?: string | null;
  adSetName?: string | null;
  adName?: string | null;
  adFormId?: string | null;
  adPlatform?: string | null;
  externalLeadId?: string | null;
  landingPage: string | null;
};

// GET /crm/leads/:id - the lead's own first-reply figures (services/crm/firstReplyService.js).
export type CrmLeadFirstReply = {
  originAt: string;
  at: string | null;
  via: CrmLead["firstReplyVia"];
  workingHours: number | null;
  withinSla: boolean | null;
  slaWorkingHours: number;
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
  // Change Request 2, item 1: an MD override of a stage rule.
  override?: boolean;
  overrideReason?: string | null;
  overriddenRules?: string[];
  createdAt: string;
};

// probability: the configured stage probability (0-1) the weighted value was computed with;
// null for won/lost (not a forecast). Single source of truth: the API, never a frontend copy.
export type CrmPipelineRow = { stage: CrmStage; count: number; valueEgp: number; weightedValueEgp: number | null; probability?: number | null };

// ===================== Dashboard (acceptance report section 4) =====================
// Mirrors backend/server/services/crm/reportService.js's getDashboard() payload exactly.

export type CrmTargetMetric = { actual: number; target: number | null };
export type CrmDashboardTargets = {
  enquiries: CrmTargetMetric;
  qualified: CrmTargetMetric;
  surveys: CrmTargetMetric;
  proposals: CrmTargetMetric;
  signed: CrmTargetMetric;
  valueEgp: { target: number | null };
  targetSet: boolean;
};
export type CrmDashboardPipeline = {
  stages: CrmPipelineRow[];
  // Change Request 2, item 4: BOTH figures - the full open value and the probability-weighted one.
  totalValueEgp: number;
  totalWeightedValueEgp: number;
  openLeadCount: number;
  probabilities: { stage: CrmStage; probability: number | null }[];
  unconfiguredStages: CrmStage[];
};
export type CrmFirstReplyMetrics = {
  avgHours: number | null;
  medianHours: number | null;
  pctWithinSla: number | null;
  repliedCount: number;
  withinSlaCount: number;
  overdueUnrepliedCount: number;
  pendingCount: number;
  sampleSize: number;
  slaSampleSize: number;
  slaWorkingHours: number;
};
export type CrmDashboardSpeed = {
  leadsPastSlaLimit: number;
  leadsWithNoFollowUpDate: number;
  avgHoursToFirstReply: number | null;
  pctWithinSla: number | null;
  firstReply: CrmFirstReplyMetrics;
};
// Change Request 1, Feature 5C: regrouped from marketing SOURCE to SEGMENT, since ad spend is now
// entered per free-text channel with an optional segment tag (not per ad-platform source) - see
// backend/server/services/crm/reportService.js#getSegmentQualityBlock.
export type CrmSegmentQualityRow = {
  segment: CrmSegment;
  leads: number;
  qualified: number;
  signed: number;
  monthlySpendEgp: number | null;
  plannedSpendEgp: number | null;
  actualSpendEgp: number | null;
  spendBasis: CrmSpendBasis | null;
  costPerQualifiedLead: number | null;
  costPerEnquiry: number | null;
  overCostLimit: boolean;
};
// Which spend figure cost-per-lead was computed from: the actual amount when entered, else the plan.
export type CrmSpendBasis = "planned" | "actual" | "mixed";
export type CrmSpendTotals = {
  plannedSpendEgp: number | null;
  actualSpendEgp: number | null;
  effectiveSpendEgp: number | null;
  basis: CrmSpendBasis | null;
  lineCount: number;
  enquiries: number;
  qualified: number;
  costPerEnquiry: number | null;
  costPerQualifiedLead: number | null;
};
export type CrmDashboardSegmentQuality = { segments: CrmSegmentQualityRow[]; totals: CrmSpendTotals; costPerQualifiedLeadLimitEgp: number };
export type CrmSegmentRateRow = { segment: CrmSegment; won: number; lost: number; winRatePct: number | null };
export type CrmLostReasonRow = { reason: string; count: number };
export type CrmDashboardWonLost = {
  winRateBySegment: CrmSegmentRateRow[];
  medianDaysToClose: number | null;
  lostReasonsRanked: CrmLostReasonRow[];
  wonCount: number;
  lostCount: number;
};
export type CrmUnansweredLead = { _id: string; refCode: string; name: string | null; phoneE164: string; stage: CrmStage; createdAt: string };
export type CrmDashboardThisWeek = { newLeads: number; moves: number; oldestUnanswered: CrmUnansweredLead[] };
// Change Request 1, Feature 3: present only when the Dashboard is showing a single-owner view
// (a sales user's own scope, or an MD drilling into one person) - the SAME org-wide totals the
// Pipeline board shows, so the two screens reconcile instead of silently disagreeing. Deliberately
// aggregate-only (no individual leads listed) - see reportService.js#getTeamTotals.
export type CrmTeamTotals = {
  enquiries: number;
  qualified: number;
  surveys: number;
  proposals: number;
  signed: number;
  unassignedEnquiries: number;
  totalValueEgp: number;
  totalWeightedValueEgp: number;
  wonCount: number;
  lostCount: number;
};
export type CrmDashboard = {
  year: number;
  month: number;
  owner: string | null;
  targets: CrmDashboardTargets;
  pipeline: CrmDashboardPipeline;
  speed: CrmDashboardSpeed;
  segmentQuality: CrmDashboardSegmentQuality;
  wonLost: CrmDashboardWonLost;
  thisWeek: CrmDashboardThisWeek;
  team: CrmTeamTotals | null;
};

// ===================== Performance tab (acceptance report section 5) =====================
// Mirrors backend/server/services/crm/performanceReportService.js's getPerformance() payload.

export type CrmSegmentSample = { segment: CrmSegment; avgDays: number | null; sampleSize: number };
export type CrmDaysInStageRow = { stage: CrmStage; avgDays: number | null; medianDays: number | null; sampleSize: number; bySegment: CrmSegmentSample[] };
export type CrmHoursToFirstReply = {
  avgHours: number | null;
  medianHours: number | null;
  pctWithin8h: number | null;
  sampleSize: number;
  slaSampleSize?: number;
  withinSlaCount?: number;
  overdueUnrepliedCount?: number;
  pendingCount?: number;
};
export type CrmDaysMetric = { avgDays: number | null; medianDays: number | null; sampleSize: number; bySegment: CrmSegmentSample[] };
export type CrmStuckLead = { leadId: string; stage: CrmStage; days: number; medianDaysForStage: number };
export type CrmPerfSpeed = {
  daysInStage: CrmDaysInStageRow[];
  hoursToFirstReply: CrmHoursToFirstReply;
  daysToQuote: CrmDaysMetric;
  daysToClose: CrmDaysMetric;
  stuckLeads: CrmStuckLead[];
};

export type CrmFunnelStageRow = { stage: CrmStage; count: number; pctFromPreviousStage: number | null };
export type CrmUnavailable = { available: false; reason?: string };
export type CrmPerfConversion = {
  funnel: CrmFunnelStageRow[];
  winRateBySegment: (CrmSegmentRateRow & { sampleSize: number })[];
  winRateBySource: { source: string; won: number; lost: number; sampleSize: number; winRatePct: number | null }[];
  winRateByOwner: { owner: string; won: number; lost: number; sampleSize: number; winRatePct: number | null }[];
  lossRatePct: number | null;
  lostReasonsRanked: CrmLostReasonRow[];
  lostByStageChart: { stage: string; count: number }[];
  quoteToWin: CrmUnavailable;
  leadToSigned: { signed: number; enquiries: number; pct: number | null };
};
export type CrmDealSizeRow = { segment: CrmSegment; avgDealSizeEgp: number | null; sampleSize: number };
export type CrmPipelineCoverage = { weightedPipelineEgp: number; remainingTargetEgp: number | null; ratio: number | null; belowOne: boolean };
export type CrmPerfValueCost = {
  averageDealSizeBySegment: CrmDealSizeRow[];
  averageDiscount: CrmUnavailable;
  pipelineCoverage: CrmPipelineCoverage;
  costPerQualifiedLeadEgp: number | null;
  costPerSignedDealEgp: number | null;
};
export type CrmPerformance = {
  year: number;
  month: number;
  owner: string | null;
  segment: string | null;
  speed: CrmPerfSpeed;
  conversion: CrmPerfConversion;
  valueCost: CrmPerfValueCost;
};

// Change Request 1, Feature 5A: keyed by (segment, month), not (owner, month) - 'all' is itself a
// selectable segment value, the single company-wide target entered when a month isn't broken
// down per segment (matches the client's own "All segments: Enquiries 24..." seed data).
export type CrmTargetSegment = CrmSegment | "all";
export const CRM_TARGET_SEGMENTS: CrmTargetSegment[] = ["all", ...CRM_FORM_SEGMENTS];

export type CrmTarget = {
  _id: string;
  segment: CrmTargetSegment;
  year: number;
  month: number;
  targetValueEgp: number | null;
  targetDealCount: number | null;
  targetEnquiries: number | null;
  targetQualified: number | null;
  targetSurveys: number | null;
  targetProposals: number | null;
  targetSigned: number | null;
};

// Change Request 1, Feature 5B: `channel` is a free-text, MD-authored budget-line name (e.g.
// "Farm test", "Farms", "Villas", "Compounds", "SEO") - no longer constrained to CRM_SOURCES,
// since real ad-platform sources don't match the client's own segment-shaped budget line items.
// `segment` is an optional tag used only to roll spend up into a segment's cost-per-lead figures;
// a channel with no segment (SEO, agency fees, ...) still counts toward total spend but is
// excluded from any one segment's math.
// amountEgp = PLANNED budget; actualAmountEgp = actual spend once known (Change Request 2, item 5).
export type CrmAdSpendRow = { _id: string; channel: string; segment: CrmSegment | null; year: number; month: number; amountEgp: number; actualAmountEgp?: number | null };

// ===================== Integrations (Change Request 2, section 4) =====================

export type CrmIntegrationChannel = "website" | "whatsapp" | "meta" | "tiktok" | "google_ads";
export type CrmIntegrationState = "not_configured" | "awaiting_first_event" | "receiving" | "errors";
export type CrmIntegrationStatusRow = {
  channel: CrmIntegrationChannel | "csv";
  label: string;
  source: string | null;
  activeKeys: number;
  settings: { name: string; set: boolean }[];
  lastProcessedAt: string | null;
  last7Days: { processed: number; failed: number; ignored: number };
  state: CrmIntegrationState;
};
export type CrmIntegrationStatus = {
  channels: CrmIntegrationStatusRow[];
  assignmentPoolSize: number;
  endpoints: Record<string, string>;
};
export type CrmIntegrationKey = {
  _id: string;
  channel: CrmIntegrationChannel;
  label: string;
  keyId: string;
  hint: string;
  active: boolean;
  createdBy: { _id: string; name: string } | null;
  revokedAt: string | null;
  revokedBy: { _id: string; name: string } | null;
  lastUsedAt: string | null;
  createdAt: string;
};
export type CrmIntakeEvent = {
  _id: string;
  channel: string;
  externalId: string;
  status: "processing" | "processed" | "failed" | "ignored";
  lead: { _id: string; refCode: string } | null;
  leadCreated: boolean;
  attempts: number;
  lastError: string | null;
  ignoredReason: string | null;
  createdAt: string;
  processedAt: string | null;
};
