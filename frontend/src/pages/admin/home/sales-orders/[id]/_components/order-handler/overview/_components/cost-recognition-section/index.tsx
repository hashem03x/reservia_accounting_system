import { Link } from "react-router-dom";
import { Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import paths from "@/utils/constants/paths";
import InfoItem from "@/components/ui/info-item";
import { useOrder } from "../../../../../context";

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Cumulative Cost Recognition of this Sales Order (backend: SalesOrder.costRecognition, maintained
 * by accountingEventService.js#recognizeProjectSalesOrderCosts):
 *   Total Recognized Cost = Cost of Items × the project's accumulated Executed %
 *   Current Recognition   = the last change posted (Total - Previously Recognized)
 * Every Executed % change posts only the difference, so e.g. 30% of 400,000 shows a total of
 * 120,000 where 80,000 was already recognized and the current entry is 40,000. All values come
 * from the backend; the line table only shows where Cost of Items comes from.
 */
export default function CostRecognitionSection() {
  const { translate, translations } = useLanguage();
  const { order } = useOrder();

  const money = (value: unknown) =>
    isNumber(value)
      ? `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${translations.currency}`
      : "-";

  const recognition = order.costRecognition;
  // Orders created by the first (one-time) version only carry recognizedCost/journalEntry.
  const total = recognition?.totalRecognizedCost ?? recognition?.recognizedCost;
  const previous = recognition?.previouslyRecognizedCost ?? (isNumber(recognition?.recognizedCost) ? 0 : undefined);
  const current = recognition?.currentRecognition ?? (isNumber(total) && isNumber(previous) ? total - previous : undefined);
  const entryIds = recognition?.journalEntries?.length ? recognition.journalEntries : recognition?.journalEntry ? [recognition.journalEntry] : [];

  const lines = (order.items || []).map((item) => {
    const unitCost = isNumber(item.costWhenSold) ? item.costWhenSold : 0;
    const quantity = Math.max(0, (isNumber(item.starterQuantity) ? item.starterQuantity : 0) - (isNumber(item.returnedQuantity) ? item.returnedQuantity : 0));
    return { item, unitCost, quantity, lineCost: Math.round(unitCost * quantity * 100) / 100 };
  });

  return (
    <section className="flex flex-col gap-3">
      <h4>{translate("Cost Recognition", "الاعتراف بالتكلفة")}</h4>

      {recognition ? (
        <div className="flex flex-col gap-1.5">
          <InfoItem
            label={translate("Accumulated Executed Percentage", "نسبة المنفذ التراكمية")}
            value={isNumber(recognition.executedPercentage) ? `${recognition.executedPercentage.toFixed(2)}%` : "-"}
          />
          <InfoItem label={translate("Cost of Items", "تكلفة الأصناف")} value={money(recognition.costOfItems)} />
          <InfoItem label={translate("Total Recognized Cost", "إجمالي التكلفة المعترف بها")} value={<b>{money(total)}</b>} />
          <InfoItem label={translate("Previously Recognized", "المعترف به سابقاً")} value={money(previous)} />
          <InfoItem
            label={translate("Current Recognition", "الاعتراف الحالي")}
            value={
              isNumber(current) && current < 0
                ? `${money(current)} (${translate("reversed", "تم عكسه")})`
                : money(current)
            }
          />
          {recognition.byAccount?.map((row) => (
            <InfoItem
              key={row.wipAccountCode}
              label={`${translate("Dr", "مدين")} ${row.wipAccountCode} / ${translate("Cr", "دائن")} ${row.costAccountCode}`}
              value={`${money(row.recognizedCost)} ${translate("of", "من")} ${money(row.costOfItems)}`}
            />
          ))}
          {entryIds.length > 0 ? (
            <InfoItem
              label={translate("Journal Entries", "القيود اليومية")}
              value={
                <span className="flex flex-wrap gap-2">
                  {entryIds.map((id, index) => (
                    <Link key={id} to={`/${paths.admin}/${paths.journalEntries}/${id}`} className="text-blue-600 hover:underline">
                      {translate(`Entry ${index + 1}`, `قيد ${index + 1}`)}
                    </Link>
                  ))}
                </span>
              }
            />
          ) : (
            <p className="text-xs text-gray-500">
              {translate("No cost has been recognized for this order yet.", "لم يتم الاعتراف بأي تكلفة لهذا الطلب بعد.")}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-500 sm:text-sm">
          {translate(
            "This order was created before Cost Recognition existed, so no cost is recognized for it.",
            "تم إنشاء هذا الطلب قبل إضافة الاعتراف بالتكلفة، لذلك لا يتم الاعتراف بأي تكلفة له.",
          )}
        </p>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table className="text-sm" withColumnBorders verticalSpacing="xs">
          <Table.Thead className="bg-gray-100 text-gray-800">
            <Table.Tr>
              <Table.Th>{translate("Item", "الصنف")}</Table.Th>
              <Table.Th className="text-right">{translate("Net Quantity", "الكمية الصافية")}</Table.Th>
              <Table.Th className="text-right">{translate("Unit Cost", "تكلفة الوحدة")}</Table.Th>
              <Table.Th className="text-right">{translate("Line Cost", "تكلفة السطر")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="text-gray-800">
            {lines.map(({ item, unitCost, quantity, lineCost }) => (
              <Table.Tr key={item._id}>
                <Table.Td className="max-w-[260px] truncate">
                  {item.product ? translate(item.product.title.en, item.product.title.ar) : translate("Deleted item", "صنف محذوف")}
                </Table.Td>
                <Table.Td className="whitespace-nowrap text-right tabular-nums">{quantity}</Table.Td>
                <Table.Td className="whitespace-nowrap text-right tabular-nums">{money(unitCost)}</Table.Td>
                <Table.Td className="whitespace-nowrap text-right tabular-nums">{money(lineCost)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
    </section>
  );
}
