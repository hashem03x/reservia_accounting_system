import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import paths from "@/utils/constants/paths";
import { Requisition } from "@/types/requisition";
import { PurchaseOrder } from "@/types/orders";
import { Vendor } from "@/types/vendor";
import { Project } from "@/types/project";
import { Badge, Button, Progress, Select, Table, Textarea } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import ErrorAlert from "@/components/ui/error-alert";
import VendorSearch from "@/components/global/vendor-search";
import PaymentTermsEditor, { PaymentScheduleView } from "@/components/global/payment-terms-editor";
import { DocumentPaymentTerms, toPaymentTermsPayload, validateDocumentPaymentTerms } from "@/utils/helpers/document-payment-terms";
import useCategoryHelpers from "@/hooks/useCategoryHelpers";
import RequisitionItemsEditor, { EditableRequisitionItem, editableItemsOf, itemIsComplete, itemPayload } from "../_components/items-editor";
import { requisitionStatusColors, useRequisitionStatusLabel } from "../_components/status";

export default function PurchaseRequisitionDetail() {
  const { id } = useParams();
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const canUpdate = useHasPermission(resources.purchaseRequisitions, actions.update);
  const statusLabel = useRequisitionStatusLabel();
  const { getProductBrandName } = useCategoryHelpers();

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
        <InfoCard label={translate("Issue date", "تاريخ الإصدار")} value={formatDate(requisition.issueDate || requisition.createdAt, language)} />
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
              <Table.Th>{translate("Product / Service", "المنتج / الخدمة")}</Table.Th>
              <Table.Th>{translate("Brand / Model", "الماركة / الموديل")}</Table.Th>
              <Table.Th>{translate("Notes", "ملاحظات")}</Table.Th>
              <Table.Th>{translate("Quantity", "الكمية")}</Table.Th>
              <Table.Th>{translate("Unit", "الوحدة")}</Table.Th>
              <Table.Th>{translate("Unit Price", "سعر الوحدة")}</Table.Th>
              <Table.Th>{translate("Line Total", "الإجمالي")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {requisition.items.map((item, i) => (
              <Table.Tr key={i}>
                <Table.Td>
                  {item.product?.title ? (
                    translate(item.product.title.en, item.product.title.ar)
                  ) : (
                    <span className="flex items-center gap-2">
                      {item.description}
                      <Badge size="xs" color="gray" variant="light">
                        {translate("Legacy line", "بند قديم")}
                      </Badge>
                    </span>
                  )}
                </Table.Td>
                <Table.Td>{item.product ? [getProductBrandName(item.product) || null, item.product.model].filter(Boolean).join(" / ") || "-" : "-"}</Table.Td>
                <Table.Td>{item.product ? item.description || "-" : "-"}</Table.Td>
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
        <h4>{translate("Vendor Payment Terms", "شروط سداد المورد")}</h4>
        <PaymentScheduleView
          schedule={requisition.paymentSchedule}
          emptyText={translate("No payment terms on this Purchase Order (created before payment terms were added).", "لا توجد شروط سداد على أمر الشراء هذا (أُنشئ قبل إضافة شروط السداد).")}
        />
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
// Purchase Order is opened it is frozen, same convention as the existing Invoice model. Lines use the
// shared editor (catalog product required for new lines, legacy lines kept); the issue date and the
// vendor payment terms are edited here too.
function EditToggle({ requisition, onSaved }: { requisition: Requisition; onSaved: (r: Requisition) => void }) {
  const { language, translate } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [vendor, setVendor] = useState<Vendor | null>((requisition.vendorId as unknown as Vendor) || null);
  const [project, setProject] = useState(requisition.project?._id || "");
  const [issueDate, setIssueDate] = useState((requisition.issueDate || requisition.createdAt).slice(0, 10));
  const [items, setItems] = useState<EditableRequisitionItem[]>(() => editableItemsOf(requisition.items, translate));
  const [paymentTerms, setPaymentTerms] = useState<DocumentPaymentTerms | null>(requisition.paymentTerms || null);
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

  const amount = items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0);
  const termsError = validateDocumentPaymentTerms(paymentTerms, { total: amount, issueDate });
  const canSave = !!vendor && !!project && !!issueDate && items.length > 0 && items.every(itemIsComplete) && !termsError;

  async function handleSave() {
    if (!canSave) return;
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "PATCH",
        url: `requisitions/${requisition._id}`,
        data: {
          vendorId: vendor?._id,
          project,
          issueDate,
          items: items.map(itemPayload),
          paymentTerms: paymentTerms ? toPaymentTermsPayload(paymentTerms) : null,
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

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
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
        <DateInput
          label={translate("Issue date", "تاريخ الإصدار")}
          value={issueDate ? new Date(issueDate) : null}
          onChange={(d) => setIssueDate(d ? d.toISOString().slice(0, 10) : "")}
          valueFormat="YYYY-MM-DD"
          required
          w={200}
        />
      </div>

      <RequisitionItemsEditor items={items} setItems={setItems} />

      <h5>{translate("Vendor Payment Terms", "شروط سداد المورد")}</h5>
      <PaymentTermsEditor
        value={paymentTerms}
        onChange={setPaymentTerms}
        total={amount}
        issueDate={issueDate || null}
        issueDateLabel={translate("PO issue date", "تاريخ إصدار أمر الشراء")}
        emptyLabel={translate("No terms", "بدون شروط")}
      />

      <Textarea label={translate("Notes", "ملاحظات")} value={notes} onChange={(e) => setNotes(e.target.value)} autosize minRows={2} />

      <div className="flex justify-end gap-2">
        <Button variant="light" color="gray" onClick={() => setEditing(false)}>
          {translate("Cancel", "إلغاء")}
        </Button>
        <Button loading={loading} disabled={!canSave} onClick={handleSave}>
          {translate("Save Changes", "حفظ التغييرات")}
        </Button>
      </div>
    </div>
  );
}
