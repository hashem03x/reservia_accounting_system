import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { CRM_LOST_REASONS, CrmLead, CrmStage } from "@/types/crm";
import { crmStageLabel } from "../../_shared/stage";
import { MD_APPROVAL_THRESHOLD_EGP, stageExtraFieldRequirements } from "../../_shared/lead-display";
import { Button, NumberInput, Select, TextInput } from "@mantine/core";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";

// Collects the ONE extra field a stage change needs (lost reason / won value / follow-up date)
// before the SAME PATCH .../stage leads/[id]/index.tsx#StageChangeCard already uses is actually
// sent - shared by the pipeline board's card menu and its drag-and-drop drop handler, so neither
// path can ever submit an incomplete stage change the backend would reject anyway.
export default function QuickStageChangeModal({
  lead,
  to,
  onClose,
  onChanged,
}: {
  lead: CrmLead | null;
  to: CrmStage | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { language, translate } = useLanguage();
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  const [lostReason, setLostReason] = useState("");
  const [valueEgp, setValueEgp] = useState<string | number>("");
  const [followUpAt, setFollowUpAt] = useState("");

  const opened = !!lead && !!to;
  const { needsLostReason, needsValue, needsFollowUp } = stageExtraFieldRequirements(to || "");

  useEffect(() => {
    if (opened) {
      setLostReason("");
      setValueEgp(lead?.valueEgp ?? "");
      setFollowUpAt("");
      setError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?._id, to]);

  function submit() {
    if (!lead || !to) return;
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({
        language,
        method: "PATCH",
        url: `crm/leads/${lead._id}/stage`,
        data: {
          to,
          lostReason: needsLostReason ? lostReason : undefined,
          valueEgp: needsValue && valueEgp !== "" ? Number(valueEgp) : undefined,
          followUpAt: needsFollowUp ? followUpAt : undefined,
        },
      });
      onChanged();
      onClose();
    });
  }

  const disabled = (needsLostReason && !lostReason) || (needsValue && !valueEgp) || (needsFollowUp && !followUpAt);

  return (
    <Modal opened={opened} onClose={onClose} title={to ? translate(`Move to ${crmStageLabel(translate)(to)}`, `نقل إلى ${crmStageLabel(translate)(to)}`) : ""} size="sm">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-500">
          {lead?.name || lead?.phoneE164} - <span className="font-mono">{lead?.refCode}</span>
        </p>

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
            required
            autoFocus
          />
        )}

        <div className="flex gap-2 pt-1">
          <Button onClick={onClose} variant="light" color="dark" fullWidth>
            {translate("Cancel", "إلغاء")}
          </Button>
          <Button onClick={submit} loading={loading} disabled={disabled} fullWidth color="teal">
            {translate("Confirm", "تأكيد")}
          </Button>
        </div>
        {error && <ErrorAlert error={error} />}
      </div>
    </Modal>
  );
}
