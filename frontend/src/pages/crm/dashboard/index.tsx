import { ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { MonthPickerInput } from "@mantine/dates";
import { Select, Badge, Table, Button } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { toMonthOnly } from "@/utils/helpers/format-date";
import { formatAmount } from "@/utils/helpers/format-amount";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import { outlineIcons } from "@/components/icons";
import { CrmDashboard, CrmRole } from "@/types/crm";
import { crmStageLabel } from "../_shared/stage";
import TargetsModal from "./_components/targets-modal";

// Brand colors (acceptance report section 4).
const GREEN = "#004F2F";
const TEAL = "#00656A";
const AMBER = "#EDA202";

function TargetTile({ label, actual, target, translate }: { label: string; actual: number; target: number | null; translate: (en: string, ar: string) => string }) {
  const pct = target && target > 0 ? Math.min(Math.round((actual / target) * 100), 100) : null;
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-gray-100 p-2.5">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-lg font-semibold" style={{ color: GREEN }}>
        {actual}
        {target != null && <span className="text-sm font-normal text-gray-400"> / {target}</span>}
      </span>
      {pct != null ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? GREEN : AMBER }} />
        </div>
      ) : (
        <span className="text-xs text-gray-400">{translate("No target set", "لم يُحدد هدف")}</span>
      )}
    </div>
  );
}

// A deliberately compact stat tile for this page only - the shared KpiCard component
// (components/ui/kpi-card.tsx) has a min-h-[104px] sized for the main ERP's spacious financial
// cards; reusing it here is what made the Dashboard taller than one laptop screen (acceptance
// report section 4: "no vertical scrolling"). This one is label + value only, no min-height.
function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-gray-100 p-2">
      <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-base font-semibold text-gray-800">{value}</span>
    </div>
  );
}

export default function CrmDashboardPage() {
  const { translate, translations, language } = useLanguage();
  const navigate = useNavigate();
  const { systems } = useSystemAccess();
  const role = systems?.CRM?.role as CrmRole | null | undefined;
  const isManager = role === "md" || role === "admin";
  const stageLabel = crmStageLabel(translate);

  useDocumentTitle(`${translate("Dashboard", "لوحة التحكم")} | Reservia CRM`);

  const [month, setMonth] = useState<Date | null>(new Date());
  const [owner, setOwner] = useState<string>("");
  const [team, setTeam] = useState<{ value: string; label: string }[]>([]);
  const [targetsOpened, { open: openTargets, close: closeTargets }] = useDisclosure(false);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<CrmDashboard | null>({ initialData: null, initialLoading: true });

  useEffect(() => {
    if (!isManager) return;
    privateRequest({ url: "crm/team", language })
      .then(res => setTeam((res.data as { _id: string; name: string }[]).map(u => ({ value: u._id, label: u.name }))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager]);

  function loadDashboard(signal?: AbortSignal) {
    if (!month) return;
    handleRequest(
      language,
      setLoading,
      setError,
      async () => {
        const res = await privateRequest({
          url: "crm/reports/dashboard",
          params: { month: toMonthOnly(month), ...(isManager && owner ? { owner } : {}) },
          signal,
          language,
        });
        setData(res.data as CrmDashboard);
      },
      { current: false },
    );
  }

  useEffect(() => {
    const controller = new AbortController();
    loadDashboard(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, owner]);

  return (
    <AdminLayoutBox
      header={{
        title: translate("Dashboard", "لوحة التحكم"),
        sideElements: (
          <div className="flex flex-wrap items-center gap-2">
            <MonthPickerInput value={month} onChange={setMonth} className="w-[160px]" placeholder={translate("Month", "الشهر")} />
            {isManager && (
              <Select
                value={owner || null}
                onChange={v => setOwner(v || "")}
                data={team}
                placeholder={translate("All owners", "كل المسؤولين")}
                clearable
                searchable
                className="w-[180px]"
              />
            )}
            {role === "md" && (
              <Button variant="light" color="teal" leftSection={<outlineIcons.Edit size={14} />} onClick={openTargets}>
                {translate("Targets & Spend", "الأهداف والإنفاق")}
              </Button>
            )}
          </div>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading dashboard...", "جاري تحميل لوحة التحكم...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Error loading dashboard", "خطأ في تحميل لوحة التحكم")} errorMessage={error} />
      ) : (
        data && (
          <div className="flex flex-col gap-2 text-sm">
            {/* Targets */}
            <section>
              <h3 className="mb-1.5 text-sm font-semibold" style={{ color: TEAL }}>
                {translate("Targets", "الأهداف")}
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <TargetTile label={translate("Enquiries", "الاستفسارات")} actual={data.targets.enquiries.actual} target={data.targets.enquiries.target} translate={translate} />
                <TargetTile label={translate("Qualified", "مؤهل")} actual={data.targets.qualified.actual} target={data.targets.qualified.target} translate={translate} />
                <TargetTile label={translate("Surveys", "المعاينات")} actual={data.targets.surveys.actual} target={data.targets.surveys.target} translate={translate} />
                <TargetTile label={translate("Proposals", "العروض")} actual={data.targets.proposals.actual} target={data.targets.proposals.target} translate={translate} />
                <TargetTile label={translate("Signed", "موقّع")} actual={data.targets.signed.actual} target={data.targets.signed.target} translate={translate} />
                <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-gray-100 p-2.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{translate("Value target", "هدف القيمة")}</span>
                  <span className="text-lg font-semibold" style={{ color: GREEN }}>
                    {data.targets.valueEgp.target != null ? formatAmount(data.targets.valueEgp.target, translations.currency) : "-"}
                  </span>
                </div>
              </div>
            </section>

            <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
              {/* Pipeline by stage */}
              <section className="rounded-lg border border-gray-100 p-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold" style={{ color: TEAL }}>
                    {translate("Pipeline by stage", "المسار حسب المرحلة")}
                  </h3>
                  <Badge color="teal" variant="light">
                    {formatAmount(data.pipeline.totalWeightedValueEgp, translations.currency)}
                  </Badge>
                </div>
                <Table verticalSpacing={2} fz="xs">
                  <Table.Tbody>
                    {data.pipeline.stages.map(s => (
                      <Table.Tr key={s.stage}>
                        <Table.Td>{stageLabel(s.stage)}</Table.Td>
                        <Table.Td className="text-right">{s.count}</Table.Td>
                        <Table.Td className="text-right text-gray-500">{formatAmount(s.weightedValueEgp, translations.currency)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </section>

              {/* Speed */}
              <section className="rounded-lg border border-gray-100 p-2.5">
                <h3 className="mb-1.5 text-sm font-semibold" style={{ color: TEAL }}>
                  {translate("Speed", "السرعة")}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <StatTile label={translate("Past SLA", "تجاوز الحد")} value={data.speed.leadsPastSlaLimit} />
                  <StatTile label={translate("No follow-up", "بدون متابعة")} value={data.speed.leadsWithNoFollowUpDate} />
                  <StatTile label={translate("Avg hrs to reply", "متوسط ساعات الرد")} value={data.speed.avgHoursToFirstReply ?? "-"} />
                  <StatTile label={translate("% within 8h", "% خلال 8 ساعات")} value={data.speed.pctWithinSla != null ? `${data.speed.pctWithinSla}%` : "-"} />
                </div>
              </section>

              {/* Source quality */}
              <section className="rounded-lg border border-gray-100 p-2.5">
                <h3 className="mb-1.5 text-sm font-semibold" style={{ color: TEAL }}>
                  {translate("Source quality", "جودة المصدر")}
                </h3>
                <Table verticalSpacing={2} fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{translate("Source", "المصدر")}</Table.Th>
                      <Table.Th className="text-right">{translate("Leads", "محتملون")}</Table.Th>
                      <Table.Th className="text-right">{translate("Qual.", "مؤهل")}</Table.Th>
                      <Table.Th className="text-right">{translate("Cost/qual.", "التكلفة/مؤهل")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.sourceQuality.sources.map(s => (
                      <Table.Tr key={s.source}>
                        <Table.Td>{s.source}</Table.Td>
                        <Table.Td className="text-right">{s.leads}</Table.Td>
                        <Table.Td className="text-right">{s.qualified}</Table.Td>
                        <Table.Td className={`text-right ${s.overCostLimit ? "font-semibold text-red-600" : "text-gray-500"}`}>
                          {s.costPerQualifiedLead != null ? formatAmount(s.costPerQualifiedLead, translations.currency) : "-"}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </section>
            </div>

            <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
              {/* Won and lost */}
              <section className="rounded-lg border border-gray-100 p-2.5">
                <h3 className="mb-1.5 text-sm font-semibold" style={{ color: TEAL }}>
                  {translate("Won and lost", "المربوح والخاسر")}
                </h3>
                <div className="mb-2 grid grid-cols-3 gap-2">
                  <StatTile label={translate("Won", "مربوح")} value={data.wonLost.wonCount} />
                  <StatTile label={translate("Lost", "خاسر")} value={data.wonLost.lostCount} />
                  <StatTile label={translate("Median days to close", "متوسط أيام الإغلاق")} value={data.wonLost.medianDaysToClose ?? "-"} />
                </div>
                {data.wonLost.lostReasonsRanked.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {data.wonLost.lostReasonsRanked.map(r => (
                      <Badge key={r.reason} color="gray" variant="light">
                        {r.reason}: {r.count}
                      </Badge>
                    ))}
                  </div>
                )}
              </section>

              {/* This week */}
              <section className="rounded-lg border border-gray-100 p-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold" style={{ color: TEAL }}>
                    {translate("This week", "هذا الأسبوع")}
                  </h3>
                  <div className="flex gap-3 text-xs text-gray-500">
                    <span>
                      {translate("New", "جديد")}: <b>{data.thisWeek.newLeads}</b>
                    </span>
                    <span>
                      {translate("Moves", "تحركات")}: <b>{data.thisWeek.moves}</b>
                    </span>
                  </div>
                </div>
                {data.thisWeek.oldestUnanswered.length === 0 ? (
                  <p className="text-xs text-gray-400">{translate("Nothing unanswered - well done.", "لا يوجد عملاء دون رد - أحسنت.")}</p>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {data.thisWeek.oldestUnanswered.map(l => (
                      <li
                        key={l._id}
                        className="flex cursor-pointer items-center justify-between rounded px-2 py-0.5 text-xs hover:bg-gray-50"
                        onClick={() => navigate(`/crm/leads/${l._id}`)}
                      >
                        <span className="font-mono">{l.refCode}</span>
                        <TruncatedName name={l.name} />
                        <Badge size="xs" variant="light">
                          {stageLabel(l.stage)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        )
      )}

      {role === "md" && <TargetsModal opened={targetsOpened} close={closeTargets} team={team} onSaved={() => loadDashboard()} />}
    </AdminLayoutBox>
  );
}

function TruncatedName({ name }: { name: string | null }) {
  return <span className="max-w-[140px] truncate">{name || "-"}</span>;
}
