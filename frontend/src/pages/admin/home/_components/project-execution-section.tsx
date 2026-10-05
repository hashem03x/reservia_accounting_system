import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Table } from "@mantine/core";
import { Project } from "@/types/project";
import { PaginatedData } from "@/types/global";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { formatCurrency } from "@/utils/helpers/format-currency";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import paths from "@/utils/constants/paths";
import SectionCard from "@/components/ui/section-card";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import TruncatedText from "@/components/ui/truncated-text";
import EmptySection from "@/components/ui/sections/empty";
import ErrorSection from "@/components/ui/sections/error";
import LoadingSection from "@/components/ui/sections/loading";

const statusColors: Record<string, string> = { active: "green", completed: "blue", cancelled: "red", on_hold: "yellow" };

// Project Execution summary (docs section "Project Execution") - a compact slice of the full
// Projects page (5 active projects, soonest delivery first - the ones most worth a glance here),
// not a duplicate of it. Executed % is read as-is from the Project API, which already computes it
// server-side (Sales Amount Without Taxes / Contract Value x 100) - never recomputed here.
export default function ProjectExecutionSection() {
  const { language, translate } = useLanguage();
  const navigate = useNavigate();
  const canRead = useHasPermission(resources.projects, actions.read);

  const { privateRequest, loading, setLoading, error, setError, data, setData } =
    useDataHandler<PaginatedData<Project> | null>({
      initialData: null,
      initialLoading: true,
    });

  function load() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "projects",
        params: { limit: "5", status: "active", sort: "deliveryDate" },
        signal: controller.signal,
        language,
      });
      setData(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    if (!canRead) return;
    const cancelRequest = load();
    return cancelRequest;
  }, [canRead]);

  if (!canRead) return null;

  return (
    <SectionCard
      title={translate("Project Execution", "تنفيذ المشاريع")}
      viewAllTo={`/${paths.admin}/${paths.projects}`}
      viewAllLabel={translate("View all", "عرض الكل")}
    >
      {loading ? (
        <LoadingSection message={translate("Loading projects...", "جاري تحميل المشاريع...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading projects", "خطأ في تحميل المشاريع")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptySection useDefaultImg message={translate("No active projects yet", "لا توجد مشاريع نشطة")} />
      ) : (
        <DataTableContainer>
          <DataTable className="min-w-[560px]">
            <Table.Thead className={dataTableHeadClassName}>
              <Table.Tr>
                <Table.Th>{translate("Project", "المشروع")}</Table.Th>
                <Table.Th className="whitespace-nowrap text-right">{translate("Contract Value", "قيمة العقد")}</Table.Th>
                <Table.Th className="whitespace-nowrap text-right">{translate("Executed %", "نسبة المنفذ")}</Table.Th>
                <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.data.map((project) => (
                <Table.Tr
                  key={project._id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/${paths.admin}/${paths.projects}/${project._id}`)}
                >
                  <Table.Td>
                    <TruncatedText
                      text={`${project.projectNumber}${project.name ? ` - ${project.name}` : ""}`}
                      maxWidthClassName="max-w-[220px]"
                    />
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap text-right tabular-nums">
                    {project.contractValue != null ? formatCurrency(project.contractValue, language) : "-"}
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap text-right tabular-nums">
                    {project.executedPercentage ?? 0}%
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap">
                    <Badge color={statusColors[project.status] || "gray"} variant="light">
                      {project.status}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </DataTable>
        </DataTableContainer>
      )}
    </SectionCard>
  );
}
