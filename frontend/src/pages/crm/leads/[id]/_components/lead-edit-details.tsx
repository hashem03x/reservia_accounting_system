import { useEffect, useState } from "react";
import { Button, NumberInput, Select, TextInput } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { CRM_FORM_SEGMENTS, CrmLead } from "@/types/crm";
import { segmentLabel } from "../../../_shared/lead-display";
import GovernorateSelect from "../../../_shared/governorate-select";

// CRM Changes Required (12 Nov 2026), item 1: a lead's contact and qualification details can be
// corrected after intake - above all the governorate, so a failed Deal Engine sync can be fixed and
// retried. PATCH /crm/leads/:id (MD, Admin and Sales; the server checks the role and every value,
// and writes each change to the lead's timeline).
export default function LeadEditDetails({ lead, onSaved }: { lead: CrmLead; onSaved: () => void }) {
  const { language, translate } = useLanguage();
  const [opened, { open, close }] = useDisclosure();
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });
  const [form, setForm] = useState({ name: "", email: "", governorate: "", segment: "", monthlyBillEgp: "" as string | number, systemSizeKwp: "" as string | number, partnerName: "" });

  useEffect(() => {
    if (!opened) return;
    setForm({
      name: lead.name || "",
      email: lead.email || "",
      governorate: lead.governorate || "",
      segment: lead.segment && lead.segment !== "unknown" ? lead.segment : "",
      monthlyBillEgp: lead.monthlyBillEgp ?? "",
      systemSizeKwp: lead.systemSizeKwp ?? "",
      partnerName: lead.partnerName || "",
    });
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const set = (key: keyof typeof form) => (value: string | number) => setForm((f) => ({ ...f, [key]: value }));

  function save() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({
        language,
        method: "PATCH",
        url: `crm/leads/${lead._id}`,
        data: {
          name: form.name,
          email: form.email,
          governorate: form.governorate || null,
          ...(form.segment ? { segment: form.segment } : {}),
          monthlyBillEgp: form.monthlyBillEgp === "" ? null : Number(form.monthlyBillEgp),
          systemSizeKwp: form.systemSizeKwp === "" ? null : Number(form.systemSizeKwp),
          partnerName: form.partnerName,
        },
      });
      close();
      onSaved();
    });
  }

  return (
    <>
      <Button size="compact-xs" variant="subtle" onClick={open} data-testid="lead-edit-details">
        {translate("Edit", "تعديل")}
      </Button>
      <Modal opened={opened} onClose={close} title={translate("Edit lead details", "تعديل بيانات العميل")} size="md">
        <div className="flex flex-col gap-3">
          <TextInput label={translate("Name", "الاسم")} value={form.name} onChange={(e) => set("name")(e.target.value)} maxLength={150} />
          <TextInput label={translate("Email", "البريد الإلكتروني")} type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} maxLength={200} />
          <GovernorateSelect
            value={form.governorate}
            onChange={set("governorate")}
            description={translate("Needed from Qualified on - it decides the Deal Engine region.", "مطلوبة من مرحلة مؤهل - تحدد منطقة محرك الصفقات.")}
          />
          <Select
            label={translate("Segment", "القطاع")}
            value={form.segment || null}
            onChange={(v) => set("segment")(v || "")}
            data={CRM_FORM_SEGMENTS.map((s) => ({ value: s, label: segmentLabel(translate)(s) }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <NumberInput label={translate("Monthly bill - EGP", "الفاتورة الشهرية - جنيه")} value={form.monthlyBillEgp} onChange={set("monthlyBillEgp")} min={0} />
            <NumberInput label={translate("System size - kWp", "حجم النظام - كيلووات")} value={form.systemSizeKwp} onChange={set("systemSizeKwp")} min={0} decimalScale={2} />
          </div>
          <TextInput label={translate("Partner / dealer", "الشريك / الموزع")} value={form.partnerName} onChange={(e) => set("partnerName")(e.target.value)} maxLength={150} />
          <div className="flex gap-2 pt-1">
            <Button onClick={close} variant="light" color="dark" fullWidth>
              {translate("Cancel", "إلغاء")}
            </Button>
            <Button onClick={save} loading={loading} fullWidth color="teal" data-testid="lead-edit-save">
              {translate("Save", "حفظ")}
            </Button>
          </div>
          {error && <ErrorAlert error={error} />}
        </div>
      </Modal>
    </>
  );
}
