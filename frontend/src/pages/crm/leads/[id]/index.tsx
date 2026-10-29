import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatAmount } from "@/utils/helpers/format-amount";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import paths from "@/utils/constants/paths";
import { CRM_LOST_REASONS, CRM_STAGES, CrmActivity, CrmActivityType, CrmLead, CrmStage, CrmStageHistory } from "@/types/crm";
import { Badge, Button, NumberInput, Select, Textarea, TextInput } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import ErrorAlert from "@/components/ui/error-alert";
import { crmStageLabel, stageBadgeColor } from "../../_shared/stage";

type LeadDetail = { lead: CrmLead; activities: CrmActivity[]; stageHistory: CrmStageHistory[] };

const ACTIVITY_TYPES: { value: CrmActivityType; label: { en: string; ar: string } }[] = [
  { value: "note", label: { en: "Note", ar: "ملاحظة" } },
  { value: "call", label: { en: "Call", ar: "مكالمة" } },
  { value: "email", label: { en: "Email", ar: "بريد إلكتروني" } },
  { value: "survey", label: { en: "Site survey", ar: "مسح الموقع" } },
  { value: "proposal", label: { en: "Proposal", ar: "عرض سعر" } },
];

export default function CrmLeadDetail() {
  const { id } = useParams();
  const { language, translate } = useLanguage();
  const stageLabel = crmStageLabel(translate);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<LeadDetail | null>({
    initialData: null,
    initialLoading: true,
  });

  function load() {
    const controller = new AbortController();
    const canceled = { current: false };
    const executeFetch = async () => {
      const res = await privateRequest({ url: `crm/leads/${id}`, signal: controller.signal, language });
      setData(res.data);
    };
    handleRequest(language, setLoading, setError, executeFetch, canceled);
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    const cancelRequest = load();
    return cancelRequest;
  }, [id]);

  useDocumentTitle(`${data?.lead.refCode || ""} | Reservia CRM`);

  if (loading) return <LoadingSection message={translate("Loading lead...", "جاري تحميل العميل المحتمل...")} />;
  if (error) return <ErrorSection errorTitle={translate("Error loading lead", "خطأ في تحميل العميل المحتمل")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />;
  if (!data) return null;

  const { lead } = data;
  const overdue = !lead.firstReplyAt && new Date(lead.replyDueAt).getTime() < Date.now();

  return (
    <AdminLayoutBox
      header={{
        backLink: `/${paths.crm}/${paths.leads}`,
        title: lead.name || lead.phoneE164,
        subTitle: lead.refCode,
        sideElements: (
          <Badge color={stageBadgeColor(lead.stage)} size="lg" variant="light">
            {stageLabel(lead.stage)}
          </Badge>
        ),
      }}
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="flex flex-col gap-4 lg:col-span-1">
          <InfoCard lead={lead} overdue={overdue} />
          <StageChangeCard lead={lead} onChanged={load} />
          <StageHistoryCard rows={data.stageHistory} />
        </section>
        <section className="lg:col-span-2">
          <ActivityTimeline leadId={lead._id} activities={data.activities} onAdded={load} />
        </section>
      </div>
    </AdminLayoutBox>
  );
}

function InfoCard({ lead, overdue }: { lead: CrmLead; overdue: boolean }) {
  const { language, translate, translations } = useLanguage();
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between gap-2 border-b border-gray-50 py-1.5 text-sm last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
  return (
    <div className="rounded-lg border border-gray-100 p-4">
      <h4 className="mb-2">{translate("Lead Details", "تفاصيل العميل المحتمل")}</h4>
      {row(translate("Phone", "الهاتف"), lead.phoneE164)}
      {row(translate("Channel", "القناة"), lead.channel)}
      {row(translate("Segment", "القطاع"), lead.segment)}
      {row(translate("Source", "المصدر"), lead.source)}
      {row(translate("Governorate", "المحافظة"), lead.governorate || "-")}
      {row(translate("Owner", "المسؤول"), lead.owner?.name || "-")}
      {row(translate("Value", "القيمة"), lead.valueEgp ? formatAmount(lead.valueEgp, translations.currency) : "-")}
      {row(translate("Created", "تاريخ الإنشاء"), formatDateAndTime(lead.createdAt, language))}
      {row(
        translate("First reply due", "موعد أول رد مستحق"),
        <span className={overdue ? "text-red-600" : ""}>
          {formatDateAndTime(lead.replyDueAt, language)}
          {overdue && ` (${translate("overdue", "متأخر")})`}
        </span>,
      )}
      {lead.firstReplyAt && row(translate("First reply", "أول رد"), formatDateAndTime(lead.firstReplyAt, language))}
      {lead.followUpAt && row(translate("Follow-up", "المتابعة"), formatDateAndTime(lead.followUpAt, language))}
    </div>
  );
}

function StageChangeCard({ lead, onChanged }: { lead: CrmLead; onChanged: () => void }) {
  const { language, translate } = useLanguage();
  const [to, setTo] = useState<CrmStage | "">("");
  const [lostReason, setLostReason] = useState("");
  const [valueEgp, setValueEgp] = useState<string | number>(lead.valueEgp ?? "");
  const [followUpAt, setFollowUpAt] = useState("");
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  const needsLostReason = to === "lost";
  const needsValue = to === "won";
  const needsFollowUp = !["new", "contacted", "won", "lost", ""].includes(to);

  function submit() {
    if (!to) return;
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({
        language,
        method: "PATCH",
        url: `crm/leads/${lead._id}/stage`,
        data: {
          to,
          lostReason: needsLostReason ? lostReason : undefined,
          valueEgp: needsValue && valueEgp !== "" ? Number(valueEgp) : undefined,
          followUpAt: followUpAt || undefined,
        },
      });
      setTo("");
      setLostReason("");
      setFollowUpAt("");
      onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-100 p-4">
      <h4>{translate("Change Stage", "تغيير المرحلة")}</h4>
      <Select
        value={to || null}
        onChange={(v) => setTo((v as CrmStage) || "")}
        data={CRM_STAGES.filter((s) => s !== lead.stage).map((s) => ({ value: s, label: crmStageLabel(translate)(s) }))}
        placeholder={translate("Move to...", "نقل إلى...")}
      />
      {needsLostReason && (
        <Select
          value={lostReason || null}
          onChange={(v) => setLostReason(v || "")}
          data={CRM_LOST_REASONS.map((r) => ({ value: r, label: r }))}
          label={translate("Lost reason", "سبب الخسارة")}
          required
        />
      )}
      {needsValue && (
        <NumberInput value={valueEgp} onChange={setValueEgp} label={translate("Contract value - EGP", "قيمة العقد - جنيه")} min={0} required />
      )}
      {needsFollowUp && (
        <TextInput type="date" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} label={translate("Follow-up date", "تاريخ المتابعة")} required />
      )}
      <Button
        onClick={submit}
        loading={loading}
        disabled={!to || (needsLostReason && !lostReason) || (needsValue && !valueEgp) || (needsFollowUp && !followUpAt)}
        color="teal"
      >
        {translate("Apply", "تطبيق")}
      </Button>
      {error && <ErrorAlert error={error} />}
    </div>
  );
}

function StageHistoryCard({ rows }: { rows: CrmStageHistory[] }) {
  const { language, translate } = useLanguage();
  return (
    <div className="rounded-lg border border-gray-100 p-4">
      <h4 className="mb-2">{translate("Stage History", "سجل المراحل")}</h4>
      <div className="flex flex-col gap-2 text-sm">
        {rows
          .slice()
          .reverse()
          .map((h) => (
            <div key={h._id} className="flex items-center justify-between gap-2 border-b border-gray-50 py-1 last:border-0">
              <span>
                {h.from ? crmStageLabel(translate)(h.from) : translate("Created", "أُنشئ")} → {crmStageLabel(translate)(h.to)}
              </span>
              <span className="text-xs text-gray-500">{formatDateAndTime(h.createdAt, language)}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

function ActivityTimeline({ leadId, activities, onAdded }: { leadId: string; activities: CrmActivity[]; onAdded: () => void }) {
  const { language, translate } = useLanguage();
  const [type, setType] = useState<CrmActivityType>("note");
  const [body, setBody] = useState("");
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ language, method: "POST", url: `crm/leads/${leadId}/activities`, data: { type, body } });
      setBody("");
      onAdded();
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-gray-100 p-4">
      <h4>{translate("Activity Timeline", "سجل النشاط")}</h4>
      <form onSubmit={submit} className="flex flex-col gap-2 border-b border-gray-100 pb-4">
        <div className="flex gap-2">
          <Select value={type} onChange={(v) => setType((v as CrmActivityType) || "note")} data={ACTIVITY_TYPES.map((a) => ({ value: a.value, label: translate(a.label.en, a.label.ar) }))} w={160} />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={translate("Log a note, call, email...", "سجل ملاحظة، مكالمة، بريد...")} flex={1} minRows={1} />
        </div>
        <Button type="submit" loading={loading} disabled={!body.trim()} color="teal" className="self-end">
          {translate("Add", "إضافة")}
        </Button>
        {error && <ErrorAlert error={error} />}
      </form>

      <div className="flex flex-col gap-3">
        {activities.length === 0 && <p className="text-sm text-gray-400">{translate("No activity yet.", "لا يوجد نشاط حتى الآن.")}</p>}
        {activities
          .slice()
          .reverse()
          .map((a) => (
            <div key={a._id} className="rounded-md bg-gray-50 p-3 text-sm">
              <div className="mb-1 flex items-center justify-between gap-2">
                <Badge variant="light" size="sm">
                  {a.type}
                </Badge>
                <span className="text-xs text-gray-500">
                  {a.author?.name ? `${a.author.name} - ` : ""}
                  {formatDateAndTime(a.createdAt, language)}
                </span>
              </div>
              <p className="whitespace-pre-wrap">{a.body}</p>
            </div>
          ))}
      </div>
    </div>
  );
}
