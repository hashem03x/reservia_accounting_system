import { Select } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { VAT_TREATMENT_OPTIONS, VatTreatmentValue } from "@/utils/constants/vat-treatment";

/**
 * VAT Accounting Treatment selector - one implementation, reused everywhere VAT already appears
 * (Purchase Invoice, Expense, Fixed Asset and Sales Invoice creation forms, and their view pages
 * when `readOnly`). Purchase-side forms wire `value`/`onChange` straight to their own
 * `vatTreatment` field; the Sales Invoice form wires it to a locally-computed value instead (its
 * "No VAT" is expressed by the existing vatPercentage/vatExemptReason fields, not a stored
 * treatment - see pages/admin/home/sales-orders/new).
 */
export default function VatTreatmentSelect({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: VatTreatmentValue;
  onChange?: (value: VatTreatmentValue) => void;
  readOnly?: boolean;
  label?: string;
}) {
  const { translate } = useLanguage();
  const selected = VAT_TREATMENT_OPTIONS.find((o) => o.value === value);

  return (
    <Select
      label={label ?? translate("VAT Treatment", "المعالجة الضريبية")}
      value={value}
      onChange={(v) => v && onChange?.(v as VatTreatmentValue)}
      data={VAT_TREATMENT_OPTIONS.map((o) => ({ value: o.value, label: translate(o.label.en, o.label.ar) }))}
      description={selected ? translate(selected.description.en, selected.description.ar) : undefined}
      allowDeselect={false}
      readOnly={readOnly}
      disabled={readOnly}
      data-testid="vat-treatment-select"
    />
  );
}
