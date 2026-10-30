import { DragEvent, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { CRM_STAGES, CrmLead, CrmStage } from "@/types/crm";
import { formatAmount } from "@/utils/helpers/format-amount";
import copyToClipboard from "@/utils/helpers/copy-to-clipboard";
import { channelLabel, isLeadOverdue, isObviouslyInvalidDropTarget, ownerInitials, segmentLabel, timeAgo } from "@/pages/crm/_shared/lead-display";
import { crmStageLabel } from "@/pages/crm/_shared/stage";
import { ActionIcon, Avatar, Badge, Menu, Tooltip } from "@mantine/core";
import { outlineIcons, solidIcons } from "@/components/icons";

// The reusable Reservia CRM lead card (pipeline board + pipeline list view). Renders only fields
// the backend actually returns on a Lead (types/crm.ts) - there is no "company"/"project name"
// field on this model (leads are keyed by phone/name, not a company), so none is shown; adding one
// would mean inventing data the CRM doesn't have.
//
// Every action here works end to end against the existing API: `onOpen` navigates to the real
// lead detail page, `onRequestStageChange` calls the SAME PATCH .../stage endpoint
// leads/[id]/index.tsx#StageChangeCard already uses (the caller decides whether the target stage
// needs an extra field first - see lead-display.ts#stageExtraFieldRequirements), and the
// WhatsApp/call/copy actions are plain tel:/wa.me links and the clipboard API - no backend needed,
// nothing decorative.

export type LeadCardProps = {
  lead: CrmLead;
  draggable: boolean;
  isDragging?: boolean;
  isUpdating?: boolean;
  onOpen: () => void;
  onRequestStageChange: (to: CrmStage) => void;
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void;
};

export default function LeadCard({ lead, draggable, isDragging, isUpdating, onOpen, onRequestStageChange, onDragStart, onDragEnd }: LeadCardProps) {
  const { language, translate, translations } = useLanguage();
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);

  const overdue = isLeadOverdue(lead);
  const followUpOverdue = !!lead.followUpAt && new Date(lead.followUpAt).getTime() < Date.now() && lead.stage !== "won" && lead.stage !== "lost";
  const waNumber = lead.phoneE164.replace(/^\+/, "");

  // Click anywhere on the card opens it, EXCEPT a text selection in progress or a click that
  // originated on a nested interactive control - the same two guards
  // components/ui/clickable-row.tsx already uses for table rows, so a card behaves exactly like
  // the rest of the app's "the whole row/card is clickable" convention.
  function handleCardClick(e: React.MouseEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, [role="menuitem"], [data-no-row-click]')) return;
    onOpen();
  }

  const moveTargets = CRM_STAGES.filter((s) => s !== lead.stage);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={handleCardClick}
      className={`group flex flex-col gap-2 rounded-lg border border-gray-100 bg-white p-3 transition-shadow ${
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${isDragging ? "opacity-40" : "hover:shadow-md"} ${isUpdating ? "pointer-events-none opacity-60" : ""}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`${lead.name || lead.phoneE164} - ${lead.refCode}`}
    >
      {/* A. Identity and status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold text-gray-800" title={lead.name || lead.phoneE164}>
            {lead.name || lead.phoneE164}
          </span>
          <span className="truncate text-xs text-gray-400">{channelLabel(translate)(lead.channel)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {overdue && (
            <Tooltip label={translate("Reply overdue", "الرد متأخر")}>
              <span className="flex h-2 w-2 rounded-full bg-red-500" data-no-row-click />
            </Tooltip>
          )}
          <Menu withArrow width={200} radius={8} shadow="md" position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label={translate("Actions", "إجراءات")} data-no-row-click>
                <solidIcons.MenuKebab />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown dir={translations.dir} data-no-row-click>
              <Menu.Item leftSection={<outlineIcons.Document />} onClick={onOpen}>
                {translate("Open lead details", "فتح تفاصيل العميل")}
              </Menu.Item>
              <Menu.Item
                leftSection={copiedRef ? <solidIcons.Check /> : <outlineIcons.Copy />}
                onClick={() => copyToClipboard(lead.refCode, setCopiedRef)}
              >
                {translate("Copy reference code", "نسخ الرمز المرجعي")}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Label>{translate("Move to", "نقل إلى")}</Menu.Label>
              {moveTargets.map((stage) => (
                <Menu.Item
                  key={stage}
                  disabled={isObviouslyInvalidDropTarget(lead.stage, stage)}
                  onClick={() => onRequestStageChange(stage)}
                >
                  {crmStageLabel(translate)(stage)}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>

      {/* B. Essential business information */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge size="xs" variant="light" color="gray">
          {segmentLabel(translate)(lead.segment)}
        </Badge>
        {lead.governorate && (
          <span className="truncate text-xs text-gray-400">{lead.governorate}</span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          data-no-row-click
          onClick={() => copyToClipboard(lead.phoneE164, setCopiedPhone)}
          className="flex min-w-0 items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          title={translate("Copy phone number", "نسخ رقم الهاتف")}
        >
          {copiedPhone ? <solidIcons.Check size={11} /> : <solidIcons.Phone size={11} />}
          <span className="truncate" dir="ltr">
            {lead.phoneE164}
          </span>
        </button>
        {!!lead.valueEgp && <span className="shrink-0 text-xs font-semibold text-gray-700">{formatAmount(lead.valueEgp, translations.currency)}</span>}
      </div>

      {/* C. Follow-up and ownership */}
      <div className="flex items-center justify-between gap-2 border-t border-gray-50 pt-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {lead.owner ? (
            <>
              <Avatar size={18} radius="xl" color="teal" variant="light">
                <span className="text-[9px] font-semibold">{ownerInitials(lead.owner.name)}</span>
              </Avatar>
              <span className="truncate text-xs text-gray-500">{lead.owner.name}</span>
            </>
          ) : (
            <span className="text-xs text-gray-400">{translate("Unassigned", "غير مخصص")}</span>
          )}
        </div>
        <Tooltip label={translate("Last updated", "آخر تحديث")}>
          <span className="shrink-0 text-[11px] text-gray-400">{timeAgo(lead.updatedAt, language)}</span>
        </Tooltip>
      </div>

      {lead.followUpAt && (
        <div className={`flex items-center gap-1 text-[11px] ${followUpOverdue ? "text-red-600 dark:text-red-400" : "text-gray-400"}`}>
          <solidIcons.Calendar size={10} />
          <span>
            {translate("Follow-up", "المتابعة")}: {new Date(lead.followUpAt).toLocaleDateString(language, { day: "numeric", month: "short" })}
            {followUpOverdue && ` (${translate("overdue", "متأخر")})`}
          </span>
        </div>
      )}

      {/* D. Bottom row - quick contact actions */}
      <div className="flex items-center gap-1 border-t border-gray-50 pt-2" data-no-row-click>
        <Tooltip label={translate("Chat on WhatsApp", "محادثة على واتساب")}>
          <ActionIcon
            component="a"
            href={`https://wa.me/${waNumber}`}
            target="_blank"
            rel="noopener noreferrer"
            draggable={false}
            variant="light"
            color="teal"
            size="sm"
            aria-label="WhatsApp"
          >
            <solidIcons.Whatsapp size={13} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={translate("Call", "اتصال")}>
          <ActionIcon component="a" href={`tel:${lead.phoneE164}`} draggable={false} variant="light" color="gray" size="sm" aria-label={translate("Call", "اتصال")}>
            <solidIcons.Phone size={12} />
          </ActionIcon>
        </Tooltip>
      </div>
    </div>
  );
}
