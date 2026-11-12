import { useState } from "react";
import { Link } from "react-router-dom";
import errorMessage from "@/utils/helpers/error-message";
import dayjs from "dayjs";
import { Alert, Badge, Button } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { CrmLead } from "@/types/crm";
import paths from "@/utils/constants/paths";

const SYNC_STAGES = ["proposal_sent", "negotiation", "won", "lost"];

/**
 * QA finding B5 - the Commercial deal this lead created at "Proposal sent", with the identifiers
 * Commercial returned (Deal #, Proposal #, proposed and actual ERP project #), the sync status of
 * the last event, and a retry for a failed sync. The backend re-runs the sync idempotently - one
 * lead never creates two deals.
 */
export default function LeadCommercialCard({ lead, onChanged }: { lead: CrmLead; onChanged: () => void }) {
  const { translate, language } = useLanguage();
  const { systems } = useSystemAccess();
  const privateRequest = usePrivateRequest();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const c = lead.commercial;
  const eligible = SYNC_STAGES.includes(lead.stage);
  if (!c && !eligible) return null;

  async function retry() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await privateRequest({ url: `crm/leads/${lead._id}/commercial-sync`, method: "POST", language });
      setMessage({ ok: true, text: res.message || translate("Synchronized.", "تمت المزامنة.") });
      onChanged();
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3 border-b border-gray-50 py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-end font-medium text-gray-800">{value ?? "-"}</span>
    </div>
  );
  const canOpenCommercial = !!systems?.COMMERCIAL && !!c?.project;
  // CRM Changes Required, item 1: while the deal is out of sync, Won is refused by the server - say so
  // here, next to the Retry button, instead of only when the user tries to mark the lead Won.
  const wonBlocked = lead.stage !== "won" && lead.stage !== "lost" && c?.syncStatus === "failed";
  // Deal Engine C25: on a Lost lead there is nothing to send - the button is disabled with the reason.
  const nothingToSend = lead.stage === "lost" && !c?.dealNumber;

  return (
    <div className="rounded-lg border border-gray-100 bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800">{translate("Deal Engine deal", "صفقة محرك الصفقات")}</h3>
        {c?.syncStatus && (
          <Badge color={c.syncStatus === "failed" ? "red" : "teal"} variant="light">
            {c.syncStatus === "failed" ? translate("Sync failed", "فشلت المزامنة") : translate("Synced", "متزامن")}
          </Badge>
        )}
      </div>
      {c?.dealNumber ? (
        <>
          {row(translate("Deal #", "رقم الصفقة"), canOpenCommercial ? <Link className="text-primary-600 underline" to={`/${paths.commercial}/${paths.commercialProjects}/${c.project}`}>{c.dealNumber}</Link> : c.dealNumber)}
          {row(translate("Deal Engine project", "مشروع محرك الصفقات"), c.projectCode)}
          {row(translate("Proposal #", "رقم العرض"), c.proposalNumber)}
          {row(translate("ERP project # (proposed)", "رقم مشروع ERP (مقترح)"), c.proposedErpProjectNumber)}
          {row(translate("ERP project # (actual)", "رقم مشروع ERP (فعلي)"), c.erpProjectNumber || translate("Not created yet", "لم يُنشأ بعد"))}
        </>
      ) : (
        <p className="text-sm text-gray-500">
          {eligible
            ? translate("No Deal Engine deal yet for this lead.", "لا توجد صفقة في محرك الصفقات لهذا العميل بعد.")
            : translate("A Deal Engine deal is created when the lead reaches Proposal sent.", "تُنشأ الصفقة في محرك الصفقات عند وصول العميل إلى مرحلة إرسال العرض.")}
        </p>
      )}
      {c?.lastSyncAt && (
        <p className="mt-2 text-xs text-gray-400">
          {translate("Last sync", "آخر مزامنة")}: {c.lastEvent} - {dayjs(c.lastSyncAt).format("DD MMM YYYY HH:mm")}
          {c.attempts ? ` (${c.attempts} ${translate("attempts", "محاولات")})` : ""}
        </p>
      )}
      {c?.syncStatus === "failed" && c.lastError && <p className="mt-1 text-xs text-red-600">{c.lastError}</p>}
      {wonBlocked && (
        <Alert mt="xs" color="red" variant="light" p="xs" data-testid="deal-sync-won-blocked">
          {translate(
            "This lead cannot be marked Won until its Deal Engine deal is in sync. Fix the problem above (for a missing governorate use Edit on Lead Details), then press Retry.",
            "لا يمكن تحويل هذا العميل إلى فوز حتى تتم مزامنة صفقته في محرك الصفقات. أصلح المشكلة أعلاه (للمحافظة الناقصة استخدم تعديل في تفاصيل العميل) ثم اضغط إعادة المحاولة.",
          )}
        </Alert>
      )}
      {message && <p className={`mt-1 text-xs ${message.ok ? "text-teal-700" : "text-red-600"}`}>{message.text}</p>}
      {eligible && (c?.syncStatus === "failed" || !c?.dealNumber) && (
        <>
          <Button mt="sm" size="xs" variant="light" loading={busy} onClick={retry} disabled={nothingToSend} data-testid="deal-sync-retry">
            {c?.syncStatus === "failed" ? translate("Retry Deal Engine sync", "إعادة محاولة المزامنة") : translate("Send to Deal Engine", "إرسال إلى محرك الصفقات")}
          </Button>
          {nothingToSend && <p className="mt-1 text-xs text-gray-500">{translate("Nothing to send to the Deal Engine for this lead (it was lost before a proposal).", "لا يوجد ما يُرسل إلى محرك الصفقات لهذا العميل (خُسر قبل إرسال عرض).")}</p>}
        </>
      )}
    </div>
  );
}
