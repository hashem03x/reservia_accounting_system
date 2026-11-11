import { ApprovalStage, ApprovalStageKey } from "@/types/commercial";

/**
 * The approval stages, with the PRODUCTION role routing of Developer Brief 4.1 (QA U6) - mirrors
 * backend services/commercial/approvalService.js#STAGE_ROLES. Used by BOTH the Overview and the
 * Approvals tab so the two can never show different vocabularies again (QA U5). The backend
 * enforces the same rules; this list only decides which buttons to show.
 */
export const STAGE_META: { key: ApprovalStageKey; apiStage: string; roles: string[]; title: { en: string; ar: string }; who: { en: string; ar: string } }[] = [
  {
    key: "stage1",
    apiStage: "stage1",
    roles: ["sales", "technical"],
    title: { en: "Stage 1: Gross Profit & Technical Scope", ar: "المرحلة 1: الربح الإجمالي والنطاق الفني" },
    who: { en: "Sales & Technical", ar: "المبيعات والفني" },
  },
  {
    key: "stage2",
    apiStage: "stage2",
    roles: ["commercial_director"],
    title: { en: "Stage 2: Allocations", ar: "المرحلة 2: التخصيصات" },
    who: { en: "Sales & Commercial Director", ar: "مدير المبيعات والتجاري" },
  },
  {
    key: "md",
    apiStage: "md",
    roles: ["md"],
    title: { en: "MD Sign-off", ar: "موافقة المدير العام" },
    who: { en: "Managing Director", ar: "المدير العام" },
  },
];

/** The signer's name: the denormalized name recorded at sign-off, else the populated user. */
export function approverName(stage: ApprovalStage): string | null {
  if (stage.approverName) return stage.approverName;
  if (stage.approver && typeof stage.approver === "object" && "name" in stage.approver) return stage.approver.name;
  return null;
}

export function statusColor(status: string) {
  return status === "Approved" ? "teal" : status === "Rejected" ? "red" : "gray";
}
