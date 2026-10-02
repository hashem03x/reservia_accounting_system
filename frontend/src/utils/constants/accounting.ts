// Mirrors backend/server/utils/accountingConstants.js - kept as the single frontend source of
// truth for these lists so a new sector (or other accounting enum added later) is a one-line
// change here, not something scattered across every form/table that references it. Renamed from
// `ProjectDepartments` (the underlying Project field was renamed `department` -> `sector`) - the
// values themselves (Villa, Industrials) are unchanged.
export const ProjectSectors = ["Villa", "Industrials"] as const;

export type ProjectSector = (typeof ProjectSectors)[number];

// Mirrors backend/server/utils/accountingConstants.js's AccountStates - secondary classification
// on top of a Chart of Accounts entry's `type` (e.g. Current/Non-Current for an asset,
// Direct/Indirect for an expense). A flat controlled list rather than a type-specific mapping,
// since which states make sense for a given account is a judgment call made at creation/edit time.
export const AccountStates = ["current", "non-current", "operating", "non-operating", "direct", "indirect", "other"] as const;

export type AccountState = (typeof AccountStates)[number];

// Mirrors backend/server/utils/appConstant.js's SalesOrderPaymentMethods - the Sales Order's own
// "how will this be paid" selection at creation time (distinct from the separate Payment model's
// own paymentMethod, which records an actual payment transaction).
export const SalesOrderPaymentMethods = [
  "cash",
  "wallet",
  "instapay",
  "band_transfer",
  "fawry",
  "paymob-online",
  "paymob-offline",
  "main-bank",
  "Banque Misr Deposit",
  "shopify-payments",
  "advanced_payment",
] as const;

export type SalesOrderPaymentMethod = (typeof SalesOrderPaymentMethods)[number];
