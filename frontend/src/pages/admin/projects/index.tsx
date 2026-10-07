import { Project } from "@/types/project";
import { PaginatedData } from "@/types/global";
import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import { formatAmount } from "@/utils/helpers/format-amount";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Badge, Button, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import { outlineIcons } from "@/components/icons";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import TruncatedText from "@/components/ui/truncated-text";
import CreateProjectModal from "./_components/create-project-modal";

const ITEMS_PER_PAGE = import.meta.env.VITE_ITEMS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

const statusColors: Record<string, string> = {
  active: "green",
  completed: "blue",
  cancelled: "red",
  on_hold: "yellow",
};

export default function Projects() {
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const canCreate = useHasPermission(resources.projects, actions.create);

  useDocumentTitle(`${translations.pages.projects} | ${translations.adminPanel}`);

  const [searchParams, setSearchParams] = useSearchParams();
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));

  const params = { page: activePage.toString() };

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: paginatedProjects,
    setData: setPaginatedProjects,
  } = useDataHandler<PaginatedData<Project>>({ initialData: null, initialLoading: true });

  function handleLoadProjects() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "projects",
        params: { limit: ITEMS_PER_PAGE, ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedProjects(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    setSearchParams(params, { replace: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    const cancelRequest = handleLoadProjects();
    return cancelRequest;
  }, [activePage]);

  const [createModalOpened, { open: openCreateModal, close: closeCreateModal }] = useDisclosure();

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.projects,
        sideElements: canCreate && (
          <Button color="cyan" variant="light" onClick={openCreateModal}>
            {translate("Create Project", "إنشاء مشروع")}
          </Button>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading projects...", "جاري تحميل المشاريع...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading projects", "خطأ في تحميل المشاريع")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadProjects }}
        />
      ) : (
        paginatedProjects &&
        (paginatedProjects.data.length === 0 ? (
          <EmptySection useDefaultImg message={translate("No projects found", "لا توجد مشاريع")} />
        ) : (
          <>
            {/* Shared table visual system (see components/ui/data-table.tsx) - same container/
                header/row presentation as Chart of Accounts; columns below are Projects' own. */}
            <DataTableContainer>
              <DataTable className="min-w-[1180px]">
                <Table.Thead className={dataTableHeadClassName}>
                  <Table.Tr>
                    <Table.Th className="whitespace-nowrap">{translate("Project Number", "رقم المشروع")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Sector", "القطاع")}</Table.Th>
                    <Table.Th>{translate("Name", "الاسم")}</Table.Th>
                    <Table.Th>{translate("Customer", "العميل")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Contract Value", "قيمة العقد")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Remaining", "المتبقي")}</Table.Th>
                    <Table.Th>{translate("Project Manager", "مدير المشروع")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Start Date", "تاريخ البدء")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Delivery Date", "تاريخ التسليم")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Executed %", "نسبة المنفذ")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Contract", "العقد")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Actions", "الإجراءات")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedProjects.data.map((project) => (
                    <Table.Tr key={project._id} className="cursor-pointer" onClick={() => navigate(project._id)}>
                      <Table.Td className="whitespace-nowrap font-medium">{project.projectNumber}</Table.Td>
                      <Table.Td className="whitespace-nowrap">{project.sector || "-"}</Table.Td>
                      <Table.Td>
                        <TruncatedText text={project.name || "-"} maxWidthClassName="max-w-[160px] sm:max-w-[220px]" />
                      </Table.Td>
                      <Table.Td>
                        <TruncatedText
                          text={project.customer?.name || "-"}
                          maxWidthClassName="max-w-[140px] sm:max-w-[180px]"
                        />
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">
                        {/* Missing only for a project created before the projectAmount->contractValue
                            rename that hasn't been through migrateProjectFieldRenames.js yet - shown
                            as "-", never fabricated as 0, since that would misrepresent a real
                            contract's value. */}
                        {formatAmount(project.contractValue, translations.currency)}
                      </Table.Td>
                      {/* Same backend-computed value as the Project details page. */}
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">
                        {formatAmount(project.remainingMoney, translations.currency)}
                      </Table.Td>
                      <Table.Td>{project.projectManager?.name || "-"}</Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        {project.startDate ? formatDate(project.startDate, language) : "-"}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        {project.deliveryDate ? formatDate(project.deliveryDate, language) : "-"}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        <Badge color={statusColors[project.status] || "gray"} variant="light">
                          {project.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">
                        {project.executedPercentage ?? 0}%
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        {project.contract ? (
                          <outlineIcons.Document className="text-green-600" size={18} />
                        ) : (
                          <span className="text-xs text-gray-400">{translate("None", "لا يوجد")}</span>
                        )}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        <Button
                          variant="light"
                          size="xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(project._id);
                          }}
                        >
                          {translate("View", "عرض")}
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </DataTable>
            </DataTableContainer>

            <PaginationHandler paginatedData={paginatedProjects} activePage={activePage} setActivePage={setActivePage} />
          </>
        ))
      )}

      <CreateProjectModal
        opened={createModalOpened}
        close={closeCreateModal}
        onCreated={(project) => navigate(project._id)}
      />
    </AdminLayoutBox>
  );
}
