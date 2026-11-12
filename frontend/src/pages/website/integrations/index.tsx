import { useEffect, useState } from "react";
import { Alert, Badge, Button, Switch, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import { TrackingProvider, VerificationProvider, WebsiteIntegrations } from "@/types/website";
import { Panel, useBeforeUnload, useCmsApi } from "../_shared/cms";

// Website Management - tracking & verification (website administrators only - enforced by the
// server on every read and write). Only ids are stored; the website adds each provider's official
// tag exactly once, on the public site only. The ids are checked for the right FORMAT here - the
// provider itself (Google, Meta) is the only place that can confirm an id belongs to your account,
// so nothing on this screen claims a "connection".

const TRACKING: { key: TrackingProvider; hint: { en: string; ar: string } }[] = [
  { key: "gtm", hint: { en: "Container id from Google Tag Manager → Admin. If GA4/Ads tags are managed inside GTM, enable only GTM.", ar: "معرّف الحاوية من Google Tag Manager. إذا كانت وسوم GA4/الإعلانات داخل GTM ففعّل GTM فقط." } },
  { key: "ga4", hint: { en: "Measurement id from Google Analytics → Admin → Data streams.", ar: "معرّف القياس من Google Analytics ← المسؤول ← مصادر البيانات." } },
  { key: "metaPixel", hint: { en: "Pixel (dataset) id from Meta Events Manager.", ar: "معرّف البكسل من Meta Events Manager." } },
  { key: "googleAds", hint: { en: "Conversion id from Google Ads → Tools → Conversions.", ar: "معرّف التحويل من Google Ads ← الأدوات ← التحويلات." } },
];

export default function WebsiteIntegrationsPage() {
  const { translate } = useLanguage();
  const { call } = useCmsApi();
  useDocumentTitle(`${translate("Integrations", "التكاملات")} | Reservia Website`);
  const [data, setData] = useState<WebsiteIntegrations | null>(null);
  const [form, setForm] = useState<WebsiteIntegrations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const r = await call<WebsiteIntegrations>({ url: "website/integrations" }, { silent: true });
    if (r) {
      setData(r.data);
      setForm(r.data);
      setError("");
    } else setError(translate("Could not load the integrations.", "تعذر تحميل التكاملات."));
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const strip = (x: WebsiteIntegrations | null) => (x ? JSON.stringify({ ga4: x.ga4, gtm: x.gtm, metaPixel: x.metaPixel, googleAds: x.googleAds, verification: x.verification }) : "");
  const dirty = strip(form) !== strip(data);
  useBeforeUnload(dirty);

  async function save() {
    if (!form) return;
    setSaving(true);
    const r = await call<WebsiteIntegrations>({ url: "website/integrations", method: "PUT", data: { ga4: form.ga4, gtm: form.gtm, metaPixel: form.metaPixel, googleAds: form.googleAds, verification: form.verification } }, { success: "server", error: translate("Could not save", "تعذر الحفظ") });
    if (r) {
      setData(r.data);
      setForm(r.data);
    }
    setSaving(false);
  }

  return (
    <AdminLayoutBox
      header={{
        title: translate("Integrations", "التكاملات"),
        subTitle: translate("Analytics, advertising pixels and search-engine verification for the public website.", "التحليلات وبكسلات الإعلانات والتحقق من محركات البحث للموقع العام."),
        sideElements: form && (
          <Button color="teal" disabled={!dirty} loading={saving} onClick={save} data-testid="save-integrations">
            {translate("Save", "حفظ")}
          </Button>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading...", "جاري التحميل...")} />
      ) : error || !form ? (
        <ErrorSection errorTitle={translate("Could not load", "تعذر التحميل")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
      ) : (
        <div className="flex max-w-4xl flex-col gap-4">
          <Alert color="blue" variant="light">
            {translate(
              "Ids are checked for the correct format. Whether an id belongs to your account can only be confirmed in that provider's own dashboard (for example Tag Assistant or Meta Events Manager) after the website is updated.",
              "يتم التحقق من صيغة المعرّفات. لا يمكن التأكد من أن المعرّف يخص حسابك إلا من لوحة المزوّد نفسه (مثل Tag Assistant أو Meta Events Manager) بعد تحديث الموقع.",
            )}
          </Alert>
          {form.gtm.enabled && form.ga4.enabled && (
            <Alert color="yellow" variant="light">
              {translate("Both Tag Manager and GA4 are enabled. If GA4 is also configured inside your GTM container, page views will be counted twice - keep only one.", "تم تفعيل Tag Manager وGA4 معًا. إذا كان GA4 مُعدًا داخل حاوية GTM فستُحسب الزيارات مرتين - أبقِ واحدًا فقط.")}
            </Alert>
          )}
          <Panel title={translate("Tracking", "التتبع")}>
            <div className="flex flex-col gap-4">
              {TRACKING.map(({ key, hint }) => {
                const p = form.providers[key];
                return (
                  <div key={key} className="flex flex-wrap items-end gap-3 border-b border-gray-50 pb-3 last:border-0" data-testid={`integration-${key}`}>
                    <TextInput
                      className="min-w-[240px] flex-1"
                      label={p.label}
                      description={translate(hint.en, hint.ar)}
                      placeholder={p.example}
                      value={form[key].id}
                      onChange={(e) => setForm({ ...form, [key]: { ...form[key], id: e.currentTarget.value.trim() } })}
                      dir="ltr"
                    />
                    <Switch className="mb-2" label={translate("Enabled", "مفعّل")} checked={form[key].enabled} onChange={(e) => setForm({ ...form, [key]: { ...form[key], enabled: e.currentTarget.checked } })} />
                    {data?.[key].enabled && data[key].id && (
                      <Badge className="mb-2" color="teal" variant="light">
                        {translate("On the website after the next update", "على الموقع بعد التحديث التالي")}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
          <Panel title={translate("Site verification", "التحقق من الموقع")} description={translate("Paste the code or the whole <meta> tag the provider gives you.", "الصق الرمز أو وسم <meta> كاملًا كما يعطيه المزوّد.")}>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(form.verificationProviders) as VerificationProvider[]).map((k) => (
                <TextInput key={k} label={form.verificationProviders[k]} value={form.verification[k] || ""} onChange={(e) => setForm({ ...form, verification: { ...form.verification, [k]: e.currentTarget.value } })} dir="ltr" data-testid={`verify-${k}`} />
              ))}
            </div>
          </Panel>
          <p className="text-xs text-gray-500">{translate("Other tracking snippets can be added under Custom Code.", "يمكن إضافة أكواد تتبع أخرى من الكود المخصص.")}</p>
        </div>
      )}
    </AdminLayoutBox>
  );
}
