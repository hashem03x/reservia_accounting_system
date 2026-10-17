import { Requisition } from "@/types/requisition";
import { PaginatedData } from "@/types/global";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import paths from "@/utils/constants/paths";
import { Badge, Button, Select, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import TruncatedText from "@/components/ui/truncated-text";
import { requisitionStatusColors, useRequisitionStatusLabel } from "./_components/status";

const ITEMS_PER_PAGE = import.meta.env.VITE_ITEMS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

export default function PurchaseRequisitions() {
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const canCreate = useHasPermission(resources.purchaseRequisitions, actions.create);
  const statusLabel = useRequisitionStatusLabel();

  useDocumentTitle(`${translations.pages.purchaseRequisitions} | ${translations.adminPanel}`);

  const [searchParams, setSearchParams] = useSearchParams();
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");

  const params: Record<string, string> = { page: activePage.toString() };
  if (statusFilter) params.status = statusFilter;

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: paginatedRequisitions,
    setData: setPaginatedRequisitions,
  } = useDataHandler<PaginatedData<Requisition>>({ initialData: null, initialLoading: true });

  function load() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "requisitions",
        params: { limit: ITEMS_PER_PAGE, sort: "-createdAt", ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedRequisitions(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    setSearchParams({ page: activePage.toString(), ...(statusFilter ? { status: statusFilter } : {}) }, { replace: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    const cancelRequest = load();
    return cancelRequest;
  }, [activePage, statusFilter]);

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.purchaseRequisitions,
        sideElements: canCreate && (
          <Button color="cyan" variant="light" onClick={() => navigate(paths.new)}>
            {translate("New Purchase Order", "أمر شراء جديد")}
          </Button>
        ),
      }}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Select
          placeholder={translate("Filter by status", "تصفية حسب الحالة")}
          value={statusFilter || null}
          onChange={(v) => {
            setActivePage(1);
            setStatusFilter(v || "");
          }}
          data={[
            { value: "draft", label: translate("Draft", "مسودة") },
            { value: "open", label: translate("Open", "مفتوح") },
            { value: "cancelled", label: translate("Cancelled", "ملغي") },
          ]}
          clearable
          w={200}
        />
      </div>

      {loading ? (
        <LoadingSection message={translate("Loading purchase orders...", "جاري تحميل أوامر الشراء...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading purchase orders", "خطأ في تحميل أوامر الشراء")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }}
        />
      ) : (
        paginatedRequisitions &&
        (paginatedRequisitions.data.length === 0 ? (
          <EmptySection useDefaultImg message={translate("No purchase orders found", "لا توجد أوامر شراء")} />
        ) : (
          <>
            <DataTableContainer>
              <DataTable className="min-w-[1080px]">
                <Table.Thead className={dataTableHeadClassName}>
                  <Table.Tr>
                    <Table.Th className="whitespace-nowrap">{translate("Code", "الكود")}</Table.Th>
                    <Table.Th>{translate("Vendor", "البائع")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Project", "المشروع")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Amount", "القيمة")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Invoiced", "المفوتر")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Remaining", "المتبقي")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Executed %", "نسبة التنفيذ")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Date", "التاريخ")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Actions", "الإجراءات")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedRequisitions.data.map((requisition) => (
                    <Table.Tr key={requisition._id} className="cursor-pointer" onClick={() => navigate(requisition._id)}>
                      <Table.Td className="whitespace-nowrap font-medium">{requisition.code}</Table.Td>
                      <Table.Td>
                        <TruncatedText
                          text={requisition.vendorId?.name || "-"}
                          maxWidthClassName="max-w-[160px] sm:max-w-[200px]"
                        />
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">{requisition.project?.projectNumber || "-"}</Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">
                        {requisition.amount.toLocaleString()}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">
                        {requisition.invoicedAmount.toLocaleString()}
                      </Table.Td>
                      <Table.Td
                        className={`whitespace-nowrap text-right tabular-nums ${requisition.remainingAmount > 0 ? "font-semibold text-green-700" : ""}`}
                      >
                        {requisition.remainingAmount.toLocaleString()}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">
                        {requisition.executedPercentage.toFixed(2)}%
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        <Badge color={requisitionStatusColors[requisition.effectiveStatus] || "gray"} variant="light">
                          {statusLabel(requisition.effectiveStatus)}
                        </Badge>
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">{formatDate(requisition.createdAt, language)}</Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        <Button
                          variant="light"
                          size="xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(requisition._id);
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

            <PaginationHandler
              paginatedData={paginatedRequisitions}
              activePage={activePage}
              setActivePage={setActivePage}
            />
          </>
        ))
      )}
    </AdminLayoutBox>
  );
}
