import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useBrands } from "@/context/BrandsContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useCategoryHelpers from "@/hooks/useCategoryHelpers";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import { Project } from "@/types/project";
import { ProjectInventoryResult } from "@/types/puc-transfer";
import { Badge, Pagination, Select, Table, TextInput } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import InfoItem from "@/components/ui/info-item";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";

const sourceTypeColors: Record<string, string> = {
  "purchase-order": "blue",
  warehouse: "cyan",
  project: "grape",
  "purchase-return": "red",
};

// Project-oriented inventory view (docs section "Inventory / Warehouses - Detailed PUC and Raw
// Materials Per Project"). Distinguishes physical inventory movements (this page, backed by
// PucTransfer - a real, persisted allocation ledger) from PUC accounting balances (the existing
// Project Cost report/General Ledger, a different concept - never conflated here).
export default function ProjectInventory() {
  const { language, translate, translations } = useLanguage();
  useDocumentTitle(`${translate("Project Inventory", "مخزون المشاريع")} | ${translations.adminPanel}`);

  const { getMainCategoryNameById, getBrandNameById } = useCategoryHelpers();
  const { data: brands } = useBrands();

  const [searchParams, setSearchParams] = useSearchParams();
  const [projectId, setProjectId] = useState(searchParams.get("project") || "");
  const [brandFilter, setBrandFilter] = useState(searchParams.get("brand") || "");
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword] = useDebounce(keyword, 350);
  const [activePage, setActivePage] = useState(1);

  const { privateRequest: fetchProjects, data: projects, setData: setProjects } = useDataHandler<Project[]>({ initialData: [] });
  useEffect(() => {
    fetchProjects({ url: "projects", params: { limit: 500 }, language })
      .then((res) => setProjects(res.data))
      .catch(() => setProjects([]));
  }, []);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<ProjectInventoryResult | null>({
    initialData: null,
  });

  function loadInventory() {
    if (!projectId) {
      setData(null);
      return () => {};
    }
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: `puc-transfers/project/${projectId}`,
        params: { page: activePage.toString(), limit: "20", ...(brandFilter ? { brand: brandFilter } : {}) },
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
    setSearchParams(projectId ? { project: projectId, ...(brandFilter ? { brand: brandFilter } : {}) } : {}, { replace: true });
    setActivePage(1);
  }, [projectId, brandFilter]);

  useEffect(() => {
    const cancelRequest = loadInventory();
    return cancelRequest;
  }, [projectId, brandFilter, activePage]);

  const filteredRows = (data?.data || []).filter((row) => {
    if (!debouncedKeyword) return true;
    const kw = debouncedKeyword.toLowerCase();
    return (
      (row.product?.title.en || "").toLowerCase().includes(kw) ||
      (row.product?.title.ar || "").toLowerCase().includes(kw) ||
      (row.product?.sku || "").toLowerCase().includes(kw) ||
      (row.product?.model || "").toLowerCase().includes(kw)
    );
  });

  return (
    <AdminLayoutBox
      header={{
        title: translate("Project Inventory", "مخزون المشاريع"),
        backLink: true,
        border: true,
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select
          label={translate("Project", "المشروع")}
          placeholder={translate("Select a project", "اختر مشروعاً")}
          value={projectId || null}
          onChange={(v) => setProjectId(v || "")}
          data={projects.map((p) => ({ value: p._id, label: `${p.projectNumber}${p.name ? ` - ${p.name}` : ""}` }))}
          searchable
          clearable
        />
        <Select
          label={translate("Brand", "الماركة")}
          placeholder={translate("All brands", "كل الماركات")}
          value={brandFilter || null}
          onChange={(v) => setBrandFilter(v || "")}
          data={brands.map((b) => ({ value: b._id, label: translate(b.name.en, b.name.ar) }))}
          searchable
          clearable
          disabled={!projectId}
        />
        <TextInput
          label={translate("Search (title, SKU, model)", "البحث (العنوان، الكود، الموديل)")}
          placeholder={translate("Search products...", "ابحث عن منتجات...")}
          value={keyword}
          onChange={(e) => setKeyword(e.currentTarget.value)}
          disabled={!projectId}
        />
      </div>

      <hr />

      {!projectId ? (
        <EmptySection useDefaultImg message={translate("Select a project to view its inventory.", "اختر مشروعاً لعرض مخزونه.")} />
      ) : loading ? (
        <LoadingSection message={translate("Loading inventory...", "جاري تحميل المخزون...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading inventory", "خطأ في تحميل المخزون")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: loadInventory }}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptySection useDefaultImg message={translate("No purchased items allocated to this project yet.", "لا توجد عناصر مشتراة مخصصة لهذا المشروع حتى الآن.")} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <InfoItem label={translate("Total Purchased Qty", "إجمالي الكمية المشتراة")} value={data.summary.totalQuantityPurchased.toLocaleString()} />
            <InfoItem label={translate("Total Returned Qty", "إجمالي الكمية المرتجعة")} value={data.summary.totalQuantityReturned.toLocaleString()} />
            <InfoItem label={translate("Net Quantity", "الكمية الصافية")} value={data.summary.netQuantity.toLocaleString()} />
            <InfoItem label={translate("Total Amount", "الإجمالي")} value={`${data.summary.totalAmount.toLocaleString()} ${translations.currency}`} />
          </div>
          <p className="text-xs text-gray-400">
            {translate(
              "Quantity used/remaining is not tracked by any existing workflow and is not shown here.",
              "الكمية المستخدمة/المتبقية غير مسجلة في أي سجل حالي ولا تُعرض هنا.",
            )}
          </p>

          <hr />

          <DataTableContainer>
            <DataTable className="min-w-[1200px]">
              <Table.Thead className={dataTableHeadClassName}>
                <Table.Tr>
                  <Table.Th>{translate("Product", "المنتج")}</Table.Th>
                  <Table.Th>{translate("Category", "الفئة")}</Table.Th>
                  <Table.Th>{translate("Brand", "الماركة")}</Table.Th>
                  <Table.Th>{translate("Model / SKU", "الموديل / الكود")}</Table.Th>
                  <Table.Th>{translate("Type", "النوع")}</Table.Th>
                  <Table.Th className="text-right">{translate("Quantity", "الكمية")}</Table.Th>
                  <Table.Th className="text-right">{translate("Unit Cost", "تكلفة الوحدة")}</Table.Th>
                  <Table.Th className="text-right">{translate("Amount", "القيمة")}</Table.Th>
                  <Table.Th>{translate("Purchase Invoice", "فاتورة الشراء")}</Table.Th>
                  <Table.Th>{translate("Vendor", "المورد")}</Table.Th>
                  <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filteredRows.map((row) => (
                  <Table.Tr key={row._id} className="text-gray-600">
                    <Table.Td className="font-semibold text-gray-800">
                      {row.product ? translate(row.product.title.en, row.product.title.ar) : "-"}
                    </Table.Td>
                    <Table.Td>{row.product?.category ? getMainCategoryNameById(row.product.category) : "-"}</Table.Td>
                    <Table.Td>{row.product?.brand ? getBrandNameById(row.product.brand) : "-"}</Table.Td>
                    <Table.Td>{row.product?.model || row.product?.sku || "-"}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" variant="light" color={sourceTypeColors[row.sourceType] || "gray"}>
                        {row.sourceType === "purchase-return" ? translate("Return", "مرتجع") : translate("Purchase", "شراء")}
                      </Badge>
                    </Table.Td>
                    <Table.Td className={`text-right tabular-nums ${row.sourceType === "purchase-return" ? "text-red-600" : ""}`}>
                      {row.sourceType === "purchase-return" ? "-" : ""}
                      {row.quantity.toLocaleString()}
                    </Table.Td>
                    <Table.Td className="text-right tabular-nums">{row.unitCost.toLocaleString()}</Table.Td>
                    <Table.Td className="text-right tabular-nums font-semibold text-gray-800">{row.amount.toLocaleString()}</Table.Td>
                    <Table.Td>{row.purchaseOrder?.code || "-"}</Table.Td>
                    <Table.Td>{row.purchaseOrder?.vendor?.name || "-"}</Table.Td>
                    <Table.Td>{formatDate(row.date, language)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </DataTable>
          </DataTableContainer>

          {data.pagination.totalPages > 1 && (
            <div className="flex justify-center">
              <Pagination total={data.pagination.totalPages} value={activePage} onChange={setActivePage} size="sm" />
            </div>
          )}
        </>
      )}
    </AdminLayoutBox>
  );
}
