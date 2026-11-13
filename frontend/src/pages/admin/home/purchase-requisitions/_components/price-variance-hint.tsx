import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";

type PriceCheck = {
  thresholdPct: number;
  last: { unitPrice: number; code: string | null } | null;
  average: number | null;
  count: number;
  vsLastPct: number | null;
  vsAveragePct: number | null;
  warn: boolean;
};

const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;

/**
 * ERP CHG-07 - warns on a PO line when its unit price differs from the product's last or average
 * PO price by more than the company threshold (Company settings, default 20%). A warning only:
 * the PO still saves. GET /requisitions/price-check (backend services/vendor/priceVarianceService.js).
 */
export default function PriceVarianceHint({
  product,
  unitPrice,
  excludeId,
}: {
  product: string | null;
  unitPrice: number | string;
  excludeId?: string;
}) {
  const { language, translate } = useLanguage();
  const request = usePrivateRequest();
  const [check, setCheck] = useState<PriceCheck | null>(null);

  useEffect(() => {
    setCheck(null);
    if (!product || unitPrice === "" || !(Number(unitPrice) >= 0)) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await request({
          url: "requisitions/price-check",
          params: { product, unitPrice: Number(unitPrice), ...(excludeId ? { exclude: excludeId } : {}) },
          language,
        });
        if (!cancelled) setCheck(res.data as PriceCheck);
      } catch {
        // A failed check never blocks the form.
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, unitPrice, excludeId]);

  if (!check?.warn) return null;
  const parts: string[] = [];
  if (check.last && check.vsLastPct !== null)
    parts.push(
      translate(
        `${pct(check.vsLastPct)} vs last price ${check.last.unitPrice.toLocaleString()}${check.last.code ? ` (PO ${check.last.code})` : ""}`,
        `${pct(check.vsLastPct)} عن آخر سعر ${check.last.unitPrice.toLocaleString()}${check.last.code ? ` (أمر شراء ${check.last.code})` : ""}`,
      ),
    );
  if (check.average !== null && check.vsAveragePct !== null)
    parts.push(
      translate(
        `${pct(check.vsAveragePct)} vs average ${check.average.toLocaleString()}`,
        `${pct(check.vsAveragePct)} عن المتوسط ${check.average.toLocaleString()}`,
      ),
    );
  return (
    <p
      className="col-span-full rounded-md bg-yellow-50 px-2 py-1 text-xs text-yellow-800"
      data-testid="price-variance-warning"
    >
      {translate(
        `Price check: this unit price differs by more than ${check.thresholdPct}% - `,
        `تنبيه سعر: يختلف سعر الوحدة بأكثر من ${check.thresholdPct}% - `,
      )}
      {parts.join("; ")}
    </p>
  );
}
