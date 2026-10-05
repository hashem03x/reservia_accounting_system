import { Skeleton } from "@mantine/core";
import { DashboardSummary } from "@/types/dashboard";
import { useLanguage } from "@/context/LanguageContext";
import { formatCurrency } from "@/utils/helpers/format-currency";
import SectionCard from "@/components/ui/section-card";
import EmptySection from "@/components/ui/sections/empty";
import ErrorSection from "@/components/ui/sections/error";
import paths from "@/utils/constants/paths";

// Cash & Cash Equivalents position (docs section "Cash & Cash Equivalents") - the account list and
// each balance come straight from GET /dashboard/summary, which classifies eligible accounts
// using the exact same two-signal query as isPaymentAccountEligible()/getCashEquivalentAccounts -
// never a second/looser definition of "cash" invented for the dashboard.
export default function CashPositionSection({
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

  return (
    <SectionCard
      title={translate("Cash & Cash Equivalents", "النقدية وما يعادلها")}
      viewAllTo={`/${paths.admin}/${paths.accounts}`}
      viewAllLabel={translate("View accounts", "عرض الحسابات")}
    >
      {error ? (
        <ErrorSection
          errorTitle={translate("Error loading cash position", "خطأ في تحميل الوضع النقدي")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: onRetry }}
        />
      ) : loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton height={16} />
          <Skeleton height={16} />
          <Skeleton height={16} />
        </div>
      ) : !summary || summary.cash.accounts.length === 0 ? (
        <EmptySection
          useDefaultImg
          message={translate("No Cash/Cash-Equivalent accounts configured", "لا توجد حسابات نقدية مُعدة")}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {summary.cash.accounts.map((account) => (
            <div key={account._id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-gray-600 dark:text-gray-300">
                {account.code} - {account.name}
              </span>
              <span className="shrink-0 font-medium tabular-nums text-gray-800 dark:text-gray-100">
                {formatCurrency(account.balance, language)}
              </span>
            </div>
          ))}
          <hr className="border-gray-100 dark:border-gray-700" />
          <div className="flex items-center justify-between gap-2 text-sm font-semibold">
            <span className="text-gray-800 dark:text-gray-100">{translate("Total", "الإجمالي")}</span>
            <span className="tabular-nums text-gray-800 dark:text-gray-100">
              {formatCurrency(summary.cash.total, language)}
            </span>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
