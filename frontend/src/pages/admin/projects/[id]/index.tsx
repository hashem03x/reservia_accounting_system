import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Badge, Button, NumberInput, Progress, Select, Table, Textarea, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import ErrorAlert from "@/components/ui/error-alert";
import paths from "@/utils/constants/paths";
import { AverageCostLineInput, Project } from "@/types/project";
import { Customer } from "@/types/customer";
import { JournalEntry } from "@/types/journal-entry";
import ProjectContractSection from "../_components/project-contract-section";
import CustomerSearch from "@/components/global/customer-search";
import AverageCostEditor from "../_components/average-cost-editor";
import { ProjectSectors } from "@/utils/constants/accounting";
import { AdvancedPayment } from "@/types/advanced-payment";

const advanceStatusColors: Record<string, string> = { available: "green", partially_used: "yellow", fully_used: "gray", cancelled: "red" };

const statusColors: Record<string, string> = { active: "green", completed: "blue", cancelled: "red", on_hold: "yellow" };
const statusOptions = ["active", "completed", "cancelled", "on_hold"];

export default function ProjectDetail() {
  const { id } = useParams();
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const canEdit = useHasPermission(resources.projects, actions.update);

  const { privateRequest, loading, setLoading, error, setError, data: project, setData: setProject } = useDataHandler<Project | null>({
    initialData: null,
    initialLoading: true,
  });

  const {
    privateRequest: entriesRequest,
    loading: entriesLoading,
    data: entries,
    setData: setEntries,
  } = useDataHandler<JournalEntry[]>({ initialData: [], initialLoading: true });

  const { privateRequest: advancesRequest, data: advances, setData: setAdvances } = useDataHandler<AdvancedPayment[]>({ initialData: [] });

  useDocumentTitle(project ? `${project.projectNumber} | ${translations.pages.projects}` : translations.pages.projects);

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `projects/${id}`, language });
      setProject(res.data);
      const entriesRes = await entriesRequest({ url: `projects/${id}/journal-entries`, language });
      setEntries(entriesRes.data);
      // Retrieved from the Advanced Payment records themselves (docs section "Project Advanced
      // Payment Display") - never duplicated/stored on the Project document.
      const advancesRes = await advancesRequest({ url: "advanced-payments", params: { project: id as string, type: "customer" }, language });
      setAdvances(advancesRes.data);
    });
  }

  useEffect(() => {
    load();
  }, [id]);

  // Inline edit state
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("");
  const [sector, setSector] = useState("");
  const [executedPercentage, setExecutedPercentage] = useState<string | number>(0);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [deliveryDate, setDeliveryDate] = useState<Date | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [averageCostLines, setAverageCostLines] = useState<AverageCostLineInput[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const editDeliveryBeforeStartError =
    startDate && deliveryDate && deliveryDate < startDate
      ? translate("Delivery date cannot be before the start date.", "لا يمكن أن يكون تاريخ التسليم قبل تاريخ البدء.")
      : undefined;

  function startEdit() {
    if (!project) return;
    setName(project.name || "");
    setDescription(project.description || "");
    setStatus(project.status);
    setSector(project.sector || "");
    setExecutedPercentage(project.executedPercentage ?? 0);
    setStartDate(project.startDate ? new Date(project.startDate) : null);
    setDeliveryDate(project.deliveryDate ? new Date(project.deliveryDate) : null);
    // CustomerSearch only ever reads `.name`/`._id` off this object - the populated customer
    // sub-document here carries fewer fields than the full Customer type, which is fine at runtime.
    setCustomer((project.customer as unknown as Customer) || null);
    setAverageCostLines((project.averageCostLines || []).map((l) => ({ account: l.account._id, amount: l.amount })));
    setEditing(true);
  }

  async function handleSave() {
    handleRequest(language, setSaving, setSaveError, async () => {
      const cleanedAverageCostLines = averageCostLines.filter((l) => l.account && l.amount !== "" && l.amount != null);

      const res = await privateRequest({
        url: `projects/${id}`,
        method: "PATCH",
        data: {
          name,
          description,
          status,
          sector: sector || null,
          executedPercentage,
          startDate,
          deliveryDate,
          customer: customer?._id || null,
          averageCostLines: cleanedAverageCostLines,
        },
        language,
      });
      setProject(res.data);
      setEditing(false);
    });
  }

  if (loading) return <LoadingSection message={translate("Loading project...", "جاري تحميل المشروع...")} />;
  if (error) return <ErrorSection errorTitle={translate("Error loading project", "خطأ في تحميل المشروع")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />;
  if (!project) return null;

  return (
    <AdminLayoutBox
      header={{
        title: project.projectNumber,
        subTitle: project.name,
        backLink: `/${paths.admin}/${paths.projects}`,
        sideElements: canEdit && !editing && (
          <Button variant="light" onClick={startEdit}>
            {translate("Edit", "تعديل")}
          </Button>
        ),
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* contractValue/remainingMoney can be missing on a project created before the
            projectAmount->contractValue rename that hasn't been through
            migrateProjectFieldRenames.js yet - shown as "-", never fabricated as 0 (that would
            misrepresent a real contract's value). */}
        <SummaryCard
          label={translate("Contract Value", "قيمة العقد")}
          value={project.contractValue != null ? `${project.contractValue.toLocaleString()} ${translations.currency}` : "-"}
        />
        <SummaryCard
          label={translate("Remaining", "المتبقي")}
          value={project.remainingMoney != null ? `${project.remainingMoney.toLocaleString()} ${translations.currency}` : "-"}
        />
        <SummaryCard label={translate("Project Manager", "مدير المشروع")} value={project.projectManager?.name || "-"} />
        <SummaryCard label={translate("Customer", "العميل")} value={project.customer?.name || "-"} />
        <SummaryCard label={translate("Sector", "القطاع")} value={project.sector || "-"} />
        <SummaryCard label={translate("Start Date", "تاريخ البدء")} value={project.startDate ? formatDate(project.startDate, language) : "-"} />
        <SummaryCard label={translate("Delivery Date", "تاريخ التسليم")} value={project.deliveryDate ? formatDate(project.deliveryDate, language) : "-"} />
        <SummaryCard
          label={translate("Status", "الحالة")}
          value={<Badge color={statusColors[project.status] || "gray"}>{project.status}</Badge>}
        />
        <SummaryCard
          label={translate("Average Cost", "متوسط التكلفة")}
          value={project.averageCost != null ? `${project.averageCost.toLocaleString()} ${translations.currency}` : "-"}
        />
        <SummaryCard
          label={translate("Executed Percentage", "نسبة المنفذ")}
          value={
            <div className="flex flex-col gap-1">
              <span>{project.executedPercentage ?? 0}%</span>
              <Progress value={project.executedPercentage ?? 0} size="sm" color="cyan" />
            </div>
          }
        />
      </div>

      {editing ? (
        <div className="mt-4 flex flex-col gap-4 rounded-lg border border-gray-200 p-4">
          {saveError && <ErrorAlert error={saveError} />}
          <TextInput label={translate("Project Name", "اسم المشروع")} value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea label={translate("Description", "الوصف")} value={description} onChange={(e) => setDescription(e.target.value)} autosize minRows={2} />
          <Select
            label={translate("Status", "الحالة")}
            value={status}
            onChange={(v) => setStatus(v || "active")}
            data={statusOptions.map((s) => ({ value: s, label: s }))}
          />
          <Select
            label={translate("Sector", "القطاع")}
            value={sector}
            onChange={(v) => setSector(v || "")}
            data={ProjectSectors.map((s) => ({ value: s, label: s }))}
            clearable
          />
          <NumberInput
            label={translate("Executed Percentage", "نسبة المنفذ")}
            value={executedPercentage}
            onChange={setExecutedPercentage}
            min={0}
            max={100}
            decimalScale={2}
            suffix="%"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <DateInput
              label={translate("Start Date", "تاريخ البدء")}
              value={startDate}
              onChange={setStartDate}
            />
            <DateInput
              label={translate("Delivery Date", "تاريخ التسليم")}
              value={deliveryDate}
              onChange={setDeliveryDate}
              minDate={startDate || undefined}
              error={editDeliveryBeforeStartError}
            />
          </div>

          <CustomerSearch
            customer={customer}
            setCustomer={setCustomer}
            label={translate("Customer", "العميل")}
            placeholder={translate("Search for a customer", "ابحث عن عميل")}
          />

          <AverageCostEditor lines={averageCostLines} setLines={setAverageCostLines} />

          <div className="flex gap-2">
            <Button loading={saving} disabled={!!editDeliveryBeforeStartError} onClick={handleSave}>
              {translations.confirm}
            </Button>
            <Button variant="light" color="dark" onClick={() => setEditing(false)}>
              {translations.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {project.description && <p className="mt-4 text-gray-600">{project.description}</p>}

          <div className="mt-6 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h4>{translate("Advanced Payment", "الدفعة المقدمة")}</h4>
              <Button
                variant="light"
                size="xs"
                onClick={() => navigate(`/${paths.admin}/${paths.advancedPayments}?project=${project._id}`)}
              >
                {translate("View Advanced Payments", "عرض الدفعات المقدمة")}
              </Button>
            </div>
            {advances.length === 0 ? (
              <p className="text-sm text-gray-400">{translate("No advanced payments for this project yet.", "لا توجد دفعات مقدمة لهذا المشروع بعد.")}</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <SummaryCard label={translate("Customer", "العميل")} value={project.customer?.name || "-"} />
                <SummaryCard
                  label={translate("Available", "المتاح")}
                  value={`${advances.reduce((sum, a) => sum + (a.status !== "cancelled" ? a.remainingAmount : 0), 0).toLocaleString()} ${advances[0]?.currency || translations.currency}`}
                />
                <SummaryCard
                  label={translate("Status", "الحالة")}
                  value={<Badge color={advanceStatusColors[advances[0]?.status] || "gray"}>{advances[0]?.status}</Badge>}
                />
              </div>
            )}
          </div>

          {project.averageCostLines && project.averageCostLines.length > 0 && (
            <div className="mt-6">
              <h4>{translate("Average Cost", "متوسط التكلفة")}</h4>
              <Table striped highlightOnHover mt="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Cost Account", "حساب التكلفة")}</Table.Th>
                    <Table.Th>{translate("Amount", "المبلغ")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {project.averageCostLines.map((line, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>
                        {line.account.code} - {line.account.name}
                      </Table.Td>
                      <Table.Td>
                        {line.amount.toLocaleString()} {translations.currency}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
                <Table.Tfoot>
                  <Table.Tr className="font-bold">
                    <Table.Td>{translate("Total Average Cost", "إجمالي متوسط التكلفة")}</Table.Td>
                    <Table.Td>
                      {(project.averageCost || 0).toLocaleString()} {translations.currency}
                    </Table.Td>
                  </Table.Tr>
                </Table.Tfoot>
              </Table>
            </div>
          )}
        </>
      )}

      <div className="mt-6">
        <ProjectContractSection project={project} onChange={(contract) => setProject({ ...project, contract })} />
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <h4>{translate("Journal Entries", "القيود اليومية")}</h4>
        {entriesLoading ? (
          <LoadingSection message={translate("Loading journal entries...", "جاري تحميل القيود...")} />
        ) : entries.length === 0 ? (
          <EmptySection message={translate("No journal entries for this project yet", "لا توجد قيود يومية لهذا المشروع بعد")} />
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Entry #", "رقم القيد")}</Table.Th>
                <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                <Table.Th>{translate("Source", "المصدر")}</Table.Th>
                <Table.Th>{translate("Description", "الوصف")}</Table.Th>
                <Table.Th>{translate("Debit", "مدين")}</Table.Th>
                <Table.Th>{translate("Credit", "دائن")}</Table.Th>
                <Table.Th>{translate("Status", "الحالة")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map((entry) => (
                <Table.Tr
                  key={entry._id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/${paths.admin}/${paths.journalEntries}/${entry._id}`)}
                >
                  <Table.Td>{entry.entryNumber}</Table.Td>
                  <Table.Td>{formatDate(entry.date, language)}</Table.Td>
                  <Table.Td>{entry.source}</Table.Td>
                  <Table.Td>{entry.description}</Table.Td>
                  <Table.Td>{entry.totalDebit.toLocaleString()}</Table.Td>
                  <Table.Td>{entry.totalCredit.toLocaleString()}</Table.Td>
                  <Table.Td>
                    <Badge color={entry.status === "posted" ? "green" : entry.status === "reversed" ? "gray" : "yellow"}>
                      {entry.status}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </div>
    </AdminLayoutBox>
  );
}

function SummaryCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
    </div>
  );
}
