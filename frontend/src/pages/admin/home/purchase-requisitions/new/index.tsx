import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Vendor } from "@/types/vendor";
import { Project } from "@/types/project";
import paths from "@/utils/constants/paths";
import { Button, Select, Textarea } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import ErrorAlert from "@/components/ui/error-alert";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import VendorSearch from "@/components/global/vendor-search";
import PaymentTermsEditor from "@/components/global/payment-terms-editor";
import { DocumentPaymentTerms, toPaymentTermsPayload, validateDocumentPaymentTerms } from "@/utils/helpers/document-payment-terms";
import RequisitionItemsEditor, { EditableRequisitionItem, emptyRequisitionItem, itemIsComplete, itemPayload } from "../_components/items-editor";

const today = () => new Date().toISOString().slice(0, 10);

export default function NewPurchaseRequisition() {
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();

  const title = translate("New Purchase Order", "أمر شراء جديد");
  useDocumentTitle(`${title} | ${translations.adminPanel}`);

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [project, setProject] = useState("");
  const [issueDate, setIssueDate] = useState(today());
  const [items, setItems] = useState<EditableRequisitionItem[]>([emptyRequisitionItem()]);
  // null = the vendor's default terms are applied on save (backend termsFromVendorConfig).
  const [paymentTerms, setPaymentTerms] = useState<DocumentPaymentTerms | null>(null);
  const [notes, setNotes] = useState("");

  const {
    privateRequest: fetchProjectsRequest,
    data: projects,
    setData: setProjects,
  } = useDataHandler<Project[]>({ initialData: [] });
  useEffect(() => {
    fetchProjectsRequest({ url: "projects", params: { limit: 500 }, language })
      .then((res) => setProjects(res.data))
      .catch(() => setProjects([]));
  }, []);

  const amount = items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0);
  const termsError = validateDocumentPaymentTerms(paymentTerms, { total: amount, issueDate });
  const canSubmit = !!vendor && !!project && !!issueDate && items.length > 0 && items.every(itemIsComplete) && !termsError;

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    handleRequest(language, setLoading, setError, async () => {
      const response = await privateRequest({
        language,
        method: "POST",
        url: "requisitions",
        data: {
          vendorId: vendor?._id,
          project,
          issueDate,
          items: items.map(itemPayload),
          ...(paymentTerms ? { paymentTerms: toPaymentTermsPayload(paymentTerms) } : {}),
          notes: notes || undefined,
        },
      });
      navigate(`/${paths.admin}/${paths.home}/${paths.purchaseRequisitions}/${response.data._id}`);
    });
  }

  return (
    <AdminLayoutBox
      header={{
        title,
        backLink: true,
        border: true,
        sideElements: (
          <Button onClick={handleSubmit} size="md" px="xl" radius="md" loading={loading} disabled={!canSubmit}>
            {translate("Save", "حفظ")}
          </Button>
        ),
      }}
    >
      {error && (
        <>
          <ErrorAlert error={error} />
          <hr />
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs md:text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-gray-600">{translate("Purchase Order Amount", "قيمة أمر الشراء")}:</span>
          <span className="font-bold text-gray-800">{`${amount.toFixed(2)} ${translations.currency}`}</span>
        </div>
      </div>

      <hr />

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
          placeholder={translate("Select project", "اختر المشروع")}
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
          description={translate("Installment tenors are counted from this date", "تُحسب مدد الأقساط من هذا التاريخ")}
          value={issueDate ? new Date(issueDate) : null}
          onChange={(d) => setIssueDate(d ? d.toISOString().slice(0, 10) : "")}
          valueFormat="YYYY-MM-DD"
          required
          w={220}
        />
      </div>

      <hr />

      <RequisitionItemsEditor items={items} setItems={setItems} />

      <hr />

      <h4>{translate("Vendor Payment Terms", "شروط سداد المورد")}</h4>
      <PaymentTermsEditor
        value={paymentTerms}
        onChange={setPaymentTerms}
        total={amount}
        issueDate={issueDate || null}
        issueDateLabel={translate("PO issue date", "تاريخ إصدار أمر الشراء")}
        emptyLabel={translate("Vendor default terms", "شروط المورد الافتراضية")}
      />

      <hr />

      <Textarea label={translate("Notes", "ملاحظات")} value={notes} onChange={(e) => setNotes(e.target.value)} autosize minRows={2} />
    </AdminLayoutBox>
  );
}
