import { ApprovalStage, ApprovalStageKey } from "@/types/commercial";

/**
 * The approval stages, with the PRODUCTION role routing of Developer Brief 4.1 (QA U6) - mirrors
 * backend services/commercial/approvalService.js#STAGE_ROLES. Used by BOTH the Overview and the
 * Approvals tab so the two can never show different vocabularies again (QA U5). The backend
 * enforces the same rules; this list only decides which buttons to show.
 */
/**
 * The 3-stage workflow (26 Nov 2026) - mirrors backend approvalService.js#STAGE_ROLES_V2. Stage 3 is
 * stored in the revision's `md` field. Labels only; who may act is decided by the server.
 */
export const STAGE_META_V2: { key: ApprovalStageKey; title: { en: string; ar: string }; who: { en: string; ar: string } }[] = [
  { key: "stage1", title: { en: "Stage 1: Technical Approval", ar: "المرحلة 1: الموافقة الفنية" }, who: { en: "Technical", ar: "الفني" } },
  { key: "stage2", title: { en: "Stage 2: Sales / BDM Approval", ar: "المرحلة 2: موافقة المبيعات / تطوير الأعمال" }, who: { en: "Sales or BDM", ar: "المبيعات أو تطوير الأعمال" } },
  { key: "md", title: { en: "Stage 3: Final Commercial Approval", ar: "المرحلة 3: الاعتماد التجاري النهائي" }, who: { en: "Sales & Commercial Director or MD", ar: "المدير التجاري أو المدير العام" } },
];

/** The earlier (workflow 1) stages - for revisions priced before the 3-stage workflow. */
export const STAGE_META: { key: ApprovalStageKey; apiStage: string; roles: string[]; title: { en: string; ar: string }; who: { en: string; ar: string } }[] = [
  {
    key: "stage1",
    apiStage: "stage1",
    // Go-live Developer Pack 5.4/5.8: BDM may also sign Stage 1, alongside Sales/Technical -
    // mirrors backend services/commercial/approvalService.js#STAGE_ROLES.STAGE1 exactly. A Sales
    // Engineer may only sign a deal they own (enforced server-side; not re-derived here).
    roles: ["sales", "technical", "bdm"],
    title: { en: "Stage 1: Gross Profit & Technical Scope", ar: "المرحلة 1: الربح الإجمالي والنطاق الفني" },
    who: { en: "Sales, Technical & BDM", ar: "المبيعات والفني ومدير تطوير الأعمال" },
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
  return status === "Approved" ? "teal" : status === "Rejected" ? "red" : status === "Requires Reapproval" ? "orange" : "gray";
}

/** "Requires Reapproval" for a stage reset by a change after it was approved. */
export function displayStatus(stage: ApprovalStage): string {
  return stage.status === "Pending" && stage.requiresReapproval ? "Requires Reapproval" : stage.status;
}
