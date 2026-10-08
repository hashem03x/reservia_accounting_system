// Project Sectors are not listed here: they are admin-managed records loaded from the backend
// (Admin -> Sectors, hooks/useSectors.ts, components/global/sector-select).

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
