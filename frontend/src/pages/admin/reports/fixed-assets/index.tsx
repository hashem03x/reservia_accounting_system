import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { SortOrder } from "@/types/global";
import { formatDate } from "@/utils/helpers/date-formaters";
import { DateTimePicker } from "@mantine/dates";
import { Button, Select, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import paths from "@/utils/constants/paths";
import { solidIcons } from "@/components/icons";

const URL = "reports/fixed-assets";
const FILENAME = "fixed-assets-report.xlsx";

type FixedAsset = {
  name: string;
  bookValue: number;
  fairValue: number;
  warehouse: string;
  createdBy: string;
  createdAt: string;
};

type ReportSummary = {
  totalAssets: number;
  totalBookValue: number;
  totalFairValue: number;
};

type ReportData = {
  assets: FixedAsset[];
  summary: ReportSummary;
};

type SortByOption = "bookValue" | "fairValue" | "createdAt";
type SortOrderOption = SortOrder;

export default function FixedAssetsReport() {
  const { language, translate, translations } = useLanguage();
  const { data: warehouses } = useWarehouses();

  const title = translate("Fixed Assets Report", "تقرير الأصول الثابتة");

  useDocumentTitle(title);

  const [searchParams, setSearchParams] = useSearchParams();

  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");

  const startDate = startDateParam ? new Date(startDateParam) : null;
  const endDate = endDateParam ? new Date(endDateParam) : null;
  const warehouseId = searchParams.get("warehouseId") || "";
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
  const setSortBy = (sortBy: SortByOption) => updateFilter("sortBy", sortBy);
  const setSortOrder = (sortOrder: SortOrderOption) => updateFilter("sortOrder", sortOrder);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<ReportData>({
    initialData: { assets: [], summary: { totalAssets: 0, totalBookValue: 0, totalFairValue: 0 } },
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
      setData({ assets: response.data, summary: response.summary });
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
      <div className="flex flex-wrap items-end gap-4 mb-8">
        <DateTimePicker
          clearable
          valueFormat="DD/MM/YYYY"
          label={translate("Start Date", "تاريخ البداية")}
          placeholder={translate("Select date", "اختر التاريخ")}
          value={startDate}
          onChange={(date) => setStartDate(date ? date.toISOString() : "")}
          className="w-full max-w-[250px]"
        />

        <DateTimePicker
          clearable
          valueFormat="DD/MM/YYYY"
          label={translate("End Date", "تاريخ النهاية")}
          placeholder={translate("Select date", "اختر التاريخ")}
          value={endDate}
          onChange={(date) => setEndDate(date ? date.toISOString() : "")}
          className="w-full max-w-[250px]"
        />

        <Select
          clearable
          value={warehouseId}
          onChange={(value) => setWarehouseId(value || "")}
          label={translate("Warehouse", "المخزن")}
          placeholder={translate("Select Warehouse", "اختر المخزن")}
          data={warehouses.map((warehouse) => ({
            value: warehouse._id,
            label: warehouse.name,
          }))}
          className="w-full max-w-[250px]"
        />

        <Select
          value={sortBy}
          onChange={(value) => setSortBy(value as SortByOption)}
          label={translate("Sort By", "ترتيب حسب")}
          data={[
            { value: "bookValue", label: translate("Book Value", "القيمة الدفترية") },
            { value: "fairValue", label: translate("Fair Value", "القيمة العادلة") },
            { value: "createdAt", label: translate("Created At", "تاريخ الإنشاء") },
          ]}
          className="w-full max-w-[250px]"
        />

        <Select
          value={sortOrder}
          onChange={(value) => setSortOrder(value as SortOrderOption)}
          label={translate("Sort Order", "ترتيب")}
          data={[
            { value: "asc", label: translate("Ascending", "تصاعدي") },
            { value: "desc", label: translate("Descending", "تنازلي") },
          ]}
          className="w-full max-w-[250px]"
        />
      </div>

      {loading ? (
        <LoadingSection message={translate("Generating report", "جاري إنشاء التقرير")} />
      ) : error ? (
        <ErrorSection 
          errorTitle={translate("Error Generating Report", "خطأ في إنشاء التقرير")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadData }}
        />
      ) : !data.assets.length ? (
        <EmptySection useDefaultImg message={translate("No Data Found", "لا توجد بيانات")} />
      ) : (
        <div className="overflow-x-auto">
          <Table className="text-nowrap" verticalSpacing="xs" withColumnBorders>
            <Table.Thead className="bg-gray-100 text-gray-800">
              <Table.Tr>
                <Table.Th>{translate("Asset Name", "اسم الأصل")}</Table.Th>
                <Table.Th>{translate("Book Value", "القيمة الدفترية")}</Table.Th>
                <Table.Th>{translate("Fair Value", "القيمة العادلة")}</Table.Th>
                <Table.Th>{translate("Warehouse", "المخزن")}</Table.Th>
                <Table.Th>{translate("Created At", "تاريخ الإنشاء")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.assets.map((asset) => (
                <Table.Tr key={asset.name} className="text-gray-600">
                  <Table.Td className="font-semibold text-gray-800">{asset.name}</Table.Td>
                  <Table.Td>
                    {asset.bookValue.toFixed(2)} {translations.currency}
                  </Table.Td>
                  <Table.Td>
                    {asset.fairValue.toFixed(2)} {translations.currency}
                  </Table.Td>
                  <Table.Td>{asset.warehouse}</Table.Td>
                  <Table.Td>{formatDate(asset.createdAt, language)}</Table.Td>
                </Table.Tr>
              ))}

              {/* Summary Row */}
              <Table.Tr className="bg-gray-100 font-semibold text-gray-800">
                <Table.Td>
                  {translate("Total", "الإجمالي")} ({data.summary.totalAssets})
                </Table.Td>
                <Table.Td>
                  {data.summary.totalBookValue.toFixed(2)} {translations.currency}
                </Table.Td>
                <Table.Td>
                  {data.summary.totalFairValue.toFixed(2)} {translations.currency}
                </Table.Td>
                <Table.Td />
                <Table.Td />
                <Table.Td />
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </div>
      )}
    </AdminLayoutBox>
  );
}