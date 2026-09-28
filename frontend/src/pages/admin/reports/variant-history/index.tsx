import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import paths from "@/utils/constants/paths";
import { SortOrder } from "@/types/global";
import { formatDate } from "@/utils/helpers/date-formaters";
import { DateTimePicker } from "@mantine/dates";
import { Button, Select, Table, Text } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import { solidIcons } from "@/components/icons";

const URL = "reports/variant-history";
const FILENAME = "variant-history-report.xlsx";

interface WarehouseStock {
  warehouse: {
    _id: string;
    name: string;
  };
  quantity: number;
}

interface VariantHistory {
  _id: string;
  productId: string;
  productName: string;
  color: string;
  size: string;
  variantCode: string;
  sku: string;
  stock: {
    warehouse: string;
    quantity: number;
    _id: string;
  }[];
  isDeleted: boolean;
  stockStatus: "in_stock" | "out_of_stock" | "running_low";
  stockLevel: number;
  createdAt: string;
  updatedAt: string;
  warehouseNames: WarehouseStock[];
}

interface ReportData {
  data: VariantHistory[];
}

type SortByOption = "createdAt" | "updatedAt" | "productName" | "sku" | "stockLevel";
type SortOrderOption = SortOrder;

export default function VariantHistoryReport() {
  const { language, translate } = useLanguage();

  const title = translate("Variant History Report", "تقرير سجل المتغيرات");

  useDocumentTitle(title);

  const [searchParams, setSearchParams] = useSearchParams();

  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");

  const startDate = startDateParam ? new Date(startDateParam) : null;
  const endDate = endDateParam ? new Date(endDateParam) : null;
  const stockStatus = searchParams.get("stockStatus") || "";
  const warehouse = searchParams.get("warehouse") || "";
  const sortBy = (searchParams.get("sortBy") || "createdAt") as SortByOption;
  const sortOrder = (searchParams.get("sortOrder") || "desc") as SortOrderOption;

  const updateFilter = (key: string, value: string) => {
    if (!value) searchParams.delete(key);
    else searchParams.set(key, value);
    setSearchParams(searchParams);
  };

  const setStartDate = (startDate: string) => updateFilter("startDate", startDate);
  const setEndDate = (endDate: string) => updateFilter("endDate", endDate);
  const setStockStatus = (status: string) => updateFilter("stockStatus", status);
  const setWarehouse = (warehouse: string) => updateFilter("warehouse", warehouse);
  const setSortBy = (sortBy: SortByOption) => updateFilter("sortBy", sortBy);
  const setSortOrder = (sortOrder: SortOrderOption) => updateFilter("sortOrder", sortOrder);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<ReportData>({
    initialData: { data: [] },
    initialLoading: true,
  });

  const [downloading, setDownloading] = useState(false);

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

  const getStockStatusLabel = (status: string) => {
    switch (status) {
      case "in_stock":
        return translate("In Stock", "متوفر");
      case "running_low":
        return translate("Running Low", "منخفض");
      case "out_of_stock":
        return translate("Out of Stock", "نفذ من المخزون");
      default:
        return status;
    }
  };

  if (loading) return <LoadingSection />;
  if (error) return <ErrorSection errorTitle={translate("Error", "خطأ")} errorMessage={error} />;
  if (!data.data?.length) return <EmptySection />;

  // Get unique warehouses from all variants
  const uniqueWarehouses = Array.from(new Set(
    data.data.flatMap(variant => 
      variant.warehouseNames.map(wh => wh.warehouse.name)
    )
  ));

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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <DateTimePicker
            clearable
            value={startDate}
            onChange={(date) => setStartDate(date ? date.toISOString() : "")}
            label={translate("Start Date", "تاريخ البداية")}
          />
          <DateTimePicker
            clearable
            value={endDate}
            onChange={(date) => setEndDate(date ? date.toISOString() : "")}
            label={translate("End Date", "تاريخ النهاية")}
          />
          <Select
            clearable
            value={stockStatus}
            onChange={(value) => setStockStatus(value || "")}
            label={translate("Stock Status", "حالة المخزون")}
            data={[
              { value: "in_stock", label: translate("In Stock", "متوفر") },
              { value: "running_low", label: translate("Running Low", "منخفض") },
              { value: "out_of_stock", label: translate("Out of Stock", "نفذ من المخزون") },
            ]}
          />
          <Select
            clearable
            value={warehouse}
            onChange={(value) => setWarehouse(value || "")}
            label={translate("Warehouse", "المخزن")}
            data={uniqueWarehouses.map(name => ({
              value: name,
              label: name
            }))}
          />
          <Select
            allowDeselect={false}
            value={sortBy}
            onChange={(value) => setSortBy((value || "createdAt") as SortByOption)}
            label={translate("Sort By", "ترتيب حسب")}
            data={[
              { value: "createdAt", label: translate("Created Date", "تاريخ الإنشاء") },
              { value: "updatedAt", label: translate("Updated Date", "تاريخ التحديث") },
              { value: "productName", label: translate("Product Name", "اسم المنتج") },
              { value: "sku", label: translate("SKU", "رمز المنتج") },
              { value: "stockLevel", label: translate("Stock Level", "مستوى المخزون") },
            ]}
          />
          <Select
            allowDeselect={false}
            value={sortOrder}
            onChange={(value) => setSortOrder((value || "desc") as SortOrderOption)}
            label={translate("Sort Order", "طريقة الترتيب")}
            data={[
              { value: "asc", label: translate("Ascending", "تصاعدي") },
              { value: "desc", label: translate("Descending", "تنازلي") },
            ]}
          />
        </div>

        <div className="overflow-x-auto">
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Product", "المنتج")}</Table.Th>
                <Table.Th>{translate("SKU", "رمز المنتج")}</Table.Th>
                <Table.Th>{translate("Variant Code", "رمز المتغير")}</Table.Th>
                <Table.Th>{translate("Color", "اللون")}</Table.Th>
                <Table.Th>{translate("Size", "المقاس")}</Table.Th>
                <Table.Th>{translate("Stock Level", "مستوى المخزون")}</Table.Th>
                <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                <Table.Th>{translate("Created At", "تاريخ الإنشاء")}</Table.Th>
                <Table.Th>{translate("Updated At", "تاريخ التحديث")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.data.map((variant) => (
                <Table.Tr key={variant._id}>
                  <Table.Td>{variant.productName}</Table.Td>
                  <Table.Td>{variant.sku}</Table.Td>
                  <Table.Td>{variant.variantCode}</Table.Td>
                  <Table.Td>{variant.color}</Table.Td>
                  <Table.Td>{variant.size}</Table.Td>
                  <Table.Td>{variant.stockLevel}</Table.Td>
                  <Table.Td>{getStockStatusLabel(variant.stockStatus)}</Table.Td>
                  <Table.Td>{formatDate(variant.createdAt, language)}</Table.Td>
                  <Table.Td>{formatDate(variant.updatedAt, language)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>

        <div className="mt-4">
          <Text size="lg" fw={500} mb={2}>{translate("Warehouse Stock Details", "تفاصيل المخزون في المستودعات")}</Text>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {uniqueWarehouses.map((warehouseName) => (
              <div key={warehouseName} className="p-4 border rounded">
                <Text size="sm" c="dimmed">{warehouseName}</Text>
                <Text size="xl" fw={700}>
                  {data.data.reduce((total, variant) => {
                    const warehouseStock = variant.warehouseNames.find(
                      wh => wh.warehouse.name === warehouseName
                    );
                    return total + (warehouseStock?.quantity || 0);
                  }, 0)}
                </Text>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminLayoutBox>
  );
}

// i wan to create a new report for profit-by-customer @profit-by-customer
// the endpoint is 
// {{URL}}/reports/profit-by-product?startDate=2024-01-01&sortBy=grossProfit&endDate=2025-01-31
// Note that this query params are optional sortBy could be one of the following 
// ['totalSales', 'costOfSales', 'grossProfit', 'createdAt', 'price']
// also add sortOrder ['asc', 'desc']
// also  add season, mainCategory, subcategory  to the query params check how we do it in @product check how we add season and mainCategory and subcategory in the request
// so if the user do not select any of them then don't include them in the request
// and the response will be like
// {
//   "status": "success",
//   "results": 2,
//   "data": [
//       {
//           "productId": "67949ad669faf97bafc504b1",
//           "productName": "test profit",
//           "category": "Test",
//           "subcategory": "tshirt",
//           "season": "summer",
//           "totalQuantity": 1,
//           "totalSales": 1980,
//           "costOfSales": 800,
//           "grossProfit": 1180,
//           "price": 2000,
//           "cost": 800
//       },
//       {
//           "productId": "679424168718132d326fca06",
//           "productName": "test",
//           "category": "Test",
//           "subcategory": "tshirt",
//           "season": "all",
//           "totalQuantity": 126,
//           "totalSales": 133700,
//           "costOfSales": 126000,
//           "grossProfit": 7700,
//           "price": 1200,
//           "cost": 1000
//       }
//   ]
// }


// befor you start working on this report
// check the project code @src especially @App and all reports @reports
// check the product and treasury-history report very well
// check how we send private request how we handle req params
// and how we handle response you should use tables and cells check how we do all that in @product 
// how we handle empty response data 
// also check how we send warehouse id @treasury-balance and do the same for it
// don't forget to update @app

// after any update you should run "npm run build" to make sure you don't have any errors