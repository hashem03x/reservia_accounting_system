import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import { CATEGORIES_WITH_ENGINE, CommercialProject, CommercialRevision, CommercialRole } from "@/types/commercial";
import EmptySection from "@/components/ui/sections/empty";
import { canView, projectTabAccess } from "../../../_shared/dealEnginePermissions";
import OnGridForm from "./on-grid-form";
import OffGridForm from "./off-grid-form";
import PumpingForm from "./pumping-form";
import DesignChecks from "./design-checks";

// Dispatches to the right dynamic engineering form for the project's category - each category's
// REAL inputs (see services/commercial/boqService.js on the backend), never one generic form.
export default function EngineeringTab({ project, revision, onSaved }: { project: CommercialProject; revision: CommercialRevision | null; onSaved: () => void }) {
  const { translate } = useLanguage();
  const { systems } = useSystemAccess();
  const role = systems?.COMMERCIAL?.role as CommercialRole | null | undefined;
  // designChecks has its OWN matrix row (md/technical only - judged QA detail, not needed by
  // Sales/S&C for their commercial work), separate from the engineeringInputDesign/Customer rows
  // that gate this whole tab - a role that can see the tab is NOT automatically allowed this card.
  const showDesignChecks = canView(projectTabAccess(role ? [role] : [], "designChecks"));

  if (!CATEGORIES_WITH_ENGINE.includes(project.category)) {
    return (
      <EmptySection
        useDefaultImg
        message={translate(
          "This category has no complete engineering/BOQ model in the source workbooks yet - enter BOQ lines manually once that's built.",
          "لا يوجد نموذج هندسي كامل لهذه الفئة في ملفات المرجع حتى الآن - يمكن إدخال بنود جدول الكميات يدوياً عند إضافته."
        )}
      />
    );
  }

  if (project.category === "On-Grid C&I" || project.category === "Utility Scale") {
    return (
      <div className="flex flex-col gap-4">
        {showDesignChecks && <DesignChecks revision={revision} />}
        <OnGridForm project={project} revision={revision} onSaved={onSaved} />
      </div>
    );
  }
  if (project.category === "Off-Grid") {
    return <OffGridForm project={project} revision={revision} onSaved={onSaved} />;
  }
  if (project.category === "Agriculture Pumping") {
    return <PumpingForm project={project} revision={revision} onSaved={onSaved} />;
  }
  return null;
}
