import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Badge, Button, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import KpiCard from "@/components/ui/kpi-card";
import ErrorSection from "@/components/ui/sections/error";
import paths from "@/utils/constants/paths";
import { WebsiteOverviewData } from "@/types/website";
import { formatCairoDateTime } from "@/pages/crm/_shared/business-date";
import { formatBytes, Panel, useCmsApi, useConfirm, useWebsiteRole } from "./_shared/cms";
import { ACTION_LABELS } from "./activity";

// Website Management - Overview. Every number comes from GET /website/overview, computed from the
// database on request (page counts by status, sections, media, scheduled publishes, pages that
// cannot be published yet, recent activity) - nothing here is sampled, cached or invented.

const STATUS_LABEL = { published: { en: "Published", ar: "منشورة" }, draft: { en: "Draft", ar: "مسودة" }, scheduled: { en: "Scheduled", ar: "مجدولة" }, archived: { en: "Archived", ar: "مؤرشفة" } } as const;
const TRACKER_LABEL: Record<string, string> = { ga4: "GA4", gtm: "Tag Manager", metaPixel: "Meta Pixel", googleAds: "Google Ads" };

export default function WebsiteOverview() {
  const { language, translate } = useLanguage();
  const navigate = useNavigate();
  const { can } = useWebsiteRole();
  const confirm = useConfirm();
  const { call } = useCmsApi();
  const [data, setData] = useState<WebsiteOverviewData | null>(null);
  const [error, setError] = useState("");
  const [deploying, setDeploying] = useState(false);
  useDocumentTitle(translate("Website Management", "إدارة الموقع الإلكتروني"));

  async function load() {
    const r = await call<WebsiteOverviewData>({ url: "website/overview" }, { silent: true });
    if (r) {
      setData(r.data);
      setError("");
    } else setError(translate("Could not load the overview.", "تعذر تحميل النظرة العامة."));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deploy() {
    if (!(await confirm({ title: translate("Update the live website?", "تحديث الموقع المنشور؟"), message: translate("Rebuilds the public website with all published pages and the current settings, menus, integrations and custom code.", "يعيد بناء الموقع العام بكل الصفحات المنشورة والإعدادات والقوائم والتكاملات والكود الحالي."), confirmLabel: translate("Update website", "تحديث الموقع") }))) return;
    setDeploying(true);
    await call({ url: "website/deploy", method: "POST" }, { success: "server" });
    setDeploying(false);
    load();
  }

  const pagesUrl = `/${paths.website}/${paths.websitePages}`;

  return (
    <AdminLayoutBox
      header={{
        title: translate("Website Management", "إدارة الموقع الإلكتروني"),
        subTitle: translate("Pages, content, media, navigation, SEO and tracking of the Reservia website.", "صفحات موقع رزيرفيا ومحتواه ووسائطه وتنقله وتحسين البحث والتتبع."),
        sideElements: can("publish") && (
          <Button color="teal" variant="light" onClick={deploy} loading={deploying} data-testid="deploy-site">
            {translate("Update live website", "تحديث الموقع المنشور")}
          </Button>
        ),
      }}
    >
      {error ? (
        <ErrorSection errorTitle={translate("Could not load", "تعذر التحميل")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
      ) : (
        <div className="flex flex-col gap-5" data-testid="website-overview">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard loading={!data} label={translate("Pages", "الصفحات")} value={data?.pages.total ?? 0} subValue={translate(`${data?.sections ?? 0} sections`, `${data?.sections ?? 0} قسم`)} />
            <KpiCard loading={!data} label={translate("Published", "منشورة")} value={<span data-testid="kpi-published">{data?.pages.published ?? 0}</span>} />
            <KpiCard loading={!data} label={translate("Drafts", "مسودات")} value={<span data-testid="kpi-drafts">{data?.pages.draft ?? 0}</span>} />
            <KpiCard loading={!data} label={translate("Scheduled", "مجدولة")} value={data?.pages.scheduled ?? 0} />
            <KpiCard loading={!data} label={translate("Archived", "مؤرشفة")} value={data?.pages.archived ?? 0} />
            <KpiCard loading={!data} label={translate("Media files", "ملفات الوسائط")} value={data?.media.files ?? 0} subValue={formatBytes(data?.media.bytes)} />
          </div>

          {data && !data.site.deployConfigured && (
            <Alert color="yellow" variant="light" title={translate("Automatic website updates are not connected", "التحديث التلقائي للموقع غير متصل")}>
              {translate(
                "Publishing saves the content, but the live website is only rebuilt when the hosting rebuild link is configured on the server. Ask your system administrator to connect it.",
                "النشر يحفظ المحتوى، لكن الموقع لا يُعاد بناؤه إلا بعد ضبط رابط إعادة البناء على الخادم. اطلب من مسؤول النظام ربطه.",
              )}
            </Alert>
          )}
          {data && !data.site.previewConfigured && (
            <Alert color="gray" variant="light">
              {translate("Draft previews need the public website address. Set it in Settings → Domain.", "تحتاج معاينة المسودات إلى عنوان الموقع العام. اضبطه في الإعدادات.")}
            </Alert>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={translate("Recently edited", "آخر التعديلات")}>
              {!data ? null : data.recentlyEdited.length === 0 ? (
                <p className="text-sm text-gray-500">{translate("No pages yet.", "لا توجد صفحات بعد.")}</p>
              ) : (
                <Table fz="sm" verticalSpacing={6}>
                  <Table.Tbody>
                    {data.recentlyEdited.map((p) => (
                      <Table.Tr key={p.pageId} className="cursor-pointer" onClick={() => navigate(`${pagesUrl}/${p.pageId}`)}>
                        <Table.Td>{p.title}</Table.Td>
                        <Table.Td>
                          <Badge size="sm" variant="light" color={{ published: "teal", draft: "yellow", scheduled: "blue", archived: "gray" }[p.status]}>
                            {translate(STATUS_LABEL[p.status].en, STATUS_LABEL[p.status].ar)}
                          </Badge>
                        </Table.Td>
                        <Table.Td className="text-xs text-gray-500">{formatCairoDateTime(p.updatedAt, language)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
              {data?.lastPublished && (
                <p className="mt-3 text-xs text-gray-500">
                  {translate("Last published:", "آخر نشر:")} <strong>{data.lastPublished.title}</strong> · {formatCairoDateTime(data.lastPublished.at, language)}
                </p>
              )}
            </Panel>

            <Panel title={translate("Needs attention", "يحتاج إلى متابعة")}>
              {!data ? null : data.needsAttention.length === 0 ? (
                <p className="text-sm text-gray-500">{translate("Every page has what it needs to be published.", "كل الصفحات جاهزة للنشر.")}</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {data.needsAttention.map((n) => (
                    <li key={n.pageId}>
                      <button type="button" className="font-medium text-[#0B3D91] hover:underline" onClick={() => navigate(`${pagesUrl}/${n.pageId}`)}>
                        {n.slug}
                      </button>
                      <div className="text-xs text-gray-500">{n.problems.join("; ")}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={translate("Scheduled", "المجدولة")}>
              {!data ? null : data.upcoming.length === 0 ? (
                <p className="text-sm text-gray-500">{translate("Nothing scheduled.", "لا يوجد شيء مجدول.")}</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {data.upcoming.map((u) => (
                    <li key={u.pageId}>
                      {u.title} · <span className="text-gray-500">{formatCairoDateTime(u.at, language)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={translate("Tracking", "التتبع")}>
              {data && (
                <div className="flex flex-col gap-2 text-sm">
                  <div className="flex flex-wrap gap-1">
                    {data.integrations.enabled.length ? (
                      data.integrations.enabled.map((k) => (
                        <Badge key={k} color="teal" variant="light">
                          {TRACKER_LABEL[k] || k}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-gray-500">{translate("No tracking enabled.", "لا يوجد تتبع مفعّل.")}</span>
                    )}
                  </div>
                  <span className="text-gray-500">{translate(`${data.integrations.customCodeSnippets} custom code snippet(s) enabled`, `${data.integrations.customCodeSnippets} مقتطف كود مفعّل`)}</span>
                </div>
              )}
            </Panel>
          </div>

          <Panel title={translate("Recent activity", "النشاط الأخير")} side={<Button size="xs" variant="subtle" onClick={() => navigate(`/${paths.website}/${paths.websiteActivity}`)}>{translate("See all", "عرض الكل")}</Button>}>
            {!data ? null : data.recentActivity.length === 0 ? (
              <p className="text-sm text-gray-500">{translate("No activity yet.", "لا يوجد نشاط بعد.")}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {data.recentActivity.map((a) => (
                  <li key={a._id}>
                    <span className="font-medium">{a.actorName}</span> · {ACTION_LABELS[a.action] ? translate(ACTION_LABELS[a.action].en, ACTION_LABELS[a.action].ar) : a.action}
                    {a.targetLabel ? ` · ${a.targetLabel}` : ""} <span className="text-xs text-gray-500">· {formatCairoDateTime(a.createdAt, language)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </AdminLayoutBox>
  );
}
