import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Select, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import Modal from "@/components/ui/modal";
import CustomerSearch from "@/components/global/customer-search";
import { Customer } from "@/types/customer";
import { COMMERCIAL_CATEGORIES, COMMERCIAL_SCOPES, CommercialCategory, CommercialProject, CommercialScope } from "@/types/commercial";
import { categoryLabel } from "../../_shared/categoryLabel";
import paths from "@/utils/constants/paths";

// Creates just the project HEADER (customer/country/category/scope) - the category-specific
// engineering inputs are entered on the project detail page afterwards, where the right dynamic
// form for that category actually lives. Cramming both into one modal would mean either a 6-way
// branching modal or a lossy generic form - neither is honest about how different each
// category's real inputs are (the project's own "no fake/placeholder functionality" rule).
export default function CreateProjectModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { translate, language } = useLanguage();
  const navigate = useNavigate();
  const catLabel = categoryLabel(translate);

  const [name, setName] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [country, setCountry] = useState("Egypt");
  const [region, setRegion] = useState("");
  const [category, setCategory] = useState<CommercialCategory | "">("");
  const [scope, setScope] = useState<CommercialScope>("Supply & Installation");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });

  function handleSubmit() {
    handleRequest(language, setLoading, setError, async () => {
      if (!name || !customer || !category) throw new Error(translate("Name, customer and category are required.", "الاسم والعميل والفئة مطلوبون."));
      const res = await privateRequest({
        url: "commercial/projects",
        method: "POST",
        data: { name, customer: customer._id, country, region: region || null, category, scope },
        language,
      });
      const created = res.data.project as CommercialProject;
      onClose();
      navigate(`/${paths.commercial}/${paths.commercialProjects}/${created._id}`);
    });
  }

  return (
    <Modal opened={opened} onClose={onClose} title={translate("New Commercial Project", "مشروع تجاري جديد")} size="lg">
      <div className="flex flex-col gap-3">
        <TextInput label={translate("Project Name", "اسم المشروع")} value={name} onChange={(e) => setName(e.target.value)} required />
        <CustomerSearch customer={customer} setCustomer={setCustomer} label={translate("Customer", "العميل")} required />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label={translate("Country", "الدولة")}
            data={["Egypt", "Saudi Arabia", "United Arab Emirates", "South Africa", "Europe", "Other Country"]}
            value={country}
            onChange={(v) => setCountry(v || "Egypt")}
          />
          <TextInput label={translate("Region / Location", "المنطقة / الموقع")} value={region} onChange={(e) => setRegion(e.target.value)} />
        </div>
        <Select
          label={translate("Project Category", "فئة المشروع")}
          placeholder={translate("Select a category", "اختر فئة")}
          data={COMMERCIAL_CATEGORIES.map((c) => ({ value: c, label: catLabel(c) }))}
          value={category || null}
          onChange={(v) => setCategory((v as CommercialCategory) || "")}
          required
        />
        <Select
          label={translate("Project Scope", "نطاق المشروع")}
          data={COMMERCIAL_SCOPES}
          value={scope}
          onChange={(v) => setScope((v as CommercialScope) || "Supply & Installation")}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button onClick={handleSubmit} loading={loading} color="teal" fullWidth mt="sm">
          {translate("Create Project", "إنشاء المشروع")}
        </Button>
      </div>
    </Modal>
  );
}
