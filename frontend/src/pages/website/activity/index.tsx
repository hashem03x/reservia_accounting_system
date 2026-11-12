import { useEffect, useState } from "react";
import { Alert, Badge, Button, Code, Select, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import Modal from "@/components/ui/modal";
import { WebsiteActivity } from "@/types/website";
import { formatCairoDateTime } from "@/pages/crm/_shared/business-date";
import { useCmsApi } from "../_shared/cms";

// Website Management - Activity: who changed what, when (every mutating action in the module is
// logged server-side). Before/after values of code and tracking settings are only shown to
// website administrators; the server removes them for everyone else.

export const ACTION_LABELS: Record<string, { en: string; ar: string }> = {
  "page.create": { en: "Created page", ar: "أنشأ صفحة" },
  "page.update": { en: "Edited page", ar: "عدّل صفحة" },
  "page.publish": { en: "Published page", ar: "نشر صفحة" },
  "page.unpublish": { en: "Unpublished page", ar: "ألغى نشر صفحة" },
  "page.revert": { en: "Restored a version", ar: "استعاد نسخة" },
  "page.delete": { en: "Deleted page", ar: "حذف صفحة" },
  "page.schedule": { en: "Scheduled publish", ar: "جدول النشر" },
  "page.archive": { en: "Archived page", ar: "أرشف صفحة" },
  "page.restore": { en: "Restored page", ar: "استعاد صفحة" },
  "page.reorder": { en: "Reordered pages", ar: "رتّب الصفحات" },
  "section.create": { en: "Added section", ar: "أضاف قسمًا" },
  "section.update": { en: "Edited section", ar: "عدّل قسمًا" },
  "section.reorder": { en: "Reordered sections", ar: "رتّب الأقسام" },
  "section.duplicate": { en: "Duplicated section", ar: "كرر قسمًا" },
  "section.delete": { en: "Deleted section", ar: "حذف قسمًا" },
  "media.upload": { en: "Uploaded file", ar: "رفع ملفًا" },
  "media.update": { en: "Edited file details", ar: "عدّل تفاصيل ملف" },
  "media.replace": { en: "Replaced file", ar: "استبدل ملفًا" },
  "media.delete": { en: "Deleted file", ar: "حذف ملفًا" },
  "navigation.update": { en: "Changed navigation", ar: "عدّل التنقل" },
  "settings.update": { en: "Changed settings", ar: "عدّل الإعدادات" },
  "integration.update": { en: "Changed integrations", ar: "عدّل التكاملات" },
  "customCode.create": { en: "Added custom code", ar: "أضاف كودًا مخصصًا" },
  "customCode.update": { en: "Changed custom code", ar: "عدّل كودًا مخصصًا" },
  "customCode.delete": { en: "Deleted custom code", ar: "حذف كودًا مخصصًا" },
  "deploy.preview": { en: "Requested preview build", ar: "طلب بناء معاينة" },
  "deploy.publish": { en: "Updated live website", ar: "حدّث الموقع" },
  "preview.create": { en: "Opened a draft preview", ar: "فتح معاينة مسودة" },
};

const TARGETS = ["WebsitePage", "WebsiteSection", "WebsiteMedia", "WebsiteNavigation", "WebsiteSettings", "WebsiteIntegration", "WebsiteCustomCode"];
const TARGET_LABELS: Record<string, { en: string; ar: string }> = {
  WebsitePage: { en: "Pages", ar: "الصفحات" },
  WebsiteSection: { en: "Sections", ar: "الأقسام" },
  WebsiteMedia: { en: "Media", ar: "الوسائط" },
  WebsiteNavigation: { en: "Navigation", ar: "التنقل" },
  WebsiteSettings: { en: "Settings", ar: "الإعدادات" },
  WebsiteIntegration: { en: "Integrations", ar: "التكاملات" },
  WebsiteCustomCode: { en: "Custom code", ar: "الكود المخصص" },
};

export default function WebsiteActivityPage() {
  const { language, translate } = useLanguage();
  const { call } = useCmsApi();
  useDocumentTitle(`${translate("Activity", "النشاط")} | Reservia Website`);
  const [rows, setRows] = useState<WebsiteActivity[]>([]);
  const [targetType, setTargetType] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<WebsiteActivity | null>(null);

  async function load() {
    setLoading(true);
    const r = await call<WebsiteActivity[]>({ url: "website/activity", params: { limit: 50, page, ...(targetType ? { targetType } : {}) } }, { silent: true });
    if (r) {
      setRows(r.data);
      setPages((r.paginationResult as { numberOfPages?: number })?.numberOfPages || 1);
      setError("");
    } else setError(translate("Could not load the activity log.", "تعذر تحميل سجل النشاط."));
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, targetType]);

  return (
    <AdminLayoutBox header={{ title: translate("Activity", "النشاط"), subTitle: translate("Every change made in Website Management.", "كل تغيير تم في إدارة الموقع.") }}>
      <div className="flex flex-col gap-3">
        <Select
          label={translate("Area", "القسم")}
          w={220}
          value={targetType}
          onChange={(v) => {
            setTargetType(v || "");
            setPage(1);
          }}
          allowDeselect={false}
          data={[{ value: "", label: translate("Everything", "الكل") }, ...TARGETS.map((t) => ({ value: t, label: translate(TARGET_LABELS[t].en, TARGET_LABELS[t].ar) }))]}
        />
        {loading ? (
          <LoadingSection message={translate("Loading...", "جاري التحميل...")} />
        ) : error ? (
          <ErrorSection errorTitle={translate("Could not load", "تعذر التحميل")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
        ) : rows.length === 0 ? (
          <Alert color="gray" variant="light">
            {translate("No activity yet.", "لا يوجد نشاط بعد.")}
          </Alert>
        ) : (
          <>
            <Table fz="sm" verticalSpacing="xs" data-testid="activity-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{translate("When", "متى")}</Table.Th>
                  <Table.Th>{translate("Who", "من")}</Table.Th>
                  <Table.Th>{translate("What", "ماذا")}</Table.Th>
                  <Table.Th>{translate("Item", "العنصر")}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r._id}>
                    <Table.Td className="whitespace-nowrap text-xs">{formatCairoDateTime(r.createdAt, language)}</Table.Td>
                    <Table.Td>{r.actorName}</Table.Td>
                    <Table.Td>
                      <Badge variant="light">{ACTION_LABELS[r.action] ? translate(ACTION_LABELS[r.action].en, ACTION_LABELS[r.action].ar) : r.action}</Badge>
                    </Table.Td>
                    <Table.Td className="max-w-[320px] truncate">{r.targetLabel || "-"}</Table.Td>
                    <Table.Td>
                      {(r.before != null || r.after != null || r.redacted) && (
                        <Button size="xs" variant="subtle" onClick={() => setOpen(r)}>
                          {translate("Details", "التفاصيل")}
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {pages > 1 && (
              <div className="flex items-center justify-end gap-2">
                <Button size="xs" variant="default" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  {translate("Previous", "السابق")}
                </Button>
                <span className="text-sm">
                  {page} / {pages}
                </span>
                <Button size="xs" variant="default" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  {translate("Next", "التالي")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <Modal opened={!!open} onClose={() => setOpen(null)} title={translate("Change details", "تفاصيل التغيير")} size="xl">
        {open?.redacted ? (
          <Alert color="gray">{translate("Details of code and tracking changes are visible to website administrators only.", "تفاصيل تغييرات الكود والتتبع متاحة لمسؤولي الموقع فقط.")}</Alert>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold text-gray-500">{translate("Before", "قبل")}</div>
              <Code block className="max-h-[60vh] overflow-auto text-xs" dir="ltr">
                {JSON.stringify(open?.before ?? null, null, 2)}
              </Code>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-gray-500">{translate("After", "بعد")}</div>
              <Code block className="max-h-[60vh] overflow-auto text-xs" dir="ltr">
                {JSON.stringify(open?.after ?? null, null, 2)}
              </Code>
            </div>
          </div>
        )}
      </Modal>
    </AdminLayoutBox>
  );
}
