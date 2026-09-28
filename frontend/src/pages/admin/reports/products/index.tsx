import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMainCategories } from "@/context/MainCategoriesContext";
import { useLanguage } from "@/context/LanguageContext";
import useCategoryHelpers from "@/hooks/useCategoryHelpers";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import paths from "@/utils/constants/paths";
import { SortOrder } from "@/types/global";
import { Product, Season, Color } from "@/types/product";
import { sortOrdersArray } from "@/utils/constants/sort-order";
import { getSeasonLabel, seasonsArray } from "@/utils/constants/seasons";
import { getProductFinalPrice } from "@/utils/helpers/product-helpers";
import { formatDate } from "@/utils/helpers/date-formaters";
import { solidIcons } from "@/components/icons";
import { DateTimePicker } from "@mantine/dates";
import { Button, Select, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import { useWarehouses } from "@/context/WarehousesContext";
// import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";

const URL = "reports/products";
const FILENAME = "products-report.xlsx";

interface ProductVariant {
  _id: string;
  color: Color;
  size: string;
  sku: string;
  stockLevel: number;
  stockStatus: "in_stock" | "running_low" | "out_of_stock";
  variantCode: string;
  stock: { warehouse: string; quantity: number }[];
  isDeleted: boolean;
}

interface ProductReport extends Product {
  totalStock: number;
  variants: ProductVariant[];
  categoryName: {
    en: string;
    ar: string;
  };
  subcategoryName: {
    en: string;
    ar: string;
  };
}

type ReportData = ProductReport[];

export default function ProductsReport() {
  const { language, translate, translations } = useLanguage();

  const title = translate("Products Report", "تقرير المنتجات");

  useDocumentTitle(title);

  const { data: mainCategories } = useMainCategories();
  const { getSubcategoriesByMainCategoryId } = useCategoryHelpers();
  // const { getWarehouseNameById } = useWarehouseHelpers();
  const { data: warehouses } = useWarehouses();

  const [searchParams, setSearchParams] = useSearchParams();

  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");

  const startDate = startDateParam ? new Date(startDateParam) : null;
  const endDate = endDateParam ? new Date(endDateParam) : null;
  const season = (searchParams.get("season") || "") as Season | "";
  const category = searchParams.get("category") || "";
  const subcategory = searchParams.get("subcategory") || "";
  const warehouse = searchParams.get("warehouse") || "";
  const sortBy = (searchParams.get("sortBy") || "createdAt") as "price" | "cost" | "createdAt";
  const sortOrder = (searchParams.get("sortOrder") || "desc") as SortOrder;

  const updateFilter = (key: string, value: string) => {
    if (key === "category") searchParams.delete("subcategory"); // Reset subcategory when changing category
    if (!value) searchParams.delete(key);
    else searchParams.set(key, value);
    setSearchParams(searchParams);
  };

  const setStartDate = (startDate: string) => updateFilter("startDate", startDate);
  const setEndDate = (endDate: string) => updateFilter("endDate", endDate);
  const setSeason = (season: Season | "") => updateFilter("season", season);
  const setCategory = (category: string) => updateFilter("category", category);
  const setSubcategory = (subcategory: string) => updateFilter("subcategory", subcategory);
  const setWarehouse = (warehouse: string) => updateFilter("warehouse", warehouse);
  const setSortBy = (sortBy: "price" | "cost" | "createdAt") => updateFilter("sortBy", sortBy);
  const setSortOrder = (sortOrder: SortOrder) => updateFilter("sortOrder", sortOrder);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<ReportData>({
    initialData: [],
    initialLoading: true,
  });

  const [totalValue, setTotalValue] = useState(0);

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
      setTotalValue(response.totalValue);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
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
      {/* Filters */}
      <div className="flex flex-col gap-4">
        {/* Date Range */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <DateTimePicker
            label={translate("Start Date", "تاريخ البداية")}
            placeholder={translate("Select Start Date", "حدد تاريخ البداية")}
            value={startDate}
            onChange={(date) => setStartDate(date?.toISOString() || "")}
            clearable
          />
          <DateTimePicker
            label={translate("End Date", "تاريخ النهاية")}
            placeholder={translate("Select End Date", "حدد تاريخ النهاية")}
            value={endDate}
            onChange={(date) => setEndDate(date?.toISOString() || "")}
            clearable
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          {/* Season */}
          <Select
            clearable
            value={season}
            onChange={(value) => setSeason((value || "") as Season | "")}
            label={translate("Season", "الموسم")}
            placeholder={translate("Select Season", "اختر الموسم")}
            data={[
              ...seasonsArray.map((season) => ({
                value: season.value,
                label: translate(season.label.en, season.label.ar),
              })),
            ]}
          />

          {/* Main Category */}
          <Select
            clearable
            value={category}
            onChange={(value) => setCategory(value || "")}
            label={translate("Main Category", "الفئة الرئيسية")}
            placeholder={translate("Select Main Category", "اختر الفئة الرئيسية")}
            data={[
              ...mainCategories.map((category) => ({
                value: category._id,
                label: translate(category.name.en, category.name.ar),
              })),
            ]}
          />

          {/* Subcategory */}
          {category && (
            <Select
              clearable
              value={subcategory}
              onChange={(value) => setSubcategory(value || "")}
              label={translate("Subcategory", "الفئة الفرعية")}
              placeholder={translate("Select Subcategory", "اختر الفئة الفرعية")}
              data={[
                ...(category
                  ? getSubcategoriesByMainCategoryId(category).map((subcategory) => ({
                      value: subcategory._id,
                      label: translate(subcategory.name.en, subcategory.name.ar),
                    }))
                  : []),
              ]}
            />
          )}

          {/* Warehouse */}
          <Select
            clearable
            value={warehouse}
            onChange={(value) => setWarehouse(value || "")}
            label={translate("Warehouse", "المستودع")}
            placeholder={translate("Select Warehouse", "اختر المستودع")}
            data={[
              ...warehouses.map((warehouse) => ({
                value: warehouse._id,
                label: warehouse.name,
              })),
            ]}
          />

          {/* Sort By */}
          <Select
            allowDeselect={false}
            label={translate("Sort By", "ترتيب حسب")}
            placeholder={translate("Select Sort By", "اختر الترتيب حسب")}
            value={sortBy}
            onChange={(value) => setSortBy((value || "") as "price" | "cost" | "createdAt")}
            data={[
              { value: "createdAt", label: translate("Date & Time", "التاريخ والوقت") },
              { value: "price", label: translate("Price", "السعر") },
              { value: "cost", label: translate("Cost", "التكلفة") },
            ]}
          />

          {/* Sort Order */}
          <Select
            allowDeselect={false}
            label={translate("Sort Order", "طريقة الترتيب")}
            placeholder={translate("Select Sort Order", "اختر طريقة الترتيب")}
            value={sortOrder}
            onChange={(value) => setSortOrder((value || "desc") as SortOrder)}
            data={sortOrdersArray.map((option) => ({
              value: option.value,
              label: translate(option.label.en, option.label.ar),
            }))}
          />
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <LoadingSection message={translate("Generating report", "جاري إنشاء التقرير")} />
      ) : error ? (
        <ErrorSection
          errorMessage={error}
          errorTitle={translate("Error Generating Report", "خطأ في إنشاء التقرير")}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadData }}
        />
      ) : data.length === 0 ? (
        <EmptySection useDefaultImg message={translate("No Data Found", "لا توجد بيانات")} />
      ) : (
        <>
          {/* Table */}
          <div className="overflow-x-auto">
            <Table className="text-nowrap" verticalSpacing="xs" withColumnBorders>
              <Table.Thead className="bg-gray-100 text-gray-800">
                <Table.Tr>
                  <Table.Th>{translate("Title", "العنوان")}</Table.Th>
                  <Table.Th>{translate("Price", "السعر")}</Table.Th>
                  <Table.Th>{translate("Price After Discount", "السعر بعد الخصم")}</Table.Th>
                  <Table.Th>{translate("Cost", "التكلفة")}</Table.Th>
                  <Table.Th>{translate("Available", "متوفر")}</Table.Th>
                  <Table.Th>{translate("Total Amount", "المجموع الكلي")}</Table.Th>
                  <Table.Th>{translate("Sold", "المباع")}</Table.Th>
                  <Table.Th>{translate("Season", "الموسم")}</Table.Th>
                  <Table.Th>{translate("Main Category", "الفئة الرئيسية")}</Table.Th>
                  <Table.Th>{translate("Subcategory", "الفئة الفرعية")}</Table.Th>
                  {/* <Table.Th>{translate("Warehouse", "المستودع")}</Table.Th> */}
                  <Table.Th>{translate("Created On", "أنشئ في")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.map((product) => {
                  return (
                    <Table.Tr key={product._id} className="text-gray-600">
                      <Table.Td className="font-semibold text-gray-800">
                        {translate(product.title.en, product.title.ar)}
                      </Table.Td>
                      <Table.Td>
                        {product.price.toFixed(2)} {translations.currency}
                      </Table.Td>
                      <Table.Td className="font-semibold text-gray-800">
                        {getProductFinalPrice(product.priceAfterDiscount, product.price).toFixed(2)} {translations.currency}
                      </Table.Td>
                      <Table.Td>
                        {product.cost.toFixed(2)} {translations.currency}
                      </Table.Td>
                      <Table.Td>{product.totalStock || "-"}</Table.Td>
                      <Table.Td className="font-semibold text-gray-800">
                        {(product.cost * product.totalStock).toFixed(2)} {translations.currency}
                      </Table.Td>
                      <Table.Td>{product.totalSold}</Table.Td>
                      <Table.Td>{getSeasonLabel(product.season, language)}</Table.Td>
                      <Table.Td>{product.categoryName.en}</Table.Td>
                      <Table.Td>{product.subcategoryName.en}</Table.Td>
                      {/* <Table.Td>{  getWarehouseNameById(product.warehouse) }</Table.Td> */}
                      <Table.Td>{formatDate(product.createdAt, language)}</Table.Td>
                    </Table.Tr>
                  );
                })}

                {/* Total Row */}
                <Table.Tr className="font-semibold text-gray-800" style={{ backgroundColor: "#f3f4f6 " }}>
                  <Table.Td colSpan={0} className="text-right font-semibold">
                    {translate("Total", "الإجمالي")}
                  </Table.Td>
                  <Table.Td className="font-semibold">
                    {data.reduce((acc: number, product: ProductReport) => acc + product.price, 0).toFixed(2)}{" "}
                    {translations.currency}
                  </Table.Td>
                  <Table.Td className="font-semibold">
                    {data
                      .reduce(
                        (acc: number, product: ProductReport) =>
                          acc + getProductFinalPrice(product.priceAfterDiscount, product.price),
                        0,
                      )
                      .toFixed(2)}{" "}
                    {translations.currency}
                  </Table.Td>
                  <Table.Td className="font-semibold">
                    {data.reduce((acc: number, product: ProductReport) => acc + product.cost, 0).toFixed(2)}{" "}
                    {translations.currency}
                  </Table.Td>
                  <Table.Td className="font-semibold">
                    {data.reduce((acc: number, product: ProductReport) => acc + product.totalStock, 0)}
                  </Table.Td>
                  <Table.Td className="font-semibold">
                    {
                      /*data
                      .reduce(
                        (acc: number, product: ProductReport) => acc + product.cost * product.totalStock,
                        0
                      )
                      .toFixed(2)*/
                      totalValue
                    }{" "}
                    {translations.currency}
                  </Table.Td>
                  <Table.Td className="font-semibold">
                    {data.reduce((acc: number, product: ProductReport) => acc + product.totalSold, 0)}
                  </Table.Td>
                  <Table.Td />
                  <Table.Td />
                  <Table.Td />
                  <Table.Td />
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </div>
        </>
      )}
    </AdminLayoutBox>
  );
}
