import { useEffect } from "react";
import dayjs from "dayjs";
import { Button, Table } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatAmount } from "@/utils/helpers/format-amount";
import SectionCard from "@/components/ui/section-card";
import EmptySection from "@/components/ui/sections/empty";
import PrintDocument from "@/components/ui/print-document";
import { CommercialPricing, CommercialProject, CommercialRevision } from "@/types/commercial";

type Proposal = { _id: string; version: number; issuedAt: string; validUntil: string; pricingSnapshot: CommercialPricing };

// Issuing a proposal freezes a snapshot of the revision's current BOQ/pricing/feasibility
// (services/commercial/proposalService.js) - a later Price Book change or revision edit can
// never retroactively alter a proposal already issued, mirroring CRM's own quotation guarantee.
export default function ProposalTab({ project, revision }: { project: CommercialProject; revision: CommercialRevision }) {
  const { translate, language } = useLanguage();
  const { privateRequest, loading, setLoading, error, setError, data: proposals, setData: setProposals } = useDataHandler<Proposal[]>({ initialData: [], initialLoading: true });

  function reload() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `commercial/proposals/project/${project._id}`, language });
      setProposals(res.data as Proposal[]);
    });
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision._id]);

  function issue() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ url: `commercial/proposals/revision/${revision._id}`, method: "POST", language });
      reload();
    });
  }

  const canIssue = revision.releaseStatus === "APPROVED FOR ISSUE";

  return (
    <SectionCard
      title={translate("Proposals", "العروض")}
      action={
        <Button onClick={issue} disabled={!canIssue} loading={loading} color="teal">
          {translate("Issue Proposal", "إصدار العرض")}
        </Button>
      }
    >
      {!canIssue && <p className="mb-3 text-xs text-amber-600">{translate("Every required approval stage must be Approved before a proposal can be issued.", "يجب الموافقة على كل مرحلة مطلوبة قبل إصدار العرض.")}</p>}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {!proposals.length ? (
        <EmptySection useDefaultImg message={translate("No proposals issued yet", "لم يتم إصدار أي عرض بعد")} />
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{translate("Version", "النسخة")}</Table.Th>
              <Table.Th>{translate("Issued", "تاريخ الإصدار")}</Table.Th>
              <Table.Th>{translate("Valid Until", "صالح حتى")}</Table.Th>
              <Table.Th>{translate("Final Price", "السعر النهائي")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {proposals.map((p) => (
              <Table.Tr key={p._id}>
                <Table.Td>#{p.version}</Table.Td>
                <Table.Td>{dayjs(p.issuedAt).format("DD MMM YYYY")}</Table.Td>
                <Table.Td>{dayjs(p.validUntil).format("DD MMM YYYY")}</Table.Td>
                <Table.Td className="font-medium">{formatAmount(p.pricingSnapshot?.grossInclVat, project.currency)}</Table.Td>
                <Table.Td>
                  <PrintDocument title={translate("Print", "طباعة")} paperWidth={210} paperHeight={297} buttonType="Button">
                    <ProposalPrintView project={project} proposal={p} />
                  </PrintDocument>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </SectionCard>
  );
}

function ProposalPrintView({ project, proposal }: { project: CommercialProject; proposal: Proposal }) {
  const p = proposal.pricingSnapshot;
  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h1 style={{ color: "#123B5D" }}>Reservia Integrated Energy Solutions</h1>
      <h2>Commercial Proposal - {project.projectCode}</h2>
      <p>
        Customer: {project.customer?.name} <br />
        Project: {project.name} ({project.category}) <br />
        Issued: {dayjs(proposal.issuedAt).format("DD MMM YYYY")} - Valid until {dayjs(proposal.validUntil).format("DD MMM YYYY")}
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 20 }}>
        <tbody>
          <tr><td style={{ padding: 6 }}>Net Price (excl. VAT)</td><td style={{ padding: 6, textAlign: "right" }}>{formatAmount(p?.netExclVat, project.currency)}</td></tr>
          <tr><td style={{ padding: 6 }}>VAT</td><td style={{ padding: 6, textAlign: "right" }}>{formatAmount(p?.vatAmt, project.currency)}</td></tr>
          <tr style={{ fontWeight: "bold" }}><td style={{ padding: 6 }}>Final Price (incl. VAT)</td><td style={{ padding: 6, textAlign: "right" }}>{formatAmount(p?.grossInclVat, project.currency)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
