import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import paths from "@/utils/constants/paths";
import { SortOrder } from "@/types/global";
import { PurchaseOrder } from "@/types/orders";
import { PaymentStatus } from "@/types/payment";
import { sortOrdersArray } from "@/utils/constants/sort-order";
import { getPaymentStatusLabel, paymentStatusesArray } from "@/utils/constants/payment-statuses";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import { solidIcons } from "@/components/icons";
import { DateTimePicker } from "@mantine/dates";
import { Button, Select, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import { getOrderTotal } from "@/utils/helpers/order-totals";

const URL = "reports/purchase-orders";
const FILENAME = "purchase-orders-report.xlsx";
type ReportData = PurchaseOrder[];
type PaymentStatusOption = PaymentStatus | "";
type SortByOption = "totalAmount" | "paidAmount" | "remainingAmount" | "createdAt";
type SortOrderOption = SortOrder;

export default function PurchaseOrdersReport() {
  const { language, translate, translations } = useLanguage();

  const title = translate("Purchase Orders Report", "تقرير طلبات الشراء");

  useDocumentTitle(title);

  const { data: warehouses } = useWarehouses();
  const { getWarehouseNameById } = useWarehouseHelpers();

  const [searchParams, setSearchParams] = useSearchParams();

  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");

  const startDate = startDateParam ? new Date(startDateParam) : null;
  const endDate = endDateParam ? new Date(endDateParam) : null;
  const warehouseId = searchParams.get("warehouseId") || "";
  const paymentStatus = (searchParams.get("paymentStatus") || "") as PaymentStatusOption;
  const sortBy = (searchParams.get("sortBy") || "createdAt") as SortByOption;
  const sortOrder = (searchParams.get("sortOrder") || "desc") as SortOrderOption;

  const updateFilter = (key: string, value: string) => {
    if (!value) searchParams.delete(key);
    else searchParams.set(key, value);
    setSearchParams(searchParams);
  };

  const setStartDate = (startDate: string) => updateFilter("startDate", startDate);
  const setEndDate = (endDate: string) => updateFilter("endDate", endDate);
  const setWarehouseId = (warehouseId: string) => updateFilter("warehouseId", warehouseId);
  const setPaymentStatus = (paymentStatus: PaymentStatusOption) => updateFilter("paymentStatus", paymentStatus);
  const setSortBy = (sortBy: SortByOption) => updateFilter("sortBy", sortBy);
  const setSortOrder = (sortOrder: SortOrderOption) => updateFilter("sortOrder", sortOrder);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<ReportData>({
    initialData: [],
    initialLoading: true,
  });

  function handleLoadData() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: URL,
        params: { ...Object.fromEntries(searchParams) },
        signal: controller.signal,
        language,
      });
      setData(response.data);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    const cancelRequest = handleLoadData();
    return cancelRequest;
  }, [searchParams]);

  return (
    <AdminLayoutBox
      header={{
        backLink: `/${paths.admin}/${paths.reports}`,
        title: title,
        border: true,
        sideElements: (
          <Button
            variant="light"
            color="green"
            radius="md"
            disabled={downloading}
            leftSection={downloading ? <solidIcons.Spinner className="animate-spin" /> : <solidIcons.Download />}
            onClick={async () => {
              setDownloading(true);
              await privateRequest({
                method: "POST",
                url: URL,
                params: { ...Object.fromEntries(searchParams) },
                filename: FILENAME,
                download: true,
              });
              setDownloading(false);
            }}
          >
            {downloading ? translate("Preparing...", "جاري التحضير...") : translate("Download", "تحميل")}
          </Button>
        ),
      }}
    >
      {/* Filters */}
      <div className="flex flex-col gap-4">
        {/* Date Range */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DateTimePicker
            label={translate("Start Date", "تاريخ البداية")}
            placeholder={translate("Select Start Date", "حدد تاريخ البداية")}
            value={startDate}
            onChange={(date) => setStartDate(date?.toISOString() || "")}
            clearable
          />
          <DateTimePicker
            label={translate("End Date", "تاريخ النهاية")}
            placeholder={translate("Select End Date", "حدد تاريخ النهاية")}
            value={endDate}
            onChange={(date) => setEndDate(date?.toISOString() || "")}
            clearable
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {/* Warehouse */}
          <Select
            clearable
            label={translate("Warehouse", "الفرع")}
            placeholder={translate("Select Warehouse", "اختر الفرع")}
            value={warehouseId}
            onChange={(value) => setWarehouseId(value || "")}
            data={warehouses.map((warehouse) => ({
              value: warehouse._id,
              label: warehouse.name,
            }))}
          />

          {/* Payment Status */}
          <Select
            clearable
            label={translate("Payment Status", "حالة الدفع")}
            placeholder={translate("Select Payment Status", "اختر حالة الدفع")}
            value={paymentStatus}
            onChange={(value) => setPaymentStatus((value || "") as PaymentStatusOption)}
            data={paymentStatusesArray.map((status) => ({
              value: status.value,
              label: translate(status.label.en, status.label.ar),
            }))}
          />

          {/* Sort By */}
          <Select
            allowDeselect={false}
            label={translate("Sort By", "ترتيب حسب")}
            placeholder={translate("Select Sort By", "اختر الترتيب حسب")}
            value={sortBy}
            onChange={(value) => setSortBy((value || "") as SortByOption)}
            data={[
              { value: "createdAt", label: translate("Date & Time", "التاريخ والوقت") },
              { value: "totalAmount", label: translate("Total Amount", "المبلغ الإجمالي") },
              { value: "paidAmount", label: translate("Paid Amount", "المبلغ المدفوع") },
              { value: "remainingAmount", label: translate("Remaining Amount", "المبلغ المتبقي") },
            ]}
          />

          {/* Sort Order */}
          <Select
            allowDeselect={false}
            label={translate("Sort Order", "طريقة الترتيب")}
            placeholder={translate("Select Sort Order", "اختر طريقة الترتيب")}
            value={sortOrder}
            onChange={(value) => setSortOrder((value || "desc") as SortOrder)}
            data={sortOrdersArray.map((option) => ({
              value: option.value,
              label: translate(option.label.en, option.label.ar),
            }))}
          />
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <LoadingSection message={translate("Generating report", "جاري إنشاء التقرير")} />
      ) : error ? (
        <ErrorSection
          errorMessage={error}
          errorTitle={translate("Error Generating Report", "خطأ في إنشاء التقرير")}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadData }}
        />
      ) : data.length === 0 ? (
        <EmptySection useDefaultImg message={translate("No Data Found", "لا توجد بيانات")} />
      ) : (
        <>
          {/* Table */}
          <div className="overflow-x-auto">
            <Table className="text-nowrap" verticalSpacing="xs" withColumnBorders>
              <Table.Thead className="bg-gray-100 text-gray-800">
                <Table.Tr>
                  <Table.Th>{translate("Order ID", "الرقم المرجعي")}</Table.Th>
                  <Table.Th>{translate("Warehouse", "الفرع")}</Table.Th>
                  <Table.Th>{translate("Vendor", "البائع")}</Table.Th>
                  <Table.Th>{translate("Payment Status", "حالة الدفع")}</Table.Th>
                  <Table.Th>{translate("Total Amount", "المبلغ الإجمالي")}</Table.Th>
                  <Table.Th>{translate("Paid Amount", "المبلغ المدفوع")}</Table.Th>
                  <Table.Th>{translate("Remaining Amount", "المبلغ المتبقي")}</Table.Th>
                  <Table.Th>{translate("Date & Time", "التاريخ والوقت")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.map((po) => (
                  <Table.Tr key={po._id} className="text-gray-600">
                    <Table.Td className="font-semibold text-gray-800">{po._id}</Table.Td>
                    <Table.Td>{getWarehouseNameById(po.warehouseId)}</Table.Td>
                    <Table.Td>{po.vendor?.name || translate("Deleted Vendor", "بائع محذوف")}</Table.Td>
                    <Table.Td>{getPaymentStatusLabel(po.paymentStatus, language)}</Table.Td>
                    <Table.Td className="font-semibold text-gray-800">
                      {getOrderTotal(po).toFixed(2)} {translations.currency}
                    </Table.Td>
                    <Table.Td>
                      {po.paidAmount.toFixed(2)} {translations.currency}
                    </Table.Td>
                    <Table.Td>
                      {po.remainingAmount.toFixed(2)} {translations.currency}
                    </Table.Td>
                    <Table.Td>{formatDateAndTime(po.createdAt, language)}</Table.Td>
                  </Table.Tr>
                ))}

                {/* Total Row */}
                <Table.Tr className="bg-gray-100 font-semibold text-gray-800">
                  <Table.Td />
                  <Table.Td />
                  <Table.Td />
                  <Table.Td />
                  <Table.Td>
                    {data.reduce((acc, po) => acc + getOrderTotal(po), 0).toFixed(2)} {translations.currency}
                  </Table.Td>
                  <Table.Td>
                    {data.reduce((acc, po) => acc + po.paidAmount, 0).toFixed(2)} {translations.currency}
                  </Table.Td>
                  <Table.Td>
                    {data.reduce((acc, po) => acc + po.remainingAmount, 0).toFixed(2)} {translations.currency}
                  </Table.Td>
                  <Table.Td />
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </div>
        </>
      )}
    </AdminLayoutBox>
  );
}
