import { Vendor } from "@/types/vendor";
import { Language } from "@/types/language";
import translate from "@/utils/helpers/translate";
import { OrderItemInput } from "../types";

export default function validation(
  { vendor, warehouse, items }: { vendor: Vendor | null; warehouse: string; items: OrderItemInput[] },
  language: Language,
) {
  if (!vendor) return translate(language, "Please select a vendor.", "يرجى اختيار بائع.");
  if (!warehouse) return translate(language, "Please select a warehouse.", "يرجى اختيار مخزن.");
  if (items.length === 0) return translate(language, "Please add at least one item.", "يرجى إضافة عنصر واحد على الأقل.");
  return "";
}
