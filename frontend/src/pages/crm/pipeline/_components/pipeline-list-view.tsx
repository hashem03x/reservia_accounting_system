import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { formatDate } from "@/utils/helpers/date-formaters";
import { formatAmount } from "@/utils/helpers/format-amount";
import paths from "@/utils/constants/paths";
import { CrmLead } from "@/types/crm";
import { crmStageLabel, stageBadgeColor } from "../../_shared/stage";
import { channelLabel } from "../../_shared/lead-display";
import { Badge, Table } from "@mantine/core";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import { ClickableRow } from "@/components/ui/clickable-row";
import TruncatedText from "@/components/ui/truncated-text";
import EmptySection from "@/components/ui/sections/empty";

// The pipeline board's List view - a flat table over the SAME already-loaded, already-filtered
// leads the Kanban board renders (no second API request), matching the standalone Leads list
// page's (pages/crm/leads/index.tsx) exact column choices so a rep sees the same shape of data
// whichever view they prefer.
export default function PipelineListView({ leads }: { leads: CrmLead[] }) {
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();

  if (leads.length === 0) return <EmptySection message={translate("No leads match these filters", "لا يوجد عملاء محتملون يطابقون هذه الفلاتر")} />;

  return (
    <DataTableContainer>
      <DataTable className="min-w-[1000px]">
        <Table.Thead className={dataTableHeadClassName}>
          <Table.Tr>
            <Table.Th>{translate("Ref", "الرمز")}</Table.Th>
            <Table.Th>{translate("Name", "الاسم")}</Table.Th>
            <Table.Th>{translate("Phone", "الهاتف")}</Table.Th>
            <Table.Th>{translate("Stage", "المرحلة")}</Table.Th>
            <Table.Th>{translate("Source", "المصدر")}</Table.Th>
            <Table.Th>{translate("Owner", "المسؤول")}</Table.Th>
            <Table.Th className="text-right">{translate("Value", "القيمة")}</Table.Th>
            <Table.Th>{translate("Created", "تاريخ الإنشاء")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {leads.map((lead) => (
            <ClickableRow key={lead._id} onClick={() => navigate(`/${paths.crm}/${paths.leads}/${lead._id}`)}>
              <Table.Td className="whitespace-nowrap font-mono text-xs">{lead.refCode}</Table.Td>
              <Table.Td>
                <TruncatedText text={lead.name || "-"} maxWidthClassName="max-w-[160px]" />
              </Table.Td>
              <Table.Td className="whitespace-nowrap" dir="ltr">
                {lead.phoneE164}
              </Table.Td>
              <Table.Td className="whitespace-nowrap">
                <Badge color={stageBadgeColor(lead.stage)} variant="light">
                  {crmStageLabel(translate)(lead.stage)}
                </Badge>
              </Table.Td>
              <Table.Td className="whitespace-nowrap">{channelLabel(translate)(lead.channel)}</Table.Td>
              <Table.Td className="whitespace-nowrap">{lead.owner?.name || "-"}</Table.Td>
              <Table.Td className="whitespace-nowrap text-right tabular-nums">{lead.valueEgp ? formatAmount(lead.valueEgp, translations.currency) : "-"}</Table.Td>
              <Table.Td className="whitespace-nowrap">{formatDate(lead.createdAt, language)}</Table.Td>
            </ClickableRow>
          ))}
        </Table.Tbody>
      </DataTable>
    </DataTableContainer>
  );
}
