import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { CRM_CHANNELS, CRM_FORM_SEGMENTS, CRM_GOVERNORATES, CRM_SOURCES, CrmChannel, CrmLead, CrmSegment, CrmSource } from "@/types/crm";
import { Button, NumberInput, Select, TextInput } from "@mantine/core";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { segmentLabel } from "@/pages/crm/_shared/lead-display";

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
  ad_lead_form: { en: "Ad lead form (Meta / TikTok / Google)", ar: "نموذج إعلان (ميتا / تيك توك / جوجل)" },
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
  const [email, setEmail] = useState("");
  const [campaign, setCampaign] = useState("");
  const [channel, setChannel] = useState<CrmChannel | "">("");
  const [segment, setSegment] = useState<CrmSegment | "">("");
  const [source, setSource] = useState<CrmSource | "">("");
  const [governorate, setGovernorate] = useState("");
  const [valueEgp, setValueEgp] = useState<string | number>("");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function reset() {
    setName("");
    setPhone("");
    setEmail("");
    setCampaign("");
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
          email: email.trim() || undefined,
          campaign: campaign.trim() || undefined,
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
        <TextInput
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          label={translate("Email (optional)", "البريد الإلكتروني (اختياري)")}
          placeholder="name@example.com"
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
          data={CRM_FORM_SEGMENTS.map((s) => ({ value: s, label: segmentLabel(translate)(s) }))}
          label={translate("Segment (optional)", "القطاع (اختياري)")}
          clearable
        />
        <Select
          value={source || null}
          onChange={(v) => setSource((v as CrmSource) || "")}
          data={CRM_SOURCES.map((s) => ({ value: s, label: s }))}
          // Change Request 1: source must be explicitly chosen for every channel except WhatsApp
          // (resolved automatically server-side from the Ref code, or "WhatsApp Direct") - never
          // silently defaulted to "Other".
          label={channel === "whatsapp" ? translate("Source (optional - resolved automatically)", "المصدر (اختياري - يُحدد تلقائياً)") : translate("Source", "المصدر")}
          placeholder={translate("Where did this lead come from?", "من أين جاء هذا العميل المحتمل؟")}
          required={channel !== "whatsapp"}
          clearable={channel === "whatsapp"}
        />
        <TextInput
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
          label={translate("Campaign (optional)", "الحملة (اختياري)")}
          placeholder={translate("e.g. Villas November", "مثال: فلل نوفمبر")}
          maxLength={200}
        />
        <Select
          value={governorate || null}
          onChange={(v) => setGovernorate(v || "")}
          data={CRM_GOVERNORATES.map((g) => ({ value: g.en, label: translate(g.en, g.ar) }))}
          label={translate("Governorate (optional)", "المحافظة (اختياري)")}
          searchable
          clearable
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
          <Button type="submit" loading={loading} disabled={!phone || !channel || (channel !== "whatsapp" && !source)} fullWidth color="teal">
            {translate("Create Lead", "إنشاء عميل محتمل")}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
