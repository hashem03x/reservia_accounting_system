import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { Alert, Badge, Button, Textarea, Timeline } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import errorMessage from "@/utils/helpers/error-message";
import { notifySuccess } from "@/utils/helpers/notifiers";
import SectionCard from "@/components/ui/section-card";
import { ApprovalWorkflowStage, ApprovalWorkflowView, CommercialRevision } from "@/types/commercial";

const STATUS_COLOR: Record<string, string> = { Approved: "teal", Rejected: "red", Pending: "gray", "Requires Reapproval": "orange" };
const ACTION_COLOR: Record<string, string> = { Approved: "teal", Rejected: "red", Reset: "orange" };

/**
 * Deal Engine 3-stage approval (26 Nov 2026): Stage 1 Technical -> Stage 2 Sales / BDM -> Stage 3
 * Final Commercial (S&C Director or MD) -> Fully Approved. Everything shown here comes from the server
 * (GET commercial/approvals/:revisionId/workflow), including whether THIS user may act on a stage -
 * the same rules the server applies to the decision itself (services/commercial/approvalService.js),
 * so a button is only offered when the request would be accepted. No price is shown on this tab.
 */
export default function ApprovalsTab({ revision, onChanged }: { revision: CommercialRevision; onChanged: () => void }) {
  const { translate, language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [view, setView] = useState<ApprovalWorkflowView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await privateRequest({ url: `commercial/approvals/${revision._id}/workflow`, language });
      setView(res.data as ApprovalWorkflowView);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision._id, revision.updatedAt]);

  async function decide(s: ApprovalWorkflowStage, status: "Approved" | "Rejected") {
    const note = (notes[s.key] || "").trim();
    if (status === "Rejected" && !note) {
      setError(translate("Give the reason for returning the deal.", "اذكر سبب إعادة الصفقة."));
      return;
    }
    setBusy(`${s.key}-${status}`);
    setError(null);
    try {
      // expectedCalculatedAt: the server refuses the decision if the revision was recalculated since.
      await privateRequest({
        url: `commercial/approvals/${revision._id}/${s.apiStage}`,
        method: "PATCH",
        data: { status, note, expectedCalculatedAt: revision.lastCalculatedAt || undefined },
        language,
      });
      notifySuccess({ language, title: s.label, message: status === "Approved" ? translate("Approved and recorded.", "تمت الموافقة وتسجيلها.") : translate("Returned for revisions and recorded.", "أُعيدت للمراجعة وتم التسجيل.") });
      setNotes((p) => ({ ...p, [s.key]: "" }));
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
      load();
    } finally {
      setBusy(null);
    }
  }

  if (loadError) return <Alert color="red" variant="light">{loadError}</Alert>;
  if (!view) return <p className="text-sm text-gray-500">{translate("Loading the approval workflow...", "جارٍ تحميل مسار الموافقات...")}</p>;

  return (
    <div className="flex flex-col gap-4" data-testid="approval-workflow">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 p-3">
        <Badge color={view.fullyApproved ? "teal" : "yellow"} size="lg" variant="light" data-testid="approval-workflow-status">
          {view.workflowStatus}
        </Badge>
        <span className="text-xs text-gray-500">
          {translate("Revision", "النسخة")} {view.revisionNumber}
          {view.isCurrent ? "" : ` (${translate("superseded - read-only", "سابقة - للقراءة فقط")})`}
        </span>
        {view.finalApproval && (
          <span className="ms-auto text-xs text-gray-600" data-testid="approval-final">
            {translate("Fully approved by", "اعتمدت نهائياً بواسطة")} <strong>{view.finalApproval.byName}</strong> ({view.finalApproval.byRole}) - {dayjs(view.finalApproval.approvedAt).format("DD MMM YYYY HH:mm")}
          </span>
        )}
      </div>
      {view.workflowVersion === 1 && (
        <Alert color="gray" variant="light">
          {translate(
            "This revision was priced before the 3-stage workflow and still follows the earlier sign-off rules. Its next recalculation moves it to Technical -> Sales / BDM -> Final Commercial approval.",
            "سُعّرت هذه النسخة قبل مسار الموافقة الثلاثي وتتبع القواعد السابقة. إعادة حسابها القادمة تنقلها إلى: فني -> مبيعات / تطوير أعمال -> اعتماد تجاري نهائي."
          )}
        </Alert>
      )}
      {revision.status === "Draft" && (
        <Alert color="orange" variant="light">
          {translate("This revision is in Draft - recalculate it on the Engineering Input tab before anyone can sign.", "هذه النسخة مسودة - أعد حسابها من تبويب المدخلات الفنية قبل أي توقيع.")}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {view.stages.map((s) => (
          <SectionCard key={s.key} title={s.label}>
            <div className="flex flex-col gap-2" data-testid={`approval-stage-${s.number}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={STATUS_COLOR[s.displayStatus] || "gray"} variant="light" data-testid={`approval-stage-${s.number}-status`}>
                  {s.displayStatus}
                </Badge>
                <span className="text-xs text-gray-500">{s.approvers}</span>
              </div>
              {s.approverName && (
                <p className="text-xs text-gray-700">
                  {s.status === "Rejected" ? translate("Returned by", "أعادها") : translate("Approved by", "وافق")} <strong>{s.approverName}</strong>
                  {s.approverRole ? ` (${s.approverRole})` : ""}
                  {s.decidedAt ? ` - ${dayjs(s.decidedAt).format("DD MMM YYYY HH:mm")}` : ""}
                  {s.revisionNumber != null ? ` - ${translate("revision", "النسخة")} ${s.revisionNumber}` : ""}
                </p>
              )}
              {s.note && <p className={`text-xs ${s.status === "Rejected" ? "text-red-600" : "text-gray-500"}`}>{s.note}</p>}
              {s.canAct ? (
                <div className="flex flex-col gap-2">
                  <Textarea
                    size="xs"
                    placeholder={translate("Note (required to return the deal)", "ملاحظة (مطلوبة لإعادة الصفقة)")}
                    value={notes[s.key] || ""}
                    onChange={(e) => setNotes((p) => ({ ...p, [s.key]: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <Button size="xs" color="teal" loading={busy === `${s.key}-Approved`} disabled={!!busy} onClick={() => decide(s, "Approved")} data-testid={`approval-stage-${s.number}-approve`}>
                      {s.key === "MD" ? translate("Final approve", "اعتماد نهائي") : translate("Approve", "موافقة")}
                    </Button>
                    <Button size="xs" color="red" variant="light" loading={busy === `${s.key}-Rejected`} disabled={!!busy} onClick={() => decide(s, "Rejected")} data-testid={`approval-stage-${s.number}-reject`}>
                      {translate("Return for revisions", "إعادة للمراجعة")}
                    </Button>
                  </div>
                </div>
              ) : (
                s.cannotActReason && s.status !== "Approved" && <p className="text-xs text-gray-400">{s.cannotActReason}</p>
              )}
            </div>
          </SectionCard>
        ))}
      </div>
      {error && <Alert color="red" variant="light" data-testid="approval-error">{error}</Alert>}

      <SectionCard title={translate("Approval history", "سجل الموافقات")}>
        {!view.timeline.length ? (
          <p className="text-sm text-gray-500">{translate("No approval actions yet.", "لا توجد إجراءات بعد.")}</p>
        ) : (
          <Timeline bulletSize={14} lineWidth={2} data-testid="approval-timeline">
            {view.timeline.map((t, i) => (
              <Timeline.Item
                key={i}
                color={t.kind === "revision" ? "blue" : ACTION_COLOR[t.action || ""] || "gray"}
                title={
                  <span className="text-sm">
                    {t.kind === "revision" ? t.text : `${t.stageLabel} - ${t.action === "Reset" ? translate("reset (requires reapproval)", "أعيد ضبطها (تحتاج موافقة مجددا)") : t.action}`}
                  </span>
                }
              >
                <p className="text-xs text-gray-500">
                  {dayjs(t.at).format("DD MMM YYYY HH:mm")}
                  {t.kind === "approval" && t.revisionNumber != null ? ` - ${translate("revision", "النسخة")} ${t.revisionNumber}` : ""}
                  {t.byName ? ` - ${t.byName}${t.byRole ? ` (${t.byRole})` : ""}` : ""}
                </p>
                {t.note && <p className="text-xs text-gray-600">{t.note}</p>}
                {t.workflowBefore && t.workflowAfter && t.workflowBefore !== t.workflowAfter && (
                  <p className="text-[11px] text-gray-400">
                    {t.workflowBefore} → {t.workflowAfter}
                  </p>
                )}
              </Timeline.Item>
            ))}
          </Timeline>
        )}
      </SectionCard>
    </div>
  );
}
