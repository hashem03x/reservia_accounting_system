import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Autocomplete, Badge, Button, Checkbox, SegmentedControl, Switch, Table, Tabs, Textarea, TextInput, Tooltip } from "@mantine/core";
import { TagsInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useWebsiteBlogPosts from "@/hooks/useWebsiteBlogPosts";
import handleRequest from "@/utils/helpers/handle-request";
import { notifyError, notifySuccess } from "@/utils/helpers/notifiers";
import paths from "@/utils/constants/paths";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import {
  BlogSeoPreview,
  ResolvedBlogSeo,
  SEO_LIMITS,
  SEO_RECOMMENDED,
  WebsiteBlogPost,
  WebsiteBlogPostRevision,
  WebsiteLocale,
  WebsiteSeo,
  hasWebsiteCapability,
  WebsiteRole,
} from "@/types/website";
import { formatCairoDateTime } from "@/pages/crm/_shared/business-date";
import { useBeforeUnload, useConfirm, errorMessage, Panel } from "../../_shared/cms";
import { ImageField } from "../../_shared/media-picker";
import { LOCALE_LABELS, SEO_WARNING_LABELS, localeSuffix } from "../../_shared/seo-labels";
import RichTextEditor from "../../_shared/rich-text-editor";

// Website Management - one blog post's editor. Mirrors pages/[id]/index.tsx's shape (draft state,
// dirty tracking, debounced live SEO preview, Publishing tab) with a Content tab suited to a blog
// post (title/excerpt/rich body per language, category/tags/author/featured image) instead of a
// sections array.

type Draft = Pick<WebsiteBlogPost, "slug" | "titleEn" | "titleAr" | "excerptEn" | "excerptAr" | "bodyEn" | "bodyAr" | "category" | "tags" | "author" | "featuredImage" | "showRecentSidebar" | "locales"> & { seo: WebsiteSeo };

const toDraft = (p: WebsiteBlogPost): Draft => ({
  slug: p.slug,
  titleEn: p.titleEn || "",
  titleAr: p.titleAr || "",
  excerptEn: p.excerptEn || "",
  excerptAr: p.excerptAr || "",
  bodyEn: p.bodyEn || "",
  bodyAr: p.bodyAr || "",
  category: p.category || "",
  tags: p.tags || [],
  author: { ...p.author },
  featuredImage: p.featuredImage,
  showRecentSidebar: p.showRecentSidebar !== false,
  locales: p.locales?.length ? p.locales : ["ar", "en"],
  seo: { ...p.seo },
});

export default function WebsiteBlogPostEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { language, translate } = useLanguage();
  const { systems } = useSystemAccess();
  const role = systems?.WEBSITE?.role as WebsiteRole | null | undefined;
  const canEdit = hasWebsiteCapability(role, "edit");
  const canPublish = hasWebsiteCapability(role, "publish");

  const { privateRequest, loading, setLoading, error, setError, data: post, setData: setPost } = useDataHandler<WebsiteBlogPost | null>({ initialData: null, initialLoading: true });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<BlogSeoPreview | null>(null);
  const [revisions, setRevisions] = useState<WebsiteBlogPostRevision[]>([]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [tab, setTab] = useState<string | null>("content");
  const [locale, setLocale] = useState<WebsiteLocale>("ar");
  const { fetchCategorySuggestions } = useWebsiteBlogPosts();
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>([]);
  const confirm = useConfirm();

  useDocumentTitle(`${post?.titleEn || post?.titleAr || post?.slug || translate("Post", "مقال")} | Reservia Website`);

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const [res, revs] = await Promise.all([
        privateRequest({ url: `website/blog-posts/${id}`, language }),
        privateRequest({ url: `website/blog-posts/${id}/revisions`, language }),
      ]);
      setPost(res.data);
      setDraft(toDraft(res.data));
      setRevisions(revs.data);
      if (res.data.locales?.length && !res.data.locales.includes(locale)) setLocale(res.data.locales[0]);
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    fetchCategorySuggestions("").then(setCategorySuggestions).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live SEO preview of the unsaved draft, debounced - the SAME resolver the public feed uses.
  const previewSeq = useRef(0);
  useEffect(() => {
    if (!draft || !post) return;
    const seq = ++previewSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await privateRequest({ url: `website/blog-posts/${post._id}/seo-preview`, method: "POST", data: draft, language });
        if (seq === previewSeq.current) setPreview(res.data);
      } catch {
        // The preview is a convenience, not a gate - a failed preview request never blocks editing.
      }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, post?._id]);

  const dirty = useMemo(() => !!post && !!draft && JSON.stringify(toDraft(post)) !== JSON.stringify(draft), [post, draft]);
  useBeforeUnload(dirty);

  async function openPreview() {
    if (!post) return;
    const win = window.open("", "_blank");
    try {
      const res = await privateRequest({ url: `website/blog-posts/${post._id}/preview-token`, method: "POST", data: { lang: locale }, language });
      if (res.data?.previewUrl) {
        if (win) win.location.href = res.data.previewUrl;
        else window.location.assign(res.data.previewUrl);
      } else {
        win?.close();
        notifyError({ language, message: translate("Previews need the public website address - set it in Website Settings.", "تحتاج المعاينة إلى عنوان الموقع العام - اضبطه في إعدادات الموقع.") });
      }
    } catch (err) {
      win?.close();
      notifyError({ language, message: errorMessage(err, translate("Could not create the preview", "تعذر إنشاء المعاينة")) });
    }
  }

  async function lifecycle(action: "archive" | "restore" | "cancel-schedule" | "delete") {
    if (!post) return;
    const prompts = {
      archive: { title: translate("Archive this post?", "أرشفة هذا المقال؟"), message: translate("It is removed from the website and the sitemap. Its content and history are kept and it can be restored.", "سيُزال من الموقع وخريطة الموقع. يُحتفظ بالمحتوى والسجل ويمكن استعادته."), confirmLabel: translate("Archive", "أرشفة"), danger: true },
      restore: { title: translate("Restore this post?", "استعادة هذا المقال؟"), message: translate("It comes back as a draft. Publish it to put it on the website again.", "سيعود كمسودة. انشره ليظهر على الموقع مجددًا."), confirmLabel: translate("Restore", "استعادة") },
      "cancel-schedule": { title: translate("Cancel the scheduled publish?", "إلغاء النشر المجدول؟"), message: translate("Nothing will go live at the scheduled time.", "لن يُنشر شيء في الموعد المحدد."), confirmLabel: translate("Cancel schedule", "إلغاء الجدولة"), danger: true },
      delete: { title: translate("Delete this post?", "حذف هذا المقال؟"), message: translate("The post is removed from the dashboard and, if it is live, from the website. Published history is kept for auditing.", "سيُحذف المقال من لوحة التحكم ومن الموقع إن كان منشورًا. يُحتفظ بسجل النشر للتدقيق."), confirmLabel: translate("Delete post", "حذف المقال"), danger: true },
    } as const;
    if (!(await confirm(prompts[action]))) return;
    setPublishing(true);
    try {
      if (action === "delete") {
        await privateRequest({ url: `website/blog-posts/${post._id}`, method: "DELETE", language });
        notifySuccess({ language, message: translate("Post deleted.", "تم حذف المقال.") });
        navigate(`/${paths.website}/${paths.websiteBlog}`);
        return;
      }
      const url = action === "cancel-schedule" ? `website/blog-posts/${post._id}/schedule` : `website/blog-posts/${post._id}/${action}`;
      const res = await privateRequest({ url, method: action === "cancel-schedule" ? "DELETE" : "POST", data: {}, language });
      notifySuccess({ language, message: res?.message || translate("Done.", "تم.") });
      load();
    } catch (err) {
      notifyError({ language, message: errorMessage(err, translate("The action failed", "فشل الإجراء")) });
    } finally {
      setPublishing(false);
    }
  }

  async function schedulePublish(publishAt: string) {
    if (!post) return;
    setPublishing(true);
    try {
      const res = await privateRequest({ url: `website/blog-posts/${post._id}/schedule`, method: "POST", data: { publishAt: new Date(publishAt).toISOString() }, language });
      notifySuccess({ language, message: res?.message || translate("Scheduled.", "تمت الجدولة.") });
      load();
    } catch (err) {
      notifyError({ language, message: errorMessage(err, translate("Could not schedule", "تعذرت الجدولة")) });
    } finally {
      setPublishing(false);
    }
  }

  async function save() {
    if (!post || !draft) return;
    setSaving(true);
    try {
      const res = await privateRequest({ url: `website/blog-posts/${post._id}`, method: "PATCH", data: draft, language });
      setPost(res.data);
      setDraft(toDraft(res.data));
      notifySuccess({ language, message: translate("Saved. Publish the post to put the changes on the website.", "تم الحفظ. انشر المقال لتظهر التغييرات على الموقع.") });
    } catch (err) {
      notifyError({ language, message: errorMessage(err, translate("Could not save", "تعذر الحفظ")) });
    } finally {
      setSaving(false);
    }
  }

  async function publish(action: "publish" | "unpublish") {
    if (!post) return;
    setPublishing(true);
    try {
      const res = await privateRequest({ url: `website/blog-posts/${post._id}/${action}`, method: "POST", data: {}, language });
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
      notifyError({ language, message: errorMessage(err, translate("Could not publish", "تعذر النشر")) });
    } finally {
      setPublishing(false);
    }
  }

  async function revert(revisionId: string) {
    if (!post) return;
    if (!(await confirm({ title: translate("Restore this version?", "استعادة هذه النسخة؟"), message: translate("The post's draft is replaced with this version and it is published again as a new version.", "تُستبدل مسودة المقال بهذه النسخة وتُنشر من جديد كنسخة جديدة."), confirmLabel: translate("Restore and publish", "استعادة ونشر") }))) return;
    try {
      await privateRequest({ url: `website/blog-posts/${post._id}/revisions/${revisionId}/revert`, method: "POST", language });
      notifySuccess({ language, message: translate("Version restored and republished.", "تمت استعادة النسخة وإعادة نشرها.") });
      load();
    } catch (err) {
      notifyError({ language, message: errorMessage(err, translate("Could not restore", "تعذرت الاستعادة")) });
    }
  }

  if (loading) return <LoadingSection message={translate("Loading post...", "جاري تحميل المقال...")} />;
  if (error || !post || !draft) return <ErrorSection errorTitle={translate("Could not load the post", "تعذر تحميل المقال")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />;

  const setSeo = (patch: Partial<WebsiteSeo>) => setDraft((d) => (d ? { ...d, seo: { ...d.seo, ...patch } } : d));
  const resolved = preview?.[locale];
  const problems = preview?.problems ?? [];
  const readOnly = !canEdit;

  return (
    <AdminLayoutBox
      header={{
        title: post.titleEn || post.titleAr || post.slug,
        subTitle: `/blog/${post.slug}`,
        backLink: `/${paths.website}/${paths.websiteBlog}`,
        sideElements: (
          <div className="flex flex-wrap items-center gap-2">
            {dirty && (
              <Badge color="orange" variant="light">
                {translate("Unsaved changes", "تغييرات غير محفوظة")}
              </Badge>
            )}
            <Button variant="default" size="sm" onClick={openPreview}>
              {translate("Preview draft", "معاينة المسودة")}
            </Button>
            {canEdit && (
              <Button size="sm" loading={saving} disabled={!dirty} onClick={save} data-testid="save-blog-post">
                {translate("Save", "حفظ")}
              </Button>
            )}
            {canPublish && post.status !== "published" && (
              <Tooltip disabled={!dirty && problems.length === 0} label={dirty ? translate("Save first.", "احفظ أولًا.") : problems.join("; ")} multiline w={300}>
                <Button color="teal" size="sm" loading={publishing} disabled={dirty || problems.length > 0} onClick={() => publish("publish")} data-testid="publish-blog-post">
                  {translate("Publish", "نشر")}
                </Button>
              </Tooltip>
            )}
          </div>
        ),
      }}
    >
      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          <Tabs.Tab value="content">{translate("Content", "المحتوى")}</Tabs.Tab>
          <Tabs.Tab value="seo">{translate("SEO", "تحسين البحث")}</Tabs.Tab>
          <Tabs.Tab value="publishing">{translate("Publishing", "النشر")}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="content" pt="md">
          <ContentTab draft={draft} setDraft={setDraft} locale={locale} setLocale={setLocale} readOnly={readOnly} categorySuggestions={categorySuggestions} />
        </Tabs.Panel>
        <Tabs.Panel value="seo" pt="md">
          <SeoTab draft={draft} setSeo={setSeo} locale={locale} setLocale={setLocale} resolved={resolved} readOnly={readOnly} />
        </Tabs.Panel>
        <Tabs.Panel value="publishing" pt="md">
          <PublishingTab post={post} revisions={revisions} canPublish={canPublish} canEdit={canEdit} publishing={publishing} onUnpublish={() => publish("unpublish")} onRevert={revert} onSchedule={schedulePublish} onLifecycle={lifecycle} problems={problems} dirty={dirty} />
        </Tabs.Panel>
      </Tabs>
    </AdminLayoutBox>
  );
}

function ContentTab({
  draft,
  setDraft,
  locale,
  setLocale,
  readOnly,
  categorySuggestions,
}: {
  draft: Draft;
  setDraft: (fn: (d: Draft | null) => Draft | null) => void;
  locale: WebsiteLocale;
  setLocale: (l: WebsiteLocale) => void;
  readOnly: boolean;
  categorySuggestions: string[];
}) {
  const { translate } = useLanguage();
  const suf = localeSuffix(locale);
  const titleKey = `title${suf}` as "titleEn" | "titleAr";
  const excerptKey = `excerpt${suf}` as "excerptEn" | "excerptAr";
  const bodyKey = `body${suf}` as "bodyEn" | "bodyAr";

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Panel title={translate("Languages", "اللغات")}>
        <Checkbox.Group value={draft.locales} onChange={(v) => setDraft((d) => (d ? { ...d, locales: v as WebsiteLocale[] } : d))}>
          <div className="flex gap-4">
            <Checkbox value="ar" label={translate("Arabic", "العربية")} disabled={readOnly} />
            <Checkbox value="en" label={translate("English", "الإنجليزية")} disabled={readOnly} />
          </div>
        </Checkbox.Group>
      </Panel>

      <Panel title={translate("Content", "المحتوى")} side={<SegmentedControl size="xs" value={locale} onChange={(v) => setLocale(v as WebsiteLocale)} data={draft.locales.map((l) => ({ value: l, label: translate(LOCALE_LABELS[l]?.en ?? String(l), LOCALE_LABELS[l]?.ar ?? String(l)) }))} />}>
        <div className="flex flex-col gap-3">
          <TextInput
            label={translate("Title", "العنوان")}
            value={draft[titleKey]}
            maxLength={150}
            dir={locale === "ar" ? "rtl" : "ltr"}
            disabled={readOnly}
            onChange={(e) => setDraft((d) => (d ? { ...d, [titleKey]: e.currentTarget.value } : d))}
            data-testid={`blog-${titleKey}`}
          />
          <Textarea
            label={translate("Short description (shown on cards)", "وصف مختصر (يظهر في البطاقات)")}
            value={draft[excerptKey]}
            maxLength={300}
            minRows={2}
            dir={locale === "ar" ? "rtl" : "ltr"}
            disabled={readOnly}
            onChange={(e) => setDraft((d) => (d ? { ...d, [excerptKey]: e.currentTarget.value } : d))}
            data-testid={`blog-${excerptKey}`}
          />
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{translate("Body", "المحتوى")}</span>
            <RichTextEditor value={draft[bodyKey]} onChange={(html) => setDraft((d) => (d ? { ...d, [bodyKey]: html } : d))} dir={locale === "ar" ? "rtl" : "ltr"} disabled={readOnly} testId={`blog-${bodyKey}`} />
          </div>
        </div>
      </Panel>

      <Panel title={translate("Featured image", "الصورة البارزة")}>
        <ImageField label={translate("Featured image", "الصورة البارزة")} value={draft.featuredImage} onChange={(v) => setDraft((d) => (d ? { ...d, featuredImage: v } : d))} disabled={readOnly} testId="blog-featured-image" />
      </Panel>

      <Panel title={translate("Category and tags", "التصنيف والوسوم")}>
        <div className="flex flex-col gap-3">
          <Autocomplete
            label={translate("Category", "التصنيف")}
            value={draft.category}
            onChange={(v) => setDraft((d) => (d ? { ...d, category: v } : d))}
            data={categorySuggestions}
            disabled={readOnly}
            data-testid="blog-category"
          />
          <TagsInput label={translate("Tags", "الوسوم")} value={draft.tags} onChange={(v) => setDraft((d) => (d ? { ...d, tags: v.slice(0, 10) } : d))} disabled={readOnly} maxTags={10} data-testid="blog-tags" />
        </div>
      </Panel>

      <Panel title={translate("Author", "الكاتب")}>
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label={translate("Name (English)", "الاسم (الإنجليزية)")} value={draft.author.nameEn || ""} dir="ltr" disabled={readOnly} onChange={(e) => setDraft((d) => (d ? { ...d, author: { ...d.author, nameEn: e.currentTarget.value } } : d))} />
            <TextInput label={translate("Name (Arabic)", "الاسم (العربية)")} value={draft.author.nameAr || ""} dir="rtl" disabled={readOnly} onChange={(e) => setDraft((d) => (d ? { ...d, author: { ...d.author, nameAr: e.currentTarget.value } } : d))} />
          </div>
          <ImageField label={translate("Avatar", "الصورة الرمزية")} value={draft.author.avatarUrl ? { url: draft.author.avatarUrl } : null} onChange={(v) => setDraft((d) => (d ? { ...d, author: { ...d.author, avatarUrl: v?.url || null } } : d))} disabled={readOnly} />
        </div>
      </Panel>

      <Panel title={translate("Recent Blogs sidebar", "الشريط الجانبي: المقالات الأخيرة")}>
        <Switch
          label={translate("Show the Recent Blogs sidebar on this article", "عرض شريط المقالات الأخيرة في هذا المقال")}
          checked={draft.showRecentSidebar}
          disabled={readOnly}
          onChange={(e) => setDraft((d) => (d ? { ...d, showRecentSidebar: e.currentTarget.checked } : d))}
        />
        <p className="mt-2 text-xs text-gray-500">{translate("When off, the article uses the full content width.", "عند التعطيل، يستخدم المقال العرض الكامل للمحتوى.")}</p>
      </Panel>
    </div>
  );
}

function Counter({ value, recommendedMax, min }: { value: number; recommendedMax: number; min?: number }) {
  const over = value > recommendedMax;
  const under = min !== undefined && value > 0 && value < min;
  return <span className={`text-xs ${over || under ? "text-orange-600" : "text-gray-400"}`}>{value}/{recommendedMax}</span>;
}

function SeoTab({
  draft,
  setSeo,
  locale,
  setLocale,
  resolved,
  readOnly,
}: {
  draft: Draft;
  setSeo: (patch: Partial<WebsiteSeo>) => void;
  locale: WebsiteLocale;
  setLocale: (l: WebsiteLocale) => void;
  resolved?: ResolvedBlogSeo;
  readOnly: boolean;
}) {
  const { translate } = useLanguage();
  const suf = localeSuffix(locale);
  const seo = draft.seo;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <SegmentedControl value={locale} onChange={(v) => setLocale(v as WebsiteLocale)} data={draft.locales.map((l) => ({ value: l, label: translate(LOCALE_LABELS[l]?.en ?? String(l), LOCALE_LABELS[l]?.ar ?? String(l)) }))} />

      <Panel title={translate("Search appearance", "شكل النتيجة في البحث")}>
        <div className="flex flex-col gap-3">
          <div>
            <TextInput
              label={translate("SEO title", "عنوان تحسين البحث")}
              placeholder={locale === "ar" ? draft.titleAr : draft.titleEn}
              value={(seo[`title${suf}` as "titleEn" | "titleAr"] as string) || ""}
              maxLength={SEO_LIMITS.title}
              dir={locale === "ar" ? "rtl" : "ltr"}
              disabled={readOnly}
              onChange={(e) => setSeo({ [`title${suf}`]: e.currentTarget.value } as Partial<WebsiteSeo>)}
            />
            <Counter value={resolved?.title.length || 0} recommendedMax={SEO_RECOMMENDED.titleMax} />
          </div>
          <div>
            <Textarea
              label={translate("Meta description", "الوصف التعريفي")}
              placeholder={locale === "ar" ? draft.excerptAr : draft.excerptEn}
              value={(seo[`description${suf}` as "descriptionEn" | "descriptionAr"] as string) || ""}
              maxLength={SEO_LIMITS.description}
              minRows={2}
              dir={locale === "ar" ? "rtl" : "ltr"}
              disabled={readOnly}
              onChange={(e) => setSeo({ [`description${suf}`]: e.currentTarget.value } as Partial<WebsiteSeo>)}
            />
            <Counter value={resolved?.description.length || 0} recommendedMax={SEO_RECOMMENDED.descriptionMax} min={SEO_RECOMMENDED.descriptionMin} />
          </div>
          {resolved && (
            <div className="rounded border border-gray-100 bg-gray-50 p-3" dir="ltr">
              <div className="truncate text-sm text-blue-800">{resolved.title}</div>
              <div className="truncate text-xs text-green-700">{resolved.url}</div>
              <div className="text-xs text-gray-600">{resolved.description}</div>
            </div>
          )}
          {resolved?.warnings && resolved.warnings.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {resolved.warnings.map((w) => (
                <Badge key={w} color={SEO_WARNING_LABELS[w]?.level === "problem" ? "red" : "orange"} variant="light">
                  {translate(SEO_WARNING_LABELS[w]?.en || w, SEO_WARNING_LABELS[w]?.ar || w)}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel title={translate("Social sharing image", "صورة المشاركة الاجتماعية")} description={translate("Falls back to the featured image when empty.", "تُستخدم الصورة البارزة عند تركه فارغًا.")}>
        <ImageField label={translate("Share image", "صورة المشاركة")} value={seo.ogImage?.url ? { url: seo.ogImage.url, publicId: seo.ogImage.publicId ?? undefined } : null} onChange={(v) => setSeo({ ogImage: v ? { url: v.url, publicId: v.publicId ?? null } : { url: null, publicId: null } })} disabled={readOnly} />
      </Panel>

      <Panel title={translate("Indexing", "الفهرسة")}>
        <div className="flex flex-col gap-2">
          <Switch label={translate("Hide from search engines (noindex)", "إخفاء عن محركات البحث (noindex)")} checked={!!seo.noindex} disabled={readOnly} onChange={(e) => setSeo({ noindex: e.currentTarget.checked })} />
          <Switch label={translate("Discourage following links on this post (nofollow)", "عدم تتبّع روابط هذا المقال (nofollow)")} checked={!!seo.nofollow} disabled={readOnly} onChange={(e) => setSeo({ nofollow: e.currentTarget.checked })} />
        </div>
      </Panel>
    </div>
  );
}

function PublishingTab({
  post,
  revisions,
  canPublish,
  canEdit,
  publishing,
  onUnpublish,
  onRevert,
  onSchedule,
  onLifecycle,
  problems,
  dirty,
}: {
  post: WebsiteBlogPost;
  revisions: WebsiteBlogPostRevision[];
  canPublish: boolean;
  canEdit: boolean;
  publishing: boolean;
  onUnpublish: () => void;
  onRevert: (id: string) => void;
  onSchedule: (at: string) => void;
  onLifecycle: (action: "archive" | "restore" | "cancel-schedule" | "delete") => void;
  problems: string[];
  dirty: boolean;
}) {
  const { language, translate } = useLanguage();
  const fmt = (d: string) => formatCairoDateTime(d, language);
  const [when, setWhen] = useState("");
  const minLocal = new Date(Date.now() + 2 * 60 * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Panel
        title={translate("Status", "الحالة")}
        side={
          canPublish &&
          post.status === "published" && (
            <Button size="xs" variant="light" color="red" onClick={onUnpublish} loading={publishing}>
              {translate("Unpublish", "إلغاء النشر")}
            </Button>
          )
        }
      >
        <p className="text-sm">
          {post.status === "published"
            ? translate(`Published ${post.publishedAt ? fmt(post.publishedAt) : ""}`, `منشور ${post.publishedAt ? fmt(post.publishedAt) : ""}`)
            : post.status === "archived"
              ? translate("Archived - not on the website.", "مؤرشف - ليس على الموقع.")
              : post.status === "unpublished"
                ? translate("Unpublished - not on the website.", "غير منشور - ليس على الموقع.")
                : translate("Draft - never published.", "مسودة - لم يُنشر من قبل.")}
        </p>
      </Panel>
      {canPublish && post.status !== "archived" && (
        <Panel title={translate("Schedule", "الجدولة")}>
          {post.scheduledPublishAt ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                {translate("The draft as it was when scheduled goes live on ", "تُنشر المسودة كما كانت وقت الجدولة في ")}
                <strong>{fmt(post.scheduledPublishAt)}</strong>.
              </p>
              <Button size="xs" variant="light" color="red" onClick={() => onLifecycle("cancel-schedule")} loading={publishing}>
                {translate("Cancel schedule", "إلغاء الجدولة")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <TextInput type="datetime-local" label={translate("Publish at", "النشر في")} value={when} min={minLocal} onChange={(e) => setWhen(e.currentTarget.value)} data-testid="blog-schedule-at" />
              <Tooltip disabled={!dirty && problems.length === 0} label={dirty ? translate("Save first.", "احفظ أولًا.") : problems.join("; ")} multiline w={300}>
                <Button variant="light" onClick={() => onSchedule(when)} disabled={!when || dirty || problems.length > 0} loading={publishing} data-testid="blog-schedule-publish">
                  {translate("Schedule publish", "جدولة النشر")}
                </Button>
              </Tooltip>
            </div>
          )}
          <p className="mt-2 text-xs text-gray-500">{translate("Scheduling freezes the current saved draft - later edits are not included unless you schedule again.", "الجدولة تثبّت المسودة المحفوظة الحالية - التعديلات اللاحقة لا تُضمَّن إلا إذا أعدت الجدولة.")}</p>
        </Panel>
      )}
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
                    {String(post.publishedRevision) === r._id ? (
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
      {(canPublish || canEdit) && (
        <Panel title={translate("Archive or delete", "الأرشفة أو الحذف")}>
          <div className="flex flex-wrap gap-2">
            {canPublish &&
              (post.status === "archived" ? (
                <Button size="xs" variant="light" onClick={() => onLifecycle("restore")} loading={publishing} data-testid="restore-blog-post">
                  {translate("Restore from archive", "استعادة من الأرشيف")}
                </Button>
              ) : (
                <Button size="xs" variant="light" color="orange" onClick={() => onLifecycle("archive")} loading={publishing} data-testid="archive-blog-post">
                  {translate("Archive", "أرشفة")}
                </Button>
              ))}
            {canEdit && (
              <Button size="xs" variant="light" color="red" onClick={() => onLifecycle("delete")} loading={publishing} data-testid="delete-blog-post">
                {translate("Delete post", "حذف المقال")}
              </Button>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
