import { useLanguage } from "@/context/LanguageContext";
import { PaymentTermsConfig, PaymentTermsInstallment } from "@/types/vendor";
import { Button, NumberInput, Select } from "@mantine/core";
import { outlineIcons } from "@/components/icons";

const PERCENTAGE_TOLERANCE = 0.01;

// Mirrors backend/server/utils/paymentTermsConfig.js#validatePaymentTermsConfig exactly (same
// rules, same tolerance) so the Save button disables for the SAME reason the backend would
// reject the request - never a silent mismatch between what the UI allows and what the API
// accepts. `termDays` (Custom payment terms only) mirrors validateScheduleAgainstPaymentTerms:
// installment days, each counted from the previous installment, must add up to it. Returns an
// error message, or null when valid.
export function validatePaymentTermsConfigClientSide(config: PaymentTermsConfig, translate: (en: string, ar: string) => string, termDays: number | null = null): string | null {
  if (config.kind === "lump_sum") {
    const timing = config.lumpSum?.timing;
    if (timing !== "immediate" && timing !== "deferred") return translate("Select a timing for the lump-sum payment.", "اختر توقيت الدفعة المقطوعة.");
    if (timing === "deferred") {
      const days = Number(config.lumpSum?.durationDays);
      if (!Number.isInteger(days) || days <= 0) return translate("A deferred payment requires a positive number of days.", "تتطلب الدفعة المؤجلة عددًا صحيحًا موجبًا من الأيام.");
    }
    return null;
  }

  const installments = config.installments || [];
  if (installments.length === 0) return translate("Add at least one installment.", "أضف دفعة واحدة على الأقل.");

  let total = 0;
  for (let i = 0; i < installments.length; i += 1) {
    const installment = installments[i];
    const days = Number(installment.durationDays);
    const percentage = Number(installment.percentage);
    if (!Number.isInteger(days) || days < 0) {
      return translate(`Installment ${i + 1}: duration must be a non-negative whole number of days.`, `الدفعة ${i + 1}: يجب أن تكون المدة عددًا صحيحًا غير سالب من الأيام.`);
    }
    if (!(percentage > 0)) {
      return translate(`Installment ${i + 1}: percentage must be greater than zero.`, `الدفعة ${i + 1}: يجب أن تكون النسبة أكبر من صفر.`);
    }
    total += percentage;
  }

  if (Math.abs(total - 100) > PERCENTAGE_TOLERANCE) {
    return translate(`Installment percentages must sum to 100% (currently ${total.toFixed(2)}%).`, `يجب أن يكون إجمالي نسب الدفعات 100% (الحالي ${total.toFixed(2)}%).`);
  }

  if (termDays != null) {
    const remaining = termDays - installmentDaysTotal(installments);
    if (remaining < 0)
      return translate(`Installment days exceed the ${termDays}-day payment term by ${-remaining} day(s).`, `أيام الدفعات تتجاوز مدة الدفع (${termDays} يوم) بمقدار ${-remaining} يوم.`);
    if (remaining > 0)
      return translate(`${remaining} days remaining to complete the ${termDays}-day payment term.`, `متبقي ${remaining} يوم لاستكمال مدة الدفع (${termDays} يوم).`);
  }

  return null;
}

function installmentDaysTotal(installments: PaymentTermsInstallment[]) {
  return installments.reduce((sum, i) => sum + (Number(i.durationDays) || 0), 0);
}

export default function PaymentTermsConfigSection({
  value,
  onChange,
  allowInstallments = true,
  locked = false,
  termDays = null,
}: {
  value: PaymentTermsConfig;
  onChange: (value: PaymentTermsConfig) => void;
  // false (Immediate payment terms): the Installments option is not offered.
  allowInstallments?: boolean;
  // true (Immediate payment terms): fixed to Lump Sum + Immediate timing.
  locked?: boolean;
  // Custom payment terms' days - installment days must add up to it (null: no such check).
  termDays?: number | null;
}) {
  const { translate } = useLanguage();

  // Structure errors here; the days-vs-term state is shown separately below.
  const error = validatePaymentTermsConfigClientSide(value, translate);

  const installments = value.installments || [];
  const percentageTotal = installments.reduce((sum, i) => sum + (Number(i.percentage) || 0), 0);
  const remainingPercentage = 100 - percentageTotal;
  const remainingDays = value.kind === "installments" && termDays != null ? termDays - installmentDaysTotal(installments) : null;

  function updateInstallment(index: number, patch: Partial<PaymentTermsInstallment>) {
    onChange({ ...value, installments: installments.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  }
  function addInstallment() {
    onChange({ ...value, installments: [...installments, { durationDays: 30, percentage: Math.max(remainingPercentage, 0) || 0 }] });
  }
  function removeInstallment(index: number) {
    onChange({ ...value, installments: installments.filter((_, i) => i !== index) });
  }

  return (
    <section className="flex flex-col gap-2">
      <h4>{translate("Payment Schedule (Optional)", "جدول الدفع (اختياري)")}</h4>
      <p className="text-xs text-gray-500">
        {translate(
          "Used to project and snapshot a Purchase Invoice's payment schedule. Leave as a single immediate payment if this vendor has no special terms.",
          "يُستخدم لعرض وتثبيت جدول دفع فاتورة الشراء. اتركه كدفعة واحدة فورية إذا لم يكن لهذا البائع شروط خاصة.",
        )}
      </p>

      <Select
        value={value.kind}
        onChange={(kind) =>
          onChange(
            kind === "installments"
              ? { kind: "installments", installments: installments.length > 0 ? installments : [{ durationDays: 30, percentage: 100 }] }
              : { kind: "lump_sum", lumpSum: value.lumpSum || { timing: "immediate", durationDays: 0 } },
          )
        }
        data={[
          { value: "lump_sum", label: translate("Lump Sum (one payment)", "دفعة واحدة") },
          ...(allowInstallments ? [{ value: "installments", label: translate("Installments", "دفعات متعددة") }] : []),
        ]}
        label={translate("Payment Structure", "نوع الدفع")}
        allowDeselect={false}
        disabled={locked}
      />

      {value.kind === "lump_sum" ? (
        <div className="flex gap-2">
          <Select
            value={value.lumpSum?.timing || "immediate"}
            onChange={(timing) =>
              onChange({ kind: "lump_sum", lumpSum: { timing: (timing as "immediate" | "deferred") || "immediate", durationDays: timing === "deferred" ? value.lumpSum?.durationDays || 30 : 0 } })
            }
            data={[
              { value: "immediate", label: translate("Immediate", "فوري") },
              { value: "deferred", label: translate("Deferred", "مؤجل") },
            ]}
            label={translate("Timing", "التوقيت")}
            allowDeselect={false}
            disabled={locked}
            flex={1}
          />
          {value.lumpSum?.timing === "deferred" && (
            <NumberInput
              value={value.lumpSum?.durationDays ?? ""}
              onChange={(v) => onChange({ kind: "lump_sum", lumpSum: { timing: "deferred", durationDays: Number(v) || 0 } })}
              label={translate("Days", "عدد الأيام")}
              min={1}
              required
              flex={1}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-600">
              {translate("Remaining to reach 100%:", "المتبقي للوصول إلى 100%:")}{" "}
              <span className={`font-semibold ${Math.abs(remainingPercentage) < 0.01 ? "text-green-600" : "text-orange-500"}`}>{remainingPercentage.toFixed(2)}%</span>
            </span>
            <Button size="xs" variant="light" onClick={addInstallment} leftSection={<outlineIcons.Squares size={14} />}>
              {translate("Add Installment", "إضافة دفعة")}
            </Button>
          </div>

          {installments.map((installment, index) => (
            <div key={index} className="flex items-end gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
              <NumberInput
                value={installment.durationDays}
                onChange={(v) => updateInstallment(index, { durationDays: Number(v) || 0 })}
                label={
                  // Days count from the previous installment (the first from the invoice date).
                  index === 0
                    ? translate("Installment 1 - Days after invoice", "الدفعة 1 - أيام بعد الفاتورة")
                    : translate(`Installment ${index + 1} - Days after previous`, `الدفعة ${index + 1} - أيام بعد السابقة`)
                }
                min={0}
                decimalScale={0}
                flex={1}
              />
              <NumberInput
                value={installment.percentage}
                onChange={(v) => updateInstallment(index, { percentage: Number(v) || 0 })}
                label={translate("Percentage", "النسبة")}
                min={0}
                max={100}
                decimalScale={2}
                suffix="%"
                flex={1}
              />
              {installments.length > 1 && (
                <button type="button" onClick={() => removeInstallment(index)} className="mb-2" title={translate("Remove", "حذف")}>
                  <outlineIcons.Trash className="text-red-500 hover:text-red-700" size={18} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Custom terms: installment days against the custom days - remaining, complete or over. */}
      {remainingDays != null && remainingDays > 0 && (
        <p className="text-xs text-blue-600">
          {translate(`${remainingDays} days remaining to complete the ${termDays}-day payment term.`, `متبقي ${remainingDays} يوم لاستكمال مدة الدفع (${termDays} يوم).`)}
        </p>
      )}
      {remainingDays === 0 && (
        <p className="text-xs text-green-600">
          {translate(`Schedule complete - installment days add up to the ${termDays}-day payment term.`, `الجدول مكتمل - أيام الدفعات تساوي مدة الدفع (${termDays} يوم).`)}
        </p>
      )}
      {remainingDays != null && remainingDays < 0 && (
        <p className="text-xs text-red-500">
          {translate(`Installment days exceed the ${termDays}-day payment term by ${-remainingDays} day(s).`, `أيام الدفعات تتجاوز مدة الدفع (${termDays} يوم) بمقدار ${-remainingDays} يوم.`)}
        </p>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </section>
  );
}
