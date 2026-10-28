import { Customer } from "@/types/customer";
import { Language } from "@/types/language";
import translate from "@/utils/helpers/translate";
import { OrderItemInput } from "../types";

export default function validation(
  { customer, warehouse, items }: { customer: Customer | null; warehouse: string; items: OrderItemInput[] },
  language: Language,
) {
  if (!customer) return translate(language, "Please select a customer.", "يرجى اختيار عميل.");
  if (!warehouse) return translate(language, "Please select a warehouse.", "يرجى اختيار مخزن.");
  if (items.length === 0) return translate(language, "Please add at least one item.", "يرجى إضافة عنصر واحد على الأقل.");
  // A product / service may have no catalog price - the line's selling price is then entered here
  // (the backend requires a positive unit price - salesValidator.js).
  if (items.some((item) => item.productData && !(Number(item.unitPrice) > 0)))
    return translate(language, "Please enter the selling price (unit price) for every item.", "يرجى إدخال سعر البيع (سعر الوحدة) لكل صنف.");
  return "";
}
