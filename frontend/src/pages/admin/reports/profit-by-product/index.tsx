import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMainCategories } from "@/context/MainCategoriesContext";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useCategoryHelpers from "@/hooks/useCategoryHelpers";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import { Season } from "@/types/product";
import { getSeasonLabel } from "@/utils/constants/seasons";
import { DateTimePicker } from "@mantine/dates";
import { Button, Select, Table, Group, Stack } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import { solidIcons } from "@/components/icons";
import handleRequest from "@/utils/helpers/handle-request";

const URL = "reports/profit-by-product";
const FILENAME = "profit-by-product-report.xlsx";

interface ProductProfitData {
  productId: string;
  productName: string;
  category: string;
  subcategory: string;
  season: Season;
  totalQuantity: number;
  totalSales: number;
  costOfSales: number;
  grossProfit: number;
  price: number;
  cost: number;
}

interface ReportData {
  status: string;
  results: number;
  data: ProductProfitData[];
}

type SeasonOption = Season;
type SortByOption = "totalSales" | "costOfSales" | "grossProfit" | "createdAt" | "price";
type SortOrderOption = "asc" | "desc";

export default function ProfitByProductReport() {
  const { language, translate } = useLanguage();
  const { data: mainCategories } = useMainCategories();
  const { data: warehouses } = useWarehouses();
  const { getSubcategoriesByMainCategoryId } = useCategoryHelpers();

  const title = translate("Profit By Product Report", "تقرير الربح حسب المنتج");
  useDocumentTitle(title);

  const [searchParams, setSearchParams] = useSearchParams();

  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");

  const startDate = startDateParam ? new Date(startDateParam) : null;
  const endDate = endDateParam ? new Date(endDateParam) : null;
  const season = (searchParams.get("season") || "all") as SeasonOption;
  const mainCategory = searchParams.get("mainCategory") || "";
  const subcategory = searchParams.get("subcategory") || "";
  const warehouse = searchParams.get("warehouse") || "";
  const online = searchParams.get("online") || "";
  const sortBy = (searchParams.get("sortBy") || "createdAt") as SortByOption;
  const sortOrder = (searchParams.get("sortOrder") || "desc") as SortOrderOption;

  const updateFilter = (key: string, value: string | null) => {
    if (!value) searchParams.delete(key);
    else searchParams.set(key, value);
    setSearchParams(searchParams);
  };

  const setStartDate = (date: Date | null) =>
    updateFilter("startDate", date?.toISOString() || "");

  const setEndDate = (date: Date | null) =>
    updateFilter("endDate", date?.toISOString() || "");

  const setSeason = (value: string | null) => {
    updateFilter("season", value || "all");
  };

  const setWarehouse = (value: string | null) => {
    updateFilter("warehouse", value);
  };

  const setOnline = (value: string | null) => {
    updateFilter("online", value);
  };

  const setMainCategory = (value: string | null) => {
    updateFilter("mainCategory", value);
    if (!value) {
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete("subcategory");
      setSearchParams(newSearchParams);
    }
  };

  const setSubcategory = (value: string | null) => {
    updateFilter("subcategory", value);
  };

  const setSortBy = (value: string | null) => {
    updateFilter("sortBy", value || "createdAt");
  };

  const setSortOrder = (value: string | null) => {
    updateFilter("sortOrder", value || "desc");
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
        </Group>

        <Group grow>
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
          <Select
            label={translate("Season", "الموسم")}
            value={season}
            onChange={setSeason}
            data={[
              { value: "all", label: translate("Both", "كلاهما") },
              { value: "summer", label: translate("Summer", "صيفي") },
              { value: "winter", label: translate("Winter", "شتوي") }
            ]}
            clearable
          />
          <Select
            label={translate("Main Category", "القسم الرئيسي")}
            value={mainCategory}
            onChange={setMainCategory}
            data={[
              { value: "", label: translate("All", "الكل") },
              ...(mainCategories?.map((category) => ({
                value: category._id,
                label: category.name.en,
              })) || []),
            ]}
            clearable
          />
          {mainCategory && (
            <Select
              label={translate("Subcategory", "القسم الفرعي")}
              value={subcategory}
              onChange={setSubcategory}
              data={[
                { value: "", label: translate("All", "الكل") },
                ...getSubcategoriesByMainCategoryId(mainCategory).map((subcategory) => ({
                  value: subcategory._id,
                  label: subcategory.name.en,
                })),
              ]}
              clearable
            />
          )}
        </Group>

        <Group grow>
          <Select
            label={translate("Sort By", "ترتيب حسب")}
            value={sortBy}
            onChange={setSortBy}
            data={[
              { value: "createdAt", label: translate("Date", "التاريخ") },
              { value: "totalSales", label: translate("Total Sales", "إجمالي المبيعات") },
              { value: "costOfSales", label: translate("Cost of Sales", "تكلفة المبيعات") },
              { value: "grossProfit", label: translate("Gross Profit", "الربح الإجمالي") },
              { value: "price", label: translate("Price", "السعر") }
            ]}
          />
          <Select
            label={translate("Sort Order", "ترتيب")}
            value={sortOrder}
            onChange={setSortOrder}
            data={[
              { value: "asc", label: translate("Ascending", "تصاعدي") },
              { value: "desc", label: translate("Descending", "تنازلي") }
            ]}
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
                  <Table.Th>{translate("Product Name", "اسم المنتج")}</Table.Th>
                  <Table.Th>{translate("Category", "القسم")}</Table.Th>
                  <Table.Th>{translate("Subcategory", "القسم الفرعي")}</Table.Th>
                  <Table.Th>{translate("Season", "الموسم")}</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>{translate("Total Quantity", "الكمية الإجمالية")}</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>{translate("Price", "السعر")}</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>{translate("Cost", "التكلفة")}</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>{translate("Total Sales", "إجمالي المبيعات")}</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>{translate("Cost of Sales", "تكلفة المبيعات")}</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>{translate("Gross Profit", "الربح الإجمالي")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.data.map((item: ProductProfitData) => (
                  <Table.Tr key={item.productId} className="text-gray-600">
                    <Table.Td className="font-semibold text-gray-800">{item.productName}</Table.Td>
                    <Table.Td>{item.category}</Table.Td>
                    <Table.Td>{item.subcategory}</Table.Td>
                    <Table.Td>{getSeasonLabel(item.season, language)}</Table.Td>
                    <Table.Td style={{ textAlign: "right" }}>{item.totalQuantity}</Table.Td>
                    <Table.Td style={{ textAlign: "right" }}>{item.price.toFixed(2)}</Table.Td>
                    <Table.Td style={{ textAlign: "right" }}>{item.cost.toFixed(2)}</Table.Td>
                    <Table.Td style={{ textAlign: "right" }}>{item.totalSales.toFixed(2)}</Table.Td>
                    <Table.Td style={{ textAlign: "right" }}>{item.costOfSales.toFixed(2)}</Table.Td>
                    <Table.Td 
                      className="font-semibold" 
                      style={{ 
                        textAlign: "right",
                        color: item.grossProfit < 0 ? "#ef4444" : "#22c55e"
                      }}
                    >
                      {item.grossProfit.toFixed(2)}
                    </Table.Td>
                  </Table.Tr>
                ))}

                {/* Total Row */}
                <Table.Tr className="font-semibold text-gray-800" style={{ backgroundColor: "#f3f4f6" }}>
                  <Table.Td colSpan={7}>{translate("Total", "المجموع")}</Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    {data.data.reduce((sum, item) => sum + item.totalSales, 0).toFixed(2)}
                  </Table.Td>
                  <Table.Td style={{ textAlign: "right" }}>
                    {data.data.reduce((sum, item) => sum + item.costOfSales, 0).toFixed(2)}
                  </Table.Td>
                  <Table.Td style={{ 
                    textAlign: "right",
                    color: data.data.reduce((sum, item) => sum + item.grossProfit, 0) < 0 ? "#ef4444" : "#22c55e"
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
