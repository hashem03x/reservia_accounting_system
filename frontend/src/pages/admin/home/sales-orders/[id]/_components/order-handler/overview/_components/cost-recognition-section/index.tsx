import { Link } from "react-router-dom";
import { Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import paths from "@/utils/constants/paths";
import InfoItem from "@/components/ui/info-item";
import { useOrder } from "../../../../../context";

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Cost Recognition of this Sales Order (backend: SalesOrder.costRecognition, posted as the
 * SO_COST_RECOGNITION journal entry when the order was created):
 *   Recognized Cost = Cost of Items × the project's accumulated Executed % right after this order.
 * Values come from the backend snapshot; the line table only shows where Cost of Items comes from
 * (each line's cost captured at the sale × quantity - a service has no cost).
 */
export default function CostRecognitionSection() {
  const { translate, translations } = useLanguage();
  const { order } = useOrder();

  const money = (value: unknown) =>
    isNumber(value)
      ? `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${translations.currency}`
      : "-";

  const recognition = order.costRecognition;
  const lines = (order.items || []).map((item) => {
    const unitCost = isNumber(item.costWhenSold) ? item.costWhenSold : 0;
    const quantity = isNumber(item.starterQuantity) ? item.starterQuantity : 0;
    return { item, unitCost, quantity, lineCost: Math.round(unitCost * quantity * 100) / 100 };
  });

  return (
    <section className="flex flex-col gap-3">
      <h4>{translate("Cost Recognition", "الاعتراف بالتكلفة")}</h4>

      {recognition ? (
        <div className="flex flex-col gap-1.5">
          <InfoItem
            label={translate("Executed Percentage (project, accumulated)", "نسبة المنفذ (المشروع، تراكمية)")}
            value={isNumber(recognition.executedPercentage) ? `${recognition.executedPercentage.toFixed(2)}%` : "-"}
          />
          <InfoItem label={translate("Cost of Items", "تكلفة الأصناف")} value={money(recognition.costOfItems)} />
          <InfoItem label={translate("Recognized Cost", "التكلفة المعترف بها")} value={<b>{money(recognition.recognizedCost)}</b>} />
          {recognition.journalEntry ? (
            <InfoItem
              label={translate("Journal Entry", "القيد اليومي")}
              value={
                <Link to={`/${paths.admin}/${paths.journalEntries}/${recognition.journalEntry}`} className="text-blue-600 hover:underline">
                  {translate("View entry", "عرض القيد")}
                </Link>
              }
            />
          ) : (
            <p className="text-xs text-gray-500">
              {translate("No journal entry was needed (the recognized cost was 0).", "لم يلزم قيد يومي (التكلفة المعترف بها صفر).")}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-500 sm:text-sm">
          {translate(
            "This order was created before Cost Recognition existed, so no cost was recognized for it.",
            "تم إنشاء هذا الطلب قبل إضافة الاعتراف بالتكلفة، لذلك لم يتم الاعتراف بأي تكلفة له.",
          )}
        </p>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table className="text-sm" withColumnBorders verticalSpacing="xs">
          <Table.Thead className="bg-gray-100 text-gray-800">
            <Table.Tr>
              <Table.Th>{translate("Item", "الصنف")}</Table.Th>
              <Table.Th className="text-right">{translate("Quantity", "الكمية")}</Table.Th>
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
