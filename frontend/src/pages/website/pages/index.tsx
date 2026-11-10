import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Badge, Button, Checkbox, Select, Table, TextInput, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useWebsitePages from "@/hooks/useWebsitePages";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { notifyError, notifySuccess } from "@/utils/helpers/notifiers";
import paths from "@/utils/constants/paths";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import Modal from "@/components/ui/modal";
import { hasWebsiteCapability, SeoAuditEntry, WebsiteLocale, WebsitePageStatus, WebsiteRole } from "@/types/website";
import { LOCALE_LABELS, SEO_WARNING_LABELS } from "../_shared/seo-labels";

// Website Management - Pages & SEO list. One row per CMS page with its publish state and the SEO
// health of its CURRENT DRAFT (GET /website/pages/seo-audit - the backend resolver, so what is
// flagged here is exactly what the website would render). Filters for the SEO checks editors work
// through: missing title/description, duplicates, not publishable yet.

const STATUS_BADGE: Record<WebsitePageStatus, { color: string; en: string; ar: string }> = {
  published: { color: "teal", en: "Published", ar: "منشورة" },
  unpublished: { color: "gray", en: "Unpublished", ar: "غير منشورة" },
  never_published: { color: "yellow", en: "Draft", ar: "مسودة" },
};

type Filter = "all" | "problems" | "missing" | "duplicates" | "blocked";

export default function WebsitePages() {
  const { language, translate } = useLanguage();
  const navigate = useNavigate();
  const privateRequest = usePrivateRequest();
  const { systems } = useSystemAccess();
  const role = systems?.WEBSITE?.role as WebsiteRole | null | undefined;
  const canEdit = hasWebsiteCapability(role, "edit");
  useDocumentTitle(`${translate("Pages & SEO", "الصفحات وتحسين البحث")} | Reservia Website`);

  const { pages, loading, error, reload, createPage } = useWebsitePages();
  const [audit, setAudit] = useState<Record<string, SeoAuditEntry>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [createOpened, createModal] = useDisclosure(false);

  async function loadAudit() {
    try {
      const res = await privateRequest({ url: "website/pages/seo-audit", language });
      setAudit(Object.fromEntries((res.data.pages as SeoAuditEntry[]).map((p) => [p.pageId, p])));
    } catch (err) {
      notifyError({ language, message: (err as Error)?.message || translate("Could not check SEO", "تعذر فحص تحسين البحث") });
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

  return (
    <AdminLayoutBox
      header={{
        title: translate("Pages & SEO", "الصفحات وتحسين البحث"),
        subTitle: translate(
          "Each page's search title, description, canonical URL, languages and publishing. Changes reach the website only when the page is published.",
          "عنوان كل صفحة في البحث ووصفها ورابطها الأساسي ولغاتها ونشرها. لا تصل التغييرات إلى الموقع إلا عند نشر الصفحة.",
        ),
        sideElements: canEdit && (
          <Button color="teal" onClick={createModal.open}>
            {translate("New page", "صفحة جديدة")}
          </Button>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading pages...", "جاري تحميل الصفحات...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Could not load pages", "تعذر تحميل الصفحات")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: reload }} />
      ) : pages.length === 0 ? (
        <Alert color="blue" variant="light" title={translate("No pages yet", "لا توجد صفحات بعد")}>
          {translate(
            "The website's existing pages can be registered here in one step with the db:seed-website-pages script (it creates them as unpublished drafts that keep the website's current text). You can also add a page with New page.",
            "يمكن تسجيل صفحات الموقع الحالية هنا بخطوة واحدة عبر سكربت db:seed-website-pages (ينشئها كمسودات غير منشورة تحتفظ بنص الموقع الحالي). ويمكنك أيضًا إضافة صفحة من زر صفحة جديدة.",
          )}
        </Alert>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label={translate("Show", "عرض")}
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
            <span className="pb-2 text-sm text-gray-500">
              {translate(`${rows.length} of ${pages.length} pages`, `${rows.length} من ${pages.length} صفحة`)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <Table verticalSpacing="sm" fz="sm" miw={860} highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{translate("Page", "الصفحة")}</Table.Th>
                  <Table.Th>{translate("Type", "النوع")}</Table.Th>
                  <Table.Th>{translate("Languages", "اللغات")}</Table.Th>
                  <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                  <Table.Th>{translate("SEO check (draft)", "فحص تحسين البحث (المسودة)")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((p) => {
                  const a = audit[p._id];
                  const status = STATUS_BADGE[p.status];
                  return (
                    <Table.Tr key={p._id} className="cursor-pointer" onClick={() => navigate(`/${paths.website}/${paths.websitePages}/${p._id}`)}>
                      <Table.Td>
                        <div className="font-medium">{p.slug}</div>
                        <div className="font-mono text-xs text-gray-500" dir="ltr">
                          {p.path}
                        </div>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip
                          label={
                            p.pageType === "legacy"
                              ? translate("The page body is written in the website's code; the CMS manages its SEO.", "محتوى الصفحة مكتوب في كود الموقع؛ ويدير النظام تحسين البحث لها.")
                              : translate("The page body is built from CMS sections.", "محتوى الصفحة مبني من أقسام النظام.")
                          }
                        >
                          <Badge variant="light" color={p.pageType === "legacy" ? "grape" : "blue"}>
                            {p.pageType === "legacy" ? translate("Website page", "صفحة الموقع") : translate("CMS page", "صفحة النظام")}
                          </Badge>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>{(p.locales || []).map((l) => translate(LOCALE_LABELS[l].en, LOCALE_LABELS[l].ar)).join(" + ")}</Table.Td>
                      <Table.Td>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge color={status.color} variant="light">
                            {translate(status.en, status.ar)}
                          </Badge>
                          {p.seo?.noindex && (
                            <Badge color="gray" variant="outline">
                              noindex
                            </Badge>
                          )}
                        </div>
                      </Table.Td>
                      <Table.Td>{a ? <AuditCell entry={a} /> : <span className="text-gray-400">…</span>}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </div>
        </div>
      )}

      <CreatePageModal
        opened={createOpened}
        onClose={createModal.close}
        parents={pages.map((p) => p.slug)}
        onCreate={async (input) => {
          const page = await createPage(input);
          notifySuccess({ language, message: translate("Page created", "تم إنشاء الصفحة") });
          navigate(`/${paths.website}/${paths.websitePages}/${page._id}`);
        }}
      />
    </AdminLayoutBox>
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
  onCreate: (input: { slug: string; path: string; pageType: string; parentSlug: string | null; locales: WebsiteLocale[] }) => Promise<void>;
}) {
  const { language, translate } = useLanguage();
  const [slug, setSlug] = useState("");
  const [path, setPath] = useState("/");
  const [pageType, setPageType] = useState("managed");
  const [parentSlug, setParentSlug] = useState<string | null>(null);
  const [locales, setLocales] = useState<WebsiteLocale[]>(["ar", "en"]);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await onCreate({ slug: slug.trim(), path: path.trim(), pageType, parentSlug, locales });
      onClose();
    } catch (err) {
      notifyError({ language, message: (err as Error)?.message || translate("Could not create the page", "تعذر إنشاء الصفحة") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={translate("New page", "صفحة جديدة")} size="md">
      <div className="flex flex-col gap-3">
        <TextInput
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
            { value: "legacy", label: translate("Website page (body in the website's code)", "صفحة موقع (المحتوى في كود الموقع)") },
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
          <Button color="teal" loading={saving} disabled={!slug.trim() || !path.trim() || locales.length === 0} onClick={submit}>
            {translate("Create", "إنشاء")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
