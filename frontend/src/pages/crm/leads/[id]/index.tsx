import LeadCommercialCard from "./_components/lead-commercial-card";
import LeadAttributionCard from "./_components/lead-attribution-card";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { formatAmount } from "@/utils/helpers/format-amount";
import paths from "@/utils/constants/paths";
import { CRM_LOST_REASONS, CrmActivity, CrmActivityType, CrmLead, CrmLeadFirstReply, CrmRole, CrmStage, CrmStageHistory } from "@/types/crm";
import { Alert, Badge, Button, NumberInput, Select, Textarea, TextInput, Tooltip } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import ErrorAlert from "@/components/ui/error-alert";
import DeleteModal from "@/components/ui/delete-modal";
import { outlineIcons } from "@/components/icons";
import TruncatedText from "@/components/ui/truncated-text";
import { useSystemAccess } from "@/context/SystemAccessContext";
import { crmStageLabel, stageBadgeColor } from "../../_shared/stage";
import { allowedNextStages, channelLabel, overrideOnlyStages, segmentLabel, stageExtraFieldRequirements } from "../../_shared/lead-display";
import { formatCairoDateTime, formatFollowUpDate, isFollowUpOverdue } from "../../_shared/business-date";
import LeadAttachments from "./_components/lead-attachments";

type LeadDetail = { lead: CrmLead; activities: CrmActivity[]; stageHistory: CrmStageHistory[]; firstReply?: CrmLeadFirstReply };

// What a rep can log by hand. "WhatsApp message (sent)" (Change Request 2, item 3) is a reply sent
// from the sales phone - it counts as a first reply exactly like a call or an email.
const ACTIVITY_TYPES: { value: CrmActivityType; label: { en: string; ar: string } }[] = [
  { value: "note", label: { en: "Note", ar: "ملاحظة" } },
  { value: "call", label: { en: "Call", ar: "مكالمة" } },
  { value: "whatsapp_out", label: { en: "WhatsApp message (sent)", ar: "رسالة واتساب (مرسلة)" } },
  { value: "email", label: { en: "Email", ar: "بريد إلكتروني" } },
  { value: "survey", label: { en: "Site survey", ar: "مسح الموقع" } },
  { value: "proposal", label: { en: "Proposal", ar: "عرض سعر" } },
];

const ACTIVITY_LABELS: Record<CrmActivityType, { en: string; ar: string }> = {
  note: { en: "Note", ar: "ملاحظة" },
  call: { en: "Call", ar: "مكالمة" },
  email: { en: "Email", ar: "بريد" },
  survey: { en: "Site survey", ar: "مسح الموقع" },
  proposal: { en: "Proposal", ar: "عرض سعر" },
  whatsapp_in: { en: "WhatsApp in", ar: "واتساب وارد" },
  whatsapp_out: { en: "WhatsApp sent", ar: "واتساب مرسل" },
  system: { en: "System", ar: "النظام" },
};

const FIRST_REPLY_VIA_LABELS: Record<string, { en: string; ar: string }> = {
  stage_change: { en: "moved out of New", ar: "نقل من مرحلة جديد" },
  call: { en: "call", ar: "مكالمة" },
  whatsapp_out: { en: "WhatsApp message", ar: "رسالة واتساب" },
  email: { en: "email", ar: "بريد إلكتروني" },
};

export default function CrmLeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { language, translate } = useLanguage();
  const { systems } = useSystemAccess();
  const role = systems?.CRM?.role as CrmRole | null | undefined;
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
          <div className="flex items-center gap-2">
            {lead.archived && (
              <Badge color="gray" size="lg" variant="filled">
                {translate("Archived", "مؤرشف")}
              </Badge>
            )}
            <Badge color={stageBadgeColor(lead.stage)} size="lg" variant="light">
              {stageLabel(lead.stage)}
            </Badge>
            {role === "md" && <ArchiveAction lead={lead} onChanged={load} onArchivedAway={() => navigate(`/${paths.crm}/${paths.leads}`)} />}
          </div>
        ),
      }}
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="flex flex-col gap-4 lg:col-span-1">
          <InfoCard lead={lead} overdue={overdue} firstReply={data.firstReply} />
          <LeadCommercialCard lead={lead} onChanged={load} />
          <LeadAttributionCard lead={lead} />
          <StageChangeCard lead={lead} onChanged={load} />
          <StageHistoryCard rows={data.stageHistory} />
          <LeadAttachments leadId={lead._id} canEdit={role === "admin" || role === "md"} />
        </section>
        <section className="lg:col-span-2">
          <ActivityTimeline leadId={lead._id} activities={data.activities} onAdded={load} />
        </section>
      </div>
    </AdminLayoutBox>
  );
}

// MD-only archive/restore (acceptance report finding 7) - the server (requireCrmRole('md') on the
// route) is the real gate; this component only decides whether to render the button, which is
// never itself a security boundary ("hiding a menu item is not authorization").
function ArchiveAction({ lead, onChanged, onArchivedAway }: { lead: CrmLead; onChanged: () => void; onArchivedAway: () => void }) {
  const { language, translate } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [opened, { open, close }] = useDisclosure();
  const [reason, setReason] = useState("");
  const { loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  async function restore() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ language, method: "PATCH", url: `crm/leads/${lead._id}/restore` });
      onChanged();
    });
  }

  function confirmArchive() {
    handleRequest(language, setLoading, setError, async () => {
      // Change Request 1, Feature 6: a reason is required - the backend rejects an empty one too
      // (defense in depth), this just avoids a round-trip for the obvious case.
      await privateRequest({ language, method: "PATCH", url: `crm/leads/${lead._id}/archive`, data: { reason: reason.trim() } });
      close();
      onArchivedAway();
    });
  }

  if (lead.archived) {
    return (
      <Button variant="light" color="teal" size="sm" loading={loading} onClick={restore} leftSection={<outlineIcons.ArrowUpOnSquare />}>
        {translate("Restore", "استعادة")}
      </Button>
    );
  }

  return (
    <>
      <Button variant="light" color="red" size="sm" onClick={open} leftSection={<outlineIcons.Trash />}>
        {translate("Archive", "أرشفة")}
      </Button>
      <DeleteModal
        opened={opened}
        onClose={close}
        title={translate("Archive this lead?", "أرشفة هذا العميل المحتمل؟")}
        subTitle={translate(
          "The lead and its full history are kept - it is just hidden from the pipeline and leads list, and can be restored at any time.",
          "يتم الاحتفاظ بالعميل المحتمل وسجله الكامل - يتم إخفاؤه فقط من المسار وقائمة العملاء المحتملين، ويمكن استعادته في أي وقت.",
        )}
        action={confirmArchive}
        loading={loading}
        error={error}
        disabled={!reason.trim()}
      >
        <Textarea
          label={translate("Reason (required)", "السبب (مطلوب)")}
          placeholder={translate("e.g. Duplicate test lead created while verifying the form", "مثال: عميل محتمل تجريبي مكرر تم إنشاؤه أثناء اختبار النموذج")}
          value={reason}
          onChange={e => setReason(e.target.value)}
          autosize
          minRows={2}
          required
        />
      </DeleteModal>
    </>
  );
}

function InfoCard({ lead, overdue, firstReply }: { lead: CrmLead; overdue: boolean; firstReply?: CrmLeadFirstReply }) {
  const { language, translate, translations } = useLanguage();
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between gap-2 border-b border-gray-50 py-1.5 text-sm last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="text-end font-medium">{value}</span>
    </div>
  );
  const campaign = lead.campaign || lead.utmCampaign;
  // Shown only when the original submission differs from when the lead entered the CRM (a CSV
  // import or a delayed webhook) - the SLA is measured from the original time.
  const backdated = !!lead.submittedAt && Math.abs(new Date(lead.createdAt).getTime() - new Date(lead.submittedAt).getTime()) > 60_000;
  const followUpOverdue = isFollowUpOverdue(lead.followUpAt) && lead.stage !== "won" && lead.stage !== "lost";
  const via = firstReply?.via ? FIRST_REPLY_VIA_LABELS[firstReply.via] : null;

  return (
    <div className="rounded-lg border border-gray-100 p-4">
      <h4 className="mb-2">{translate("Lead Details", "تفاصيل العميل المحتمل")}</h4>
      {row(translate("Phone", "الهاتف"), <span dir="ltr">{lead.phoneE164}</span>)}
      {lead.email && row(translate("Email", "البريد الإلكتروني"), <TruncatedText text={lead.email} maxWidthClassName="max-w-[180px]" />)}
      {row(translate("Channel", "القناة"), channelLabel(translate)(lead.channel))}
      {row(translate("Segment", "القطاع"), segmentLabel(translate)(lead.segment))}
      {row(translate("Source", "المصدر"), lead.source)}
      {campaign && row(translate("Campaign", "الحملة"), <TruncatedText text={campaign} maxWidthClassName="max-w-[180px]" />)}
      {row(translate("Governorate", "المحافظة"), lead.governorate || "-")}
      {row(translate("Owner", "المسؤول"), lead.owner?.name || translate("Unassigned", "غير مخصص"))}
      {row(translate("Value", "القيمة"), lead.valueEgp ? formatAmount(lead.valueEgp, translations.currency) : "-")}
      {backdated && row(translate("Originally submitted", "تاريخ الإرسال الأصلي"), formatCairoDateTime(lead.submittedAt, language))}
      {row(backdated ? translate("Added to the CRM", "أُضيف إلى النظام") : translate("Created", "تاريخ الإنشاء"), formatCairoDateTime(lead.createdAt, language))}
      {row(
        translate("First reply due", "موعد أول رد مستحق"),
        <span className={overdue ? "text-red-600" : ""}>
          {formatCairoDateTime(lead.replyDueAt, language)}
          {overdue && ` (${translate("overdue", "متأخر")})`}
        </span>,
      )}
      {lead.firstReplyAt &&
        row(
          translate("First reply", "أول رد"),
          <span className="flex flex-col items-end">
            <span>{formatCairoDateTime(lead.firstReplyAt, language)}</span>
            {firstReply?.workingHours != null && (
              <Tooltip
                label={translate(
                  `Working hours (Sun-Thu 09:00-18:00 Cairo) from the original submission. The target is ${firstReply.slaWorkingHours} working hours.`,
                  `ساعات العمل (الأحد-الخميس 9-18 بتوقيت القاهرة) من وقت الإرسال الأصلي. الهدف ${firstReply.slaWorkingHours} ساعات عمل.`,
                )}
                multiline
                w={240}
              >
                <span className={`text-xs ${firstReply.withinSla ? "text-teal-700" : "text-red-600"}`}>
                  {firstReply.workingHours} {translate("working h", "ساعة عمل")}
                  {via ? ` - ${translate(via.en, via.ar)}` : ""}
                  {firstReply.withinSla ? ` - ${translate("within SLA", "ضمن المهلة")}` : ` - ${translate("late", "متأخر")}`}
                </span>
              </Tooltip>
            )}
          </span>,
        )}
      {lead.followUpAt &&
        row(
          translate("Follow-up", "المتابعة"),
          <span className={followUpOverdue ? "text-red-600" : ""}>
            {formatFollowUpDate(lead.followUpAt, language)}
            {followUpOverdue && ` (${translate("overdue", "متأخر")})`}
          </span>,
        )}
      {/* Attribution (first/last touch, click ids, history) is shown in LeadAttributionCard. */}
      {/* Archive audit trail (Change Request 1, Feature 6: "record who/when... audit trail") -
          shown only once archived, to the MD who can already see this page's archive/restore action. */}
      {lead.archived && (
        <>
          <h4 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">{translate("Archive", "الأرشفة")}</h4>
          {lead.archivedAt && row(translate("Archived at", "تاريخ الأرشفة"), formatCairoDateTime(lead.archivedAt, language))}
          {lead.archivedBy && row(translate("Archived by", "تمت الأرشفة بواسطة"), lead.archivedBy.name)}
          {lead.archiveReason && row(translate("Reason", "السبب"), <TruncatedText text={lead.archiveReason} maxWidthClassName="max-w-[180px]" />)}
        </>
      )}
    </div>
  );
}

function StageChangeCard({ lead, onChanged }: { lead: CrmLead; onChanged: () => void }) {
  const { language, translate } = useLanguage();
  const { systems } = useSystemAccess();
  const role = (systems?.CRM?.role as CrmRole | null | undefined) || "";
  const [to, setTo] = useState<CrmStage | "">("");
  const [lostReason, setLostReason] = useState("");
  const [valueEgp, setValueEgp] = useState<string | number>(lead.valueEgp ?? "");
  const [followUpAt, setFollowUpAt] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideForced, setOverrideForced] = useState(false);
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  const normalStages = allowedNextStages(lead.stage, role) as CrmStage[];
  const overrideStages = overrideOnlyStages(lead.stage, role) as CrmStage[];
  const { needsLostReason, needsValue, needsFollowUp } = stageExtraFieldRequirements(to);
  // Change Request 2, item 1: an MD-only override, needed when the chosen stage skips the order
  // (or when the server says so for a move this screen didn't anticipate).
  const needsOverride = role === "md" && !!to && (overrideStages.includes(to as CrmStage) || overrideForced);

  function choose(v: string | null) {
    setTo((v as CrmStage) || "");
    setOverrideForced(false);
    setError("");
  }

  function submit() {
    if (!to) return;
    handleRequest(language, setLoading, setError, async () => {
      try {
        await privateRequest({
          language,
          method: "PATCH",
          url: `crm/leads/${lead._id}/stage`,
          data: {
            to,
            lostReason: needsLostReason ? lostReason : undefined,
            valueEgp: needsValue && valueEgp !== "" ? Number(valueEgp) : undefined,
            followUpAt: followUpAt || undefined,
            overrideReason: needsOverride ? overrideReason.trim() : undefined,
          },
        });
      } catch (err) {
        if (role === "md" && (err as { overridable?: boolean })?.overridable) setOverrideForced(true);
        throw err;
      }
      setTo("");
      setLostReason("");
      setFollowUpAt("");
      setOverrideReason("");
      setOverrideForced(false);
      onChanged();
    });
  }

  const stageOptions = [
    { group: translate("Next steps", "الخطوات التالية"), items: normalStages.map((s) => ({ value: s, label: crmStageLabel(translate)(s) })) },
    ...(overrideStages.length
      ? [{ group: translate("MD override (reason required)", "تجاوز المدير العام (يتطلب سببًا)"), items: overrideStages.map((s) => ({ value: s, label: `${crmStageLabel(translate)(s)} *` })) }]
      : []),
  ].filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-100 p-4">
      <h4>{translate("Change Stage", "تغيير المرحلة")}</h4>
      <p className="text-xs text-gray-400">
        {translate(
          "Stages move one step at a time: New, Contacted, Qualified, Site survey, Proposal sent, Won or Lost.",
          "تتحرك المراحل خطوة واحدة في كل مرة: جديد، تم التواصل، مؤهل، مسح الموقع، تم إرسال العرض، ثم فوز أو خسارة.",
        )}
      </p>
      <Select
        value={to || null}
        onChange={choose}
        data={stageOptions}
        placeholder={translate("Move to...", "نقل إلى...")}
        nothingFoundMessage={translate("No further moves are available for this lead.", "لا توجد تحركات إضافية متاحة لهذا العميل المحتمل.")}
      />
      {needsOverride && (
        <Alert color="orange" variant="light" p="xs">
          {translate(
            "This skips the normal order. It is recorded in the stage history and the timeline with your name, the time and your reason.",
            "هذا يتخطى الترتيب المعتاد، وسيُسجَّل في سجل المراحل وسجل النشاط باسمك والوقت والسبب.",
          )}
        </Alert>
      )}
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
        <TextInput
          type="date"
          value={followUpAt}
          onChange={(e) => setFollowUpAt(e.target.value)}
          label={translate("Follow-up date", "تاريخ المتابعة")}
          description={translate("A calendar date - shown exactly as entered.", "تاريخ تقويمي - يُعرض كما أُدخل تماماً.")}
          required
        />
      )}
      {needsOverride && (
        <Textarea
          value={overrideReason}
          onChange={(e) => setOverrideReason(e.target.value)}
          label={translate("Reason for the override (required)", "سبب التجاوز (مطلوب)")}
          autosize
          minRows={2}
          maxLength={500}
          required
        />
      )}
      <Button
        onClick={submit}
        loading={loading}
        disabled={!to || (needsLostReason && !lostReason) || (needsValue && !valueEgp) || (needsFollowUp && !followUpAt) || (needsOverride && overrideReason.trim().length < 5)}
        color={needsOverride ? "orange" : "teal"}
      >
        {needsOverride ? translate("Override and apply", "تجاوز وتطبيق") : translate("Apply", "تطبيق")}
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
            <div key={h._id} className="flex flex-col gap-0.5 border-b border-gray-50 py-1 last:border-0">
              <div className="flex items-center justify-between gap-2">
                <span>
                  {h.from ? crmStageLabel(translate)(h.from) : translate("Created", "أُنشئ")} → {crmStageLabel(translate)(h.to)}
                  {h.override && (
                    <Badge ms={6} size="xs" color="orange" variant="light">
                      {translate("MD override", "تجاوز المدير")}
                    </Badge>
                  )}
                </span>
                <span className="text-xs text-gray-500">{formatCairoDateTime(h.createdAt, language)}</span>
              </div>
              {(h.changedBy?.name || h.override) && (
                <span className="text-xs text-gray-400">
                  {h.changedBy?.name}
                  {h.override && h.overrideReason ? ` - ${translate("reason", "السبب")}: ${h.overrideReason}` : ""}
                  {h.lostReason ? ` - ${h.lostReason}` : ""}
                </span>
              )}
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
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={type} onChange={(v) => setType((v as CrmActivityType) || "note")} data={ACTIVITY_TYPES.map((a) => ({ value: a.value, label: translate(a.label.en, a.label.ar) }))} w={200} />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={translate("Log a note, call, WhatsApp, email...", "سجل ملاحظة، مكالمة، واتساب، بريد...")} flex={1} minRows={1} />
        </div>
        {["call", "whatsapp_out", "email"].includes(type) && (
          <p className="text-xs text-gray-400">
            {translate("A call, WhatsApp message or email counts as the lead's first reply if it is the first one.", "المكالمة أو رسالة واتساب أو البريد تُحتسب كأول رد إذا كانت الأولى.")}
          </p>
        )}
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
            <div key={a._id} className={`rounded-md p-3 text-sm ${/MD OVERRIDE/.test(a.body) ? "bg-orange-50" : "bg-gray-50"}`}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <Badge variant="light" size="sm" color={a.type === "system" ? "gray" : "teal"}>
                  {ACTIVITY_LABELS[a.type] ? translate(ACTIVITY_LABELS[a.type].en, ACTIVITY_LABELS[a.type].ar) : a.type}
                </Badge>
                <span className="text-xs text-gray-500">
                  {a.author?.name ? `${a.author.name} - ` : ""}
                  {formatCairoDateTime(a.createdAt, language)}
                </span>
              </div>
              <p className="whitespace-pre-wrap">{a.body}</p>
            </div>
          ))}
      </div>
    </div>
  );
}
