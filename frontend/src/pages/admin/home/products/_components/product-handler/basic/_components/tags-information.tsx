import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import apiRequest from "@/utils/helpers/api-request";
import { TagsInput } from "@mantine/core";
import { useProduct } from "../../context";

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 30;

export default function TagsInformation() {
  const { translate, language } = useLanguage();
  const { tags, setTags, readOnly } = useProduct();

  // Existing tags across the catalog, fetched once for autocomplete suggestions - lets an admin
  // reuse "Cotton" instead of accidentally creating a near-duplicate like "cotton " or "Cottons".
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    let canceled = false;
    apiRequest({ url: "products/tags/distinct", language })
      .then((response) => {
        if (!canceled) setSuggestions(response.data || []);
      })
      .catch(() => {
        // Suggestions are a nice-to-have, not required for the form to work - fail silently.
      });
    return () => {
      canceled = true;
    };
  }, []);

  const tagTooLong = tags.some((tag) => tag.length > MAX_TAG_LENGTH);

  return (
    <div className="product-details-box h-full">
      <h3>{translate("Tags", "الوسوم")}</h3>
      <TagsInput
        label={translate("Product Tags", "وسوم المنتج")}
        description={translate(
          "Press Enter or comma to add a tag.",
          "اضغط Enter أو الفاصلة لإضافة وسم.",
        )}
        placeholder={translate("e.g. Summer, Cotton, New", "مثال: صيفي، قطن، جديد")}
        value={tags}
        onChange={setTags}
        data={suggestions}
        splitChars={[","]}
        maxTags={MAX_TAGS}
        clearable
        readOnly={readOnly}
        error={
          tagTooLong
            ? translate(`Tags must be ${MAX_TAG_LENGTH} characters or fewer.`, `يجب ألا يتجاوز الوسم ${MAX_TAG_LENGTH} حرفًا.`)
            : tags.length >= MAX_TAGS
              ? translate(`A product can have at most ${MAX_TAGS} tags.`, `لا يمكن أن يتجاوز المنتج ${MAX_TAGS} وسمًا.`)
              : undefined
        }
      />
    </div>
  );
}
