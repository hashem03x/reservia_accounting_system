import { Vendor } from "@/types/vendor";
import { Language } from "@/types/language";
import translate from "@/utils/helpers/translate";
import { OrderItemInput, PurchaseOrderLines } from "../types";

export const MAX_ITEM_QUANTITY = 1000;

export default function validation(
  { vendor, warehouse, items, poLines }: { vendor: Vendor | null; warehouse: string; items: OrderItemInput[]; poLines?: PurchaseOrderLines | null },
  language: Language,
) {
  if (!vendor) return translate(language, "Please select a vendor.", "يرجى اختيار بائع.");
  if (!warehouse) return translate(language, "Please select a warehouse.", "يرجى اختيار مخزن.");
  if (items.length === 0) return translate(language, "Please add at least one item.", "يرجى إضافة عنصر واحد على الأقل.");
  // Products carry no cost of their own any more - the purchase price is entered here, on each line.
  if (items.some((item) => item.productData && !(Number(item.unitPrice) > 0)))
    return translate(language, "Please enter the purchase price (unit price) for every item.", "يرجى إدخال سعر الشراء (سعر الوحدة) لكل صنف.");
  // Same rules as the backend (poValidator.js, requisitionQuantityService.js).
  if (items.some((item) => !Number.isInteger(Number(item.starterQuantity)) || Number(item.starterQuantity) < 1 || Number(item.starterQuantity) > MAX_ITEM_QUANTITY))
    return translate(language, `Every item's quantity must be a whole number from 1 to ${MAX_ITEM_QUANTITY}.`, `يجب أن تكون كمية كل صنف عددًا صحيحًا من 1 إلى ${MAX_ITEM_QUANTITY}.`);
  if (poLines) {
    const requested = new Map<string, { quantity: number; item: OrderItemInput }>();
    for (const item of items) {
      const id = item.productData!._id;
      requested.set(id, { quantity: (requested.get(id)?.quantity || 0) + Number(item.starterQuantity), item });
    }
    for (const [id, { quantity, item }] of requested) {
      const line = poLines.lines.find((l) => l.product === id);
      const name = translate(language, item.productData!.title.en, item.productData!.title.ar);
      if (!line && !poLines.hasUnmatchableLines)
        return translate(language, `"${name}" is not on the selected Purchase Order.`, `"${name}" غير موجود في أمر الشراء المحدد.`);
      if (line && quantity > line.remaining)
        return translate(
          language,
          `"${name}": quantity ${quantity} exceeds the ${line.remaining} left on the Purchase Order (${line.ordered} ordered, ${line.invoiced} already invoiced).`,
          `"${name}": الكمية ${quantity} تتجاوز المتبقي في أمر الشراء (${line.remaining} من ${line.ordered}، تمت فوترة ${line.invoiced}).`,
        );
    }
  }
  return "";
}
