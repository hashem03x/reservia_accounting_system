import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { useWarehouses } from "@/context/WarehousesContext";
import { DateTimePicker } from "@mantine/dates";
import { Select, Title, Stack, Card, Group, Button } from "@mantine/core";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import paths from "@/utils/constants/paths";
import { solidIcons } from "@/components/icons";
import { Table } from "@mantine/core";

const URL = "reports/treasury-balance";
const FILENAME = "treasury-balance-report.xlsx";

interface PaymentMethod {
  method: string;
  inflow: number;
  outflow: number;
  balance: number;
}

interface WarehouseTreasury {
  warehouse: string;
  paymentMethods: PaymentMethod[];
  totals: {
    inflow: number;
    outflow: number;
    balance: number;
  };
}

interface ReportData {
  data: WarehouseTreasury[];
  status: string;
  results: number;
}

export default function TreasuryBalanceReport() {
  const { translate, language } = useLanguage();
  const { data: warehouses } = useWarehouses();

  const title = translate("Treasury Balance Report", "تقرير رصيد الخزينة");
  useDocumentTitle(title);

  const [searchParams, setSearchParams] = useSearchParams();

  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");
  const warehouseParam = searchParams.get("warehouse");

  const startDate = startDateParam ? new Date(startDateParam) : null;
  const endDate = endDateParam ? new Date(endDateParam) : null;
  const warehouse = warehouseParam || "";

  const updateFilter = (key: string, value: string | null) => {
    if (!value) searchParams.delete(key);
    else searchParams.set(key, value);
    setSearchParams(searchParams);
  };

  const setStartDate = (date: Date | null) => 
    updateFilter("startDate", date ? date.toISOString().split("T")[0] : null);
  const setEndDate = (date: Date | null) => 
    updateFilter("endDate", date ? date.toISOString().split("T")[0] : null);
  const setWarehouse = (warehouse: string | null) => 
    updateFilter("warehouse", warehouse);

  const { privateRequest, loading, error, data, setData, setLoading, setError } = useDataHandler<ReportData>({
    initialData: { data: [], status: "", results: 0 },
    initialLoading: true,
  });

  const handleLoadData = () => {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
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
      console.log('API Response Data:', response.data);
      console.log('API Response Data Structure:', {
        hasData: !!response.data,
        dataType: typeof response.data,
        isArray: Array.isArray(response.data),
        keys: response.data ? Object.keys(response.data) : null
      });
      
      // Ensure we have the correct data structure
      const formattedData = Array.isArray(response.data) ? { data: response.data, status: 'success', results: response.data.length } : response.data;
      setData(formattedData);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      canceled.current = true;
      controller.abort();
    };
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    const cancelRequest = handleLoadData();
    return cancelRequest;
  }, [searchParams]);

  const [downloading, setDownloading] = useState(false);

  const renderFilters = () => (
    <Group grow>
      <DateTimePicker
        valueFormat="YYYY-MM-DD"
        label={translate("Start Date", "تاريخ البداية")}
        value={startDate}
        onChange={setStartDate}
        clearable
      />
      <DateTimePicker
        valueFormat="YYYY-MM-DD"
        label={translate("End Date", "تاريخ النهاية")}
        value={endDate}
        onChange={setEndDate}
        clearable
      />
      <Select
        label={translate("Warehouse", "المخزن")}
        value={warehouse}
        onChange={setWarehouse}
        data={warehouses?.map((w) => ({ value: w._id, label: w.name })) || []}
        clearable
      />
    </Group>
  );

  const renderPaymentMethodRow = (method: PaymentMethod) => (
    <Table.Tr key={method.method} className="text-gray-600">
      <Table.Td className="font-semibold text-gray-800">{translate(
        method.method.charAt(0).toUpperCase() + method.method.slice(1).replace(/_/g, ' '),
        method.method === 'cash' ? 'نقدي' :
        method.method === 'paymob-online' ? 'باي موب اونلاين' :
        method.method === 'paymob-offline' ? 'باي موب اوفلاين' :
        method.method === 'wallet' ? 'محفظة' :
        method.method === 'instapay' ? 'انستا باي' :
        method.method === 'band_transfer' ? 'تحويل بنكي' :
        method.method === 'main-bank' ? 'البنك الرئيسي' :
        method.method === 'fawry' ? 'فوري' :
        method.method
      )}</Table.Td>
      <Table.Td style={{ textAlign: 'right' }}>
        {method.inflow.toFixed(2)}
      </Table.Td>
      <Table.Td style={{ textAlign: 'right' }}>
        {method.outflow.toFixed(2)}
      </Table.Td>
      <Table.Td 
        className="font-semibold" 
        style={{ 
          textAlign: 'right',
          color: method.balance < 0 ? '#ef4444' : '#22c55e'
        }}
      >
        {method.balance.toFixed(2)}
      </Table.Td>
    </Table.Tr>
  );

  const renderWarehouseTreasury = (treasury: WarehouseTreasury) => (
    <Card key={treasury.warehouse} withBorder>
      <Title order={4} mb="md">{treasury.warehouse}</Title>
      <div className="overflow-x-auto">
        <Table className="text-nowrap" verticalSpacing="xs" withColumnBorders>
          <Table.Thead className="bg-gray-100 text-gray-800">
            <Table.Tr>
              <Table.Th>{translate("Method", "الطريقة")}</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>{translate("Inflow", "الوارد")}</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>{translate("Outflow", "المنصرف")}</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>{translate("Balance", "الرصيد")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {treasury.paymentMethods.map(renderPaymentMethodRow)}
            <Table.Tr className="bg-gray-100 font-semibold text-gray-800">
              <Table.Td>{translate("Total", "المجموع")}</Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                {treasury.totals.inflow.toFixed(2)}
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                {treasury.totals.outflow.toFixed(2)}
              </Table.Td>
              <Table.Td 
                style={{ 
                  textAlign: 'right',
                  color: treasury.totals.balance < 0 ? '#ef4444' : '#22c55e'
                }}
              >
                {treasury.totals.balance.toFixed(2)}
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </div>
    </Card>
  );

  if (loading) {
    console.log('Loading state...');
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
          {renderFilters()}
          <LoadingSection message={translate("Generating report", "جاري إنشاء التقرير")} />
        </Stack>
      </AdminLayoutBox>
    );
  }
  if (error) {
    console.log('Error state:', error);
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
          {renderFilters()}
          <ErrorSection
            errorMessage={error}
            errorTitle={translate("Error Generating Report", "خطأ في إنشاء التقرير")}
            button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadData }}
          />
        </Stack>
      </AdminLayoutBox>
    );
  }
  
  console.log('Current Data State:', data);
  console.log('Data Structure:', {
    hasData: !!data,
    hasDataArray: !!data?.data,
    dataLength: data?.data?.length,
    dataType: typeof data,
    isArray: Array.isArray(data?.data)
  });

  // Check if data exists and has the expected structure
  if (!data?.data || data.data.length === 0) {
    console.log('No data available');
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
          {renderFilters()}
          <EmptySection useDefaultImg message={translate("No Data Found", "لا توجد بيانات")} />
        </Stack>
      </AdminLayoutBox>
    );
  }

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
        {renderFilters()}
        {data.data.map(renderWarehouseTreasury)}
      </Stack>
    </AdminLayoutBox>
  );
}
