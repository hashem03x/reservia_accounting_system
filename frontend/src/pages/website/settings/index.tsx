import { ReactNode, useEffect, useMemo, useState } from "react";
import { Alert, Button, Checkbox, Select, Textarea, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useWebsiteMedia from "@/hooks/useWebsiteMedia";
import handleRequest from "@/utils/helpers/handle-request";
import { notifyError, notifySuccess } from "@/utils/helpers/notifiers";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import { WebsiteLocale, WebsiteSettings } from "@/types/website";

// Website Management - site-wide settings (website admins only; backend: settings.manage). The
// domain and languages every canonical/hreflang/sitemap URL is built from, the default title
// template and description, and the organization details used for structured data. Nothing here
// has a business value as its default: only what an administrator enters is ever published.

export default function WebsiteSettingsPage() {
  const { language, translate } = useLanguage();
  useDocumentTitle(`${translate("Website settings", "إعدادات الموقع")} | Reservia Website`);
  const { privateRequest, loading, setLoading, error, setError, data: saved, setData: setSaved } = useDataHandler<WebsiteSettings | null>({ initialData: null, initialLoading: true });
  const [form, setForm] = useState<WebsiteSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const { media } = useWebsiteMedia();

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: "website/settings", language });
      setSaved(res.data);
      setForm(res.data);
    });
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(form), [saved, form]);
  const set = (patch: Partial<WebsiteSettings>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setOrg = (patch: Partial<WebsiteSettings["organization"]>) => setForm((f) => (f ? { ...f, organization: { ...f.organization, ...patch } } : f));

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const { siteNameEn, siteNameAr, taglineEn, taglineAr, publicSiteUrl, defaultLocale, enabledLocales, titleTemplateEn, titleTemplateAr, defaultDescriptionEn, defaultDescriptionAr, twitterHandle, defaultOgImage, organization } = form;
      const res = await privateRequest({
        url: "website/settings",
        method: "PUT",
        data: { siteNameEn, siteNameAr, taglineEn, taglineAr, publicSiteUrl, defaultLocale, enabledLocales, titleTemplateEn, titleTemplateAr, defaultDescriptionEn, defaultDescriptionAr, twitterHandle, defaultOgImage, organization },
        language,
      });
      setSaved(res.data);
      setForm(res.data);
      notifySuccess({ language, message: translate("Settings saved. They reach the website with the next publish.", "تم حفظ الإعدادات. تصل إلى الموقع مع النشر التالي.") });
    } catch (err) {
      notifyError({ language, message: (err as Error)?.message || translate("Could not save settings", "تعذر حفظ الإعدادات") });
    } finally {
      setSaving(false);
    }
  }

  const images = media.filter((m) => !m.format || ["jpg", "jpeg", "png", "webp"].includes(m.format.toLowerCase()));

  return (
    <AdminLayoutBox
      header={{
        title: translate("Website settings", "إعدادات الموقع"),
        subTitle: translate("Domain, languages and search defaults for the whole website", "النطاق واللغات وإعدادات البحث الافتراضية للموقع كله"),
        sideElements: form && (
          <Button color="teal" onClick={save} loading={saving} disabled={!dirty}>
            {translate("Save", "حفظ")}
          </Button>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading settings...", "جاري تحميل الإعدادات...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Could not load settings", "تعذر تحميل الإعدادات")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
      ) : (
        form && (
          <div className="flex max-w-4xl flex-col gap-4">
            <Panel title={translate("Domain and languages", "النطاق واللغات")}>
              {!form.publicSiteUrl && (
                <Alert color="yellow" variant="light" mb="sm">
                  {translate(
                    "No public address set: the website build uses its own VITE_SITE_URL for canonical and language URLs.",
                    "لم يُحدد عنوان عام: يستخدم بناء الموقع متغير VITE_SITE_URL الخاص به للروابط الأساسية وروابط اللغات.",
                  )}
                </Alert>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput
                  label={translate("Public website address", "عنوان الموقع العام")}
                  description={translate("https and the domain only, e.g. https://reservia-energy.com", "https والنطاق فقط، مثل https://reservia-energy.com")}
                  value={form.publicSiteUrl}
                  onChange={(e) => set({ publicSiteUrl: e.currentTarget.value.trim() })}
                  dir="ltr"
                />
                <Select
                  label={translate("Default language (x-default, home redirect)", "اللغة الافتراضية (x-default وتوجيه الرئيسية)")}
                  value={form.defaultLocale}
                  onChange={(v) => v && set({ defaultLocale: v as WebsiteLocale, enabledLocales: Array.from(new Set([...form.enabledLocales, v as WebsiteLocale])) })}
                  allowDeselect={false}
                  data={[
                    { value: "ar", label: translate("Arabic", "العربية") },
                    { value: "en", label: translate("English", "الإنجليزية") },
                  ]}
                />
              </div>
              <Checkbox.Group
                mt="sm"
                label={translate("Enabled languages", "اللغات المفعلة")}
                value={form.enabledLocales}
                onChange={(v) => v.includes(form.defaultLocale) && set({ enabledLocales: v as WebsiteLocale[] })}
              >
                <div className="mt-1 flex gap-4">
                  <Checkbox value="ar" label={translate("Arabic", "العربية")} />
                  <Checkbox value="en" label={translate("English", "الإنجليزية")} />
                </div>
              </Checkbox.Group>
            </Panel>

            <Panel title={translate("Site name and search defaults", "اسم الموقع وإعدادات البحث الافتراضية")}>
              <Bilingual
                label={translate("Site name", "اسم الموقع")}
                en={form.siteNameEn}
                ar={form.siteNameAr}
                onEn={(v) => set({ siteNameEn: v })}
                onAr={(v) => set({ siteNameAr: v })}
                max={120}
              />
              <Bilingual
                label={translate("Title template", "قالب العنوان")}
                description={translate("%s is replaced by the page title, e.g. %s | Reservia. Empty = the page title alone.", "يُستبدل %s بعنوان الصفحة، مثل %s | ريزيرفيا. فارغ = عنوان الصفحة فقط.")}
                en={form.titleTemplateEn}
                ar={form.titleTemplateAr}
                onEn={(v) => set({ titleTemplateEn: v })}
                onAr={(v) => set({ titleTemplateAr: v })}
                max={80}
              />
              <Bilingual
                label={translate("Default meta description", "وصف البحث الافتراضي")}
                description={translate("Used by a CMS page that has no description and no descriptive text of its own.", "يُستخدم لصفحة نظام بلا وصف وبلا نص وصفي خاص بها.")}
                en={form.defaultDescriptionEn}
                ar={form.defaultDescriptionAr}
                onEn={(v) => set({ defaultDescriptionEn: v })}
                onAr={(v) => set({ defaultDescriptionAr: v })}
                max={160}
                multiline
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label={translate("Default share image", "صورة المشاركة الافتراضية")}
                  value={images.find((m) => m.url === form.defaultOgImage?.url)?._id ?? null}
                  onChange={(v) => {
                    const m = images.find((x) => x._id === v);
                    set({ defaultOgImage: m ? { url: m.url, publicId: m.publicId } : { url: null, publicId: null } });
                  }}
                  data={images.map((m) => ({ value: m._id, label: m.altEn || m.altAr || m.publicId }))}
                  clearable
                  searchable
                />
                <TextInput label={translate("X (Twitter) handle", "حساب X (تويتر)")} value={form.twitterHandle} onChange={(e) => set({ twitterHandle: e.currentTarget.value })} dir="ltr" leftSection="@" />
              </div>
            </Panel>

            <Panel title={translate("Organization (structured data)", "المؤسسة (البيانات المنظمة)")}>
              <p className="mb-3 text-xs text-gray-500">
                {translate(
                  "Only fields you fill in are published - nothing is assumed. Leave a field empty if you are not sure of it.",
                  "تُنشر الحقول التي تملؤها فقط - لا يُفترض شيء. اترك الحقل فارغًا إن لم تكن متأكدًا منه.",
                )}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label={translate("Type", "النوع")}
                  value={form.organization.schemaType}
                  onChange={(v) => v && setOrg({ schemaType: v as WebsiteSettings["organization"]["schemaType"] })}
                  allowDeselect={false}
                  data={["Organization", "LocalBusiness", "ProfessionalService", "HomeAndConstructionBusiness"]}
                />
                <TextInput label={translate("Legal name", "الاسم القانوني")} value={form.organization.legalName} onChange={(e) => setOrg({ legalName: e.currentTarget.value })} />
                <TextInput label={translate("Founded (YYYY or YYYY-MM-DD)", "سنة التأسيس")} value={form.organization.foundingDate} onChange={(e) => setOrg({ foundingDate: e.currentTarget.value })} dir="ltr" />
                <TextInput label={translate("Street address", "العنوان")} value={form.organization.streetAddress} onChange={(e) => setOrg({ streetAddress: e.currentTarget.value })} />
                <TextInput label={translate("City / district", "المدينة / الحي")} value={form.organization.addressLocality} onChange={(e) => setOrg({ addressLocality: e.currentTarget.value })} />
                <TextInput label={translate("Governorate / region", "المحافظة")} value={form.organization.addressRegion} onChange={(e) => setOrg({ addressRegion: e.currentTarget.value })} />
                <TextInput label={translate("Postal code", "الرمز البريدي")} value={form.organization.postalCode} onChange={(e) => setOrg({ postalCode: e.currentTarget.value })} dir="ltr" />
                <TextInput
                  label={translate("Country code", "رمز الدولة")}
                  description="EG"
                  value={form.organization.addressCountry}
                  onChange={(e) => setOrg({ addressCountry: e.currentTarget.value.toUpperCase().slice(0, 2) })}
                  dir="ltr"
                />
              </div>
              <div className="mt-3">
                <Bilingual
                  label={translate("Organization description", "وصف المؤسسة")}
                  en={form.organization.descriptionEn}
                  ar={form.organization.descriptionAr}
                  onEn={(v) => setOrg({ descriptionEn: v })}
                  onAr={(v) => setOrg({ descriptionAr: v })}
                  max={500}
                  multiline
                />
              </div>
            </Panel>
          </div>
        )
      )}
    </AdminLayoutBox>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-100 p-4">
      <h3 className="mb-3 text-sm font-semibold text-[#0B3D91]">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Bilingual({
  label,
  description,
  en,
  ar,
  onEn,
  onAr,
  max,
  multiline,
}: {
  label: string;
  description?: string;
  en: string;
  ar: string;
  onEn: (v: string) => void;
  onAr: (v: string) => void;
  max: number;
  multiline?: boolean;
}) {
  const { translate } = useLanguage();
  const fields = [
    { key: "ar", label: `${label} - ${translate("Arabic", "العربية")}`, description, value: ar, onChange: onAr, dir: "rtl" },
    { key: "en", label: `${label} - ${translate("English", "الإنجليزية")}`, description: description ? " " : undefined, value: en, onChange: onEn, dir: "ltr" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) =>
        multiline ? (
          <Textarea key={f.key} label={f.label} description={f.description} value={f.value} onChange={(e) => f.onChange(e.currentTarget.value)} maxLength={max} dir={f.dir} autosize minRows={2} />
        ) : (
          <TextInput key={f.key} label={f.label} description={f.description} value={f.value} onChange={(e) => f.onChange(e.currentTarget.value)} maxLength={max} dir={f.dir} />
        ),
      )}
    </div>
  );
}
