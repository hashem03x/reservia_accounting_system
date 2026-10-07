import { Language } from "@/types/language";
import translate from "@/utils/helpers/translate";
import { ProductType } from "@/types/product";
import { DurationUnit, isService } from "@/utils/constants/product-types";
import { ProductCapacityInput } from "../../context";

export default function validation(
  {
    type,
    titleEn,
    titleAr,
    descriptionEn,
    descriptionAr,
    cost,
    price,
    priceAfterDiscount,
    category,
    subcategory,
    capacity,
    durationValue,
    durationUnit,
    pucAccount,
  }: {
    type: ProductType;
    titleEn: string;
    titleAr: string;
    descriptionEn: string;
    descriptionAr: string;
    cost: string | number;
    price: string | number;
    priceAfterDiscount: string | number;
    category: string | null;
    subcategory: string | null;
    capacity: ProductCapacityInput;
    durationValue: string | number;
    durationUnit: DurationUnit;
    pucAccount?: string | null;
  },
  language: Language,
) {
  if (!titleEn) return translate(language, "Please provide a title in English.", "يرجى إدخال عنوان بالإنجليزية.");
  if (!titleAr) return translate(language, "Please provide a title in Arabic.", "يرجى إدخال عنوان بالعربية.");
  if (!descriptionEn) return translate(language, "An English description is required.", "مطلوب وصف بالإنجليزية.");
  if (!descriptionAr) return translate(language, "An Arabic description is required.", "مطلوب وصف بالعربية.");
  if (!price) return translate(language, "Please specify a price for the product.", "يرجى تحديد سعر للمنتج.");
  // priceAfterDiscount is optional, It can be a number between 0 and the original price. Or an empty string (which will be null in the server)
  if (priceAfterDiscount !== "") {
    if (+priceAfterDiscount <= 0)
      return translate(
        language,
        "The price after discount should be greater than 0.",
        "يجب أن يكون سعر المنتج بعد الخصم أكبر من 0.",
      );
    if (+priceAfterDiscount >= +price)
      return translate(
        language,
        "The price after discount should be less than the original price.",
        "يجب أن يكون سعر المنتج بعد الخصم أقل من السعر الأصلي.",
      );
  }

  // Service vs. product: a service has no inventory concept (cost/category) but does need a
  // duration; a product needs the reverse. See docs/entities/products.md.
  if (isService(type)) {
    if (!durationValue || +durationValue <= 0)
      return translate(language, "Please specify a valid service duration.", "يرجى تحديد مدة صالحة للخدمة.");
    if (durationUnit !== "month")
      return translate(language, "Duration unit must be months.", "يجب أن تكون وحدة المدة بالأشهر.");
    if (!pucAccount)
      return translate(language, "Please select the service's PUC account.", "يرجى اختيار حساب مشروعات تحت التنفيذ للخدمة.");
  } else {
    if (!cost) return translate(language, "Please specify a cost for the product.", "يرجى تحديد تكلفة للمنتج.");
    if (!category)
      return translate(language, "Please specify a the main category for the product.", "يرجى تحديد الفئة الرئيسية للمنتج.");
    if (!subcategory)
      return translate(language, "Please specify a subcategory for the product.", "يرجى تحديد الفئة الفرعية للمنتج.");
  }

  // Capacity is optional - only validate it when the user has actually entered one of its parts.
  if (capacity.value !== "" && (isNaN(+capacity.value) || +capacity.value < 0))
    return translate(language, "Capacity value must be a positive number.", "يجب أن تكون قيمة السعة رقمًا موجبًا.");
  if (capacity.value !== "" && !capacity.unit)
    return translate(language, "Please specify a unit for the capacity.", "يرجى تحديد وحدة للسعة.");

  return "";
}
