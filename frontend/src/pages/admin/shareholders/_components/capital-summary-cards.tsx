import { useLanguage } from "@/context/LanguageContext";
import { formatAmount } from "@/utils/helpers/format-amount";
import { CompanyCapital } from "@/types/company-capital";
import { Button, Progress } from "@mantine/core";
import KpiCard from "@/components/ui/kpi-card";
import { solidIcons } from "@/components/icons";

// Company Capital Overview (brief section 1 + 6): three summary cards (Issued / Paid-in / Unpaid)
// plus a paid-in-vs-issued progress indicator - reuses the app's existing KpiCard, the same
// financial-summary tile used on the main dashboard, rather than a new card design.
export default function CapitalSummaryCards({
  capital,
  loading,
  canEdit,
  onEditIssuedCapital,
}: {
  capital: CompanyCapital;
  loading: boolean;
  canEdit: boolean;
  onEditIssuedCapital: () => void;
}) {
  const { translate, translations } = useLanguage();
  const money = (v: number | undefined) => formatAmount(v, translations.currency);
  const paidPct = capital && capital.issuedCapital > 0 ? Math.min(100, Math.round((capital.paidInCapital / capital.issuedCapital) * 1000) / 10) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3>{translate("Company Capital", "رأس مال الشركة")}</h3>
        {canEdit && (
          <Button variant="light" size="xs" onClick={onEditIssuedCapital} leftSection={<solidIcons.Hashtag size={11} />}>
            {capital ? translate("Edit Issued Capital", "تعديل رأس المال المصدر") : translate("Set Issued Capital", "تحديد رأس المال المصدر")}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard loading={loading} label={translate("Issued Capital", "رأس المال المصدر")} value={capital ? money(capital.issuedCapital) : "-"} />
        <KpiCard
          loading={loading}
          label={translate("Paid-in Capital", "رأس المال المسدد")}
          value={capital ? money(capital.paidInCapital) : "-"}
          subValue={capital ? `${paidPct}% ${translate("of issued capital", "من رأس المال المصدر")}` : undefined}
        />
        <KpiCard loading={loading} label={translate("Unpaid Capital", "رأس المال غير المسدد")} value={capital ? money(capital.unpaidCapital) : "-"} />
      </div>

      {capital && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{translate("Paid-in vs. Issued Capital", "المسدد مقابل رأس المال المصدر")}</span>
            <span className="tabular-nums">{paidPct}%</span>
          </div>
          <Progress value={paidPct} color="teal" size="sm" radius="xl" />
        </div>
      )}

      {!capital && !loading && (
        <p className="text-sm text-gray-400" dir={translations.dir === "rtl" ? "rtl" : "ltr"}>
          {translate(
            "Issued Capital has not been set yet - set it before adding shareholders and recording payments.",
            "لم يتم تحديد رأس المال المصدر بعد - حدده قبل إضافة المساهمين وتسجيل المدفوعات.",
          )}
        </p>
      )}
    </div>
  );
}
