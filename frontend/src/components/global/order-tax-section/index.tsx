import { NumberInput, Select } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { calculateOrderTotals } from "@/utils/helpers/order-totals";

const WITHHOLDING_TAX_OPTIONS = [0, 1, 3, 5];

// Shared by Sales Order and Purchase Order creation forms (docs sections "VAT on Sales Orders and
// Purchase Orders" / "Withholding Tax") - a single implementation so both order types look and
// behave identically. The displayed amounts here are a client-side PREVIEW only, computed with the
// same canonical formula as the backend (utils/helpers/order-totals.ts) - the backend independently
// recomputes vatAmount/withholdingTaxAmount/grandTotal from the real item total on submit and never
// trusts these. A tax that is 0 is not displayed as a line at all.
export default function OrderTaxSection({
  amount,
  vatPercentage,
  setVatPercentage,
  withholdingTaxPercentage,
  setWithholdingTaxPercentage,
}: {
  amount: number;
  vatPercentage: string | number;
  setVatPercentage: (value: string | number) => void;
  withholdingTaxPercentage: string | number;
  setWithholdingTaxPercentage: (value: string | number) => void;
}) {
  const { translate, translations } = useLanguage();

  const vatPct = Number(vatPercentage) || 0;
  const withholdingPct = Number(withholdingTaxPercentage) || 0;
  const { vatAmount, withholdingTaxAmount, total } = calculateOrderTotals(amount, vatPct, withholdingPct);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberInput
          label={translate("VAT Percentage", "نسبة ضريبة القيمة المضافة")}
          placeholder={translate("Enter VAT percentage (0 = no VAT)", "أدخل نسبة الضريبة (0 = بدون ضريبة)")}
          value={vatPercentage}
          onChange={setVatPercentage}
          min={0}
          decimalScale={2}
          suffix="%"
        />
        <Select
          label={translate("Withholding Tax", "ضريبة الخصم والإضافة")}
          value={String(withholdingPct)}
          onChange={(v) => setWithholdingTaxPercentage(v || "0")}
          data={WITHHOLDING_TAX_OPTIONS.map((p) => ({
            value: String(p),
            label: p === 0 ? translate("No Withholding Tax (0%)", "بدون ضريبة خصم (0%)") : `${p}%`,
          }))}
          allowDeselect={false}
        />
      </div>

      <div className="flex flex-col gap-1 rounded-lg bg-gray-50 p-3 text-sm">
        <div className="flex justify-between">
          <span>{translate("Subtotal", "الإجمالي قبل الضريبة")}</span>
          <b>
            {amount.toLocaleString()} {translations.currency}
          </b>
        </div>
        {vatAmount > 0 && (
          <div className="flex justify-between">
            <span>
              {translate("VAT", "ضريبة القيمة المضافة")} ({vatPct}%)
            </span>
            <b>
              {vatAmount.toLocaleString()} {translations.currency}
            </b>
          </div>
        )}
        {withholdingTaxAmount > 0 && (
          <div className="flex justify-between">
            <span>
              {translate("Withholding Tax", "ضريبة الخصم")} ({withholdingPct}%)
            </span>
            <b className="text-red-600">
              -{withholdingTaxAmount.toLocaleString()} {translations.currency}
            </b>
          </div>
        )}
        <hr className="my-1" />
        <div className="flex justify-between text-base">
          <span className="font-semibold">{translate("Total Amount", "المبلغ الإجمالي")}</span>
          <b>
            {total.toLocaleString()} {translations.currency}
          </b>
        </div>
      </div>
    </div>
  );
}
