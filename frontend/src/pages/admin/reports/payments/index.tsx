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
import { Payment, PaymentMethod, PaymentCategory, PaymentType } from "@/types/payment";
import { sortOrdersArray } from "@/utils/constants/sort-order";
import { getPaymentMethodLabel, paymentMethodsArray } from "@/utils/constants/payment-methods";
import { getPaymentCategoryLabel, paymentCategoriesArray } from "@/utils/constants/payment-category";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import { solidIcons } from "@/components/icons";
import { DateTimePicker } from "@mantine/dates";
import { Button, Select, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaymentAmount from "@/components/ui/payment-amount";

const URL = "reports/payments";
const FILENAME = "payments-report.xlsx";

type ReportData = Payment[];
type PaymentMethodOption = PaymentMethod | "";
type PaymentCategoryOption = PaymentCategory | "";
type PaymentTypeOption = PaymentType | "";

export default function PaymentsReport() {
  const { language, translate, translations } = useLanguage();
  const { data: warehouses } = useWarehouses();
  const { getWarehouseNameById } = useWarehouseHelpers();

  const title = translate("Payments Report", "تقرير المدفوعات");
  useDocumentTitle(title);

  const [searchParams, setSearchParams] = useSearchParams();

  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");
  const startDate = startDateParam ? new Date(startDateParam) : null;
  const endDate = endDateParam ? new Date(endDateParam) : null;
  const warehouse = searchParams.get("warehouseId") || "";
  const paymentMethod = (searchParams.get("paymentMethod") || "") as PaymentMethodOption;
  const paymentCategory = (searchParams.get("paymentCategory") || "") as PaymentCategoryOption;
  const paymentType = (searchParams.get("type") || "") as PaymentTypeOption;
  const sortBy = (searchParams.get("sortBy") || "createdAt") as "amountPaid" | "createdAt";
  const sortOrder = (searchParams.get("sortOrder") || "desc") as SortOrder;

  const updateFilter = (key: string, value: string) => {
    if (!value) searchParams.delete(key);
    else searchParams.set(key, value);
    setSearchParams(searchParams);
  };

  const setStartDate = (date: Date | null) => updateFilter("startDate", date?.toISOString() || "");
  const setEndDate = (date: Date | null) => updateFilter("endDate", date?.toISOString() || "");
  const setWarehouse = (warehouse: string) => updateFilter("warehouseId", warehouse);
  const setPaymentMethod = (method: PaymentMethodOption) => updateFilter("paymentMethod", method);
  const setPaymentCategory = (category: PaymentCategoryOption) => updateFilter("paymentCategory", category);
  const setPaymentType = (type: PaymentTypeOption) => updateFilter("type", type);
  const setSortBy = (sortBy: "amountPaid" | "createdAt") => updateFilter("sortBy", sortBy);
  const setSortOrder = (sortOrder: SortOrder) => updateFilter("sortOrder", sortOrder);

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

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    const cancelRequest = handleLoadData();
    return cancelRequest;
  }, [searchParams]);

  const [downloading, setDownloading] = useState(false);

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
        {/* Start Date */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <DateTimePicker
            label={translate("Start Date", "تاريخ البداية")}
            placeholder={translate("Select Start Date", "حدد تاريخ البداية")}
            value={startDate}
            onChange={setStartDate}
            clearable
          />
          {/* End Date */}
          <DateTimePicker
            label={translate("End Date", "تاريخ النهاية")}
            placeholder={translate("Select End Date", "حدد تاريخ النهاية")}
            value={endDate}
            onChange={setEndDate}
            clearable
          />
          {/* Warehouse */}
          <Select
            clearable
            value={warehouse}
            onChange={(value) => setWarehouse(value || "")}
            label={translate("Warehouse", "الفرع")}
            placeholder={translate("Select Warehouse", "اختر الفرع")}
            data={warehouses.map((warehouse) => ({
              value: warehouse._id,
              label: warehouse.name,
            }))}
          />
          {/* Payment Method */}
          <Select
            clearable
            value={paymentMethod}
            onChange={(value) => setPaymentMethod((value || "") as PaymentMethodOption)}
            label={translate("Payment Method", "طريقة الدفع")}
            placeholder={translate("Select Payment Method", "اختر طريقة الدفع")}
            data={paymentMethodsArray.map((method) => ({
              value: method.value,
              label: translate(method.label.en, method.label.ar),
            }))}
          />
          {/* Payment Category */}
          <Select
            clearable
            value={paymentCategory}
            onChange={(value) => setPaymentCategory((value || "") as PaymentCategoryOption)}
            label={translate("Payment Category", "التصنيف")}
            placeholder={translate("Select Payment Category", "اختر التصنيف")}
            data={paymentCategoriesArray.map((category) => ({
              value: category.value,
              label: translate(category.label.en, category.label.ar),
            }))}
          />
          {/* Payment Type */}
          <Select
            clearable
            value={paymentType}
            onChange={(value) => setPaymentType((value || "") as PaymentTypeOption)}
            label={translate("Payment Type", "نوع الدفع")}
            placeholder={translate("Select Payment Type", "اختر نوع الدفع")}
            data={[
              { value: "in", label: translate("In", "وارد") },
              { value: "out", label: translate("Out", "صادر") },
            ]}
          />
          {/* Sort By */}
          <Select
            allowDeselect={false}
            label={translate("Sort By", "ترتيب حسب")}
            placeholder={translate("Select Sort By", "اختر الترتيب حسب")}
            value={sortBy}
            onChange={(value) => setSortBy((value || "") as "amountPaid" | "createdAt")}
            data={[
              { value: "createdAt", label: translate("Date & Time", "التاريخ والوقت") },
              // { value: "amountPaid", label: translate("Amount", "المبلغ") },
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

      <hr />

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
          {/* Summary Section */}
          <section className="flex flex-col gap-2">
            <h3>{translate("Warehouse Payments Summary", "ملخص المدفوعات بالفروع")}</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {warehouses.map((warehouse) => {
                const warehousePayments = data.filter((payment) => payment.warehouseId === warehouse._id);
                const inflow = warehousePayments
                  .filter((payment) => payment.type === "in")
                  .reduce((sum, payment) => sum + payment.amountPaid, 0);
                const outflow = warehousePayments
                  .filter((payment) => payment.type === "out")
                  .reduce((sum, payment) => sum + payment.amountPaid, 0);
                const balance = inflow - outflow;

                return (
                  <div key={warehouse._id} className="rounded-lg border bg-white p-4">
                    <h3 className="mb-2 text-lg font-semibold text-gray-800">{warehouse.name}</h3>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">{translate("Inflow", "الوارد")}</span>
                        <span className="font-medium text-green-600">
                          {inflow.toFixed(2)} {translations.currency}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">{translate("Outflow", "الصادر")}</span>
                        <span className="font-medium text-red-600">
                          {outflow.toFixed(2)} {translations.currency}
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-gray-200 pt-2">
                        <span className="text-gray-600">{translate("Balance", "الرصيد")}</span>
                        <span className={`font-medium ${balance >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {balance.toFixed(2)} {translations.currency}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <hr />

          {/* Table */}
          <div className="overflow-x-auto">
            <Table className="text-nowrap" verticalSpacing="xs" withColumnBorders>
              <Table.Thead className="bg-gray-100 text-gray-800">
                <Table.Tr>
                  <Table.Th>{translate("Date & Time", "التاريخ والوقت")}</Table.Th>
                  <Table.Th>{translate("Warehouse", "الفرع")}</Table.Th>
                  <Table.Th>{translate("Amount", "المبلغ")}</Table.Th>
                  <Table.Th>{translate("Payment Type", "نوع الدفع")}</Table.Th>
                  <Table.Th>{translate("Payment Method", "طريقة الدفع")}</Table.Th>
                  <Table.Th>{translate("Payment Category", "التصنيف")}</Table.Th>
                  <Table.Th>{translate("Order ID", "رقم الطلب")}</Table.Th>
                  <Table.Th>{translate("Notes", "ملاحظات")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.map((payment) => (
                  <Table.Tr key={payment._id} className="text-gray-600">
                    <Table.Td>{formatDateAndTime(payment.createdAt, language)}</Table.Td>
                    <Table.Td>{getWarehouseNameById(payment.warehouseId)}</Table.Td>
                    <Table.Td>
                      <PaymentAmount payment={payment} />
                    </Table.Td>
                    <Table.Td>{payment.type === "in" ? translate("In", "وارد") : translate("Out", "صادر")}</Table.Td>
                    <Table.Td>{getPaymentMethodLabel(payment.paymentMethod, language)}</Table.Td>
                    <Table.Td>{getPaymentCategoryLabel(payment.paymentCategory, language)}</Table.Td>
                    <Table.Td>{payment.purchaseOrderId || payment.salesOrderId}</Table.Td>
                    <Table.Td>{payment.notes || ""}</Table.Td>
                  </Table.Tr>
                ))}

                {/* Total Row */}
                <Table.Tr className="font-semibold text-gray-800" style={{ backgroundColor: "#f3f4f6" }}>
                  <Table.Td>{translate("Total", "الإجمالي")}</Table.Td>
                  <Table.Td />
                  <Table.Td>
                    {data
                      .reduce((acc, payment) => {
                        const amount = payment.type === "in" ? payment.amountPaid : -payment.amountPaid;
                        return acc + amount;
                      }, 0)
                      .toFixed(2)}{" "}
                    {translations.currency}
                  </Table.Td>
                  <Table.Td />
                  <Table.Td />
                  <Table.Td />
                  <Table.Td />
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
