// Vendor payment (settlement) accounts - frontend mirror of backend/server/utils/vendorPaymentAccounts.js
// (keep both in step; the backend validates again on save). Several bank accounts, InstaPay
// addresses and wallets per vendor; at most one active PRIMARY account (the first active one when
// none is chosen); the same account cannot be listed twice.

export type PaymentAccountType = "bank" | "instapay" | "wallet";
export type WalletProviderCode = "vodafone_cash" | "orange_cash" | "etisalat_cash" | "we_pay" | "fawry" | "other";

export interface VendorPaymentAccount {
  _id?: string;
  type: PaymentAccountType;
  label?: string;
  isPrimary: boolean;
  isActive: boolean;
  bank?: { bankName?: string; accountHolderName?: string; accountNumber?: string; iban?: string; swiftCode?: string };
  instapay?: { identifier?: string };
  wallet?: { provider?: WalletProviderCode | null; identifier?: string };
}

export const WALLET_PROVIDERS: WalletProviderCode[] = ["vodafone_cash", "orange_cash", "etisalat_cash", "we_pay", "fawry", "other"];
const IBAN = /^EG[A-Za-z0-9]{27}$/;
const SWIFT = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const t = (v?: string | null) => (v ?? "").trim();

export const emptyAccount = (type: PaymentAccountType): VendorPaymentAccount => ({
  type,
  isPrimary: false,
  isActive: true,
  ...(type === "bank" ? { bank: {} } : type === "instapay" ? { instapay: {} } : { wallet: { provider: null } }),
});

function accountKey(a: VendorPaymentAccount): string {
  if (a.type === "bank") return `bank|${t(a.bank?.iban).toUpperCase() || t(a.bank?.accountNumber)}`;
  if (a.type === "instapay") return `instapay|${t(a.instapay?.identifier).toLowerCase()}`;
  return `wallet|${a.wallet?.provider}|${t(a.wallet?.identifier)}`;
}

/** First problem in the list (1-based account number), or null - same rules as the backend. */
export function validatePaymentAccounts(accounts: VendorPaymentAccount[]): string | null {
  const seen = new Set<string>();
  for (let i = 0; i < accounts.length; i += 1) {
    const a = accounts[i];
    const label = `Payment account ${i + 1}`;
    if (a.type === "bank") {
      if (!t(a.bank?.bankName)) return `${label}: the bank name is required.`;
      if (!t(a.bank?.accountNumber) && !t(a.bank?.iban)) return `${label}: an account number or IBAN is required.`;
      if (t(a.bank?.iban) && !IBAN.test(t(a.bank?.iban).toUpperCase())) return `${label}: the IBAN must be a valid Egyptian IBAN (starts with EG, 29 characters).`;
      if (t(a.bank?.swiftCode) && !SWIFT.test(t(a.bank?.swiftCode).toUpperCase())) return `${label}: the SWIFT/BIC code is not valid.`;
    } else if (a.type === "instapay") {
      if (!t(a.instapay?.identifier)) return `${label}: the InstaPay identifier (address / mobile) is required.`;
    } else {
      if (!a.wallet?.provider || !WALLET_PROVIDERS.includes(a.wallet.provider)) return `${label}: choose the wallet provider.`;
      if (!t(a.wallet?.identifier)) return `${label}: the wallet number is required.`;
    }
    const key = accountKey(a);
    if (seen.has(key)) return `${label}: the same account is listed twice.`;
    seen.add(key);
  }
  if (accounts.filter((a) => a.isPrimary && a.isActive).length > 1) return "Only one payment account can be the primary (default) account.";
  return null;
}

/** Marks `index` as the only primary account. */
export function setPrimary(accounts: VendorPaymentAccount[], index: number): VendorPaymentAccount[] {
  return accounts.map((a, i) => ({ ...a, isPrimary: i === index, ...(i === index ? { isActive: true } : {}) }));
}

/** The accounts shown for a vendor: its list, or - for one not migrated yet - its old single method. */
export function accountsForVendor(vendor: { paymentAccounts?: VendorPaymentAccount[]; paymentInfo?: { mode?: string | null; bank?: VendorPaymentAccount["bank"]; instapay?: { identifier?: string }; wallet?: { provider?: string | null; identifier?: string } } } | undefined | null): VendorPaymentAccount[] {
  if (!vendor) return [];
  if (vendor.paymentAccounts && vendor.paymentAccounts.length) return vendor.paymentAccounts;
  const pi = vendor.paymentInfo;
  if (!pi?.mode) return [];
  if (pi.mode === "bank" && pi.bank) return [{ type: "bank", isPrimary: true, isActive: true, bank: { ...pi.bank } }];
  if (pi.mode === "instapay" && pi.instapay) return [{ type: "instapay", isPrimary: true, isActive: true, instapay: { ...pi.instapay } }];
  if (pi.mode === "wallet" && pi.wallet) return [{ type: "wallet", isPrimary: true, isActive: true, wallet: { provider: (pi.wallet.provider as WalletProviderCode) ?? null, identifier: pi.wallet.identifier } }];
  return [];
}

/** Last 4 characters only. */
export function maskTail(value?: string | null): string {
  const s = t(value);
  if (!s) return "";
  return s.length <= 4 ? s : `****${s.slice(-4)}`;
}

/** A short masked description, e.g. "Bank - Banque Misr ****3456". */
export function describeAccount(a: VendorPaymentAccount): string {
  const name = a.label ? `${a.label}: ` : "";
  if (a.type === "bank") return `${name}Bank - ${t(a.bank?.bankName)} ${maskTail(a.bank?.iban || a.bank?.accountNumber)}`.trim();
  if (a.type === "instapay") return `${name}InstaPay - ${maskTail(a.instapay?.identifier)}`;
  return `${name}Wallet (${a.wallet?.provider ?? ""}) - ${maskTail(a.wallet?.identifier)}`;
}

/** The accounts as the API expects them (only each type's own fields, trimmed). */
export function paymentAccountsPayload(accounts: VendorPaymentAccount[]): VendorPaymentAccount[] {
  return accounts.map((a) => ({
    ...(a._id ? { _id: a._id } : {}),
    type: a.type,
    label: t(a.label) || undefined,
    isPrimary: a.isPrimary,
    isActive: a.isActive,
    ...(a.type === "bank"
      ? { bank: { bankName: t(a.bank?.bankName), accountHolderName: t(a.bank?.accountHolderName) || undefined, accountNumber: t(a.bank?.accountNumber) || undefined, iban: t(a.bank?.iban).toUpperCase() || undefined, swiftCode: t(a.bank?.swiftCode).toUpperCase() || undefined } }
      : a.type === "instapay"
        ? { instapay: { identifier: t(a.instapay?.identifier) } }
        : { wallet: { provider: a.wallet?.provider ?? null, identifier: t(a.wallet?.identifier) } }),
  }));
}
