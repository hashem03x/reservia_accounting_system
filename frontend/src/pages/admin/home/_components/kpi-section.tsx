import { DashboardSummary } from "@/types/dashboard";
import { useLanguage } from "@/context/LanguageContext";
import { formatCurrency } from "@/utils/helpers/format-currency";
import KpiCard from "@/components/ui/kpi-card";
import ErrorSection from "@/components/ui/sections/error";
import { outlineIcons, solidIcons } from "@/components/icons";

// Top KPI row (docs section "Top KPI Section") - only figures the application has reliable
// underlying data for, all sourced from the single GET /dashboard/summary aggregation. No value
// here is invented or recomputed client-side.
export default function KpiSection({
  summary,
  loading,
  error,
  onRetry,
}: {
  summary: DashboardSummary | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  const { language, translate } = useLanguage();

  if (error) {
    return (
      <ErrorSection
        errorTitle={translate("Error loading summary", "خطأ في تحميل الملخص")}
        errorMessage={error}
        button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: onRetry }}
      />
    );
  }

  const cards = [
    {
      label: translate("Contract Value", "قيمة العقد"),
      value: formatCurrency(summary?.projects.totalContractValue ?? 0, language),
      subValue: `${summary?.projects.activeCount ?? 0} ${translate("active projects", "مشروع نشط")}`,
      icon: <outlineIcons.Document size={16} />,
    },
    {
      label: translate("Executed", "المنفذ"),
      value: `${summary?.projects.executedPercentage ?? 0}%`,
      subValue: translate("Of active projects' contract value", "من قيمة عقود المشاريع النشطة"),
      icon: <solidIcons.ArrowUp size={14} />,
    },
    {
      label: translate("Sales", "المبيعات"),
      value: formatCurrency(summary?.sales.total ?? 0, language),
      subValue: `${summary?.sales.count ?? 0} ${translate("orders, excl. tax", "طلب، بدون ضريبة")}`,
    },
    {
      label: translate("Purchases", "المشتريات"),
      value: formatCurrency(summary?.purchases.total ?? 0, language),
      subValue: `${summary?.purchases.count ?? 0} ${translate("orders, excl. tax", "طلب، بدون ضريبة")}`,
    },
    {
      label: translate("Cash & Cash Equivalents", "النقدية وما يعادلها"),
      value: formatCurrency(summary?.cash.total ?? 0, language),
      subValue: `${summary?.cash.accounts.length ?? 0} ${translate("accounts", "حساب")}`,
    },
    {
      label: translate("Receivables", "المستحقات"),
      value: formatCurrency(summary?.receivables.total ?? 0, language),
      subValue: translate("Outstanding from customers", "مستحقة من العملاء"),
    },
    {
      label: translate("Payables", "المستحقات للدفع"),
      value: formatCurrency(summary?.payables.total ?? 0, language),
      subValue: translate("Outstanding to suppliers", "مستحقة للموردين"),
    },
  ];

  // Capped at 4 columns even on very large screens (7 cards wrap to a clean 4+3) rather than
  // forcing all seven into one row - cramming 7 columns left too little width per card for a long
  // formatted currency value like "EGP 2,100,000.00" to fit (docs section "Responsive Grid").
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {cards.map((card) => (
        <KpiCard key={card.label} loading={loading} {...card} />
      ))}
    </div>
  );
}
