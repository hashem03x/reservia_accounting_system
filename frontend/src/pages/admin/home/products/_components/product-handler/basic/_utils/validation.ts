import { Language } from "@/types/language";
import translate from "@/utils/helpers/translate";
import { ProductColorInput } from "../../context";

export default function validation(
  {
    titleEn,
    titleAr,
    descriptionEn,
    descriptionAr,
    cost,
    price,
    priceAfterDiscount,
    category,
    subcategory,
    colors,
    tags,
  }: {
    titleEn: string;
    titleAr: string;
    descriptionEn: string;
    descriptionAr: string;
    cost: string | number;
    price: string | number;
    priceAfterDiscount: string | number;
    category: string | null;
    subcategory: string | null;
    colors: ProductColorInput[];
    tags: string[];
  },
  language: Language,
) {
  if (!titleEn) return translate(language, "Please provide a title in English.", "يرجى إدخال عنوان بالإنجليزية.");
  if (!titleAr) return translate(language, "Please provide a title in Arabic.", "يرجى إدخال عنوان بالعربية.");
  if (!descriptionEn) return translate(language, "An English description is required.", "مطلوب وصف بالإنجليزية.");
  if (!descriptionAr) return translate(language, "An Arabic description is required.", "مطلوب وصف بالعربية.");
  if (!cost) return translate(language, "Please specify a cost for the product.", "يرجى تحديد تكلفة للمنتج.");
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
  if (!category)
    return translate(language, "Please specify a the main category for the product.", "يرجى تحديد الفئة الرئيسية للمنتج.");
  if (!subcategory)
    return translate(language, "Please specify a subcategory for the product.", "يرجى تحديد الفئة الفرعية للمنتج.");
  if (colors.length === 0)
    return translate(
      language,
      "Please specify at least one color for the product.",
      "يرجى تحديد على الأقل لون واحد للمنتج.",
    );
  for (const color of colors) {
    if (!color.name) return translate(language, "Please provide a name for all colors.", "يرجى إدخال اسم لجميع الألوان.");
    if (!color.code) return translate(language, "Please provide a code for all colors.", "يرجى إدخال كود لجميع الألوان.");
  }

  // TagsInput already prevents empty/duplicate entries and enforces maxTags client-side (see
  // tags-information.tsx) - this is a defense-in-depth check for the same rules, matching how
  // colors are validated here even though colors-information.tsx also guards its own inputs.
  if (tags.length > 20) return translate(language, "A product can have at most 20 tags.", "لا يمكن أن يتجاوز المنتج 20 وسمًا.");
  if (tags.some((tag) => tag.trim().length === 0))
    return translate(language, "Tags cannot be empty.", "لا يمكن أن يكون الوسم فارغًا.");
  if (tags.some((tag) => tag.length > 30))
    return translate(language, "Tags must be 30 characters or fewer.", "يجب ألا يتجاوز الوسم 30 حرفًا.");
  if (new Set(tags.map((tag) => tag.trim().toLowerCase())).size !== tags.length)
    return translate(language, "Duplicate tags are not allowed.", "لا يُسمح بوجود وسوم مكررة.");

  return "";
}
