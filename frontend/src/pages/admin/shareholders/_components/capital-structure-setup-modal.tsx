import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatAmount } from "@/utils/helpers/format-amount";
import { Badge, Button, NumberInput, Select, TextInput } from "@mantine/core";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { outlineIcons } from "@/components/icons";
import useEquityAccounts from "./use-equity-accounts";
import { activeOwnershipTotal, combinedOwnershipTotal, isOwnershipFinalized } from "./ownership-math";
import { Shareholder } from "@/types/shareholder";

type Row = {
  name: string;
  nameAr: string;
  address: string;
  nationalId: string;
  ownershipPercentage: string | number;
  equityAccount: string;
};

const blankRow: Row = { name: "", nameAr: "", address: "", nationalId: "", ownershipPercentage: "", equityAccount: "" };

// Scenario 1 (brief): enter Issued Capital and the Number of Shareholders, and that many
// shareholder sections appear - each with a live, read-only computed capital amount
// (ownership % x Issued Capital). Submits once, to the dedicated POST /shareholders/capital-structure
// endpoint, which creates Issued Capital and every shareholder together in ONE transaction (see
// that endpoint's own comment for why this isn't a client-side loop of separate requests).
//
// `existingShareholders` (the dashboard page's own already-loaded list - no extra request here):
// the backend's own 100%-ownership rule (backend/server/models/equity/shareholderModel.js) counts
// EVERY active shareholder, not just the ones being entered in this dialog - a shareholder added
// earlier via the separate "Add Shareholder" action (always available, independent of this wizard)
// is real and must be counted here too, or this dialog's own "100% - ready" claim can be wrong in
// a way the backend then (correctly) rejects. See ownership-math.ts for the fixed calculation and
// its own root-cause comment.
export default function CapitalStructureSetupModal({
  opened,
  close,
  onSaved,
  existingShareholders,
}: {
  opened: boolean;
  close: () => void;
  onSaved: () => void;
  existingShareholders: Shareholder[];
}) {
  const { language, translate, translations } = useLanguage();
  const equityAccounts = useEquityAccounts(opened);
  const [issuedCapital, setIssuedCapital] = useState<string | number>("");
  const [count, setCount] = useState<string | number>(2);
  const [rows, setRows] = useState<Row[]>([{ ...blankRow }, { ...blankRow }]);
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (!opened) return;
    setIssuedCapital("");
    setCount(2);
    setRows([{ ...blankRow }, { ...blankRow }]);
    setError("");
  }, [opened]);

  // Resizes `rows` to match `count`, preserving already-entered data in the rows that remain.
  useEffect(() => {
    const n = typeof count === "number" ? Math.max(0, Math.min(20, Math.floor(count))) : 0;
    setRows((prev) => {
      if (n === prev.length) return prev;
      if (n < prev.length) return prev.slice(0, n);
      return [...prev, ...Array.from({ length: n - prev.length }, () => ({ ...blankRow }))];
    });
  }, [count]);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const issuedNum = typeof issuedCapital === "number" ? issuedCapital : 0;
  const existingActiveTotal = activeOwnershipTotal(existingShareholders);
  const combinedTotal = combinedOwnershipTotal(existingActiveTotal, rows);
  const isFinalized = isOwnershipFinalized(combinedTotal);
  const nationalIdValid = (id: string) => /^[23]\d{13}$/.test(id.trim());

  const rowsValid = rows.length > 0 && rows.every((r) => r.name && r.nameAr && r.address && nationalIdValid(r.nationalId) && typeof r.ownershipPercentage === "number" && r.ownershipPercentage > 0 && r.equityAccount);
  const canSubmit = typeof issuedCapital === "number" && issuedCapital > 0 && rowsValid && isFinalized;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({
        language,
        method: "POST",
        url: "shareholders/capital-structure",
        data: {
          issuedCapital,
          shareholders: rows.map((r) => ({
            name: r.name,
            nameAr: r.nameAr,
            address: r.address,
            nationalId: r.nationalId,
            ownershipPercentage: r.ownershipPercentage,
            equityAccount: r.equityAccount,
          })),
        },
      });
      onSaved();
      close();
    });
  }

  return (
    <Modal opened={opened} onClose={close} title={translate("Capital Structure Setup", "إعداد هيكل رأس المال")} size="xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberInput label={translate("Issued Capital - EGP", "رأس المال المصدر - جنيه")} value={issuedCapital} onChange={setIssuedCapital} min={0.01} decimalScale={2} thousandSeparator required />
          <NumberInput label={translate("Number of Shareholders", "عدد المساهمين")} value={count} onChange={setCount} min={1} max={20} required />
        </div>

        <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto pr-1">
          {rows.map((row, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-lg border border-gray-100 p-3 dark:border-line">
              <h5 className="text-sm font-semibold text-gray-700 dark:text-ink">
                {translate("Shareholder", "المساهم")} {i + 1}
              </h5>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextInput label={translate("Full Name (English)", "الاسم بالكامل (إنجليزي)")} value={row.name} onChange={(e) => updateRow(i, { name: e.target.value })} required />
                <TextInput label={translate("Full Name (Arabic)", "الاسم بالكامل (عربي)")} value={row.nameAr} onChange={(e) => updateRow(i, { nameAr: e.target.value })} dir="rtl" required />
              </div>
              <TextInput label={translate("Address", "العنوان")} value={row.address} onChange={(e) => updateRow(i, { address: e.target.value })} required />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextInput
                  label={translate("National ID", "الرقم القومي")}
                  value={row.nationalId}
                  onChange={(e) => updateRow(i, { nationalId: e.target.value })}
                  error={row.nationalId && !nationalIdValid(row.nationalId) ? translate("Must be a 14-digit Egyptian National ID", "يجب أن يكون رقمًا قوميًا من 14 رقمًا") : undefined}
                  required
                />
                <Select
                  label={translate("Equity Account", "حساب حقوق الملكية")}
                  value={row.equityAccount || null}
                  onChange={(v) => updateRow(i, { equityAccount: v || "" })}
                  data={equityAccounts.map((a) => ({ value: a._id, label: `${a.code} - ${a.name}` }))}
                  searchable
                  required
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NumberInput
                  label={translate("Ownership %", "نسبة الملكية %")}
                  value={row.ownershipPercentage}
                  onChange={(v) => updateRow(i, { ownershipPercentage: v })}
                  min={0.0001}
                  max={100}
                  decimalScale={4}
                  required
                />
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-gray-700 dark:text-ink">{translate("Capital Amount (calculated)", "مبلغ رأس المال (محسوب)")}</span>
                  <div className="flex h-9 items-center rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-600 dark:border-line dark:bg-page dark:text-ink-secondary">
                    <outlineIcons.Lock size={12} className="mr-1.5 shrink-0" />
                    {formatAmount(issuedNum * ((typeof row.ownershipPercentage === "number" ? row.ownershipPercentage : 0) / 100), translations.currency)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {existingActiveTotal > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
            <span className="text-sm text-amber-700 dark:text-amber-400">
              {translate("Already allocated by existing active shareholders", "مخصص بالفعل لمساهمين نشطين موجودين")}
            </span>
            <Badge size="lg" color="orange" variant="light">
              {existingActiveTotal}%
            </Badge>
          </div>
        )}
        <div className="flex items-center justify-between rounded-lg border border-gray-100 p-3 dark:border-line">
          <span className="text-sm text-gray-600 dark:text-ink-secondary">
            {existingActiveTotal > 0 ? translate("Combined total (existing + new)", "الإجمالي (الموجود + الجديد)") : translate("Total ownership", "إجمالي نسبة الملكية")}
          </span>
          <Badge size="lg" color={isFinalized ? "teal" : "orange"} variant="light">
            {combinedTotal}%
          </Badge>
        </div>
        {!isFinalized && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {existingActiveTotal > 0
              ? translate(
                  `Combined ownership must equal 100% before the capital structure can be finalized (currently ${combinedTotal}% = ${existingActiveTotal}% existing + the new rows below).`,
                  `يجب أن يكون إجمالي نسبة الملكية 100% قبل إمكانية اعتماد هيكل رأس المال (حاليًا ${combinedTotal}% = ${existingActiveTotal}% موجود + الصفوف الجديدة أدناه).`,
                )
              : translate(
                  `Total ownership must equal 100% before the capital structure can be finalized (currently ${combinedTotal}%).`,
                  `يجب أن يكون إجمالي نسبة الملكية 100% قبل إمكانية اعتماد هيكل رأس المال (حاليًا ${combinedTotal}%).`,
                )}
          </p>
        )}

        <Button type="submit" loading={loading} disabled={!canSubmit}>
          {translate("Create Capital Structure", "إنشاء هيكل رأس المال")}
        </Button>
      </form>
    </Modal>
  );
}
