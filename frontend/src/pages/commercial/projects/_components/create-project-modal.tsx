import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Select, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import Modal from "@/components/ui/modal";
import {
  COMMERCIAL_CATEGORIES,
  COMMERCIAL_COUNTRIES,
  COMMERCIAL_SCOPES,
  CommercialCategory,
  CommercialProject,
  CommercialScope,
  EGYPT_REGIONS,
  REGION_REQUIRED_COUNTRIES,
} from "@/types/commercial";
import { categoryLabel } from "../../_shared/categoryLabel";
import CustomerPicker, { CommercialCustomer } from "../../_shared/CustomerPicker";
import paths from "@/utils/constants/paths";

/**
 * New Project AND Edit Project (QA finding B1: "an Edit action ... that opens the same form as New
 * Project, writing to the existing project"). Region is a dropdown of the eight Rates matrix regions
 * and is required for Egypt (QA B2); other countries keep a free-text location. The backend
 * re-validates everything - this form only helps the user get it right first time.
 *
 * Editing region/country/category on a project that already has a calculated revision resets that
 * revision to Draft (the backend does it); the form warns before saving.
 */
export default function CreateProjectModal({
  opened,
  onClose,
  project = null,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  /** When given, the modal edits this project instead of creating one. */
  project?: CommercialProject | null;
  onSaved?: (p: CommercialProject) => void;
}) {
  const { translate, language } = useLanguage();
  const navigate = useNavigate();
  const catLabel = categoryLabel(translate);
  const editing = !!project;

  const [name, setName] = useState("");
  const [customer, setCustomer] = useState<CommercialCustomer | null>(null);
  const [country, setCountry] = useState("Egypt");
  const [region, setRegion] = useState("");
  const [category, setCategory] = useState<CommercialCategory | "">("");
  const [scope, setScope] = useState<CommercialScope>("Supply & Installation");
  const [subCategory, setSubCategory] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // (Re)load the form whenever it opens - from the project when editing, blank when creating.
  useEffect(() => {
    if (!opened) return;
    setFieldErrors({});
    if (project) {
      setName(project.name);
      setCustomer(project.customer ? { _id: project.customer._id, name: project.customer.name, phone: project.customer.phone, customerNumber: project.customer.customerNumber } : null);
      setCountry(project.country || "Egypt");
      // A legacy free-text region that is not a Rates key is shown blank so the user must pick a valid one.
      const legacy = project.region || "";
      setRegion(REGION_REQUIRED_COUNTRIES.includes(project.country) ? ((EGYPT_REGIONS as readonly string[]).includes(legacy) ? legacy : "") : legacy);
      setCategory(project.category);
      setScope(project.scope);
      setSubCategory(project.subCategory || "");
    } else {
      setName("");
      setCustomer(null);
      setCountry("Egypt");
      setRegion("");
      setCategory("");
      setScope("Supply & Installation");
      setSubCategory("");
    }
  }, [opened, project]);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });
  const regionRequired = REGION_REQUIRED_COUNTRIES.includes(country);
  const hasRevision = !!project?.currentRevision;
  const recalcWarning =
    editing && hasRevision && (country !== project!.country || (region || null) !== (project!.region || null) || category !== project!.category);
  const legacyRegionInvalid = editing && regionRequired && !!project?.region && !(EGYPT_REGIONS as readonly string[]).includes(project.region);

  function validate() {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = translate("Project name is required.", "اسم المشروع مطلوب.");
    if (!customer) errs.customer = translate("Select a customer from the list, or create one.", "اختر عميلاً من القائمة أو أنشئ عميلاً.");
    if (!category) errs.category = translate("Choose a category.", "اختر الفئة.");
    if (regionRequired && !region) errs.region = translate("Region is required for Egypt - it decides the installation and transport rates.", "المنطقة مطلوبة لمصر - تحدد أسعار التركيب والنقل.");
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
    handleRequest(language, setLoading, setError, async () => {
      const data = { name: name.trim(), customer: customer!._id, country, region: region || null, category, scope, subCategory: subCategory || null };
      if (editing) {
        const res = await privateRequest({ url: `commercial/projects/${project!._id}`, method: "PATCH", data, language });
        onSaved?.(res.data as CommercialProject);
        onClose();
        return;
      }
      const res = await privateRequest({ url: "commercial/projects", method: "POST", data, language });
      const created = res.data.project as CommercialProject;
      onClose();
      navigate(`/${paths.commercial}/${paths.commercialProjects}/${created._id}`);
    });
  }

  return (
    <Modal opened={opened} onClose={onClose} title={editing ? translate("Edit Project", "تعديل المشروع") : translate("New Deal Engine Project", "مشروع تجاري جديد")} size="lg">
      <div className="flex flex-col gap-3">
        {editing && (
          <p className="text-xs text-gray-500">
            {project!.projectCode}
            {project!.dealNumber ? ` - ${project!.dealNumber}` : ""}
          </p>
        )}
        <TextInput label={translate("Project Name", "اسم المشروع")} value={name} onChange={(e) => setName(e.target.value)} required error={fieldErrors.name} />
        <CustomerPicker value={customer} onChange={setCustomer} required error={fieldErrors.customer} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label={translate("Country", "الدولة")}
            data={COMMERCIAL_COUNTRIES}
            value={country}
            allowDeselect={false}
            onChange={(v) => {
              const next = v || "Egypt";
              if (REGION_REQUIRED_COUNTRIES.includes(next) !== REGION_REQUIRED_COUNTRIES.includes(country)) setRegion("");
              setCountry(next);
            }}
          />
          {regionRequired ? (
            <Select
              label={translate("Region (Rates matrix)", "المنطقة (جدول الأسعار)")}
              placeholder={translate("Select a region", "اختر المنطقة")}
              data={EGYPT_REGIONS as unknown as string[]}
              value={region || null}
              onChange={(v) => setRegion(v || "")}
              required
              withAsterisk
              error={fieldErrors.region}
            />
          ) : (
            <TextInput label={translate("Region / Location", "المنطقة / الموقع")} value={region} onChange={(e) => setRegion(e.target.value)} />
          )}
        </div>
        {legacyRegionInvalid && (
          <Alert color="yellow" variant="light">
            {translate(
              `The saved region "${project!.region}" is not one of the Rates matrix regions, so this project cannot be calculated. Choose the correct region above.`,
              `المنطقة المحفوظة "${project!.region}" ليست من مناطق جدول الأسعار، لذا لا يمكن حساب المشروع. اختر المنطقة الصحيحة.`
            )}
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label={translate("Project Category", "فئة المشروع")}
            placeholder={translate("Select a category", "اختر فئة")}
            data={COMMERCIAL_CATEGORIES.map((c) => ({ value: c, label: catLabel(c) }))}
            value={category || null}
            onChange={(v) => setCategory((v as CommercialCategory) || "")}
            required
            error={fieldErrors.category}
            disabled={editing && hasRevision}
            description={editing && hasRevision ? translate("Fixed once a revision exists - duplicate the project to change it.", "ثابتة بعد إنشاء نسخة - انسخ المشروع لتغييرها.") : undefined}
          />
          <TextInput label={translate("Sub-type (optional)", "النوع الفرعي (اختياري)")} value={subCategory} onChange={(e) => setSubCategory(e.target.value)} />
        </div>
        <Select
          label={translate("Project Scope", "نطاق المشروع")}
          data={COMMERCIAL_SCOPES}
          value={scope}
          allowDeselect={false}
          onChange={(v) => setScope((v as CommercialScope) || "Supply & Installation")}
        />
        {recalcWarning && (
          <Alert color="orange" variant="light" title={translate("The current revision will be reset to Draft", "سيتم إعادة النسخة الحالية إلى مسودة")}>
            {translate(
              "Changing the country, region or category changes the installation and transport rates. Every sign-off on the current revision is reset and it must be recalculated on the Engineering Input tab before it can be approved or issued.",
              "تغيير الدولة أو المنطقة أو الفئة يغيّر أسعار التركيب والنقل. سيتم إلغاء جميع الموافقات على النسخة الحالية ويجب إعادة حسابها من تبويب المدخلات الفنية قبل الموافقة أو الإصدار."
            )}
          </Alert>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button onClick={handleSubmit} loading={loading} color="teal" fullWidth mt="sm">
          {editing ? translate("Save Changes", "حفظ التغييرات") : translate("Create Project", "إنشاء المشروع")}
        </Button>
      </div>
    </Modal>
  );
}
