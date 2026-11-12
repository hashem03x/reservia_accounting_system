import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ActionIcon, Alert, Badge, Button, Checkbox, Menu, Select, Table, Tabs, TextInput, Tooltip } from "@mantine/core";
import { useDebouncedValue, useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useWebsitePages from "@/hooks/useWebsitePages";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { notifyError, notifySuccess } from "@/utils/helpers/notifiers";
import paths from "@/utils/constants/paths";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import Modal from "@/components/ui/modal";
import { SeoAuditEntry, WebsiteDisplayStatus, WebsiteLocale, WebsitePage } from "@/types/website";
import { formatCairoDateTime } from "@/pages/crm/_shared/business-date";
import { LOCALE_LABELS, SEO_WARNING_LABELS } from "../_shared/seo-labels";
import { errorMessage, useConfirm, useWebsiteRole } from "../_shared/cms";

// Website Management - Pages. Every CMS page with its status (Draft / Published / Scheduled /
// Archived), languages and the SEO health of its CURRENT DRAFT (GET /website/pages/seo-audit -
// the backend resolver, so what is flagged here is exactly what the website would render). Row
// actions: open, preview, duplicate, archive/restore, delete (each destructive one confirmed), and
// up/down ordering. Every action is re-checked by the server against the user's Website role.

const STATUS_BADGE: Record<WebsiteDisplayStatus, { color: string; en: string; ar: string }> = {
  published: { color: "teal", en: "Published", ar: "منشورة" },
  draft: { color: "yellow", en: "Draft", ar: "مسودة" },
  scheduled: { color: "blue", en: "Scheduled", ar: "مجدولة" },
  archived: { color: "gray", en: "Archived", ar: "مؤرشفة" },
};

type Filter = "all" | "problems" | "missing" | "duplicates" | "blocked";
type StatusTab = "active" | "draft" | "published" | "scheduled" | "archived";

export default function WebsitePages() {
  const { language, translate } = useLanguage();
  const navigate = useNavigate();
  const privateRequest = usePrivateRequest();
  const confirm = useConfirm();
  const { can } = useWebsiteRole();
  const canEdit = can("edit");
  const canPublish = can("publish");
  useDocumentTitle(`${translate("Pages", "الصفحات")} | Reservia Website`);

  const [statusTab, setStatusTab] = useState<StatusTab>("active");
  const [q, setQ] = useState("");
  const [debouncedQ] = useDebouncedValue(q, 300);
  const { pages, loading, error, reload, createPage, duplicatePage, reorderPages } = useWebsitePages({ status: statusTab === "active" ? undefined : statusTab, q: debouncedQ });
  const [audit, setAudit] = useState<Record<string, SeoAuditEntry>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [createOpened, createModal] = useDisclosure(false);
  const [duplicating, setDuplicating] = useState<WebsitePage | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadAudit() {
    try {
      const res = await privateRequest({ url: "website/pages/seo-audit", language });
      setAudit(Object.fromEntries((res.data.pages as SeoAuditEntry[]).map((p) => [p.pageId, p])));
    } catch (err) {
      notifyError({ language, message: errorMessage(err, translate("Could not check SEO", "تعذر فحص تحسين البحث")) });
    }
  }

  useEffect(() => {
    if (!loading && !error) loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, pages.length]);

  const rows = useMemo(() => {
    return pages.filter((p) => {
      const a = audit[p._id];
      if (filter === "all" || !a) return filter === "all";
      const all = Object.values(a.warnings).flat();
      if (filter === "problems") return all.some((w) => SEO_WARNING_LABELS[w]?.level === "problem");
      if (filter === "missing") return all.some((w) => w === "missing_title" || w === "missing_description");
      if (filter === "duplicates") return all.some((w) => w === "duplicate_title" || w === "duplicate_description");
      return a.problems.length > 0;
    });
  }, [pages, audit, filter]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      notifySuccess({ language, message: ok });
      await reload();
    } catch (err) {
      notifyError({ language, message: errorMessage(err, translate("The action failed", "فشل الإجراء")) });
    } finally {
      setBusy(false);
    }
  }

  async function preview(p: WebsitePage) {
    const win = window.open("", "_blank");
    try {
      const res = await privateRequest({ url: `website/pages/${p._id}/preview-token`, method: "POST", data: { lang: p.locales?.[0] || "ar" }, language });
      if (res.data?.previewUrl && win) win.location.href = res.data.previewUrl;
      else {
        win?.close();
        notifyError({ language, message: translate("Previews need the public website address - set it in Website Settings.", "تحتاج المعاينة إلى عنوان الموقع العام - اضبطه في إعدادات الموقع.") });
      }
    } catch (err) {
      win?.close();
      notifyError({ language, message: errorMessage(err, translate("Could not create the preview", "تعذر إنشاء المعاينة")) });
    }
  }

  const move = (id: string, d: number) => {
    const ids = pages.map((p) => p._id);
    const i = ids.indexOf(id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    act(() => reorderPages(ids), translate("Order saved.", "تم حفظ الترتيب."));
  };
  const canReorder = canEdit && statusTab === "active" && !debouncedQ && filter === "all";

  const title = (p: WebsitePage) => translate(p.titleEn || p.titleAr || p.slug, p.titleAr || p.titleEn || p.slug);

  async function archive(p: WebsitePage) {
    const ok = await confirm({
      title: translate("Archive this page?", "أرشفة هذه الصفحة؟"),
      message: translate("It is removed from the website, its menus and the sitemap. It can be restored later.", "ستُزال من الموقع وقوائمه وخريطة الموقع. يمكن استعادتها لاحقًا."),
      confirmLabel: translate("Archive", "أرشفة"),
      danger: true,
    });
    if (ok) act(() => privateRequest({ url: `website/pages/${p._id}/archive`, method: "POST", language }), translate("Page archived.", "تمت أرشفة الصفحة."));
  }

  async function remove(p: WebsitePage) {
    const live = p.status === "published";
    const ok = await confirm({
      title: translate("Delete this page?", "حذف هذه الصفحة؟"),
      message: translate(
        `"${title(p)}" will be removed${live ? " from the dashboard and the live website" : ""}. Published history is kept for auditing.`,
        `ستُحذف "${title(p)}"${live ? " من لوحة التحكم والموقع" : ""}. يُحتفظ بسجل النشر للتدقيق.`,
      ),
      confirmLabel: translate("Delete", "حذف"),
      danger: true,
    });
    if (ok) act(() => privateRequest({ url: `website/pages/${p._id}`, method: "DELETE", language }), translate("Page deleted.", "تم حذف الصفحة."));
  }

  return (
    <AdminLayoutBox
      header={{
        title: translate("Pages", "الصفحات"),
        subTitle: translate(
          "Create and organise the website's pages, build their content and manage their SEO. Changes reach the website only when a page is published.",
          "أنشئ صفحات الموقع ونظّمها وابنِ محتواها وأدر تحسين البحث لها. لا تصل التغييرات إلى الموقع إلا عند نشر الصفحة.",
        ),
        sideElements: canEdit && (
          <Button color="teal" onClick={createModal.open} data-testid="new-page">
            {translate("New page", "صفحة جديدة")}
          </Button>
        ),
      }}
    >
      <div className="flex flex-col gap-3">
        <Tabs value={statusTab} onChange={(v) => setStatusTab((v as StatusTab) || "active")}>
          <Tabs.List>
            <Tabs.Tab value="active">{translate("All", "الكل")}</Tabs.Tab>
            <Tabs.Tab value="draft">{translate("Drafts", "المسودات")}</Tabs.Tab>
            <Tabs.Tab value="published">{translate("Published", "المنشورة")}</Tabs.Tab>
            <Tabs.Tab value="scheduled">{translate("Scheduled", "المجدولة")}</Tabs.Tab>
            <Tabs.Tab value="archived">{translate("Archived", "المؤرشفة")}</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <div className="flex flex-wrap items-end gap-3">
          <TextInput label={translate("Search", "بحث")} placeholder={translate("Title, slug or path", "العنوان أو المعرّف أو المسار")} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={280} data-testid="pages-search" />
          <Select
            label={translate("SEO check", "فحص تحسين البحث")}
            value={filter}
            onChange={(v) => setFilter((v as Filter) || "all")}
            allowDeselect={false}
            w={260}
            data={[
              { value: "all", label: translate("All pages", "كل الصفحات") },
              { value: "problems", label: translate("Pages with SEO problems", "صفحات بها مشاكل") },
              { value: "missing", label: translate("Missing title or description", "بدون عنوان أو وصف") },
              { value: "duplicates", label: translate("Duplicate title or description", "عنوان أو وصف مكرر") },
              { value: "blocked", label: translate("Cannot be published yet", "لا يمكن نشرها بعد") },
            ]}
          />
          {!loading && (
            <span className="pb-2 text-sm text-gray-500">
              {translate(`${rows.length} of ${pages.length} pages`, `${rows.length} من ${pages.length} صفحة`)}
            </span>
          )}
        </div>

        {loading ? (
          <LoadingSection message={translate("Loading pages...", "جاري تحميل الصفحات...")} />
        ) : error ? (
          <ErrorSection errorTitle={translate("Could not load pages", "تعذر تحميل الصفحات")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: reload }} />
        ) : pages.length === 0 ? (
          <Alert color="blue" variant="light" title={debouncedQ || statusTab !== "active" ? translate("No matching pages", "لا توجد صفحات مطابقة") : translate("No pages yet", "لا توجد صفحات بعد")}>
            {debouncedQ || statusTab !== "active"
              ? translate("Try another search or status.", "جرّب بحثًا أو حالة أخرى.")
              : translate(
                  "Create the first page with New page. A new page starts as a private draft - nothing appears on the website until it is published.",
                  "أنشئ أول صفحة من زر صفحة جديدة. تبدأ الصفحة الجديدة كمسودة خاصة - لا يظهر شيء على الموقع حتى تُنشر.",
                )}
          </Alert>
        ) : (
          <div className="overflow-x-auto">
            <Table verticalSpacing="sm" fz="sm" miw={920} highlightOnHover data-testid="pages-table">
              <Table.Thead>
                <Table.Tr>
                  {canReorder && <Table.Th w={70}>{translate("Order", "الترتيب")}</Table.Th>}
                  <Table.Th>{translate("Page", "الصفحة")}</Table.Th>
                  <Table.Th>{translate("Type", "النوع")}</Table.Th>
                  <Table.Th>{translate("Languages", "اللغات")}</Table.Th>
                  <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                  <Table.Th>{translate("SEO check (draft)", "فحص تحسين البحث (المسودة)")}</Table.Th>
                  <Table.Th w={60} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((p, i) => {
                  const a = audit[p._id];
                  const status = STATUS_BADGE[p.displayStatus || "draft"];
                  const open = () => navigate(`/${paths.website}/${paths.websitePages}/${p._id}`);
                  return (
                    <Table.Tr key={p._id} data-testid="page-row" data-slug={p.slug}>
                      {canReorder && (
                        <Table.Td>
                          <div className="flex">
                            <ActionIcon size="sm" variant="subtle" color="gray" disabled={busy || i === 0} onClick={() => move(p._id, -1)} aria-label="up">
                              ↑
                            </ActionIcon>
                            <ActionIcon size="sm" variant="subtle" color="gray" disabled={busy || i === rows.length - 1} onClick={() => move(p._id, 1)} aria-label="down">
                              ↓
                            </ActionIcon>
                          </div>
                        </Table.Td>
                      )}
                      <Table.Td className="cursor-pointer" onClick={open}>
                        <div className="font-medium">
                          {title(p)}
                          {p.isHomePage && (
                            <Badge ml={6} size="xs" variant="light">
                              {translate("Home", "الرئيسية")}
                            </Badge>
                          )}
                        </div>
                        <div className="font-mono text-xs text-gray-500" dir="ltr">
                          {p.slug} · {p.path}
                        </div>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip
                          label={
                            p.pageType === "legacy"
                              ? translate("The page body is built into the website; the CMS manages its SEO.", "محتوى الصفحة مدمج في الموقع؛ ويدير النظام تحسين البحث لها.")
                              : translate("The page body is built from CMS sections.", "محتوى الصفحة مبني من أقسام النظام.")
                          }
                        >
                          <Badge variant="light" color={p.pageType === "legacy" ? "grape" : "blue"}>
                            {p.pageType === "legacy" ? translate("Built-in page", "صفحة مدمجة") : translate("CMS page", "صفحة النظام")}
                          </Badge>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>{(p.locales || []).map((l) => translate(LOCALE_LABELS[l].en, LOCALE_LABELS[l].ar)).join(" + ")}</Table.Td>
                      <Table.Td>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge color={status.color} variant="light" data-testid="row-status">
                            {translate(status.en, status.ar)}
                          </Badge>
                          {p.displayStatus === "scheduled" && p.scheduledPublishAt && <span className="text-xs text-gray-500">{formatCairoDateTime(p.scheduledPublishAt, language)}</span>}
                          {p.seo?.noindex && (
                            <Badge color="gray" variant="outline">
                              noindex
                            </Badge>
                          )}
                        </div>
                      </Table.Td>
                      <Table.Td>{a ? <AuditCell entry={a} /> : <span className="text-gray-400">…</span>}</Table.Td>
                      <Table.Td>
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" aria-label={translate("Actions", "إجراءات")} data-testid="page-actions">
                              ⋯
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item onClick={open}>{canEdit ? translate("Edit", "تحرير") : translate("Open", "فتح")}</Menu.Item>
                            <Menu.Item onClick={() => preview(p)}>{translate("Preview draft", "معاينة المسودة")}</Menu.Item>
                            {canEdit && <Menu.Item onClick={() => setDuplicating(p)}>{translate("Duplicate", "تكرار")}</Menu.Item>}
                            {canPublish && !p.isHomePage && p.status !== "archived" && (
                              <Menu.Item color="orange" onClick={() => archive(p)}>
                                {translate("Archive", "أرشفة")}
                              </Menu.Item>
                            )}
                            {canPublish && p.status === "archived" && (
                              <Menu.Item onClick={() => act(() => privateRequest({ url: `website/pages/${p._id}/restore`, method: "POST", language }), translate("Page restored as a draft.", "تمت استعادة الصفحة كمسودة."))}>
                                {translate("Restore", "استعادة")}
                              </Menu.Item>
                            )}
                            {canEdit && !p.isHomePage && (
                              <Menu.Item color="red" onClick={() => remove(p)}>
                                {translate("Delete", "حذف")}
                              </Menu.Item>
                            )}
                          </Menu.Dropdown>
                        </Menu>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </div>

      <CreatePageModal
        opened={createOpened}
        onClose={createModal.close}
        parents={pages.map((p) => p.slug)}
        onCreate={async (input) => {
          const page = await createPage(input);
          notifySuccess({ language, message: translate("Page created as a draft", "تم إنشاء الصفحة كمسودة") });
          navigate(`/${paths.website}/${paths.websitePages}/${page._id}`);
        }}
      />
      <DuplicateModal
        page={duplicating}
        onClose={() => setDuplicating(null)}
        onDuplicate={async (slug, path) => {
          if (!duplicating) return;
          const copy = await duplicatePage(duplicating._id, slug, path);
          notifySuccess({ language, message: translate("Page duplicated as a new draft", "تم تكرار الصفحة كمسودة جديدة") });
          navigate(`/${paths.website}/${paths.websitePages}/${copy._id}`);
        }}
      />
    </AdminLayoutBox>
  );
}

function DuplicateModal({ page, onClose, onDuplicate }: { page: WebsitePage | null; onClose: () => void; onDuplicate: (slug: string, path: string) => Promise<void> }) {
  const { language, translate } = useLanguage();
  const [slug, setSlug] = useState("");
  const [path, setPath] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (page) {
      setSlug(`${page.slug}-copy`);
      setPath(`${page.path === "/" ? "" : page.path}-copy`);
    }
  }, [page]);
  return (
    <Modal opened={!!page} onClose={onClose} title={translate("Duplicate page", "تكرار الصفحة")} size="sm">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-600">{translate("The copy has the same sections and SEO, and starts as an unpublished draft.", "تحتوي النسخة على نفس الأقسام وإعدادات البحث، وتبدأ كمسودة غير منشورة.")}</p>
        <TextInput label={translate("New slug", "المعرّف الجديد")} value={slug} onChange={(e) => setSlug(e.currentTarget.value.toLowerCase())} dir="ltr" />
        <TextInput label={translate("New path", "المسار الجديد")} value={path} onChange={(e) => setPath(e.currentTarget.value.toLowerCase())} dir="ltr" />
        <div className="flex justify-end gap-2">
          <Button variant="default" onClick={onClose}>
            {translate("Cancel", "إلغاء")}
          </Button>
          <Button
            color="teal"
            loading={saving}
            disabled={!slug || !path}
            onClick={async () => {
              setSaving(true);
              try {
                await onDuplicate(slug.trim(), path.trim());
                onClose();
              } catch (err) {
                notifyError({ language, message: errorMessage(err, translate("Could not duplicate", "تعذر التكرار")) });
              } finally {
                setSaving(false);
              }
            }}
          >
            {translate("Duplicate", "تكرار")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AuditCell({ entry }: { entry: SeoAuditEntry }) {
  const { translate } = useLanguage();
  const items: { key: string; label: string; problem: boolean }[] = [];
  for (const [locale, warnings] of Object.entries(entry.warnings) as [WebsiteLocale, SeoAuditEntry["warnings"]["ar"]][]) {
    for (const w of warnings || []) {
      const l = SEO_WARNING_LABELS[w];
      if (!l || l.level !== "problem") continue;
      items.push({ key: `${locale}-${w}`, label: `${locale.toUpperCase()}: ${translate(l.en, l.ar)}`, problem: true });
    }
  }
  if (!items.length && !entry.problems.length) {
    return (
      <Badge color="teal" variant="light">
        {translate("OK", "سليم")}
      </Badge>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {entry.problems.length > 0 && (
        <Tooltip label={entry.problems.join("; ")} multiline w={320}>
          <Badge color="red" variant="filled">
            {translate("Not publishable", "غير قابلة للنشر")}
          </Badge>
        </Tooltip>
      )}
      {items.slice(0, 4).map((i) => (
        <Badge key={i.key} color="orange" variant="light">
          {i.label}
        </Badge>
      ))}
      {items.length > 4 && <Badge variant="light">+{items.length - 4}</Badge>}
    </div>
  );
}

function CreatePageModal({
  opened,
  onClose,
  parents,
  onCreate,
}: {
  opened: boolean;
  onClose: () => void;
  parents: string[];
  onCreate: (input: { slug: string; path: string; pageType: string; parentSlug: string | null; locales: WebsiteLocale[]; titleEn: string; titleAr: string; layout: string }) => Promise<void>;
}) {
  const { language, translate } = useLanguage();
  const [titleEn, setTitleEn] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [layout, setLayout] = useState("default");
  const [slug, setSlug] = useState("");
  const [path, setPath] = useState("/");
  const [pageType, setPageType] = useState("managed");
  const [parentSlug, setParentSlug] = useState<string | null>(null);
  const [locales, setLocales] = useState<WebsiteLocale[]>(["ar", "en"]);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await onCreate({ slug: slug.trim(), path: path.trim(), pageType, parentSlug, locales, titleEn: titleEn.trim(), titleAr: titleAr.trim(), layout });
      setTitleEn("");
      setTitleAr("");
      setSlug("");
      setPath("/");
      onClose();
    } catch (err) {
      notifyError({ language, message: (err as Error)?.message || translate("Could not create the page", "تعذر إنشاء الصفحة") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={translate("New page", "صفحة جديدة")} size="md">
      <div className="flex flex-col gap-3" data-testid="create-page-form">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label={translate("Title (English)", "العنوان (الإنجليزية)")}
            value={titleEn}
            maxLength={120}
            dir="ltr"
            data-testid="new-page-title-en"
            onChange={(e) => {
              const v = e.currentTarget.value;
              const auto = v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
              const prev = ((x: string) => x.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60))(titleEn);
              setTitleEn(v);
              if (!slug || slug === prev) {
                setSlug(auto);
                setPath(auto ? "/" + auto : "/");
              }
            }}
          />
          <TextInput label={translate("Title (Arabic)", "العنوان (العربية)")} value={titleAr} maxLength={120} dir="rtl" data-testid="new-page-title-ar" onChange={(e) => setTitleAr(e.currentTarget.value)} />
        </div>
        <TextInput
          data-testid="new-page-slug"
          label={translate("Slug (internal name)", "المعرّف (اسم داخلي)")}
          description={translate("Lowercase letters, numbers and hyphens", "حروف إنجليزية صغيرة وأرقام وشرطات")}
          value={slug}
          onChange={(e) => {
            const v = e.currentTarget.value.toLowerCase();
            setSlug(v);
            if (path === "/" || path === `/${slug}`) setPath(`/${v}`);
          }}
          dir="ltr"
          required
        />
        <TextInput
          data-testid="new-page-path"
          label={translate("Path", "المسار")}
          description={translate("Without the language - /about becomes /ar/about and /en/about", "بدون اللغة - ‎/about تصبح ‎/ar/about و‎/en/about")}
          value={path}
          onChange={(e) => setPath(e.currentTarget.value.toLowerCase())}
          dir="ltr"
          required
        />
        <Select
          label={translate("Type", "النوع")}
          value={pageType}
          onChange={(v) => setPageType(v || "managed")}
          allowDeselect={false}
          data={[
            { value: "managed", label: translate("CMS page (built from sections)", "صفحة نظام (مبنية من الأقسام)") },
            { value: "legacy", label: translate("Built-in website page (CMS manages its SEO)", "صفحة مدمجة في الموقع (يدير النظام تحسين البحث لها)") },
          ]}
        />
        <Select
          label={translate("Layout", "التخطيط")}
          value={layout}
          onChange={(v) => setLayout(v || "default")}
          allowDeselect={false}
          data={[
            { value: "default", label: translate("Standard (header and footer)", "قياسي (رأس وتذييل)") },
            { value: "landing", label: translate("Landing page (no main menu)", "صفحة هبوط (بدون القائمة الرئيسية)") },
            { value: "full-width", label: translate("Full width sections", "أقسام بعرض كامل") },
          ]}
        />
        <Select
          label={translate("Parent page (breadcrumbs)", "الصفحة الأم (مسار التنقل)")}
          value={parentSlug}
          onChange={setParentSlug}
          clearable
          data={parents}
        />
        <Checkbox.Group label={translate("Languages", "اللغات")} value={locales} onChange={(v) => setLocales(v as WebsiteLocale[])}>
          <div className="mt-1 flex gap-4">
            <Checkbox value="ar" label={translate("Arabic (default)", "العربية (الافتراضية)")} />
            <Checkbox value="en" label={translate("English", "الإنجليزية")} />
          </div>
        </Checkbox.Group>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="default" onClick={onClose}>
            {translate("Cancel", "إلغاء")}
          </Button>
          <Button color="teal" loading={saving} disabled={!slug.trim() || !path.trim() || locales.length === 0} onClick={submit} data-testid="create-page-submit">
            {translate("Create", "إنشاء")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
