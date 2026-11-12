import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Badge, Button, Drawer, Loader, SegmentedControl, Select, Switch, Table, Tabs, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import { notifyError, notifySuccess } from "@/utils/helpers/notifiers";
import paths from "@/utils/constants/paths";
import { formatCairoDateTime } from "@/pages/crm/_shared/business-date";
import { errorMessage, useCmsApi, useConfirm, useWebsiteRole } from "../_shared/cms";
import {
  createFromLibrary,
  Device,
  duplicateNode,
  EMPTY,
  getEl,
  insertNodes,
  Lang,
  removeNode,
  reorder,
  setEl,
  setOrder,
  VisualConfig,
} from "./ve-config";
import { ContentControls, ElementInfo, NodeControls, ResponsiveHint, StyleControls, VisibilityControls } from "./props-panel";
import { GlobalDesign, Layers, Library, NavigationTab, PageSettings, TreeNode } from "./sidebar";

// Website Visual Editor. The REAL public website is loaded in the canvas (an iframe of the site's
// own production build, opened with a signed editor token) - its own components, styles and
// routes. Selecting an element in the canvas or in Layers opens its properties; every change is
// applied to the canvas immediately, autosaved to the draft (never to the live site), and goes
// live only with Publish. Undo/redo, versions, restore and rollback are built in. All permissions
// are re-checked by the server (edit / design / code / publish).

const BUILT_IN_PAGES: [string, string][] = [
  ["/", "Home"],
  ["/residential", "Residential & Commercial"],
  ["/agriculture", "Agricultural Farms"],
  ["/industrial", "Industrial Facilities"],
  ["/oil-gas", "Oil & Gas"],
  ["/service", "Services Sector"],
  ["/calculator", "Savings calculator"],
  ["/how-we-work", "How we work"],
  ["/about", "About"],
  ["/contact", "Contact"],
  ["/solar-irrigation-guide", "Solar irrigation guide (Arabic)"],
  ["/lp/villas", "Campaign · Villas"],
  ["/lp/compounds", "Campaign · Compounds"],
  ["/lp/agriculture", "Campaign · Farms"],
  ["/lp/industrial", "Campaign · Industry"],
  ["/lp/service", "Campaign · Services"],
];
// The canvas renders each device at its real width (desktop at 1366px, scaled down to fit), so the
// site uses exactly the layout - and the editor exactly the breakpoint - of that device.
const WIDTH: Record<Device, number> = { desktop: 1366, tablet: 820, mobile: 390 };

type Status = "loading" | "saved" | "dirty" | "saving" | "error" | "conflict";

export default function WebsiteVisualEditor() {
  const { language, translate } = useLanguage();
  const navigate = useNavigate();
  const { can } = useWebsiteRole();
  const canEdit = can("edit");
  const canDesign = can("design.manage");
  const canCode = can("code.manage");
  const canPublish = can("publish");
  const confirm = useConfirm();
  const { call, privateRequest } = useCmsApi();
  useDocumentTitle(`${translate("Visual Editor", "المحرر المرئي")} | Reservia Website`);

  const [config, setConfigState] = useState<VisualConfig>(EMPTY);
  const configRef = useRef<VisualConfig>(EMPTY);
  const revRef = useRef(0);
  const savedRef = useRef(JSON.stringify(EMPTY));
  const [status, setStatus] = useState<Status>("loading");
  const [hasUnpublished, setHasUnpublished] = useState(false);
  const history = useRef<{ past: VisualConfig[]; future: VisualConfig[]; key: string | null; at: number }>({ past: [], future: [], key: null, at: 0 });
  const [historyTick, setHistoryTick] = useState(0);

  const [device, setDevice] = useState<Device>("desktop");
  const [lang, setLang] = useState<Lang>("en");
  const [path, setPath] = useState("/");
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [siteOrigin, setSiteOrigin] = useState<string>("");
  const [frameError, setFrameError] = useState("");
  const [frameReady, setFrameReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const canvasBox = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 1000, h: 800 });
  useEffect(() => {
    const el = canvasBox.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [route, setRoute] = useState("/");
  const [info, setInfo] = useState<ElementInfo | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [siteTokens, setSiteTokens] = useState<{ light: Record<string, string>; dark: Record<string, string> }>({ light: {}, dark: {} });
  const [hoverState, setHoverState] = useState(false);
  const [scopeAll, setScopeAll] = useState(false);
  const [applyAll, setApplyAll] = useState(false);
  const [leftTab, setLeftTab] = useState<string | null>("layers");
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [cmsPages, setCmsPages] = useState<{ _id: string; path: string; titleEn: string; slug: string; pageType: string }[]>([]);

  const elKey = info ? (applyAll && info.wildcard ? info.wildcard : info.id) : "";

  // ---------- load ----------
  useEffect(() => {
    (async () => {
      const [d, p] = await Promise.all([call<{ config: VisualConfig; rev: number; hasUnpublishedChanges: boolean }>({ url: "website/visual/draft" }), call<{ _id: string; path: string; titleEn: string; slug: string; pageType: string }[]>({ url: "website/pages", params: { limit: 200 } }, { silent: true })]);
      if (!d) {
        setStatus("error");
        return;
      }
      const c = { ...EMPTY, ...d.data.config };
      configRef.current = c;
      setConfigState(c);
      revRef.current = d.data.rev;
      savedRef.current = JSON.stringify(c);
      setHasUnpublished(d.data.hasUnpublishedChanges);
      setStatus("saved");
      setCmsPages(p?.data || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- canvas url (signed editor token) ----------
  const openCanvas = useCallback(async () => {
    setFrameReady(false);
    setTree([]);
    setInfo(null);
    const r = await call<{ url: string | null; siteOrigin: string | null }>({ url: "website/visual/preview-token", method: "POST", data: { mode: "edit", path, lang } }, { silent: true });
    if (!r) {
      setFrameError(translate("The editor could not be opened.", "تعذر فتح المحرر."));
      return;
    }
    if (!r.data.url) {
      setFrameError(translate("Set the public website address in Website Settings to open the editor.", "اضبط عنوان الموقع العام في إعدادات الموقع لفتح المحرر."));
      return;
    }
    setFrameError("");
    setSiteOrigin(new URL(r.data.url).origin);
    setFrameUrl(r.data.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, lang]);
  useEffect(() => {
    if (status !== "loading") openCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, lang, status === "loading"]);

  const post = useCallback((m: Record<string, unknown>) => {
    if (frame.current?.contentWindow && siteOrigin) frame.current.contentWindow.postMessage(m, siteOrigin);
  }, [siteOrigin]);

  // ---------- changes, history, autosave ----------
  const autosaveTimer = useRef<number>();
  const saveWithMessage = useCallback(
    async (autosave: boolean) => {
      if (!canEdit) return false;
      const snapshot = configRef.current;
      const json = JSON.stringify(snapshot);
      if (json === savedRef.current && autosave) return true;
      setStatus("saving");
      try {
        const res = await privateRequest({ url: "website/visual/draft", method: "PUT", data: { configJson: json, baseRev: revRef.current, autosave }, language });
        revRef.current = res.data.rev;
        savedRef.current = json;
        setHasUnpublished(res.data.hasUnpublishedChanges);
        setStatus(JSON.stringify(configRef.current) === json ? "saved" : "dirty");
        if (!autosave) notifySuccess({ language, message: translate("Draft saved.", "تم حفظ المسودة.") });
        return true;
      } catch (err) {
        const e = err as { message?: string; data?: { rev?: number } };
        if (e?.data?.rev !== undefined) setStatus("conflict");
        else setStatus("error");
        notifyError({ language, message: errorMessage(err, translate("Could not save the draft", "تعذر حفظ المسودة")) });
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, language],
  );

  const apply = useCallback(
    (next: VisualConfig, opts: { coalesce?: string; record?: boolean } = {}) => {
      if (!canEdit) return;
      const h = history.current;
      const now = Date.now();
      if (opts.record !== false) {
        if (!(opts.coalesce && h.key === opts.coalesce && now - h.at < 1500)) h.past.push(configRef.current);
        if (h.past.length > 150) h.past.shift();
        h.future = [];
        h.key = opts.coalesce || null;
        h.at = now;
      }
      configRef.current = next;
      setConfigState(next);
      setHistoryTick((t) => t + 1);
      setStatus("dirty");
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = window.setTimeout(() => saveWithMessage(true), 2500);
    },
    [canEdit, saveWithMessage],
  );

  useEffect(() => {
    if (frameReady) post({ type: "ve:config", config });
  }, [config, post, frameReady]);

  const undo = useCallback(() => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(configRef.current);
    h.key = null;
    apply(prev, { record: false });
  }, [apply]);
  const redo = useCallback(() => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(configRef.current);
    h.key = null;
    apply(next, { record: false });
  }, [apply]);

  // ---------- element operations ----------
  const scopeFor = (i: ElementInfo | null) => (i?.global || scopeAll ? "*" : route);
  const infoRef = useRef<ElementInfo | null>(null);
  infoRef.current = info;

  const moveSibling = useCallback(
    (i: ElementInfo, dir: -1 | 1) => {
      if (!i.parentId) return notifyError({ language, message: translate("This element cannot be moved here.", "لا يمكن نقل هذا العنصر هنا.") });
      const idx = i.siblings.indexOf(i.id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= i.siblings.length) return;
      const order = [...i.siblings];
      [order[idx], order[to]] = [order[to], order[idx]];
      apply(setOrder(configRef.current, scopeFor(i), i.parentId, order, i.parentDisplay));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apply, route, scopeAll, language],
  );

  const hide = useCallback(
    (i: ElementInfo) => {
      const key = applyAll && i.wildcard ? i.wildcard : i.id;
      const sc = scopeFor(i);
      const cur = getEl(configRef.current, sc, key).hidden?.[device];
      apply(setEl(configRef.current, sc, key, (el) => ({ ...el, hidden: { ...(el.hidden || {}), [device]: cur ? undefined : true } })));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apply, device, applyAll, route, scopeAll],
  );

  const remove = useCallback(
    async (i: ElementInfo) => {
      if (i.id.startsWith("ins:")) {
        apply(removeNode(configRef.current, i.id.slice(4)));
        setInfo(null);
        return;
      }
      if (i.isH1) return notifyError({ language, message: translate("A page needs its main heading (search engines read it). Hide it or change its text instead.", "تحتاج الصفحة عنوانها الرئيسي (تقرؤه محركات البحث). أخفه أو غيّر نصه بدلًا من حذفه.") });
      const ok = await confirm({ title: translate("Delete this element?", "حذف هذا العنصر؟"), message: translate("It is removed from the page (you can undo, or restore it later from the element's layer).", "سيُحذف من الصفحة (يمكنك التراجع أو استعادته لاحقًا)."), confirmLabel: translate("Delete", "حذف"), danger: true });
      if (!ok) return;
      const key = applyAll && i.wildcard ? i.wildcard : i.id;
      apply(setEl(configRef.current, scopeFor(i), key, (el) => ({ ...el, deleted: true })));
      setInfo(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apply, applyAll, route, scopeAll, language],
  );

  const mainId = useMemo(() => tree.find((n) => n.tag === "main")?.id || null, [tree]);

  const addElement = useCallback(
    (kind: string, where?: { targetId: string | null; position: "before" | "after" | "inside"; parentId: string | null; siblings: string[]; parentDisplay: string }) => {
      const created = createFromLibrary(kind);
      try {
        let w = where;
        if (!w) {
          const i = infoRef.current;
          if (i && i.id.startsWith("ins:") && configRef.current.nodes[i.id.slice(4)]?.type === "box") w = { targetId: i.id, position: "inside", parentId: i.parentId, siblings: i.siblings, parentDisplay: i.parentDisplay };
          else if (i && i.parentId) w = { targetId: i.id, position: "after", parentId: i.parentId, siblings: i.siblings, parentDisplay: i.parentDisplay };
          else if (mainId) w = { targetId: null, position: "after", parentId: mainId, siblings: tree.filter((n) => n.parent === mainId).map((n) => n.id), parentDisplay: "block" };
        }
        if (!w) throw new Error(translate("Select where to add the element first.", "اختر مكان إضافة العنصر أولًا."));
        const sc = w.parentId && tree.find((n) => n.id === w!.parentId) && (infoRef.current?.global || scopeAll) ? "*" : route;
        const next =
          w.position === "inside" && w.targetId?.startsWith("ins:")
            ? insertNodes(configRef.current, created, { inside: w.targetId.slice(4), scope: sc })
            : insertNodes(configRef.current, created, { parentId: w.parentId, scope: sc, targetId: w.targetId, position: w.position === "before" ? "before" : "after", siblings: w.siblings, parentDisplay: w.parentDisplay });
        apply(next);
        window.setTimeout(() => post({ type: "ve:select", id: `ins:${created.root}` }), 600);
      } catch (err) {
        notifyError({ language, message: (err as Error).message });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apply, mainId, tree, route, scopeAll, post, language],
  );

  // ---------- messages from the canvas ----------
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!siteOrigin || e.origin !== siteOrigin || e.source !== frame.current?.contentWindow) return;
      const m = e.data as { type: string; [k: string]: unknown };
      switch (m?.type) {
        case "ve:ready":
          setFrameReady(true);
          setSiteTokens((m.tokens as typeof siteTokens) || { light: {}, dark: {} });
          post({ type: "ve:config", config: configRef.current });
          break;
        case "ve:tree":
          setTree((m.nodes as TreeNode[]) || []);
          setRoute(String(m.route || "/"));
          break;
        case "ve:select": {
          const i = (m.info as ElementInfo) || null;
          setInfo(i);
          if (i) {
            setScopeAll(i.global);
            setApplyAll(false);
          }
          break;
        }
        case "ve:hover":
          setHovered((m.id as string) || null);
          break;
        case "ve:text": {
          const i = infoRef.current;
          const id = String(m.id);
          const sc = i?.id === id ? scopeFor(i) : route;
          const key = i?.id === id && applyAll && i.wildcard ? i.wildcard : id;
          const l = (m.lang === "ar" ? "ar" : "en") as Lang;
          apply(setEl(configRef.current, sc, key, (el) => ({ ...el, text: { ...(el.text || {}), [l]: String(m.text ?? "") } })), { coalesce: `${key}:text:${l}` });
          break;
        }
        case "ve:action": {
          const i = infoRef.current;
          if (m.action === "undo") return undo();
          if (m.action === "redo") return redo();
          if (!i) return;
          if (m.action === "up") moveSibling(i, -1);
          else if (m.action === "down") moveSibling(i, 1);
          else if (m.action === "hide") hide(i);
          else if (m.action === "delete") remove(i);
          else if (m.action === "duplicate") {
            if (i.id.startsWith("ins:")) apply(duplicateNode(configRef.current, i.id.slice(4), scopeFor(i)));
            else notifyError({ language, message: translate("Existing website elements can be moved, hidden or deleted; duplicating is available for elements added in the editor.", "يمكن نقل عناصر الموقع الحالية أو إخفاؤها أو حذفها؛ أما التكرار فمتاح للعناصر المضافة في المحرر.") });
          }
          break;
        }
        case "ve:drop": {
          const w = m as unknown as { nodeType: string; targetId: string; position: "before" | "after" | "inside"; parentId: string | null; siblings: string[]; parentDisplay: string };
          addElement(w.nodeType, w);
          break;
        }
        case "ve:move": {
          const w = m as unknown as { id: string; targetId: string; position: "before" | "after"; parentId: string | null; siblings: string[]; parentDisplay: string };
          if (!w.parentId) return notifyError({ language, message: translate("This element cannot be moved here.", "لا يمكن نقل هذا العنصر هنا.") });
          const i = infoRef.current;
          if (w.id.startsWith("ins:") && w.parentId.startsWith("ins:")) {
            const next = JSON.parse(JSON.stringify(configRef.current)) as VisualConfig;
            const pn = next.nodes[w.parentId.slice(4)];
            if (pn?.children) {
              const order = reorder(pn.children.map((c) => `ins:${c}`), w.id, w.targetId, w.position).map((x) => x.slice(4));
              pn.children = order;
              apply(next);
            }
            return;
          }
          apply(setOrder(configRef.current, i?.global || scopeAll ? "*" : route, w.parentId, reorder(w.siblings, w.id, w.targetId, w.position), w.parentDisplay));
          break;
        }
        case "ve:error":
          setFrameError(String(m.message || ""));
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteOrigin, post, apply, undo, redo, moveSibling, hide, remove, addElement, route, scopeAll, applyAll, language]);

  // keyboard shortcuts in the dashboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && /INPUT|TEXTAREA/.test(t.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveWithMessage(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, saveWithMessage]);

  // warn before leaving with unsaved changes
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(configRef.current) !== savedRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  // ---------- toolbar actions ----------
  async function openPreview() {
    if (JSON.stringify(configRef.current) !== savedRef.current && !(await saveWithMessage(true))) return;
    const win = window.open("", "_blank");
    const r = await call<{ url: string | null }>({ url: "website/visual/preview-token", method: "POST", data: { mode: "preview", path, lang } });
    if (r?.data.url && win) win.location.href = r.data.url;
    else win?.close();
  }

  async function publish() {
    if (!(await confirm({ title: translate("Publish the design?", "نشر التصميم؟"), message: translate("Every saved change goes live on the public website. The previous live version stays in Versions for rollback.", "تصبح كل التغييرات المحفوظة مباشرة على الموقع العام. تبقى النسخة السابقة في النسخ للرجوع إليها."), confirmLabel: translate("Publish", "نشر") }))) return;
    if (!(await saveWithMessage(true))) return;
    const r = await call<{ deploy: { triggered: boolean } }>({ url: "website/visual/publish", method: "POST", data: {} }, { success: "server" });
    if (r) setHasUnpublished(false);
  }

  async function exitEditor() {
    if (JSON.stringify(configRef.current) !== savedRef.current) await saveWithMessage(true);
    navigate(`/${paths.website}`);
  }

  // ---------- render ----------
  const pageOptions = useMemo(() => {
    const builtIn = BUILT_IN_PAGES.map(([p, l]) => ({ value: p, label: l }));
    const known = new Set(builtIn.map((b) => b.value));
    const cms = cmsPages.filter((p) => p.pageType === "managed" && !known.has(p.path)).map((p) => ({ value: p.path, label: `${p.titleEn || p.slug} (CMS)` }));
    return [{ group: translate("Website pages", "صفحات الموقع"), items: builtIn }, ...(cms.length ? [{ group: translate("CMS pages", "صفحات النظام"), items: cms }] : [])];
  }, [cmsPages, translate]);
  const cmsPageId = cmsPages.find((p) => (p.path === "/" ? "/" : p.path) === route)?._id || null;
  const labels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const sc of ["*", route]) for (const [id, el] of Object.entries(config.routes[sc]?.el || {})) if (el.label) out[id] = el.label;
    return out;
  }, [config, route]);
  const present = useMemo(() => new Set(tree.map((n) => n.id)), [tree]);
  const ctx = info ? { config, scope: scopeFor(info) === "*" || scopeAll ? "*" : route, elKey, device, hover: hoverState, computed: info.computed, readOnly: !canEdit, onChange: apply } : null;
  void historyTick;

  const statusBadge = {
    loading: { color: "gray", text: translate("Loading…", "جاري التحميل…") },
    saved: { color: "teal", text: translate("Draft saved", "المسودة محفوظة") },
    dirty: { color: "orange", text: translate("Unsaved changes", "تغييرات غير محفوظة") },
    saving: { color: "blue", text: translate("Saving…", "جاري الحفظ…") },
    error: { color: "red", text: translate("Not saved", "لم يُحفظ") },
    conflict: { color: "red", text: translate("Changed elsewhere - reload", "تغيّرت في مكان آخر - أعد التحميل") },
  }[status];

  return (
    <div className="fixed inset-0 z-[150] flex flex-col bg-gray-100" data-testid="visual-editor" dir="ltr">
      {/* Top toolbar */}
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
        <Button size="xs" variant="subtle" onClick={exitEditor} data-testid="ve-exit">
          ← {translate("Exit editor", "خروج")}
        </Button>
        <span className="font-semibold text-[#0B3D91]">{translate("Visual Editor", "المحرر المرئي")}</span>
        <Select size="xs" w={240} data={pageOptions} value={path} onChange={(v) => v && setPath(v)} allowDeselect={false} searchable data-testid="ve-page" comboboxProps={{ withinPortal: true, zIndex: 400 }} />
        <SegmentedControl size="xs" value={lang} onChange={(v) => setLang(v as Lang)} data={[{ value: "en", label: "EN" }, { value: "ar", label: "عربي" }]} data-testid="ve-lang" />
        <SegmentedControl
          size="xs"
          value={device}
          onChange={(v) => setDevice(v as Device)}
          data={[
            { value: "desktop", label: "Desktop" },
            { value: "tablet", label: "Tablet" },
            { value: "mobile", label: "Mobile" },
          ]}
          data-testid="ve-device"
        />
        <Tooltip label="Ctrl+Z">
          <Button size="xs" variant="default" onClick={undo} disabled={!history.current.past.length || !canEdit} data-testid="ve-undo">
            ↶ {translate("Undo", "تراجع")}
          </Button>
        </Tooltip>
        <Tooltip label="Ctrl+Shift+Z">
          <Button size="xs" variant="default" onClick={redo} disabled={!history.current.future.length || !canEdit} data-testid="ve-redo">
            ↷ {translate("Redo", "إعادة")}
          </Button>
        </Tooltip>
        <div className="flex-1" />
        <Badge color={statusBadge.color} variant="light" data-testid="ve-status">
          {statusBadge.text}
        </Badge>
        {hasUnpublished && (
          <Badge color="yellow" variant="outline">
            {translate("Not published", "غير منشور")}
          </Badge>
        )}
        <Button size="xs" variant="default" onClick={() => setVersionsOpen(true)} data-testid="ve-versions">
          {translate("Versions", "النسخ")}
        </Button>
        <Button size="xs" variant="default" onClick={openPreview} data-testid="ve-preview">
          {translate("Preview", "معاينة")}
        </Button>
        {canEdit && (
          <Button size="xs" variant="light" color="teal" onClick={() => saveWithMessage(false)} loading={status === "saving"} data-testid="ve-save">
            {translate("Save", "حفظ")}
          </Button>
        )}
        {canPublish && (
          <Button size="xs" color="teal" onClick={publish} data-testid="ve-publish">
            {translate("Publish", "نشر")}
          </Button>
        )}
      </header>
      {status === "conflict" && (
        <Alert color="red" radius={0} py={6}>
          {translate("Someone else saved the design in the meantime. Reload the editor to continue from their version (your last changes are still on screen - copy anything you need).", "قام شخص آخر بحفظ التصميم في هذه الأثناء. أعد تحميل المحرر للمتابعة من نسخته.")}{" "}
          <Button size="compact-xs" variant="white" onClick={() => window.location.reload()}>
            {translate("Reload", "إعادة التحميل")}
          </Button>
        </Alert>
      )}
      {!canEdit && (
        <Alert color="gray" radius={0} py={6}>
          {translate("Read-only: you can explore the page and its elements; editing needs edit access.", "للعرض فقط: يمكنك استعراض الصفحة وعناصرها؛ التعديل يتطلب صلاحية التحرير.")}
        </Alert>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Left sidebar */}
        <aside className="flex w-[300px] shrink-0 flex-col border-e border-gray-200 bg-white">
          <Tabs value={leftTab} onChange={setLeftTab} className="flex min-h-0 flex-1 flex-col" keepMounted={false}>
            <Tabs.List grow>
              <Tabs.Tab value="layers" data-testid="tab-layers">
                {translate("Layers", "الطبقات")}
              </Tabs.Tab>
              <Tabs.Tab value="elements" data-testid="tab-elements">
                {translate("Add", "إضافة")}
              </Tabs.Tab>
              <Tabs.Tab value="design" data-testid="tab-design">
                {translate("Design", "التصميم")}
              </Tabs.Tab>
              <Tabs.Tab value="page" data-testid="tab-page">
                {translate("Page", "الصفحة")}
              </Tabs.Tab>
              <Tabs.Tab value="nav">{translate("Menus", "القوائم")}</Tabs.Tab>
            </Tabs.List>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <Tabs.Panel value="layers" className="h-full">
                <Layers
                  nodes={tree}
                  selected={info?.id || null}
                  hovered={hovered}
                  labels={labels}
                  readOnly={!canEdit}
                  onSelect={(id) => post({ type: "ve:select", id })}
                  onHover={(id) => post({ type: "ve:hover", id })}
                  onRename={(id, label) => apply(setEl(configRef.current, info?.id === id ? scopeFor(info) : route, id, (el) => ({ ...el, label: label.trim() || undefined })))}
                  onMove={(id, dir) => {
                    if (info?.id === id) moveSibling(info, dir);
                    else {
                      post({ type: "ve:select", id });
                      notifySuccess({ language, message: translate("Selected - press again to move it.", "تم التحديد - اضغط مرة أخرى لنقله.") });
                    }
                  }}
                  onToggleHide={(id) => {
                    if (info?.id === id) hide(info);
                    else post({ type: "ve:select", id });
                  }}
                />
              </Tabs.Panel>
              <Tabs.Panel value="elements">
                <Library canCode={canCode} readOnly={!canEdit} onAdd={(k) => addElement(k)} />
              </Tabs.Panel>
              <Tabs.Panel value="design">
                <GlobalDesign config={config} siteTokens={siteTokens} device={device} onChange={apply} canDesign={canDesign && canEdit} />
              </Tabs.Panel>
              <Tabs.Panel value="page">
                <PageSettings
                  config={config}
                  scope={route}
                  present={present}
                  onChange={apply}
                  canCode={canCode && canEdit}
                  cmsPageId={cmsPageId}
                  onReset={async () => {
                    if (!(await confirm({ title: translate("Reset this page's design?", "إعادة تعيين تصميم الصفحة؟"), message: translate("All visual changes on this page are removed from the draft.", "ستُزال كل التغييرات المرئية لهذه الصفحة من المسودة."), danger: true, confirmLabel: translate("Reset", "إعادة تعيين") }))) return;
                    const next = JSON.parse(JSON.stringify(configRef.current)) as VisualConfig;
                    delete next.routes[route];
                    apply(next);
                  }}
                />
              </Tabs.Panel>
              <Tabs.Panel value="nav">
                <NavigationTab />
              </Tabs.Panel>
            </div>
          </Tabs>
        </aside>

        {/* Canvas */}
        <main ref={canvasBox} className="relative flex min-w-0 flex-1 justify-center overflow-hidden p-3">
          {frameError ? (
            <Alert color="red" className="m-auto max-w-lg" data-testid="ve-frame-error">
              {frameError}
            </Alert>
          ) : frameUrl ? (
            <div className="relative shadow-lg" style={{ width: Math.min(WIDTH[device], box.w - 24) || WIDTH[device], height: box.h - 24 }} data-scale={Math.min(1, (box.w - 24) / WIDTH[device]).toFixed(3)}>
              {!frameReady && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
                  <Loader size="sm" />
                </div>
              )}
              <iframe
                key={frameUrl}
                ref={frame}
                src={frameUrl}
                title={translate("Website canvas", "مساحة الموقع")}
                className="border-0 bg-white"
                style={(() => {
                  const scale = Math.min(1, (box.w - 24) / WIDTH[device]);
                  return { width: WIDTH[device], height: (box.h - 24) / scale, transform: `scale(${scale})`, transformOrigin: "0 0" };
                })()}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                data-testid="ve-canvas"
              />
            </div>
          ) : (
            <Loader className="m-auto" />
          )}
        </main>

        {/* Properties */}
        <aside className="w-[320px] shrink-0 overflow-auto border-s border-gray-200 bg-white p-3" data-testid="ve-properties">
          {!info || !ctx ? (
            <p className="text-sm text-gray-500">{translate("Click any element on the page (or in Layers) to edit it. Double-click text to type directly on the page.", "اضغط على أي عنصر في الصفحة (أو في الطبقات) لتعديله. انقر مرتين على النص للكتابة مباشرة.")}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold" data-testid="ve-selected">
                    {labels[info.id] || `${info.component} · ${info.tag}`}
                  </span>
                  <Badge size="xs" variant="light">
                    {info.kind}
                  </Badge>
                </div>
                <div className="truncate text-[11px] text-gray-400" title={info.id}>
                  {info.id}
                </div>
              </div>
              <div className="flex flex-col gap-1 rounded bg-gray-50 p-2">
                <Switch size="xs" label={translate("Apply on every page", "تطبيق على كل الصفحات")} checked={ctx.scope === "*"} onChange={(e) => setScopeAll(e.currentTarget.checked)} disabled={info.global} data-testid="ve-scope-all" />
                {info.global && <span className="text-[11px] text-gray-500">{translate("Header and footer changes always apply on every page.", "تغييرات الرأس والتذييل تنطبق دائمًا على كل الصفحات.")}</span>}
                {info.wildcard && info.instances > 1 && (
                  <Switch size="xs" label={translate(`Apply to all ${info.instances} similar items`, `تطبيق على كل العناصر المماثلة (${info.instances})`)} checked={applyAll} onChange={(e) => setApplyAll(e.currentTarget.checked)} data-testid="ve-apply-all" />
                )}
                <Switch size="xs" label={translate("Edit hover state", "تعديل حالة المرور")} checked={hoverState} onChange={(e) => setHoverState(e.currentTarget.checked)} />
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-1">
                  <Button size="compact-xs" variant="default" onClick={() => moveSibling(info, -1)} data-testid="ve-move-up">
                    ▲ {translate("Earlier", "قبل")}
                  </Button>
                  <Button size="compact-xs" variant="default" onClick={() => moveSibling(info, 1)} data-testid="ve-move-down">
                    ▼ {translate("Later", "بعد")}
                  </Button>
                  <Button size="compact-xs" variant="default" onClick={() => hide(info)} data-testid="ve-hide">
                    {getEl(config, ctx.scope, ctx.elKey).hidden?.[device] ? translate("Show", "إظهار") : translate(`Hide on ${device}`, "إخفاء")}
                  </Button>
                  {info.id.startsWith("ins:") && (
                    <Button size="compact-xs" variant="default" onClick={() => apply(duplicateNode(configRef.current, info.id.slice(4), ctx.scope))} data-testid="ve-duplicate">
                      {translate("Duplicate", "تكرار")}
                    </Button>
                  )}
                  <Button size="compact-xs" variant="light" color="red" onClick={() => remove(info)} data-testid="ve-delete">
                    {translate("Delete", "حذف")}
                  </Button>
                  {!info.id.startsWith("ins:") && Object.keys(getEl(config, ctx.scope, ctx.elKey)).length > 0 && (
                    <Button size="compact-xs" variant="subtle" onClick={() => apply(setEl(configRef.current, ctx.scope, ctx.elKey, () => ({})))} data-testid="ve-reset-el">
                      {translate("Reset element", "إعادة تعيين العنصر")}
                    </Button>
                  )}
                </div>
              )}
              <Tabs defaultValue="content" keepMounted={false}>
                <Tabs.List grow>
                  <Tabs.Tab value="content" data-testid="ve-tab-content">
                    {translate("Content", "المحتوى")}
                  </Tabs.Tab>
                  <Tabs.Tab value="style" data-testid="ve-tab-style">
                    {translate("Style", "التنسيق")}
                  </Tabs.Tab>
                  <Tabs.Tab value="visibility">{translate("Visibility", "الظهور")}</Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="content" pt="sm">
                  {info.id.startsWith("ins:") ? (
                    <NodeControls nodeId={info.id.slice(4)} config={config} onChange={apply} readOnly={!canEdit} canCode={canCode} lang={lang} />
                  ) : (
                    <ContentControls info={info} ctx={ctx} lang={lang} />
                  )}
                </Tabs.Panel>
                <Tabs.Panel value="style" pt="sm">
                  <ResponsiveHint device={device} />
                  <div className="mt-2">
                    <StyleControls ctx={ctx} kind={info.kind} tag={info.tag} />
                  </div>
                </Tabs.Panel>
                <Tabs.Panel value="visibility" pt="sm">
                  <VisibilityControls ctx={ctx} />
                </Tabs.Panel>
              </Tabs>
            </div>
          )}
        </aside>
      </div>

      <VersionsDrawer
        opened={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        canEdit={canEdit}
        canPublish={canPublish}
        onRestored={(c, rev) => {
          revRef.current = rev;
          savedRef.current = JSON.stringify(c);
          history.current.past.push(configRef.current);
          configRef.current = c;
          setConfigState(c);
          setStatus("saved");
          setHasUnpublished(true);
        }}
      />
    </div>
  );
}

function VersionsDrawer({ opened, onClose, canEdit, canPublish, onRestored }: { opened: boolean; onClose: () => void; canEdit: boolean; canPublish: boolean; onRestored: (c: VisualConfig, rev: number) => void }) {
  const { language, translate } = useLanguage();
  const { call } = useCmsApi();
  const confirm = useConfirm();
  const [rows, setRows] = useState<{ _id: string; kind: string; label: string; createdAt: string; createdBy?: { name: string }; live?: boolean }[] | null>(null);
  const load = useCallback(async () => {
    const r = await call<typeof rows>({ url: "website/visual/revisions", params: { limit: 60 } });
    setRows(r?.data || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (opened) load();
  }, [opened, load]);
  const KIND: Record<string, string> = { autosave: "Autosave", save: "Saved", publish: "Published", restore: "Restored", rollback: "Rollback" };
  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="lg" title={translate("Versions", "النسخ")} zIndex={400}>
      {!rows ? (
        <Loader size="sm" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">{translate("No versions yet.", "لا توجد نسخ بعد.")}</p>
      ) : (
        <Table fz="xs" verticalSpacing={6} data-testid="ve-versions-table">
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r._id}>
                <Table.Td>
                  <Badge size="xs" variant="light" color={r.kind === "publish" || r.kind === "rollback" ? "teal" : "gray"}>
                    {KIND[r.kind] || r.kind}
                  </Badge>
                  {r.live && (
                    <Badge size="xs" ml={4} color="green">
                      {translate("Live", "منشور")}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  <div>{formatCairoDateTime(r.createdAt, language)}</div>
                  <div className="text-gray-500">
                    {r.createdBy?.name} {r.label && `· ${r.label}`}
                  </div>
                </Table.Td>
                <Table.Td className="text-right">
                  <div className="flex justify-end gap-1">
                    {canEdit && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        onClick={async () => {
                          if (!(await confirm({ title: translate("Restore this version to the draft?", "استعادة هذه النسخة للمسودة؟"), message: translate("Your current draft is replaced (it stays in this list). Nothing changes on the live site until you publish.", "ستُستبدل المسودة الحالية (تبقى في القائمة). لا يتغير الموقع حتى تنشر."), confirmLabel: translate("Restore", "استعادة") }))) return;
                          const res = await call<{ config: VisualConfig; rev: number }>({ url: `website/visual/revisions/${r._id}/restore`, method: "POST" }, { success: "server" });
                          if (res) {
                            onRestored(res.data.config, res.data.rev);
                            load();
                          }
                        }}
                      >
                        {translate("Restore", "استعادة")}
                      </Button>
                    )}
                    {canPublish && !r.live && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="orange"
                        onClick={async () => {
                          if (!(await confirm({ title: translate("Put this version live?", "نشر هذه النسخة؟"), message: translate("The public website goes back to this version. Your draft is not changed.", "سيعود الموقع العام إلى هذه النسخة. لا تتغير المسودة."), confirmLabel: translate("Roll back", "رجوع"), danger: true }))) return;
                          const res = await call({ url: `website/visual/revisions/${r._id}/rollback`, method: "POST" }, { success: "server" });
                          if (res) load();
                        }}
                      >
                        {translate("Roll back live", "إرجاع المنشور")}
                      </Button>
                    )}
                  </div>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Drawer>
  );
}
