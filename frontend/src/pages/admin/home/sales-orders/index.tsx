import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHandlePreviousFilters from "@/hooks/useHandlePreviousFilters";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { SalesOrder } from "@/types/orders";
import { PaginatedData } from "@/types/global";
import paths from "@/utils/constants/paths";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import { getPaymentStatusLabel, paymentStatusesArray } from "@/utils/constants/payment-statuses";
import {
  getOrderSourceLabel,
  isCashierOrder,
  isShopifyOrder,
  isWebsiteOrder,
  orderSourcesArray,
} from "@/utils/constants/order-sources";
import { formatDate } from "@/utils/helpers/date-formaters";
import { Badge, Button, Select, Table, TextInput, Tooltip } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import ScannerModal from "./_components/scanner-modal";
import UnauthorizedSection from "@/components/ui/sections/unauthorized";
import { isCanceledOrder } from "@/utils/constants/order-statuses";
import { getOrderTotal } from "@/utils/helpers/order-totals";

const SALES_ORDERS_PER_PAGE = import.meta.env.VITE_SALES_ORDERS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

export default function SalesOrders() {
  const { language, translate, translations } = useLanguage();

  useDocumentTitle(`${translations.pages.salesOrders} | ${translations.adminPanel}`);

  const { getWarehouseNameById } = useWarehouseHelpers();

  const navigate = useNavigate();

  // URL search params for filters
  const [searchParams, setSearchParams] = useSearchParams();

  // State management for filters
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));
  const [paymentStatusFilter, setPaymentStatusFilter] = useState(searchParams.get("paymentStatus") || "");
  const [orderSourceFilter, setOrderSourceFilter] = useState(searchParams.get("orderSource") || "");
  const [isCodOrderFilter, setIsCodOrderFilter] = useState(searchParams.get("isCodOrder") || "");
  const [fromDateFilter, setFromDateFilter] = useState(searchParams.get("createdAt[gte]") || "");
  const [toDateFilter, setToDateFilter] = useState(searchParams.get("createdAt[lte]") || "");
  const [customerFilter, setCustomerFilter] = useState(searchParams.get("customer") || "");
  const [debouncedCustomerFilter] = useDebounce(customerFilter, 350);
  const isAnyFilterActive =
    !!paymentStatusFilter ||
    !!orderSourceFilter ||
    !!isCodOrderFilter ||
    !!fromDateFilter ||
    !!toDateFilter ||
    !!customerFilter;

  function clearAllFilters() {
    setPaymentStatusFilter("");
    setOrderSourceFilter("");
    setIsCodOrderFilter("");
    setFromDateFilter("");
    setToDateFilter("");
    setCustomerFilter("");
    if (activePage !== 1) setActivePage(1);
  }

  const params = {
    page: activePage.toString(),
    ...(paymentStatusFilter ? { paymentStatus: paymentStatusFilter } : {}),
    ...(orderSourceFilter ? { orderSource: orderSourceFilter } : {}),
    ...(isCodOrderFilter ? { isCodOrder: isCodOrderFilter } : {}),
    ...(fromDateFilter ? { "createdAt[gte]": fromDateFilter } : {}),
    ...(toDateFilter ? { "createdAt[lte]": toDateFilter } : {}),
    ...(debouncedCustomerFilter ? { customer: debouncedCustomerFilter } : {}),
  };

  // Track the previous filters and check if they have changed to reset the active page to 1.
  const { filtersChanged, updatePreviousFilters } = useHandlePreviousFilters({
    paymentStatusFilter,
    orderSourceFilter,
    isCodOrderFilter,
    fromDateFilter,
    toDateFilter,
    debouncedCustomerFilter,
  });

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: paginatedSalesOrders,
    setData: setPaginatedSalesOrders,
  } = useDataHandler<PaginatedData<SalesOrder>>({ initialData: null, initialLoading: true });

  function handleLoadSalesOrders() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "sale-orders",
        params: { limit: SALES_ORDERS_PER_PAGE, ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedSalesOrders(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  const canICreateSalesOrders = useHasPermission(resources.salesOrders, actions.create);
  const canIReadSalesOrders = useHasPermission(resources.salesOrders, actions.read);

  useEffect(() => {
    // Sync URL search params with filters
    setSearchParams(params, { replace: true });

    // If the filters have changed, reset the active page to 1.
    const newFilters = {
      paymentStatusFilter,
      orderSourceFilter,
      isCodOrderFilter,
      fromDateFilter,
      toDateFilter,
      debouncedCustomerFilter,
    };
    if (filtersChanged(newFilters)) {
      updatePreviousFilters(newFilters);
      if (activePage !== 1) {
        setActivePage(1); // This will, in turn, trigger this effect again and call handleLoadSalesOrders().
        return;
      }
    }

    window.scrollTo({ top: 0, behavior: "instant" });

    if (!canIReadSalesOrders) return; // If the user doesn't have permission to read sales orders, don't fetch them.

    const cancelRequest = handleLoadSalesOrders(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activePage,
    paymentStatusFilter,
    orderSourceFilter,
    isCodOrderFilter,
    fromDateFilter,
    toDateFilter,
    debouncedCustomerFilter,
    canIReadSalesOrders,
  ]);

  const [scannerOpened, { open: openScanner, close: closeScanner }] = useDisclosure();

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.salesOrders,
        backLink: true,
        sideElements: (
          <div className="flex items-center gap-2">
            {canIReadSalesOrders && (
              <>
                <Button variant="light" title={translate("Scan Barcode", "مسح الباركود")} onClick={openScanner}>
                  <solidIcons.BarcodeScan size={18} />
                </Button>

                <ScannerModal opened={scannerOpened} close={closeScanner} />
              </>
            )}

            {canICreateSalesOrders && (
              <Link to={`${paths.new}`}>
                <Button variant="light" color="teal" leftSection={<solidIcons.Plus />}>
                  {translate("New Sales Order", "طلب مبيعات جديد")}
                </Button>
              </Link>
            )}
          </div>
        ),
      }}
    >
      {/* Search and filter */}
      <div className="rounded-xl bg-gray-100/50 px-4 py-3">
        <div className="mb-2 flex items-center justify-between border-b border-gray-200 pb-1">
          <span className="flex items-center gap-1 text-xs font-medium text-gray-600">
            {translate("Search and filter", "ابحث و فلتر")}

            <Badge color="teal" size="xs">
              {translate("New", "جديد")}
            </Badge>
          </span>
          {isAnyFilterActive && (
            <Button variant="light" size="compact-xs" color="red" onClick={clearAllFilters}>
              {translate("Clear Filters", "مسح الفلاتر")}
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          <TextInput
            w="100%"
            radius="md"
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.currentTarget.value)}
            label={translate("Customer ID", "معرف العميل")}
            placeholder={translate("Search customer", "ابحث عن عميل")}
            leftSection={<solidIcons.Search />}
            rightSection={
              customerFilter && (
                <button onClick={() => setCustomerFilter("")}>
                  <solidIcons.XMark />
                </button>
              )
            }
          />

          <Select
            flex={1}
            radius="md"
            value={paymentStatusFilter}
            onChange={(value) => setPaymentStatusFilter(value as string)}
            label={translate("Payment Status", "حالة الدفع")}
            placeholder={translate("Filter by payment status", "فلتر حسب حالة الدفع")}
            allowDeselect={false}
            data={[
              { value: "", label: translate("All", "الكل") },
              ...paymentStatusesArray.map((status) => ({
                value: status.value,
                label: translate(status.label.en, status.label.ar),
              })),
            ]}
          />

          <Select
            flex={1}
            radius="md"
            value={orderSourceFilter}
            onChange={(value) => setOrderSourceFilter(value as string)}
            label={translate("Order Source", "مصدر الطلب")}
            placeholder={translate("Order source", "مصدر الطلب")}
            allowDeselect={false}
            data={[
              { value: "", label: translate("All sources", "كل المصادر") },
              ...orderSourcesArray.map((source) => ({
                value: source.value,
                label: translate(source.label.en, source.label.ar),
              })),
            ]}
          />

          <Select
            flex={1}
            radius="md"
            value={isCodOrderFilter}
            onChange={(value) => setIsCodOrderFilter(value as string)}
            label={translate("COD", "الدفع عند الاستلام")}
            placeholder={translate("COD", "الدفع عند الاستلام")}
            allowDeselect={false}
            data={[
              { value: "", label: translate("All", "الكل") },
              { value: "true", label: translate("COD only", "الدفع عند الاستلام فقط") },
              { value: "false", label: translate("Non-COD", "بدون الدفع عند الاستلام") },
            ]}
          />

          <TextInput
            flex={1}
            radius="md"
            type="date"
            value={fromDateFilter}
            onChange={(e) => setFromDateFilter(e.currentTarget.value)}
            label={translate("From Date", "من تاريخ")}
            placeholder={translate("From date", "من تاريخ")}
          />

          <TextInput
            flex={1}
            radius="md"
            type="date"
            value={toDateFilter}
            onChange={(e) => setToDateFilter(e.currentTarget.value)}
            label={translate("To Date", "إلى تاريخ")}
            placeholder={translate("To date", "إلى تاريخ")}
          />
        </div>
      </div>

      {/* Content */}
      {!canIReadSalesOrders ? (
        <UnauthorizedSection
          message={translate("You don't have permission to read sales orders", "ليس لديك إذن لقراءة طلبات المبيعات")}
        />
      ) : loading ? (
        <LoadingSection message={translate("Loading orders...", "جاري تحميل الطلبات...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading orders", "خطأ في تحميل الطلبات")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadSalesOrders }}
        />
      ) : (
        paginatedSalesOrders &&
        (paginatedSalesOrders.data.length === 0 ? (
          <EmptySection useDefaultImg message={translate("No Orders Found", "لا يوجد طلبات")} />
        ) : (
          <>
            {/* Table */}
            <div className="overflow-x-auto">
              <Table className="text-nowrap" verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Order ID", "الرقم المرجعي")}</Table.Th>
                    <Table.Th>{translate("Warehouse", "الفرع")}</Table.Th>
                    <Table.Th>{translate("Customer", "العميل")}</Table.Th>
                    <Table.Th>{translate("Project", "المشروع")}</Table.Th>
                    <Table.Th>{translate("Payment Status", "حالة الدفع")}</Table.Th>
                    <Table.Th>{translate("Total Amount", "المبلغ الإجمالي")}</Table.Th>
                    <Table.Th>{translate("Paid Amount", "المبلغ المدفوع")}</Table.Th>
                    <Table.Th>{translate("Remaining Amount", "المبلغ المتبقي")}</Table.Th>
                    <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                    <Table.Th>{translate("By", "بواسطة")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedSalesOrders.data.map((salesOrder) => {
                    const isThereAnyReturningRequest = salesOrder.items.some((item) => item.quantityToBeReturned > 0);
                    return (
                      <Table.Tr
                        key={salesOrder._id}
                        className="cursor-pointer text-gray-600"
                        onClick={() => navigate(salesOrder._id)}
                      >
                        <Table.Td
                          className={`flex items-center gap-1.5 font-semibold text-gray-800 ${isCanceledOrder(salesOrder.orderStatus) ? "line-through" : ""}`}
                        >
                          {salesOrder._id}

                          {isThereAnyReturningRequest && (
                            <Tooltip
                              withArrow
                              label={translate("Customer requested to return some items", "طلب العميل إرجاع بعض العناصر")}
                            >
                              <div className="animate-pulse">
                                <solidIcons.ExclamationCircle className="text-red-500" size={19} />
                              </div>
                            </Tooltip>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <div className="flex items-center gap-1">
                            {isCashierOrder(salesOrder.orderSource)
                              ? getWarehouseNameById(salesOrder.warehouse)
                              : (isWebsiteOrder(salesOrder.orderSource) || isShopifyOrder(salesOrder.orderSource)) && (
                                  <span className="rounded-full bg-blue-500 px-2 py-0.5 text-xs font-medium text-white">
                                    {getOrderSourceLabel(salesOrder.orderSource, language)}
                                  </span>
                                )}

                            {salesOrder.isCodOrder && (
                              <>
                                <Tooltip withArrow label={translate("Cash on Delivery", "دفع عند الاستلام")}>
                                  <span className="flex-center h-6 w-6 rounded-full bg-yellow-500 text-white">$</span>
                                </Tooltip>

                                {salesOrder.isCodOrderConfirmed ? (
                                  <Tooltip withArrow label={translate("Confirmed with Deposit", "مؤكَّد بدفع عربون")}>
                                    <span className="flex-center h-6 w-6 rounded-full bg-green-500 text-white">✓</span>
                                  </Tooltip>
                                ) : isCanceledOrder(salesOrder.orderStatus) ? (
                                  <Tooltip withArrow label={translate("Canceled Order", "طلب ملغي")}>
                                    <span className="flex-center h-6 w-6 rounded-full bg-gray-800 text-white">x</span>
                                  </Tooltip>
                                ) : !salesOrder.isCodOrderConfirmed ? (
                                  <Tooltip
                                    withArrow
                                    label={translate("Not Confirmed (No Deposit)", "غير مؤكَّد (لم يُدفَع عربون)")}
                                  >
                                    <span className="flex-center h-6 w-6 animate-pulse rounded-full bg-red-500 text-white">
                                      !
                                    </span>
                                  </Tooltip>
                                ) : null}
                              </>
                            )}
                          </div>
                        </Table.Td>
                        <Table.Td>{salesOrder.customer?.name || translate("Deleted Customer", "عميل محذوف")}</Table.Td>
                        <Table.Td>{salesOrder.project?.projectNumber || "-"}</Table.Td>
                        <Table.Td>{getPaymentStatusLabel(salesOrder.paymentStatus, language)}</Table.Td>
                        <Table.Td className="font-semibold text-gray-800">{getOrderTotal(salesOrder).toFixed(2)}</Table.Td>
                        <Table.Td>{salesOrder.paidAmount.toFixed(2)}</Table.Td>
                        <Table.Td>{salesOrder.remainingAmount.toFixed(2)}</Table.Td>
                        <Table.Td>{formatDate(salesOrder.createdAt, language)}</Table.Td>
                        <Table.Td>{salesOrder.createdBy?.name || ""}</Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </div>

            {/* Pagination */}
            <PaginationHandler<SalesOrder>
              paginatedData={paginatedSalesOrders}
              activePage={activePage}
              setActivePage={setActivePage}
            />
          </>
        ))
      )}
    </AdminLayoutBox>
  );
}
