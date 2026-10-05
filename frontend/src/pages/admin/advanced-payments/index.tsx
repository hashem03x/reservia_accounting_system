import { AdvancedPayment } from "@/types/advanced-payment";
import { PaginatedData } from "@/types/global";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Badge, Button, Select, Table, TextInput } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import TruncatedText from "@/components/ui/truncated-text";
import CreateAdvancedPaymentModal from "./_components/create-advanced-payment-modal";

const ITEMS_PER_PAGE = import.meta.env.VITE_ITEMS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

const statusColors: Record<string, string> = {
  available: "green",
  partially_used: "yellow",
  fully_used: "gray",
  cancelled: "red",
};

export default function AdvancedPayments() {
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const canCreate = useHasPermission(resources.advancedPayments, actions.create);

  useDocumentTitle(`${translations.pages.advancedPayments} | ${translations.adminPanel}`);

  const [searchParams, setSearchParams] = useSearchParams();
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));
  const [typeFilter, setTypeFilter] = useState(searchParams.get("type") || "");
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
  const [keyword, setKeyword] = useState("");
  // Pre-filtered when arriving from the Project detail page's "View Advanced Payments" link (see
  // docs section "Project Advanced Payment Display") - the project filter itself isn't user-facing
  // here, just carried through from the URL.
  const projectFilter = searchParams.get("project") || undefined;

  const params: Record<string, string> = { page: activePage.toString() };
  if (typeFilter) params.type = typeFilter;
  if (statusFilter) params.status = statusFilter;
  if (projectFilter) params.project = projectFilter;
  if (keyword) params.keyword = keyword;

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: paginatedPayments,
    setData: setPaginatedPayments,
  } = useDataHandler<PaginatedData<AdvancedPayment>>({ initialData: null, initialLoading: true });

  function load() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "advanced-payments",
        params: { limit: ITEMS_PER_PAGE, sort: "-createdAt", ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedPayments(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    setSearchParams(
      {
        page: activePage.toString(),
        ...(typeFilter ? { type: typeFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(projectFilter ? { project: projectFilter } : {}),
      },
      { replace: true },
    );
    window.scrollTo({ top: 0, behavior: "instant" });
    const cancelRequest = load();
    return cancelRequest;
  }, [activePage, typeFilter, statusFilter, keyword]);

  const [createModalOpened, { open: openCreateModal, close: closeCreateModal }] = useDisclosure();

  function partyLabel(payment: AdvancedPayment) {
    if (payment.type === "customer") return payment.customer?.name || "-";
    return payment.vendor?.name || "-";
  }

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.advancedPayments,
        sideElements: canCreate && (
          <Button color="cyan" variant="light" onClick={openCreateModal}>
            {translate("Create Advanced Payment", "إنشاء دفعة مقدمة")}
          </Button>
        ),
      }}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Select
          placeholder={translate("Filter by type", "تصفية حسب النوع")}
          value={typeFilter || null}
          onChange={(v) => {
            setActivePage(1);
            setTypeFilter(v || "");
          }}
          data={[
            { value: "customer", label: translate("Customer", "عميل") },
            { value: "vendor", label: translate("Vendor", "بائع") },
          ]}
          clearable
          w={180}
        />
        <Select
          placeholder={translate("Filter by status", "تصفية حسب الحالة")}
          value={statusFilter || null}
          onChange={(v) => {
            setActivePage(1);
            setStatusFilter(v || "");
          }}
          data={[
            { value: "available", label: translate("Available", "متاح") },
            { value: "partially_used", label: translate("Partially Used", "مستخدم جزئياً") },
            { value: "fully_used", label: translate("Fully Used", "مستخدم بالكامل") },
            { value: "cancelled", label: translate("Cancelled", "ملغي") },
          ]}
          clearable
          w={200}
        />
        <TextInput
          placeholder={translate("Search customer/vendor/project/reference...", "ابحث عن عميل/بائع/مشروع/مرجع...")}
          value={keyword}
          onChange={(e) => {
            setActivePage(1);
            setKeyword(e.target.value);
          }}
          w={280}
        />
      </div>

      {loading ? (
        <LoadingSection message={translate("Loading advanced payments...", "جاري تحميل الدفعات المقدمة...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading advanced payments", "خطأ في تحميل الدفعات المقدمة")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }}
        />
      ) : (
        paginatedPayments &&
        (paginatedPayments.data.length === 0 ? (
          <EmptySection useDefaultImg message={translate("No advanced payments found", "لا توجد دفعات مقدمة")} />
        ) : (
          <>
            {/* Shared table visual system (see components/ui/data-table.tsx) - same container/
                header/row presentation as Chart of Accounts; columns below are Advanced Payments'
                own. */}
            <DataTableContainer>
              <DataTable className="min-w-[980px]">
                <Table.Thead className={dataTableHeadClassName}>
                  <Table.Tr>
                    <Table.Th className="whitespace-nowrap">{translate("Type", "النوع")}</Table.Th>
                    <Table.Th>{translate("Customer/Vendor", "العميل/البائع")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Project", "المشروع")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">
                      {translate("Original Amount", "المبلغ الأصلي")}
                    </Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">
                      {translate("Remaining Amount", "المبلغ المتبقي")}
                    </Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Currency", "العملة")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Date", "التاريخ")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Actions", "الإجراءات")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedPayments.data.map((payment) => (
                    <Table.Tr key={payment._id} className="cursor-pointer" onClick={() => navigate(payment._id)}>
                      <Table.Td className="whitespace-nowrap">
                        <Badge color={payment.type === "customer" ? "blue" : "grape"} variant="light">
                          {payment.type === "customer" ? translate("Customer", "عميل") : translate("Vendor", "بائع")}
                        </Badge>
                      </Table.Td>
                      <Table.Td className="font-medium">
                        <TruncatedText text={partyLabel(payment)} maxWidthClassName="max-w-[160px] sm:max-w-[200px]" />
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">{payment.project?.projectNumber || "-"}</Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">
                        {payment.amount.toLocaleString()}
                      </Table.Td>
                      <Table.Td
                        className={`whitespace-nowrap text-right tabular-nums ${payment.remainingAmount > 0 ? "font-semibold text-green-700" : ""}`}
                      >
                        {payment.remainingAmount.toLocaleString()}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">{payment.currency || "-"}</Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        <Badge color={statusColors[payment.status] || "gray"} variant="light">
                          {payment.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">{formatDate(payment.createdAt, language)}</Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        <Button
                          variant="light"
                          size="xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(payment._id);
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

            <PaginationHandler paginatedData={paginatedPayments} activePage={activePage} setActivePage={setActivePage} />
          </>
        ))
      )}

      <CreateAdvancedPaymentModal
        opened={createModalOpened}
        close={closeCreateModal}
        onCreated={(payment) => navigate(payment._id)}
      />
    </AdminLayoutBox>
  );
}
