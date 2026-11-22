import { useEffect, useState } from "react";
import { Button, NumberInput } from "@mantine/core";
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
export default function EditMaterialModal({ opened, onClose, material, onSaved }: { opened: boolean; onClose: () => void; material: MaterialItem | null; onSaved: () => void }) {
  const { translate, language } = useLanguage();
  const [unitPrice, setUnitPrice] = useState<number>(0);
  // ERP BOQ mapping fix: the real catalog Product this Price Book item corresponds to - used by
  // wonToErpService.js#buildErpBoqLines as the one trustworthy match for a Won deal's BOQ transfer.
  const [erpProduct, setErpProduct] = useState<Product | null>(null);
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({ initialData: null });

  useEffect(() => {
    if (!material) return;
    setUnitPrice(material.unitPrice);
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
      await privateRequest({ url: `commercial/materials/${material._id}`, method: "PATCH", data: { unitPrice, erpProduct: erpProduct?._id || null }, language });
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
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button onClick={handleSave} loading={loading} color="teal" fullWidth>
          {translate("Save", "حفظ")}
        </Button>
      </div>
    </Modal>
  );
}
