import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import { ActionIcon, Badge, Button, Select, Table, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { PaginatedData } from "@/types/global";
import { COMMERCIAL_CATEGORIES, CommercialCategory, CommercialProject } from "@/types/commercial";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import { outlineIcons, solidIcons } from "@/components/icons";
import paths from "@/utils/constants/paths";
import { categoryLabel } from "../_shared/categoryLabel";
import CreateProjectModal from "./_components/create-project-modal";

export default function CommercialProjects() {
  const { language, translate } = useLanguage();
  const navigate = useNavigate();
  const catLabel = categoryLabel(translate);

  useDocumentTitle(`${translate("Projects", "المشاريع")} | Reservia Commercial`);

  const [searchParams, setSearchParams] = useSearchParams();
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));
  const [category, setCategory] = useState<CommercialCategory | "">((searchParams.get("category") as CommercialCategory) || "");

  // QA B1: edit an existing project from the list (same form as New Project, writing to that project).
  const [editing, setEditing] = useState<CommercialProject | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const params = { page: activePage.toString(), ...(category ? { category } : {}) };

  const { privateRequest, loading, setLoading, error, setError, data: paginatedProjects, setData: setPaginatedProjects } = useDataHandler<PaginatedData<CommercialProject>>({
    initialData: null,
    initialLoading: true,
  });

  useEffect(() => {
    setSearchParams(params, { replace: true });
    const controller = new AbortController();
    const canceled = { current: false };
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: "commercial/projects", params: { sort: "-createdAt", ...params }, signal: controller.signal, language });
      if (!canceled.current) setPaginatedProjects(res as PaginatedData<CommercialProject>);
    }, canceled);
    return () => {
      controller.abort();
      canceled.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, category, reloadKey]);

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  return (
    <AdminLayoutBox
      header={{
        title: translate("Commercial Projects", "المشاريع التجارية"),
        sideElements: (
          <Button onClick={openModal} color="teal" leftSection={<solidIcons.Plus />}>
            {translate("New Project", "مشروع جديد")}
          </Button>
        ),
      }}
    >
      <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-gray-100 p-3 sm:grid-cols-3">
        <Select
          label={translate("Category", "الفئة")}
          placeholder={translate("All categories", "كل الفئات")}
          clearable
          data={COMMERCIAL_CATEGORIES.map((c) => ({ value: c, label: catLabel(c) }))}
          value={category || null}
          onChange={(v) => (setActivePage(1), setCategory((v as CommercialCategory) || ""))}
        />
      </div>

      {error ? (
        <ErrorSection errorTitle={translate("Error loading projects", "خطأ في تحميل المشاريع")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: () => setActivePage((p) => p) }} />
      ) : loading ? (
        <LoadingSection />
      ) : !paginatedProjects?.data.length ? (
        <EmptySection useDefaultImg message={translate("No commercial projects yet", "لا توجد مشاريع تجارية بعد")} />
      ) : (
        <>
          <DataTableContainer>
            <DataTable>
              <Table.Thead className={dataTableHeadClassName}>
                <Table.Tr>
                  <Table.Th>{translate("Project Code", "رمز المشروع")}</Table.Th>
                  <Table.Th>{translate("Deal #", "رقم الصفقة")}</Table.Th>
                  <Table.Th>{translate("Name", "الاسم")}</Table.Th>
                  <Table.Th>{translate("Customer", "العميل")}</Table.Th>
                  <Table.Th>{translate("Category", "الفئة")}</Table.Th>
                  <Table.Th>{translate("Country / Region", "الدولة / المنطقة")}</Table.Th>
                  <Table.Th>{translate("Engineering", "الهندسة")}</Table.Th>
                  <Table.Th>{translate("Commercial", "التجاري")}</Table.Th>
                  <Table.Th>{translate("Outcome", "النتيجة")}</Table.Th>
                  <Table.Th>{translate("Created", "تاريخ الإنشاء")}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {paginatedProjects.data.map((p) => (
                  <Table.Tr key={p._id} className="cursor-pointer" onClick={() => navigate(`/${paths.commercial}/${paths.commercialProjects}/${p._id}`)}>
                    <Table.Td className="font-medium text-primary-600">{p.projectCode}</Table.Td>
                    <Table.Td className="whitespace-nowrap text-xs text-gray-600">
                      {p.dealNumber || "-"}
                      {p.crmLeadRef && <div className="text-[11px] text-gray-400">{translate("Lead", "العميل المحتمل")} {p.crmLeadRef}</div>}
                    </Table.Td>
                    <Table.Td>{p.name}</Table.Td>
                    <Table.Td>{p.customer?.name || "-"}</Table.Td>
                    <Table.Td>{catLabel(p.category)}</Table.Td>
                    <Table.Td>{[p.country, p.region].filter(Boolean).join(" - ")}</Table.Td>
                    <Table.Td>
                      <Badge color={p.engineeringApprovalRollup === "APPROVED" ? "teal" : "gray"} variant="light">
                        {p.engineeringApprovalRollup}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={p.commercialApprovalRollup === "APPROVED" ? "teal" : "gray"} variant="light">
                        {p.commercialApprovalRollup}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={p.outcome === "Won" ? "teal" : p.outcome === "Lost" ? "red" : "gray"} variant="light">
                        {p.outcome || "Open"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{dayjs(p.createdAt).format("DD MMM YYYY")}</Table.Td>
                    <Table.Td onClick={(e) => e.stopPropagation()}>
                      <Tooltip label={translate("Edit project", "تعديل المشروع")}>
                        <ActionIcon variant="subtle" color="gray" aria-label={translate("Edit project", "تعديل المشروع")} onClick={() => setEditing(p)}>
                          <outlineIcons.Edit />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </DataTable>
          </DataTableContainer>
          <PaginationHandler paginatedData={paginatedProjects} activePage={activePage} setActivePage={setActivePage} />
        </>
      )}

      <CreateProjectModal opened={modalOpened} onClose={closeModal} />
      <CreateProjectModal opened={!!editing} project={editing} onClose={() => setEditing(null)} onSaved={() => setReloadKey((k) => k + 1)} />
    </AdminLayoutBox>
  );
}
