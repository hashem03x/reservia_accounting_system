import type { DocumentPaymentTerms, PaymentSchedule } from "@/utils/helpers/document-payment-terms";
export type ProjectStatus = "active" | "completed" | "cancelled" | "on_hold";

export interface ProjectContract {
  url: string;
  publicId: string;
  filename?: string;
  mimeType?: string;
  uploadedAt: string;
  uploadedBy?: { _id: string; name: string };
}

export interface Project {
  _id: string;
  projectNumber: string;
  name?: string;
  description?: string;
  // Required at the API/schema level for any project created through the current app - but marked
  // optional here on purpose: a project created before the projectAmount->contractValue /
  // executor->projectManager rename, and not yet run through
  // backend/server/scripts/migrateProjectFieldRenames.js, genuinely comes back from the API without
  // these fields (Mongoose only ever exposes schema-defined paths, so an old document's
  // still-present-in-MongoDB `projectAmount` simply isn't reachable as `contractValue`). Typing
  // these as required hid that reality and let `.toLocaleString()`/`.name` be called on `undefined`
  // - every read site must now handle the missing case explicitly (see projects/index.tsx and
  // projects/[id]/index.tsx for the pattern), which is what TypeScript's `strict` mode is for.
  contractValue?: number;
  // Customer payment terms of the project (tenor from the start date) and the schedule derived from
  // the current contract value - see backend utils/documentPaymentTerms.js. null = not set.
  customerPaymentTerms?: DocumentPaymentTerms | null;
  customerPaymentSchedule?: PaymentSchedule | null;
  // The project BOQ: per product its contract quantity and BOQ unit price (revenue-side price).
  boqLines?: { _id: string; product: { _id: string; title: { en: string; ar: string }; model?: string } | null; quantity: number; unit?: string | null; unitPrice: number; currency: string }[];
  // Both computed by the backend from contractValue and executedPercentage (one calculation,
  // backend/server/utils/projectExecution.js): executedAmount = contractValue × executedPercentage
  // / 100, remainingMoney = contractValue − executedAmount. Absent when the project has no
  // contractValue - display only, never recalculated here.
  remainingMoney?: number;
  executedAmount?: number;
  // An admin-managed Project Manager (Admin -> Project Managers).
  projectManager?: { _id: string; name: string; email?: string | null; phone?: string | null; isActive?: boolean } | null;
  startDate?: string;
  deliveryDate?: string;
  // The NAME of an admin-managed Sector (Admin -> Sectors) - may be an inactive sector.
  sector?: string | null;
  status: ProjectStatus;
  // A real reference into the existing customer (User, role: 'user') collection - never a
  // duplicated plain-text name. Null for projects with no linked customer (e.g. imported records).
  customer?: { _id: string; name: string; email?: string; phone?: string; customerNumber?: number } | null;
  // Average Cost (see docs section "Project - Average Cost") - each line references a real
  // ChartOfAccount (always a `cogs`-type account), never just an account name. `averageCost` is
  // always derived from these lines server-side, never independently editable.
  averageCostLines?: AverageCostLine[];
  averageCost?: number;
  // نسبة المنفذ - how much of the project has been executed (0-100), always server-derived as
  // Σ(this project's Sales Order amounts before tax) / contractValue × 100 - never client-settable
  // (see backend/server/services/project/projectAccountingService.js#recalculateExecutedPercentage).
  executedPercentage?: number;
  contract?: ProjectContract | null;
  createdBy?: { _id: string; name: string };
  createdAt: string;
  updatedAt: string;
  // Won to ERP Handover (19 Nov 2026), W8: the deal identifier chain - present only on a project
  // created automatically from a Won Deal Engine deal, shown ALONGSIDE projectNumber above, never
  // replacing it. Absent on every project created the normal way.
  dealNumber?: string | null;
  proposalNumber?: string | null;
  crmLeadNumber?: string | null;
  dealProjectNumber?: string | null;
  // W12: non-null only when the automatic handover's cost mapping didn't balance to the contract
  // value - the project is created as `on_hold` in that case and this explains why.
  budgetCheck?: {
    balanced: boolean;
    difference: number | null;
    details?: { contractValue: number; totalAverageCost: number; profit: number; categoryAddition: number; discount: number } | null;
  } | null;
}

export interface AverageCostLine {
  // Nullable: populate resolves a reference to a since-removed account to null.
  account: { _id: string; code: string; name: string; nameAr?: string | null; type: string } | null;
  amount: number;
}

// Shape sent to the API when creating/editing a project's Average Cost lines - `account` is just
// the id string here (not the populated object above).
export interface AverageCostLineInput {
  account: string;
  amount: number | string;
}
