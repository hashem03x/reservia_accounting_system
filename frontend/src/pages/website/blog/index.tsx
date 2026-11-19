import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ActionIcon, Alert, Badge, Button, Menu, Table, Tabs, TextInput } from "@mantine/core";
import { useDebouncedValue, useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useWebsiteBlogPosts from "@/hooks/useWebsiteBlogPosts";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { notifyError, notifySuccess } from "@/utils/helpers/notifiers";
import paths from "@/utils/constants/paths";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import Modal from "@/components/ui/modal";
import { WebsiteDisplayStatus, WebsiteBlogPost } from "@/types/website";
import { formatCairoDateTime } from "@/pages/crm/_shared/business-date";
import { errorMessage, useConfirm, useWebsiteRole } from "../_shared/cms";

// Website Management - Blog. Mirrors pages/index.tsx's structure (status tabs, search, row-action
// Menu with confirm-gated destructive actions). No manual reorder (posts sort by publish date) and
// no duplicate (not asked for) - see the plan's explicit scope note.

const STATUS_BADGE: Record<WebsiteDisplayStatus, { color: string; en: string; ar: string }> = {
  published: { color: "teal", en: "Published", ar: "منشور" },
  draft: { color: "yellow", en: "Draft", ar: "مسودة" },
  scheduled: { color: "blue", en: "Scheduled", ar: "مجدول" },
  archived: { color: "gray", en: "Archived", ar: "مؤرشف" },
};

type StatusTab = "active" | "draft" | "published" | "scheduled" | "archived";

export default function WebsiteBlogPosts() {
  const { language, translate } = useLanguage();
  const navigate = useNavigate();
  const privateRequest = usePrivateRequest();
  const confirm = useConfirm();
  const { can } = useWebsiteRole();
  const canEdit = can("edit");
  const canPublish = can("publish");
  useDocumentTitle(`${translate("Blog", "المقالات")} | Reservia Website`);

  const [statusTab, setStatusTab] = useState<StatusTab>("active");
  const [q, setQ] = useState("");
  const [debouncedQ] = useDebouncedValue(q, 300);
  const { posts, loading, error, reload } = useWebsiteBlogPosts({ status: statusTab === "active" ? undefined : statusTab, q: debouncedQ });
  const [createOpened, createModal] = useDisclosure(false);
  const [busy, setBusy] = useState(false);

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

  async function preview(p: WebsiteBlogPost) {
    const win = window.open("", "_blank");
    try {
      const res = await privateRequest({ url: `website/blog-posts/${p._id}/preview-token`, method: "POST", data: { lang: p.locales?.[0] || "ar" }, language });
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

  const title = (p: WebsiteBlogPost) => translate(p.titleEn || p.titleAr || p.slug, p.titleAr || p.titleEn || p.slug);

  async function archive(p: WebsiteBlogPost) {
    const ok = await confirm({
      title: translate("Archive this post?", "أرشفة هذا المقال؟"),
      message: translate("It is removed from the website and the sitemap. It can be restored later.", "سيُزال من الموقع وخريطة الموقع. يمكن استعادته لاحقًا."),
      confirmLabel: translate("Archive", "أرشفة"),
      danger: true,
    });
    if (ok) act(() => privateRequest({ url: `website/blog-posts/${p._id}/archive`, method: "POST", language }), translate("Post archived.", "تمت أرشفة المقال."));
  }

  async function remove(p: WebsiteBlogPost) {
    const live = p.status === "published";
    const ok = await confirm({
      title: translate("Delete this post?", "حذف هذا المقال؟"),
      message: translate(
        `"${title(p)}" will be removed${live ? " from the dashboard and the live website" : ""}. Published history is kept for auditing.`,
        `سيُحذف "${title(p)}"${live ? " من لوحة التحكم والموقع" : ""}. يُحتفظ بسجل النشر للتدقيق.`,
      ),
      confirmLabel: translate("Delete", "حذف"),
      danger: true,
    });
    if (ok) act(() => privateRequest({ url: `website/blog-posts/${p._id}`, method: "DELETE", language }), translate("Post deleted.", "تم حذف المقال."));
  }

  return (
    <AdminLayoutBox
      header={{
        title: translate("Blog", "المقالات"),
        subTitle: translate(
          "Create and manage blog posts. Changes reach the website only when a post is published.",
          "أنشئ المقالات وأدرها. لا تصل التغييرات إلى الموقع إلا عند نشر المقال.",
        ),
        sideElements: canEdit && (
          <Button color="teal" onClick={createModal.open} data-testid="new-blog-post">
            {translate("New post", "مقال جديد")}
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
          <TextInput label={translate("Search", "بحث")} placeholder={translate("Title, slug or category", "العنوان أو المعرّف أو التصنيف")} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={280} data-testid="blog-search" />
          {!loading && <span className="pb-2 text-sm text-gray-500">{translate(`${posts.length} posts`, `${posts.length} مقال`)}</span>}
        </div>

        {loading ? (
          <LoadingSection message={translate("Loading posts...", "جاري تحميل المقالات...")} />
        ) : error ? (
          <ErrorSection errorTitle={translate("Could not load posts", "تعذر تحميل المقالات")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: reload }} />
        ) : posts.length === 0 ? (
          <Alert color="blue" variant="light" title={debouncedQ || statusTab !== "active" ? translate("No matching posts", "لا توجد مقالات مطابقة") : translate("No posts yet", "لا توجد مقالات بعد")}>
            {debouncedQ || statusTab !== "active"
              ? translate("Try another search or status.", "جرّب بحثًا أو حالة أخرى.")
              : translate(
                  "Create the first post with New post. A new post starts as a private draft - nothing appears on the website until it is published.",
                  "أنشئ أول مقال من زر مقال جديد. يبدأ المقال الجديد كمسودة خاصة - لا يظهر شيء على الموقع حتى يُنشر.",
                )}
          </Alert>
        ) : (
          <div className="overflow-x-auto">
            <Table verticalSpacing="sm" fz="sm" miw={820} highlightOnHover data-testid="blog-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{translate("Post", "المقال")}</Table.Th>
                  <Table.Th>{translate("Category", "التصنيف")}</Table.Th>
                  <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                  <Table.Th>{translate("Published", "تاريخ النشر")}</Table.Th>
                  <Table.Th w={60} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {posts.map((p) => {
                  const status = STATUS_BADGE[p.displayStatus || "draft"];
                  const open = () => navigate(`/${paths.website}/${paths.websiteBlog}/${p._id}`);
                  return (
                    <Table.Tr key={p._id} data-testid="blog-row" data-slug={p.slug}>
                      <Table.Td className="cursor-pointer" onClick={open}>
                        <div className="font-medium">{title(p)}</div>
                        <div className="font-mono text-xs text-gray-500" dir="ltr">
                          /blog/{p.slug}
                        </div>
                      </Table.Td>
                      <Table.Td>{p.category || <span className="text-gray-400">—</span>}</Table.Td>
                      <Table.Td>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge color={status.color} variant="light" data-testid="row-status">
                            {translate(status.en, status.ar)}
                          </Badge>
                          {p.displayStatus === "scheduled" && p.scheduledPublishAt && <span className="text-xs text-gray-500">{formatCairoDateTime(p.scheduledPublishAt, language)}</span>}
                        </div>
                      </Table.Td>
                      <Table.Td>{p.publishedAt ? formatCairoDateTime(p.publishedAt, language) : <span className="text-gray-400">—</span>}</Table.Td>
                      <Table.Td>
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" disabled={busy} aria-label={translate("Actions", "إجراءات")} data-testid="blog-actions">
                              ⋯
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item onClick={open}>{canEdit ? translate("Edit", "تحرير") : translate("Open", "فتح")}</Menu.Item>
                            <Menu.Item onClick={() => preview(p)}>{translate("Preview draft", "معاينة المسودة")}</Menu.Item>
                            {canPublish && p.status !== "archived" && (
                              <Menu.Item color="orange" onClick={() => archive(p)}>
                                {translate("Archive", "أرشفة")}
                              </Menu.Item>
                            )}
                            {canPublish && p.status === "archived" && (
                              <Menu.Item onClick={() => act(() => privateRequest({ url: `website/blog-posts/${p._id}/restore`, method: "POST", language }), translate("Post restored as a draft.", "تمت استعادة المقال كمسودة."))}>
                                {translate("Restore", "استعادة")}
                              </Menu.Item>
                            )}
                            {canEdit && (
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

      <CreateBlogPostModal
        opened={createOpened}
        onClose={createModal.close}
        onCreate={async (slug, titleEn, titleAr) => {
          const res = await privateRequest({ url: "website/blog-posts", method: "POST", data: { slug, titleEn, titleAr }, language });
          await reload();
          notifySuccess({ language, message: translate("Post created as a draft", "تم إنشاء المقال كمسودة") });
          navigate(`/${paths.website}/${paths.websiteBlog}/${res.data._id}`);
        }}
      />
    </AdminLayoutBox>
  );
}

function CreateBlogPostModal({ opened, onClose, onCreate }: { opened: boolean; onClose: () => void; onCreate: (slug: string, titleEn: string, titleAr: string) => Promise<void> }) {
  const { language, translate } = useLanguage();
  const [titleEn, setTitleEn] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);

  const slugify = (v: string) => v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

  async function submit() {
    setSaving(true);
    try {
      await onCreate(slug.trim(), titleEn.trim(), titleAr.trim());
      setTitleEn("");
      setTitleAr("");
      setSlug("");
      onClose();
    } catch (err) {
      notifyError({ language, message: errorMessage(err, translate("Could not create the post", "تعذر إنشاء المقال")) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={translate("New post", "مقال جديد")} size="md">
      <div className="flex flex-col gap-3" data-testid="create-blog-form">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label={translate("Title (English)", "العنوان (الإنجليزية)")}
            value={titleEn}
            maxLength={150}
            dir="ltr"
            data-testid="new-blog-title-en"
            onChange={(e) => {
              const v = e.currentTarget.value;
              const prevAuto = slugify(titleEn);
              setTitleEn(v);
              if (!slug || slug === prevAuto) setSlug(slugify(v));
            }}
          />
          <TextInput label={translate("Title (Arabic)", "العنوان (العربية)")} value={titleAr} maxLength={150} dir="rtl" data-testid="new-blog-title-ar" onChange={(e) => setTitleAr(e.currentTarget.value)} />
        </div>
        <TextInput
          data-testid="new-blog-slug"
          label={translate("Slug", "المعرّف")}
          description={translate("Lowercase letters, numbers and hyphens - the post's URL is /blog/<slug>", "حروف إنجليزية صغيرة وأرقام وشرطات - رابط المقال هو /blog/<slug>")}
          value={slug}
          onChange={(e) => setSlug(e.currentTarget.value.toLowerCase())}
          dir="ltr"
          required
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="default" onClick={onClose}>
            {translate("Cancel", "إلغاء")}
          </Button>
          <Button color="teal" loading={saving} disabled={!slug.trim()} onClick={submit} data-testid="create-blog-submit">
            {translate("Create", "إنشاء")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
