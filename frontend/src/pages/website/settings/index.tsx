import { ReactNode, useEffect, useMemo, useState } from "react";
import { Alert, Button, Checkbox, Select, Switch, Textarea, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { notifyError, notifySuccess } from "@/utils/helpers/notifiers";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import { BusinessHoursRow, WebsiteLocale, WebsiteSettings, WeekDay } from "@/types/website";
import { ImageField } from "../_shared/media-picker";
import { useBeforeUnload } from "../_shared/cms";

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
  useBeforeUnload(dirty);
  const set = (patch: Partial<WebsiteSettings>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setOrg = (patch: Partial<WebsiteSettings["organization"]>) => setForm((f) => (f ? { ...f, organization: { ...f.organization, ...patch } } : f));

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const keys = [
        "siteNameEn", "siteNameAr", "taglineEn", "taglineAr", "publicSiteUrl", "defaultLocale", "enabledLocales", "titleTemplateEn", "titleTemplateAr",
        "defaultDescriptionEn", "defaultDescriptionAr", "twitterHandle", "defaultOgImage", "organization", "logo", "logoDark", "favicon", "descriptionEn", "descriptionAr",
        "footerCopyrightEn", "footerCopyrightAr", "publishOrgContacts", "contact", "socialLinks", "businessHours", "businessHoursNoteEn", "businessHoursNoteAr",
        "header", "footer", "cookieConsent", "robots",
      ] as const;
      const data: Record<string, unknown> = {};
      const f = form as unknown as Record<string, unknown>;
      for (const k of keys) if (f[k] !== undefined) data[k] = f[k];
      const res = await privateRequest({ url: "website/settings", method: "PUT", data, language });
      setSaved(res.data);
      setForm(res.data);
      notifySuccess({ language, message: translate("Settings saved. They reach the live website on its next update (Overview → Update live website, or any publish).", "تم حفظ الإعدادات. تصل إلى الموقع في التحديث التالي (نظرة عامة ← تحديث الموقع، أو أي نشر).") });
    } catch (err) {
      const e = err as { message?: string; errors?: { msg?: string }[] };
      notifyError({ language, message: (Array.isArray(e?.errors) && e.errors.map((x) => x.msg).join(" · ")) || e?.message || translate("Could not save settings", "تعذر حفظ الإعدادات") });
    } finally {
      setSaving(false);
    }
  }

  const contact = form?.contact || { businessEmail: "", salesEmail: "", officePhone: "", mobilePhone: "", whatsappNumber: "", addressEn: "", addressAr: "", mapEmbedUrl: "" };
  const setContact = (patch: Partial<NonNullable<WebsiteSettings["contact"]>>) => set({ contact: { ...contact, ...patch } });
  const header = form?.header || { showCta: true, ctaLabelEn: "", ctaLabelAr: "", ctaHref: "", showPhone: true, sticky: true };
  const footer = form?.footer || { showNewsletter: false, showSocial: true, showContact: true };
  const cookie = form?.cookieConsent || { enabled: false, messageEn: "", messageAr: "", acceptLabelEn: "", acceptLabelAr: "", policyUrl: "", blockTrackingUntilConsent: true };
  const robots = form?.robots || { discourageIndexing: false, disallowPaths: [] };

  return (
    <AdminLayoutBox
      header={{
        title: translate("Website settings", "إعدادات الموقع"),
        subTitle: translate("Company details, branding, contacts, domain, languages and search defaults for the whole website. Changes reach the live website on its next update.", "بيانات الشركة والهوية والتواصل والنطاق واللغات وإعدادات البحث للموقع كله. تصل التغييرات إلى الموقع في التحديث التالي."),
        sideElements: form && (
          <Button color="teal" onClick={save} loading={saving} disabled={!dirty} data-testid="save-settings">
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
                    "No public address set yet. Enter the website's domain so canonical links, language links, the sitemap and draft previews use it.",
                    "لم يُحدد عنوان عام بعد. أدخل نطاق الموقع لتستخدمه الروابط الأساسية وروابط اللغات وخريطة الموقع ومعاينة المسودات.",
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
                <ImageField
                  label={translate("Default share image", "صورة المشاركة الافتراضية")}
                  value={form.defaultOgImage?.url ? { url: form.defaultOgImage.url, publicId: form.defaultOgImage.publicId || undefined } : null}
                  onChange={(img) => set({ defaultOgImage: img ? { url: img.url, publicId: img.publicId || null } : { url: null, publicId: null } })}
                />
                <TextInput label={translate("X (Twitter) handle", "حساب X (تويتر)")} value={form.twitterHandle} onChange={(e) => set({ twitterHandle: e.currentTarget.value })} dir="ltr" leftSection="@" />
              </div>
            </Panel>

            <Panel title={translate("Company and branding", "الشركة والهوية")}>
              <Bilingual label={translate("Tagline", "الشعار النصي")} en={form.taglineEn} ar={form.taglineAr} onEn={(v) => set({ taglineEn: v })} onAr={(v) => set({ taglineAr: v })} max={200} />
              <Bilingual label={translate("Company description", "وصف الشركة")} en={form.descriptionEn || ""} ar={form.descriptionAr || ""} onEn={(v) => set({ descriptionEn: v })} onAr={(v) => set({ descriptionAr: v })} max={600} multiline />
              <div className="grid gap-3 sm:grid-cols-3">
                {(["logo", "logoDark", "favicon"] as const).map((k) => (
                  <ImageField
                    key={k}
                    label={{ logo: translate("Logo", "الشعار"), logoDark: translate("Logo on dark backgrounds", "الشعار على الخلفيات الداكنة"), favicon: translate("Favicon (square, 512×512)", "أيقونة المتصفح (مربعة 512×512)") }[k]}
                    value={form[k]?.url ? { url: form[k]!.url as string, publicId: form[k]!.publicId || undefined } : null}
                    onChange={(img) => set({ [k]: img ? { url: img.url, publicId: img.publicId || null } : { url: null, publicId: null } } as Partial<WebsiteSettings>)}
                    testId={`settings-${k}`}
                  />
                ))}
              </div>
              <Bilingual label={translate("Footer copyright", "حقوق النشر في التذييل")} en={form.footerCopyrightEn || ""} ar={form.footerCopyrightAr || ""} onEn={(v) => set({ footerCopyrightEn: v })} onAr={(v) => set({ footerCopyrightAr: v })} max={200} />
            </Panel>

            <Panel title={translate("Contact details", "بيانات التواصل")}>
              <Switch
                checked={!!form.publishOrgContacts}
                onChange={(e) => set({ publishOrgContacts: e.currentTarget.checked })}
                label={translate("Show these contact details on the website", "إظهار بيانات التواصل هذه على الموقع")}
                description={translate("Off: the website keeps its built-in contact details. The sales email is internal and never shown.", "معطل: يحتفظ الموقع ببيانات التواصل المدمجة. بريد المبيعات داخلي ولا يظهر أبدًا.")}
                data-testid="settings-publish-contacts"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput label={translate("Business email", "البريد الرسمي")} value={contact.businessEmail} onChange={(e) => setContact({ businessEmail: e.currentTarget.value })} dir="ltr" />
                <TextInput label={translate("Sales email (internal)", "بريد المبيعات (داخلي)")} value={contact.salesEmail} onChange={(e) => setContact({ salesEmail: e.currentTarget.value })} dir="ltr" />
                <TextInput label={translate("Office phone", "هاتف المكتب")} value={contact.officePhone} onChange={(e) => setContact({ officePhone: e.currentTarget.value })} dir="ltr" />
                <TextInput label={translate("Mobile phone", "الهاتف المحمول")} value={contact.mobilePhone} onChange={(e) => setContact({ mobilePhone: e.currentTarget.value })} dir="ltr" />
                <TextInput label={translate("WhatsApp number", "رقم واتساب")} description={translate("International format, e.g. +201001234567", "بالصيغة الدولية، مثل ‎+201001234567")} value={contact.whatsappNumber} onChange={(e) => setContact({ whatsappNumber: e.currentTarget.value })} dir="ltr" />
                <TextInput label={translate("Google Maps embed URL", "رابط تضمين خرائط جوجل")} value={contact.mapEmbedUrl} onChange={(e) => setContact({ mapEmbedUrl: e.currentTarget.value })} dir="ltr" />
              </div>
              <Bilingual label={translate("Address", "العنوان")} en={contact.addressEn} ar={contact.addressAr} onEn={(v) => setContact({ addressEn: v })} onAr={(v) => setContact({ addressAr: v })} max={300} />
              <BusinessHours rows={form.businessHours || []} onChange={(businessHours) => set({ businessHours })} />
              <Bilingual label={translate("Hours note", "ملاحظة المواعيد")} en={form.businessHoursNoteEn || ""} ar={form.businessHoursNoteAr || ""} onEn={(v) => set({ businessHoursNoteEn: v })} onAr={(v) => set({ businessHoursNoteAr: v })} max={200} />
            </Panel>

            <Panel title={translate("Social media", "وسائل التواصل الاجتماعي")}>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["facebook", "instagram", "linkedin", "youtube", "tiktok", "x"] as const).map((k) => (
                  <TextInput key={k} label={{ facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", youtube: "YouTube", tiktok: "TikTok", x: "X" }[k]} placeholder="https://" value={form.socialLinks?.[k] || ""} onChange={(e) => set({ socialLinks: { ...(form.socialLinks || {}), [k]: e.currentTarget.value.trim() } })} dir="ltr" />
                ))}
              </div>
            </Panel>

            <Panel title={translate("Header and footer", "الرأس والتذييل")}>
              <div className="flex flex-wrap gap-6">
                <Switch label={translate("Header button", "زر الرأس")} checked={header.showCta} onChange={(e) => set({ header: { ...header, showCta: e.currentTarget.checked } })} />
                <Switch label={translate("Phone in header", "الهاتف في الرأس")} checked={header.showPhone} onChange={(e) => set({ header: { ...header, showPhone: e.currentTarget.checked } })} />
                <Switch label={translate("Sticky header", "رأس ثابت")} checked={header.sticky} onChange={(e) => set({ header: { ...header, sticky: e.currentTarget.checked } })} />
                <Switch label={translate("Social links in footer", "روابط التواصل في التذييل")} checked={footer.showSocial} onChange={(e) => set({ footer: { ...footer, showSocial: e.currentTarget.checked } })} />
                <Switch label={translate("Contact details in footer", "بيانات التواصل في التذييل")} checked={footer.showContact} onChange={(e) => set({ footer: { ...footer, showContact: e.currentTarget.checked } })} />
              </div>
              {header.showCta && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <TextInput label={translate("Button label (English)", "نص الزر (الإنجليزية)")} value={header.ctaLabelEn} onChange={(e) => set({ header: { ...header, ctaLabelEn: e.currentTarget.value } })} maxLength={40} dir="ltr" placeholder={translate("Default: Get a quote", "الافتراضي: اطلب عرض سعر")} />
                  <TextInput label={translate("Button label (Arabic)", "نص الزر (العربية)")} value={header.ctaLabelAr} onChange={(e) => set({ header: { ...header, ctaLabelAr: e.currentTarget.value } })} maxLength={40} dir="rtl" />
                  <TextInput label={translate("Button link", "رابط الزر")} value={header.ctaHref} onChange={(e) => set({ header: { ...header, ctaHref: e.currentTarget.value.trim() } })} dir="ltr" placeholder="/contact" />
                </div>
              )}
            </Panel>

            <Panel title={translate("Cookie notice", "إشعار ملفات تعريف الارتباط")}>
              <Switch label={translate("Show a cookie notice", "إظهار إشعار ملفات تعريف الارتباط")} checked={cookie.enabled} onChange={(e) => set({ cookieConsent: { ...cookie, enabled: e.currentTarget.checked } })} data-testid="settings-cookie" />
              {cookie.enabled && (
                <>
                  <Bilingual label={translate("Notice text", "نص الإشعار")} en={cookie.messageEn} ar={cookie.messageAr} onEn={(v) => set({ cookieConsent: { ...cookie, messageEn: v } })} onAr={(v) => set({ cookieConsent: { ...cookie, messageAr: v } })} max={400} multiline />
                  <Bilingual label={translate("Accept button", "زر القبول")} en={cookie.acceptLabelEn} ar={cookie.acceptLabelAr} onEn={(v) => set({ cookieConsent: { ...cookie, acceptLabelEn: v } })} onAr={(v) => set({ cookieConsent: { ...cookie, acceptLabelAr: v } })} max={30} />
                  <TextInput label={translate("Privacy policy link", "رابط سياسة الخصوصية")} value={cookie.policyUrl} onChange={(e) => set({ cookieConsent: { ...cookie, policyUrl: e.currentTarget.value.trim() } })} dir="ltr" placeholder="/privacy" />
                  <Switch
                    label={translate("Load analytics and pixels only after the visitor accepts", "تحميل التحليلات والبكسلات فقط بعد موافقة الزائر")}
                    checked={cookie.blockTrackingUntilConsent}
                    onChange={(e) => set({ cookieConsent: { ...cookie, blockTrackingUntilConsent: e.currentTarget.checked } })}
                  />
                </>
              )}
            </Panel>

            <Panel title={translate("Search engines", "محركات البحث")}>
              <Switch
                label={translate("Ask search engines not to index the whole website", "مطالبة محركات البحث بعدم فهرسة الموقع كله")}
                description={translate("For a staging or test domain only. Never enable on the real website.", "لنطاق تجريبي فقط. لا تفعّله على الموقع الحقيقي.")}
                checked={robots.discourageIndexing}
                onChange={(e) => set({ robots: { ...robots, discourageIndexing: e.currentTarget.checked } })}
              />
              <Textarea
                label={translate("Paths to keep out of search results (one per line)", "مسارات تُستبعد من نتائج البحث (سطر لكل مسار)")}
                description={translate("Added to robots.txt, e.g. /thank-you", "تُضاف إلى robots.txt، مثل ‎/thank-you")}
                value={robots.disallowPaths.join("\n")}
                onChange={(e) => set({ robots: { ...robots, disallowPaths: e.currentTarget.value.split("\n").map((x) => x.trim()).filter(Boolean) } })}
                autosize
                minRows={2}
                dir="ltr"
              />
              <p className="text-xs text-gray-500">{translate("The sitemap lists every published, indexable page automatically. Per-page indexing is set in each page's SEO tab.", "تتضمن خريطة الموقع كل صفحة منشورة وقابلة للفهرسة تلقائيًا. تُضبط فهرسة كل صفحة من تبويب تحسين البحث الخاص بها.")}</p>
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

const DAYS: { key: WeekDay; en: string; ar: string }[] = [
  { key: "sat", en: "Saturday", ar: "السبت" },
  { key: "sun", en: "Sunday", ar: "الأحد" },
  { key: "mon", en: "Monday", ar: "الإثنين" },
  { key: "tue", en: "Tuesday", ar: "الثلاثاء" },
  { key: "wed", en: "Wednesday", ar: "الأربعاء" },
  { key: "thu", en: "Thursday", ar: "الخميس" },
  { key: "fri", en: "Friday", ar: "الجمعة" },
];

function BusinessHours({ rows, onChange }: { rows: BusinessHoursRow[]; onChange: (rows: BusinessHoursRow[]) => void }) {
  const { translate } = useLanguage();
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const update = (day: WeekDay, patch: Partial<BusinessHoursRow> | null) => {
    const next = DAYS.map((d) => {
      const cur = byDay.get(d.key);
      if (d.key !== day) return cur;
      if (patch === null) return undefined;
      return { day, open: "09:00", close: "17:00", closed: false, ...(cur || {}), ...patch };
    }).filter(Boolean) as BusinessHoursRow[];
    onChange(next);
  };
  return (
    <div>
      <span className="text-sm font-medium">{translate("Business hours", "ساعات العمل")}</span>
      <div className="mt-1 flex flex-col gap-1">
        {DAYS.map((d) => {
          const r = byDay.get(d.key);
          return (
            <div key={d.key} className="flex flex-wrap items-center gap-2 text-sm">
              <Checkbox w={130} label={translate(d.en, d.ar)} checked={!!r} onChange={(e) => update(d.key, e.currentTarget.checked ? {} : null)} />
              {r && (
                <>
                  <Switch size="xs" label={translate("Closed", "مغلق")} checked={!!r.closed} onChange={(e) => update(d.key, { closed: e.currentTarget.checked })} />
                  {!r.closed && (
                    <>
                      <TextInput size="xs" type="time" value={r.open || ""} onChange={(e) => update(d.key, { open: e.currentTarget.value })} w={110} />
                      <span>–</span>
                      <TextInput size="xs" type="time" value={r.close || ""} onChange={(e) => update(d.key, { close: e.currentTarget.value })} w={110} />
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
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
