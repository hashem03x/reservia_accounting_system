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
  return "";
}
