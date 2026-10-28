import { Badge, Button, Radio, Select, Switch, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { outlineIcons } from "@/components/icons";
import { PaymentAccountType, VendorPaymentAccount, WalletProviderCode, emptyAccount, setPrimary, validatePaymentAccounts } from "@/utils/helpers/vendor-payment-accounts";

/**
 * Vendor payment (settlement) accounts - any number of bank accounts, InstaPay addresses and mobile
 * wallets, several of the same type allowed; one is the primary (default) account. Each type shows
 * only its own fields. These are the vendor's RECEIVING details - never the company's own cash/bank
 * account a payment is recorded from. An account a payment was sent to can be deactivated but not
 * deleted (enforced by the backend - vendorValidators.js).
 */
export default function PaymentAccountsSection({ accounts, setAccounts }: { accounts: VendorPaymentAccount[]; setAccounts: (accounts: VendorPaymentAccount[]) => void }) {
  const { translate } = useLanguage();
  const error = validatePaymentAccounts(accounts);
  const update = (i: number, patch: Partial<VendorPaymentAccount>) => setAccounts(accounts.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const add = (type: PaymentAccountType) => setAccounts([...accounts, { ...emptyAccount(type), isPrimary: !accounts.some((a) => a.isPrimary && a.isActive) }]);

  const typeLabel: Record<PaymentAccountType, string> = {
    bank: translate("Bank account", "حساب بنكي"),
    instapay: translate("InstaPay", "إنستاباي"),
    wallet: translate("Mobile wallet", "محفظة إلكترونية"),
  };
  const providers: { value: WalletProviderCode; label: string }[] = [
    { value: "vodafone_cash", label: translate("Vodafone Cash", "فودافون كاش") },
    { value: "orange_cash", label: translate("Orange Cash", "أورنج كاش") },
    { value: "etisalat_cash", label: translate("Etisalat Cash", "اتصالات كاش") },
    { value: "we_pay", label: translate("WE Pay", "وي باي") },
    { value: "fawry", label: translate("Fawry", "فوري") },
    { value: "other", label: translate("Other", "أخرى") },
  ];

  return (
    <section className="flex flex-col gap-2">
      <h4>{translate("Payment Accounts (SSI) - Optional", "حسابات الدفع (تعليمات التسوية) - اختياري")}</h4>
      <p className="text-xs text-gray-500">
        {translate("Where this vendor receives payments. Add as many bank, InstaPay and wallet accounts as needed and choose the primary one.", "أين يستلم المورد مدفوعاته. أضف ما تحتاج من حسابات بنكية وإنستاباي ومحافظ واختر الحساب الأساسي.")}
      </p>

      {accounts.map((a, i) => (
        <div key={a._id || `new-${i}`} className={`flex flex-col gap-2 rounded-lg border p-3 ${a.isActive ? "border-gray-200 dark:border-gray-700" : "border-dashed border-gray-300 opacity-70"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="light">{typeLabel[a.type]}</Badge>
              <Radio
                checked={a.isPrimary && a.isActive}
                onChange={() => setAccounts(setPrimary(accounts, i))}
                label={translate("Primary", "أساسي")}
                disabled={!a.isActive}
                aria-label={translate(`Primary account ${i + 1}`, `الحساب الأساسي ${i + 1}`)}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch size="xs" checked={a.isActive} onChange={(e) => update(i, { isActive: e.currentTarget.checked, ...(e.currentTarget.checked ? {} : { isPrimary: false }) })} label={translate("Active", "نشط")} />
              <button type="button" onClick={() => setAccounts(accounts.filter((_, idx) => idx !== i))} title={translate("Delete account", "حذف الحساب")} aria-label={translate(`Delete payment account ${i + 1}`, `حذف حساب الدفع ${i + 1}`)}>
                <outlineIcons.Trash className="text-red-500 hover:text-red-700" size={16} />
              </button>
            </div>
          </div>
          <TextInput size="xs" label={translate("Label (optional)", "اسم مميز (اختياري)")} placeholder={translate("e.g. EGP collections", "مثال: تحصيلات الجنيه")} value={a.label ?? ""} onChange={(e) => update(i, { label: e.currentTarget.value })} maxLength={100} />
          {a.type === "bank" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <TextInput label={translate("Bank Name", "إسم البنك")} value={a.bank?.bankName ?? ""} onChange={(e) => update(i, { bank: { ...a.bank, bankName: e.currentTarget.value } })} required maxLength={100} />
              <TextInput label={translate("Account Holder Name", "اسم صاحب الحساب")} value={a.bank?.accountHolderName ?? ""} onChange={(e) => update(i, { bank: { ...a.bank, accountHolderName: e.currentTarget.value } })} maxLength={100} />
              <TextInput label={translate("Account Number", "رقم الحساب")} value={a.bank?.accountNumber ?? ""} onChange={(e) => update(i, { bank: { ...a.bank, accountNumber: e.currentTarget.value } })} maxLength={50} />
              <TextInput label={translate("IBAN", "رقم الآيبان (IBAN)")} value={a.bank?.iban ?? ""} onChange={(e) => update(i, { bank: { ...a.bank, iban: e.currentTarget.value.toUpperCase() } })} maxLength={29} />
              <TextInput label={translate("SWIFT Code", "رمز السويفت (SWIFT)")} value={a.bank?.swiftCode ?? ""} onChange={(e) => update(i, { bank: { ...a.bank, swiftCode: e.currentTarget.value.toUpperCase() } })} maxLength={11} />
            </div>
          )}
          {a.type === "instapay" && (
            <TextInput label={translate("InstaPay address / mobile", "عنوان إنستاباي / الموبايل")} value={a.instapay?.identifier ?? ""} onChange={(e) => update(i, { instapay: { identifier: e.currentTarget.value } })} required maxLength={100} />
          )}
          {a.type === "wallet" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Select label={translate("Wallet Provider", "مزود المحفظة")} value={a.wallet?.provider ?? null} onChange={(v) => update(i, { wallet: { ...a.wallet, provider: (v as WalletProviderCode) ?? null } })} data={providers} required />
              <TextInput label={translate("Wallet Number", "رقم المحفظة")} value={a.wallet?.identifier ?? ""} onChange={(e) => update(i, { wallet: { ...a.wallet, identifier: e.currentTarget.value } })} required maxLength={100} />
            </div>
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        {(["bank", "instapay", "wallet"] as PaymentAccountType[]).map((type) => (
          <Button key={type} size="xs" variant="light" onClick={() => add(type)}>
            + {typeLabel[type]}
          </Button>
        ))}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </section>
  );
}

/** Read-only list of a vendor's payment accounts (vendor details page). */
export function PaymentAccountsView({ accounts }: { accounts: VendorPaymentAccount[] }) {
  const { translate } = useLanguage();
  const typeLabel: Record<PaymentAccountType, string> = {
    bank: translate("Bank account", "حساب بنكي"),
    instapay: translate("InstaPay", "إنستاباي"),
    wallet: translate("Mobile wallet", "محفظة إلكترونية"),
  };
  return (
    <section className="flex flex-col gap-2 rounded-md bg-gray-100 p-4 dark:bg-gray-800">
      <h4>{translate("Payment Accounts (SSI)", "حسابات الدفع (تعليمات التسوية)")}</h4>
      {accounts.map((a, i) => (
        <div key={a._id || i} className={`flex flex-col gap-[2px] border-b border-gray-200 pb-2 last:border-0 dark:border-gray-700 ${a.isActive ? "" : "opacity-60"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge size="sm" variant="light">
              {typeLabel[a.type]}
            </Badge>
            {a.isPrimary && a.isActive && (
              <Badge size="sm" color="green" variant="light">
                {translate("Primary", "أساسي")}
              </Badge>
            )}
            {!a.isActive && (
              <Badge size="sm" color="gray" variant="light">
                {translate("Inactive", "غير نشط")}
              </Badge>
            )}
            {a.label && <span className="font-semibold">{a.label}</span>}
          </div>
          {a.type === "bank" && (
            <p className="text-sm">
              {[a.bank?.bankName, a.bank?.accountHolderName, a.bank?.accountNumber && `${translate("Account", "حساب")} ${a.bank.accountNumber}`, a.bank?.iban && `IBAN ${a.bank.iban}`, a.bank?.swiftCode && `SWIFT ${a.bank.swiftCode}`]
                .filter(Boolean)
                .join(" - ")}
            </p>
          )}
          {a.type === "instapay" && <p className="text-sm">{a.instapay?.identifier}</p>}
          {a.type === "wallet" && <p className="text-sm">{[a.wallet?.provider, a.wallet?.identifier].filter(Boolean).join(" - ")}</p>}
        </div>
      ))}
    </section>
  );
}
