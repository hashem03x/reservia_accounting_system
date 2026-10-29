import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatAmount } from "@/utils/helpers/format-amount";
import paths from "@/utils/constants/paths";
import { CRM_STAGES, CrmLead, CrmPipelineRow } from "@/types/crm";
import { Badge, Button, Card } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import { solidIcons } from "@/components/icons";
import LeadModal from "@/components/global/lead-modal";
import { crmStageLabel, stageBadgeColor } from "../_shared/stage";

// A click-to-move Kanban-style board, not drag-and-drop - every stage move must pass
// utils/crm/stageRules.js's validation (MD approval above EGP 1M, one-stage-back-at-a-time, Lost
// reopen restricted, etc.), so "drop a card anywhere" would mean either silently failing most
// drops or re-implementing those rules client-side; a lead's own detail page (where the real
// stage-change form already lives) is the one place a transition is actually made. This board is
// for an at-a-glance view of the pipeline and jumping into a lead, matching the brief's dashboard
// requirement without duplicating the stage-transition logic.

export default function CrmPipeline() {
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const stageLabel = crmStageLabel(translate);

  useDocumentTitle(`${translate("Pipeline", "المسار")} | Reservia CRM`);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<{
    summary: CrmPipelineRow[];
    leads: CrmLead[];
  } | null>({ initialData: null, initialLoading: true });

  function load() {
    const controller = new AbortController();
    const canceled = { current: false };
    const executeFetch = async () => {
      const [summaryRes, leadsRes] = await Promise.all([
        privateRequest({ url: "crm/leads/pipeline", signal: controller.signal, language }),
        privateRequest({ url: "crm/leads", params: { limit: "1000", sort: "-createdAt" }, signal: controller.signal, language }),
      ]);
      setData({ summary: summaryRes.data, leads: leadsRes.data });
    };
    handleRequest(language, setLoading, setError, executeFetch, canceled);
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    const cancelRequest = load();
    return cancelRequest;
  }, []);

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  const isOverdue = (lead: CrmLead) => !lead.firstReplyAt && new Date(lead.replyDueAt).getTime() < Date.now();

  return (
    <AdminLayoutBox
      header={{
        title: translate("Pipeline", "المسار"),
        sideElements: (
          <Button onClick={openModal} color="teal" leftSection={<solidIcons.Plus />}>
            {translate("New Lead", "عميل محتمل جديد")}
          </Button>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading pipeline...", "جاري تحميل المسار...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Error loading pipeline", "خطأ في تحميل المسار")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
      ) : data ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {CRM_STAGES.map((stage) => {
            const row = data.summary.find((r) => r.stage === stage);
            const leads = data.leads.filter((l) => l.stage === stage);
            return (
              <div key={stage} className="flex w-[260px] shrink-0 flex-col gap-2 rounded-lg bg-white p-2 shadow-sm">
                <div className="flex items-center justify-between px-1">
                  <Badge color={stageBadgeColor(stage)} variant="light">
                    {stageLabel(stage)}
                  </Badge>
                  <span className="text-xs text-gray-500">{row?.count ?? 0}</span>
                </div>
                {!!row?.valueEgp && <p className="px-1 text-xs text-gray-500">{formatAmount(row.valueEgp, translations.currency)}</p>}
                <div className="flex flex-col gap-2">
                  {leads.map((lead) => (
                    <Card key={lead._id} withBorder padding="xs" radius="md" className="cursor-pointer hover:shadow-md" onClick={() => navigate(`/${paths.crm}/${paths.leads}/${lead._id}`)}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-sm font-medium">{lead.name || lead.phoneE164}</span>
                        {isOverdue(lead) && <span title={translate("Reply overdue", "الرد متأخر")} className="h-2 w-2 shrink-0 rounded-full bg-red-500" />}
                      </div>
                      <p className="truncate text-xs text-gray-500">{lead.refCode}</p>
                      {!!lead.valueEgp && <p className="text-xs font-semibold text-gray-700">{formatAmount(lead.valueEgp, translations.currency)}</p>}
                    </Card>
                  ))}
                  {leads.length === 0 && <p className="px-1 text-xs text-gray-400">{translate("No leads", "لا يوجد عملاء")}</p>}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <LeadModal opened={modalOpened} close={closeModal} callback={(lead) => navigate(`/${paths.crm}/${paths.leads}/${lead._id}`)} />
    </AdminLayoutBox>
  );
}
