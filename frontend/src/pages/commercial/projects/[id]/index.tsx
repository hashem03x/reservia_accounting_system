import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Alert, Button, Tabs } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import { outlineIcons } from "@/components/icons";
import { CommercialProject, CommercialRevision, CommercialRole } from "@/types/commercial";
import { categoryLabel } from "../../_shared/categoryLabel";
import { canView, widestLevel, PROJECT_TAB_MATRIX } from "../../_shared/dealEnginePermissions";
import EngineeringTab from "./_components/engineering-tab";
import BoqTab from "./_components/boq-tab";
import PricingTab from "./_components/pricing-tab";
import FeasibilityTab from "./_components/feasibility-tab";
import ApprovalsTab from "./_components/approvals-tab";
import ProposalTab from "./_components/proposal-tab";
import OverviewTab from "./_components/overview-tab";
import CreateProjectModal from "../_components/create-project-modal";

export type RevisionLoaded = CommercialRevision | null;

export default function CommercialProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { translate, language } = useLanguage();
  const { systems } = useSystemAccess();
  const roles = systems?.COMMERCIAL?.role ? [systems.COMMERCIAL.role as CommercialRole] : [];
  const catLabel = categoryLabel(translate);
  const [tab, setTab] = useState<string | null>("overview");
  const [editOpen, setEditOpen] = useState(false);

  // R2-R4/R12: mirrors the backend's own tab matrix - a role that cannot see a tab here could not
  // get its data from the API either (dealEnginePermissions.js on the backend is what actually
  // enforces this; this is the UI reflecting it, never the other way around).
  const showEngineering = canView(widestLevel(PROJECT_TAB_MATRIX.engineeringInputDesign, roles)) || canView(widestLevel(PROJECT_TAB_MATRIX.engineeringInputCustomer, roles));
  const showBoq = canView(widestLevel(PROJECT_TAB_MATRIX.boqLines, roles));
  const showPricing = canView(widestLevel(PROJECT_TAB_MATRIX.pricing, roles));
  const showFeasibility = canView(widestLevel(PROJECT_TAB_MATRIX.feasibility, roles));
  const showApprovals = canView(widestLevel(PROJECT_TAB_MATRIX.approvalsStage1, roles)) || canView(widestLevel(PROJECT_TAB_MATRIX.approvalsStage2, roles));
  const showProposal = canView(widestLevel(PROJECT_TAB_MATRIX.proposal, roles));

  const { privateRequest, loading, setLoading, error, setError, data: project, setData: setProject } = useDataHandler<CommercialProject | null>({
    initialData: null,
    initialLoading: true,
  });
  const [revision, setRevision] = useState<RevisionLoaded>(null);

  function reload() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `commercial/projects/${id}`, language });
      const p = res.data as CommercialProject;
      setProject(p);
      setRevision((p.currentRevision as CommercialRevision) || null);
    });
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useDocumentTitle(`${project?.projectCode || translate("Project", "مشروع")} | Reservia Deal Engine`);

  if (error) {
    return <ErrorSection errorTitle={translate("Error loading the project", "خطأ في تحميل المشروع")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: reload }} />;
  }
  if (loading || !project) return <LoadingSection className="h-screen" />;

  const isDraft = revision?.status === "Draft";

  return (
    <AdminLayoutBox
      header={{
        title: `${project.projectCode} - ${project.name}`,
        subTitle: `${catLabel(project.category)}${project.subCategory ? ` - ${project.subCategory}` : ""} - ${[project.country, project.region].filter(Boolean).join(", ")}${project.dealNumber ? ` - ${project.dealNumber}` : ""}`,
        backLink: true,
        sideElements: (
          <Button variant="default" leftSection={<outlineIcons.Edit />} onClick={() => setEditOpen(true)} disabled={project.archived}>
            {translate("Edit Project", "تعديل المشروع")}
          </Button>
        ),
      }}
    >
      {isDraft && (
        <Alert color="orange" variant="light" mb="md" title={translate("Revision reset to Draft - recalculation required", "تمت إعادة النسخة إلى مسودة - يلزم إعادة الحساب")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {revision?.invalidationReason}.{" "}
              {translate(
                "The figures below are from before the change and are not valid for approval or issue until the revision is recalculated.",
                "الأرقام أدناه من قبل التغيير وغير صالحة للموافقة أو الإصدار حتى تتم إعادة حساب النسخة."
              )}
            </span>
            <Button size="xs" color="orange" onClick={() => setTab("engineering")}>
              {translate("Recalculate now", "إعادة الحساب الآن")}
            </Button>
          </div>
        </Alert>
      )}
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="overview">{translate("Overview", "نظرة عامة")}</Tabs.Tab>
          {showEngineering && <Tabs.Tab value="engineering">{translate("Engineering Input", "المدخلات الفنية")}</Tabs.Tab>}
          {showBoq && <Tabs.Tab value="boq" disabled={!revision}>{translate("BOQ", "جدول الكميات")}</Tabs.Tab>}
          {showPricing && <Tabs.Tab value="pricing" disabled={!revision}>{translate("Pricing", "التسعير")}</Tabs.Tab>}
          {showFeasibility && <Tabs.Tab value="feasibility" disabled={!revision}>{translate("Feasibility", "الجدوى المالية")}</Tabs.Tab>}
          {showApprovals && <Tabs.Tab value="approvals" disabled={!revision}>{translate("Approvals", "الموافقات")}</Tabs.Tab>}
          {showProposal && <Tabs.Tab value="proposal" disabled={!revision}>{translate("Proposal", "العرض")}</Tabs.Tab>}
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md"><OverviewTab project={project} revision={revision} onChanged={reload} onEdit={() => setEditOpen(true)} /></Tabs.Panel>
        {showEngineering && <Tabs.Panel value="engineering" pt="md"><EngineeringTab project={project} revision={revision} onSaved={reload} /></Tabs.Panel>}
        {showBoq && <Tabs.Panel value="boq" pt="md">{revision && <BoqTab project={project} revision={revision} onChanged={reload} />}</Tabs.Panel>}
        {showPricing && <Tabs.Panel value="pricing" pt="md">{revision && <PricingTab project={project} revision={revision} onChanged={reload} />}</Tabs.Panel>}
        {showFeasibility && <Tabs.Panel value="feasibility" pt="md">{revision && <FeasibilityTab project={project} revision={revision} />}</Tabs.Panel>}
        {showApprovals && <Tabs.Panel value="approvals" pt="md">{revision && <ApprovalsTab revision={revision} onChanged={reload} />}</Tabs.Panel>}
        {showProposal && <Tabs.Panel value="proposal" pt="md">{revision && <ProposalTab project={project} revision={revision} />}</Tabs.Panel>}
      </Tabs>

      <CreateProjectModal opened={editOpen} project={project} onClose={() => setEditOpen(false)} onSaved={() => reload()} />
    </AdminLayoutBox>
  );
}
