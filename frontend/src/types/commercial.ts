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

export type ApprovalStage = {
  status: ApprovalStatus;
  // populated by the API ({_id, name}); older payloads may carry only the id
  approver: { _id: string; name: string } | string | null;
  approverName?: string | null;
  approverRole?: string | null;
  decidedAt: string | null;
  note: string;
};

/** The 8 Egyptian Rates matrix regions (QA B2) - mirrors backend utils/commercial/regions.js. */
export const EGYPT_REGIONS = [
  "Cairo - 10th of Ramadan",
  "Sharqia - Ismailia",
  "Banha - Tanta - Menoufia",
  "Damanhour - Kafr El Sheikh - Mansoura",
  "Fayoum - Beni Suef",
  "Minya - Sohag - Assiut",
  "Qena - Luxor - Aswan",
  "Kharga - Dakhla - Farafra Oases",
] as const;
export const REGION_REQUIRED_COUNTRIES = ["Egypt"];
export const COMMERCIAL_COUNTRIES = ["Egypt", "Saudi Arabia", "United Arab Emirates", "South Africa", "Europe", "Other Country"];

export type PricingLevers = {
  overheadPct: number;
  contingencyPct: number;
  profitPct: number;
  salesBonusPct: number;
  engineeringIncentivePct: number;
  categoryAdditionPct: number;
  discountPct: number;
};

export type PricingConfig = {
  _id: string;
  version: number;
  levers: PricingLevers;
  vatPctByCountry: Record<string, number>;
  categoryOverrides: Partial<Record<CommercialCategory, Partial<PricingLevers>>>;
  discountAuthorityPct: number;
  note: string;
  updatedByName: string | null;
  updatedAt: string;
  canManage?: boolean;
  engine?: DealEngineSettings;
  proposal?: Record<string, unknown>;
};

// Deal Engine settings (backend services/commercial/dealEngineSettings.js ENGINE_DEFAULTS).
export type DealEngineSettings = {
  mc4: { rule: "strings" | "modulePairs"; unitPriceEgp: number };
  accessoriesRateEgpPerKwp: number | null;
  dcAcRatio: { min: number; max: number; flagBelow: number; flagAbove: number };
  yield: { defaultKwhPerKwp: number; byRegion: Record<string, number>; basis: string };
  discountRate: number;
  inverterReplacementYear: number;
  twoPhaseEscalation: { first: number; years: number; then: number };
};

export type PricingConfigApplied = {
  configVersion: number | null;
  appliedAt: string | null;
  source: "config" | "revision" | "legacy" | null;
  levers: PricingLevers | null;
  vatPct: number | null;
  discountAuthorityPct: number | null;
};

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
  poolAmt?: number | null;
  basePrice?: number | null;
  netExclVat: number | null;
  vatPct: number; vatAmt: number | null;
  grossInclVat: number | null;
  perKwpExclVat: number | null;
  perKwpInclVat?: number | null;
  designKwp?: number | null;
  grossProfit: number | null;
  grossProfitPct: number | null;
  operatingProfit?: number | null;
  operatingProfitPct?: number | null;
  discountAboveAuthority?: boolean;
};

export type CommercialRevision = {
  _id: string;
  project: string;
  revisionNumber: number;
  isCurrent: boolean;
  engineeringInput: Record<string, unknown>;
  engineeringResult: Record<string, unknown>;
  // Deal Engine C11 / C24.
  ruleVersion?: string | null;
  engineSettingsApplied?: Record<string, unknown> | null;
  priceChangedSinceCalculation?: boolean;
  priceChangedItems?: string[];
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
  status?: "Calculated" | "Draft";
  invalidatedAt?: string | null;
  invalidationReason?: string | null;
  pricingConfigApplied?: PricingConfigApplied;
  waitingOn?: string | null;
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
  tariffBand?: string | null;
  voltageLevel?: "LV" | "MV" | "HV" | null;
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
  dealNumber?: string | null;
  proposalNumber?: string | null;
  proposedErpProjectNumber?: string | null;
  erpProject?: string | null;
  erpProjectNumber?: string | null;
  crmLead?: string | null;
  crmLeadRef?: string | null;
  crmSync?: { status: "synced" | "failed" | null; lastEvent: string | null; lastSyncAt: string | null; lastError: string | null } | null;
  estimatedValueEgp?: number | null;
  estimatedKwp?: number | null;
  leadSource?: string | null;
  leadCampaign?: string | null;
  regionNote?: string | null;
  outcome?: "Open" | "Won" | "Lost";
  outcomeAt?: string | null;
  lostReason?: string | null;
  wonValueEgp?: number | null;
  erpBudget?: { lines: { costCode: string; line: string; budgetEgp: number }[]; totalBudgetEgp: number; check: number; capturedAt: string } | null;
  editHistory?: { at: string; byName: string | null; changes: { field: string; from: unknown; to: unknown }[]; revisionReset: boolean }[];
};

export type CommercialSyncEvent = {
  _id: string;
  event: "proposal" | "won" | "lost" | "reopen";
  status: "synced" | "failed" | "skipped";
  replay: boolean;
  trigger: string;
  error: string | null;
  identifiers: { dealNumber: string | null; projectCode: string | null; proposalNumber: string | null; proposedErpProjectNumber: string | null };
  actor: { _id: string; name: string } | null;
  createdAt: string;
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
