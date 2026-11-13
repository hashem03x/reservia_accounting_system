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

type LiveState = "up_to_date" | "updating" | "behind" | "no_cms" | "no_stamp" | "unreachable" | "not_configured";
interface LiveStatus {
  state: LiveState;
  siteUrl: string | null;
  deployConfigured: boolean;
  liveBuiltAt: string | null;
  lastRequestedAt: string | null;
}

/**
 * Whether the live website was actually rebuilt from what is published now (GET /website/live-status
 * compares the live build's /cms-build.json stamp with the published content). A rebuild request
 * only QUEUES a build at the host; this is what shows that it went live - or that it did not.
 */
function LiveWebsiteStatus({ refreshKey }: { refreshKey: number }) {
  const { language, translate } = useLanguage();
  const { call } = useCmsApi();
  const [s, setS] = useState<LiveStatus | null>(null);
  useEffect(() => {
    let stop = false;
    let timer = 0;
    const load = async () => {
      const r = await call<LiveStatus>({ url: "website/live-status" }, { silent: true });
      if (stop) return;
      if (r) setS(r.data);
      // While a rebuild is running, look again until it is live (or reported as failed).
      if (r?.data.state === "updating") timer = window.setTimeout(load, 30_000);
    };
    load();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);
  if (!s) return null;
  const built = s.liveBuiltAt ? ` ${translate("Live version built", "تم بناء النسخة المنشورة")} ${formatCairoDateTime(s.liveBuiltAt, language)}.` : "";
  const view: Record<LiveState, { color: string; title: [string, string]; text: [string, string] }> = {
    up_to_date: { color: "teal", title: ["The live website is up to date", "الموقع المنشور محدّث"], text: ["It was built from everything that is published now.", "تم بناؤه من كل المحتوى المنشور حاليًا."] },
    updating: { color: "blue", title: ["The live website is being updated", "جارٍ تحديث الموقع المنشور"], text: ["A rebuild was requested and has not gone live yet. This usually takes a few minutes.", "تم طلب إعادة البناء ولم تظهر بعد. يستغرق ذلك عادة بضع دقائق."] },
    behind: {
      color: "orange",
      title: ["The live website does not show the latest published changes", "الموقع المنشور لا يعرض آخر التغييرات المنشورة"],
      text: s.deployConfigured
        ? ["The last rebuild did not go live (it may have failed at the host). Use \"Update live website\" to try again, and check the website's deployments if it keeps happening.", "لم تظهر آخر إعادة بناء (ربما فشلت لدى الاستضافة). استخدم \"تحديث الموقع المنشور\" للمحاولة مرة أخرى."]
        : ["Automatic rebuilds are not connected, so published changes appear only after the website is rebuilt.", "إعادة البناء التلقائية غير متصلة، لذا تظهر التغييرات بعد إعادة بناء الموقع فقط."],
    },
    no_cms: { color: "red", title: ["The live website is not reading the CMS", "الموقع المنشور لا يقرأ من نظام إدارة المحتوى"], text: ["It was built without the CMS address (CMS_API_URL in the website's hosting settings), so published changes cannot appear. Ask your system administrator to set it and rebuild.", "تم بناؤه دون عنوان نظام إدارة المحتوى، لذا لا يمكن أن تظهر التغييرات. اطلب من مسؤول النظام ضبطه وإعادة البناء."] },
    no_stamp: { color: "gray", title: ["The live website's version is unknown", "إصدار الموقع المنشور غير معروف"], text: ["The live build is older than this check. It is known after the next rebuild.", "النسخة المنشورة أقدم من هذا الفحص، وسيُعرف إصدارها بعد إعادة البناء التالية."] },
    unreachable: { color: "gray", title: ["The live website could not be checked", "تعذر فحص الموقع المنشور"], text: ["It did not answer. Try again in a moment.", "لم يستجب. حاول مرة أخرى بعد قليل."] },
    not_configured: { color: "gray", title: ["The live website address is not set", "عنوان الموقع المنشور غير مضبوط"], text: ["Set it in Settings → Domain to see whether the live website is up to date.", "اضبطه في الإعدادات لمعرفة ما إذا كان الموقع محدثًا."] },
  };
  const v = view[s.state] || view.unreachable;
  return (
    <Alert color={v.color} variant="light" title={translate(v.title[0], v.title[1])} data-testid="live-status" data-state={s.state}>
      {translate(v.text[0], v.text[1])}
      {built}
    </Alert>
  );
}

export default function WebsiteOverview() {
  const { language, translate } = useLanguage();
  const navigate = useNavigate();
  const { can } = useWebsiteRole();
  const confirm = useConfirm();
  const { call } = useCmsApi();
  const [data, setData] = useState<WebsiteOverviewData | null>(null);
  const [error, setError] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [liveKey, setLiveKey] = useState(0);
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
    setLiveKey((k) => k + 1);
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

          <LiveWebsiteStatus refreshKey={liveKey} />
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
                      <button type="button" className="font-medium text-primary-600 hover:underline dark:text-primary-300" onClick={() => navigate(`${pagesUrl}/${n.pageId}`)}>
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
