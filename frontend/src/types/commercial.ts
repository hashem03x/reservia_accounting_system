// Reservia Commercial - mirrors backend/server/utils/commercial/constants.js exactly, so the
// frontend's own copies of these vocabularies can never drift from what the API actually
// accepts/returns (same convention as types/crm.ts).

export type CommercialRole = "md" | "commercial_director" | "sales" | "technical" | "member";

export type CommercialCategory = "On-Grid C&I" | "Off-Grid" | "Agriculture Pumping" | "Utility Scale" | "Street Lighting" | "Solar Water Heating";
export const COMMERCIAL_CATEGORIES: CommercialCategory[] = ["On-Grid C&I", "Off-Grid", "Agriculture Pumping", "Utility Scale", "Street Lighting", "Solar Water Heating"];

// Only these 4 categories have a complete engineering/BOQ model in the source workbooks
// (backend/server/services/commercial/boqService.js) - Street Lighting/Solar Water Heating are
// selectable (the Price Book has placeholder entries for them) but have no sizing formula, so the
// UI must say so rather than pretending a calculation ran.
export const CATEGORIES_WITH_ENGINE: CommercialCategory[] = ["On-Grid C&I", "Off-Grid", "Agriculture Pumping", "Utility Scale"];

export type CommercialScope = "Supply & Installation" | "Supply Only" | "Installation Only";
export const COMMERCIAL_SCOPES: CommercialScope[] = ["Supply & Installation", "Supply Only", "Installation Only"];

export type ApprovalStatus = "Pending" | "Approved" | "Rejected";
export type ApprovalStageKey = "stage1" | "stage2" | "md";

export type ApprovalStage = { status: ApprovalStatus; approver: { _id: string; name: string } | null; decidedAt: string | null; note: string };

export type BoqLine = {
  lineNo: number | string;
  component: string;
  description: string;
  materialItemKey: string | null;
  unit: string;
  qty: number | null;
  unitPrice: number | null;
  total: number | null;
  costGroup: string;
  source: "auto" | "manual" | "override";
  autoQty: number | null;
  autoUnitPrice: number | null;
  flag: string | null;
  notes: string;
};

export type CommercialPricing = {
  cogs: number | null;
  overheadPct: number; overheadAmt: number;
  contingencyPct: number; contingencyAmt: number;
  profitPct: number; profitAmt: number;
  salesBonusPct: number; salesBonusAmt: number;
  engineeringIncentivePct: number; engineeringIncentiveAmt: number;
  categoryAdditionPct: number; categoryAdditionAmt: number;
  discountPct: number; discountAmt: number;
  netExclVat: number | null;
  vatPct: number; vatAmt: number | null;
  grossInclVat: number | null;
  perKwpExclVat: number | null;
  grossProfit: number | null;
  grossProfitPct: number | null;
};

export type CommercialRevision = {
  _id: string;
  project: string;
  revisionNumber: number;
  isCurrent: boolean;
  engineeringInput: Record<string, unknown>;
  engineeringResult: Record<string, unknown>;
  boqLines: BoqLine[];
  boqTotal: number | null;
  pricing: CommercialPricing;
  feasibility: Record<string, unknown> | null;
  dieselComparison: Record<string, unknown> | null;
  stage1: ApprovalStage;
  stage2: ApprovalStage;
  md: ApprovalStage;
  mdRequired: boolean;
  releaseStatus: "NOT RELEASED" | "APPROVED FOR ISSUE";
  createdAt: string;
  updatedAt: string;
};

export type CommercialProject = {
  _id: string;
  projectCode: string;
  name: string;
  customer: { _id: string; name: string; email?: string; phone?: string; customerNumber?: string };
  country: string;
  region: string | null;
  category: CommercialCategory;
  subCategory: string | null;
  currency: string;
  fxRate: number | null;
  scope: CommercialScope;
  currentRevision: CommercialRevision | string | null;
  engineeringApprovalRollup: "PENDING" | "APPROVED";
  commercialApprovalRollup: "PENDING" | "APPROVED";
  archived: boolean;
  createdBy: { _id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type MaterialItem = {
  _id: string;
  category: string;
  brand: string;
  model: string;
  spec: string;
  unit: string;
  n1: number | null;
  n2: number | null;
  attrs: Record<string, unknown>;
  unitPrice: number;
  currency: string;
  countryStock: string;
  status: "Available" | "PLACEHOLDER" | "Discontinued";
  sourceWorkbook: string;
  sourceSheet: string;
  effectiveDate: string;
  key: string;
  archived: boolean;
};

export type CommercialDashboard = {
  totalProjects: number;
  draftProjects: number;
  pendingEngineeringApproval: number;
  pendingCommercialApproval: number;
  approvedProjects: number;
  totalEstimatedProjectValue: number;
  totalEstimatedMaterialCost: number;
  expectedGrossProfit: number;
  averageMarginPct: number | null;
  projectsByCategory: { category: string; count: number }[];
  recentProjects: { _id: string; projectCode: string; name: string; category: string; createdAt: string; updatedAt: string }[];
};
