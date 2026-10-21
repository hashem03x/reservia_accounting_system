import { useEffect, useState } from "react";
import { Badge, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import LoadingSection from "@/components/ui/sections/loading";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import { formatRate, inverseRate } from "@/utils/helpers/currency-math";
import { Currency } from "@/types/currency";

/** Read-only details of one currency: current rate both ways, usage, and its full rate history. */
export default function CurrencyDetailsModal({
  opened,
  close,
  currencyId,
  load,
}: {
  opened: boolean;
  close: () => void;
  currencyId: string | null;
  load: (id: string) => Promise<Currency>;
}) {
  const { translate, language } = useLanguage();
  const [currency, setCurrency] = useState<Currency | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!opened || !currencyId) return;
    setCurrency(null);
    handleRequest(language, setLoading, setError, async () => {
      setCurrency(await load(currencyId));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, currencyId]);

  const changedByName = (changedBy: unknown) =>
    changedBy && typeof changedBy === "object" && "name" in changedBy ? String((changedBy as { name: string }).name) : "-";

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={currency ? `${currency.code} - ${currency.name}` : translate("Currency", "العملة")}
      size="lg"
    >
      {error && <ErrorAlert error={error} />}
      {loading && <LoadingSection message={translate("Loading currency...", "جاري تحميل العملة...")} />}
      {currency && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {currency.isBase && (
              <Badge color="blue" variant="filled">
                {translate("Base currency", "العملة الأساسية")}
              </Badge>
            )}
            <Badge color={currency.isActive ? "green" : "gray"} variant="light">
              {currency.isActive ? translate("Active", "نشط") : translate("Inactive", "غير نشط")}
            </Badge>
            <Badge color="gray" variant="outline">
              {translate(`Used by ${currency.usageCount ?? 0} record(s)`, `مستخدمة في ${currency.usageCount ?? 0} سجل`)}
            </Badge>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Info label={translate("Name (Arabic)", "الاسم (عربي)")} value={currency.nameAr || "-"} />
            <Info label={translate("Symbol", "الرمز المختصر")} value={currency.symbol || "-"} />
            <Info
              label={translate("Current rate", "السعر الحالي")}
              value={`1 EGP = ${formatRate(currency.unitsPerBase)} ${currency.code}`}
            />
            <Info
              label={translate("Inverse rate", "السعر العكسي")}
              value={`1 ${currency.code} = ${formatRate(currency.basePerUnit ?? inverseRate(currency.unitsPerBase))} EGP`}
            />
            <Info
              label={translate("Current rate effective from", "يسري السعر الحالي من")}
              value={currency.rateEffectiveDate ? formatDate(currency.rateEffectiveDate, language) : "-"}
            />
          </div>

          {!currency.isBase && (
            <div>
              <h4 className="mb-2 font-semibold">{translate("Rate history", "سجل الأسعار")}</h4>
              <div className="overflow-x-auto">
                <Table striped className="min-w-[520px]">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{translate("Effective from", "يسري من")}</Table.Th>
                      <Table.Th className="text-right">1 EGP =</Table.Th>
                      <Table.Th className="text-right">{`1 ${currency.code} =`}</Table.Th>
                      <Table.Th>{translate("Changed by", "بواسطة")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(currency.rateHistory || []).map((h) => (
                      <Table.Tr key={h._id}>
                        <Table.Td className="whitespace-nowrap">{formatDate(h.effectiveDate, language)}</Table.Td>
                        <Table.Td className="text-right tabular-nums">{`${formatRate(h.unitsPerBase)} ${currency.code}`}</Table.Td>
                        <Table.Td className="text-right tabular-nums">{`${formatRate(inverseRate(h.unitsPerBase))} EGP`}</Table.Td>
                        <Table.Td>{changedByName(h.changedBy)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {translate(
                  "Each journal entry stores the rate it was recorded with; changing a rate never changes existing entries or reports.",
                  "كل قيد يحفظ السعر الذي سُجل به؛ تغيير السعر لا يغيّر القيود أو التقارير الحالية.",
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
