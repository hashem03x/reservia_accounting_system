import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { useDisclosure } from "@mantine/hooks";
import { Badge, Button, Select, Table, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatAmount } from "@/utils/helpers/format-amount";
import { PaginatedData } from "@/types/global";
import { CommercialRole, MaterialItem } from "@/types/commercial";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import EditMaterialModal from "./_components/edit-material-modal";
import WorkbookImportModal from "./_components/workbook-import-modal";
import { useSystemAccess } from "@/context/SystemAccessContext";
import { canEditFully, enginePageAccess } from "../_shared/dealEnginePermissions";

const CATEGORIES = [
  "PV Modules", "On-Grid Inverter", "Off-Grid Inverter", "Hybrid Inverter", "Lithium Batteries", "DC Cable", "AC Cable", "AC Breaker",
  "Electrical Protection", "MC4 Connectors", "AC Distribution Board", "Metallic Panel", "Mounting Structure",
  "Submersible Pump", "Pump Motor", "Solar Pump Drive", "Pipe", "AC Reactor", "DC Charge Controller",
];

// Reservia Commercial Price Book admin. Calculations never hardcode a price - every number the
// engines read comes from here (services/commercial/priceBookLookup.js), and a price edit
// appends to history rather than overwriting it (see materialController.js#updateMaterial), so a
// past revision's already-resolved price is never retroactively changed.
export default function CommercialMaterials() {
  const { language, translate } = useLanguage();
  useDocumentTitle(`${translate("Materials", "قائمة الأسعار")} | Reservia Deal Engine`);

  const [activePage, setActivePage] = useState(1);
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [debouncedQ] = useDebounce(q, 350);
  const [editing, setEditing] = useState<MaterialItem | null>(null);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [importOpened, { open: openImport, close: closeImport }] = useDisclosure(false);
  const { systems } = useSystemAccess();
  const role = (systems?.COMMERCIAL?.role || "") as CommercialRole | "";
  const canImport = canEditFully(enginePageAccess(role ? [role as CommercialRole] : [], "materials"));

  const { privateRequest, loading, setLoading, error, setError, data: paginated, setData: setPaginated } = useDataHandler<PaginatedData<MaterialItem>>({
    initialData: null,
    initialLoading: true,
  });

  function reload() {
    const controller = new AbortController();
    const canceled = { current: false };
    const executeFetch = async () => {
      const res = await privateRequest({
        url: "commercial/materials",
        params: { page: activePage.toString(), ...(category ? { category } : {}), ...(debouncedQ ? { keyword: debouncedQ } : {}) },
        signal: controller.signal,
        language,
      });
      if (!canceled.current) setPaginated(res as PaginatedData<MaterialItem>);
    };
    handleRequest(language, setLoading, setError, executeFetch, canceled);
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    const cancelRequest = reload();
    return cancelRequest;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, category, debouncedQ]);

  return (
    <AdminLayoutBox header={{ title: translate("Material Price List", "قائمة أسعار المواد") }}>
      {canImport && (
        <div className="mb-3 flex justify-end">
          <Button variant="light" onClick={openImport} data-testid="materials-import">
            {translate("Import workbook", "استيراد ملف Excel")}
          </Button>
        </div>
      )}
      <div className="mb-4 grid grid-cols-1 gap-3 rounded-lg border border-gray-100 p-3 sm:grid-cols-3">
        <TextInput label={translate("Search", "بحث")} value={q} onChange={(e) => (setActivePage(1), setQ(e.target.value))} placeholder={translate("Brand or model", "الماركة أو الموديل")} />
        <Select
          label={translate("Category", "الفئة")}
          clearable
          placeholder={translate("All categories", "كل الفئات")}
          data={CATEGORIES}
          value={category || null}
          onChange={(v) => (setActivePage(1), setCategory(v || ""))}
        />
      </div>

      {error ? (
        <ErrorSection errorTitle={translate("Error loading materials", "خطأ في تحميل المواد")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: reload }} />
      ) : loading ? (
        <LoadingSection />
      ) : !paginated?.data.length ? (
        <EmptySection useDefaultImg message={translate("No materials found", "لا توجد مواد")} />
      ) : (
        <>
          <DataTableContainer>
            <DataTable>
              <Table.Thead className={dataTableHeadClassName}>
                <Table.Tr>
                  <Table.Th>{translate("Category", "الفئة")}</Table.Th>
                  <Table.Th>{translate("Brand", "الماركة")}</Table.Th>
                  <Table.Th>{translate("Model", "الموديل")}</Table.Th>
                  <Table.Th>{translate("Spec", "المواصفات")}</Table.Th>
                  <Table.Th>{translate("Unit", "الوحدة")}</Table.Th>
                  <Table.Th className="text-right">{translate("Reference price", "السعر المرجعي")}</Table.Th>
                  <Table.Th>{translate("Supplier prices", "أسعار الموردين")}</Table.Th>
                  <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                  <Table.Th>{translate("Source", "المصدر")}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {paginated.data.map((m) => (
                  <Table.Tr key={m._id}>
                    <Table.Td>{m.category}</Table.Td>
                    <Table.Td>{m.brand}</Table.Td>
                    <Table.Td>{m.model}</Table.Td>
                    <Table.Td className="max-w-[200px] truncate text-xs text-gray-500">{m.spec}</Table.Td>
                    <Table.Td>{m.unit}</Table.Td>
                    <Table.Td className="text-right font-medium">{formatAmount(m.unitPrice, m.currency)}</Table.Td>
                    <Table.Td className="text-xs">
                      {/* Deal Engine C19: every supplier price carries its supplier code; none = Reference only. */}
                      {m.supplierPrices?.length ? (
                        m.supplierPrices.map((sp) => (
                          <div key={sp.supplierCode} className={sp.validUntil && new Date(sp.validUntil) < new Date() ? "text-red-600" : ""}>
                            {sp.supplierCode}: {formatAmount(sp.unitPrice, "EGP")}
                            {sp.foreignPrice != null ? ` (${sp.foreignPrice} ${sp.currency})` : ""}
                            {sp.validUntil ? ` - ${translate("valid to", "صالح حتى")} ${sp.validUntil.slice(0, 10)}` : ""}
                          </div>
                        ))
                      ) : (
                        <span className="text-gray-400">{translate("Reference only", "مرجعي فقط")}</span>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge size="sm" color={m.status === "Available" ? "teal" : m.status === "PLACEHOLDER" ? "orange" : "gray"} variant="light">
                        {m.status === "PLACEHOLDER" ? translate("Needs technical data", "تحتاج بيانات فنية") : m.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td className="text-xs text-gray-400">{m.sourceWorkbook}</Table.Td>
                    <Table.Td>
                      <Button size="xs" variant="light" onClick={() => (setEditing(m), openModal())}>
                        {translate("Edit", "تعديل")}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </DataTable>
          </DataTableContainer>
          <PaginationHandler paginatedData={paginated} activePage={activePage} setActivePage={setActivePage} />
        </>
      )}

      <EditMaterialModal opened={modalOpened} onClose={closeModal} material={editing} onSaved={reload} />
      <WorkbookImportModal opened={importOpened} onClose={closeImport} onImported={reload} />
    </AdminLayoutBox>
  );
}
