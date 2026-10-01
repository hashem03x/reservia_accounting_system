import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import paths from "@/utils/constants/paths";
import { DateTimePicker } from "@mantine/dates";
import { Table, Button } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";

const URL = "reports/balance-sheet";

interface BalanceSheetData {
  assets: {
    nonCurrentAssets: {
      fixedAssets: number;
      total: number;
    };
    currentAssets: {
      cashAndBank: number;
      inventory: number;
      accountsReceivable: number;
      total: number;
    };
    total: number;
  };
  liabilitiesAndEquity: {
    equity: {
      capital: number;
      retainedEarnings: number;
      netProfit: number;
      total: number;
    };
    liabilities: {
      nonCurrentLiabilities: {
        total: number;
      };
      currentLiabilities: {
        total: number;
      };
      total: number;
    };
    total: number;
  };
}

export default function BalanceSheetReport() {
  const { language, translate } = useLanguage();
  const title = translate("Balance Sheet Report", "تقرير الميزانية العمومية");
  useDocumentTitle(title);

  const [searchParams, setSearchParams] = useSearchParams();
  const endDateParam = searchParams.get("endDate");
  const endDate = endDateParam ? new Date(endDateParam) : null;

  const updateFilter = (key: string, value: string) => {
    if (!value) searchParams.delete(key);
    else searchParams.set(key, value);
    setSearchParams(searchParams);
  };

  const setEndDate = (endDate: string) => updateFilter("endDate", endDate);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<BalanceSheetData>({
    initialData: {} as BalanceSheetData,
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

  const renderRow = (label: string, value: number, isTotal?: boolean, indent?: boolean) => (
    <Table.Tr style={{ backgroundColor: isTotal ? "#f8f9fa" : "transparent" }}>
      <Table.Td style={{ paddingLeft: indent ? "2rem" : "1rem", fontWeight: isTotal ? "bold" : "normal" }}>
        {translate(label, label)}
      </Table.Td>
      <Table.Td align="right" style={{ fontWeight: isTotal ? "bold" : "normal" }}>
        {new Intl.NumberFormat(language === "ar-EG" ? "ar-SA" : "en-US", {
          style: "currency",
          currency: "EGP",
        }).format(value)}
      </Table.Td>
    </Table.Tr>
  );

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
                filename: "balance-sheet-report.xlsx",
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
      <DateTimePicker
        valueFormat="YYYY-MM-DD"
        label={translate("End Date", "تاريخ النهاية")}
        placeholder={translate("Select end date", "اختر تاريخ النهاية")}
        value={endDate}
        onChange={(date) => setEndDate(date ? date.toISOString().split("T")[0] : "")}
        clearable
      />

      {loading ? (
        <LoadingSection message={translate("Generating report...", "جارٍ إنشاء التقرير...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Error", "خطأ")} errorMessage={error} />
      ) : !data?.assets ? (
        <EmptySection />
      ) : (
        <div className="grid gap-8">
          {/* Assets Section */}
          <div>
            <h2 className="mb-2 font-bold">{translate("Assets", "الأصول")}</h2>
            <Table withTableBorder withColumnBorders>
              <Table.Tbody>
                <Table.Tr className="bg-gray-100 font-bold">
                  <Table.Td>{translate("Non-Current Assets", "الأصول غير المتداولة")}</Table.Td>
                  <Table.Td></Table.Td>
                </Table.Tr>
                {renderRow("Fixed Assets", data.assets.nonCurrentAssets.fixedAssets, false, true)}
                {renderRow("Total Non-Current Assets", data.assets.nonCurrentAssets.total, true)}

                <Table.Tr className="bg-gray-100 font-bold">
                  <Table.Td>{translate("Current Assets", "الأصول المتداولة")}</Table.Td>
                  <Table.Td></Table.Td>
                </Table.Tr>
                {renderRow("Cash and Bank", data.assets.currentAssets.cashAndBank, false, true)}
                {renderRow("Inventory", data.assets.currentAssets.inventory, false, true)}
                {renderRow("Accounts Receivable", data.assets.currentAssets.accountsReceivable, false, true)}
                {renderRow("Total Current Assets", data.assets.currentAssets.total, true)}

                <Table.Tr className="bg-gray-100">
                  <Table.Td className="text-lg font-bold text-blue-700">
                    {translate("Total Assets", "إجمالي الأصول")}
                  </Table.Td>
                  <Table.Td align="right" className="text-lg font-bold text-blue-700">
                    {new Intl.NumberFormat(language === "ar-EG" ? "ar-SA" : "en-US", {
                      style: "currency",
                      currency: "EGP",
                    }).format(data.assets.total)}
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </div>

          {/* Liabilities and Equity Section */}
          <div>
            <h2 className="mb-2 font-bold">{translate("Liabilities and Equity", "الالتزامات وحقوق الملكية")}</h2>
            <Table withTableBorder withColumnBorders>
              <Table.Tbody>
                <Table.Tr className="bg-gray-100 font-bold">
                  <Table.Td>{translate("Equity", "حقوق الملكية")}</Table.Td>
                  <Table.Td></Table.Td>
                </Table.Tr>
                {renderRow("Capital", data.liabilitiesAndEquity.equity.capital, false, true)}
                {renderRow("Retained Earnings", data.liabilitiesAndEquity.equity.retainedEarnings, false, true)}
                {renderRow("Net Profit", data.liabilitiesAndEquity.equity.netProfit, false, true)}
                {renderRow("Total Equity", data.liabilitiesAndEquity.equity.total, true)}

                <Table.Tr className="bg-gray-100 font-bold">
                  <Table.Td>{translate("Liabilities", "الالتزامات")}</Table.Td>
                  <Table.Td></Table.Td>
                </Table.Tr>
                {renderRow(
                  "Non-Current Liabilities",
                  data.liabilitiesAndEquity.liabilities.nonCurrentLiabilities.total,
                  false,
                  true,
                )}
                {renderRow(
                  "Current Liabilities",
                  data.liabilitiesAndEquity.liabilities.currentLiabilities.total,
                  false,
                  true,
                )}
                {renderRow("Total Liabilities", data.liabilitiesAndEquity.liabilities.total, true)}

                <Table.Tr className="bg-gray-100">
                  <Table.Td className="text-lg font-bold text-blue-700">
                    {translate("Total Liabilities and Equity", "إجمالي الالتزامات وحقوق الملكية")}
                  </Table.Td>
                  <Table.Td align="right" className="text-lg font-bold text-blue-700">
                    {new Intl.NumberFormat(language === "ar-EG" ? "ar-SA" : "en-US", {
                      style: "currency",
                      currency: "EGP",
                    }).format(data.liabilitiesAndEquity.total)}
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </div>
        </div>
      )}
    </AdminLayoutBox>
  );
}
