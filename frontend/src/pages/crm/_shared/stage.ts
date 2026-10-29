import { CrmStage } from "@/types/crm";

// Shared stage display helpers for every Reservia CRM page (pipeline board, leads list, lead
// detail) - one place so a stage's label/color can never drift between pages.

const LABELS: Record<CrmStage, { en: string; ar: string }> = {
  new: { en: "New", ar: "جديد" },
  contacted: { en: "Contacted", ar: "تم التواصل" },
  qualified: { en: "Qualified", ar: "مؤهل" },
  site_survey: { en: "Site survey", ar: "مسح الموقع" },
  proposal_sent: { en: "Proposal sent", ar: "تم إرسال العرض" },
  negotiation: { en: "Negotiation", ar: "تفاوض" },
  won: { en: "Won", ar: "تم الفوز" },
  lost: { en: "Lost", ar: "خسارة" },
};

export const crmStageLabel = (translate: (en: string, ar: string) => string) => (stage: CrmStage) =>
  translate(LABELS[stage].en, LABELS[stage].ar);

const COLORS: Record<CrmStage, string> = {
  new: "gray",
  contacted: "blue",
  qualified: "indigo",
  site_survey: "cyan",
  proposal_sent: "yellow",
  negotiation: "orange",
  won: "teal",
  lost: "red",
};

export const stageBadgeColor = (stage: CrmStage) => COLORS[stage];
