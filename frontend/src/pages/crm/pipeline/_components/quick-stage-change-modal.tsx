import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { CRM_LOST_REASONS, CrmLead, CrmStage } from "@/types/crm";
import { crmStageLabel } from "../../_shared/stage";
import { MD_APPROVAL_THRESHOLD_EGP, stageExtraFieldRequirements } from "../../_shared/lead-display";
import { Alert, Button, NumberInput, Select, Textarea, TextInput } from "@mantine/core";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";

// Collects the extra field(s) a stage change needs (lost reason / won value / follow-up date, and
// - Change Request 2, item 1 - the MD's override reason) before the SAME PATCH .../stage
// leads/[id]/index.tsx#StageChangeCard uses is sent. Shared by the pipeline board's card menu and
// its drag-and-drop drop handler, so neither path can submit an incomplete stage change.
//
// Override mode is entered either up front (the board knows the target needs an override) or when
// the backend answers `overridable: true` for an MD. The backend re-checks the MD role on every
// request - this form only collects the reason.
export default function QuickStageChangeModal({
  lead,
  to,
  requiresOverride = false,
  onClose,
  onChanged,
}: {
  lead: CrmLead | null;
  to: CrmStage | null;
  requiresOverride?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { language, translate } = useLanguage();
  const { systems } = useSystemAccess();
  const isMd = systems?.CRM?.role === "md";
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  const [lostReason, setLostReason] = useState("");
  const [valueEgp, setValueEgp] = useState<string | number>("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const opened = !!lead && !!to;
  const { needsLostReason, needsValue, needsFollowUp } = stageExtraFieldRequirements(to || "");

  useEffect(() => {
    if (opened) {
      setLostReason("");
      setValueEgp(lead?.valueEgp ?? "");
      setFollowUpAt("");
      setOverrideReason("");
      setOverrideMode(requiresOverride && isMd);
      setError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?._id, to, requiresOverride]);

  function submit() {
    if (!lead || !to) return;
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
            followUpAt: needsFollowUp ? followUpAt : undefined,
            overrideReason: overrideMode ? overrideReason.trim() : undefined,
          },
        });
      } catch (err) {
        // The MD hit a path rule the board didn't anticipate - offer the override instead of a dead end.
        if (isMd && (err as { overridable?: boolean })?.overridable) setOverrideMode(true);
        throw err;
      }
      onChanged();
      onClose();
    });
  }

  const disabled =
    (needsLostReason && !lostReason) || (needsValue && !valueEgp) || (needsFollowUp && !followUpAt) || (overrideMode && overrideReason.trim().length < 5);

  return (
    <Modal opened={opened} onClose={onClose} title={to ? translate(`Move to ${crmStageLabel(translate)(to)}`, `نقل إلى ${crmStageLabel(translate)(to)}`) : ""} size="sm">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-500">
          {lead?.name || lead?.phoneE164} - <span className="font-mono">{lead?.refCode}</span>
        </p>

        {overrideMode && (
          <Alert color="orange" variant="light" title={translate("MD override", "تجاوز من المدير العام")}>
            {translate(
              "This move skips the normal pipeline order. It will be recorded in the stage history and timeline with your name and reason.",
              "هذا النقل يتخطى ترتيب المراحل المعتاد، وسيُسجَّل في سجل المراحل والنشاط باسمك والسبب.",
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
            autoFocus
          />
        )}
        {needsValue && (
          <NumberInput
            value={valueEgp}
            onChange={setValueEgp}
            label={translate("Contract value - EGP", "قيمة العقد - جنيه")}
            min={0}
            required
            autoFocus
            description={
              typeof valueEgp === "number" && valueEgp > MD_APPROVAL_THRESHOLD_EGP
                ? translate("Contracts above EGP 1,000,000 need MD approval.", "العقود التي تزيد عن 1,000,000 جنيه تحتاج موافقة المدير العام.")
                : undefined
            }
          />
        )}
        {needsFollowUp && (
          <TextInput
            type="date"
            value={followUpAt}
            onChange={(e) => setFollowUpAt(e.target.value)}
            label={translate("Follow-up date", "تاريخ المتابعة")}
            description={translate("A calendar date - shown exactly as entered.", "تاريخ تقويمي - يُعرض كما أُدخل تماماً.")}
            required
            autoFocus={!needsLostReason && !needsValue}
          />
        )}
        {overrideMode && (
          <Textarea
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            label={translate("Reason for the override (required)", "سبب التجاوز (مطلوب)")}
            placeholder={translate("e.g. Customer already qualified on a call with the MD", "مثال: تم تأهيل العميل بالفعل في مكالمة مع المدير العام")}
            autosize
            minRows={2}
            maxLength={500}
            required
          />
        )}

        <div className="flex gap-2 pt-1">
          <Button onClick={onClose} variant="light" color="dark" fullWidth>
            {translate("Cancel", "إلغاء")}
          </Button>
          <Button onClick={submit} loading={loading} disabled={disabled} fullWidth color={overrideMode ? "orange" : "teal"}>
            {overrideMode ? translate("Override and move", "تجاوز ونقل") : translate("Confirm", "تأكيد")}
          </Button>
        </div>
        {error && <ErrorAlert error={error} />}
      </div>
    </Modal>
  );
}
