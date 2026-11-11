import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Alert, Button, Tabs } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import { outlineIcons } from "@/components/icons";
import { CommercialProject, CommercialRevision } from "@/types/commercial";
import { categoryLabel } from "../../_shared/categoryLabel";
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
  const catLabel = categoryLabel(translate);
  const [tab, setTab] = useState<string | null>("overview");
  const [editOpen, setEditOpen] = useState(false);

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

  useDocumentTitle(`${project?.projectCode || translate("Project", "مشروع")} | Reservia Commercial`);

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
          <Tabs.Tab value="engineering">{translate("Engineering Input", "المدخلات الفنية")}</Tabs.Tab>
          <Tabs.Tab value="boq" disabled={!revision}>{translate("BOQ", "جدول الكميات")}</Tabs.Tab>
          <Tabs.Tab value="pricing" disabled={!revision}>{translate("Pricing", "التسعير")}</Tabs.Tab>
          <Tabs.Tab value="feasibility" disabled={!revision}>{translate("Feasibility", "الجدوى المالية")}</Tabs.Tab>
          <Tabs.Tab value="approvals" disabled={!revision}>{translate("Approvals", "الموافقات")}</Tabs.Tab>
          <Tabs.Tab value="proposal" disabled={!revision}>{translate("Proposal", "العرض")}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md"><OverviewTab project={project} revision={revision} onChanged={reload} onEdit={() => setEditOpen(true)} /></Tabs.Panel>
        <Tabs.Panel value="engineering" pt="md"><EngineeringTab project={project} revision={revision} onSaved={reload} /></Tabs.Panel>
        <Tabs.Panel value="boq" pt="md">{revision && <BoqTab project={project} revision={revision} onChanged={reload} />}</Tabs.Panel>
        <Tabs.Panel value="pricing" pt="md">{revision && <PricingTab project={project} revision={revision} onChanged={reload} />}</Tabs.Panel>
        <Tabs.Panel value="feasibility" pt="md">{revision && <FeasibilityTab project={project} revision={revision} />}</Tabs.Panel>
        <Tabs.Panel value="approvals" pt="md">{revision && <ApprovalsTab revision={revision} onChanged={reload} />}</Tabs.Panel>
        <Tabs.Panel value="proposal" pt="md">{revision && <ProposalTab project={project} revision={revision} />}</Tabs.Panel>
      </Tabs>

      <CreateProjectModal opened={editOpen} project={project} onClose={() => setEditOpen(false)} onSaved={() => reload()} />
    </AdminLayoutBox>
  );
}
