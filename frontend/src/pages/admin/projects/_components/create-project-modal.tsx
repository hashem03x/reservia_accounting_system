import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { Button, NumberInput, Select, Textarea, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import useDataHandler from "@/hooks/useDataHandler";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { AverageCostLineInput, Project } from "@/types/project";
import { Customer } from "@/types/customer";
import { ProjectSectors } from "@/utils/constants/accounting";
import CustomerSearch from "@/components/global/customer-search";
import AverageCostEditor from "./average-cost-editor";

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
  const [contractValue, setContractValue] = useState<string | number>("");
  const [projectManager, setProjectManager] = useState("");
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [deliveryDate, setDeliveryDate] = useState<Date | null>(null);
  const [sector, setSector] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [averageCostLines, setAverageCostLines] = useState<AverageCostLineInput[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);

  const { privateRequest: fetchStaffRequest } = useDataHandler({ initialData: null });
  const { loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (!opened) return;
    fetchStaffRequest({ url: "users", params: { limit: 500 }, language })
      .then((res) => setStaff((res.data || []).filter((u: StaffOption) => u.role !== "user")))
      .catch(() => {});
  }, [opened]);

  const deliveryBeforeStartError =
    startDate && deliveryDate && deliveryDate < startDate
      ? translate("Delivery date cannot be before the start date.", "لا يمكن أن يكون تاريخ التسليم قبل تاريخ البدء.")
      : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    handleRequest(language, setLoading, setError, async () => {
      // Drop any Average Cost row the user added but never finished filling in (no account
      // selected yet) - partial rows aren't sent at all, rather than sent incomplete.
      const cleanedAverageCostLines = averageCostLines.filter((l) => l.account && l.amount !== "" && l.amount != null);

      const res = await privateRequest({
        language,
        method: "POST",
        url: "projects",
        data: {
          projectNumber,
          name,
          description,
          contractValue,
          projectManager,
          startDate,
          deliveryDate,
          sector: sector || undefined,
          customer: customer?._id || undefined,
          averageCostLines: cleanedAverageCostLines,
        },
      });

      onCreated(res.data);
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setProjectNumber("");
      setName("");
      setDescription("");
      setContractValue("");
      setProjectManager("");
      setStartDate(null);
      setDeliveryDate(null);
      setSector("");
      setCustomer(null);
      setAverageCostLines([]);
      setError("");
    }, 250);
  }

  const title = translate("Create Project", "إنشاء مشروع");

  return (
    <Modal opened={opened} onClose={handleClose} title={title} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}

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
          label={translate("Contract Value", "قيمة العقد")}
          placeholder={translate("Enter contract value", "أدخل قيمة العقد")}
          value={contractValue}
          onChange={setContractValue}
          min={0.01}
          decimalScale={2}
          required
        />

        <Select
          label={translate("Project Manager", "مدير المشروع")}
          placeholder={translate("Select project manager", "اختر مدير المشروع")}
          value={projectManager}
          onChange={(value) => setProjectManager(value || "")}
          data={staff.map((s) => ({ value: s._id, label: s.name }))}
          searchable
          required
        />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <DateInput
            label={translate("Start Date", "تاريخ البدء")}
            placeholder={translate("Select start date", "اختر تاريخ البدء")}
            value={startDate}
            onChange={setStartDate}
            required
          />
          <DateInput
            label={translate("Delivery Date", "تاريخ التسليم")}
            placeholder={translate("Select delivery date", "اختر تاريخ التسليم")}
            value={deliveryDate}
            onChange={setDeliveryDate}
            minDate={startDate || undefined}
            error={deliveryBeforeStartError}
            required
          />
        </div>

        <Select
          label={translate("Sector", "القطاع")}
          placeholder={translate("Select sector (optional)", "اختر القطاع (اختياري)")}
          value={sector}
          onChange={(value) => setSector(value || "")}
          data={ProjectSectors.map((s) => ({ value: s, label: s }))}
          clearable
        />

        <CustomerSearch
          customer={customer}
          setCustomer={setCustomer}
          label={translate("Customer (optional)", "العميل (اختياري)")}
          placeholder={translate("Search for a customer", "ابحث عن عميل")}
        />

        <AverageCostEditor lines={averageCostLines} setLines={setAverageCostLines} />

        <Button type="submit" loading={loading} disabled={!!deliveryBeforeStartError} mt="md">
          {translate("Create Project", "إنشاء مشروع")}
        </Button>
      </form>
    </Modal>
  );
}
