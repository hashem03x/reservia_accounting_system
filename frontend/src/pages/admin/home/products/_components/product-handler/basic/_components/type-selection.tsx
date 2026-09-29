import { useLanguage } from "@/context/LanguageContext";
import { productTypesArray } from "@/utils/constants/product-types";
import { ProductType } from "@/types/product";
import { Radio, Tooltip } from "@mantine/core";
import { useProduct } from "../../context";

/**
 * The very first choice on the product form - see docs/entities/products.md. Read-only once a
 * product already exists: switching an existing PRODUCT to SERVICE (or vice-versa) after creation
 * would retroactively change what inventory/accounting behavior applies to it, so the backend
 * blocks it once variants exist (productValidator.js) and this form simply never offers it as an
 * option past creation, to avoid a confusing "why won't this save" moment.
 */
export default function TypeSelection() {
  const { translate } = useLanguage();
  const { type, setType, currentProduct } = useProduct();

  const radios = (
    <Radio.Group
      value={type}
      onChange={(value) => setType(value as ProductType)}
      label={translate("Type", "النوع")}
      description={translate(
        "Choose whether this is a physical product (inventory-tracked) or a service (no inventory).",
        "اختر ما إذا كان هذا منتجًا ماديًا (يُتابع في المخزون) أو خدمة (بدون مخزون).",
      )}
      withAsterisk
    >
      <div className="mt-2 flex gap-4">
        {productTypesArray.map((productType) => (
          <Radio
            key={productType.value}
            value={productType.value}
            label={translate(productType.label.en, productType.label.ar)}
            disabled={!!currentProduct}
          />
        ))}
      </div>
    </Radio.Group>
  );

  if (!currentProduct) return <div className="product-details-box">{radios}</div>;

  return (
    <div className="product-details-box">
      <Tooltip
        label={translate(
          "The type cannot be changed after creation.",
          "لا يمكن تغيير النوع بعد الإنشاء.",
        )}
      >
        {radios}
      </Tooltip>
    </div>
  );
}
