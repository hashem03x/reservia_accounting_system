import { useLanguage } from "@/context/LanguageContext";
import { NumberInput, TextInput } from "@mantine/core";
import { useProduct } from "../../context";

// Capacity is the product's Integrated Energy spec (e.g. "100 kW") - optional, so existing
// products created before this field existed keep working fine.
export default function CapacityInformation() {
  const { translate } = useLanguage();

  const { capacity, setCapacity, readOnly } = useProduct();

  return (
    <div className="product-details-box">
      <h3>{translate("Capacity", "السعة")}</h3>

      <div className="flex flex-col gap-3 md:flex-row">
        <NumberInput
          className="flex-1"
          label={translate("Value", "القيمة")}
          placeholder={translate("Optional", "اختياري")}
          min={0}
          value={capacity.value}
          onChange={(value) => setCapacity((prev) => ({ ...prev, value: value ?? "" }))}
          readOnly={readOnly}
        />
        <TextInput
          className="flex-1"
          label={translate("Unit", "الوحدة")}
          placeholder={translate("e.g. kW, MW", "مثال: كيلوواط، ميجاواط")}
          value={capacity.unit}
          onChange={(e) => setCapacity((prev) => ({ ...prev, unit: e.target.value }))}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}
