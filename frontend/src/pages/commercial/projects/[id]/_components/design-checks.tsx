import { Badge } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import SectionCard from "@/components/ui/section-card";
import { CommercialRevision } from "@/types/commercial";
import { ruleVersionLabel } from "../../../_shared/ruleVersion";

type DcAc = { ratio: number; target: { min: number; max: number }; flagLimits: { below: number; above: number }; status: "in-range" | "outside-target" | "below" | "above"; flagged: boolean; forced: boolean };

// Deal Engine C3 / C5 / C11 - the design checks for the current revision: the selected inverter and
// its DC/AC ratio against the configured target (flagged below 1.00 / above 1.35 by default), the
// performance ratio once irradiation is entered, and the rule version the revision was calculated with.
export default function DesignChecks({ revision }: { revision: CommercialRevision | null }) {
  const { translate } = useLanguage();
  if (!revision) return null;
  const d = revision.engineeringResult as { inverter?: { model: string; brand?: string; ratedKw: number }; dcAc?: DcAc | null; dcAcRatio?: number };
  const perf = (revision.feasibility as { performance?: { performanceRatio: number | null; status: string } } | null)?.performance;
  if (!d?.inverter && !perf) return null;
  const dcAc = d.dcAc;
  const color = !dcAc ? "gray" : dcAc.status === "in-range" ? "teal" : dcAc.flagged ? "red" : "yellow";
  const statusText = !dcAc
    ? translate("calculated before the loading rule", "حُسب قبل قاعدة التحميل")
    : dcAc.status === "in-range"
      ? translate("in the target range", "ضمن النطاق المستهدف")
      : dcAc.status === "below"
        ? translate("BELOW range - inverter oversized", "أقل من النطاق - العاكس أكبر من اللازم")
        : dcAc.status === "above"
          ? translate("ABOVE range - inverter undersized", "أعلى من النطاق - العاكس أصغر من اللازم")
          : translate("outside the target band (no Price Book inverter fits it)", "خارج النطاق المستهدف (لا يوجد عاكس مناسب في قائمة الأسعار)");
  return (
    <SectionCard title={translate("Design checks", "مراجعات التصميم")}>
      <div className="flex flex-col gap-2 text-sm" data-testid="design-checks">
        {d.inverter && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-gray-500">{translate("Inverter", "العاكس")}</span>
            <span className="font-medium">
              {d.inverter.brand ? `${d.inverter.brand} ` : ""}
              {d.inverter.model} ({d.inverter.ratedKw} kW){dcAc?.forced ? ` - ${translate("forced by the estimator", "مختار يدوياً")}` : ""}
            </span>
          </div>
        )}
        {(dcAc || d.dcAcRatio != null) && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-gray-500">
              {translate("DC/AC ratio", "نسبة DC/AC")}
              {dcAc ? ` (${translate("target", "المستهدف")} ${dcAc.target.min.toFixed(2)} - ${dcAc.target.max.toFixed(2)})` : ""}
            </span>
            <span className="flex items-center gap-2">
              <strong>{(dcAc?.ratio ?? d.dcAcRatio ?? 0).toFixed(2)}</strong>
              <Badge color={color} variant="light" data-testid="dcac-status">
                {statusText}
              </Badge>
            </span>
          </div>
        )}
        {perf && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-gray-500">{translate("Performance ratio (IEC 61724-1)", "نسبة الأداء (IEC 61724-1)")}</span>
            <span className="font-medium">
              {perf.performanceRatio != null ? `${(perf.performanceRatio * 100).toFixed(1)}%` : translate("Pending - enter the in-plane irradiation below", "قيد الانتظار - أدخل الإشعاع أدناه")}
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>{translate("Rule version", "إصدار القواعد")}</span>
          <span>{ruleVersionLabel(revision)}</span>
        </div>
      </div>
    </SectionCard>
  );
}
