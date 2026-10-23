import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { Alert, Button, NumberInput, Select, TextInput } from "@mantine/core";
import useDataHandler from "@/hooks/useDataHandler";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { JournalEntry, JournalLineInput, JournalLineRules, PartyType } from "@/types/journal-entry";
import { ChartOfAccount } from "@/types/chart-of-account";
import { outlineIcons } from "@/components/icons";
import AttachmentPicker from "@/components/global/attachments/attachment-picker";
import useAttachmentUpload, { uploadPendingAttachments } from "@/components/global/attachments/use-attachment-upload";
import { notifyError } from "@/utils/helpers/notifiers";
import useHasPermission from "@/hooks/useHasPermission";
import resources from "@/utils/constants/resources";
import { fetchRateForDate } from "@/hooks/useCurrencies";
import { Currency } from "@/types/currency";
import { BASE_CURRENCY_CODE, formatRate, inverseRate, isValidRate, toBaseAmount } from "@/utils/helpers/currency-math";

type ProjectOption = { _id: string; projectNumber: string };
type PartyOption = { number: number; name: string };

const emptyLine: JournalLineInput = {
  account: "",
  subAccount: null,
  project: null,
  partyType: null,
  partyNumber: null,
  debit: 0,
  credit: 0,
  description: "",
};

export default function CreateJournalEntryModal({
  opened,
  close,
  onCreated,
}: {
  opened: boolean;
  close: () => void;
  onCreated: (entry: JournalEntry) => void;
}) {
  const { translate, language } = useLanguage();
  const privateRequest = usePrivateRequest();

  // Journal Entry Project / General selection (docs section "Journal Entry Project Selection -
  // Project or General"): the user must EXPLICITLY choose between a specific project and "General
  // (No Project)" - never an empty/placeholder dropdown value standing in for "general" without
  // explaining it. "General" is only ever offered to a user the backend would actually accept it
  // from (journalEntries:createGeneral) - hiding it from everyone else is a UX nicety, not the
  // real authorization boundary, which the backend enforces independently on the request itself.
  const canCreateGeneral = useHasPermission(resources.journalEntries, "createGeneral");
  // Project or G&A (General & Administrative) - no preselected value: the user always chooses, and
  // the choice is stored on the entry as `classification` (never inferred from a missing project).
  const [entryKind, setEntryKind] = useState<"" | "project" | "ga">("");

  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [entryProject, setEntryProject] = useState("");
  const [lines, setLines] = useState<JournalLineInput[]>([{ ...emptyLine }, { ...emptyLine }]);
  // Transaction currency (Currency Manager). Line amounts are entered in this currency; the backend
  // converts them to EGP with the applied rate (1 EGP = rate units) and stores both.
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [currencyCode, setCurrencyCode] = useState(BASE_CURRENCY_CODE);
  const [rate, setRate] = useState<number | string>(1);
  const [rateNote, setRateNote] = useState<{ effectiveDate: string | null; isFallback: boolean } | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  // Optional PDFs, uploaded right after the entry is created (they never change the entry).
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const uploadAttachment = useAttachmentUpload();

  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [rules, setRules] = useState<JournalLineRules>({ customerAccounts: [], vendorAccounts: [] });
  const [parties, setParties] = useState<Record<PartyType, PartyOption[]>>({ customer: [], vendor: [], shareholder: [] });

  const { privateRequest: fetchOptions } = useDataHandler({ initialData: null });
  const { loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (!opened) return;
    fetchOptions({ url: "accounts", params: { limit: 500 }, language })
      .then((res) => setAccounts(res.data))
      .catch(() => {});
    fetchOptions({ url: "projects", params: { limit: 500 }, language })
      .then((res) => setProjects(res.data))
      .catch(() => {});
    fetchOptions({ url: "currencies", params: { status: "active", limit: 200 }, language })
      .then((res) => setCurrencies(res.data || []))
      .catch(() => setCurrencies([]));
    fetchOptions({ url: "journal-entries/line-rules", language })
      .then((res) => setRules(res.data))
      .catch(() => {});
    // Sub Account options - each list is optional: a user who cannot read one simply gets no options of that kind.
    const load = (type: PartyType, url: string, numberKey: string) =>
      fetchOptions({ url, params: { limit: 1000 }, language })
        .then((res) =>
          setParties((prev) => ({
            ...prev,
            [type]: (res.data || [])
              .filter((p: Record<string, unknown>) => p[numberKey] != null)
              .map((p: Record<string, unknown>) => ({ number: p[numberKey] as number, name: String(p.name ?? "") })),
          })),
        )
        .catch(() => {});
    load("customer", "customers", "customerNumber");
    load("vendor", "vendors", "vendorNumber");
    load("shareholder", "shareholders", "shareholderNumber");
  }, [opened]);

  const isForeign = currencyCode !== BASE_CURRENCY_CODE;
  // The default rate is the one effective on the entry date - re-read whenever the currency or the
  // date changes (the user may still override it for this entry).
  useEffect(() => {
    if (!opened) return;
    setRateNote(null);
    if (!isForeign) {
      setRate(1);
      return;
    }
    let cancelled = false;
    setRateLoading(true);
    fetchRateForDate(privateRequest, currencyCode, date || undefined, language)
      .then((r) => {
        if (cancelled) return;
        setRate(r.unitsPerBase);
        setRateNote({ effectiveDate: r.effectiveDate, isFallback: r.isFallback });
      })
      .catch(() => {
        if (!cancelled) setRate("");
      })
      .finally(() => {
        if (!cancelled) setRateLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, currencyCode, date]);

  const numericRate = typeof rate === "number" ? rate : Number(rate);
  const rateValid = !isForeign || (rate !== "" && isValidRate(numericRate));

  const requiredPartyType = (accountId: string): PartyType | null =>
    rules.customerAccounts.includes(accountId) ? "customer" : rules.vendorAccounts.includes(accountId) ? "vendor" : null;
  const isEquity = (accountId: string) => accounts.find((a) => a._id === accountId)?.type === "equity";

  function updateLine(index: number, patch: Partial<JournalLineInput>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function selectAccount(index: number, accountId: string) {
    const required = requiredPartyType(accountId);
    const current = lines[index];
    // A control account fixes the Sub Account type; a type that no longer fits is cleared.
    const keep =
      !current.partyType ||
      (required ? current.partyType === required : current.partyType !== "shareholder" || isEquity(accountId));
    updateLine(index, {
      account: accountId,
      ...(keep ? {} : { partyType: required, partyNumber: null }),
      ...(required && !current.partyType ? { partyType: required } : {}),
    });
  }

  function addLine() {
    setLines((prev) => [...prev, { ...emptyLine }]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  const difference = Math.round((totalDebit - totalCredit) * 100) / 100;
  const isBalanced = difference === 0;
  const missingDescription = lines.some((l) => !l.description?.trim());
  const missingSubAccount = lines.some((l) => l.account && requiredPartyType(l.account) && l.partyNumber == null);
  // UX-only - the backend independently enforces every one of these rules on the request itself.
  const canSubmit =
    isBalanced &&
    rateValid &&
    !rateLoading &&
    (entryKind === "ga" || (entryKind === "project" && !!entryProject)) &&
    !missingDescription &&
    !missingSubAccount;
  const entryProjectNumber =
    entryKind === "ga"
      ? translate("G&A", "عمومية وإدارية")
      : projects.find((p) => p._id === entryProject)?.projectNumber || "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "POST",
        url: "journal-entries",
        data: {
          date: date || undefined,
          description,
          reference,
          classification: entryKind,
          project: entryKind === "ga" ? undefined : entryProject,
          currency: currencyCode,
          exchangeRate: isForeign ? numericRate : undefined,
          lines: lines.map((l) => ({
            ...l,
            subAccount: l.subAccount || undefined,
            project: entryKind === "ga" ? undefined : entryProject || undefined,
            partyType: l.partyNumber != null ? l.partyType : undefined,
            partyNumber: l.partyNumber ?? undefined,
          })),
        },
      });

      const failed = await uploadPendingAttachments(uploadAttachment, "journal-entries", res.data._id, attachmentFiles);
      if (failed.length)
        notifyError({
          language,
          message: translate(
            `The entry was saved, but ${failed.length} attachment(s) could not be uploaded: ${failed.map((f) => `${f.file.name} (${f.error})`).join(", ")}`,
            `تم حفظ القيد، لكن تعذر رفع ${failed.length} من المرفقات: ${failed.map((f) => `${f.file.name} (${f.error})`).join("، ")}`,
          ),
        });
      onCreated(res.data);
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setDate("");
      setDescription("");
      setReference("");
      setEntryProject("");
      setEntryKind("");
      setLines([{ ...emptyLine }, { ...emptyLine }]);
      setCurrencyCode(BASE_CURRENCY_CODE);
      setRate(1);
      setRateNote(null);
      setAttachmentFiles([]);
      setError("");
    }, 250);
  }

  const partyTypeOptions = (accountId: string) => {
    const required = requiredPartyType(accountId);
    const all: { value: PartyType; label: string }[] = [
      { value: "customer", label: translate("Customer", "عميل") },
      { value: "vendor", label: translate("Vendor", "مورد") },
      ...(isEquity(accountId) ? [{ value: "shareholder" as PartyType, label: translate("Shareholder", "مساهم") }] : []),
    ];
    return required ? all.filter((o) => o.value === required) : all;
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={translate("Create Journal Entry (Draft)", "إنشاء قيد يومية (مسودة)")}
      size="xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextInput
            type="date"
            label={translate("Date", "التاريخ")}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <TextInput
            label={translate("Reference", "المرجع")}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
        <TextInput
          label={translate("Description", "الوصف")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label={translate("Currency", "العملة")}
            description={translate("Line amounts are entered in this currency.", "تُدخل مبالغ البنود بهذه العملة.")}
            value={currencyCode}
            onChange={(v) => setCurrencyCode(v || BASE_CURRENCY_CODE)}
            data={(currencies.length ? currencies : [{ code: BASE_CURRENCY_CODE, name: "Egyptian Pound" } as Currency]).map(
              (c) => ({
                value: c.code,
                label: `${c.code} - ${language === "ar-EG" && c.nameAr ? c.nameAr : c.name}`,
              }),
            )}
            searchable
            allowDeselect={false}
          />
          {isForeign ? (
            <NumberInput
              label={translate(`Exchange rate: 1 EGP = ? ${currencyCode}`, `سعر الصرف: 1 جنيه = ? ${currencyCode}`)}
              description={
                rateNote
                  ? rateNote.isFallback
                    ? translate(
                        "No rate is recorded on or before this date - the earliest recorded rate was used. Check it.",
                        "لا يوجد سعر مسجل في هذا التاريخ أو قبله - تم استخدام أقدم سعر مسجل. تحقق منه.",
                      )
                    : translate(
                        `Rate effective ${rateNote.effectiveDate ? rateNote.effectiveDate.slice(0, 10) : "-"} (you may adjust it for this entry).`,
                        `السعر الساري منذ ${rateNote.effectiveDate ? rateNote.effectiveDate.slice(0, 10) : "-"} (يمكنك تعديله لهذا القيد).`,
                      )
                  : undefined
              }
              value={rate}
              onChange={setRate}
              min={0}
              decimalScale={10}
              allowNegative={false}
              hideControls
              required
              disabled={rateLoading}
              error={!rateValid ? translate("Enter a rate greater than zero", "أدخل سعراً أكبر من صفر") : undefined}
            />
          ) : (
            <TextInput
              label={translate("Exchange rate", "سعر الصرف")}
              value={translate("1 (base currency)", "1 (العملة الأساسية)")}
              readOnly
            />
          )}
        </div>
        {isForeign && rateValid && (
          <p className="-mt-2 text-sm text-gray-600" aria-live="polite">
            1 EGP = <b className="tabular-nums">{formatRate(numericRate)}</b> {currencyCode} · 1 {currencyCode} ={" "}
            <b className="tabular-nums">{formatRate(inverseRate(numericRate))}</b> EGP
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label={translate("Project or G&A", "مشروع أو عمومية وإدارية")}
            description={translate(
              "Choose whether this entry is for a specific project or for General & Administrative (no project).",
              "اختر ما إذا كان القيد لمشروع محدد أو للمصروفات العمومية والإدارية (بدون مشروع).",
            )}
            placeholder={translate("Select Project or G&A", "اختر مشروع أو عمومية وإدارية")}
            value={entryKind || null}
            onChange={(v) => {
              setEntryKind((v as "project" | "ga") || "");
              if (v === "ga") setEntryProject("");
            }}
            data={[
              { value: "project", label: translate("Project", "مشروع") },
              // Only offered to a user the backend would actually accept a G&A entry from
              // (journalEntries:createGeneral) - never shown as a tempting option to everyone else.
              ...(canCreateGeneral
                ? [{ value: "ga", label: translate("G&A (General & Administrative - no project)", "عمومية وإدارية (بدون مشروع)") }]
                : []),
            ]}
            allowDeselect={false}
            required
            withAsterisk
          />
          {entryKind === "project" && (
            <Select
              label={translate("Project", "المشروع")}
              placeholder={translate("Select project", "اختر المشروع")}
              value={entryProject || null}
              onChange={(v) => setEntryProject(v || "")}
              data={projects.map((p) => ({ value: p._id, label: p.projectNumber }))}
              searchable
              required
              withAsterisk
            />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h4>{translate("Lines", "البنود")}</h4>
            <Button size="xs" variant="light" onClick={addLine} leftSection={<outlineIcons.Squares size={14} />}>
              {translate("Add Line", "إضافة بند")}
            </Button>
          </div>

          {lines.map((line, index) => {
            const required = line.account ? requiredPartyType(line.account) : null;
            const partyList = line.partyType ? parties[line.partyType] : [];
            return (
              <div
                key={index}
                className="grid grid-cols-1 items-end gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700 sm:grid-cols-6"
              >
                <Select
                  label={translate("Account (GA)", "الحساب")}
                  value={line.account || null}
                  onChange={(v) => selectAccount(index, v || "")}
                  data={accounts.map((a) => ({ value: a._id, label: `${a.code} - ${a.name}` }))}
                  searchable
                  required
                  className="sm:col-span-2"
                />
                {/* Every line carries the entry's project (the backend stamps it and refuses any other). */}
                <TextInput
                  label={translate("Project", "المشروع")}
                  value={entryProjectNumber}
                  placeholder={translate("Select the entry's project", "اختر مشروع القيد")}
                  readOnly
                  required
                  withAsterisk
                />
                <NumberInput
                  label={`${translate("Debit", "مدين")} (${currencyCode})`}
                  value={line.debit}
                  onChange={(v) => updateLine(index, { debit: v || 0, credit: v ? 0 : line.credit })}
                  min={0}
                  decimalScale={2}
                />
                <NumberInput
                  label={`${translate("Credit", "دائن")} (${currencyCode})`}
                  value={line.credit}
                  onChange={(v) => updateLine(index, { credit: v || 0, debit: v ? 0 : line.debit })}
                  min={0}
                  decimalScale={2}
                />
                <div className="flex items-end gap-2">
                  <TextInput
                    label={translate("Description", "الوصف")}
                    value={line.description}
                    onChange={(e) => updateLine(index, { description: e.target.value })}
                    className="flex-1"
                    required
                    error={!line.description?.trim() && line.account ? translate("Required", "مطلوب") : undefined}
                  />
                  {lines.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeLine(index)}
                      className="mb-2"
                      title={translate("Remove", "حذف")}
                    >
                      <outlineIcons.Trash className="text-red-500 hover:text-red-700" size={18} />
                    </button>
                  )}
                </div>
                <Select
                  label={translate("Sub Account Type", "نوع الحساب الفرعي")}
                  placeholder={required ? undefined : translate("None", "بدون")}
                  value={line.partyType || null}
                  onChange={(v) => updateLine(index, { partyType: (v as PartyType) || null, partyNumber: null })}
                  data={partyTypeOptions(line.account)}
                  clearable={!required}
                  disabled={!line.account}
                  required={!!required}
                  className="sm:col-span-2"
                />
                <Select
                  label={translate("Sub Account", "الحساب الفرعي")}
                  placeholder={line.partyType ? translate("Search by number or name", "ابحث بالرقم أو الاسم") : "-"}
                  value={line.partyNumber != null ? String(line.partyNumber) : null}
                  onChange={(v) => updateLine(index, { partyNumber: v ? Number(v) : null })}
                  data={partyList.map((p) => ({ value: String(p.number), label: `${p.number} - ${p.name}` }))}
                  searchable
                  clearable
                  disabled={!line.partyType}
                  required={!!required}
                  error={
                    required && line.partyNumber == null && line.account
                      ? translate(`Select the ${required}`, required === "customer" ? "اختر العميل" : "اختر المورد")
                      : undefined
                  }
                  className="sm:col-span-4"
                />
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap justify-end gap-6 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <span>
            {translate("Total Debit", "إجمالي المدين")}: <b>{totalDebit.toLocaleString()}</b> {currencyCode}
          </span>
          <span>
            {translate("Total Credit", "إجمالي الدائن")}: <b>{totalCredit.toLocaleString()}</b> {currencyCode}
          </span>
          <span className={difference !== 0 ? "text-red-600" : "text-green-600"}>
            {translate("Difference", "الفرق")}: <b>{difference}</b>
          </span>
          {isForeign && rateValid && (
            <span className="text-gray-600">
              {translate("≈ EGP", "≈ بالجنيه")}: <b>{(toBaseAmount(totalDebit, numericRate) ?? 0).toLocaleString()}</b>
            </span>
          )}
          <span className={isBalanced ? "text-green-600" : "text-red-600"}>
            {translate("Status", "الحالة")}:{" "}
            <b>{isBalanced ? translate("Balanced", "متوازن") : translate("Not Balanced", "غير متوازن")}</b>
          </span>
        </div>

        {!isBalanced && (
          <Alert color="red" variant="light">
            {translate(
              "The entry is not balanced. Total debit must equal total credit before it can be saved, even as a draft.",
              "القيد غير متوازن. يجب أن يتساوى إجمالي المدين مع إجمالي الدائن قبل الحفظ، حتى كمسودة.",
            )}
          </Alert>
        )}
        {(missingDescription || missingSubAccount) && (
          <Alert color="yellow" variant="light">
            {translate(
              "Every line needs a description, and customer / vendor accounts (receivables, suppliers and their advances) need their Sub Account.",
              "كل بند يحتاج وصفاً، وحسابات العملاء والموردين (المدينون والموردون ودفعاتهم المقدمة) تحتاج الحساب الفرعي.",
            )}
          </Alert>
        )}

        <AttachmentPicker files={attachmentFiles} onChange={setAttachmentFiles} disabled={loading} />

        <Button type="submit" loading={loading} disabled={!canSubmit} mt="md">
          {translate("Save as Draft", "حفظ كمسودة")}
        </Button>
      </form>
    </Modal>
  );
}
