import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { Vendor } from "@/types/vendor";
import { Project } from "@/types/project";
import { RequisitionItemInput } from "@/types/requisition";
import paths from "@/utils/constants/paths";
import { Button, NumberInput, Select, Textarea, TextInput } from "@mantine/core";
import ErrorAlert from "@/components/ui/error-alert";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import VendorSearch from "@/components/global/vendor-search";
import ProductSearchModal from "@/components/global/variant-search-modal";
import { getPurchaseUnitPrice } from "@/utils/helpers/purchase-unit-price";
import { outlineIcons, solidIcons } from "@/components/icons";

const emptyItem: RequisitionItemInput = { product: null, description: "", quantity: 1, unit: "", unitPrice: 0 };

export default function NewPurchaseRequisition() {
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();

  const title = translate("New Purchase Order", "أمر شراء جديد");
  useDocumentTitle(`${title} | ${translations.adminPanel}`);

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [project, setProject] = useState("");
  const [items, setItems] = useState<RequisitionItemInput[]>([{ ...emptyItem }]);
  const [notes, setNotes] = useState("");

  const {
    privateRequest: fetchProjectsRequest,
    data: projects,
    setData: setProjects,
  } = useDataHandler<Project[]>({ initialData: [] });
  useEffect(() => {
    fetchProjectsRequest({ url: "projects", params: { limit: 500 }, language })
      .then((res) => setProjects(res.data))
      .catch(() => setProjects([]));
  }, []);

  function updateItem(index: number, patch: Partial<RequisitionItemInput>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function addItem() {
    setItems((prev) => [...prev, { ...emptyItem }]);
  }
  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  // Searchable product selector (title/category/brand - see components/global/variant-search-modal),
  // the same component already used by the Purchase/Sales Invoice item rows. One modal instance,
  // reused for whichever row's "select product" button was last clicked, tracked by index.
  const productPrivateRequest = usePrivateRequest();
  const [searchModalOpened, { open: openSearchModal, close: closeSearchModal }] = useDisclosure();
  const [activeItemIndex, setActiveItemIndex] = useState<number | null>(null);

  function openProductSearch(index: number) {
    setActiveItemIndex(index);
    openSearchModal();
  }

  async function handleProductSelected(barcode: string) {
    if (activeItemIndex === null) return;
    const index = activeItemIndex;
    try {
      const response = await productPrivateRequest({ url: `products/code/${barcode}`, language });
      const product = response.data;
      updateItem(index, {
        product: product._id,
        description: translate(product.title.en, product.title.ar),
        unitPrice: getPurchaseUnitPrice(product),
      });
    } catch {
      // The product search modal already only lists real products - a lookup failure here is
      // unexpected; leave the row's existing description editable rather than blocking the user.
    }
  }

  const lineTotal = (item: RequisitionItemInput) => (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
  const amount = items.reduce((sum, item) => sum + lineTotal(item), 0);

  const missingItemFields = items.some((item) => !item.description.trim() || !(Number(item.quantity) > 0));
  const canSubmit = !!vendor && !!project && items.length > 0 && !missingItemFields;

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      if (!vendor) {
        setError(translate("A vendor is required.", "يجب اختيار بائع."));
        return;
      }
      if (!project) {
        setError(translate("A project is required.", "يجب اختيار مشروع."));
        return;
      }

      const response = await privateRequest({
        language,
        method: "POST",
        url: "requisitions",
        data: {
          vendorId: vendor._id,
          project,
          items: items.map((item) => ({
            product: item.product || undefined,
            description: item.description,
            quantity: Number(item.quantity) || 0,
            unit: item.unit || undefined,
            unitPrice: Number(item.unitPrice) || 0,
          })),
          notes: notes || undefined,
        },
      });

      navigate(`/${paths.admin}/${paths.home}/${paths.purchaseRequisitions}/${response.data._id}`);
    });
  }

  return (
    <AdminLayoutBox
      header={{
        title,
        backLink: true,
        border: true,
        sideElements: (
          <Button onClick={handleSubmit} size="md" px="xl" radius="md" loading={loading} disabled={!canSubmit}>
            {translate("Save", "حفظ")}
          </Button>
        ),
      }}
    >
      {error && (
        <>
          <ErrorAlert error={error} />
          <hr />
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs md:text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-gray-600">{translate("Purchase Order Amount", "قيمة أمر الشراء")}:</span>
          <span className="font-bold text-gray-800">{`${amount.toFixed(2)} ${translations.currency}`}</span>
        </div>
      </div>

      <hr />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex-1">
          <VendorSearch
            label={translate("Vendor", "البائع")}
            placeholder={translate("Select Vendor", "اختر البائع")}
            vendor={vendor}
            setVendor={setVendor}
            withAsterisk
            required
          />
        </div>

        <Select
          label={translate("Project", "المشروع")}
          placeholder={translate("Select project", "اختر المشروع")}
          value={project || null}
          onChange={(v) => setProject(v || "")}
          data={projects.map((p) => ({ value: p._id, label: `${p.projectNumber}${p.name ? ` - ${p.name}` : ""}` }))}
          searchable
          required
          withAsterisk
          flex={1}
        />
      </div>

      <hr />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h4>{translate("Line Items", "بنود الطلب")}</h4>
          <Button size="xs" variant="light" onClick={addItem} leftSection={<outlineIcons.Squares size={14} />}>
            {translate("Add Line", "إضافة بند")}
          </Button>
        </div>

        {items.map((item, index) => (
          <div
            key={index}
            className="grid grid-cols-1 items-end gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700 sm:grid-cols-6"
          >
            <TextInput
              label={translate("Description", "الوصف")}
              value={item.description}
              onChange={(e) => updateItem(index, { description: e.target.value, product: null })}
              required
              className="sm:col-span-2"
              rightSection={
                <Button onClick={() => openProductSearch(index)} variant="transparent" size="xs" px={5} title={translate("Select from catalog", "اختر من الكتالوج")}>
                  <solidIcons.Search size={16} />
                </Button>
              }
            />
            <NumberInput
              label={translate("Quantity", "الكمية")}
              value={item.quantity}
              onChange={(v) => updateItem(index, { quantity: v || 0 })}
              min={0.0001}
              decimalScale={4}
              required
            />
            <TextInput
              label={translate("Unit", "الوحدة")}
              value={item.unit || ""}
              onChange={(e) => updateItem(index, { unit: e.target.value })}
            />
            <NumberInput
              label={translate("Unit Price", "سعر الوحدة")}
              value={item.unitPrice}
              onChange={(v) => updateItem(index, { unitPrice: v || 0 })}
              min={0}
              decimalScale={2}
              required
            />
            <div className="flex items-end gap-2">
              <TextInput label={translate("Line Total", "إجمالي البند")} value={lineTotal(item).toFixed(2)} readOnly className="flex-1" />
              {items.length > 1 && (
                <button type="button" onClick={() => removeItem(index)} className="mb-2" title={translate("Remove", "حذف")}>
                  <outlineIcons.Trash className="text-red-500 hover:text-red-700" size={18} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <ProductSearchModal
        opened={searchModalOpened}
        close={closeSearchModal}
        mode="purchase"
        onSelect={(barcode) => {
          handleProductSelected(barcode);
          closeSearchModal();
        }}
      />

      <hr />

      <Textarea
        label={translate("Notes", "ملاحظات")}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        autosize
        minRows={2}
      />
    </AdminLayoutBox>
  );
}
