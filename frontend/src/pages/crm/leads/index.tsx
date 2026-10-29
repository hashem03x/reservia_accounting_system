import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import { formatAmount } from "@/utils/helpers/format-amount";
import { PaginatedData } from "@/types/global";
import { CRM_SEGMENTS, CRM_STAGES, CrmLead, CrmSegment, CrmStage } from "@/types/crm";
import { Badge, Button, Select, Table, TextInput } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import { ClickableRow } from "@/components/ui/clickable-row";
import TruncatedText from "@/components/ui/truncated-text";
import { solidIcons } from "@/components/icons";
import LeadModal from "@/components/global/lead-modal";
import { crmStageLabel, stageBadgeColor } from "../_shared/stage";

export default function CrmLeads() {
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const stageLabel = crmStageLabel(translate);

  useDocumentTitle(`${translate("Leads", "العملاء المحتملون")} | Reservia CRM`);

  const [searchParams, setSearchParams] = useSearchParams();
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));
  const [stage, setStage] = useState((searchParams.get("stage") as CrmStage) || "");
  const [segment, setSegment] = useState((searchParams.get("segment") as CrmSegment) || "");
  const [q, setQ] = useState(searchParams.get("q") || "");

  const params = {
    page: activePage.toString(),
    ...(stage ? { stage } : {}),
    ...(segment ? { segment } : {}),
    ...(q ? { q } : {}),
  };

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: paginatedLeads,
    setData: setPaginatedLeads,
  } = useDataHandler<PaginatedData<CrmLead>>({ initialData: null, initialLoading: true });

  function handleLoadLeads() {
    const controller = new AbortController();
    const canceled = { current: false };
    const executeFetch = async () => {
      const response = await privateRequest({ url: "crm/leads", params: { sort: "-createdAt", ...params }, signal: controller.signal, language });
      setPaginatedLeads(response);
    };
    handleRequest(language, setLoading, setError, executeFetch, canceled);
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    setSearchParams(params, { replace: true });
    const cancelRequest = handleLoadLeads();
    return cancelRequest;
  }, [activePage, stage, segment, q]);

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  return (
    <AdminLayoutBox
      header={{
        title: translate("Leads", "العملاء المحتملون"),
        sideElements: (
          <Button onClick={openModal} color="teal" leftSection={<solidIcons.Plus />}>
            {translate("New Lead", "عميل محتمل جديد")}
          </Button>
        ),
      }}
    >
      <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-gray-100 p-3 sm:grid-cols-3">
        <TextInput
          value={q}
          onChange={(e) => (setActivePage(1), setQ(e.target.value))}
          label={translate("Search", "بحث")}
          placeholder={translate("Name or reference code", "الاسم أو الرمز المرجعي")}
        />
        <Select
          value={stage || null}
          onChange={(v) => (setActivePage(1), setStage((v as CrmStage) || ""))}
          data={CRM_STAGES.map((s) => ({ value: s, label: stageLabel(s) }))}
          label={translate("Stage", "المرحلة")}
          clearable
        />
        <Select
          value={segment || null}
          onChange={(v) => (setActivePage(1), setSegment((v as CrmSegment) || ""))}
          data={CRM_SEGMENTS.map((s) => ({ value: s, label: s }))}
          label={translate("Segment", "القطاع")}
          clearable
        />
      </div>

      {loading ? (
        <LoadingSection message={translate("Loading leads...", "جاري تحميل العملاء المحتملين...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading leads", "خطأ في تحميل العملاء المحتملين")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadLeads }}
        />
      ) : (
        paginatedLeads &&
        (paginatedLeads.data.length === 0 ? (
          <EmptySection useDefaultImg message={translate("No leads found", "لا يوجد عملاء محتملون")} />
        ) : (
          <>
            <DataTableContainer>
              <DataTable className="min-w-[1100px]">
                <Table.Thead className={dataTableHeadClassName}>
                  <Table.Tr>
                    <Table.Th>{translate("Ref", "الرمز")}</Table.Th>
                    <Table.Th>{translate("Name", "الاسم")}</Table.Th>
                    <Table.Th>{translate("Phone", "الهاتف")}</Table.Th>
                    <Table.Th>{translate("Segment", "القطاع")}</Table.Th>
                    <Table.Th>{translate("Stage", "المرحلة")}</Table.Th>
                    <Table.Th>{translate("Owner", "المسؤول")}</Table.Th>
                    <Table.Th className="text-right">{translate("Value", "القيمة")}</Table.Th>
                    <Table.Th>{translate("Created", "تاريخ الإنشاء")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedLeads.data.map((lead) => (
                    <ClickableRow key={lead._id} className="cursor-pointer" onClick={() => navigate(lead._id)}>
                      <Table.Td className="whitespace-nowrap font-mono text-xs">{lead.refCode}</Table.Td>
                      <Table.Td>
                        <TruncatedText text={lead.name || "-"} maxWidthClassName="max-w-[160px]" />
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">{lead.phoneE164}</Table.Td>
                      <Table.Td className="whitespace-nowrap">{lead.segment}</Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        <Badge color={stageBadgeColor(lead.stage)} variant="light">
                          {stageLabel(lead.stage)}
                        </Badge>
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">{lead.owner?.name || "-"}</Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">
                        {lead.valueEgp ? formatAmount(lead.valueEgp, translations.currency) : "-"}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">{formatDate(lead.createdAt, language)}</Table.Td>
                    </ClickableRow>
                  ))}
                </Table.Tbody>
              </DataTable>
            </DataTableContainer>

            <PaginationHandler<CrmLead> paginatedData={paginatedLeads} activePage={activePage} setActivePage={setActivePage} />
          </>
        ))
      )}

      <LeadModal opened={modalOpened} close={closeModal} callback={(lead) => navigate(lead._id)} />
    </AdminLayoutBox>
  );
}
