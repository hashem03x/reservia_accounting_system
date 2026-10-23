import { useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { Badge, Button, NumberInput, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import ProductSearchModal from "@/components/global/variant-search-modal";
import { getPurchaseUnitPrice } from "@/utils/helpers/purchase-unit-price";
import { outlineIcons, solidIcons } from "@/components/icons";
import { RequisitionItem, RequisitionItemInput } from "@/types/requisition";

// A line in the editor: what is sent to the API plus what is shown (the product's name/model) and
// whether it is a legacy description-only line.
export type EditableRequisitionItem = RequisitionItemInput & { productLabel?: string; legacy?: boolean };

export const emptyRequisitionItem = (): EditableRequisitionItem => ({ product: null, description: "", quantity: 1, unit: "", unitPrice: "" });

/** Lines of an existing Purchase Order, for editing (a line without a product is a legacy line). */
export function editableItemsOf(items: RequisitionItem[], translate: (en: string, ar: string) => string): EditableRequisitionItem[] {
  return items.map((item) => ({
    product: item.product?._id || null,
    productLabel: item.product?.title ? translate(item.product.title.en, item.product.title.ar) : undefined,
    legacy: !item.product,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit || "",
    unitPrice: item.unitPrice,
  }));
}

/** A line is ready to save: a product (or an unchanged legacy line), a quantity and a unit price. */
export const itemIsComplete = (item: EditableRequisitionItem) =>
  (!!item.product || !!item.legacy) && Number(item.quantity) > 0 && item.unitPrice !== "" && Number(item.unitPrice) >= 0;

export const itemPayload = (item: EditableRequisitionItem) => ({
  product: item.product || undefined,
  description: item.description.trim() || undefined,
  quantity: Number(item.quantity) || 0,
  unit: item.unit || undefined,
  unitPrice: Number(item.unitPrice) || 0,
});

/**
 * Purchase Order line items (client requirement "Purchase Orders - Product Search Instead of
 * Free-Text Description"): every new line is a catalog product/service picked through the product
 * search (filters: Main Category, Subcategory, Brand, Model / item search); its description is
 * optional line notes. A legacy line without a product (created before this rule, or imported) is
 * shown as such and kept unchanged - it can be removed or replaced by a product, never turned into
 * new free text. The backend enforces the same rule (requisitionController.js#buildItems).
 */
export default function RequisitionItemsEditor({
  items,
  setItems,
}: {
  items: EditableRequisitionItem[];
  setItems: React.Dispatch<React.SetStateAction<EditableRequisitionItem[]>>;
}) {
  const { language, translate } = useLanguage();
  const productRequest = usePrivateRequest();
  const [searchOpened, { open: openSearch, close: closeSearch }] = useDisclosure();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  function updateItem(index: number, patch: Partial<EditableRequisitionItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function handleProductSelected(barcode: string) {
    if (activeIndex === null) return;
    const index = activeIndex;
    try {
      const response = await productRequest({ url: `products/code/${barcode}`, language });
      const product = response.data;
      const name = translate(product.title.en, product.title.ar);
      const unitPrice = getPurchaseUnitPrice(product);
      updateItem(index, {
        product: product._id,
        productLabel: [name, product.model].filter(Boolean).join(" - "),
        legacy: false,
        // Keep any notes already typed; a legacy line's old description becomes its notes.
        ...(unitPrice !== null ? { unitPrice } : {}),
      });
    } catch {
      // The search only lists real products - a failed lookup leaves the line unchanged.
    }
  }

  const lineTotal = (item: EditableRequisitionItem) => (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4>{translate("Line Items", "بنود الطلب")}</h4>
        <Button size="xs" variant="light" onClick={() => setItems((prev) => [...prev, emptyRequisitionItem()])} leftSection={<outlineIcons.Squares size={14} />}>
          {translate("Add Line", "إضافة بند")}
        </Button>
      </div>

      {items.map((item, index) => (
        <div key={index} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700 sm:grid-cols-12">
          <div className="flex flex-col gap-1 sm:col-span-4">
            <span className="text-sm font-medium">
              {translate("Product / Service", "المنتج / الخدمة")} <span className="text-red-500">*</span>
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant={item.product ? "light" : "outline"}
                color={item.product ? "blue" : "red"}
                size="sm"
                className="flex-1"
                justify="space-between"
                rightSection={<solidIcons.Search size={14} />}
                onClick={() => {
                  setActiveIndex(index);
                  openSearch();
                }}
              >
                <span className="truncate">
                  {item.product ? item.productLabel || translate("Selected product", "منتج محدد") : item.legacy ? item.description : translate("Select from catalog", "اختر من الكتالوج")}
                </span>
              </Button>
              {item.legacy && !item.product && (
                <Badge color="gray" variant="light" title={translate("Created before products were required - kept unchanged", "أُنشئ قبل اشتراط المنتج - يبقى كما هو")}>
                  {translate("Legacy", "قديم")}
                </Badge>
              )}
            </div>
          </div>
          {!item.legacy || item.product ? (
            <TextInput
              className="sm:col-span-3"
              label={translate("Line notes (optional)", "ملاحظات البند (اختياري)")}
              value={item.description}
              onChange={(e) => updateItem(index, { description: e.target.value })}
              maxLength={500}
            />
          ) : (
            <div className="text-xs text-gray-500 sm:col-span-3">{translate("Legacy description line - select a product to replace it.", "بند بوصف قديم - اختر منتجًا لاستبداله.")}</div>
          )}
          <NumberInput
            className="sm:col-span-1"
            label={translate("Quantity", "الكمية")}
            value={item.quantity}
            onChange={(v) => updateItem(index, { quantity: v || 0 })}
            min={0.0001}
            decimalScale={4}
            required
          />
          <TextInput className="sm:col-span-1" label={translate("Unit", "الوحدة")} value={item.unit || ""} onChange={(e) => updateItem(index, { unit: e.target.value })} />
          <NumberInput
            className="sm:col-span-1"
            label={translate("Unit Price", "سعر الوحدة")}
            value={item.unitPrice}
            onChange={(v) => updateItem(index, { unitPrice: v })}
            min={0}
            decimalScale={2}
            required
          />
          <div className="flex items-end gap-2 sm:col-span-2">
            <TextInput label={translate("Line Total", "إجمالي البند")} value={lineTotal(item).toFixed(2)} readOnly className="flex-1" />
            {items.length > 1 && (
              <button type="button" onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))} className="mb-2" title={translate("Remove", "حذف")}>
                <outlineIcons.Trash className="text-red-500 hover:text-red-700" size={18} />
              </button>
            )}
          </div>
        </div>
      ))}

      <ProductSearchModal
        opened={searchOpened}
        close={closeSearch}
        mode="purchase"
        onSelect={(barcode) => {
          handleProductSelected(barcode);
          closeSearch();
        }}
      />
    </div>
  );
}
