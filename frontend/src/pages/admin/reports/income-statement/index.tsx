import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import { DateTimePicker } from "@mantine/dates";
import { Button, Select, Table, Group, Stack, Text } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import { solidIcons } from "@/components/icons";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";

const URL = "reports/income-statement";
const FILENAME = "income-statement-report.xlsx";

interface Period {
  start: string;
  end: string;
}

interface PeriodData {
  current: Period;
  previous: Period;
}

interface ExpenseData {
  byCategory: Record<string, number>;
  total: number;
}

interface ExpensesData {
  current: ExpenseData;
  previous: ExpenseData;
}

interface ComparativeValue {
  current: number;
  previous: number;
}

interface IncomeStatementData {
  period: PeriodData;
  sales: ComparativeValue;
  cogs: ComparativeValue;
  grossProfit: ComparativeValue;
  expenses: ExpensesData;
  netProfit: ComparativeValue;
  fixedAssets: ComparativeValue;  
}

interface ReportData {
  status: string;
  data: IncomeStatementData;
}

export default function IncomeStatementReport() {
  const { language, translate } = useLanguage();
  const { data: warehouses } = useWarehouses();

  const title = translate("Income Statement Report", "تقرير قائمة الدخل");
  useDocumentTitle(title);

  const [searchParams, setSearchParams] = useSearchParams();

  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");
  const warehouseId = searchParams.get("warehouseId") || "";

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

  const setWarehouse = (value: string | null) => {
    updateFilter("warehouseId", value);
  };

  const { privateRequest, loading, error, data, setData, setLoading, setError } = useDataHandler<ReportData>({
    initialData: {
      status: "",
      data: {
        period: {
          current: { start: "", end: "" },
          previous: { start: "", end: "" }
        },
        sales: { current: 0, previous: 0 },
        cogs: { current: 0, previous: 0 },
        grossProfit: { current: 0, previous: 0 },
        expenses: {
          current: { byCategory: {}, total: 0 },
          previous: { byCategory: {}, total: 0 }
        },
        netProfit: { current: 0, previous: 0 },
        fixedAssets: { current: 0, previous: 0 }
      }
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

        if (response?.status === 'success' && response?.data) {
          setData(response);
          setError("");
        } else {
          setError("Invalid response format");
          setData({
            status: "",
            data: {
              period: {
                current: { start: "", end: "" },
                previous: { start: "", end: "" }
              },
              sales: { current: 0, previous: 0 },
              cogs: { current: 0, previous: 0 },
              grossProfit: { current: 0, previous: 0 },
              expenses: {
                current: { byCategory: {}, total: 0 },
                previous: { byCategory: {}, total: 0 }
              },
              netProfit: { current: 0, previous: 0 },
              fixedAssets: { current: 0, previous: 0 }

            }
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
          data: {
            period: {
              current: { start: "", end: "" },
              previous: { start: "", end: "" }
            },
            sales: { current: 0, previous: 0 },
            cogs: { current: 0, previous: 0 },
            grossProfit: { current: 0, previous: 0 },
            expenses: {
              current: { byCategory: {}, total: 0 },
              previous: { byCategory: {}, total: 0 }
            },
            netProfit: { current: 0, previous: 0 },
            fixedAssets: { current: 0, previous: 0 }
          }
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


  const renderComparativeRow = (label: string, values: ComparativeValue, isTotal: boolean = false) => (
    <Table.Tr className={isTotal ? "font-semibold bg-gray-100" : ""}>
      <Table.Td>{translate(label, label)}</Table.Td>
      <Table.Td style={{ textAlign: "right" }}>{values.current.toFixed(2)}</Table.Td>
      <Table.Td style={{ textAlign: "right" }}>{values.previous.toFixed(2)}</Table.Td>
    </Table.Tr>
  );

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
          <Select
            label={translate("Warehouse", "المستودع")}
            value={warehouseId}
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
        </Group>

        {loading ? (
          <LoadingSection message={translate("Generating report", "جاري إنشاء التقرير")} />
        ) : error ? (
          <ErrorSection
            errorMessage={error}
            errorTitle={translate("Error Generating Report", "خطأ في إنشاء التقرير")}
            button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadData }}
          />
        ) : !data?.data ? (
          <EmptySection useDefaultImg message={translate("No Data Found", "لا توجد بيانات")} />
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-nowrap" verticalSpacing="xs" withColumnBorders>
              <Table.Thead className="bg-gray-100 text-gray-800">
                <Table.Tr>
                  <Table.Th>{translate("Item", "البند")}</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>
                    {translate("Current Period", "الفترة الحالية")}
                    <Text size="xs" c="dimmed">
                      {formatDate(data.data.period.current.start, language)} - {formatDate(data.data.period.current.end, language)}
                    </Text>
                  </Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>
                    {translate("Previous Period", "الفترة السابقة")}
                    <Text size="xs" c="dimmed">
                      {formatDate(data.data.period.previous.start, language)} - {formatDate(data.data.period.previous.end, language)}
                    </Text>
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {/* Sales */}
                {renderComparativeRow("Sales", data.data.sales)}
                {renderComparativeRow("Cost of Goods Sold", data.data.cogs)}
                {renderComparativeRow("Gross Profit", data.data.grossProfit, true)}

                {/* Expenses */}
                <Table.Tr>
                  <Table.Td colSpan={3} className="font-semibold">
                    {translate("Operating Expenses", "مصروفات التشغيل")}
                  </Table.Td>
                </Table.Tr>
                {Object.entries(data.data.expenses.current.byCategory).map(([category, amount]) => (
                  <Table.Tr key={category}>
                    <Table.Td className="pl-8">
                      {translate(category, category)}
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }}>
                      {amount.toFixed(2)}
                    </Table.Td>
                    <Table.Td style={{ textAlign: "right" }}>
                      {(data.data.expenses.previous.byCategory[category] || 0).toFixed(2)}
                    </Table.Td>
                  </Table.Tr>
                ))}
                <Table.Tr className="font-semibold bg-gray-100">
                  <Table.Td>{translate("Total Expenses", "إجمالي المصروفات")}</Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    {data.data.expenses.current.total.toFixed(2)}
                  </Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    {data.data.expenses.previous.total.toFixed(2)}
                  </Table.Td>
                </Table.Tr>

                {/* Add this where you display other financial rows */}
                <Table.Tr>
                  <Table.Td>{translate("Fixed Assets Loss", "الفااقد ")}</Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    {data.data.fixedAssets.current.toFixed(2)}
                  </Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    {data.data.fixedAssets.previous.toFixed(2)}
                  </Table.Td>
                </Table.Tr>


                {/* Net Profit */}
                <Table.Tr className="font-semibold text-lg" style={{ backgroundColor: "#f3f4f6" }}>
                  <Table.Td>{translate("Net Profit", "صافي الربح")}</Table.Td>
                  <Table.Td 
                    style={{ 
                      textAlign: "right",
                      color: data.data.netProfit.current < 0 ? "#ef4444" : "#22c55e"
                    }}
                  >
                    {data.data.netProfit.current.toFixed(2)}
                  </Table.Td>
                  <Table.Td 
                    style={{ 
                      textAlign: "right",
                      color: data.data.netProfit.previous < 0 ? "#ef4444" : "#22c55e"
                    }}
                  >
                    {data.data.netProfit.previous.toFixed(2)}
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


/**
 * i want to create a new report for balance-sheet @balance-sheet
 * where the endpoint is {{URL}}/reports/balance-sheet?endDate=2026-12-12
 * and the response will be like this
 * {
    "status": "success",
    "data": {
        "assets": {
            "nonCurrentAssets": {
                "fixedAssets": 99,
                "total": 99
            },
            "currentAssets": {
                "cashAndBank": 9897437.88,
                "inventory": 0,
                "accountsReceivable": 2200,
                "total": 9895237.88
            },
            "total": 9895336.88
        },
        "liabilitiesAndEquity": {
            "equity": {
                "capital": 0,
                "retainedEarnings": 0,
                "netProfit": 17399346.88,
                "total": 17399346.88
            },
            "liabilities": {
                "nonCurrentLiabilities": {
                    "total": 0
                },
                "currentLiabilities": {
                    "total": 900
                },
                "total": 900
            },
            "total": 17400246.88
        }
    }
}

update @App to handle this new page @balance-sheet and check how we handle report response (table, cells, ...) take product report as a reference @product 
after any update you should run "npm run build" to make sure you don't have any errors
 */