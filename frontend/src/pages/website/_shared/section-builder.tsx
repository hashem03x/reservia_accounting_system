import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Tabs, TextInput, Tooltip } from "@mantine/core";
import { DndContext, DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLanguage } from "@/context/LanguageContext";
import useWebsiteSections from "@/hooks/useWebsiteSections";
import { notifyError, notifySuccess } from "@/utils/helpers/notifiers";
import Modal from "@/components/ui/modal";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import { SectionRegistry, SectionSettings, SectionTypeDef, WebsiteSection } from "@/types/website";
import { errorMessage, useBeforeUnload, useConfirm, useSectionRegistry, useWebsiteRole } from "./cms";
import { defaultContent, mergeSettings, missingRequired, SectionForm, SectionSettingsForm } from "./section-form";

// Website Management - the page builder. Left: the page's sections in order (drag to reorder,
// hide/show, duplicate, delete). Right: the selected section's own editor (Content - the fields of
// its type; Settings - devices, background, spacing, alignment, width, anchor). Saving a section
// changes the DRAFT only; the page's Publish puts it live.

type Draft = { content: Record<string, unknown>; settings: SectionSettings; adminLabel: string };

export default function SectionBuilder({ pageId, onDraftChanged, onPreview }: { pageId: string; onDraftChanged: () => void; onPreview?: () => void }) {
  const { language, translate } = useLanguage();
  const { can } = useWebsiteRole();
  const canEdit = can("edit");
  const confirm = useConfirm();
  const { registry, error: registryError } = useSectionRegistry();
  const { sections, loading, error, reload, createSection, updateSection, reorderSections, duplicateSection, deleteSection } = useWebsiteSections(pageId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<string | null>("content");

  const selected = sections.find((s) => s._id === selectedId) || null;
  const defs = useMemo(() => new Map((registry?.types || []).map((t) => [t.type, t])), [registry]);
  const def = selected ? defs.get(selected.type) : undefined;
  const baseline = (s: WebsiteSection | null): Draft | null => (s && registry ? { content: s.content || {}, settings: mergeSettings(registry, s.settings), adminLabel: s.adminLabel || "" } : null);
  const dirty = !!draft && !!selected && JSON.stringify(draft) !== JSON.stringify(baseline(selected));
  useBeforeUnload(dirty);

  useEffect(() => {
    if (!selectedId && sections.length) setSelectedId(sections[0]._id);
  }, [sections, selectedId]);
  useEffect(() => {
    setDraft(baseline(selected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?._id, selected?.updatedAt, registry]);

  async function guardLeave() {
    if (!dirty) return true;
    return confirm({ title: translate("Discard unsaved changes?", "تجاهل التغييرات غير المحفوظة؟"), message: translate("This section has changes that are not saved.", "يحتوي هذا القسم على تغييرات غير محفوظة."), confirmLabel: translate("Discard", "تجاهل"), danger: true });
  }

  async function select(id: string) {
    if (id === selectedId) return;
    if (!(await guardLeave())) return;
    setSelectedId(id);
    setTab("content");
  }

  async function save() {
    if (!selected || !draft || !def) return;
    const missing = missingRequired(def, draft.content);
    if (missing.length) {
      notifyError({ language, message: `${translate("Fill in the required fields: ", "أكمل الحقول المطلوبة: ")}${missing.join(", ")}` });
      return;
    }
    setSaving(true);
    try {
      await updateSection(selected._id, { content: draft.content, settings: draft.settings, adminLabel: draft.adminLabel });
      notifySuccess({ language, message: translate("Section saved to the draft.", "تم حفظ القسم في المسودة.") });
      onDraftChanged();
    } catch (err) {
      notifyError({ language, message: errorMessage(err, translate("Could not save the section", "تعذر حفظ القسم")) });
    } finally {
      setSaving(false);
    }
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      notifySuccess({ language, message: ok });
      onDraftChanged();
    } catch (err) {
      notifyError({ language, message: errorMessage(err, translate("The action failed", "فشل الإجراء")) });
    }
  }

  async function add(t: SectionTypeDef) {
    if (!(await guardLeave())) return;
    const index = selected ? sections.findIndex((s) => s._id === selected._id) + 1 : sections.length;
    try {
      const created = await createSection(t.type, defaultContent(t), index);
      setAdding(false);
      setSelectedId(created._id);
      setTab("content");
      notifySuccess({ language, message: translate(`${t.labelEn} added. Fill it in and save.`, `تمت إضافة ${t.labelAr}. أكمله واحفظه.`) });
      onDraftChanged();
    } catch (err) {
      notifyError({ language, message: errorMessage(err, translate("Could not add the section", "تعذرت إضافة القسم")) });
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = sections.findIndex((s) => s._id === e.active.id);
    const to = sections.findIndex((s) => s._id === e.over!.id);
    const order = arrayMove(sections, from, to).map((s) => s._id);
    run(() => reorderSections(order), translate("Order saved.", "تم حفظ الترتيب."));
  }
  const moveBy = (id: string, d: number) => {
    const from = sections.findIndex((s) => s._id === id);
    const to = from + d;
    if (to < 0 || to >= sections.length) return;
    run(() => reorderSections(arrayMove(sections, from, to).map((s) => s._id)), translate("Order saved.", "تم حفظ الترتيب."));
  };

  if (registryError) return <Alert color="red">{registryError}</Alert>;
  if (loading || !registry) return <LoadingSection message={translate("Loading sections...", "جاري تحميل الأقسام...")} />;
  if (error) return <ErrorSection errorTitle={translate("Could not load sections", "تعذر تحميل الأقسام")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: reload }} />;

  const typeLabel = (type: string) => {
    const d = defs.get(type);
    return d ? translate(d.labelEn, d.labelAr) : type;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]" data-testid="section-builder">
      <aside className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#0B3D91]">
            {translate("Sections", "الأقسام")} <span className="text-gray-500">({sections.length})</span>
          </h3>
          <div className="flex gap-1">
            {onPreview && (
              <Button size="xs" variant="default" onClick={onPreview}>
                {translate("Preview", "معاينة")}
              </Button>
            )}
            {canEdit && (
              <Button size="xs" color="teal" onClick={() => setAdding(true)} data-testid="add-section">
                {translate("Add section", "إضافة قسم")}
              </Button>
            )}
          </div>
        </div>
        {sections.length === 0 ? (
          <Alert color="blue" variant="light">
            {translate("This page has no sections yet. Add a Hero to start, then the blocks the page needs.", "لا توجد أقسام بعد. أضف واجهة رئيسية للبدء ثم الأقسام التي تحتاجها الصفحة.")}
          </Alert>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={canEdit ? onDragEnd : undefined}>
            <SortableContext items={sections.map((s) => s._id)} strategy={verticalListSortingStrategy}>
              <ol className="flex flex-col gap-1.5" data-testid="section-list">
                {sections.map((s, i) => (
                  <SortableRow
                    key={s._id}
                    section={s}
                    index={i}
                    total={sections.length}
                    label={typeLabel(s.type)}
                    selected={s._id === selectedId}
                    canEdit={canEdit && (!defs.get(s.type)?.restricted || can(defs.get(s.type)!.restricted!))}
                    onSelect={() => select(s._id)}
                    onMove={(d) => moveBy(s._id, d)}
                    onToggle={() => run(() => updateSection(s._id, { isVisible: !s.isVisible }), s.isVisible ? translate("Section hidden.", "تم إخفاء القسم.") : translate("Section shown.", "تم إظهار القسم."))}
                    onDuplicate={() => run(() => duplicateSection(s._id), translate("Section duplicated.", "تم تكرار القسم."))}
                    onDelete={async () => {
                      const ok = await confirm({ title: translate("Delete this section?", "حذف هذا القسم؟"), message: translate(`"${typeLabel(s.type)}" will be removed from the draft. The live page keeps it until you publish.`, `سيُحذف "${typeLabel(s.type)}" من المسودة. تحتفظ الصفحة المنشورة به حتى تنشر.`), confirmLabel: translate("Delete", "حذف"), danger: true });
                      if (!ok) return;
                      if (s._id === selectedId) setSelectedId(null);
                      run(() => deleteSection(s._id), translate("Section deleted.", "تم حذف القسم."));
                    }}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </aside>

      <section className="min-w-0 rounded-lg border border-gray-100 p-4">
        {!selected || !def || !draft ? (
          <p className="text-sm text-gray-500">{sections.length ? translate("Select a section to edit it.", "اختر قسمًا لتحريره.") : translate("Add a section to start building the page.", "أضف قسمًا لبدء بناء الصفحة.")}</p>
        ) : (
          <div className="flex flex-col gap-3" data-testid="section-editor">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{typeLabel(selected.type)}</h3>
                {!selected.isVisible && <Badge color="gray">{translate("Hidden", "مخفي")}</Badge>}
                {dirty && (
                  <Badge color="orange" variant="light">
                    {translate("Unsaved", "غير محفوظ")}
                  </Badge>
                )}
              </div>
              {canEdit && (!def.restricted || can(def.restricted)) && (
                <div className="flex gap-2">
                  <Button size="xs" variant="default" disabled={!dirty} onClick={() => setDraft(baseline(selected))}>
                    {translate("Discard", "تجاهل")}
                  </Button>
                  <Button size="xs" color="teal" loading={saving} disabled={!dirty} onClick={save} data-testid="save-section">
                    {translate("Save section", "حفظ القسم")}
                  </Button>
                </div>
              )}
            </div>
            {def.restricted && !can(def.restricted) && (
              <Alert color="gray" variant="light">
                {translate("Only a website administrator can change this section.", "يمكن لمسؤول الموقع فقط تعديل هذا القسم.")}
              </Alert>
            )}
            {def.legacy && (
              <Alert color="yellow" variant="light">
                {translate("This is an older section type. It still works; new pages should use the newer blocks.", "هذا نوع أقسام قديم. ما زال يعمل؛ يُفضل استخدام الأقسام الأحدث للصفحات الجديدة.")}
              </Alert>
            )}
            <Tabs value={tab} onChange={setTab}>
              <Tabs.List>
                <Tabs.Tab value="content">{translate("Content", "المحتوى")}</Tabs.Tab>
                <Tabs.Tab value="settings" data-testid="section-settings-tab">
                  {translate("Settings", "الإعدادات")}
                </Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="content" pt="md">
                <SectionForm def={def} value={draft.content} onChange={(content) => setDraft((d) => (d ? { ...d, content } : d))} readOnly={!canEdit || (!!def.restricted && !can(def.restricted))} />
              </Tabs.Panel>
              <Tabs.Panel value="settings" pt="md">
                <div className="flex flex-col gap-4">
                  <TextInput
                    label={translate("Internal label (dashboard only)", "اسم داخلي (للوحة التحكم فقط)")}
                    value={draft.adminLabel}
                    maxLength={80}
                    onChange={(e) => {
                      const adminLabel = e.currentTarget.value;
                      setDraft((d) => (d ? { ...d, adminLabel } : d));
                    }}
                    disabled={!canEdit}
                  />
                  <SectionSettingsForm registry={registry as SectionRegistry} value={draft.settings} onChange={(settings) => setDraft((d) => (d ? { ...d, settings } : d))} readOnly={!canEdit || (!!def.restricted && !can(def.restricted))} />
                </div>
              </Tabs.Panel>
            </Tabs>
          </div>
        )}
      </section>

      <AddSectionModal opened={adding} onClose={() => setAdding(false)} registry={registry} onPick={add} />
    </div>
  );
}

function SortableRow({
  section,
  index,
  total,
  label,
  selected,
  canEdit,
  onSelect,
  onMove,
  onToggle,
  onDuplicate,
  onDelete,
}: {
  section: WebsiteSection;
  index: number;
  total: number;
  label: string;
  selected: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onMove: (d: number) => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { translate } = useLanguage();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section._id, disabled: !canEdit });
  const devices = section.settings?.devices;
  const hiddenOn = devices ? (["desktop", "tablet", "mobile"] as const).filter((d) => devices[d] === false) : [];
  const heading = String(section.content?.headingEn || section.content?.headingAr || section.content?.labelEn || "");
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      className={`flex items-center gap-1 rounded-md border px-2 py-1.5 ${selected ? "border-teal-500 bg-teal-50" : "border-gray-200 bg-white"} ${section.isVisible ? "" : "opacity-60"}`}
      data-testid="section-row"
      data-section-type={section.type}
    >
      {canEdit && (
        <button type="button" className="cursor-grab px-1 text-gray-400" aria-label={translate("Drag to reorder", "اسحب لإعادة الترتيب")} {...attributes} {...listeners}>
          ⋮⋮
        </button>
      )}
      <button type="button" className="min-w-0 flex-1 text-start" onClick={onSelect}>
        <div className="truncate text-sm font-medium">
          {index + 1}. {section.adminLabel || label}
        </div>
        <div className="truncate text-xs text-gray-500">
          {heading || label}
          {hiddenOn.length > 0 && ` · ${translate("hidden on", "مخفي على")} ${hiddenOn.join(", ")}`}
        </div>
      </button>
      {canEdit && (
        <div className="flex items-center">
          <Tooltip label={translate("Move up", "لأعلى")}>
            <ActionIcon size="sm" variant="subtle" color="gray" disabled={index === 0} onClick={() => onMove(-1)} aria-label="up">
              ↑
            </ActionIcon>
          </Tooltip>
          <Tooltip label={translate("Move down", "لأسفل")}>
            <ActionIcon size="sm" variant="subtle" color="gray" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="down">
              ↓
            </ActionIcon>
          </Tooltip>
          <Tooltip label={section.isVisible ? translate("Hide", "إخفاء") : translate("Show", "إظهار")}>
            <ActionIcon size="sm" variant="subtle" color="gray" onClick={onToggle} aria-label="visibility" data-testid="toggle-visibility">
              {section.isVisible ? "◉" : "○"}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={translate("Duplicate", "تكرار")}>
            <ActionIcon size="sm" variant="subtle" color="gray" onClick={onDuplicate} aria-label="duplicate" data-testid="duplicate-section">
              ⧉
            </ActionIcon>
          </Tooltip>
          <Tooltip label={translate("Delete", "حذف")}>
            <ActionIcon size="sm" variant="subtle" color="red" onClick={onDelete} aria-label="delete" data-testid="delete-section">
              ✕
            </ActionIcon>
          </Tooltip>
        </div>
      )}
    </li>
  );
}

function AddSectionModal({ opened, onClose, registry, onPick }: { opened: boolean; onClose: () => void; registry: SectionRegistry; onPick: (t: SectionTypeDef) => void }) {
  const { translate } = useLanguage();
  const { can } = useWebsiteRole();
  const available = registry.types.filter((t) => !t.legacy && (!t.restricted || can(t.restricted)));
  const categories = [...new Set(available.map((t) => t.category))];
  return (
    <Modal opened={opened} onClose={onClose} title={translate("Add a section", "إضافة قسم")} size="xl">
      <div className="flex flex-col gap-4" data-testid="section-type-gallery">
        {categories.map((c) => (
          <div key={c}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{c}</h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {available
                .filter((t) => t.category === c)
                .map((t) => (
                  <button key={t.type} type="button" onClick={() => onPick(t)} className="rounded-md border border-gray-200 p-3 text-start hover:border-teal-500 hover:bg-teal-50" data-testid={`add-type-${t.type}`}>
                    <div className="text-sm font-medium">{translate(t.labelEn, t.labelAr)}</div>
                    <div className="mt-0.5 text-xs text-gray-500">{t.fields.filter((f) => f.kind !== "list").length + t.fields.filter((f) => f.kind === "list").length} {translate("fields", "حقول")}</div>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
