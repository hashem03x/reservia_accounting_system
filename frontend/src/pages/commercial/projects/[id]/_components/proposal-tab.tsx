import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { Alert, Badge, Button, Table, Textarea, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useDataHandler from "@/hooks/useDataHandler";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import errorMessage from "@/utils/helpers/error-message";
import { formatAmount } from "@/utils/helpers/format-amount";
import SectionCard from "@/components/ui/section-card";
import EmptySection from "@/components/ui/sections/empty";
import { CommercialPricing, CommercialProject, CommercialRevision } from "@/types/commercial";

type Proposal = {
  _id: string;
  version: number;
  proposalNumber: string | null;
  issuedAt: string;
  validUntil: string;
  pricingSnapshot: CommercialPricing;
  pdfHash?: string | null;
  pdfSize?: number | null;
  issuedBy?: { _id: string; name: string } | string | null;
  leadAttachmentId?: string | null;
  leadAttachmentError?: string | null;
};

// Roles that may open the internal copy (priced BOQ, pricing stack, approval log) - the backend
// enforces the same list (controller/commercial/proposalController.js).
const INTERNAL_ROLES = ["md", "commercial_director", "sales"];
// Deal Engine C20: who may release past the supplier-price rule (backend proposalService RELEASE_OVERRIDE_ROLES).
const OVERRIDE_ROLES = ["commercial_director", "md"];

// Deal Engine C12-C17. Preview the next proposal (DRAFT watermark) at any time; issue it once every
// required approval is in - the PDF is rendered on the letterhead, stored with its SHA-256 and
// attached to the CRM lead. A re-issue is a new number; earlier PDFs stay downloadable.
export default function ProposalTab({ project, revision }: { project: CommercialProject; revision: CommercialRevision }) {
  const { translate, language } = useLanguage();
  const { systems } = useSystemAccess();
  const role = systems?.COMMERCIAL?.role || "";
  const canInternal = INTERNAL_ROLES.includes(role);
  const privateRequest = usePrivateRequest();
  const { loading, setLoading, error, setError, data: proposals, setData: setProposals } = useDataHandler<Proposal[]>({ initialData: [], initialLoading: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [overrideNote, setOverrideNote] = useState("");
  const canOverride = OVERRIDE_ROLES.includes(role);

  function reload() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `commercial/proposals/project/${project._id}`, language });
      setProposals(res.data as Proposal[]);
    });
  }

  async function loadReleaseCheck() {
    try {
      const res = await privateRequest({ url: `commercial/proposals/revision/${revision._id}/release-check`, language });
      setBlockers((res.data as { blockers: string[] }).blockers || []);
    } catch {
      setBlockers([]);
    }
  }

  useEffect(() => {
    reload();
    loadReleaseCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision._id, revision.updatedAt]);

  /** Opens a PDF in a new tab (opened synchronously so a popup blocker allows it), else downloads it. */
  async function openPdf(key: string, url: string) {
    setBusy(key);
    setNotice(null);
    const tab = window.open("", "_blank");
    try {
      const res = (await privateRequest({ url, language, responseType: "blob" })) as { blob: Blob; filename: string };
      const objectUrl = URL.createObjectURL(res.blob);
      if (tab) tab.location.href = objectUrl;
      else {
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = res.filename;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      tab?.close();
      setNotice({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function issue() {
    setBusy("issue");
    setNotice(null);
    try {
      const res = await privateRequest({ url: `commercial/proposals/revision/${revision._id}`, method: "POST", data: blockers.length ? { releaseOverrideNote: overrideNote } : {}, language });
      const p = res.data as Proposal;
      setNotice({
        ok: true,
        text: p.leadAttachmentError
          ? translate(`Proposal ${p.proposalNumber} issued. The CRM lead could not be updated: ${p.leadAttachmentError}`, `تم إصدار العرض ${p.proposalNumber}. تعذر تحديث العميل في النظام: ${p.leadAttachmentError}`)
          : translate(`Proposal ${p.proposalNumber} issued and stored.`, `تم إصدار العرض ${p.proposalNumber} وحفظه.`),
      });
      setOverrideNote("");
      reload();
      loadReleaseCheck();
    } catch (e) {
      setNotice({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  const canIssue = revision.releaseStatus === "APPROVED FOR ISSUE" && revision.status !== "Draft";
  const issuer = (p: Proposal) => (p.issuedBy && typeof p.issuedBy === "object" ? p.issuedBy.name : "-");

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title={translate("Proposal document", "مستند العرض")}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="light" loading={busy === "preview"} onClick={() => openPdf("preview", `commercial/proposals/revision/${revision._id}/preview`)} data-testid="proposal-preview">
              {translate("Preview (customer copy)", "معاينة (نسخة العميل)")}
            </Button>
            {canInternal && (
              <Button variant="light" color="gray" loading={busy === "preview-int"} onClick={() => openPdf("preview-int", `commercial/proposals/revision/${revision._id}/preview?copy=internal`)} data-testid="proposal-preview-internal">
                {translate("Preview (internal copy)", "معاينة (النسخة الداخلية)")}
              </Button>
            )}
            <Button onClick={issue} disabled={!canIssue || (blockers.length > 0 && (!canOverride || overrideNote.trim().length < 5))} loading={busy === "issue"} color={blockers.length ? "orange" : "teal"} data-testid="proposal-issue">
              {translate("Issue Proposal", "إصدار العرض")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-gray-600">
          {translate(
            "The preview is the next proposal as it will be issued, marked DRAFT, NOT FOR ISSUE on every page. The customer copy shows no unit prices; the internal copy adds the priced BOQ, the pricing stack and the approval log.",
            "المعاينة هي العرض التالي كما سيصدر، ومختومة بعبارة مسودة غير صالحة للإصدار على كل صفحة. نسخة العميل لا تعرض أسعار الوحدات؛ والنسخة الداخلية تضيف جدول الكميات بالأسعار وهيكل التسعير وسجل الموافقات.",
          )}
        </p>
        {!canIssue && (
          <p className="mt-2 text-xs text-amber-600">
            {translate("Every required approval stage must be Approved (and the revision calculated) before a proposal can be issued.", "يجب الموافقة على كل مرحلة مطلوبة (وحساب النسخة) قبل إصدار العرض.")}
          </p>
        )}
        {blockers.length > 0 && (
          <Alert mt="sm" color="orange" variant="light" title={translate("Release blocked by the supplier price rule", "الإصدار متوقف بسبب قاعدة أسعار الموردين")} data-testid="release-blockers">
            <ul className="list-disc ps-5 text-xs">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            {canOverride ? (
              <Textarea
                mt="xs"
                size="xs"
                label={translate("Override note (Commercial Director) - required to issue", "ملاحظة التجاوز (المدير التجاري) - مطلوبة للإصدار")}
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
                autosize
                minRows={2}
                data-testid="release-override-note"
              />
            ) : (
              <p className="mt-1 text-xs">{translate("Upload current supplier prices and recalculate, or ask the Commercial Director to override.", "ارفع أسعار موردين حالية وأعد الحساب، أو اطلب من المدير التجاري التجاوز.")}</p>
            )}
          </Alert>
        )}
        {notice && (
          <Alert mt="sm" color={notice.ok ? "teal" : "red"} variant="light" data-testid="proposal-notice">
            {notice.text}
          </Alert>
        )}
      </SectionCard>

      <SectionCard title={translate("Issued proposals", "العروض الصادرة")}>
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        {!loading && !proposals.length ? (
          <EmptySection useDefaultImg message={translate("No proposals issued yet", "لم يتم إصدار أي عرض بعد")} />
        ) : (
          <div className="overflow-x-auto">
            <Table miw={760} data-testid="proposals-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{translate("Proposal No.", "رقم العرض")}</Table.Th>
                  <Table.Th>{translate("Issued", "تاريخ الإصدار")}</Table.Th>
                  <Table.Th>{translate("By", "بواسطة")}</Table.Th>
                  <Table.Th>{translate("Valid Until", "صالح حتى")}</Table.Th>
                  <Table.Th>{translate("Final Price", "السعر النهائي")}</Table.Th>
                  <Table.Th>{translate("CRM lead", "العميل في النظام")}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {proposals.map((p) => (
                  <Table.Tr key={p._id}>
                    <Table.Td className="font-medium">
                      {p.proposalNumber || `#${p.version}`}
                      {p.pdfHash && (
                        <Tooltip label={`SHA-256 ${p.pdfHash}`} multiline w={320}>
                          <div className="font-mono text-[10px] text-gray-400">{p.pdfHash.slice(0, 12)}...</div>
                        </Tooltip>
                      )}
                    </Table.Td>
                    <Table.Td>{dayjs(p.issuedAt).format("DD MMM YYYY HH:mm")}</Table.Td>
                    <Table.Td>{issuer(p)}</Table.Td>
                    <Table.Td>{dayjs(p.validUntil).format("DD MMM YYYY")}</Table.Td>
                    <Table.Td>{formatAmount(p.pricingSnapshot?.grossInclVat, project.currency)}</Table.Td>
                    <Table.Td>
                      {!project.crmLead ? (
                        <span className="text-xs text-gray-400">-</span>
                      ) : p.leadAttachmentId ? (
                        <Badge color="teal" variant="light">{translate("PDF attached", "تم إرفاق الملف")}</Badge>
                      ) : p.leadAttachmentError ? (
                        <Tooltip label={p.leadAttachmentError} multiline w={280}>
                          <Badge color="red" variant="light">{translate("Not attached", "لم يُرفق")}</Badge>
                        </Tooltip>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <div className="flex flex-wrap justify-end gap-1">
                        {p.pdfHash ? (
                          <Button size="compact-xs" variant="light" loading={busy === `c-${p._id}`} onClick={() => openPdf(`c-${p._id}`, `commercial/proposals/${p._id}/pdf`)}>
                            {translate("Customer PDF", "ملف العميل")}
                          </Button>
                        ) : (
                          <span className="text-xs text-gray-400">{translate("Issued before PDFs were stored", "صدر قبل حفظ الملفات")}</span>
                        )}
                        {canInternal && p.pdfHash && (
                          <Button size="compact-xs" variant="subtle" color="gray" loading={busy === `i-${p._id}`} onClick={() => openPdf(`i-${p._id}`, `commercial/proposals/${p._id}/pdf?copy=internal`)}>
                            {translate("Internal PDF", "الملف الداخلي")}
                          </Button>
                        )}
                      </div>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
