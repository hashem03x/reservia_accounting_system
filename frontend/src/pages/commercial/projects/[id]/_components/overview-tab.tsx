import dayjs from "dayjs";
import { Badge, Button } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import { ApprovalStage, CommercialProject, CommercialRevision } from "@/types/commercial";
import { formatAmount } from "@/utils/helpers/format-amount";
import SectionCard from "@/components/ui/section-card";
import { outlineIcons } from "@/components/icons";
import { STAGE_META, approverName, statusColor } from "../../../_shared/approvalStages";
import { perKwpBasis, ruleVersionLabel } from "../../../_shared/ruleVersion";

export default function OverviewTab({
  project,
  revision,
  onEdit,
}: {
  project: CommercialProject;
  revision: CommercialRevision | null;
  onChanged: () => void;
  onEdit?: () => void;
}) {
  const { translate } = useLanguage();
  const { systems } = useSystemAccess();
  const hasCrm = !!systems?.CRM;

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex justify-between gap-3 border-b border-gray-50 py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-end font-medium text-gray-800">{value ?? "-"}</span>
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <SectionCard
        title={translate("Project Details", "تفاصيل المشروع")}
        action={
          onEdit && (
            <Button size="xs" variant="light" leftSection={<outlineIcons.Edit />} onClick={onEdit} disabled={project.archived}>
              {translate("Edit", "تعديل")}
            </Button>
          )
        }
      >
        <Row label={translate("Customer", "العميل")} value={project.customer?.name} />
        <Row label={translate("Country", "الدولة")} value={project.country} />
        <Row label={translate("Region (Rates matrix)", "المنطقة (جدول الأسعار)")} value={project.region} />
        {project.regionNote && <p className="py-1 text-xs text-amber-700">{project.regionNote}</p>}
        <Row label={translate("Scope", "النطاق")} value={project.scope} />
        <Row label={translate("Currency", "العملة")} value={project.currency} />
        <Row label={translate("Created By", "تم الإنشاء بواسطة")} value={project.createdBy?.name} />
        {project.editHistory && project.editHistory.length > 0 && (
          <Row
            label={translate("Last edited", "آخر تعديل")}
            value={`${dayjs(project.editHistory[project.editHistory.length - 1].at).format("DD MMM YYYY HH:mm")} - ${project.editHistory[project.editHistory.length - 1].byName || ""}`}
          />
        )}
      </SectionCard>

      <SectionCard title={translate("Deal & Identifiers", "الصفقة والأرقام المرجعية")}>
        <Row label={translate("Lead # (CRM)", "رقم العميل المحتمل")} value={project.crmLeadRef ? (hasCrm && project.crmLead ? <a className="text-primary-600 underline" href={`/crm/leads/${project.crmLead}`}>{project.crmLeadRef}</a> : project.crmLeadRef) : translate("Not from CRM", "ليس من CRM")} />
        <Row label={translate("Deal #", "رقم الصفقة")} value={project.dealNumber} />
        <Row label={translate("Proposal # (next)", "رقم العرض (التالي)")} value={project.proposalNumber} />
        <Row label={translate("ERP project # (proposed)", "رقم مشروع ERP (مقترح)")} value={project.proposedErpProjectNumber} />
        <Row label={translate("ERP project # (actual)", "رقم مشروع ERP (فعلي)")} value={project.erpProjectNumber || translate("Assigned when the ERP project is created", "يُحدد عند إنشاء مشروع ERP")} />
        <Row
          label={translate("Outcome", "النتيجة")}
          value={
            <Badge color={project.outcome === "Won" ? "teal" : project.outcome === "Lost" ? "red" : "gray"} variant="light">
              {project.outcome || "Open"}
              {project.lostReason ? ` - ${project.lostReason}` : ""}
            </Badge>
          }
        />
        {project.crmLead && (
          <Row
            label={translate("CRM sync", "مزامنة CRM")}
            value={
              <span>
                <Badge color={project.crmSync?.status === "failed" ? "red" : "teal"} variant="light">
                  {project.crmSync?.status || "-"}
                </Badge>
                {project.crmSync?.lastSyncAt && <span className="ms-2 text-xs text-gray-500">{dayjs(project.crmSync.lastSyncAt).format("DD MMM HH:mm")}</span>}
                {project.crmSync?.lastError && <span className="block text-xs text-red-600">{project.crmSync.lastError}</span>}
              </span>
            }
          />
        )}
        {(project.estimatedValueEgp != null || project.estimatedKwp != null) && (
          <Row
            label={translate("Lead estimate", "تقدير العميل")}
            value={[project.estimatedKwp != null ? `${project.estimatedKwp} kWp` : null, project.estimatedValueEgp != null ? formatAmount(project.estimatedValueEgp, "EGP") : null].filter(Boolean).join(" - ")}
          />
        )}
        {project.leadSource && <Row label={translate("Lead source", "مصدر العميل")} value={[project.leadSource, project.leadCampaign].filter(Boolean).join(" - ")} />}
      </SectionCard>

      <SectionCard title={translate("Current Revision", "النسخة الحالية")}>
        {!revision ? (
          <p className="text-sm text-gray-500">
            {translate("No engineering input entered yet - start on the Engineering Input tab.", "لم يتم إدخال المدخلات الفنية بعد - ابدأ من تبويب المدخلات الفنية.")}
          </p>
        ) : (
          <>
            <Row
              label={translate("Revision", "النسخة")}
              value={
                <span>
                  #{revision.revisionNumber}{" "}
                  <Badge color={revision.status === "Draft" ? "orange" : "teal"} variant="light">
                    {revision.status === "Draft" ? translate("Draft - recalculate", "مسودة - أعد الحساب") : translate("Calculated", "محسوبة")}
                  </Badge>
                </span>
              }
            />
            <Row label={translate("BOQ Total (COGS)", "إجمالي جدول الكميات (التكلفة)")} value={formatAmount(revision.boqTotal, project.currency)} />
            <Row label={translate("Net Price (excl. VAT)", "السعر الصافي (قبل الضريبة)")} value={formatAmount(revision.pricing?.netExclVat, project.currency)} />
            <Row label={translate("Final Price (incl. VAT)", "السعر النهائي (شامل الضريبة)")} value={formatAmount(revision.pricing?.grossInclVat, project.currency)} />
            <Row
              label={
                perKwpBasis(revision) === "installed"
                  ? translate("Price per installed kWp (excl. VAT) - calculated before 12 Nov 2026", "السعر لكل كيلوواط مركب (قبل الضريبة) - حُسب قبل 12 نوفمبر 2026")
                  : translate("Price per design kWp (excl. VAT)", "السعر لكل كيلوواط تصميمي (قبل الضريبة)")
              }
              value={revision.pricing?.perKwpExclVat != null ? `${formatAmount(revision.pricing.perKwpExclVat, project.currency)}${revision.pricing.designKwp ? ` / ${revision.pricing.designKwp} kWp` : ""}` : "-"}
            />
            <Row label={translate("Rule version", "إصدار القواعد")} value={ruleVersionLabel(revision)} />
            {revision.priceChangedSinceCalculation && (
              <Row label={translate("Prices", "الأسعار")} value={<Badge color="orange" variant="light" data-testid="overview-price-changed">{translate("Price changed since calculation - recalculate", "تغيّر السعر منذ الحساب - أعد الحساب")}</Badge>} />
            )}
            <Row label={translate("Gross Profit", "الربح الإجمالي")} value={revision.pricing?.grossProfitPct != null ? `${(revision.pricing.grossProfitPct * 100).toFixed(1)}%` : "-"} />
            <Row label={translate("Release Status", "حالة الإصدار")} value={<Badge color={revision.releaseStatus === "APPROVED FOR ISSUE" ? "teal" : "yellow"} variant="light">{revision.releaseStatus}</Badge>} />
          </>
        )}
      </SectionCard>

      <SectionCard title={translate("Approvals", "الموافقات")}>
        {!revision ? (
          <p className="text-sm text-gray-500">{translate("Approvals start once a revision is calculated.", "تبدأ الموافقات بعد حساب نسخة.")}</p>
        ) : (
          <>
            {STAGE_META.map((s) => {
              const stage = revision[s.key] as ApprovalStage;
              const notRequired = s.key === "md" && !revision.mdRequired;
              const name = approverName(stage);
              return (
                <Row
                  key={s.key}
                  label={`${translate(s.title.en, s.title.ar)} (${translate(s.who.en, s.who.ar)})`}
                  value={
                    notRequired ? (
                      <span className="text-xs text-gray-400">{translate("Not required (net at or below EGP 1.5M)", "غير مطلوبة (الصافي حتى 1.5 مليون)")}</span>
                    ) : (
                      <span>
                        <Badge color={statusColor(stage.status)} variant="light">{stage.status}</Badge>
                        {name && <span className="ms-2 text-xs text-gray-500">{name}{stage.decidedAt ? ` - ${dayjs(stage.decidedAt).format("DD MMM YYYY")}` : ""}</span>}
                      </span>
                    )
                  }
                />
              );
            })}
            {revision.waitingOn && <p className="pt-2 text-xs text-gray-500">{translate("Waiting on", "في انتظار")}: {revision.waitingOn}</p>}
          </>
        )}
      </SectionCard>
    </div>
  );
}
