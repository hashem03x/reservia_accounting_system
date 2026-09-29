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
import { Badge, Button, Select, Table, Textarea, TextInput } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import ErrorAlert from "@/components/ui/error-alert";
import paths from "@/utils/constants/paths";
import { Project } from "@/types/project";
import { JournalEntry } from "@/types/journal-entry";
import ProjectContractSection from "../_components/project-contract-section";
import { ProjectDepartments } from "@/utils/constants/accounting";

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

  useDocumentTitle(project ? `${project.projectNumber} | ${translations.pages.projects}` : translations.pages.projects);

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `projects/${id}`, language });
      setProject(res.data);
      const entriesRes = await entriesRequest({ url: `projects/${id}/journal-entries`, language });
      setEntries(entriesRes.data);
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
  const [department, setDepartment] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  function startEdit() {
    if (!project) return;
    setName(project.name || "");
    setDescription(project.description || "");
    setStatus(project.status);
    setDepartment(project.department || "");
    setEditing(true);
  }

  async function handleSave() {
    handleRequest(language, setSaving, setSaveError, async () => {
      const res = await privateRequest({
        url: `projects/${id}`,
        method: "PATCH",
        data: { name, description, status, department: department || null },
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard label={translate("Project Amount", "قيمة المشروع")} value={`${project.projectAmount.toLocaleString()} ${translations.currency}`} />
        <SummaryCard label={translate("Remaining", "المتبقي")} value={`${project.remainingMoney.toLocaleString()} ${translations.currency}`} />
        <SummaryCard label={translate("Executor", "المنفذ")} value={project.executor?.name || "-"} />
        <SummaryCard label={translate("Department", "القسم")} value={project.department || "-"} />
        <SummaryCard
          label={translate("Status", "الحالة")}
          value={<Badge color={statusColors[project.status] || "gray"}>{project.status}</Badge>}
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
            label={translate("Department", "القسم")}
            value={department}
            onChange={(v) => setDepartment(v || "")}
            data={ProjectDepartments.map((d) => ({ value: d, label: d }))}
            clearable
          />
          <div className="flex gap-2">
            <Button loading={saving} onClick={handleSave}>
              {translations.confirm}
            </Button>
            <Button variant="light" color="dark" onClick={() => setEditing(false)}>
              {translations.cancel}
            </Button>
          </div>
        </div>
      ) : (
        project.description && <p className="mt-4 text-gray-600">{project.description}</p>
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
