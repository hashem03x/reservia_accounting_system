import { useEffect, useState } from "react";
import { MonthPickerInput } from "@mantine/dates";
import { Select, Badge, Table, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { toMonthOnly } from "@/utils/helpers/format-date";
import { formatAmount } from "@/utils/helpers/format-amount";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import KpiCard from "@/components/ui/kpi-card";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import { CRM_FORM_SEGMENTS, CrmPerformance, CrmRole } from "@/types/crm";
import { crmStageLabel } from "../_shared/stage";
import { segmentLabel } from "../_shared/lead-display";

const TEAL = "#00656A";
const SMALL_SAMPLE_THRESHOLD = 10;

// "Below 10 closed deals in a group: show count beside every rate" (acceptance report section 5).
function SampleTag({ n }: { n: number }) {
  if (n >= SMALL_SAMPLE_THRESHOLD) return null;
  return (
    <Tooltip label="Small sample - interpret with caution">
      <span className="ms-1 text-[10px] text-gray-400">(n={n})</span>
    </Tooltip>
  );
}

function dash(v: number | null | undefined, suffix = "") {
  return v == null ? "-" : `${v}${suffix}`;
}

export default function CrmPerformancePage() {
  const { translate, translations, language } = useLanguage();
  const { systems } = useSystemAccess();
  const role = systems?.CRM?.role as CrmRole | null | undefined;
  const isManager = role === "md" || role === "admin";
  const stageLabel = crmStageLabel(translate);
  const segLabel = segmentLabel(translate);

  useDocumentTitle(`${translate("Performance", "الأداء")} | Reservia CRM`);

  const [month, setMonth] = useState<Date | null>(new Date());
  const [owner, setOwner] = useState<string>("");
  const [segment, setSegment] = useState<string>("");
  const [team, setTeam] = useState<{ value: string; label: string }[]>([]);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<CrmPerformance | null>({ initialData: null, initialLoading: true });

  useEffect(() => {
    if (!isManager) return;
    privateRequest({ url: "crm/team", language })
      .then(res => setTeam((res.data as { _id: string; name: string }[]).map(u => ({ value: u._id, label: u.name }))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager]);

  useEffect(() => {
    if (!month) return;
    const controller = new AbortController();
    handleRequest(
      language,
      setLoading,
      setError,
      async () => {
        const res = await privateRequest({
          url: "crm/reports/performance",
          params: { month: toMonthOnly(month), ...(isManager && owner ? { owner } : {}), ...(segment ? { segment } : {}) },
          signal: controller.signal,
          language,
        });
        setData(res.data as CrmPerformance);
      },
      { current: false },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, owner, segment]);

  return (
    <AdminLayoutBox
      header={{
        title: translate("Performance", "الأداء"),
        sideElements: (
          <div className="flex flex-wrap items-center gap-2">
            <MonthPickerInput value={month} onChange={setMonth} className="w-[160px]" placeholder={translate("Month", "الشهر")} />
            {isManager && (
              <Select value={owner || null} onChange={v => setOwner(v || "")} data={team} placeholder={translate("All owners", "كل المسؤولين")} clearable searchable className="w-[180px]" />
            )}
            <Select
              value={segment || null}
              onChange={v => setSegment(v || "")}
              data={CRM_FORM_SEGMENTS.map(s => ({ value: s, label: segLabel(s) }))}
              placeholder={translate("All segments", "كل القطاعات")}
              clearable
              className="w-[160px]"
            />
          </div>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading performance...", "جاري تحميل الأداء...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Error loading performance", "خطأ في تحميل الأداء")} errorMessage={error} />
      ) : (
        data && (
          <div className="flex flex-col gap-4 text-sm">
            {/* A. Speed */}
            <section>
              <h3 className="mb-2 text-sm font-semibold" style={{ color: TEAL }}>
                {translate("Speed", "السرعة")}
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <KpiCard
                  label={translate("Hours to first reply (avg/median)", "ساعات الرد الأول (متوسط/وسيط)")}
                  value={`${dash(data.speed.hoursToFirstReply.avgHours)} / ${dash(data.speed.hoursToFirstReply.medianHours)}`}
                  subValue={<SampleTag n={data.speed.hoursToFirstReply.sampleSize} />}
                />
                <KpiCard
                  label={translate("% within 8 working hours", "% خلال 8 ساعات عمل")}
                  value={dash(data.speed.hoursToFirstReply.pctWithin8h, "%")}
                  // Change Request 2, item 3: the SLA % has its own denominator - replied leads plus
                  // unreplied leads already past their deadline (leads still in time are pending).
                  subValue={<SampleTag n={data.speed.hoursToFirstReply.slaSampleSize ?? data.speed.hoursToFirstReply.sampleSize} />}
                />
                <KpiCard
                  label={translate("Days to quote (avg/median)", "أيام العرض (متوسط/وسيط)")}
                  value={`${dash(data.speed.daysToQuote.avgDays)} / ${dash(data.speed.daysToQuote.medianDays)}`}
                  subValue={<SampleTag n={data.speed.daysToQuote.sampleSize} />}
                />
                <KpiCard
                  label={translate("Days to close (avg/median)", "أيام الإغلاق (متوسط/وسيط)")}
                  value={`${dash(data.speed.daysToClose.avgDays)} / ${dash(data.speed.daysToClose.medianDays)}`}
                  subValue={<SampleTag n={data.speed.daysToClose.sampleSize} />}
                />
              </div>

              <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-gray-100 p-3">
                  <h4 className="mb-2 text-xs font-semibold text-gray-500">{translate("Days in each stage", "الأيام في كل مرحلة")}</h4>
                  <Table verticalSpacing={2} fz="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{translate("Stage", "المرحلة")}</Table.Th>
                        <Table.Th className="text-right">{translate("Avg", "متوسط")}</Table.Th>
                        <Table.Th className="text-right">{translate("Median", "وسيط")}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {data.speed.daysInStage.map(s => (
                        <Table.Tr key={s.stage}>
                          <Table.Td>{stageLabel(s.stage)}</Table.Td>
                          <Table.Td className="text-right">
                            {dash(s.avgDays)}
                            <SampleTag n={s.sampleSize} />
                          </Table.Td>
                          <Table.Td className="text-right">{dash(s.medianDays)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </div>

                <div className="rounded-lg border border-gray-100 p-3">
                  <h4 className="mb-2 text-xs font-semibold text-gray-500">{translate("Stuck leads", "عملاء متعثرون")}</h4>
                  {data.speed.stuckLeads.length === 0 ? (
                    <p className="text-xs text-gray-400">{translate("None - every open lead is moving at a normal pace.", "لا يوجد - كل العملاء المفتوحين يتحركون بوتيرة طبيعية.")}</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {data.speed.stuckLeads.map(s => (
                        <li key={s.leadId} className="flex items-center justify-between rounded bg-red-50 px-2 py-1 text-xs">
                          <span>{stageLabel(s.stage)}</span>
                          <span className="font-semibold text-red-600">
                            {s.days}d <span className="font-normal text-gray-400">(median {s.medianDaysForStage}d)</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>

            {/* B. Conversion */}
            <section>
              <h3 className="mb-2 text-sm font-semibold" style={{ color: TEAL }}>
                {translate("Conversion", "التحويل")}
              </h3>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-gray-100 p-3">
                  <h4 className="mb-2 text-xs font-semibold text-gray-500">{translate("Stage conversion funnel", "قمع تحويل المراحل")}</h4>
                  <Table verticalSpacing={2} fz="xs">
                    <Table.Tbody>
                      {data.conversion.funnel.map(f => (
                        <Table.Tr key={f.stage}>
                          <Table.Td>{stageLabel(f.stage)}</Table.Td>
                          <Table.Td className="text-right">{f.count}</Table.Td>
                          <Table.Td className="text-right text-gray-500">{f.pctFromPreviousStage != null ? `${f.pctFromPreviousStage}%` : "-"}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </div>

                <div className="rounded-lg border border-gray-100 p-3">
                  <h4 className="mb-2 text-xs font-semibold text-gray-500">{translate("Win rate by segment", "معدل الفوز حسب القطاع")}</h4>
                  <Table verticalSpacing={2} fz="xs">
                    <Table.Tbody>
                      {data.conversion.winRateBySegment.map(s => (
                        <Table.Tr key={s.segment}>
                          <Table.Td>{segLabel(s.segment)}</Table.Td>
                          <Table.Td className="text-right">
                            {dash(s.winRatePct, "%")}
                            <SampleTag n={s.sampleSize} />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-gray-500">{translate("Loss rate", "معدل الخسارة")}</span>
                    <span className="font-semibold">{dash(data.conversion.lossRatePct, "%")}</span>
                  </div>
                  {data.conversion.lostReasonsRanked.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {data.conversion.lostReasonsRanked.map(r => (
                        <Badge key={r.reason} color="gray" variant="light" size="xs">
                          {r.reason}: {r.count}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <KpiCard
                  label={translate("Lead to signed", "من العميل إلى التوقيع")}
                  value={dash(data.conversion.leadToSigned.pct, "%")}
                  subValue={`${data.conversion.leadToSigned.signed} / ${data.conversion.leadToSigned.enquiries}`}
                />
                <KpiCard label={translate("Quote to win", "من العرض إلى الفوز")} value={translate("Not available yet", "غير متاح بعد")} />
              </div>
            </section>

            {/* C. Value and cost */}
            <section>
              <h3 className="mb-2 text-sm font-semibold" style={{ color: TEAL }}>
                {translate("Value and cost", "القيمة والتكلفة")}
              </h3>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-gray-100 p-3">
                  <h4 className="mb-2 text-xs font-semibold text-gray-500">{translate("Average deal size by segment", "متوسط حجم الصفقة حسب القطاع")}</h4>
                  <Table verticalSpacing={2} fz="xs">
                    <Table.Tbody>
                      {data.valueCost.averageDealSizeBySegment.map(s => (
                        <Table.Tr key={s.segment}>
                          <Table.Td>{segLabel(s.segment)}</Table.Td>
                          <Table.Td className="text-right">
                            {s.avgDealSizeEgp != null ? formatAmount(s.avgDealSizeEgp, translations.currency) : "-"}
                            <SampleTag n={s.sampleSize} />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </div>

                <div className="flex flex-col gap-2">
                  <div
                    className="rounded-lg border p-3"
                    style={{ borderColor: data.valueCost.pipelineCoverage.belowOne ? "#fca5a5" : "#e5e7eb", backgroundColor: data.valueCost.pipelineCoverage.belowOne ? "#fef2f2" : undefined }}
                  >
                    <h4 className="mb-1 text-xs font-semibold text-gray-500">{translate("Pipeline coverage", "تغطية المسار")}</h4>
                    <span className="text-lg font-semibold" style={{ color: data.valueCost.pipelineCoverage.belowOne ? "#dc2626" : TEAL }}>
                      {data.valueCost.pipelineCoverage.ratio != null ? `${data.valueCost.pipelineCoverage.ratio}x` : "-"}
                    </span>
                    {data.valueCost.pipelineCoverage.remainingTargetEgp != null && (
                      <p className="text-xs text-gray-500">
                        {translate("Weighted pipeline", "المسار المرجح")}: {formatAmount(data.valueCost.pipelineCoverage.weightedPipelineEgp, translations.currency)} /{" "}
                        {translate("remaining target", "الهدف المتبقي")}: {formatAmount(data.valueCost.pipelineCoverage.remainingTargetEgp, translations.currency)}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <KpiCard label={translate("Cost / qualified lead", "التكلفة / عميل مؤهل")} value={data.valueCost.costPerQualifiedLeadEgp != null ? formatAmount(data.valueCost.costPerQualifiedLeadEgp, translations.currency) : "-"} />
                    <KpiCard label={translate("Cost / signed deal", "التكلفة / صفقة موقعة")} value={data.valueCost.costPerSignedDealEgp != null ? formatAmount(data.valueCost.costPerSignedDealEgp, translations.currency) : "-"} />
                  </div>
                </div>
              </div>
            </section>

            {/* D. Sources - CRM Changes Required, item 4: Source is the first touch; Last touch alongside. */}
            {data.sources && (
              <section data-testid="perf-sources">
                <h3 className="mb-2 text-sm font-semibold" style={{ color: TEAL }}>
                  {translate("Leads by source", "العملاء حسب المصدر")}
                </h3>
                <div className="rounded-lg border border-gray-100 p-3">
                  <p className="mb-2 text-xs text-gray-500">
                    {translate(
                      "Source is the first touch (it never changes). Last touch is the most recent campaign or ad click, for reference.",
                      "المصدر هو أول نقطة تواصل (لا يتغير). آخر نقطة تواصل هي أحدث حملة أو نقرة إعلان، للاطلاع فقط.",
                    )}{" "}
                    {data.sources.lastTouchDiffers > 0 &&
                      translate(
                        `${data.sources.lastTouchDiffers} of ${data.sources.total} leads have a different last touch.`,
                        `${data.sources.lastTouchDiffers} من ${data.sources.total} عملاء لديهم آخر نقطة تواصل مختلفة.`,
                      )}
                  </p>
                  {data.sources.rows.length === 0 ? (
                    <p className="text-xs text-gray-400">{translate("No leads in this month.", "لا يوجد عملاء في هذا الشهر.")}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table verticalSpacing={2} fz="xs" miw={560}>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>{translate("Source (first touch)", "المصدر (أول تواصل)")}</Table.Th>
                            <Table.Th>{translate("Campaign", "الحملة")}</Table.Th>
                            <Table.Th>{translate("Last touch", "آخر تواصل")}</Table.Th>
                            <Table.Th className="text-right">{translate("Leads", "العملاء")}</Table.Th>
                            <Table.Th className="text-right">{translate("Qualified", "مؤهل")}</Table.Th>
                            <Table.Th className="text-right">{translate("Won", "فوز")}</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {data.sources.rows.map((r) => (
                            <Table.Tr key={`${r.source}|${r.lastTouchSource}|${r.lastTouchCampaign}`}>
                              <Table.Td>{r.source}</Table.Td>
                              <Table.Td className="text-gray-500">{r.campaign || "-"}</Table.Td>
                              <Table.Td>{r.lastTouchSource ? [r.lastTouchSource, r.lastTouchCampaign].filter(Boolean).join(" · ") : "-"}</Table.Td>
                              <Table.Td className="text-right">{r.leads}</Table.Td>
                              <Table.Td className="text-right">{r.qualified}</Table.Td>
                              <Table.Td className="text-right">{r.won}</Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        )
      )}
    </AdminLayoutBox>
  );
}
