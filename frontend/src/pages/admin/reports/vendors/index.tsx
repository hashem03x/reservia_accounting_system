import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import paths from "@/utils/constants/paths";
import { SortOrder } from "@/types/global";
import { Vendor, VendorType } from "@/types/vendor";
import { sortOrdersArray } from "@/utils/constants/sort-order";
import { vendorTypesArray, getVendorTypeLabel } from "@/utils/constants/vendor-types";
import { stringifyVendorAddress } from "@/utils/helpers/stringify-address";
import { Button, Select, Table } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";

const URL = "reports/vendors";
const FILENAME = "vendors-report.xlsx";
type ReportData = (Vendor & { totalOrders: number; totalOrdersAmount: number; totalPaidAmount: number })[];
type TypeOption = VendorType | "";
type SortByOption = "balance" | "totalOrders" | "totalOrdersAmount" | "totalPaidAmount" | "";
type SortOrderOption = SortOrder;

export default function VendorsReport() {
  const { language, translate, translations } = useLanguage();

  const title = translate("Vendors Report", "تقرير البائعين");

  useDocumentTitle(title);

  const [searchParams, setSearchParams] = useSearchParams();

  const type = (searchParams.get("type") || "") as TypeOption;
  const sortBy = (searchParams.get("sortBy") || "") as SortByOption;
  const sortOrder = (searchParams.get("sortOrder") || "desc") as SortOrderOption;

  const updateFilter = (key: string, value: string) => {
    if (key === "sortBy")
      if (!value) searchParams.delete("sortOrder");
      else if (!searchParams.get("sortOrder")) searchParams.set("sortOrder", "desc");

    if (!value) searchParams.delete(key);
    else searchParams.set(key, value);
    setSearchParams(searchParams);
  };

  const setType = (type: TypeOption) => updateFilter("type", type);
  const setSortBy = (sortBy: SortByOption) => updateFilter("sortBy", sortBy);
  const setSortOrder = (sortOrder: SortOrderOption) => updateFilter("sortOrder", sortOrder);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<ReportData>({
    initialData: [],
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

    // Return a function to cancel this request
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
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Type */}
        <Select
          clearable
          label={translate("Type", "النوع")}
          placeholder={translate("Select Type", "اختر النوع")}
          value={type}
          onChange={(value) => setType((value || "") as TypeOption)}
          data={vendorTypesArray.map((type) => ({ value: type.value, label: translate(type.label.en, type.label.ar) }))}
        />

        {/* Sort By */}
        <Select
          clearable
          label={translate("Sort By", "ترتيب حسب")}
          placeholder={translate("Select Sort By", "اختر الترتيب حسب")}
          value={sortBy}
          onChange={(value) => setSortBy((value || "") as SortByOption)}
          data={[
            { value: "balance", label: translate("Balance", "الرصيد") },
            { value: "totalOrders", label: translate("Total Orders", "إجمالي الطلبات") },
            { value: "totalOrdersAmount", label: translate("Total Orders Amount", "إجمالي مبالغ الطلبات") },
            { value: "totalPaidAmount", label: translate("Total Paid Amount", "إجمالي المبالغ المدفوعة") },
          ]}
        />

        {/* Sort Order */}
        {sortBy && (
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
        )}
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
                  <Table.Th>{translate("Name", "الاسم")}</Table.Th>
                  <Table.Th>{translate("Phone", "الهاتف")}</Table.Th>
                  <Table.Th>{translate("Email", "البريد الإلكتروني")}</Table.Th>
                  <Table.Th>{translate("Type", "النوع")}</Table.Th>
                  <Table.Th>{translate("Balance", "الرصيد")}</Table.Th>
                  <Table.Th>{translate("Total Orders", "إجمالي الطلبات")}</Table.Th>
                  <Table.Th>{translate("Total Orders Amount", "إجمالي مبالغ الطلبات")}</Table.Th>
                  <Table.Th>{translate("Total Paid Amount", "إجمالي المبالغ المدفوعة")}</Table.Th>
                  <Table.Th>{translate("Address", "العنوان")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.map((vendor) => (
                  <Table.Tr key={vendor._id} className="text-gray-600">
                    <Table.Td className="font-semibold text-gray-800">{vendor.name}</Table.Td>
                    <Table.Td>{vendor.contact?.phone || ""}</Table.Td>
                    <Table.Td>{vendor.contact?.email || ""}</Table.Td>
                    <Table.Td>{getVendorTypeLabel(vendor.type, language)}</Table.Td>
                    <Table.Td className="font-semibold text-gray-800">
                      {vendor.balance.toFixed(2)} {translations.currency}
                    </Table.Td>
                    <Table.Td>{vendor.totalOrders}</Table.Td>
                    <Table.Td>
                      {vendor.totalOrdersAmount.toFixed(2)} {translations.currency}
                    </Table.Td>
                    <Table.Td>
                      {vendor.totalPaidAmount.toFixed(2)} {translations.currency}
                    </Table.Td>
                    <Table.Td>{stringifyVendorAddress(vendor)}</Table.Td>
                  </Table.Tr>
                ))}

                {/* Total Row */}
                <Table.Tr className="bg-gray-100 font-semibold text-gray-800">
                  <Table.Td />
                  <Table.Td />
                  <Table.Td />
                  <Table.Td />
                  <Table.Td>
                    {data.reduce((acc, vendor) => acc + vendor.balance, 0).toFixed(2)} {translations.currency}
                  </Table.Td>
                  <Table.Td>{data.reduce((acc, vendor) => acc + vendor.totalOrders, 0)}</Table.Td>
                  <Table.Td>
                    {data.reduce((acc, vendor) => acc + vendor.totalOrdersAmount, 0).toFixed(2)} {translations.currency}
                  </Table.Td>
                  <Table.Td>
                    {data.reduce((acc, vendor) => acc + vendor.totalPaidAmount, 0).toFixed(2)} {translations.currency}
                  </Table.Td>
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
