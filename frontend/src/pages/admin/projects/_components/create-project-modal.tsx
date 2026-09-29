import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { Alert, Button, NumberInput, Select, Textarea, TextInput } from "@mantine/core";
import useDataHandler from "@/hooks/useDataHandler";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { Project } from "@/types/project";
import { JournalEntry } from "@/types/journal-entry";
import { outlineIcons } from "@/components/icons";

type StaffOption = { _id: string; name: string; role: string };

export default function CreateProjectModal({
  opened,
  close,
  onCreated,
}: {
  opened: boolean;
  close: () => void;
  onCreated: (project: Project) => void;
}) {
  const { translate, language } = useLanguage();
  const privateRequest = usePrivateRequest();

  const [projectNumber, setProjectNumber] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectAmount, setProjectAmount] = useState<string | number>("");
  const [executor, setExecutor] = useState("");
  const [staff, setStaff] = useState<StaffOption[]>([]);

  const { privateRequest: fetchStaffRequest } = useDataHandler({ initialData: null });
  const { loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  const [result, setResult] = useState<{ project: Project; journalEntry: JournalEntry } | null>(null);

  useEffect(() => {
    if (!opened) return;
    fetchStaffRequest({ url: "users", params: { limit: 500 }, language })
      .then((res) => setStaff((res.data || []).filter((u: StaffOption) => u.role !== "user")))
      .catch(() => {});
  }, [opened]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "POST",
        url: "projects",
        data: { projectNumber, name, description, projectAmount, executor },
      });

      setResult(res.data);
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setProjectNumber("");
      setName("");
      setDescription("");
      setProjectAmount("");
      setExecutor("");
      setError("");
      setResult(null);
    }, 250);
  }

  const title = result ? translate("Project Created", "تم إنشاء المشروع") : translate("Create Project", "إنشاء مشروع");

  return (
    <Modal opened={opened} onClose={handleClose} title={title} size="lg">
      {result ? (
        <div className="flex flex-col gap-4">
          <Alert color="green" icon={<outlineIcons.ShieldCheck />}>
            {translate("Project created successfully.", "تم إنشاء المشروع بنجاح.")}
            <br />
            {translate(
              `Journal entry #${result.journalEntry.entryNumber} created successfully.`,
              `تم إنشاء القيد اليومي رقم ${result.journalEntry.entryNumber} بنجاح.`,
            )}
          </Alert>
          <div className="flex gap-2">
            <Button
              variant="light"
              fullWidth
              onClick={() => {
                onCreated(result.project);
                handleClose();
              }}
            >
              {translate("View Project", "عرض المشروع")}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && <ErrorAlert error={error} />}

          <Alert color="blue" variant="light">
            {translate(
              "Creating a project will also automatically post its accounting journal entry (Dr Accounts Receivable / Cr Unearned Revenue).",
              "سيؤدي إنشاء المشروع أيضًا إلى ترحيل قيد يومية محاسبي تلقائيًا (مدين ذمم مدينة / دائن إيرادات غير مكتسبة).",
            )}
          </Alert>

          <TextInput
            label={translate("Project Number", "رقم المشروع")}
            placeholder={translate("Enter a unique project number", "أدخل رقم مشروع فريد")}
            value={projectNumber}
            onChange={(e) => setProjectNumber(e.target.value)}
            required
          />

          <TextInput
            label={translate("Project Name", "اسم المشروع")}
            placeholder={translate("Enter project name (optional)", "أدخل اسم المشروع (اختياري)")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <Textarea
            label={translate("Description", "الوصف")}
            placeholder={translate("Enter description (optional)", "أدخل الوصف (اختياري)")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            autosize
            minRows={2}
          />

          <NumberInput
            label={translate("Project Amount", "قيمة المشروع")}
            placeholder={translate("Enter contract amount", "أدخل قيمة العقد")}
            value={projectAmount}
            onChange={setProjectAmount}
            min={0.01}
            decimalScale={2}
            required
          />

          <Select
            label={translate("Executor (المنفذ)", "المنفذ")}
            placeholder={translate("Select executor", "اختر المنفذ")}
            value={executor}
            onChange={(value) => setExecutor(value || "")}
            data={staff.map((s) => ({ value: s._id, label: s.name }))}
            searchable
            required
          />

          <Button type="submit" loading={loading} mt="md">
            {translate("Create Project", "إنشاء مشروع")}
          </Button>
        </form>
      )}
    </Modal>
  );
}
