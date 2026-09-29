import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { Button, NumberInput, Select, TextInput } from "@mantine/core";
import useDataHandler from "@/hooks/useDataHandler";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { JournalEntry, JournalLineInput } from "@/types/journal-entry";
import { ChartOfAccount } from "@/types/chart-of-account";
import { outlineIcons } from "@/components/icons";

type ProjectOption = { _id: string; projectNumber: string };

const emptyLine: JournalLineInput = { account: "", subAccount: null, project: null, debit: 0, credit: 0, description: "" };

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

  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<JournalLineInput[]>([{ ...emptyLine }, { ...emptyLine }]);

  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

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
  }, [opened]);

  function updateLine(index: number, patch: Partial<JournalLineInput>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
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
          lines: lines.map((l) => ({ ...l, subAccount: l.subAccount || undefined, project: l.project || undefined })),
        },
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
      setLines([{ ...emptyLine }, { ...emptyLine }]);
      setError("");
    }, 250);
  }

  return (
    <Modal opened={opened} onClose={handleClose} title={translate("Create Journal Entry (Draft)", "إنشاء قيد يومية (مسودة)")} size="xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextInput type="date" label={translate("Date", "التاريخ")} value={date} onChange={(e) => setDate(e.target.value)} />
          <TextInput label={translate("Reference", "المرجع")} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <TextInput label={translate("Description", "الوصف")} value={description} onChange={(e) => setDescription(e.target.value)} />

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h4>{translate("Lines", "البنود")}</h4>
            <Button size="xs" variant="light" onClick={addLine} leftSection={<outlineIcons.Squares size={14} />}>
              {translate("Add Line", "إضافة بند")}
            </Button>
          </div>

          {lines.map((line, index) => (
            <div key={index} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-gray-200 p-3 sm:grid-cols-6">
              <Select
                label={translate("Account (GA)", "الحساب")}
                value={line.account}
                onChange={(v) => updateLine(index, { account: v || "" })}
                data={accounts.map((a) => ({ value: a._id, label: `${a.code} - ${a.name}` }))}
                searchable
                required
                className="sm:col-span-2"
              />
              <Select
                label={translate("Project", "المشروع")}
                value={line.project || ""}
                onChange={(v) => updateLine(index, { project: v || null, projectNumber: projects.find((p) => p._id === v)?.projectNumber || null })}
                data={projects.map((p) => ({ value: p._id, label: p.projectNumber }))}
                searchable
                clearable
              />
              <NumberInput
                label={translate("Debit", "مدين")}
                value={line.debit}
                onChange={(v) => updateLine(index, { debit: v || 0, credit: v ? 0 : line.credit })}
                min={0}
                decimalScale={2}
              />
              <NumberInput
                label={translate("Credit", "دائن")}
                value={line.credit}
                onChange={(v) => updateLine(index, { credit: v || 0, debit: v ? 0 : line.debit })}
                min={0}
                decimalScale={2}
              />
              <div className="flex items-center gap-2">
                <TextInput
                  label={translate("Description", "الوصف")}
                  value={line.description}
                  onChange={(e) => updateLine(index, { description: e.target.value })}
                  className="flex-1"
                />
                {lines.length > 2 && (
                  <button type="button" onClick={() => removeLine(index)} className="mb-2" title={translate("Remove", "حذف")}>
                    <outlineIcons.Trash className="text-red-500 hover:text-red-700" size={18} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-6 rounded-lg bg-gray-50 p-3 text-sm">
          <span>
            {translate("Total Debit", "إجمالي المدين")}: <b>{totalDebit.toLocaleString()}</b>
          </span>
          <span>
            {translate("Total Credit", "إجمالي الدائن")}: <b>{totalCredit.toLocaleString()}</b>
          </span>
          <span className={difference !== 0 ? "text-red-600" : "text-green-600"}>
            {translate("Difference", "الفرق")}: <b>{difference}</b>
          </span>
        </div>

        <Button type="submit" loading={loading} mt="md">
          {translate("Save as Draft", "حفظ كمسودة")}
        </Button>
      </form>
    </Modal>
  );
}
