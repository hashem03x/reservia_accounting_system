import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { DateTimePicker } from "@mantine/dates";
import { Button, Group, Stack, Select, Table } from "@mantine/core";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import paths from "@/utils/constants/paths";
import { solidIcons } from "@/components/icons";
import { formatDate } from "@/utils/helpers/date-formaters";

const URL = "reports/profit-by-sales";
const FILENAME = "profit-by-sales-report.xlsx";

interface ReportData {
  status: string;
  results: number;
  data: {
    _id: string;
    orderId: string;
    customerName: string;
    createdAt: string;
    totalSales: number;
    costOfSales: number;
    grossProfit: number;
  }[];
}

export default function ProfitBySalesReport() {
  const { language, translate } = useLanguage();
  const { data: warehouses } = useWarehouses();

  const title = translate("Profit By Sales Report", "تقرير الربح من المبيعات");
  useDocumentTitle(title);

  const [searchParams, setSearchParams] = useSearchParams();

  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");
  const warehouseParam = searchParams.get("warehouse");
  const onlineParam = searchParams.get("online");

  const startDate = startDateParam ? new Date(startDateParam) : null;
  const endDate = endDateParam ? new Date(endDateParam) : null;
  const warehouse = warehouseParam || "";
  const online = onlineParam || "";

  const updateFilter = (key: string, value: string | null) => {
    if (!value) searchParams.delete(key);
    else searchParams.set(key, value);
    setSearchParams(searchParams);
  };

  const setStartDate = (date: Date | null) =>
    updateFilter("startDate", date?.toISOString() || "");

  const setEndDate = (date: Date | null) =>
    updateFilter("endDate", date?.toISOString() || "");

  const setWarehouse = (value: string | null) => {
    updateFilter("warehouse", value);
  };

  const setOnline = (value: string | null) => {
    updateFilter("online", value);
  };

  const { privateRequest, loading, error, data, setData, setLoading, setError } = useDataHandler<ReportData>({
    initialData: { status: "", results: 0, data: [] },
    initialLoading: true,
  });

  const handleLoadData = () => {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      try {
        console.log('Request params:', Object.fromEntries(searchParams));
        const response = await privateRequest({
          url: URL,
          params: { ...Object.fromEntries(searchParams) },
          signal: controller.signal,
          language,
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        });
        console.log('API Response:', response);
        
        // Ensure we have the correct data structure
        const formattedData = Array.isArray(response.data) ? 
          { data: response.data, status: 'success', results: response.data.length } : 
          response.data;
          
        if (!canceled.current) {
          setData(formattedData);
        }
      } catch (err) {
        console.error('API Error:', err);
        if (!canceled.current) {
          setError((err as Error).message || translate('Failed to load data', 'فشل تحميل البيانات'));
        }
      }
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    const cancelRequest = handleLoadData();
    return cancelRequest;
  }, [searchParams]);

  const [downloading, setDownloading] = useState(false);

  if (loading) return <LoadingSection />;
  if (error) return <ErrorSection errorMessage={error} errorTitle={translate("Error", "خطأ")} />;

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
      <Stack gap="md">
        <Group grow>
          <DateTimePicker
            valueFormat="YYYY-MM-DD"
            label={translate("Start Date", "تاريخ البداية")}
            placeholder={translate("Select Start Date", "حدد تاريخ البداية")}
            value={startDate}
            onChange={setStartDate}
            clearable
          />
          <DateTimePicker
            valueFormat="YYYY-MM-DD"
            label={translate("End Date", "تاريخ النهاية")}
            placeholder={translate("Select End Date", "حدد تاريخ النهاية")}
            value={endDate}
            onChange={setEndDate}
            clearable
          />
          <Select
            label={translate("Warehouse", "المستودع")}
            value={warehouse}
            onChange={setWarehouse}
            data={[
              { value: "", label: translate("All", "الكل") },
              ...(warehouses?.map((warehouse) => ({
                value: warehouse._id,
                label: warehouse.name,
              })) || []),
            ]}
            clearable
          />
          <Select
            label={translate("Order Type", "نوع الطلب")}
            value={online}
            onChange={setOnline}
            data={[
              { value: "", label: translate("All", "الكل") },
              { value: "true", label: translate("Online", "أونلاين") },
              { value: "false", label: translate("In Store", "في المتجر") },
            ]}
            clearable
          />
        </Group>

        {!loading && !error && (!data?.data || data.data.length === 0) && (
          <EmptySection />
        )}

        {!loading && !error && data?.data && data.data.length > 0 && (
          <div className="overflow-x-auto">
            <Table className="text-nowrap" verticalSpacing="xs" withColumnBorders>
              <Table.Thead className="bg-gray-100 text-gray-800">
                <Table.Tr>
                  <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                  <Table.Th>{translate("Order ID", "رقم الطلب")}</Table.Th>
                  <Table.Th>{translate("Customer Name", "اسم العميل")}</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>{translate("Total Sales", "إجمالي المبيعات")}</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>{translate("Cost of Sales", "تكلفة المبيعات")}</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>{translate("Gross Profit", "الربح الإجمالي")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.data.map((item) => (
                  <Table.Tr key={item._id} className="text-gray-600">
                    <Table.Td className="font-semibold text-gray-800">
                      {formatDate(item.createdAt, language)}
                    </Table.Td>
                    <Table.Td className="font-semibold">
                      {item.orderId}
                    </Table.Td>
                    <Table.Td>
                      {item.customerName}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {item.totalSales.toFixed(2)}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {item.costOfSales.toFixed(2)}
                    </Table.Td>
                    <Table.Td 
                      className="font-semibold" 
                      style={{ 
                        textAlign: 'right',
                        color: item.grossProfit < 0 ? '#ef4444' : '#22c55e'
                      }}
                    >
                      {item.grossProfit.toFixed(2)}
                    </Table.Td>
                  </Table.Tr>
                ))}

                {/* Total Row */}
                <Table.Tr className="bg-gray-100 font-semibold text-gray-800">
                  <Table.Td>{translate("Total", "المجموع")}</Table.Td>
                  <Table.Td></Table.Td>
                  <Table.Td></Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {data.data.reduce((sum, item) => sum + item.totalSales, 0).toFixed(2)}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {data.data.reduce((sum, item) => sum + item.costOfSales, 0).toFixed(2)}
                  </Table.Td>
                  <Table.Td style={{ 
                    textAlign: 'right',
                    color: data.data.reduce((sum, item) => sum + item.grossProfit, 0) < 0 ? '#ef4444' : '#22c55e'
                  }}>
                    {data.data.reduce((sum, item) => sum + item.grossProfit, 0).toFixed(2)}
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </div>
        )}
      </Stack>
    </AdminLayoutBox>
  );
}
