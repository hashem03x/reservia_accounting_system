import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Badge, Button, Checkbox, SegmentedControl, Select, Switch, Table, Tabs, Textarea, TextInput, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useWebsiteMedia from "@/hooks/useWebsiteMedia";
import handleRequest from "@/utils/helpers/handle-request";
import { notifyError, notifySuccess } from "@/utils/helpers/notifiers";
import paths from "@/utils/constants/paths";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import {
  hasWebsiteCapability,
  ResolvedSeo,
  SEO_LIMITS,
  SEO_RECOMMENDED,
  SeoPreview,
  WebsiteLocale,
  WebsitePage,
  WebsiteRevision,
  WebsiteRole,
  WebsiteSeo,
} from "@/types/website";
import { formatCairoDateTime } from "@/pages/crm/_shared/business-date";
import { LOCALE_LABELS, localeSuffix, SEO_SOURCE_LABELS, SEO_WARNING_LABELS } from "../../_shared/seo-labels";

// Website Management - one page's editor. Tabs: SEO (per language: title, description, search
// preview, canonical, social sharing, breadcrumb label; plus indexing), Page (path, parent,
// languages, type) and Publishing (publish/unpublish, revision history, revert).
//
// The preview panel is NOT computed here: every edit is sent (debounced, unsaved) to
// POST /website/pages/:id/seo-preview, where the same resolver the public website feed uses
// returns the final title/description/canonical/hreflang/robots/breadcrumbs. What the editor sees
// is what the website will render once the page is saved and published - no second copy of the
// rules lives in the dashboard. An empty field is never filled in automatically: the generated
// default is only shown next to it.

type Draft = Pick<WebsitePage, "path" | "parentSlug" | "pageType" | "isHomePage" | "locales"> & { seo: WebsiteSeo };

const toDraft = (p: WebsitePage): Draft => ({
  path: p.path,
  parentSlug: p.parentSlug,
  pageType: p.pageType,
  isHomePage: p.isHomePage,
  locales: p.locales?.length ? p.locales : ["ar", "en"],
  seo: { ...p.seo },
});

export default function WebsitePageEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { language, translate } = useLanguage();
  const { systems } = useSystemAccess();
  const role = systems?.WEBSITE?.role as WebsiteRole | null | undefined;
  const canEdit = hasWebsiteCapability(role, "edit");
  const canPublish = hasWebsiteCapability(role, "publish");

  const { privateRequest, loading, setLoading, error, setError, data: page, setData: setPage } = useDataHandler<WebsitePage | null>({ initialData: null, initialLoading: true });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<SeoPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [allSlugs, setAllSlugs] = useState<string[]>([]);
  const [revisions, setRevisions] = useState<WebsiteRevision[]>([]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [tab, setTab] = useState<string | null>("seo");
  const [locale, setLocale] = useState<WebsiteLocale>("ar");

  useDocumentTitle(`${page?.slug ?? translate("Page", "صفحة")} | Reservia Website`);

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const [res, list, revs] = await Promise.all([
        privateRequest({ url: `website/pages/${id}`, language }),
        privateRequest({ url: "website/pages", params: { limit: 100 }, language }),
        privateRequest({ url: `website/pages/${id}/revisions`, language }),
      ]);
      setPage(res.data);
      setDraft(toDraft(res.data));
      setAllSlugs((list.data as WebsitePage[]).map((p) => p.slug).filter((s) => s !== res.data.slug));
      setRevisions(revs.data);
      if (res.data.locales?.length && !res.data.locales.includes(locale)) setLocale(res.data.locales[0]);
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Live preview of the unsaved draft, debounced; only the latest response is kept.
  const previewSeq = useRef(0);
  useEffect(() => {
    if (!draft || !page) return;
    const seq = ++previewSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await privateRequest({ url: `website/pages/${page._id}/seo-preview`, method: "POST", data: draft, language });
        if (seq === previewSeq.current) {
          setPreview(res.data);
          setPreviewError("");
        }
      } catch (err) {
        if (seq === previewSeq.current) setPreviewError((err as Error)?.message || "");
      }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, page?._id]);

  const dirty = useMemo(() => !!page && !!draft && JSON.stringify(toDraft(page)) !== JSON.stringify(draft), [page, draft]);

  async function save() {
    if (!page || !draft) return;
    setSaving(true);
    try {
      const res = await privateRequest({ url: `website/pages/${page._id}`, method: "PATCH", data: draft, language });
      setPage({ ...res.data, hasPendingChanges: true });
      setDraft(toDraft(res.data));
      notifySuccess({ language, message: translate("Saved. Publish the page to put the changes on the website.", "تم الحفظ. انشر الصفحة لتظهر التغييرات على الموقع.") });
    } catch (err) {
      notifyError({ language, message: (err as Error)?.message || translate("Could not save", "تعذر الحفظ") });
    } finally {
      setSaving(false);
    }
  }

  async function publish(action: "publish" | "unpublish") {
    if (!page) return;
    setPublishing(true);
    try {
      const res = await privateRequest({ url: `website/pages/${page._id}/${action}`, method: "POST", data: {}, language });
      const triggered = res.data?.deploy?.triggered;
      notifySuccess({
        language,
        message:
          action === "publish"
            ? triggered
              ? translate("Published. The website is rebuilding and will show it in a few minutes.", "تم النشر. يُعاد بناء الموقع وستظهر التغييرات خلال دقائق.")
              : translate("Published in the CMS. The website rebuild hook is not configured, so the live site will update on its next build.", "تم النشر في النظام. رابط إعادة بناء الموقع غير مُعد، لذا سيتحدث الموقع في البناء التالي.")
            : translate("Unpublished.", "تم إلغاء النشر."),
      });
      load();
    } catch (err) {
      notifyError({ language, message: (err as Error)?.message || translate("Could not publish", "تعذر النشر") });
    } finally {
      setPublishing(false);
    }
  }

  async function revert(revisionId: string) {
    if (!page) return;
    if (!window.confirm(translate("Restore this version and publish it again?", "استعادة هذه النسخة ونشرها مرة أخرى؟"))) return;
    try {
      await privateRequest({ url: `website/pages/${page._id}/revisions/${revisionId}/revert`, method: "POST", language });
      notifySuccess({ language, message: translate("Version restored and republished.", "تمت استعادة النسخة وإعادة نشرها.") });
      load();
    } catch (err) {
      notifyError({ language, message: (err as Error)?.message || translate("Could not restore", "تعذرت الاستعادة") });
    }
  }

  const setSeo = (patch: Partial<WebsiteSeo>) => setDraft((d) => (d ? { ...d, seo: { ...d.seo, ...patch } } : d));
  const resolved = preview?.seo?.[locale];
  const problems = preview?.problems ?? [];

  return (
    <AdminLayoutBox
      header={{
        title: page ? page.slug : translate("Page", "صفحة"),
        subTitle: page ? `${page.path}` : undefined,
        backLink: `/${paths.website}/${paths.websitePages}`,
        sideElements: page && draft && (
          <div className="flex flex-wrap items-center gap-2">
            {dirty && (
              <Badge color="orange" variant="light">
                {translate("Unsaved changes", "تغييرات غير محفوظة")}
              </Badge>
            )}
            {!dirty && page.hasPendingChanges && page.status === "published" && (
              <Badge color="yellow" variant="light">
                {translate("Saved, not yet published", "محفوظة ولم تُنشر بعد")}
              </Badge>
            )}
            {canEdit && (
              <Button variant="light" color="teal" onClick={save} loading={saving} disabled={!dirty}>
                {translate("Save draft", "حفظ المسودة")}
              </Button>
            )}
            {canPublish && (
              <Tooltip
                disabled={!dirty && problems.length === 0}
                label={dirty ? translate("Save first - only saved changes are published.", "احفظ أولًا - يُنشر المحفوظ فقط.") : problems.join("; ")}
                multiline
                w={320}
              >
                <Button color="teal" onClick={() => publish("publish")} loading={publishing} disabled={dirty || problems.length > 0}>
                  {page.status === "published" ? translate("Publish changes", "نشر التغييرات") : translate("Publish", "نشر")}
                </Button>
              </Tooltip>
            )}
          </div>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading page...", "جاري تحميل الصفحة...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Could not load the page", "تعذر تحميل الصفحة")} errorMessage={error} button={{ text: translate("Back to pages", "العودة للصفحات"), onClick: () => navigate(`/${paths.website}/${paths.websitePages}`) }} />
      ) : (
        page &&
        draft && (
          <div className="flex flex-col gap-4">
            {problems.length > 0 && (
              <Alert color="red" variant="light" title={translate("Not publishable yet", "غير قابلة للنشر بعد")}>
                {translate("This page needs: ", "تحتاج هذه الصفحة إلى: ")}
                {problems.join("; ")}.
              </Alert>
            )}
            {draft.pageType === "legacy" && (
              <Alert color="grape" variant="light">
                {translate(
                  "This page's body is written in the website's code. Any field you leave empty keeps the text the website already has; only what you type here replaces it.",
                  "محتوى هذه الصفحة مكتوب في كود الموقع. أي حقل تتركه فارغًا يحتفظ بنص الموقع الحالي، وما تكتبه هنا فقط يستبدله.",
                )}
              </Alert>
            )}

            <Tabs value={tab} onChange={setTab} keepMounted={false}>
              <Tabs.List>
                <Tabs.Tab value="seo">{translate("SEO", "تحسين البحث")}</Tabs.Tab>
                <Tabs.Tab value="page">{translate("Page", "الصفحة")}</Tabs.Tab>
                <Tabs.Tab value="publishing">{translate("Publishing", "النشر")}</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="seo" pt="md">
                <SeoTab draft={draft} locale={locale} setLocale={setLocale} setSeo={setSeo} resolved={resolved} previewError={previewError} readOnly={!canEdit} />
              </Tabs.Panel>

              <Tabs.Panel value="page" pt="md">
                <PageTab draft={draft} setDraft={setDraft} slugs={allSlugs} readOnly={!canEdit} />
              </Tabs.Panel>

              <Tabs.Panel value="publishing" pt="md">
                <PublishingTab page={page} revisions={revisions} canPublish={canPublish} publishing={publishing} onUnpublish={() => publish("unpublish")} onRevert={revert} />
              </Tabs.Panel>
            </Tabs>
          </div>
        )
      )}
    </AdminLayoutBox>
  );
}

function Panel({ title, children, side }: { title: string; children: ReactNode; side?: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-100 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[#0B3D91]">{title}</h3>
        {side}
      </div>
      {children}
    </section>
  );
}

/** "42 / 60" - orange past the recommended length, red past the hard limit or below a minimum. */
function Counter({ value, recommendedMax, min, hardMax }: { value: number; recommendedMax: number; min?: number; hardMax?: number }) {
  const color = hardMax && value > hardMax ? "text-red-600" : value > recommendedMax ? "text-orange-600" : min && value > 0 && value < min ? "text-orange-600" : "text-gray-500";
  return (
    <span className={`text-xs tabular-nums ${color}`} dir="ltr">
      {value} / {recommendedMax}
    </span>
  );
}

function SourceHint({ source, value }: { source?: string; value?: string }) {
  const { translate } = useLanguage();
  if (!source || source === "custom") return null;
  const label = SEO_SOURCE_LABELS[source as keyof typeof SEO_SOURCE_LABELS];
  return (
    <span className="text-xs text-gray-500">
      {label ? translate(label.en, label.ar) : source}
      {value ? `: ${value}` : ""}
    </span>
  );
}

function SeoTab({
  draft,
  locale,
  setLocale,
  setSeo,
  resolved,
  previewError,
  readOnly,
}: {
  draft: Draft;
  locale: WebsiteLocale;
  setLocale: (l: WebsiteLocale) => void;
  setSeo: (patch: Partial<WebsiteSeo>) => void;
  resolved?: ResolvedSeo;
  previewError: string;
  readOnly: boolean;
}) {
  const { translate } = useLanguage();
  const { media } = useWebsiteMedia();
  const sfx = localeSuffix(locale);
  const key = <B extends string>(base: B) => `${base}${sfx}` as `${B}${"Ar" | "En"}`;
  const get = (base: string) => String((draft.seo as Record<string, unknown>)[`${base}${sfx}`] ?? "");
  const set = (base: string, value: string) => setSeo({ [key(base)]: value } as Partial<WebsiteSeo>);
  const dir = locale === "ar" ? "rtl" : "ltr";
  const available = draft.locales.includes(locale);
  const images = media.filter((m) => !m.format || ["jpg", "jpeg", "png", "webp"].includes(m.format.toLowerCase()));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="flex flex-col gap-4">
        <SegmentedControl
          value={locale}
          onChange={(v) => setLocale(v as WebsiteLocale)}
          data={(["ar", "en"] as WebsiteLocale[]).map((l) => ({
            value: l,
            label: `${translate(LOCALE_LABELS[l].en, LOCALE_LABELS[l].ar)}${l === "ar" ? translate(" (default)", " (الافتراضية)") : ""}${draft.locales.includes(l) ? "" : translate(" - off", " - غير مفعلة")}`,
          }))}
          w="fit-content"
        />
        {!available && (
          <Alert color="gray" variant="light">
            {translate(
              "This page has no version in this language (see the Page tab), so nothing here is published.",
              "لا توجد نسخة من هذه الصفحة بهذه اللغة (راجع تبويب الصفحة)، لذا لا يُنشر شيء من هنا.",
            )}
          </Alert>
        )}

        <Panel title={translate("Search result", "نتيجة البحث")}>
          <div className="flex flex-col gap-3">
            <TextInput
              label={translate("SEO title", "عنوان البحث")}
              value={get("title")}
              onChange={(e) => set("title", e.currentTarget.value)}
              maxLength={SEO_LIMITS.title}
              dir={dir}
              disabled={readOnly}
              rightSectionWidth={70}
              rightSection={<Counter value={resolved?.title.length ?? get("title").length} recommendedMax={SEO_RECOMMENDED.titleMax} />}
              description={<SourceHint source={resolved?.titleSource} value={resolved?.titleSource !== "website" ? resolved?.title : undefined} />}
              placeholder={translate("Empty = generated default", "فارغ = الافتراضي المُولّد")}
            />
            <div>
              <Textarea
                label={translate("Meta description", "وصف البحث")}
                value={get("description")}
                onChange={(e) => set("description", e.currentTarget.value)}
                maxLength={SEO_LIMITS.description}
                autosize
                minRows={2}
                dir={dir}
                disabled={readOnly}
                description={<SourceHint source={resolved?.descriptionSource} value={resolved?.descriptionSource !== "website" ? resolved?.description : undefined} />}
              />
              <div className="mt-1 flex justify-end">
                <Counter value={resolved?.description.length ?? get("description").length} recommendedMax={SEO_RECOMMENDED.descriptionMax} min={SEO_RECOMMENDED.descriptionMin} />
              </div>
            </div>
            <TextInput
              label={translate("Canonical URL", "الرابط الأساسي (Canonical)")}
              description={translate(
                "Leave empty for this page's own URL (recommended). Only set it when another URL is the main version of this content.",
                "اتركه فارغًا ليكون رابط الصفحة نفسها (موصى به). لا تضعه إلا إذا كان رابط آخر هو النسخة الأساسية لهذا المحتوى.",
              )}
              value={get("canonical")}
              onChange={(e) => set("canonical", e.currentTarget.value)}
              maxLength={SEO_LIMITS.canonical}
              placeholder={resolved?.url}
              dir="ltr"
              disabled={readOnly}
            />
          </div>
        </Panel>

        <Panel title={translate("Social sharing (Open Graph / X)", "المشاركة على الشبكات (Open Graph / X)")}>
          <div className="flex flex-col gap-3">
            <TextInput
              label={translate("Share title", "عنوان المشاركة")}
              value={get("ogTitle")}
              onChange={(e) => set("ogTitle", e.currentTarget.value)}
              maxLength={SEO_LIMITS.ogTitle}
              dir={dir}
              disabled={readOnly}
              placeholder={translate("Empty = the SEO title", "فارغ = عنوان البحث")}
            />
            <Textarea
              label={translate("Share description", "وصف المشاركة")}
              value={get("ogDescription")}
              onChange={(e) => set("ogDescription", e.currentTarget.value)}
              maxLength={SEO_LIMITS.ogDescription}
              autosize
              minRows={2}
              dir={dir}
              disabled={readOnly}
              placeholder={translate("Empty = the meta description", "فارغ = وصف البحث")}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label={translate("Share image (both languages)", "صورة المشاركة (للغتين)")}
                description={translate("From the Media Library; empty = the page's first image, then the site default", "من مكتبة الوسائط؛ فارغ = أول صورة في الصفحة ثم الافتراضية للموقع")}
                value={images.find((m) => m.url === draft.seo.ogImage?.url)?._id ?? null}
                onChange={(v) => {
                  const m = images.find((x) => x._id === v);
                  setSeo({ ogImage: m ? { url: m.url, publicId: m.publicId } : { url: null, publicId: null } });
                }}
                data={images.map((m) => ({ value: m._id, label: m.altEn || m.altAr || m.publicId }))}
                clearable
                searchable
                disabled={readOnly}
              />
              <Select
                label={translate("X card", "بطاقة X")}
                value={draft.seo.twitterCard || ""}
                onChange={(v) => setSeo({ twitterCard: (v || "") as WebsiteSeo["twitterCard"] })}
                allowDeselect={false}
                disabled={readOnly}
                data={[
                  { value: "", label: translate("Automatic", "تلقائي") },
                  { value: "summary_large_image", label: translate("Large image", "صورة كبيرة") },
                  { value: "summary", label: translate("Summary", "ملخص") },
                ]}
              />
            </div>
          </div>
        </Panel>

        <Panel title={translate("Indexing and breadcrumbs", "الفهرسة ومسار التنقل")}>
          <div className="flex flex-col gap-3">
            <Switch
              checked={!!draft.seo.noindex}
              onChange={(e) => setSeo({ noindex: e.currentTarget.checked })}
              disabled={readOnly}
              label={translate("Hide this page from search engines (noindex)", "إخفاء الصفحة عن محركات البحث (noindex)")}
              description={translate("Also removes it from the sitemap and its language alternates.", "يزيلها أيضًا من خريطة الموقع ومن روابط اللغات البديلة.")}
            />
            <Switch
              checked={!!draft.seo.nofollow}
              onChange={(e) => setSeo({ nofollow: e.currentTarget.checked })}
              disabled={readOnly}
              label={translate("Ask search engines not to follow this page's links (nofollow)", "عدم تتبع روابط الصفحة (nofollow)")}
            />
            <Switch
              checked={draft.seo.showBreadcrumbs !== false}
              onChange={(e) => setSeo({ showBreadcrumbs: e.currentTarget.checked })}
              disabled={readOnly}
              label={translate("Show breadcrumbs", "إظهار مسار التنقل")}
            />
            <TextInput
              label={translate("Breadcrumb label", "اسم الصفحة في مسار التنقل")}
              value={get("breadcrumbLabel")}
              onChange={(e) => set("breadcrumbLabel", e.currentTarget.value)}
              maxLength={SEO_LIMITS.breadcrumbLabel}
              dir={dir}
              disabled={readOnly}
              placeholder={translate("Empty = the page title", "فارغ = عنوان الصفحة")}
            />
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <Panel title={translate("Google preview", "معاينة جوجل")}>
          {previewError ? (
            <Alert color="red" variant="light">
              {previewError}
            </Alert>
          ) : !resolved ? (
            <p className="text-sm text-gray-500">{available ? translate("Generating…", "جاري التوليد…") : translate("No version in this language.", "لا توجد نسخة بهذه اللغة.")}</p>
          ) : (
            <SearchPreview resolved={resolved} legacy={draft.pageType === "legacy"} />
          )}
        </Panel>
        {resolved && <HeadPanel resolved={resolved} />}
      </div>
    </div>
  );
}

function SearchPreview({ resolved, legacy }: { resolved: ResolvedSeo; legacy: boolean }) {
  const { translate } = useLanguage();
  const dir = resolved.locale === "ar" ? "rtl" : "ltr";
  const title = resolved.title || (legacy ? translate("(the website's current title)", "(عنوان الموقع الحالي)") : "");
  const description = resolved.description || (legacy ? translate("(the website's current description)", "(وصف الموقع الحالي)") : "");
  const shown = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  return (
    <div className="rounded-md bg-white p-3 font-[arial,sans-serif] shadow-sm ring-1 ring-gray-100" dir={dir}>
      <div className="truncate text-xs text-[#202124]" dir="ltr">
        {resolved.url || "/"}
      </div>
      <div className="mt-1 text-lg leading-snug text-[#1a0dab]">{shown(title, 62)}</div>
      <div className="mt-1 text-sm leading-relaxed text-[#4d5156]">{shown(description, 162)}</div>
      {!resolved.indexable && (
        <Badge mt="sm" color="gray" variant="light">
          {translate("Hidden from search results", "لن تظهر في نتائج البحث")}
        </Badge>
      )}
    </div>
  );
}

function HeadPanel({ resolved }: { resolved: ResolvedSeo }) {
  const { translate } = useLanguage();
  const rows: [string, ReactNode][] = [
    ["canonical", resolved.canonical || "-"],
    ["robots", resolved.robots],
    [
      "hreflang",
      resolved.alternates.length ? (
        <ul className="flex flex-col gap-0.5">
          {resolved.alternates.map((a) => (
            <li key={a.hreflang}>
              <span className="font-semibold">{a.hreflang}</span> {a.href}
            </li>
          ))}
        </ul>
      ) : (
        translate("none (one language, noindex, or canonical elsewhere)", "لا يوجد (لغة واحدة أو noindex أو رابط أساسي آخر)")
      ),
    ],
    ["og:image", resolved.openGraph.image || "-"],
    [translate("Breadcrumbs", "مسار التنقل"), resolved.breadcrumbs.length ? resolved.breadcrumbs.map((b) => b.name || "…").join(" › ") : "-"],
  ];
  return (
    <Panel title={translate("What the website will output", "ما سيعرضه الموقع")}>
      {resolved.warnings.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {resolved.warnings.map((w) => {
            const l = SEO_WARNING_LABELS[w];
            return (
              <Badge key={w} color={l?.level === "problem" ? "orange" : "gray"} variant="light">
                {l ? translate(l.en, l.ar) : w}
              </Badge>
            );
          })}
        </div>
      )}
      <Table fz="xs" verticalSpacing={4} withRowBorders={false}>
        <Table.Tbody>
          {rows.map(([k, v]) => (
            <Table.Tr key={k}>
              <Table.Td className="w-24 align-top font-mono text-gray-500">{k}</Table.Td>
              <Table.Td className="break-all font-mono" dir="ltr">
                {v}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Panel>
  );
}

function PageTab({ draft, setDraft, slugs, readOnly }: { draft: Draft; setDraft: (fn: (d: Draft | null) => Draft | null) => void; slugs: string[]; readOnly: boolean }) {
  const { translate } = useLanguage();
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  return (
    <div className="grid max-w-3xl gap-4">
      <Panel title={translate("Address and structure", "العنوان والهيكل")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label={translate("Path", "المسار")}
            description={translate("Without the language; changing it changes the page's URL", "بدون اللغة؛ تغييره يغيّر رابط الصفحة")}
            value={draft.path}
            onChange={(e) => set({ path: e.currentTarget.value.toLowerCase() })}
            dir="ltr"
            disabled={readOnly || draft.isHomePage}
          />
          <Select
            label={translate("Parent page (breadcrumbs)", "الصفحة الأم (مسار التنقل)")}
            value={draft.parentSlug}
            onChange={(v) => set({ parentSlug: v })}
            data={slugs}
            clearable
            searchable
            disabled={readOnly}
          />
          <Select
            label={translate("Type", "النوع")}
            value={draft.pageType}
            onChange={(v) => set({ pageType: (v || "managed") as Draft["pageType"] })}
            allowDeselect={false}
            disabled={readOnly}
            data={[
              { value: "managed", label: translate("CMS page (built from sections)", "صفحة نظام (مبنية من الأقسام)") },
              { value: "legacy", label: translate("Website page (body in the website's code)", "صفحة موقع (المحتوى في كود الموقع)") },
            ]}
          />
        </div>
      </Panel>
      <Panel title={translate("Languages", "اللغات")}>
        <Checkbox.Group value={draft.locales} onChange={(v) => v.length && set({ locales: v as WebsiteLocale[] })}>
          <div className="flex flex-col gap-2">
            <Checkbox value="ar" disabled={readOnly} label={translate("Arabic - the site's default language", "العربية - اللغة الافتراضية للموقع")} />
            <Checkbox value="en" disabled={readOnly} label={translate("English", "الإنجليزية")} />
          </div>
        </Checkbox.Group>
        <p className="mt-2 text-xs text-gray-500">
          {translate(
            "Language alternates (hreflang) are only declared between the languages ticked here. A page needs at least one.",
            "روابط اللغات البديلة (hreflang) تُعلن فقط بين اللغات المحددة هنا. تحتاج الصفحة لغة واحدة على الأقل.",
          )}
        </p>
      </Panel>
    </div>
  );
}

function PublishingTab({
  page,
  revisions,
  canPublish,
  publishing,
  onUnpublish,
  onRevert,
}: {
  page: WebsitePage;
  revisions: WebsiteRevision[];
  canPublish: boolean;
  publishing: boolean;
  onUnpublish: () => void;
  onRevert: (id: string) => void;
}) {
  const { language, translate } = useLanguage();
  const fmt = (d: string) => formatCairoDateTime(d, language);
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Panel
        title={translate("Status", "الحالة")}
        side={
          canPublish &&
          page.status === "published" && (
            <Button size="xs" variant="light" color="red" onClick={onUnpublish} loading={publishing}>
              {translate("Unpublish", "إلغاء النشر")}
            </Button>
          )
        }
      >
        <p className="text-sm">
          {page.status === "published"
            ? translate(`Published ${page.publishedAt ? fmt(page.publishedAt) : ""}`, `منشورة ${page.publishedAt ? fmt(page.publishedAt) : ""}`)
            : page.status === "unpublished"
              ? translate("Unpublished - not on the website.", "غير منشورة - ليست على الموقع.")
              : translate("Draft - never published.", "مسودة - لم تُنشر من قبل.")}
        </p>
      </Panel>
      <Panel title={translate("Published versions", "النسخ المنشورة")}>
        {revisions.length === 0 ? (
          <p className="text-sm text-gray-500">{translate("No published versions yet.", "لا توجد نسخ منشورة بعد.")}</p>
        ) : (
          <Table fz="sm" verticalSpacing="xs">
            <Table.Tbody>
              {revisions.map((r) => (
                <Table.Tr key={r._id}>
                  <Table.Td>{fmt(r.publishedAt)}</Table.Td>
                  <Table.Td>{typeof r.publishedBy === "object" ? r.publishedBy?.name : ""}</Table.Td>
                  <Table.Td>{r.label || ""}</Table.Td>
                  <Table.Td className="text-right">
                    {String(page.publishedRevision) === r._id ? (
                      <Badge color="teal" variant="light">
                        {translate("Live", "الحالية")}
                      </Badge>
                    ) : (
                      canPublish && (
                        <Button size="xs" variant="subtle" onClick={() => onRevert(r._id)}>
                          {translate("Restore", "استعادة")}
                        </Button>
                      )
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
