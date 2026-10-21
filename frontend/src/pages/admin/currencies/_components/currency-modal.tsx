import { useEffect, useState } from "react";
import { Alert, Button, NumberInput, Switch, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import handleRequest from "@/utils/helpers/handle-request";
import { BASE_CURRENCY_CODE, formatRate, inverseRate, isValidRate } from "@/utils/helpers/currency-math";
import { Currency, CurrencyInput } from "@/types/currency";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Create (currency = null) or edit a currency. The rate is entered as "1 EGP = X units" and the
 * inverse ("1 unit = Y EGP") is previewed live. The code cannot change after creation, and the base
 * currency (EGP) has a fixed rate of 1 and is always active.
 */
export default function CurrencyModal({
  opened,
  close,
  currency,
  onSubmit,
}: {
  opened: boolean;
  close: () => void;
  currency: Currency | null;
  onSubmit: (input: CurrencyInput) => Promise<unknown>;
}) {
  const { translate, language } = useLanguage();
  const isEdit = !!currency;
  const isBase = !!currency?.isBase;

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [symbol, setSymbol] = useState("");
  const [rate, setRate] = useState<number | string>("");
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Re-seed the form every time the modal opens (for a new currency or a different one).
  useEffect(() => {
    if (!opened) return;
    setCode(currency?.code ?? "");
    setName(currency?.name ?? "");
    setNameAr(currency?.nameAr ?? "");
    setSymbol(currency?.symbol ?? "");
    setRate(currency?.unitsPerBase ?? "");
    setEffectiveDate(today());
    setIsActive(currency?.isActive ?? true);
    setError("");
  }, [opened, currency]);

  const normalizedCode = code.trim().toUpperCase();
  const numericRate = typeof rate === "number" ? rate : Number(rate);
  const rateValid = rate !== "" && isValidRate(numericRate);
  const rateChanged = isEdit && rateValid && numericRate !== currency?.unitsPerBase;
  const codeValid = /^[A-Z]{3}$/.test(normalizedCode) && (isEdit || normalizedCode !== BASE_CURRENCY_CODE);
  const canSubmit = codeValid && !!name.trim() && rateValid && !loading;
  const label = normalizedCode || translate("unit", "وحدة");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return; // no double submission, no invalid values
    handleRequest(language, setLoading, setError, async () => {
      const input: CurrencyInput = { name: name.trim(), nameAr: nameAr.trim(), symbol: symbol.trim() };
      if (!isBase) {
        input.isActive = isActive;
        if (!isEdit || rateChanged) {
          input.unitsPerBase = numericRate;
          input.rateEffectiveDate = effectiveDate || undefined;
        }
      }
      if (isEdit) input.expectedVersion = currency?.__v;
      else input.code = normalizedCode;
      await onSubmit(input);
      close();
    });
  }

  return (
    <Modal
      opened={opened}
      onClose={() => !loading && close()}
      title={
        isEdit
          ? translate(`Edit Currency ${currency?.code}`, `تعديل العملة ${currency?.code}`)
          : translate("Add Currency", "إضافة عملة")
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && <ErrorAlert error={error} />}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextInput
            label={translate("Code", "الرمز")}
            description={translate("3 letters, e.g. USD", "3 أحرف، مثل USD")}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={3}
            disabled={isEdit}
            required
            data-autofocus={!isEdit || undefined}
            error={
              code && !codeValid
                ? normalizedCode === BASE_CURRENCY_CODE
                  ? translate("EGP already exists as the base currency", "الجنيه موجود بالفعل كعملة أساسية")
                  : translate("Enter exactly 3 letters", "أدخل 3 أحرف بالضبط")
                : undefined
            }
          />
          <TextInput
            label={translate("Symbol", "الرمز المختصر")}
            description={translate("Optional, e.g. $", "اختياري، مثل $")}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            maxLength={8}
          />
          <div className="hidden sm:block" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextInput
            label={translate("Name (English)", "الاسم (إنجليزي)")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
            data-autofocus={isEdit || undefined}
          />
          <TextInput
            label={translate("Name (Arabic)", "الاسم (عربي)")}
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            maxLength={60}
            dir="rtl"
          />
        </div>

        {isBase ? (
          <Alert color="blue" variant="light" title={translate("Base currency", "العملة الأساسية")}>
            {translate(
              "EGP is the base currency: its rate is always 1, and it cannot be deactivated or deleted. All balances and reports are in EGP.",
              "الجنيه المصري هو العملة الأساسية: سعره دائماً 1، ولا يمكن إلغاء تفعيله أو حذفه. جميع الأرصدة والتقارير بالجنيه.",
            )}
          </Alert>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <NumberInput
              label={translate(`Exchange rate: 1 EGP = ? ${label}`, `سعر الصرف: 1 جنيه = ? ${label}`)}
              description={translate(
                `How many ${label} one Egyptian Pound buys. Example: if 1 USD = 50 EGP, enter 0.02.`,
                `كم ${label} يساوي جنيه مصري واحد. مثال: إذا كان 1 دولار = 50 جنيه، أدخل 0.02.`,
              )}
              value={rate}
              onChange={setRate}
              min={0}
              decimalScale={10}
              allowNegative={false}
              hideControls
              required
              error={
                rate !== "" && !rateValid ? translate("Enter a rate greater than zero", "أدخل سعراً أكبر من صفر") : undefined
              }
            />
            <div className="rounded-md bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800" aria-live="polite">
              {rateValid ? (
                <>
                  <div>
                    1 EGP = <b className="tabular-nums">{formatRate(numericRate)}</b> {label}
                  </div>
                  <div>
                    1 {label} = <b className="tabular-nums">{formatRate(inverseRate(numericRate))}</b> EGP
                  </div>
                </>
              ) : (
                <span className="text-gray-500">
                  {translate("Enter a rate to see the inverse conversion.", "أدخل السعر لعرض التحويل العكسي.")}
                </span>
              )}
            </div>
            {(!isEdit || rateChanged) && (
              <TextInput
                type="date"
                label={translate("Rate effective from", "يسري السعر من")}
                description={translate(
                  "Journal entries dated on or after this day get this rate by default. Existing entries keep the rate they were recorded with.",
                  "القيود بتاريخ هذا اليوم أو بعده تأخذ هذا السعر افتراضياً. القيود الحالية تحتفظ بالسعر الذي سُجلت به.",
                )}
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            )}
            <Switch
              label={translate("Active", "نشط")}
              description={translate(
                "Inactive currencies stay on existing entries but cannot be selected for new ones.",
                "العملات غير النشطة تبقى على القيود الحالية لكن لا يمكن اختيارها لقيود جديدة.",
              )}
              checked={isActive}
              onChange={(e) => setIsActive(e.currentTarget.checked)}
            />
          </div>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="default" onClick={close} disabled={loading}>
            {translate("Cancel", "إلغاء")}
          </Button>
          <Button type="submit" color="cyan" loading={loading} disabled={!canSubmit}>
            {isEdit ? translate("Save", "حفظ") : translate("Create", "إنشاء")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
