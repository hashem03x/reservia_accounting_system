import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { SortOrder } from "@/types/global";
import { sortOrdersArray } from "@/utils/constants/sort-order";
import { formatDate } from "@/utils/helpers/date-formaters";
import { DateTimePicker } from "@mantine/dates";
import { Button, Select, Table, Text } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import { solidIcons } from "@/components/icons";
import paths from "@/utils/constants/paths";

const URL = "reports/inventory-transfer";
const FILENAME = "inventory-transfer-report.xlsx";

interface Transfer {
  _id: string;
  type: string;
  product: {
    title: {
      en: string;
      ar: string;
    };
  };
  details: {
    _id: string;
    variant: {
      _id: string;
      title: {
        en: string;
        ar: string;
      };
      quantity: number;
    }[];
  };
  totalQuantity: number;
  date: string;
  sourceWarehouse: string;
  targetWarehouse: string;
  transferredBy: {
    _id: string;
    name: string;
  };
}

interface ReportData {
  transfers: Transfer[];
  summary: {
    totalTransfers: number;
    totalQuantity: number;
    byWarehouse: Record<string, {
      outbound: number;
      inbound: number;
    }>;
  };
}

// type SortByOption = "date";
type SortOrderOption = SortOrder;

export default function InventoryTransferReport() {
  const { language, translate } = useLanguage();

  const title = translate("Inventory Transfer Report", "تقرير نقل المخزون");

  useDocumentTitle(title);

  const [searchParams, setSearchParams] = useSearchParams();

  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");

  const startDate = startDateParam ? new Date(startDateParam) : null;
  const endDate = endDateParam ? new Date(endDateParam) : null;
  // const sortBy = "date";
  const sortOrder = (searchParams.get("sortOrder") || "desc") as SortOrderOption;

  const updateFilter = (key: string, value: string) => {
    if (!value) searchParams.delete(key);
    else searchParams.set(key, value);
    setSearchParams(searchParams);
  };

  const setStartDate = (startDate: string) => updateFilter("startDate", startDate);
  const setEndDate = (endDate: string) => updateFilter("endDate", endDate);
  const setSortOrder = (sortOrder: SortOrderOption) => updateFilter("sortOrder", sortOrder);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<ReportData>({
    initialData: { transfers: [], summary: { totalTransfers: 0, totalQuantity: 0, byWarehouse: {} } },
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

  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    const cancelRequest = handleLoadData();
    return cancelRequest;
  }, [searchParams]);

  // const getLanguageKey = (language: string): "en" | "ar" => {
  //   return language.startsWith("en") ? "en" : "ar";
  // };

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
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
          <DateTimePicker
            clearable
            value={startDate}
            onChange={(date) => setStartDate(date ? date.toISOString() : "")}
            label={translate("Start Date", "تاريخ البداية")}
            placeholder={translate("Select Start Date", "اختر تاريخ البداية")}
          />
          <DateTimePicker
            clearable
            value={endDate}
            onChange={(date) => setEndDate(date ? date.toISOString() : "")}
            label={translate("End Date", "تاريخ النهاية")}
            placeholder={translate("Select End Date", "اختر تاريخ النهاية")}
          />
          <Select
            allowDeselect={false}
            value={sortOrder}
            onChange={(value) => setSortOrder((value || "desc") as SortOrderOption)}
            label={translate("Sort Order", "طريقة الترتيب")}
            placeholder={translate("Select Sort Order", "اختر طريقة الترتيب")}
            data={sortOrdersArray.map((option) => ({
              value: option.value,
              label: translate(option.label.en, option.label.ar),
            }))}
          />
        </div>

        {loading ? (
          <LoadingSection />
        ) : error ? (
          <ErrorSection 
            errorTitle={translate("Error", "خطأ")}
            errorMessage={error} 
          />
        ) : !data?.transfers?.length ? (
          <EmptySection useDefaultImg message={translate("No Data Found", "لا توجد بيانات")} />
        ) : (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
              <div className="p-4 border rounded">
                <Text size="sm" c="dimmed">{translate("Total Transfers", "إجمالي التحويلات")}</Text>
                <Text size="xl" fw={700}>{data.summary.totalTransfers}</Text>
              </div>
              <div className="p-4 border rounded">
                <Text size="sm" c="dimmed">{translate("Total Quantity", "إجمالي الكمية")}</Text>
                <Text size="xl" fw={700}>{data.summary.totalQuantity}</Text>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table className="text-nowrap" verticalSpacing="xs" withColumnBorders>
                <Table.Thead className="bg-gray-100 text-gray-800">
                  <Table.Tr>
                    <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                    <Table.Th>{translate("Product", "المنتج")}</Table.Th>
                    <Table.Th>{translate("Quantity", "الكمية")}</Table.Th>
                    <Table.Th>{translate("Source Warehouse", "المخزن المصدر")}</Table.Th>
                    <Table.Th>{translate("Target Warehouse", "المخزن الهدف")}</Table.Th>
                    <Table.Th>{translate("Transferred By", "تم النقل بواسطة")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.transfers.map((transfer) => (
                    <Table.Tr key={transfer._id} className="text-gray-600">
                      <Table.Td>{formatDate(transfer.date, language)}</Table.Td>
                      <Table.Td className="font-semibold text-gray-800">
                        {translate(transfer.product.title.en, transfer.product.title.ar)}
                      </Table.Td>
                      <Table.Td>{transfer.totalQuantity}</Table.Td>
                      <Table.Td>{transfer.sourceWarehouse}</Table.Td>
                      <Table.Td>{transfer.targetWarehouse}</Table.Td>
                      <Table.Td>{transfer.transferredBy.name}</Table.Td>
                    </Table.Tr>
                  ))}
                  
                  {/* Total Row */}
                  <Table.Tr className="font-semibold text-gray-800" style={{ backgroundColor: "#f3f4f6" }}>
                    <Table.Td colSpan={2} className="text-right">{translate("Total", "المجموع")}</Table.Td>
                    <Table.Td>{data.transfers.reduce((acc, transfer) => acc + transfer.totalQuantity, 0)}</Table.Td>
                    <Table.Td colSpan={3} />
                  </Table.Tr>
                </Table.Tbody>
              </Table>
            </div>

            {/* Warehouse Summary */}
            <div className="mt-4">
              <Text size="lg" fw={500} mb={2}>{translate("Transfers by Warehouse", "التحويلات حسب المخزن")}</Text>
              <Table className="text-nowrap" verticalSpacing="xs" withColumnBorders>
                <Table.Thead className="bg-gray-100 text-gray-800">
                  <Table.Tr>
                    <Table.Th>{translate("Warehouse", "المخزن")}</Table.Th>
                    <Table.Th>{translate("Outbound", "الصادر")}</Table.Th>
                    <Table.Th>{translate("Inbound", "الوارد")}</Table.Th>
                    <Table.Th>{translate("Net", "الصافي")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {Object.entries(data.summary.byWarehouse).map(([warehouse, stats]) => (
                    <Table.Tr key={warehouse} className="text-gray-600">
                      <Table.Td className="font-semibold text-gray-800">{warehouse}</Table.Td>
                      <Table.Td>{stats.outbound}</Table.Td>
                      <Table.Td>{stats.inbound}</Table.Td>
                      <Table.Td className="font-semibold text-gray-800">{stats.inbound - stats.outbound}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </AdminLayoutBox>
  );
}
