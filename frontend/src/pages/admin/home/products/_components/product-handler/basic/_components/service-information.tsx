import { useLanguage } from "@/context/LanguageContext";
import { durationUnitsArray, DurationUnit } from "@/utils/constants/product-types";
import { NumberInput, Select } from "@mantine/core";
import { useProduct } from "../../context";

/** Service-only fields - shown instead of Category/Cost when type === "service" (see
 * docs/entities/products.md). Deliberately does NOT ask for stock quantity/warehouse/inventory -
 * a service has none of those. */
export default function ServiceInformation() {
  const { translate } = useLanguage();
  const { durationValue, setDurationValue, durationUnit, setDurationUnit, readOnly } = useProduct();

  return (
    <div className="product-details-box">
      <h3>{translate("Service Duration", "مدة الخدمة")}</h3>
      <div className="flex flex-col gap-3 sm:flex-row">
        <NumberInput
          label={translate("Duration", "المدة")}
          placeholder={translate("e.g. 12", "مثال: 12")}
          withAsterisk
          min={1}
          clampBehavior="strict"
          allowNegative={false}
          allowDecimal={false}
          value={durationValue}
          onChange={setDurationValue}
          className="flex-1"
          readOnly={readOnly}
        />
        <Select
          label={translate("Duration Unit", "وحدة المدة")}
          data={durationUnitsArray.map((unit) => ({ value: unit.value, label: translate(unit.label.en, unit.label.ar) }))}
          value={durationUnit}
          onChange={(value) => setDurationUnit((value as DurationUnit) || "month")}
          allowDeselect={false}
          className="flex-1"
          disabled={readOnly}
        />
      </div>
    </div>
  );
}
