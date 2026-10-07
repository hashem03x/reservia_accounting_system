import { useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import { durationUnitsArray, DurationUnit } from "@/utils/constants/product-types";
import { ChartOfAccountRef } from "@/types/orders";
import { Alert, NumberInput, Select } from "@mantine/core";
import { useProduct } from "../../context";

/** Service-only fields - shown instead of Category/Cost when type === "service" (see
 * docs/entities/products.md). Deliberately does NOT ask for stock quantity/warehouse/inventory -
 * a service has none of those. */
export default function ServiceInformation() {
  const { translate, language } = useLanguage();
  const { durationValue, setDurationValue, durationUnit, setDurationUnit, pucAccount, setPucAccount, readOnly, currentProduct } = useProduct();

  // Eligible PUC accounts come from the backend (`GET accounts/puc-eligible`, already ordered by
  // account number) - the single source of truth shared with the server-side validation, so the
  // dropdown can never offer an account the API would reject.
  const { privateRequest, data: pucAccounts, setData: setPucAccounts } = useDataHandler<ChartOfAccountRef[]>({ initialData: [] });
  useEffect(() => {
    privateRequest({ url: "accounts/puc-eligible", language })
      .then((res) => setPucAccounts(Array.isArray(res?.data) ? res.data : []))
      .catch(() => setPucAccounts([]));
  }, []);

  // A service saved before this field existed has none - it must get one before it can be purchased.
  const legacyMissingPuc = !!currentProduct && !pucAccount;

  return (
    <div className="product-details-box">
      <h3>{translate("Service Details", "تفاصيل الخدمة")}</h3>
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

      <Select
        mt="sm"
        label={translate("PUC Account", "حساب مشروعات تحت التنفيذ")}
        description={translate(
          "Purchasing this service posts its cost to this account (instead of Materials Inventory).",
          "عند شراء هذه الخدمة يتم ترحيل تكلفتها إلى هذا الحساب (بدلاً من مخزون الخامات).",
        )}
        placeholder={
          pucAccounts.length === 0
            ? translate("No eligible PUC accounts found", "لا توجد حسابات مؤهلة")
            : translate("Select the PUC account", "اختر حساب مشروعات تحت التنفيذ")
        }
        data={pucAccounts.map((a) => ({ value: a._id, label: `${a.code} - ${translate(a.name, a.nameAr || a.name)}` }))}
        value={pucAccount}
        onChange={(value) => setPucAccount(value || null)}
        searchable
        withAsterisk
        disabled={readOnly}
        nothingFoundMessage={translate("No matching account", "لا يوجد حساب مطابق")}
      />
      {legacyMissingPuc && (
        <Alert color="yellow" variant="light" mt="sm">
          {translate(
            "This service has no PUC account yet. Select one - the service cannot be purchased until it has a PUC account.",
            "لا يوجد حساب مشروعات تحت التنفيذ لهذه الخدمة. اختر حساباً - لا يمكن شراء الخدمة بدونه.",
          )}
        </Alert>
      )}
    </div>
  );
}
