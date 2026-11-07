import { Badge } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { CommercialProject, CommercialRevision } from "@/types/commercial";
import { formatAmount } from "@/utils/helpers/format-amount";
import SectionCard from "@/components/ui/section-card";

export default function OverviewTab({ project, revision }: { project: CommercialProject; revision: CommercialRevision | null; onChanged: () => void }) {
  const { translate } = useLanguage();

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex justify-between gap-3 border-b border-gray-50 py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800">{value ?? "-"}</span>
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <SectionCard title={translate("Project Details", "تفاصيل المشروع")}>
        <Row label={translate("Customer", "العميل")} value={project.customer?.name} />
        <Row label={translate("Country", "الدولة")} value={project.country} />
        <Row label={translate("Region / Location", "المنطقة / الموقع")} value={project.region} />
        <Row label={translate("Scope", "النطاق")} value={project.scope} />
        <Row label={translate("Currency", "العملة")} value={project.currency} />
        <Row label={translate("Created By", "تم الإنشاء بواسطة")} value={project.createdBy?.name} />
        <Row
          label={translate("Engineering Approval", "الموافقة الفنية")}
          value={<Badge color={project.engineeringApprovalRollup === "APPROVED" ? "teal" : "gray"} variant="light">{project.engineeringApprovalRollup}</Badge>}
        />
        <Row
          label={translate("Commercial Approval", "الموافقة التجارية")}
          value={<Badge color={project.commercialApprovalRollup === "APPROVED" ? "teal" : "gray"} variant="light">{project.commercialApprovalRollup}</Badge>}
        />
      </SectionCard>

      <SectionCard title={translate("Current Revision", "النسخة الحالية")}>
        {!revision ? (
          <p className="text-sm text-gray-500">
            {translate("No engineering input entered yet - start on the Engineering Input tab.", "لم يتم إدخال المدخلات الفنية بعد - ابدأ من تبويب المدخلات الفنية.")}
          </p>
        ) : (
          <>
            <Row label={translate("Revision", "النسخة")} value={`#${revision.revisionNumber}`} />
            <Row label={translate("BOQ Total (Materials)", "إجمالي جدول الكميات (المواد)")} value={formatAmount(revision.boqTotal, project.currency)} />
            <Row label={translate("Net Price (excl. VAT)", "السعر الصافي (قبل الضريبة)")} value={formatAmount(revision.pricing?.netExclVat, project.currency)} />
            <Row label={translate("Final Price (incl. VAT)", "السعر النهائي (شامل الضريبة)")} value={formatAmount(revision.pricing?.grossInclVat, project.currency)} />
            <Row label={translate("Gross Profit", "الربح الإجمالي")} value={revision.pricing?.grossProfitPct != null ? `${(revision.pricing.grossProfitPct * 100).toFixed(1)}%` : "-"} />
            <Row label={translate("Release Status", "حالة الإصدار")} value={<Badge color={revision.releaseStatus === "APPROVED FOR ISSUE" ? "teal" : "yellow"} variant="light">{revision.releaseStatus}</Badge>} />
          </>
        )}
      </SectionCard>
    </div>
  );
}
