import { DragEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import translateHelper from "@/utils/helpers/translate";
import paths from "@/utils/constants/paths";
import { CRM_CHANNELS, CRM_STAGES, CrmLead, CrmPipelineRow, CrmStage } from "@/types/crm";
import { Language } from "@/types/language";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import LeadModal from "@/components/global/lead-modal";
import { Button } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import { isTerminalStage, stageExtraFieldRequirements } from "../_shared/lead-display";
import PipelineHeader, { PipelineFilters } from "./_components/pipeline-header";
import StageColumn from "./_components/stage-column";
import PipelineListView from "./_components/pipeline-list-view";
import PipelineSkeleton from "./_components/pipeline-skeleton";
import QuickStageChangeModal from "./_components/quick-stage-change-modal";

// A click-to-move-OR-drag Kanban board. Every stage move - whichever way it's triggered - still
// goes through the exact same PATCH crm/leads/:id/stage leads/[id]/index.tsx#StageChangeCard uses,
// so the backend's real business rules (MD approval above EGP 1M, one-stage-back-at-a-time, Lost
// reopen restricted to Admin/MD, technical's restricted destinations, etc. -
// backend/server/utils/crm/stageRules.js) are the one and only place a transition is actually
// decided. A rejected drop/menu-move never leaves the board showing a stage change that didn't
// really happen - the card simply never optimistically moves until the backend confirms it.

type PipelineData = { summary: CrmPipelineRow[]; leads: CrmLead[] };

const OPEN_STAGES: CrmStage[] = CRM_STAGES.filter((s) => s !== "won" && s !== "lost");

function extractErrorMessage(err: unknown, language: Language): string {
  if ((err as Error)?.message) return (err as Error).message;
  if ((err as { errors?: { msg: string }[] })?.errors) return (err as { errors: { msg: string }[] }).errors[0].msg;
  return translateHelper(language, "Something went wrong. Please try again later.", "حدث خطأ ما. يرجى المحاولة مرة أخرى لاحقًا.");
}

export default function CrmPipeline() {
  const { language, translate } = useLanguage();
  const navigate = useNavigate();

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<PipelineData | null>({
    initialData: null,
    initialLoading: true,
  });
  const [refreshing, setRefreshing] = useState(false);

  function load({ silent = false }: { silent?: boolean } = {}) {
    const controller = new AbortController();
    const canceled = { current: false };
    const executeFetch = async () => {
      const [summaryRes, leadsRes] = await Promise.all([
        privateRequest({ url: "crm/leads/pipeline", signal: controller.signal, language }),
        privateRequest({ url: "crm/leads", params: { limit: "1000", sort: "-createdAt" }, signal: controller.signal, language }),
      ]);
      if (!canceled.current) setData({ summary: summaryRes.data, leads: leadsRes.data });
    };
    if (silent) {
      setRefreshing(true);
      executeFetch()
        .catch((err) => setError(extractErrorMessage(err, language)))
        .finally(() => !canceled.current && setRefreshing(false));
    } else {
      handleRequest(language, setLoading, setError, executeFetch, canceled);
    }
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    const cancelRequest = load();
    return cancelRequest;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  // ===================== Filters & view mode =====================
  const [filters, setFilters] = useState<PipelineFilters>({ q: "", stage: "", owner: "", channel: "" });
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [collapsedStages, setCollapsedStages] = useState<Set<CrmStage>>(new Set());

  const filteredLeads = useMemo(() => {
    if (!data) return [];
    const q = filters.q.trim().toLowerCase();
    return data.leads.filter((l) => {
      if (filters.stage && l.stage !== filters.stage) return false;
      if (filters.owner && l.owner?._id !== filters.owner) return false;
      if (filters.channel && l.channel !== filters.channel) return false;
      if (q && !((l.name && l.name.toLowerCase().includes(q)) || l.phoneE164.includes(q) || l.refCode.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data, filters]);

  const ownerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of data?.leads ?? []) if (l.owner) map.set(l.owner._id, l.owner.name);
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);

  // Header KPI: the WHOLE pipeline's real numbers (backend aggregate), stable regardless of the
  // filters above - what's actively filtered/rendered is communicated by the board itself.
  const totalCount = data?.leads.length ?? 0;
  const totalOpenValueEgp = useMemo(
    () => (data?.summary ?? []).filter((r) => OPEN_STAGES.includes(r.stage)).reduce((sum, r) => sum + r.valueEgp, 0),
    [data],
  );

  // ===================== Stage changes (menu or drag-and-drop) =====================
  const [movingLeadId, setMovingLeadId] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<{ lead: CrmLead; to: CrmStage } | null>(null);

  function requestStageChange(lead: CrmLead, to: CrmStage) {
    if (movingLeadId) return; // one change in flight at a time - no duplicate/overlapping requests
    const { needsLostReason, needsValue, needsFollowUp } = stageExtraFieldRequirements(to);
    if (needsLostReason || needsValue || needsFollowUp) {
      setPendingChange({ lead, to });
      return;
    }
    commitStageChange(lead, to, {});
  }

  async function commitStageChange(lead: CrmLead, to: CrmStage, extra: { lostReason?: string; valueEgp?: number; followUpAt?: string }) {
    setMovingLeadId(lead._id);
    try {
      await privateRequest({ method: "PATCH", url: `crm/leads/${lead._id}/stage`, data: { to, ...extra }, language });
      load({ silent: true });
    } catch (err) {
      notifications.show({
        color: "red",
        title: translate("Could not move this lead", "تعذر نقل هذا العميل المحتمل"),
        message: extractErrorMessage(err, language),
      });
    } finally {
      setMovingLeadId(null);
    }
  }

  // ===================== Drag-and-drop (native HTML5 - no new dependency) =====================
  const [draggingLeadId, setDraggingLeadId] = useState<string | null>(null);
  const [draggingFromStage, setDraggingFromStage] = useState<CrmStage | null>(null);
  const [dragOverStage, setDragOverStage] = useState<CrmStage | null>(null);

  function handleDragStartCard(e: DragEvent<HTMLDivElement>, lead: CrmLead) {
    if (movingLeadId || isTerminalStage(lead.stage)) {
      e.preventDefault();
      return;
    }
    setDraggingLeadId(lead._id);
    setDraggingFromStage(lead.stage);
    e.dataTransfer.effectAllowed = "move";
  }
  function handleDragEndCard() {
    setDraggingLeadId(null);
    setDraggingFromStage(null);
    setDragOverStage(null);
  }
  function handleDragOverColumn(_e: DragEvent<HTMLDivElement>, stage: CrmStage) {
    if (dragOverStage !== stage) setDragOverStage(stage);
  }
  function handleDragLeaveColumn() {
    setDragOverStage(null);
  }
  function handleDropColumn(_e: DragEvent<HTMLDivElement>, stage: CrmStage) {
    const lead = data?.leads.find((l) => l._id === draggingLeadId) || null;
    setDraggingLeadId(null);
    setDraggingFromStage(null);
    setDragOverStage(null);
    if (!lead || lead.stage === stage) return;
    requestStageChange(lead, stage);
  }

  const hasAnyLeads = (data?.leads.length ?? 0) > 0;
  const hasActiveFilters = !!(filters.q || filters.stage || filters.owner || filters.channel);

  return (
    <AdminLayoutBox>
      <PipelineHeader
        totalCount={totalCount}
        totalValueEgp={totalOpenValueEgp}
        filters={filters}
        onFiltersChange={setFilters}
        ownerOptions={ownerOptions}
        channelOptions={CRM_CHANNELS}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        refreshing={refreshing}
        onRefresh={() => load({ silent: true })}
        onNewLead={openModal}
      />

      <div className="mt-4">
        {loading ? (
          <PipelineSkeleton />
        ) : error ? (
          <ErrorSection errorTitle={translate("Error loading pipeline", "خطأ في تحميل المسار")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
        ) : !data ? null : !hasAnyLeads ? (
          <EmptySection useDefaultImg message={translate("No leads yet", "لا يوجد عملاء محتملون حتى الآن")}>
            <Button onClick={openModal} color="teal" leftSection={<solidIcons.Plus />}>
              {translate("Create the first lead", "إنشاء أول عميل محتمل")}
            </Button>
          </EmptySection>
        ) : hasActiveFilters && filteredLeads.length === 0 ? (
          <EmptySection message={translate("No leads match these filters", "لا يوجد عملاء محتملون يطابقون هذه الفلاتر")}>
            <Button variant="light" color="gray" onClick={() => setFilters({ q: "", stage: "", owner: "", channel: "" })}>
              {translate("Clear filters", "إزالة الفلاتر")}
            </Button>
          </EmptySection>
        ) : viewMode === "list" ? (
          <PipelineListView leads={filteredLeads} />
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {CRM_STAGES.map((stage) => {
              const leads = filteredLeads.filter((l) => l.stage === stage);
              const valueEgp = leads.reduce((sum, l) => sum + (l.valueEgp || 0), 0);
              return (
                <StageColumn
                  key={stage}
                  stage={stage}
                  count={leads.length}
                  valueEgp={valueEgp}
                  leads={leads}
                  collapsed={collapsedStages.has(stage)}
                  onToggleCollapse={() =>
                    setCollapsedStages((prev) => {
                      const next = new Set(prev);
                      next.has(stage) ? next.delete(stage) : next.add(stage);
                      return next;
                    })
                  }
                  draggingFromStage={draggingFromStage}
                  draggingLeadId={draggingLeadId}
                  isDragOver={dragOverStage === stage}
                  movingLeadId={movingLeadId}
                  onDragStartCard={handleDragStartCard}
                  onDragEndCard={handleDragEndCard}
                  onDragOverColumn={handleDragOverColumn}
                  onDragLeaveColumn={handleDragLeaveColumn}
                  onDropColumn={handleDropColumn}
                  onOpenLead={(lead) => navigate(`/${paths.crm}/${paths.leads}/${lead._id}`)}
                  onRequestStageChange={requestStageChange}
                />
              );
            })}
          </div>
        )}
      </div>

      <LeadModal opened={modalOpened} close={closeModal} callback={(lead) => navigate(`/${paths.crm}/${paths.leads}/${lead._id}`)} />

      <QuickStageChangeModal
        lead={pendingChange?.lead || null}
        to={pendingChange?.to || null}
        onClose={() => setPendingChange(null)}
        onChanged={() => load({ silent: true })}
      />
    </AdminLayoutBox>
  );
}
