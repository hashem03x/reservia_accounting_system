import { Link } from "react-router-dom";
import { DashboardSummary } from "@/types/dashboard";
import { useLanguage } from "@/context/LanguageContext";
import { formatCurrency } from "@/utils/helpers/format-currency";
import useHasPermission from "@/hooks/useHasPermission";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import paths from "@/utils/constants/paths";
import KpiCard from "@/components/ui/kpi-card";

// Dashboard Integration (docs section "Dashboard Integration") - a short-horizon summary of the
// same read-only Projected Cash Flow forecast the dedicated page computes. Clicking a card opens
// the full forecast page, scoped to the matching direction where that makes sense.
export default function CashFlowForecastSection({ summary, loading }: { summary: DashboardSummary | null; loading: boolean }) {
  const { language, translate } = useLanguage();
  const canView = useHasPermission(resources.cashFlowForecast, actions.read);

  if (!canView) return null;

  const base = `/${paths.admin}/${paths.cashFlowForecast}`;
  const horizon = summary?.forecast?.horizonDays ?? 30;

  const cards = [
    {
      label: translate(`Expected Receipts (${horizon}d)`, `المقبوضات المتوقعة (${horizon} يوم)`),
      value: formatCurrency(summary?.forecast?.expectedReceipts ?? 0, language),
      to: `${base}?direction=in`,
    },
    {
      label: translate(`Expected Payments (${horizon}d)`, `المدفوعات المتوقعة (${horizon} يوم)`),
      value: formatCurrency(summary?.forecast?.expectedPayments ?? 0, language),
      to: `${base}?direction=out`,
    },
    {
      label: translate("Projected Closing Balance", "الرصيد الختامي المتوقع"),
      value: formatCurrency(summary?.forecast?.closingBalance ?? 0, language),
      subValue: translate("Net", "صافي") + `: ${formatCurrency(summary?.forecast?.netProjected ?? 0, language)}`,
      to: base,
    },
    {
      label: translate("Overdue (Receipts / Payments)", "متأخر (مقبوضات / مدفوعات)"),
      value: `${formatCurrency(summary?.forecast?.overdueReceipts ?? 0, language)} / ${formatCurrency(summary?.forecast?.overduePayments ?? 0, language)}`,
      subValue:
        (summary?.forecast?.shortfallProjectsCount ?? 0) > 0
          ? translate(`${summary?.forecast.shortfallProjectsCount} project(s) at risk`, `${summary?.forecast.shortfallProjectsCount} مشروع معرض للخطر`)
          : undefined,
      to: `${base}?status=overdue`,
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <h4>{translate("Projected Cash Flow", "التدفق النقدي المتوقع")}</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link key={card.label} to={card.to} className="no-underline">
            <KpiCard label={card.label} value={card.value} subValue={card.subValue} loading={loading} />
          </Link>
        ))}
      </div>
    </div>
  );
}
