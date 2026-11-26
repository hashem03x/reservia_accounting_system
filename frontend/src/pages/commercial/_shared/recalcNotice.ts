import { Language } from "@/types/language";
import { CommercialRevision } from "@/types/commercial";
import { formatAmount } from "@/utils/helpers/format-amount";
import { notifySuccess } from "@/utils/helpers/notifiers";

type Translate = (en: string, ar: string) => string;

/** One id per engineering-form session (see createRevision's requestId on the backend). */
export function newRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* insecure context - fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * One success notification for every Deal Engine calculation (Engineering "Calculate"/"Recalculate",
 * Pricing "Recalculate Pricing", BOQ "Recalculate BOQ" / "Save Overrides"): the revision number the
 * server saved, and what actually moved - so "nothing changed" is a visible, explained result
 * instead of a silent one. Uses the server's own message (it already names the revision).
 */
export function notifyRecalculated({
  language,
  translate,
  response,
  currency,
}: {
  language: Language;
  translate: Translate;
  response: { message?: string; data?: unknown };
  currency: string;
}) {
  const revision = response.data as CommercialRevision | undefined;
  const s = revision?.recalcSummary;
  const parts: string[] = [];
  const move = (label: string, from?: number | null, to?: number | null) => {
    if (from == null && to == null) return;
    if (from === to) parts.push(`${label}: ${formatAmount(to, currency)} (${translate("unchanged", "بدون تغيير")})`);
    else parts.push(`${label}: ${formatAmount(from, currency)} → ${formatAmount(to, currency)}`);
  };
  if (s) {
    move(translate("BOQ total", "إجمالي جدول الكميات"), s.previous.boqTotal, s.current.boqTotal);
    move(translate("Net price", "السعر الصافي"), s.previous.netExclVat, s.current.netExclVat);
    if (s.overridesKept) parts.push(translate(`${s.overridesKept} manual override(s) kept`, `تم الإبقاء على ${s.overridesKept} تعديل يدوي`));
    if (s.linesWithPriceNotes.length) parts.push(translate(`Check the price notes on: ${s.linesWithPriceNotes.join(", ")}`, `راجع ملاحظات الأسعار على: ${s.linesWithPriceNotes.join("، ")}`));
  }
  notifySuccess({
    language,
    title: revision ? translate(`Revision ${revision.revisionNumber} saved`, `تم حفظ النسخة ${revision.revisionNumber}`) : undefined,
    message: [response.message, ...parts].filter(Boolean).join(" · "),
  });
}
