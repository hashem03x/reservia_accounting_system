import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import paths from "@/utils/constants/paths";
import { Requisition, RequisitionItemInput } from "@/types/requisition";
import { PurchaseOrder } from "@/types/orders";
import { Vendor } from "@/types/vendor";
import { Project } from "@/types/project";
import { Badge, Button, NumberInput, Progress, Select, Table, Textarea, TextInput } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import ErrorAlert from "@/components/ui/error-alert";
import VendorSearch from "@/components/global/vendor-search";
import ProductSearchModal from "@/components/global/variant-search-modal";
import { getPurchaseUnitPrice } from "@/utils/helpers/purchase-unit-price";
import { outlineIcons, solidIcons } from "@/components/icons";
import { requisitionStatusColors, useRequisitionStatusLabel } from "../_components/status";

export default function PurchaseRequisitionDetail() {
  const { id } = useParams();
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const canUpdate = useHasPermission(resources.purchaseRequisitions, actions.update);
  const statusLabel = useRequisitionStatusLabel();

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: requisition,
    setData: setRequisition,
  } = useDataHandler<Requisition | null>({ initialData: null, initialLoading: true });

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");

  const { privateRequest: fetchInvoices, data: invoices, setData: setInvoices } = useDataHandler<PurchaseOrder[]>({
    initialData: [],
  });

  useDocumentTitle(
    requisition
      ? `${requisition.code} | ${translations.pages.purchaseRequisitions} | ${translations.adminPanel}`
      : translations.pages.purchaseRequisitions,
  );

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `requisitions/${id}`, language });
      setRequisition(res.data);
    });
  }

  useEffect(() => {
    load();
    fetchInvoices({ url: `requisitions/${id}/invoices`, language })
      .then((res) => setInvoices(res.data))
      .catch(() => setInvoices([]));
  }, [id]);

  async function handleOpen() {
    if (!confirm(translate("Open this Purchase Order for invoicing?", "فتح أمر الشراء هذا للفوترة؟"))) return;
    handleRequest(language, setActionLoading, setActionError, async () => {
      const res = await privateRequest({ url: `requisitions/${id}/open`, method: "POST", language });
      setRequisition(res.data);
    });
  }

  async function handleCancel() {
    if (!confirm(translate("Cancel this Purchase Order?", "إلغاء أمر الشراء هذا؟"))) return;
    handleRequest(language, setActionLoading, setActionError, async () => {
      const res = await privateRequest({ url: `requisitions/${id}/cancel`, method: "POST", language });
      setRequisition(res.data);
    });
  }

  if (loading) return <LoadingSection message={translate("Loading purchase order...", "جاري تحميل أمر الشراء...")} />;
  if (error)
    return (
      <ErrorSection
        errorTitle={translate("Error loading purchase order", "خطأ في تحميل أمر الشراء")}
        errorMessage={error}
        button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }}
      />
    );
  if (!requisition) return null;

  const canOpen = canUpdate && requisition.status === "draft";
  const canCancel = canUpdate && requisition.status !== "cancelled" && requisition.invoicedAmount <= 0;
  const canEdit = canUpdate && requisition.status === "draft";

  return (
    <AdminLayoutBox
      header={{
        title: translate("Purchase Order", "أمر شراء"),
        subTitle: requisition.code,
        backLink: `/${paths.admin}/${paths.home}/${paths.purchaseRequisitions}`,
        sideElements: (
          <div className="flex gap-2">
            {canOpen && (
              <Button variant="light" color="blue" loading={actionLoading} onClick={handleOpen}>
                {translate("Open", "فتح")}
              </Button>
            )}
            {canCancel && (
              <Button variant="light" color="red" loading={actionLoading} onClick={handleCancel}>
                {translate("Cancel", "إلغاء")}
              </Button>
            )}
          </div>
        ),
      }}
    >
      {actionError && <ErrorAlert error={actionError} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label={translate("Vendor", "البائع")} value={requisition.vendorId?.name || "-"} />
        <InfoCard label={translate("Project", "المشروع")} value={requisition.project?.projectNumber || "-"} />
        <InfoCard
          label={translate("Status", "الحالة")}
          value={
            <Badge color={requisitionStatusColors[requisition.effectiveStatus] || "gray"}>
              {statusLabel(requisition.effectiveStatus)}
            </Badge>
          }
        />
        <InfoCard label={translate("Date", "التاريخ")} value={formatDate(requisition.createdAt, language)} />
        <InfoCard label={translate("Amount", "القيمة")} value={requisition.amount.toLocaleString()} />
        <InfoCard label={translate("Invoiced Amount", "المفوتر")} value={requisition.invoicedAmount.toLocaleString()} />
        <InfoCard label={translate("Remaining Amount", "المتبقي")} value={requisition.remainingAmount.toLocaleString()} />
        <InfoCard label={translate("Executed %", "نسبة التنفيذ")} value={`${requisition.executedPercentage.toFixed(2)}%`} />
      </div>

      <div className="mt-2 flex flex-col gap-1">
        <Progress value={requisition.executedPercentage} color="green" size="lg" radius="sm" />
      </div>

      {requisition.notes && <p className="mt-4 text-gray-600">{requisition.notes}</p>}

      <div className="mt-6 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h4>{translate("Line Items", "بنود الطلب")}</h4>
          {canEdit && <EditToggle requisition={requisition} onSaved={setRequisition} />}
        </div>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Description", "الوصف")}</Table.Th>
              <Table.Th>{translate("Quantity", "الكمية")}</Table.Th>
              <Table.Th>{translate("Unit", "الوحدة")}</Table.Th>
              <Table.Th>{translate("Unit Price", "سعر الوحدة")}</Table.Th>
              <Table.Th>{translate("Line Total", "الإجمالي")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {requisition.items.map((item, i) => (
              <Table.Tr key={i}>
                <Table.Td>{item.description}</Table.Td>
                <Table.Td>{item.quantity}</Table.Td>
                <Table.Td>{item.unit || "-"}</Table.Td>
                <Table.Td>{item.unitPrice.toLocaleString()}</Table.Td>
                <Table.Td>{item.lineTotal.toLocaleString()}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <h4>{translate("Linked Purchase Invoices", "فواتير المشتريات المرتبطة")}</h4>
        {invoices.length === 0 ? (
          <p className="text-sm text-gray-400">
            {translate("No purchase invoices have been created against this Purchase Order yet.", "لم يتم إنشاء أي فواتير مشتريات على هذا أمر الشراء بعد.")}
          </p>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Code", "الكود")}</Table.Th>
                <Table.Th>{translate("Amount", "القيمة")}</Table.Th>
                <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {invoices.map((invoice) => (
                <Table.Tr
                  key={invoice._id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/${paths.admin}/${paths.home}/${paths.purchaseOrders}/${invoice._id}`)}
                >
                  <Table.Td>{invoice.code || "-"}</Table.Td>
                  <Table.Td>{invoice.totalAmount.toLocaleString()}</Table.Td>
                  <Table.Td>{formatDate(invoice.createdAt, language)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </div>
    </AdminLayoutBox>
  );
}

function InfoCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

// Draft-only inline editor (docs section "Purchase Order fields" - "edit while draft"). Once a
// Purchase Order is opened it is frozen, same convention as the existing Invoice model.
function EditToggle({ requisition, onSaved }: { requisition: Requisition; onSaved: (r: Requisition) => void }) {
  const { language, translate } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [vendor, setVendor] = useState<Vendor | null>((requisition.vendorId as unknown as Vendor) || null);
  const [project, setProject] = useState(requisition.project?._id || "");
  const [items, setItems] = useState<RequisitionItemInput[]>(
    requisition.items.map((item) => ({ product: item.product?._id || null, description: item.description, quantity: item.quantity, unit: item.unit || "", unitPrice: item.unitPrice })),
  );
  const [notes, setNotes] = useState(requisition.notes || "");

  const { privateRequest: fetchProjectsRequest, data: projects, setData: setProjects } = useDataHandler<Project[]>({
    initialData: [],
  });
  useEffect(() => {
    if (!editing) return;
    fetchProjectsRequest({ url: "projects", params: { limit: 500 }, language })
      .then((res) => setProjects(res.data))
      .catch(() => setProjects([]));
  }, [editing]);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function updateItem(index: number, patch: Partial<RequisitionItemInput>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function addItem() {
    setItems((prev) => [...prev, { product: null, description: "", quantity: 1, unit: "", unitPrice: 0 }]);
  }
  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }
  const lineTotal = (item: RequisitionItemInput) => (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);

  // Searchable product selector (title/category/brand) - same component used by the Purchase/Sales
  // Invoice item rows and the create form (purchase-requisitions/new/index.tsx).
  const privateProductRequest = usePrivateRequest();
  const [searchModalOpened, { open: openSearchModal, close: closeSearchModal }] = useDisclosure();
  const [activeItemIndex, setActiveItemIndex] = useState<number | null>(null);

  function openProductSearch(index: number) {
    setActiveItemIndex(index);
    openSearchModal();
  }

  async function handleProductSelected(barcode: string) {
    if (activeItemIndex === null) return;
    const index = activeItemIndex;
    try {
      const response = await privateProductRequest({ url: `products/code/${barcode}`, language });
      const product = response.data;
      updateItem(index, {
        product: product._id,
        description: translate(product.title.en, product.title.ar),
        unitPrice: getPurchaseUnitPrice(product),
      });
    } catch {
      // Leave the row's existing description editable rather than blocking the user.
    }
  }

  async function handleSave() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "PATCH",
        url: `requisitions/${requisition._id}`,
        data: {
          vendorId: vendor?._id,
          project,
          items: items.map((item) => ({
            product: item.product || undefined,
            description: item.description,
            quantity: Number(item.quantity) || 0,
            unit: item.unit || undefined,
            unitPrice: Number(item.unitPrice) || 0,
          })),
          notes: notes || undefined,
        },
      });
      onSaved(res.data);
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <Button size="xs" variant="light" onClick={() => setEditing(true)}>
        {translate("Edit", "تعديل")}
      </Button>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      {error && <ErrorAlert error={error} />}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex-1">
          <VendorSearch
            label={translate("Vendor", "البائع")}
            placeholder={translate("Select Vendor", "اختر البائع")}
            vendor={vendor}
            setVendor={setVendor}
            withAsterisk
            required
          />
        </div>
        <Select
          label={translate("Project", "المشروع")}
          value={project || null}
          onChange={(v) => setProject(v || "")}
          data={projects.map((p) => ({ value: p._id, label: `${p.projectNumber}${p.name ? ` - ${p.name}` : ""}` }))}
          searchable
          required
          withAsterisk
          flex={1}
        />
      </div>

      <div className="flex items-center justify-between">
        <h5>{translate("Line Items", "بنود الطلب")}</h5>
        <Button size="xs" variant="light" onClick={addItem} leftSection={<outlineIcons.Squares size={14} />}>
          {translate("Add Line", "إضافة بند")}
        </Button>
      </div>

      {items.map((item, index) => (
        <div
          key={index}
          className="grid grid-cols-1 items-end gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700 sm:grid-cols-6"
        >
          <TextInput
            label={translate("Description", "الوصف")}
            value={item.description}
            onChange={(e) => updateItem(index, { description: e.target.value, product: null })}
            required
            className="sm:col-span-2"
            rightSection={
              <Button onClick={() => openProductSearch(index)} variant="transparent" size="xs" px={5} title={translate("Select from catalog", "اختر من الكتالوج")}>
                <solidIcons.Search size={16} />
              </Button>
            }
          />
          <NumberInput
            label={translate("Quantity", "الكمية")}
            value={item.quantity}
            onChange={(v) => updateItem(index, { quantity: v || 0 })}
            min={0.0001}
            decimalScale={4}
            required
          />
          <TextInput
            label={translate("Unit", "الوحدة")}
            value={item.unit || ""}
            onChange={(e) => updateItem(index, { unit: e.target.value })}
          />
          <NumberInput
            label={translate("Unit Price", "سعر الوحدة")}
            value={item.unitPrice}
            onChange={(v) => updateItem(index, { unitPrice: v || 0 })}
            min={0}
            decimalScale={2}
            required
          />
          <div className="flex items-end gap-2">
            <TextInput label={translate("Line Total", "إجمالي البند")} value={lineTotal(item).toFixed(2)} readOnly className="flex-1" />
            {items.length > 1 && (
              <button type="button" onClick={() => removeItem(index)} className="mb-2" title={translate("Remove", "حذف")}>
                <outlineIcons.Trash className="text-red-500 hover:text-red-700" size={18} />
              </button>
            )}
          </div>
        </div>
      ))}

      <ProductSearchModal
        opened={searchModalOpened}
        close={closeSearchModal}
        mode="purchase"
        onSelect={(barcode) => {
          handleProductSelected(barcode);
          closeSearchModal();
        }}
      />

      <Textarea label={translate("Notes", "ملاحظات")} value={notes} onChange={(e) => setNotes(e.target.value)} autosize minRows={2} />

      <div className="flex justify-end gap-2">
        <Button variant="light" color="gray" onClick={() => setEditing(false)}>
          {translate("Cancel", "إلغاء")}
        </Button>
        <Button loading={loading} disabled={!vendor || !project} onClick={handleSave}>
          {translate("Save Changes", "حفظ التغييرات")}
        </Button>
      </div>
    </div>
  );
}
