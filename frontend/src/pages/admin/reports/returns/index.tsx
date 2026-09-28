import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import { DateTimePicker } from "@mantine/dates";
import { Button, Table, Group, Stack } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import { solidIcons } from "@/components/icons";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";

const URL = "reports/returns";
const FILENAME = "returns-report.xlsx";

interface ReturnData {
  returnId: string;
  customerName: string;
  customerPhone: string;
  warehouse: string;
  product: string;
  category: string;
  subcategory: string;
  variantCode: string;
  color: string;
  size: string;
  returnedQuantity: number;
  returnedAmount: number;
  createdBy: string;
  createdAt: string;
}

interface ReportData {
  status: string;
  results: number;
  data: ReturnData[];
}

export default function ReturnsReport() {
  const { language, translate } = useLanguage();

  const title = translate("Returns Report", "تقرير المرتجعات");
  useDocumentTitle(title);

  const [searchParams, setSearchParams] = useSearchParams();

  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");

  const startDate = startDateParam ? new Date(startDateParam) : null;
  const endDate = endDateParam ? new Date(endDateParam) : null;

  const updateFilter = (key: string, value: string | null) => {
    const newSearchParams = new URLSearchParams(searchParams);
    if (value) {
      newSearchParams.set(key, value);
    } else {
      newSearchParams.delete(key);
    }
    setSearchParams(newSearchParams);
  };

  const setStartDate = (date: Date | null) => {
    updateFilter("startDate", date?.toISOString() || "");
  };

  const setEndDate = (date: Date | null) => {
    updateFilter("endDate", date?.toISOString() || "");
  };

  const { privateRequest, loading, error, data, setData, setLoading, setError } = useDataHandler<ReportData>({ 
    initialData: {
      status: "",
      results: 0,
      data: []
    },
    initialLoading: true
  });

  function handleLoadData() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      try {
        const params = { ...Object.fromEntries(searchParams) };
        const response = await privateRequest({
          url: URL,
          params,
          signal: controller.signal,
          language,
        });

        if (response?.status === 'success' && Array.isArray(response?.data)) {
          setData({
            status: response.status,
            results: response.results,
            data: response.data
          });
          setError("");
        } else {
          setError("Invalid response format");
          setData({
            status: "",
            results: 0,
            data: []
          });
        }
      } catch (err) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("An error occurred");
        }
        setData({
          status: "",
          results: 0,
          data: []
        });
      }
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
      <Stack gap="lg">
        {/* Filters */}
        <Group grow>
          <DateTimePicker
            label={translate("Start Date", "تاريخ البداية")}
            placeholder={translate("Select Start Date", "حدد تاريخ البداية")}
            value={startDate}
            onChange={setStartDate}
            clearable
          />
          <DateTimePicker
            label={translate("End Date", "تاريخ النهاية")}
            placeholder={translate("Select End Date", "حدد تاريخ النهاية")}
            value={endDate}
            onChange={setEndDate}
            clearable
          />
        </Group>

        {loading ? (
          <LoadingSection message={translate("Generating report", "جاري إنشاء التقرير")} />
        ) : error ? (
          <ErrorSection
            errorMessage={error}
            errorTitle={translate("Error Generating Report", "خطأ في إنشاء التقرير")}
            button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadData }}
          />
        ) : !data?.results ? (
          <EmptySection useDefaultImg message={translate("No Data Found", "لا توجد بيانات")} />
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-nowrap" verticalSpacing="xs" withColumnBorders>
              <Table.Thead className="bg-gray-100 text-gray-800">
                <Table.Tr>
                  <Table.Th>{translate("Customer Name", "اسم العميل")}</Table.Th>
                  <Table.Th>{translate("Customer Phone", "رقم الهاتف")}</Table.Th>
                  <Table.Th>{translate("Warehouse", "المستودع")}</Table.Th>
                  <Table.Th>{translate("Product", "المنتج")}</Table.Th>
                  <Table.Th>{translate("Category", "القسم")}</Table.Th>
                  <Table.Th>{translate("Subcategory", "القسم الفرعي")}</Table.Th>
                  <Table.Th>{translate("Variant Code", "كود المنتج")}</Table.Th>
                  <Table.Th>{translate("Color", "اللون")}</Table.Th>
                  <Table.Th>{translate("Size", "المقاس")}</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>{translate("Returned Quantity", "الكمية المرتجعة")}</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>{translate("Returned Amount", "المبلغ المرتجع")}</Table.Th>
                  <Table.Th>{translate("Created By", "تم بواسطة")}</Table.Th>
                  <Table.Th>{translate("Created At", "تاريخ الإنشاء")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.data.map((item: ReturnData) => (
                  <Table.Tr key={item.returnId} className="text-gray-600">
                    <Table.Td className="font-semibold text-gray-800">{item.customerName}</Table.Td>
                    <Table.Td>{item.customerPhone}</Table.Td>
                    <Table.Td>{item.warehouse}</Table.Td>
                    <Table.Td>{item.product}</Table.Td>
                    <Table.Td>{item.category}</Table.Td>
                    <Table.Td>{item.subcategory}</Table.Td>
                    <Table.Td>{item.variantCode}</Table.Td>
                    <Table.Td>{item.color}</Table.Td>
                    <Table.Td>{item.size}</Table.Td>
                    <Table.Td style={{ textAlign: "right" }}>{item.returnedQuantity}</Table.Td>
                    <Table.Td style={{ textAlign: "right" }}>{item.returnedAmount.toFixed(2)}</Table.Td>
                    <Table.Td>{item.createdBy}</Table.Td>
                    <Table.Td>{formatDate(item.createdAt, language)}</Table.Td>
                  </Table.Tr>
                ))}

                {/* Total Row */}
                <Table.Tr className="font-semibold text-gray-800" style={{ backgroundColor: "#f3f4f6" }}>
                  <Table.Td colSpan={9}>{translate("Total", "المجموع")}</Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    {data.data.reduce((sum, item) => sum + item.returnedQuantity, 0)}
                  </Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    {data.data.reduce((sum, item) => sum + item.returnedAmount, 0).toFixed(2)}
                  </Table.Td>
                  <Table.Td colSpan={2}></Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </div>
        )}
      </Stack>
    </AdminLayoutBox>
  );
}
