import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Select, Switch, Tabs, TextInput, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import { FooterColumn, NavEntry, WebsiteNavigation, WebsitePage } from "@/types/website";
import { useBeforeUnload, useCmsApi, useConfirm, useWebsiteRole } from "../_shared/cms";

// Website Management - Navigation: the header menu (links, dropdowns, nested dropdowns) and the
// footer link columns, in both languages. A link opens a CMS page (by its slug - it follows a
// renamed page automatically) or an external address. The live website only shows links to
// PUBLISHED pages; links to drafts are kept and appear once the page is published.

const MAX_DEPTH = 3;
const uid = () => Math.random().toString(36).slice(2, 10);

export default function WebsiteNavigationPage() {
  const { translate } = useLanguage();
  const { can } = useWebsiteRole();
  const canEdit = can("navigation.manage");
  const confirm = useConfirm();
  const { call } = useCmsApi();
  useDocumentTitle(`${translate("Navigation", "التنقل")} | Reservia Website`);

  const [nav, setNav] = useState<WebsiteNavigation | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [pages, setPages] = useState<WebsitePage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<string | null>("header");

  async function load() {
    setLoading(true);
    setError("");
    const [n, p] = await Promise.all([call<WebsiteNavigation>({ url: "website/navigation" }, { silent: true }), call<WebsitePage[]>({ url: "website/pages", params: { limit: 200 } }, { silent: true })]);
    if (!n) setError(translate("Could not load the navigation.", "تعذر تحميل التنقل."));
    else {
      const clean = { headerEntries: withIds(n.data.headerEntries || []), footerColumns: (n.data.footerColumns || []).map((c) => ({ ...c, id: c.id || uid(), items: withIds(c.items || []) })), warnings: n.data.warnings };
      setNav(clean);
      setSaved(JSON.stringify({ h: clean.headerEntries, f: clean.footerColumns }));
    }
    setPages(p?.data || []);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = !!nav && JSON.stringify({ h: nav.headerEntries, f: nav.footerColumns }) !== saved;
  useBeforeUnload(dirty);
  const pageOptions = useMemo(
    () => pages.map((p) => ({ value: p.slug, label: `${p.titleEn || p.titleAr || p.slug} (${p.path})${p.status === "published" ? "" : ` · ${translate("not published", "غير منشورة")}`}` })),
    [pages, translate],
  );

  async function save() {
    if (!nav) return;
    setSaving(true);
    const res = await call<WebsiteNavigation>({ url: "website/navigation", method: "PUT", data: { headerEntries: nav.headerEntries, footerColumns: nav.footerColumns } }, { success: "server", error: translate("Could not save the navigation", "تعذر حفظ التنقل") });
    if (res) {
      const clean = { headerEntries: withIds(res.data.headerEntries), footerColumns: res.data.footerColumns.map((c) => ({ ...c, items: withIds(c.items) })), warnings: res.data.warnings };
      setNav(clean);
      setSaved(JSON.stringify({ h: clean.headerEntries, f: clean.footerColumns }));
    }
    setSaving(false);
  }

  return (
    <AdminLayoutBox
      header={{
        title: translate("Navigation", "التنقل"),
        subTitle: translate("The website's header menu and footer links. Only links to published pages appear on the live website.", "قائمة رأس الموقع وروابط التذييل. لا تظهر على الموقع إلا الروابط إلى الصفحات المنشورة."),
        sideElements: canEdit && nav && (
          <div className="flex items-center gap-2">
            {dirty && (
              <Badge color="orange" variant="light">
                {translate("Unsaved changes", "تغييرات غير محفوظة")}
              </Badge>
            )}
            <Button
              variant="default"
              disabled={!dirty}
              onClick={async () => {
                if (await confirm({ title: translate("Discard changes?", "تجاهل التغييرات؟"), message: translate("The menus go back to the last saved version.", "ستعود القوائم إلى آخر نسخة محفوظة."), danger: true, confirmLabel: translate("Discard", "تجاهل") })) load();
              }}
            >
              {translate("Discard", "تجاهل")}
            </Button>
            <Button color="teal" loading={saving} disabled={!dirty} onClick={save} data-testid="save-navigation">
              {translate("Save navigation", "حفظ التنقل")}
            </Button>
          </div>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading navigation...", "جاري تحميل التنقل...")} />
      ) : error || !nav ? (
        <ErrorSection errorTitle={translate("Could not load the navigation", "تعذر تحميل التنقل")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
      ) : (
        <div className="flex flex-col gap-4">
          {!canEdit && (
            <Alert color="gray" variant="light">
              {translate("You can view the menus. Only a website administrator can change them.", "يمكنك عرض القوائم. لا يمكن تعديلها إلا لمسؤول الموقع.")}
            </Alert>
          )}
          {(nav.warnings || []).length > 0 && (
            <Alert color="yellow" variant="light" title={translate("Hidden on the live website", "مخفية على الموقع")}>
              <ul className="list-disc ps-5 text-sm">
                {nav.warnings!.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}
          <Tabs value={tab} onChange={setTab}>
            <Tabs.List>
              <Tabs.Tab value="header">{translate("Header menu", "قائمة الرأس")}</Tabs.Tab>
              <Tabs.Tab value="footer">{translate("Footer", "التذييل")}</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="header" pt="md">
              <EntryList entries={nav.headerEntries} onChange={(headerEntries) => setNav({ ...nav, headerEntries })} depth={1} pageOptions={pageOptions} readOnly={!canEdit} />
            </Tabs.Panel>
            <Tabs.Panel value="footer" pt="md">
              <FooterEditor columns={nav.footerColumns} onChange={(footerColumns) => setNav({ ...nav, footerColumns })} pageOptions={pageOptions} readOnly={!canEdit} />
            </Tabs.Panel>
          </Tabs>
        </div>
      )}
    </AdminLayoutBox>
  );
}

function withIds(list: NavEntry[]): NavEntry[] {
  return (list || []).map((e) => ({ ...e, id: e.id || uid(), linkType: e.linkType || (e.externalUrl && !e.pageSlug ? "external" : "page"), visible: e.visible !== false, items: e.items ? withIds(e.items) : e.items }));
}

type PageOption = { value: string; label: string };

function move<T>(list: T[], i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function EntryList({ entries, onChange, depth, pageOptions, readOnly, linksOnly }: { entries: NavEntry[]; onChange: (e: NavEntry[]) => void; depth: number; pageOptions: PageOption[]; readOnly: boolean; linksOnly?: boolean }) {
  const { translate } = useLanguage();
  return (
    <div className="flex flex-col gap-2" data-testid={`nav-list-depth-${depth}`}>
      {entries.length === 0 && <p className="text-sm text-gray-500">{translate("No items.", "لا توجد عناصر.")}</p>}
      {entries.map((e, i) => (
        <EntryEditor
          key={e.id}
          entry={e}
          depth={depth}
          index={i}
          total={entries.length}
          pageOptions={pageOptions}
          readOnly={readOnly}
          linksOnly={linksOnly}
          onChange={(ne) => onChange(entries.map((x, j) => (j === i ? ne : x)))}
          onRemove={() => onChange(entries.filter((_, j) => j !== i))}
          onMove={(d) => onChange(move(entries, i, d))}
        />
      ))}
      {!readOnly && (
        <div className="flex gap-2">
          <Button size="xs" variant="light" onClick={() => onChange([...entries, { id: uid(), type: "link", labelEn: "", labelAr: "", linkType: "page", pageSlug: "", target: "_self", visible: true }])} data-testid={`nav-add-link-${depth}`}>
            {translate("Add link", "إضافة رابط")}
          </Button>
          {!linksOnly && depth < MAX_DEPTH && (
            <Button size="xs" variant="light" color="grape" onClick={() => onChange([...entries, { id: uid(), type: "group", labelEn: "", labelAr: "", visible: true, items: [] }])} data-testid={`nav-add-group-${depth}`}>
              {translate("Add dropdown", "إضافة قائمة منسدلة")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function EntryEditor({
  entry: e,
  depth,
  index,
  total,
  pageOptions,
  readOnly,
  linksOnly,
  onChange,
  onRemove,
  onMove,
}: {
  entry: NavEntry;
  depth: number;
  index: number;
  total: number;
  pageOptions: PageOption[];
  readOnly: boolean;
  linksOnly?: boolean;
  onChange: (e: NavEntry) => void;
  onRemove: () => void;
  onMove: (d: number) => void;
}) {
  const { translate } = useLanguage();
  const set = (patch: Partial<NavEntry>) => onChange({ ...e, ...patch });
  const group = e.type === "group";
  return (
    <div className={`rounded-md border p-3 ${group ? "border-purple-200 bg-purple-50/40" : "border-gray-200 bg-white"} ${e.visible === false ? "opacity-60" : ""}`} data-testid="nav-entry">
      <div className="flex flex-wrap items-end gap-2">
        <Badge variant="light" color={group ? "grape" : "blue"} className="mb-2">
          {group ? translate("Dropdown", "قائمة منسدلة") : translate("Link", "رابط")}
        </Badge>
        <TextInput className="min-w-[150px] flex-1" size="xs" label={translate("Label (English)", "الاسم (الإنجليزية)")} value={e.labelEn} onChange={(ev) => set({ labelEn: ev.currentTarget.value })} maxLength={60} dir="ltr" disabled={readOnly} data-testid="nav-label-en" />
        <TextInput className="min-w-[150px] flex-1" size="xs" label={translate("Label (Arabic)", "الاسم (العربية)")} value={e.labelAr} onChange={(ev) => set({ labelAr: ev.currentTarget.value })} maxLength={60} dir="rtl" disabled={readOnly} data-testid="nav-label-ar" />
        {!group && (
          <>
            <Select
              size="xs"
              w={130}
              label={translate("Opens", "يفتح")}
              value={e.linkType || "page"}
              onChange={(v) => set({ linkType: (v || "page") as NavEntry["linkType"] })}
              allowDeselect={false}
              data={[
                { value: "page", label: translate("A page", "صفحة") },
                { value: "external", label: translate("An address", "عنوان") },
              ]}
              disabled={readOnly}
            />
            {e.linkType === "external" ? (
              <TextInput className="min-w-[200px] flex-1" size="xs" label={translate("Address", "العنوان")} placeholder="https://… · /path · #anchor · tel:" value={e.externalUrl || ""} onChange={(ev) => set({ externalUrl: ev.currentTarget.value, pageSlug: "" })} dir="ltr" disabled={readOnly} />
            ) : (
              <Select className="min-w-[220px] flex-1" size="xs" label={translate("Page", "الصفحة")} value={e.pageSlug || null} onChange={(v) => set({ pageSlug: v || "", externalUrl: "" })} data={pageOptions} searchable disabled={readOnly} data-testid="nav-page" />
            )}
            <Select
              size="xs"
              w={130}
              label={translate("Open in", "الفتح في")}
              value={e.target || "_self"}
              onChange={(v) => set({ target: (v || "_self") as NavEntry["target"] })}
              allowDeselect={false}
              data={[
                { value: "_self", label: translate("Same tab", "نفس التبويب") },
                { value: "_blank", label: translate("New tab", "تبويب جديد") },
              ]}
              disabled={readOnly}
            />
          </>
        )}
        <Switch size="xs" className="mb-2" label={translate("Visible", "ظاهر")} checked={e.visible !== false} onChange={(ev) => set({ visible: ev.currentTarget.checked })} disabled={readOnly} />
        {!readOnly && (
          <div className="mb-1 flex">
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
            <Tooltip label={translate("Remove", "إزالة")}>
              <ActionIcon size="sm" variant="subtle" color="red" onClick={onRemove} aria-label="remove">
                ✕
              </ActionIcon>
            </Tooltip>
          </div>
        )}
      </div>
      {group && !linksOnly && (
        <div className="mt-3 border-s-2 border-purple-200 ps-3">
          <EntryList entries={e.items || []} onChange={(items) => set({ items })} depth={depth + 1} pageOptions={pageOptions} readOnly={readOnly} />
        </div>
      )}
    </div>
  );
}

function FooterEditor({ columns, onChange, pageOptions, readOnly }: { columns: FooterColumn[]; onChange: (c: FooterColumn[]) => void; pageOptions: PageOption[]; readOnly: boolean }) {
  const { translate } = useLanguage();
  return (
    <div className="flex flex-col gap-3">
      {columns.length === 0 && <p className="text-sm text-gray-500">{translate("No footer columns. The website shows its standard footer links.", "لا توجد أعمدة. يعرض الموقع روابط التذييل القياسية.")}</p>}
      {columns.map((c, i) => (
        <div key={c.id} className="rounded-md border border-gray-200 p-3" data-testid="footer-column">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <TextInput className="flex-1" size="xs" label={translate("Column title (English)", "عنوان العمود (الإنجليزية)")} value={c.titleEn} onChange={(e) => onChange(columns.map((x, j) => (j === i ? { ...x, titleEn: e.currentTarget.value } : x)))} dir="ltr" disabled={readOnly} />
            <TextInput className="flex-1" size="xs" label={translate("Column title (Arabic)", "عنوان العمود (العربية)")} value={c.titleAr} onChange={(e) => onChange(columns.map((x, j) => (j === i ? { ...x, titleAr: e.currentTarget.value } : x)))} dir="rtl" disabled={readOnly} />
            <Switch size="xs" className="mb-2" label={translate("Visible", "ظاهر")} checked={c.visible !== false} onChange={(e) => onChange(columns.map((x, j) => (j === i ? { ...x, visible: e.currentTarget.checked } : x)))} disabled={readOnly} />
            {!readOnly && (
              <div className="mb-1 flex">
                <ActionIcon size="sm" variant="subtle" color="gray" disabled={i === 0} onClick={() => onChange(move(columns, i, -1))} aria-label="up">
                  ↑
                </ActionIcon>
                <ActionIcon size="sm" variant="subtle" color="gray" disabled={i === columns.length - 1} onClick={() => onChange(move(columns, i, 1))} aria-label="down">
                  ↓
                </ActionIcon>
                <ActionIcon size="sm" variant="subtle" color="red" onClick={() => onChange(columns.filter((_, j) => j !== i))} aria-label="remove">
                  ✕
                </ActionIcon>
              </div>
            )}
          </div>
          <EntryList entries={c.items} onChange={(items) => onChange(columns.map((x, j) => (j === i ? { ...x, items } : x)))} depth={MAX_DEPTH} pageOptions={pageOptions} readOnly={readOnly} linksOnly />
        </div>
      ))}
      {!readOnly && columns.length < 6 && (
        <Button size="xs" variant="light" w="fit-content" onClick={() => onChange([...columns, { id: uid(), titleEn: "", titleAr: "", visible: true, items: [] }])}>
          {translate("Add footer column", "إضافة عمود")}
        </Button>
      )}
    </div>
  );
}

