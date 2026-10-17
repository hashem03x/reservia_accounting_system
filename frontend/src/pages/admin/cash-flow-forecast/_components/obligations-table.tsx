import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Table, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { formatDate } from "@/utils/helpers/date-formaters";
import paths from "@/utils/constants/paths";
import { CashFlowObligation, CashFlowObligationStatus } from "@/types/cashflow";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";

const statusColors: Record<CashFlowObligationStatus, string> = {
  forecast: "blue",
  due_soon: "yellow",
  overdue: "red",
  partially_paid: "yellow",
  unscheduled: "gray",
  draft: "gray",
  cannot_calculate: "red",
};

export default function ObligationsTable({ inflows, outflows }: { inflows: CashFlowObligation[]; outflows: CashFlowObligation[] }) {
  const { translate, language } = useLanguage();
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState("");

  const statusLabel = (status: CashFlowObligationStatus) =>
    ({
      forecast: translate("Forecast", "متوقع"),
      due_soon: translate("Due Soon", "يستحق قريباً"),
      overdue: translate("Overdue", "متأخر"),
      partially_paid: translate("Partially Paid", "مدفوع جزئياً"),
      unscheduled: translate("Unscheduled", "غير مجدول"),
      draft: translate("PO Still Draft", "أمر الشراء لم يُفتح بعد"),
      cannot_calculate: translate("Cannot Calculate", "لا يمكن الحساب"),
    })[status] || status;

  const rows = useMemo(() => {
    const all = [...inflows, ...outflows].sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
    if (!keyword.trim()) return all;
    const k = keyword.trim().toLowerCase();
    return all.filter((o) => (o.code || "").toLowerCase().includes(k) || (o.requisition?.code || "").toLowerCase().includes(k));
  }, [inflows, outflows, keyword]);

  function goToSource(o: CashFlowObligation) {
    if (o.source === "salesOrder") navigate(`/${paths.admin}/${paths.home}/${paths.salesOrders}/${o.sourceId}`);
    else if (o.source === "purchaseInvoice") navigate(`/${paths.admin}/${paths.home}/${paths.purchaseOrders}/${o.sourceId}`);
    else if (o.source === "requisition") navigate(`/${paths.admin}/${paths.home}/${paths.purchaseRequisitions}/${o.sourceId}`);
    else if (o.source === "project" && o.project) navigate(`/${paths.admin}/${paths.projects}/${o.project._id}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <TextInput
        placeholder={translate("Search by PO / invoice number...", "ابحث برقم أمر الشراء / الفاتورة...")}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        w={280}
      />

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">{translate("No matching obligations.", "لا توجد نتائج مطابقة.")}</p>
      ) : (
        <DataTableContainer>
          <DataTable className="min-w-[980px]">
            <Table.Thead className={dataTableHeadClassName}>
              <Table.Tr>
                <Table.Th>{translate("Direction", "الاتجاه")}</Table.Th>
                <Table.Th>{translate("Code", "الكود")}</Table.Th>
                <Table.Th>{translate("Party", "الطرف")}</Table.Th>
                <Table.Th>{translate("Project", "المشروع")}</Table.Th>
                <Table.Th className="text-right">{translate("Amount", "القيمة")}</Table.Th>
                <Table.Th>{translate("Expected Date", "التاريخ المتوقع")}</Table.Th>
                <Table.Th>{translate("Status", "الحالة")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((o, i) => (
                <Table.Tr key={`${o.source}-${o.sourceId}-${i}`} className="cursor-pointer" onClick={() => goToSource(o)}>
                  <Table.Td className="whitespace-nowrap">
                    <Badge color={o.direction === "in" ? "blue" : "grape"} variant="light">
                      {o.direction === "in" ? translate("Inflow", "داخل") : translate("Outflow", "خارج")}
                    </Badge>
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap">{o.code || o.requisition?.code || "-"}</Table.Td>
                  <Table.Td className="whitespace-nowrap">{o.party?.name || "-"}</Table.Td>
                  <Table.Td className="whitespace-nowrap">{o.project?.projectNumber || "-"}</Table.Td>
                  <Table.Td className="whitespace-nowrap text-right tabular-nums">{o.amount.toLocaleString()}</Table.Td>
                  <Table.Td className="whitespace-nowrap">{o.date ? formatDate(o.date, language) : "-"}</Table.Td>
                  <Table.Td className="whitespace-nowrap">
                    <Badge color={statusColors[o.status] || "gray"} variant="light">
                      {statusLabel(o.status)}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </DataTable>
        </DataTableContainer>
      )}
    </div>
  );
}
