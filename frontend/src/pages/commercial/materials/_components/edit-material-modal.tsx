import { useEffect, useState } from "react";
import { Alert, Button, NumberInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import Modal from "@/components/ui/modal";
import { MaterialItem } from "@/types/commercial";
import { Product } from "@/types/product";
import ProductSearch from "@/components/global/product-search";

// Editing the price here APPENDS to the material's priceHistory (materialController.js), never
// overwrites it - a project revision that already resolved this item's price at an earlier value
// keeps that value, per the project's own "price updates never change an issued quotation" rule.
type SpecField = { key: string; label: string; unit: string; required: boolean; positive?: boolean; negative?: boolean };
let specFieldsCache: Record<string, SpecField[]> | null = null;

export default function EditMaterialModal({ opened, onClose, material, onSaved }: { opened: boolean; onClose: () => void; material: MaterialItem | null; onSaved: () => void }) {
  const { translate, language } = useLanguage();
  const [unitPrice, setUnitPrice] = useState<number>(0);
  // ERP BOQ mapping fix: the real catalog Product this Price Book item corresponds to - used by
  // wonToErpService.js#buildErpBoqLines as the one trustworthy match for a Won deal's BOQ transfer.
  const [erpProduct, setErpProduct] = useState<Product | null>(null);
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });
  // Technical data the design engines size with (backend utils/commercial/engineSpecs.js). A module or
  // inverter a supplier upload created has its rated value only and stays PLACEHOLDER - unusable in a
  // calculation - until this is completed; saving it complete makes the item Available.
  const [specFields, setSpecFields] = useState<Record<string, SpecField[]> | null>(specFieldsCache);
  const [specs, setSpecs] = useState<Record<string, number | "">>({});

  useEffect(() => {
    if (specFieldsCache) return;
    privateRequest({ url: "commercial/materials/spec-fields", language })
      .then((res) => {
        specFieldsCache = res.data as Record<string, SpecField[]>;
        setSpecFields(specFieldsCache);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fields = (material && specFields?.[material.category]) || [];
  const original = (k: string) => {
    const v = material?.attrs?.[k];
    return typeof v === "number" ? v : "";
  };

  useEffect(() => {
    if (!material) return;
    setUnitPrice(material.unitPrice);
    setSpecs(Object.fromEntries(Object.entries(material.attrs || {}).filter(([, v]) => typeof v === "number")) as Record<string, number>);
    // ProductSearch only ever reads `_id`/`title` to render its picker (see components/global/
    // product-search) - this API response is already the real product, just not the full shape,
    // so the remaining required fields are never read rather than fabricated with fake values.
    setErpProduct(
      material.erpProduct
        ? ({ _id: material.erpProduct._id, type: "product", title: material.erpProduct.title, sku: material.erpProduct.sku || undefined, model: material.erpProduct.model || undefined } as Product)
        : null
    );
  }, [material]);

  function handleSave() {
    if (!material) return;
    handleRequest(language, setLoading, setError, async () => {
      const changed = fields.filter((f) => (specs[f.key] ?? "") !== original(f.key));
      const attrs = changed.length ? Object.fromEntries(fields.map((f) => [f.key, specs[f.key] === "" || specs[f.key] === undefined ? null : specs[f.key]])) : undefined;
      await privateRequest({ url: `commercial/materials/${material._id}`, method: "PATCH", data: { unitPrice, erpProduct: erpProduct?._id || null, ...(attrs ? { attrs } : {}) }, language });
      onClose();
      onSaved();
    });
  }

  if (!material) return null;

  return (
    <Modal opened={opened} onClose={onClose} title={`${material.brand} ${material.model}`}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-gray-500">
          {translate("Source", "المصدر")}: {material.sourceWorkbook} - {material.sourceSheet}
        </p>
        <NumberInput label={translate("Unit Price", "سعر الوحدة")} value={unitPrice} onChange={(v) => setUnitPrice((v as number) || 0)} suffix={` ${material.currency}`} />
        <ProductSearch
          label={translate("Linked ERP product", "المنتج المرتبط في النظام")}
          description={translate("Used to transfer this item's BOQ lines into the ERP project when a deal is Won. Leave unset until Purchasing confirms the match.", "يُستخدم لترحيل بنود الكميات لهذا البند إلى مشروع النظام عند ربح الصفقة. اتركه دون ربط حتى يؤكد قسم المشتريات التطابق.")}
          product={erpProduct}
          setProduct={setErpProduct}
          placeholder={translate("Search the ERP product catalog...", "ابحث في كتالوج منتجات النظام...")}
        />
        {fields.length > 0 && (
          <div className="flex flex-col gap-2" data-testid="material-specs">
            <p className="text-sm font-semibold">{translate("Technical data (used by the design calculation)", "البيانات الفنية (تستخدم في حساب التصميم)")}</p>
            {material.missingSpecs && material.missingSpecs.length > 0 && (
              <Alert color="orange" variant="light" data-testid="material-specs-missing">
                {translate(
                  `Not usable in a calculation yet - missing: ${material.missingSpecs.join(", ")}. Enter them from the datasheet; the item becomes Available when complete.`,
                  `لا يمكن استخدامه في الحساب بعد - ناقص: ${material.missingSpecs.join("، ")}. أدخلها من نشرة البيانات؛ يصبح البند متاحاً عند اكتمالها.`
                )}
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {fields.map((f) => (
                <NumberInput
                  key={f.key}
                  size="sm"
                  label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`}
                  required={f.required}
                  decimalScale={4}
                  allowNegative={!!f.negative}
                  min={f.negative ? undefined : 0}
                  max={f.negative ? 0 : undefined}
                  hideControls
                  value={specs[f.key] ?? ""}
                  onChange={(v) => setSpecs((s) => ({ ...s, [f.key]: v === "" ? "" : Number(v) }))}
                  data-testid={`spec-${f.key}`}
                />
              ))}
            </div>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button onClick={handleSave} loading={loading} color="teal" fullWidth>
          {translate("Save", "حفظ")}
        </Button>
      </div>
    </Modal>
  );
}
