// Responses of backend services/inventory/pucMaterialBalanceService.js (GET puc-transfers/balances
// and GET puc-transfers/project/:id/materials). Amounts are EGP.

export interface MaterialProductSummary {
  _id: string;
  title: { en: string; ar: string };
  category?: string | null;
  subcategory?: string | null;
  brand?: string | null;
  model?: string | null;
  specifications?: string | null;
  sku?: string | null;
}

export interface MaterialBalance {
  openingQuantity: number;
  openingValue: number;
  purchasedQuantity: number;
  purchasedValue: number;
  transferredInQuantity: number;
  transferredInValue: number;
  transferredOutQuantity: number;
  transferredOutValue: number;
  returnedQuantity: number;
  returnedValue: number;
  // Consumed by a Sales Order (quantity/value actually sold from this project's PUC), and the
  // portion a sales RETURN released back - see services/inventory/pucSalesConsumptionService.js.
  consumedQuantity: number;
  consumedValue: number;
  consumedReturnQuantity: number;
  consumedReturnValue: number;
  closingQuantity: number;
  closingValue: number;
  averageUnitCost: number | null;
}

export interface PucLedger {
  opening: number;
  debit: number;
  credit: number;
  closing: number;
}

export interface PucBalanceRow extends MaterialBalance {
  project: { _id: string; projectNumber: string | null; name: string | null };
  product: MaterialProductSummary | null;
  warehouses: string[];
}

export interface PucBalancesResult {
  account: { _id: string; code: string; name: string; nameAr?: string | null } | null;
  dataQuality: { ledgerLinesWithoutProject: number; ledgerAmountWithoutProject: number; sampleEntryNumbers: number[]; allocationsWithMissingProject: number };
  rows: PucBalanceRow[];
  projects: {
    project: PucBalanceRow["project"];
    materials: number;
    openingValue: number;
    purchasedQuantity: number;
    consumedQuantity: number;
    consumedValue: number;
    closingValue: number;
    closingQuantity: number;
    ledger: PucLedger;
    differenceToLedger: number | null;
  }[];
  totals: {
    openingValue: number;
    purchasedQuantity: number;
    purchasedValue: number;
    transferredInValue: number;
    transferredOutValue: number;
    returnedValue: number;
    consumedQuantity: number;
    consumedValue: number;
    closingQuantity: number;
    closingValue: number;
    ledgerClosing: number;
  };
}

export interface MaterialSource {
  kind: "purchase" | "transfer_in" | "transfer_out" | "return";
  date: string;
  quantity: number;
  unitCost: number;
  amount: number;
  invoice: { _id: string; code: string; vendor: { _id: string; name: string; vendorNumber?: number } | null } | null;
  warehouse: string | null;
  counterpartProject: string | null;
}

export interface ProjectMaterial extends MaterialBalance {
  product: MaterialProductSummary | null;
  units: string[];
  boq: { _id: string; quantity: number; unit: string | null; unitPrice: number; currency: string; unitsPerBase: number | null; unitPriceEgp: number | null; conversionError: string | null } | null;
  purchaseUnitCost: number | null;
  committedUnitCost: number | null;
  contribution: { status: "ok" | "missing_cost" | "missing_boq" | "currency_not_configured"; unitDifference: number | null; total: number | null; quantityBasis: number | null; unitMismatch: boolean };
  sources: MaterialSource[];
  purchaseInvoices: number;
  ordered: { quantity: number; amount: number; units: string[]; purchaseOrders: { _id: string; code: string; status: string; quantity: number; unit: string | null; unitPrice: number }[] } | null;
}

export interface ProjectMaterialBreakdown {
  project: { _id: string; projectNumber: string; name: string | null };
  account: PucBalancesResult["account"];
  ledger: PucLedger;
  materials: ProjectMaterial[];
  totals: {
    purchasedQuantity: number;
    purchasedValue: number;
    consumedQuantity: number;
    consumedValue: number;
    closingQuantity: number;
    closingValue: number;
    orderedAmount: number;
    boqValue: number;
    contribution: number;
    contributionLines: number;
    missingCostLines: number;
    missingBoqLines: number;
    currencyErrorLines: number;
  };
}
