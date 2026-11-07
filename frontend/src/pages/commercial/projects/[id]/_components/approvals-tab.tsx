import { useState } from "react";
import { Badge, Button, Textarea } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import SectionCard from "@/components/ui/section-card";
import { ApprovalStage, ApprovalStageKey, CommercialRevision } from "@/types/commercial";

// The 2-stage + MD approval workflow (Developer Brief section 4 - a business rule, not something
// any source workbook defines). Server-enforced stage order and role (never a frontend-only
// restriction, per the project's own rule) - the buttons below are only ever a convenience; the
// backend re-checks the same role and order on every request.
const STAGE_META: { key: ApprovalStageKey; apiStage: string; roles: string[]; title: { en: string; ar: string } }[] = [
  { key: "stage1", apiStage: "stage1", roles: ["sales", "technical", "commercial_director", "md"], title: { en: "Stage 1: Gross Profit Sign-off", ar: "المرحلة 1: الموافقة على الربح الإجمالي" } },
  { key: "stage2", apiStage: "stage2", roles: ["commercial_director", "md"], title: { en: "Stage 2: Allocations Sign-off", ar: "المرحلة 2: الموافقة على التخصيصات" } },
  { key: "md", apiStage: "md", roles: ["md"], title: { en: "MD Sign-off", ar: "موافقة المدير العام" } },
];

export default function ApprovalsTab({ revision, onChanged }: { revision: CommercialRevision; onChanged: () => void }) {
  const { translate, language } = useLanguage();
  const { systems } = useSystemAccess();
  const role = systems?.COMMERCIAL?.role;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });

  function decide(apiStage: string, status: "Approved" | "Rejected") {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ url: `commercial/approvals/${revision._id}/${apiStage}`, method: "PATCH", data: { status, note: notes[apiStage] || "" }, language });
      onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-gray-100 p-3">
        <Badge color={revision.releaseStatus === "APPROVED FOR ISSUE" ? "teal" : "yellow"} size="lg" variant="light">
          {revision.releaseStatus}
        </Badge>
        {revision.mdRequired && <span className="ms-2 text-xs text-gray-500">{translate("MD sign-off required (net price above threshold)", "موافقة المدير العام مطلوبة (السعر الصافي يتجاوز الحد)")}</span>}
      </div>

      {STAGE_META.filter((s) => s.key !== "md" || revision.mdRequired).map((s) => {
        const stage = revision[s.key] as ApprovalStage;
        const canDecide = role && s.roles.includes(role);
        const blocked = s.key === "stage2" ? revision.stage1.status !== "Approved" : s.key === "md" ? revision.stage2.status !== "Approved" : false;
        return (
          <SectionCard key={s.key} title={translate(s.title.en, s.title.ar)}>
            <div className="mb-2">
              <Badge color={stage.status === "Approved" ? "teal" : stage.status === "Rejected" ? "red" : "gray"} variant="light">
                {stage.status}
              </Badge>
              {stage.approver && <span className="ms-2 text-xs text-gray-500">{stage.approver.name} - {stage.decidedAt ? new Date(stage.decidedAt).toLocaleDateString() : ""}</span>}
            </div>
            {stage.note && <p className="mb-2 text-xs text-gray-500">{stage.note}</p>}
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
            {blocked && stage.status === "Pending" && <p className="text-xs text-gray-400">{translate("Waiting on the previous stage.", "في انتظار المرحلة السابقة.")}</p>}
          </SectionCard>
        );
      })}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
