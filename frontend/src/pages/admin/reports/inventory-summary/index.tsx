import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMainCategories } from "@/context/MainCategoriesContext";
import { useSubcategories } from "@/context/SubcategoriesContext";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import paths from "@/utils/constants/paths";
import { solidIcons } from "@/components/icons";
import { Button, Select, Table, Text } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";

import EmptySection from "@/components/ui/sections/empty";
import { useWarehouses } from "@/context/WarehousesContext";

import { format } from "date-fns";
import { ar, enGB } from "date-fns/locale";

interface InventoryItem {
  _id: string;
  title: {
    en: string;
    ar: string;
  };
  description: {
    en: string;
    ar: string;
  };
  sku: string;
  cost: number;
  price: number;
  totalSold: number;
  category: {
    en: string;
    ar: string;
  };
  subcategory: {
    en: string;
    ar: string;
  };
  stockStatus: "in_stock" | "running_low" | "out_of_stock";
  stockLevel: number;
  value: number;
  createdAt: string;
  barcode?: string;
}

interface ReportData {
  status: string;
  results: number;
  data: {
    inventory: InventoryItem[];
    summary: {
      totalProducts: number;
      totalValue: number;
      totalStock: number;
      totalSold: number;
      byCategory: Record<
        string,
        {
          count: number;
          value: number;
          stock: number;
          sold: number;
        }
      >;
      byStockStatus: {
        in_stock: number;
        running_low: number;
        out_of_stock: number;
      };
    };
  };
}

const URL = "reports/inventory-summary";
const FILENAME = "inventory-summary-report.xlsx";

export default function InventorySummaryReport() {
  const { language, translate, translations } = useLanguage();
  const { data: mainCategories } = useMainCategories();
  const { data: subcategories } = useSubcategories();
  const { data: warehouses } = useWarehouses();

  const title = translate("Inventory Summary Report", "تقرير ملخص المخزون");
  useDocumentTitle(title);

  const [searchParams, setSearchParams] = useSearchParams();

  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");

  const startDate = startDateParam ? new Date(startDateParam) : null;
  const endDate = endDateParam ? new Date(endDateParam) : null;
  const category = searchParams.get("category") || "";
  const subCategory = searchParams.get("subCategory") || "";
  const stockStatus = searchParams.get("stockStatus") || "";
  const warehouse = searchParams.get("warehouse") || "";

  const updateFilter = (key: string, value: string) => {
    if (key === "category") searchParams.delete("subCategory");
    if (!value) searchParams.delete(key);
    else searchParams.set(key, value);
    setSearchParams(searchParams);
  };

  const setStartDate = (startDate: string) => updateFilter("startDate", startDate);
  const setEndDate = (endDate: string) => updateFilter("endDate", endDate);
  const setCategory = (category: string) => updateFilter("category", category);
  const setSubCategory = (subCategory: string) => updateFilter("subCategory", subCategory);
  const setStockStatus = (status: string) => updateFilter("stockStatus", status);
  const setWarehouse = (warehouse: string) => updateFilter("warehouse", warehouse);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<ReportData>({
    initialData: {
      status: "loading",
      results: 0,
      data: {
        inventory: [],
        summary: {
          totalProducts: 0,
          totalValue: 0,
          totalStock: 0,
          totalSold: 0,
          byCategory: {},
          byStockStatus: {
            in_stock: 0,
            running_low: 0,
            out_of_stock: 0,
          },
        },
      },
    },
    initialLoading: true,
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    const cancelRequest = handleLoadData();
    return cancelRequest;
  }, [searchParams]);

  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    console.log("Current data state:", data);
  }, [data]);

  const formatDate = (date: string, language: string) => {
    const locale = language === "en" ? enGB : ar;
    return format(new Date(date), "dd MMM yyyy", { locale });
  };

  const getSummary = () => {
    if (!data || !data.data || !data.data.summary) {
      return {
        totalProducts: 0,
        totalValue: 0,
        totalStock: 0,
        totalSold: 0,
        byStockStatus: {
          in_stock: 0,
          running_low: 0,
          out_of_stock: 0,
        },
      };
    }
    return data.data.summary;
  };

  const getInventory = () => {
    if (!data || !data.data || !data.data.inventory) {
      return [];
    }
    return data.data.inventory;
  };

  const summary = getSummary();
  const inventory = getInventory();

  function handleLoadData() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      try {
        const response = await privateRequest({
          url: URL,
          params: { ...Object.fromEntries(searchParams) },
          signal: controller.signal,
          language,
        });
        console.log("API Response structure:", JSON.stringify(response, null, 2));

        // The response is already in the format we want
        setData(response);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  return (
    <AdminLayoutBox
      header={{
        backLink: `/${paths.admin}/${paths.reports}`,
        title: title,
        border: true,
        sideElements: (
          <Button
            disabled={downloading}
            variant="light"
            color="green"
            radius="md"
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
            onChange={(date: Date | null) => setStartDate(date?.toISOString() || "")}
            clearable
          />
          <DateTimePicker
            label={translate("End Date", "تاريخ النهاية")}
            placeholder={translate("Select End Date", "حدد تاريخ النهاية")}
            value={endDate}
            onChange={(date: Date | null) => setEndDate(date?.toISOString() || "")}
            clearable
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {/* Category */}
          <Select
            clearable
            value={category}
            onChange={(value) => setCategory(value || "")}
            label={translate("Category", "الفئة")}
            placeholder={translate("Select Category", "اختر الفئة")}
            data={mainCategories.map((category) => ({
              value: category._id,
              label: translate(category.name.en, category.name.ar),
            }))}
          />

          {/* SubCategory */}
          <Select
            clearable
            value={subCategory}
            onChange={(value) => setSubCategory(value || "")}
            label={translate("Subcategory", "الفئة الفرعية")}
            placeholder={translate("Select Subcategory", "اختر الفئة الفرعية")}
            disabled={!category}
            data={
              category
                ? subcategories
                    .filter((subcat) => subcat.mainCategory._id === category)
                    .map((subcat) => ({
                      value: subcat._id,
                      label: translate(subcat.name.en, subcat.name.ar),
                    }))
                : []
            }
          />

          {/* Stock Status */}
          <Select
            clearable
            value={stockStatus}
            onChange={(value) => setStockStatus(value || "")}
            label={translate("Stock Status", "حالة المخزون")}
            placeholder={translate("Select Status", "اختر الحالة")}
            data={[
              { value: "in_stock", label: translate("In Stock", "متوفر") },
              { value: "running_low", label: translate("Running Low", "منخفض") },
              { value: "out_of_stock", label: translate("Out of Stock", "نفذ") },
            ]}
          />

          {/* Warehouse */}
          <Select
            clearable
            value={warehouse}
            onChange={(value) => setWarehouse(value || "")}
            label={translate("Warehouse", "المستودع")}
            placeholder={translate("Select Warehouse", "اختر المستودع")}
            data={
              warehouses?.map((wh) => ({
                value: wh._id,
                label: translate(wh.name, wh.name),
              })) || []
            }
          />
        </div>
      </div>

      {loading ? (
        <LoadingSection />
      ) : error ? (
        <ErrorSection errorTitle={translate("Error", "خطأ")} errorMessage={error} />
      ) : inventory.length === 0 ? (
        <>
          <div className="mb-4 rounded border border-yellow-200 bg-yellow-50 p-4">
            <Text size="sm">Debug info: Response data: {JSON.stringify(data, null, 2)}</Text>
          </div>
          <EmptySection useDefaultImg message={translate("No Data Found", "لا توجد بيانات")} />
        </>
      ) : (
        <div>
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div className="rounded border p-4">
              <Text size="sm" c="dimmed">
                {translate("Total Products", "إجمالي المنتجات")}
              </Text>
              <Text size="xl" fw={700}>
                {summary.totalProducts}
              </Text>
            </div>
            <div className="rounded border p-4">
              <Text size="sm" c="dimmed">
                {translate("Total Value", "القيمة الإجمالية")}
              </Text>
              <Text size="xl" fw={700}>
                {summary.totalValue.toLocaleString()} {translations.currency}
              </Text>
            </div>
            <div className="rounded border p-4">
              <Text size="sm" c="dimmed">
                {translate("Total Stock", "إجمالي المخزون")}
              </Text>
              <Text size="xl" fw={700}>
                {summary.totalStock}
              </Text>
            </div>
            <div className="rounded border p-4">
              <Text size="sm" c="dimmed">
                {translate("Total Sold", "إجمالي المبيعات")}
              </Text>
              <Text size="xl" fw={700}>
                {summary.totalSold}
              </Text>
            </div>
          </div>

          {/* <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded border p-4">
              <Text size="sm" c="dimmed">
                {translate("In Stock Items", "العناصر المتوفرة")}
              </Text>
              <Text size="xl" fw={700}>
                {summary.byStockStatus.in_stock}
              </Text>
            </div>
            <div className="rounded border p-4">
              <Text size="sm" c="dimmed">
                {translate("Running Low Items", "العناصر منخفضة المخزون")}
              </Text>
              <Text size="xl" fw={700}>
                {summary.byStockStatus.running_low}
              </Text>
            </div>
            <div className="rounded border p-4">
              <Text size="sm" c="dimmed">
                {translate("Out of Stock Items", "العناصر غير المتوفرة")}
              </Text>
              <Text size="xl" fw={700}>
                {summary.byStockStatus.out_of_stock}
              </Text>
            </div>
          </div> */}

          <div className="overflow-x-auto">
            <Table className="text-nowrap" verticalSpacing="xs" withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{translate("#", "#")}</Table.Th>
                  <Table.Th>{translate("Title", "العنوان")}</Table.Th>
                  <Table.Th>{translate("SKU", "رمز المنتج")}</Table.Th>
                  <Table.Th>{translate("Barcode", "الباركود")}</Table.Th>
                  <Table.Th>{translate("Cost", "التكلفة")}</Table.Th>
                  <Table.Th>{translate("Category", "الفئة")}</Table.Th>
                  <Table.Th>{translate("Subcategory", "الفئة الفرعية")}</Table.Th>
                  <Table.Th>{translate("Stock Status", "حالة المخزون")}</Table.Th>
                  <Table.Th>{translate("Stock Level", "مستوى المخزون")}</Table.Th>
                  <Table.Th>{translate("Value", "القيمة")}</Table.Th>
                  <Table.Th>{translate("Created At", "تاريخ الإنشاء")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {inventory.map((item, index) => (
                  <Table.Tr key={item._id}>
                    <Table.Td>{index + 1}</Table.Td>
                    <Table.Td>{item.title.en}</Table.Td>
                    <Table.Td>{item.sku || "-"}</Table.Td>
                    <Table.Td>{item.barcode || "-"}</Table.Td>
                    <Table.Td>{item.cost}</Table.Td>
                    <Table.Td>{translate(item.category.en, item.category.ar)}</Table.Td>
                    <Table.Td>{item.subcategory ? translate(item.subcategory.en, item.subcategory.ar) : "-"}</Table.Td>
                    <Table.Td>
                      <Text c={item.stockLevel > 0 ? "green" : "red"}>
                        {translate(
                          item.stockLevel > 0 ? "In Stock" : "Out of Stock",
                          item.stockLevel > 0 ? "متوفر" : "غير متوفر",
                        )}
                      </Text>
                    </Table.Td>
                    <Table.Td>{item.stockLevel}</Table.Td>
                    <Table.Td className="font-semibold text-gray-800">
                      {item.value?.toFixed(2) || "0.00"} {translations.currency}
                    </Table.Td>
                    <Table.Td>{formatDate(item.createdAt, language)}</Table.Td>
                  </Table.Tr>
                ))}

                {/* Totals Row */}
                <Table.Tr className="bg-gray-50">
                  <Table.Td colSpan={9}>{translate("Total", "الإجمالي")}</Table.Td>
                  <Table.Td>{summary.totalStock}</Table.Td>
                  <Table.Td>
                    {summary.totalValue} {translations.currency}
                  </Table.Td>
                  <Table.Td />
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </div>
        </div>
      )}
    </AdminLayoutBox>
  );
}
