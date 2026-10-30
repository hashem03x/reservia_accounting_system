import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import { formatAmount } from "@/utils/helpers/format-amount";
import { CRM_STAGES, CrmStage } from "@/types/crm";
import { crmStageLabel } from "../../_shared/stage";
import { channelLabel } from "../../_shared/lead-display";
import { Button, SegmentedControl, Select, TextInput } from "@mantine/core";
import { outlineIcons, solidIcons } from "@/components/icons";

export type PipelineFilters = {
  q: string;
  stage: CrmStage | "";
  owner: string;
  channel: string;
};

export default function PipelineHeader({
  totalCount,
  totalValueEgp,
  filters,
  onFiltersChange,
  ownerOptions,
  channelOptions,
  viewMode,
  onViewModeChange,
  refreshing,
  onRefresh,
  onNewLead,
}: {
  totalCount: number;
  totalValueEgp: number;
  filters: PipelineFilters;
  onFiltersChange: (filters: PipelineFilters) => void;
  ownerOptions: { value: string; label: string }[];
  channelOptions: string[];
  viewMode: "kanban" | "list";
  onViewModeChange: (mode: "kanban" | "list") => void;
  refreshing: boolean;
  onRefresh: () => void;
  onNewLead: () => void;
}) {
  const { translate, translations } = useLanguage();
  useDocumentTitle(`${translate("Sales Pipeline", "مسار المبيعات")} | Reservia CRM`);

  const hasActiveFilters = !!(filters.q || filters.stage || filters.owner || filters.channel);
  const set = (patch: Partial<PipelineFilters>) => onFiltersChange({ ...filters, ...patch });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="tracking-tight">{translate("Sales Pipeline", "مسار المبيعات")}</h1>
          <p className="text-sm text-gray-500">
            {translate("Every open, won and lost lead, grouped by stage.", "جميع العملاء المحتملين المفتوحين والمربوحين والخاسرين، مجمعين حسب المرحلة.")}
          </p>
          <div className="flex items-center gap-3 pt-0.5 text-sm">
            <span className="font-medium text-gray-700">
              {totalCount} {translate("leads", "عميل محتمل")}
            </span>
            {!!totalValueEgp && (
              <span className="text-gray-500">
                {translate("Open pipeline value", "قيمة المسار المفتوح")}: <span className="font-semibold text-gray-700">{formatAmount(totalValueEgp, translations.currency)}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl
            value={viewMode}
            onChange={(v) => onViewModeChange(v as "kanban" | "list")}
            data={[
              { value: "kanban", label: <solidIcons.LayoutGrid3 title={translate("Board", "لوحة")} /> },
              { value: "list", label: <outlineIcons.List title={translate("List", "قائمة")} /> },
            ]}
          />
          <Button variant="light" color="gray" onClick={onRefresh} loading={refreshing} leftSection={!refreshing ? <solidIcons.ArrowPath /> : undefined}>
            {translate("Refresh", "تحديث")}
          </Button>
          <Button onClick={onNewLead} color="teal" leftSection={<solidIcons.Plus />}>
            {translate("New Lead", "عميل محتمل جديد")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 bg-white p-2.5">
        <TextInput
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder={translate("Search name, phone or reference...", "بحث بالاسم أو الهاتف أو الرمز المرجعي...")}
          leftSection={<solidIcons.Search size={14} />}
          className="min-w-[220px] flex-1"
        />
        <Select
          value={filters.stage || null}
          onChange={(v) => set({ stage: (v as CrmStage) || "" })}
          data={CRM_STAGES.map((s) => ({ value: s, label: crmStageLabel(translate)(s) }))}
          placeholder={translate("Stage", "المرحلة")}
          clearable
          className="w-[160px]"
        />
        <Select
          value={filters.owner || null}
          onChange={(v) => set({ owner: v || "" })}
          data={ownerOptions}
          placeholder={translate("Owner", "المسؤول")}
          clearable
          searchable
          className="w-[160px]"
        />
        <Select
          value={filters.channel || null}
          onChange={(v) => set({ channel: v || "" })}
          data={channelOptions.map((c) => ({ value: c, label: channelLabel(translate)(c) }))}
          placeholder={translate("Source", "المصدر")}
          clearable
          className="w-[160px]"
        />
        {hasActiveFilters && (
          <Button variant="subtle" color="gray" onClick={() => onFiltersChange({ q: "", stage: "", owner: "", channel: "" })} leftSection={<solidIcons.XMark size={12} />}>
            {translate("Clear filters", "إزالة الفلاتر")}
          </Button>
        )}
      </div>
    </div>
  );
}
