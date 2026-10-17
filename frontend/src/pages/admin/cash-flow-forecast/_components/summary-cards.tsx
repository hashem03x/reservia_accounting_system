import { useLanguage } from "@/context/LanguageContext";
import { CashFlowForecast } from "@/types/cashflow";

export default function SummaryCards({ forecast }: { forecast: CashFlowForecast }) {
  const { translate, translations } = useLanguage();
  const { totals, shortfallProjects } = forecast;

  const cards: { label: string; value: string; tone?: "good" | "bad" | "warn" }[] = [
    { label: translate("Opening Balance", "الرصيد الافتتاحي"), value: fmt(totals.openingBalance) },
    { label: translate("Expected Receipts", "المقبوضات المتوقعة"), value: fmt(totals.expectedReceipts), tone: "good" },
    { label: translate("Expected Payments", "المدفوعات المتوقعة"), value: fmt(totals.expectedPayments), tone: "bad" },
    { label: translate("Net Projected Cash Flow", "صافي التدفق النقدي المتوقع"), value: fmt(totals.netProjected), tone: totals.netProjected >= 0 ? "good" : "bad" },
    { label: translate("Projected Closing Balance", "الرصيد الختامي المتوقع"), value: fmt(totals.closingBalance), tone: totals.closingBalance >= 0 ? "good" : "bad" },
    { label: translate("Overdue Receivables", "مستحقات متأخرة"), value: fmt(totals.overdueReceipts), tone: totals.overdueReceipts > 0 ? "warn" : undefined },
    { label: translate("Overdue Payables", "مدفوعات متأخرة"), value: fmt(totals.overduePayments), tone: totals.overduePayments > 0 ? "warn" : undefined },
    {
      label: translate("Unscheduled (Receipts / Payments)", "غير مجدول (مقبوضات / مدفوعات)"),
      value: `${fmt(totals.unscheduledReceipts)} / ${fmt(totals.unscheduledPayments)}`,
    },
  ];

  function fmt(n: number) {
    return `${n.toLocaleString()} ${translations.currency}`;
  }

  const toneClass: Record<string, string> = {
    good: "text-green-700",
    bad: "text-red-600",
    warn: "text-amber-600",
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <span className="text-xs text-gray-500">{card.label}</span>
          <span className={`font-semibold ${card.tone ? toneClass[card.tone] : ""}`}>{card.value}</span>
        </div>
      ))}
      {shortfallProjects.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950 sm:col-span-2 lg:col-span-4">
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
            {translate("Projects with a potential cash shortfall", "مشاريع بها عجز نقدي متوقع")}
          </span>
          <div className="flex flex-wrap gap-2">
            {shortfallProjects.map((s) => (
              <span key={s.project._id} className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-300">
                {s.project.projectNumber} ({fmt(s.net)})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
