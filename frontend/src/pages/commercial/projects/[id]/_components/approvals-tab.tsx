import { useState } from "react";
import dayjs from "dayjs";
import { Alert, Badge, Button, Textarea } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import SectionCard from "@/components/ui/section-card";
import { ApprovalStage, CommercialRevision } from "@/types/commercial";
import { STAGE_META, approverName, statusColor } from "../../../_shared/approvalStages";

// The 2-stage + MD approval workflow (Developer Brief section 4 / 4.1). Server-enforced stage order,
// role and segregation of duties (backend services/commercial/approvalService.js) - the buttons
// below are only a convenience; the backend re-checks the same rules on every request.
export default function ApprovalsTab({ revision, onChanged }: { revision: CommercialRevision; onChanged: () => void }) {
  const { translate, language } = useLanguage();
  const { systems } = useSystemAccess();
  const role = systems?.COMMERCIAL?.role;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });
  const isDraft = revision.status === "Draft";

  function decide(apiStage: string, status: "Approved" | "Rejected") {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ url: `commercial/approvals/${revision._id}/${apiStage}`, method: "PATCH", data: { status, note: notes[apiStage] || "" }, language });
      onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 p-3">
        <Badge color={revision.releaseStatus === "APPROVED FOR ISSUE" ? "teal" : "yellow"} size="lg" variant="light">
          {revision.releaseStatus}
        </Badge>
        {revision.mdRequired && <span className="text-xs text-gray-500">{translate("MD sign-off required (net price above EGP 1.5M)", "موافقة المدير العام مطلوبة (السعر الصافي أعلى من 1.5 مليون)")}</span>}
        {revision.waitingOn && <span className="ms-auto text-sm text-gray-700">{translate("Waiting on", "في انتظار")}: <strong>{revision.waitingOn}</strong></span>}
      </div>
      {isDraft && (
        <Alert color="orange" variant="light">
          {translate("This revision is in Draft - recalculate it on the Engineering Input tab before anyone can sign.", "هذه النسخة مسودة - أعد حسابها من تبويب المدخلات الفنية قبل أي توقيع.")}
        </Alert>
      )}

      {STAGE_META.filter((s) => s.key !== "md" || revision.mdRequired).map((s) => {
        const stage = revision[s.key] as ApprovalStage;
        const canDecide = !!role && s.roles.includes(role);
        const blocked = isDraft || (s.key === "stage2" ? revision.stage1.status !== "Approved" : s.key === "md" ? revision.stage2.status !== "Approved" : false);
        const name = approverName(stage);
        return (
          <SectionCard key={s.key} title={`${translate(s.title.en, s.title.ar)} - ${translate(s.who.en, s.who.ar)}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge color={statusColor(stage.status)} variant="light">
                {stage.status}
              </Badge>
              {name ? (
                <span className="text-xs text-gray-600">
                  {translate("Signed by", "وقّع")} <strong>{name}</strong>
                  {stage.decidedAt ? ` - ${dayjs(stage.decidedAt).format("DD MMM YYYY HH:mm")}` : ""}
                </span>
              ) : (
                stage.status !== "Pending" && <span className="text-xs text-red-600">{translate("Approver not recorded", "لم يُسجل الموقّع")}</span>
              )}
            </div>
            {stage.note && <p className="mb-2 text-xs text-gray-500">{stage.note}</p>}
            {stage.status === "Rejected" && (
              <p className="mb-2 text-xs text-red-600">{translate("Rejected - revise the pricing or allocations; recalculating reopens this stage.", "مرفوضة - راجع التسعير أو التخصيصات؛ إعادة الحساب تعيد فتح المرحلة.")}</p>
            )}
            {canDecide && stage.status === "Pending" && !blocked && (
              <div className="flex flex-col gap-2">
                <Textarea placeholder={translate("Optional note", "ملاحظة اختيارية")} value={notes[s.apiStage] || ""} onChange={(e) => setNotes((p) => ({ ...p, [s.apiStage]: e.target.value }))} />
                <div className="flex gap-2">
                  <Button size="sm" color="teal" loading={loading} onClick={() => decide(s.apiStage, "Approved")}>
                    {translate("Approve", "موافقة")}
                  </Button>
                  <Button size="sm" color="red" variant="light" loading={loading} onClick={() => decide(s.apiStage, "Rejected")}>
                    {translate("Reject", "رفض")}
                  </Button>
                </div>
              </div>
            )}
            {!canDecide && stage.status === "Pending" && !blocked && (
              <p className="text-xs text-gray-400">{translate(`Only the ${s.who.en} role can sign this stage.`, `فقط دور ${s.who.ar} يمكنه توقيع هذه المرحلة.`)}</p>
            )}
            {blocked && !isDraft && stage.status === "Pending" && <p className="text-xs text-gray-400">{translate("Waiting on the previous stage.", "في انتظار المرحلة السابقة.")}</p>}
          </SectionCard>
        );
      })}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
