// A currency managed in the Currency Manager (Accounting -> Currencies).
//
// Rate convention: 1 EGP = `unitsPerBase` units of this currency. `basePerUnit` is the inverse
// (1 unit = basePerUnit EGP), computed by the backend from the full-precision rate.
export interface Currency {
  _id: string;
  code: string;
  name: string;
  nameAr?: string;
  symbol?: string;
  unitsPerBase: number;
  basePerUnit: number | null;
  rateEffectiveDate?: string;
  isBase: boolean;
  isActive: boolean;
  // How many accounting records (journal entries, advanced payments) use this currency - a used
  // currency cannot be deleted, only deactivated.
  usageCount?: number;
  rateHistory?: CurrencyRateHistoryItem[];
  // Mongoose version - sent back as `expectedVersion` so a concurrent edit is detected (409).
  __v?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CurrencyRateHistoryItem {
  _id: string;
  unitsPerBase: number;
  effectiveDate: string;
  changedBy?: { _id: string; name: string } | string | null;
  changedAt?: string;
}

export interface CurrencyInput {
  code?: string;
  name?: string;
  nameAr?: string;
  symbol?: string;
  unitsPerBase?: number;
  rateEffectiveDate?: string;
  isActive?: boolean;
  expectedVersion?: number;
}

// GET /currencies/:code/rate?date= - the rate a transaction on that date gets by default.
export interface CurrencyRateForDate {
  code: string;
  unitsPerBase: number;
  basePerUnit: number;
  effectiveDate: string | null;
  isFallback: boolean;
}
