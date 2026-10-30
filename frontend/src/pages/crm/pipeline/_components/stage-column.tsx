import { DragEvent } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { CrmLead, CrmStage } from "@/types/crm";
import { formatAmount } from "@/utils/helpers/format-amount";
import { isObviouslyInvalidDropTarget } from "../../_shared/lead-display";
import { crmStageLabel, stageBadgeColor } from "../../_shared/stage";
import LeadCard from "@/components/global/lead-card";
import { ActionIcon, Tooltip } from "@mantine/core";
import { solidIcons } from "@/components/icons";

// A restrained stage-accent color (a thin top border, not a saturated full-header fill) per
// Mantine's own named colors, so it stays consistent with stageBadgeColor's Badge elsewhere.
const ACCENT_HEX: Record<string, string> = {
  gray: "#9ca3af",
  blue: "#3b82f6",
  indigo: "#6366f1",
  cyan: "#06b6d4",
  yellow: "#eab308",
  orange: "#f97316",
  teal: "#0B7A6E",
  red: "#ef4444",
};

export default function StageColumn({
  stage,
  count,
  valueEgp,
  leads,
  collapsed,
  onToggleCollapse,
  draggingFromStage,
  draggingLeadId,
  isDragOver,
  movingLeadId,
  onDragStartCard,
  onDragEndCard,
  onDragOverColumn,
  onDragLeaveColumn,
  onDropColumn,
  onOpenLead,
  onRequestStageChange,
}: {
  stage: CrmStage;
  count: number;
  valueEgp: number;
  leads: CrmLead[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  draggingFromStage: CrmStage | null;
  draggingLeadId: string | null;
  isDragOver: boolean;
  movingLeadId: string | null;
  onDragStartCard: (e: DragEvent<HTMLDivElement>, lead: CrmLead) => void;
  onDragEndCard: (e: DragEvent<HTMLDivElement>) => void;
  onDragOverColumn: (e: DragEvent<HTMLDivElement>, stage: CrmStage) => void;
  onDragLeaveColumn: () => void;
  onDropColumn: (e: DragEvent<HTMLDivElement>, stage: CrmStage) => void;
  onOpenLead: (lead: CrmLead) => void;
  onRequestStageChange: (lead: CrmLead, to: CrmStage) => void;
}) {
  const { translate, translations } = useLanguage();

  const isActiveDragging = draggingFromStage !== null;
  const isPossibleTarget = isActiveDragging && !isObviouslyInvalidDropTarget(draggingFromStage!, stage);

  return (
    <div
      className={`flex shrink-0 flex-col rounded-lg border bg-gray-50 transition-colors ${
        isActiveDragging && isDragOver && isPossibleTarget
          ? "border-teal-400 bg-teal-50 dark:border-teal-700 dark:bg-teal-950"
          : isActiveDragging && !isPossibleTarget
            ? "border-gray-100 opacity-50"
            : "border-gray-100"
      } ${collapsed ? "w-[64px]" : "w-[280px]"}`}
      onDragOver={(e) => {
        if (!isPossibleTarget) return;
        e.preventDefault();
        onDragOverColumn(e, stage);
      }}
      onDragLeave={onDragLeaveColumn}
      onDrop={(e) => {
        if (!isPossibleTarget) return;
        e.preventDefault();
        onDropColumn(e, stage);
      }}
    >
      <div
        className="flex items-center justify-between gap-2 rounded-t-lg border-b-2 px-2.5 py-2"
        style={{ borderBottomColor: ACCENT_HEX[stageBadgeColor(stage)] }}
      >
        {collapsed ? (
          <Tooltip label={crmStageLabel(translate)(stage)} position="right">
            <button onClick={onToggleCollapse} className="flex w-full flex-col items-center gap-1 text-gray-600" data-no-row-click>
              <solidIcons.AngleDown style={{ transform: "rotate(-90deg)" }} size={11} />
              <span className="text-xs font-semibold">{count}</span>
            </button>
          </Tooltip>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-gray-700">{crmStageLabel(translate)(stage)}</span>
              <span className="shrink-0 rounded-full bg-gray-200 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-700">{count}</span>
            </div>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={onToggleCollapse} aria-label={translate("Collapse column", "طي العمود")}>
              <solidIcons.AngleUp style={{ transform: "rotate(-90deg)" }} size={12} />
            </ActionIcon>
          </>
        )}
      </div>

      {!collapsed && (
        <>
          {!!valueEgp && <p className="px-2.5 pt-1.5 text-xs text-gray-400">{formatAmount(valueEgp, translations.currency)}</p>}

          <div className="flex min-h-[80px] max-h-[65vh] flex-col gap-2 overflow-y-auto p-2.5">
            {leads.map((lead) => (
              <LeadCard
                key={lead._id}
                lead={lead}
                draggable={movingLeadId === null}
                isDragging={draggingLeadId === lead._id}
                isUpdating={movingLeadId === lead._id}
                onOpen={() => onOpenLead(lead)}
                onRequestStageChange={(to) => onRequestStageChange(lead, to)}
                onDragStart={(e) => onDragStartCard(e, lead)}
                onDragEnd={onDragEndCard}
              />
            ))}
            {leads.length === 0 && <p className="px-1 py-3 text-center text-xs text-gray-400">{translate("No leads", "لا يوجد عملاء")}</p>}
          </div>
        </>
      )}
    </div>
  );
}
