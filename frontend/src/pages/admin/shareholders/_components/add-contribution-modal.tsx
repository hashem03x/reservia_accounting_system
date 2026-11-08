import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { toDateOnly } from "@/utils/helpers/format-date";
import { formatAmount } from "@/utils/helpers/format-amount";
import { Button, NumberInput, Textarea, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { Shareholder } from "@/types/shareholder";
import useEquityAccounts from "./use-equity-accounts";
import useCashAccounts from "./use-cash-accounts";

// Capital Contributions always post to two FIXED accounts - the "NBE Capital" bank account and
// the "Capital" equity account - never user-selectable (backend:
// services/equity/shareholderService.js#addContribution resolves both by Chart of Accounts code
// and ignores any account id a client might submit, so these two fields below are read-only
// DISPLAYS of the live accounts, not form inputs). Shared by the shareholder detail page and the
// Equity dashboard's expandable cards, so there is only one "record a payment" form to keep in
// sync with the backend contract.
const NBE_CAPITAL_BANK_ACCOUNT_CODE = "11000001";
const CAPITAL_EQUITY_ACCOUNT_CODE = "20000001";

export default function AddContributionModal({
  opened,
  close,
  shareholder,
  onSaved,
}: {
  opened: boolean;
  close: () => void;
  shareholder: Shareholder;
  onSaved: () => void;
}) {
  const { language, translate, translations } = useLanguage();
  const equityAccounts = useEquityAccounts(opened);
  const cashAccounts = useCashAccounts(opened);
  const bankAccount = cashAccounts.find((a) => a.code === NBE_CAPITAL_BANK_ACCOUNT_CODE);
  const equityAccount = equityAccounts.find((a) => a.code === CAPITAL_EQUITY_ACCOUNT_CODE);
  const [amount, setAmount] = useState<string | number>("");
  const [date, setDate] = useState<Date | null>(new Date());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  // Generated once per dialog OPEN (not per submit attempt) - a retried/double-clicked submit
  // reuses the same key, which the backend recognizes and never posts twice (see
  // services/equity/shareholderService.js#addContribution).
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (!opened) return;
    setAmount("");
    setDate(new Date());
    setReference("");
    setNotes("");
    setIdempotencyKey(crypto.randomUUID());
    setError("");
  }, [opened]);

  const remaining = typeof shareholder.remainingUnpaid === "number" ? shareholder.remainingUnpaid : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({
        language,
        method: "POST",
        url: `shareholders/${shareholder._id}/contributions`,
        data: { amount, date: date ? toDateOnly(date) : undefined, reference: reference || undefined, notes: notes || undefined, idempotencyKey },
      });
      onSaved();
      close();
    });
  }

  return (
    <Modal opened={opened} onClose={close} title={translate("Add Capital Contribution", "إضافة مساهمة رأس مال")}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}
        {remaining !== null && (
          <p className="text-sm text-gray-500">
            {translate("Remaining unpaid for", "المتبقي غير المسدد لـ")} {shareholder.name}: <span className="font-semibold text-gray-700">{formatAmount(remaining, translations.currency)}</span>
          </p>
        )}
        <NumberInput label={translate("Amount", "المبلغ")} value={amount} onChange={setAmount} min={0.01} max={remaining ?? undefined} decimalScale={2} thousandSeparator required />
        <TextInput
          label={translate("Received Into (Bank Account)", "تم الاستلام في (الحساب البنكي)")}
          value={bankAccount ? `${bankAccount.code} - ${bankAccount.name}` : translate("Loading...", "جار التحميل...")}
          disabled
          description={translate("Fixed - all capital contributions are received into this account", "ثابت - جميع مساهمات رأس المال تُستلم في هذا الحساب")}
        />
        <TextInput
          label={translate("Equity Account", "حساب حقوق الملكية")}
          value={equityAccount ? `${equityAccount.code} - ${equityAccount.name}` : translate("Loading...", "جار التحميل...")}
          disabled
          description={translate("Fixed - all capital contributions are credited to this account", "ثابت - جميع مساهمات رأس المال تُقيد في هذا الحساب")}
        />
        <DateInput label={translate("Date", "التاريخ")} value={date} onChange={setDate} />
        <TextInput label={translate("Reference (optional)", "المرجع (اختياري)")} value={reference} onChange={(e) => setReference(e.target.value)} />
        <Textarea label={translate("Notes (optional)", "ملاحظات (اختياري)")} value={notes} onChange={(e) => setNotes(e.target.value)} autosize minRows={2} />
        <Button type="submit" loading={loading} disabled={!(typeof amount === "number" && amount > 0) || !bankAccount || !equityAccount}>
          {translate("Record", "تسجيل")}
        </Button>
      </form>
    </Modal>
  );
}
