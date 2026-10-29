import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { CRM_CHANNELS, CRM_SEGMENTS, CrmChannel, CrmLead, CrmSegment } from "@/types/crm";
import { Button, NumberInput, Select, TextInput } from "@mantine/core";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";

const CHANNEL_LABELS: Record<CrmChannel, { en: string; ar: string }> = {
  phone: { en: "Phone", ar: "هاتف" },
  walk_in: { en: "Walk-in", ar: "زيارة مباشرة" },
  dealer: { en: "Dealer / partner", ar: "موزع / شريك" },
  referral: { en: "Referral", ar: "ترشيح" },
  event: { en: "Event", ar: "فعالية" },
  outreach: { en: "Outreach", ar: "تواصل مباشر" },
  email: { en: "Email", ar: "بريد إلكتروني" },
  whatsapp: { en: "WhatsApp", ar: "واتساب" },
  web_form: { en: "Website form", ar: "نموذج الموقع" },
  landing_page: { en: "Landing page", ar: "صفحة هبوط" },
};

const SEGMENT_LABELS: Record<CrmSegment, { en: string; ar: string }> = {
  villa: { en: "Villa", ar: "فيلا" },
  compound: { en: "Compound", ar: "كمبوند" },
  farm: { en: "Farm", ar: "مزرعة" },
  oil_gas: { en: "Oil & gas", ar: "نفط وغاز" },
  factory: { en: "Factory", ar: "مصنع" },
  services: { en: "Services", ar: "خدمات" },
  other: { en: "Other", ar: "أخرى" },
  unknown: { en: "Unknown", ar: "غير محدد" },
};

export default function LeadModal({
  opened,
  close,
  callback,
}: {
  opened: boolean;
  close: () => void;
  callback: (lead: CrmLead) => void;
}) {
  const { language, translate, translations } = useLanguage();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<CrmChannel | "">("");
  const [segment, setSegment] = useState<CrmSegment | "">("");
  const [source, setSource] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [valueEgp, setValueEgp] = useState<string | number>("");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function reset() {
    setName("");
    setPhone("");
    setChannel("");
    setSegment("");
    setSource("");
    setGovernorate("");
    setValueEgp("");
    setError("");
  }

  function handleClose() {
    close();
    setTimeout(reset, 250);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "POST",
        url: "crm/leads",
        data: {
          name: name || undefined,
          phone,
          channel,
          segment: segment || undefined,
          source: source || undefined,
          governorate: governorate || undefined,
          valueEgp: valueEgp === "" ? undefined : Number(valueEgp),
        },
      });
      callback(res.data);
      handleClose();
    });
  }

  return (
    <Modal opened={opened} onClose={handleClose} title={translate("New Lead", "عميل محتمل جديد")} size="md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          label={translate("Name (optional)", "الاسم (اختياري)")}
          placeholder={translate("Enter name", "أدخل الاسم")}
          autoFocus
        />
        <TextInput
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          label={translate("Phone", "الهاتف")}
          placeholder="01012345678"
          required
        />
        <Select
          value={channel || null}
          onChange={(v) => setChannel((v as CrmChannel) || "")}
          data={CRM_CHANNELS.map((c) => ({ value: c, label: translate(CHANNEL_LABELS[c].en, CHANNEL_LABELS[c].ar) }))}
          label={translate("Channel", "القناة")}
          placeholder={translate("How did this lead reach us?", "كيف تواصل معنا هذا العميل؟")}
          required
        />
        <Select
          value={segment || null}
          onChange={(v) => setSegment((v as CrmSegment) || "")}
          data={CRM_SEGMENTS.map((s) => ({ value: s, label: translate(SEGMENT_LABELS[s].en, SEGMENT_LABELS[s].ar) }))}
          label={translate("Segment (optional)", "القطاع (اختياري)")}
          clearable
        />
        <TextInput
          value={source}
          onChange={(e) => setSource(e.target.value)}
          label={translate("Source (optional)", "المصدر (اختياري)")}
          placeholder={translate("e.g. Google ads", "مثال: إعلانات جوجل")}
        />
        <TextInput
          value={governorate}
          onChange={(e) => setGovernorate(e.target.value)}
          label={translate("Governorate (optional)", "المحافظة (اختياري)")}
        />
        <NumberInput
          value={valueEgp}
          onChange={setValueEgp}
          label={translate("Estimated value - EGP (optional)", "القيمة التقديرية - جنيه (اختياري)")}
          min={0}
        />

        <div className="flex gap-2 pt-1">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button type="submit" loading={loading} disabled={!phone || !channel} fullWidth color="teal">
            {translate("Create Lead", "إنشاء عميل محتمل")}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
