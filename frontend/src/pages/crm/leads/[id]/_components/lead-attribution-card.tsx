import dayjs from "dayjs";
import { useLanguage } from "@/context/LanguageContext";
import { CrmLead, CrmTouch } from "@/types/crm";

/**
 * CRM launch blocker C1 - how the lead was acquired. FIRST touch = the campaign/page that first
 * brought the customer in (never overwritten by internal navigation, a language switch or a later
 * enquiry); LAST touch = the most recent attributable campaign before conversion. Ad click ids are
 * shown when present. Leads created before touches existed show their stored first-touch fields.
 */
export default function LeadAttributionCard({ lead }: { lead: CrmLead }) {
  const { translate } = useLanguage();
  const legacyFirst: CrmTouch | null =
    lead.utmSource || lead.landingPage || lead.campaign || lead.referrer
      ? {
          channel: lead.channel, source: lead.source, utmSource: lead.utmSource ?? null, utmMedium: lead.utmMedium ?? null, utmCampaign: lead.utmCampaign ?? null,
          utmTerm: lead.utmTerm ?? null, utmContent: lead.utmContent ?? null, gclid: lead.gclid ?? null, gbraid: lead.gbraid ?? null, wbraid: lead.wbraid ?? null,
          fbclid: lead.fbclid ?? null, ttclid: lead.ttclid ?? null, campaign: lead.campaign ?? null, adSetName: lead.adSetName ?? null, adName: lead.adName ?? null,
          landingPage: lead.landingPage ?? null, landingUrl: null, referrer: lead.referrer ?? null, at: lead.submittedAt ?? lead.createdAt,
        }
      : null;
  const first = lead.firstTouch || legacyFirst;
  const last = lead.lastTouch;
  if (!first && !last) return null;
  const lastDiffers = !!last && !!first && JSON.stringify({ ...last, at: null }) !== JSON.stringify({ ...first, at: null });

  return (
    <div className="rounded-lg border border-gray-100 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-gray-800">{translate("Attribution", "مصدر العميل")}</h3>
      {first && <TouchBlock title={translate("First touch (acquisition)", "أول نقطة تواصل (الاكتساب)")} t={first} />}
      {last && lastDiffers && <TouchBlock title={translate("Last touch (most recent campaign)", "آخر نقطة تواصل (أحدث حملة)")} t={last} />}
      {last && !lastDiffers && <p className="mt-1 text-xs text-gray-400">{translate("Last touch: same as the first touch.", "آخر نقطة تواصل: نفس الأولى.")}</p>}
      {lead.attributionHistory && lead.attributionHistory.length > 2 && (
        <details className="mt-2 text-xs text-gray-500">
          <summary className="cursor-pointer">{translate(`Attribution history (${lead.attributionHistory.length})`, `سجل المصادر (${lead.attributionHistory.length})`)}</summary>
          <ul className="mt-1 list-disc ps-4">
            {lead.attributionHistory.map((h, i) => (
              <li key={i}>
                {h.at ? dayjs(h.at).format("DD MMM YYYY HH:mm") : "-"} - {[h.source, h.utmSource && `${h.utmSource}/${h.utmMedium ?? ""}`, h.campaign, h.landingPage].filter(Boolean).join(" - ")}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TouchBlock({ title, t }: { title: string; t: CrmTouch }) {
  const { translate } = useLanguage();
  const clickIds = (["gclid", "gbraid", "wbraid", "fbclid", "ttclid"] as const).filter((k) => t[k]);
  const row = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="flex justify-between gap-3 py-0.5 text-sm">
        <span className="text-gray-500">{label}</span>
        <span className="max-w-[200px] truncate text-end font-medium text-gray-800" title={typeof value === "string" ? value : undefined}>
          {value}
        </span>
      </div>
    ) : null;
  return (
    <div className="mb-2 border-b border-gray-50 pb-2">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h4>
      {row(translate("Source", "المصدر"), t.source)}
      {row(translate("Medium", "الوسيط"), t.utmMedium)}
      {row(translate("Campaign", "الحملة"), t.campaign || t.utmCampaign)}
      {row(translate("UTM source", "مصدر UTM"), t.utmSource)}
      {row(translate("UTM term", "كلمة UTM"), t.utmTerm)}
      {row(translate("UTM content", "محتوى UTM"), t.utmContent)}
      {row(translate("Ad set", "مجموعة الإعلانات"), t.adSetName)}
      {row(translate("Ad", "الإعلان"), t.adName)}
      {row(translate("Landing page", "صفحة الهبوط"), t.landingPage)}
      {row(translate("Referrer", "المرجع"), t.referrer)}
      {clickIds.map((k) => row(k, t[k]))}
      {row(translate("When", "التاريخ"), t.at ? dayjs(t.at).format("DD MMM YYYY HH:mm") : null)}
    </div>
  );
}
