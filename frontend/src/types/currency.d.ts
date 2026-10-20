// Currency Management (docs section "Exchange-Rate Convention"): `rate` is the CANONICAL,
// user-facing representation - units of this currency per 1 EGP (e.g. USD 0.02, "1 EGP = 0.02
// USD"). `inverseRate` (1 unit of this currency = X EGP) is always server-computed, never stored -
// see backend's utils/exchangeRate.js. This is the INVERSE of JournalLine.exchangeRate (EGP per 1
// foreign unit), which predates Currency Management - see types/journal-entry.d.ts's own note.
export interface Currency {
  _id: string;
  code: string;
  name: string;
  symbol?: string | null;
  isBaseCurrency: boolean;
  rate: number;
  inverseRate: number;
  isActive: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CurrencyUsage {
  usedInJournalEntriesCount: number;
}
