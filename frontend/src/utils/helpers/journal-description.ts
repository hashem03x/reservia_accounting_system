// ERP CHG-12 - one language for system-generated journal descriptions. The backend writes every
// automatic entry in English (backend services/accounting/accountingEventService.js and friends);
// this renders the known system phrases in the user's language. Older entries were written with an
// Arabic cost-recognition description (entries such as 100230 / 100240) - those are recognised too
// and shown in English for an English user. Anything else (text a user typed, a reference, a
// number) is left exactly as stored.
type Phrase = { en: string; ar: string; legacyAr?: string[] };

// Longest prefixes first, so "Customer advance applied via payment ..." wins over "Customer payment".
const PHRASES: Phrase[] = [
  {
    en: "Charge project with costs by executed % of contract",
    ar: "تحميل المشروع بالتكاليف بنسبة المنفذ من العقد",
  },
  {
    en: "Customer advance applied via payment against accounts receivable",
    ar: "تسوية دفعة مقدمة من عميل عبر تحصيل مقابل الذمم المدينة",
  },
  {
    en: "Vendor advance applied via payment against supplier payable",
    ar: "تسوية دفعة مقدمة لمورد عبر سداد مقابل مستحقات المورد",
  },
  { en: "Customer advance applied against accounts receivable", ar: "تسوية دفعة مقدمة من عميل مقابل الذمم المدينة" },
  { en: "Vendor advance applied against supplier payable", ar: "تسوية دفعة مقدمة لمورد مقابل مستحقات المورد" },
  { en: "Transfer received inventory to project WIP", ar: "تحويل المخزون المستلم إلى أعمال المشروع تحت التنفيذ" },
  { en: "Service cost posted to project WIP", ar: "تحميل تكلفة خدمة على أعمال المشروع تحت التنفيذ" },
  { en: "Return - materials released back to PUC", ar: "مرتجع - إعادة المواد إلى المخزون تحت الاستخدام" },
  { en: "Customer advance payment received", ar: "استلام دفعة مقدمة من عميل" },
  { en: "Vendor advance payment paid", ar: "سداد دفعة مقدمة لمورد" },
  { en: "Cost of materials sold", ar: "تكلفة المواد المباعة" },
  { en: "Inventory receipt", ar: "استلام مخزون" },
  { en: "Revenue recognition", ar: "إثبات إيراد" },
  { en: "Revenue reversal", ar: "عكس إيراد" },
  { en: "Customer refund", ar: "رد مبلغ لعميل" },
  { en: "Vendor refund", ar: "استرداد مبلغ من مورد" },
  { en: "Purchase return", ar: "مرتجع مشتريات" },
  { en: "Supplier payment", ar: "سداد لمورد" },
  { en: "Customer payment", ar: "تحصيل من عميل" },
];

// Words that follow a phrase (" - PO 000000000007", " - reversal (80% -> 60%)").
const TOKENS: { en: RegExp; ar: string; arRe: RegExp; enText: string }[] = [
  // ERP CHG-11: purchase and sales invoices are PI / SI; PO is a purchase order.
  { en: /\bPI\b/g, ar: "فاتورة شراء", arRe: /فاتورة شراء/g, enText: "PI" },
  { en: /\bSI\b/g, ar: "فاتورة بيع", arRe: /فاتورة بيع/g, enText: "SI" },
  { en: /\bSales Order\b/g, ar: "أمر بيع", arRe: /أمر بيع/g, enText: "Sales Order" },
  { en: /\bPO\b/g, ar: "أمر شراء", arRe: /أمر شراء/g, enText: "PO" },
  { en: /\bSO\b/g, ar: "أمر بيع", arRe: /أمر بيع/g, enText: "SO" },
  { en: /\bproject\b/g, ar: "مشروع", arRe: /مشروع/g, enText: "project" },
  { en: /\breversal\b/g, ar: "عكس", arRe: /عكس/g, enText: "reversal" },
];

function swapTail(tail: string, toArabic: boolean): string {
  let out = tail;
  for (const t of TOKENS) out = toArabic ? out.replace(t.en, t.ar) : out.replace(t.arRe, t.enText);
  return out;
}

/** The description of a journal entry (or line) in the user's language, when it is a system phrase. */
export function journalDescription(text: string | null | undefined, language: string): string {
  if (!text) return text || "";
  const arabic = language.startsWith("ar");
  for (const p of PHRASES) {
    if (text.startsWith(p.en)) return arabic ? p.ar + swapTail(text.slice(p.en.length), true) : text;
    const ar = [p.ar, ...(p.legacyAr || [])].find((a) => text.startsWith(a));
    if (ar) return arabic ? text : p.en + swapTail(text.slice(ar.length), false);
  }
  return text;
}
