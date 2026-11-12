// Website Visual Editor - the configuration model (mirrors the website's src/editor/visual.ts) and
// pure, immutable edit operations used by the editor UI. Every operation returns a NEW config, so
// undo/redo is a stack of configs.

export type Lang = "en" | "ar";
export type Device = "desktop" | "tablet" | "mobile";
export type Bucket = "all" | Device | "hover";
export type StyleMap = Record<string, string>;
export interface StyleBuckets {
  all?: StyleMap;
  desktop?: StyleMap;
  tablet?: StyleMap;
  mobile?: StyleMap;
  hover?: StyleMap;
}
export interface ElOverride {
  label?: string;
  text?: Partial<Record<Lang, string>>;
  attrs?: { src?: string; mobileSrc?: string; alt?: Partial<Record<Lang, string>>; href?: string; target?: "_self" | "_blank" };
  styles?: StyleBuckets;
  hidden?: Partial<Record<Device, boolean>>;
  deleted?: boolean;
  order?: string[];
  flexify?: boolean;
  insert?: string[];
}
export type NodeType = "heading" | "text" | "image" | "video" | "button" | "icon" | "box" | "spacer" | "divider" | "list" | "faq" | "html";
export interface VNode {
  type: NodeType;
  props: Record<string, unknown>;
  children?: string[];
}
export interface VisualConfig {
  v: 1;
  tokens: Record<string, string>;
  rules: Record<string, StyleBuckets>;
  css: string;
  routes: Record<string, { el: Record<string, ElOverride>; css?: string }>;
  nodes: Record<string, VNode>;
}
export const EMPTY: VisualConfig = { v: 1, tokens: {}, rules: {}, css: "", routes: {}, nodes: {} };

/** Per-device properties (sizes, spacing, layout) - written to the device being edited. */
export const RESPONSIVE = new Set([
  "fontSize", "lineHeight", "letterSpacing", "textAlign", "whiteSpace", "width", "maxWidth", "minWidth", "height", "maxHeight", "minHeight",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft",
  "display", "flexDirection", "flexWrap", "justifyContent", "alignItems", "alignSelf", "gap", "rowGap", "columnGap", "gridTemplateColumns", "order", "flexGrow",
  "position", "top", "right", "bottom", "left", "objectPosition", "aspectRatio", "backgroundPosition", "backgroundSize",
]);

export const bucketFor = (prop: string, device: Device, hover: boolean): Bucket => (hover ? "hover" : RESPONSIVE.has(prop) ? device : "all");

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const prune = (o: Record<string, unknown>) => {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v === undefined || v === null || v === "" || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length) || (Array.isArray(v) && !v.length)) delete o[k];
  }
  return o;
};

export function getEl(c: VisualConfig, scope: string, id: string): ElOverride {
  return c.routes[scope]?.el[id] || {};
}

export function setEl(c: VisualConfig, scope: string, id: string, fn: (el: ElOverride) => ElOverride): VisualConfig {
  const next = clone(c);
  const rc = (next.routes[scope] ||= { el: {}, css: "" });
  const updated = fn(clone(rc.el[id] || {}));
  if (updated.styles) {
    for (const b of Object.keys(updated.styles) as Bucket[]) prune(updated.styles[b] as Record<string, unknown>);
    prune(updated.styles as Record<string, unknown>);
  }
  if (updated.attrs) prune(updated.attrs as Record<string, unknown>);
  if (updated.text) prune(updated.text as Record<string, unknown>);
  if (updated.hidden) prune(updated.hidden as Record<string, unknown>);
  prune(updated as Record<string, unknown>);
  if (Object.keys(updated).length) rc.el[id] = updated;
  else delete rc.el[id];
  if (!Object.keys(rc.el).length && !rc.css) delete next.routes[scope];
  return next;
}

export function setStyle(c: VisualConfig, scope: string, id: string, bucket: Bucket, prop: string, value: string): VisualConfig {
  return setEl(c, scope, id, (el) => ({ ...el, styles: { ...(el.styles || {}), [bucket]: { ...(el.styles?.[bucket] || {}), [prop]: value } } }));
}

export function setRuleStyle(c: VisualConfig, target: string, bucket: Bucket, prop: string, value: string): VisualConfig {
  const next = clone(c);
  const r = (next.rules[target] ||= {});
  const b = (r[bucket] ||= {});
  if (value) b[prop] = value;
  else delete b[prop];
  prune(r as Record<string, unknown>);
  if (!Object.keys(r).length) delete next.rules[target];
  return next;
}

export function setToken(c: VisualConfig, name: string, value: string): VisualConfig {
  const next = clone(c);
  if (value) next.tokens[name] = value;
  else delete next.tokens[name];
  return next;
}

const displayIsFlow = (display: string) => !/flex|grid/.test(display || "");

/** Visual order of a parent's children after moving `id` before/after `targetId` (or appending a new id). */
export function reorder(siblings: string[], id: string, targetId: string | null, position: "before" | "after"): string[] {
  const list = siblings.filter((s) => s !== id);
  if (!targetId) return [...list, id];
  const i = list.indexOf(targetId);
  if (i < 0) return [...list, id];
  list.splice(position === "before" ? i : i + 1, 0, id);
  return list;
}

export function setOrder(c: VisualConfig, scope: string, parentId: string, order: string[], parentDisplay: string): VisualConfig {
  return setEl(c, scope, parentId, (el) => ({ ...el, order, flexify: el.flexify || displayIsFlow(parentDisplay) || undefined }));
}

export const newId = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

/** Library templates: each creates one or more primitive nodes (all individually editable). */
export function createFromLibrary(kind: string): { root: string; nodes: Record<string, VNode> } {
  const nodes: Record<string, VNode> = {};
  const add = (n: VNode) => {
    const id = newId();
    nodes[id] = n;
    return id;
  };
  const t = (en: string, ar: string) => ({ en, ar });
  const heading = (en: string, ar: string, level = 2) => add({ type: "heading", props: { level, text: t(en, ar) } });
  const text = (en: string, ar: string) => add({ type: "text", props: { text: t(en, ar) } });
  const button = (en: string, ar: string, style = "primary") => add({ type: "button", props: { label: t(en, ar), href: "/contact", style } });
  const image = () => add({ type: "image", props: { src: "", alt: t("", "") } });
  const box = (variant: string, children: string[], columns?: number) => add({ type: "box", props: { variant, columns }, children });
  let root: string;
  switch (kind) {
    case "heading":
      root = heading("New heading", "عنوان جديد");
      break;
    case "text":
      root = text("Write your text here.", "اكتب النص هنا.");
      break;
    case "image":
      root = image();
      break;
    case "video":
      root = add({ type: "video", props: { url: "" } });
      break;
    case "button":
      root = button("Get a quote", "اطلب عرض سعر");
      break;
    case "icon":
      root = add({ type: "icon", props: { name: "sun" } });
      break;
    case "container":
      root = box("container", [text("Content", "المحتوى")]);
      break;
    case "columns":
      root = box("columns", [box("stack", [text("Column one", "العمود الأول")]), box("stack", [text("Column two", "العمود الثاني")])], 2);
      break;
    case "grid":
      root = box("grid", [1, 2, 3].map((n) => box("card", [heading(`Item ${n}`, `عنصر ${n}`, 3), text("Description", "الوصف")])), 3);
      break;
    case "spacer":
      root = add({ type: "spacer", props: { height: "48px" } });
      break;
    case "divider":
      root = add({ type: "divider", props: {} });
      break;
    case "list":
      root = add({ type: "list", props: { items: [t("First point", "النقطة الأولى"), t("Second point", "النقطة الثانية")] } });
      break;
    case "card":
      root = box("card", [image(), heading("Card title", "عنوان البطاقة", 3), text("A short description.", "وصف قصير."), button("Learn more", "اعرف المزيد", "secondary")]);
      break;
    case "imageText":
      root = box("columns", [image(), box("stack", [heading("Heading", "عنوان"), text("Tell visitors what this is about.", "أخبر الزوار عن هذا الموضوع."), button("Contact us", "تواصل معنا")])], 2);
      break;
    case "cta":
      root = box("cta", [box("stack", [heading("Ready to cut your energy bill?", "جاهز لتخفيض فاتورة الكهرباء؟"), text("Get a free solar study for your site.", "احصل على دراسة طاقة شمسية مجانية لموقعك.")]), button("Get a free quote", "اطلب عرض سعر مجانًا")]);
      break;
    case "gallery":
      root = box("grid", [image(), image(), image()], 3);
      break;
    case "faq":
      root = add({ type: "faq", props: { items: [{ q: t("Question?", "سؤال؟"), a: t("Answer.", "الإجابة.") }] } });
      break;
    case "statistics":
      root = box("grid", [["350+", "Projects", "مشروع"], ["12", "Governorates", "محافظة"], ["25 yrs", "Panel warranty", "ضمان الألواح"]].map(([n, en, ar]) => box("card", [heading(n, n, 3), text(en, ar)])), 3);
      break;
    case "html":
      root = add({ type: "html", props: { html: "<div>Custom HTML</div>" } });
      break;
    default:
      root = text("Text", "نص");
  }
  return { root, nodes };
}

/** Every node id under (and including) `id`. */
export function subtree(c: VisualConfig, id: string, acc: string[] = []): string[] {
  acc.push(id);
  for (const ch of c.nodes[id]?.children || []) subtree(c, ch, acc);
  return acc;
}

/** Where an added node lives: the parent box node, or the existing element whose `insert` list has it. */
export function findInsertParent(c: VisualConfig, nodeId: string): { kind: "node"; id: string } | { kind: "el"; scope: string; id: string } | null {
  for (const [pid, n] of Object.entries(c.nodes)) if (n.children?.includes(nodeId)) return { kind: "node", id: pid };
  for (const [scope, rc] of Object.entries(c.routes)) for (const [id, el] of Object.entries(rc.el)) if (el.insert?.includes(nodeId)) return { kind: "el", scope, id };
  return null;
}

export function insertNodes(
  c: VisualConfig,
  created: { root: string; nodes: Record<string, VNode> },
  where: { inside?: string; parentId?: string | null; scope: string; targetId?: string | null; position?: "before" | "after"; siblings?: string[]; parentDisplay?: string },
): VisualConfig {
  let next = clone(c);
  Object.assign(next.nodes, created.nodes);
  const edId = `ins:${created.root}`;
  if (where.inside) {
    const parent = next.nodes[where.inside];
    if (parent) parent.children = [...(parent.children || []), created.root];
    return next;
  }
  if (!where.parentId) throw new Error("Choose a place inside a section to add the element.");
  const parentId = where.parentId;
  if (parentId.startsWith("ins:")) {
    const pn = next.nodes[parentId.slice(4)];
    if (pn) {
      const kids = (pn.children || []).filter((k) => k !== created.root);
      const ti = where.targetId?.startsWith("ins:") ? kids.indexOf(where.targetId.slice(4)) : -1;
      kids.splice(ti < 0 ? kids.length : where.position === "before" ? ti : ti + 1, 0, created.root);
      pn.children = kids;
      return next;
    }
  }
  next = setEl(next, where.scope, parentId, (el) => ({ ...el, insert: [...(el.insert || []), created.root] }));
  if (where.siblings && where.siblings.length) next = setOrder(next, where.scope, parentId, reorder(where.siblings, edId, where.targetId || null, where.position || "after"), where.parentDisplay || "block");
  return next;
}

export function removeNode(c: VisualConfig, nodeId: string): VisualConfig {
  let next = clone(c);
  const ids = subtree(next, nodeId);
  const parent = findInsertParent(next, nodeId);
  if (parent?.kind === "node") next.nodes[parent.id].children = (next.nodes[parent.id].children || []).filter((k) => k !== nodeId);
  if (parent?.kind === "el") next = setEl(next, parent.scope, parent.id, (el) => ({ ...el, insert: (el.insert || []).filter((k) => k !== nodeId), order: el.order?.filter((o) => o !== `ins:${nodeId}`) }));
  for (const id of ids) {
    delete next.nodes[id];
    for (const rc of Object.values(next.routes)) delete rc.el[`ins:${id}`];
  }
  return next;
}

export function duplicateNode(c: VisualConfig, nodeId: string, scope: string): VisualConfig {
  const map: Record<string, string> = {};
  const nodes: Record<string, VNode> = {};
  for (const id of subtree(c, nodeId)) map[id] = newId();
  for (const id of Object.keys(map)) {
    const n = clone(c.nodes[id]);
    if (n.children) n.children = n.children.map((ch) => map[ch]);
    nodes[map[id]] = n;
  }
  let next = clone(c);
  Object.assign(next.nodes, nodes);
  // copy the element styles of every copied node
  for (const rc of Object.values(next.routes)) for (const [old, nw] of Object.entries(map)) if (rc.el[`ins:${old}`]) rc.el[`ins:${nw}`] = clone(rc.el[`ins:${old}`]);
  const parent = findInsertParent(next, nodeId);
  if (parent?.kind === "node") {
    const kids = next.nodes[parent.id].children || [];
    kids.splice(kids.indexOf(nodeId) + 1, 0, map[nodeId]);
  } else if (parent?.kind === "el") {
    next = setEl(next, parent.scope, parent.id, (el) => {
      const order = el.order ? [...el.order] : undefined;
      if (order) order.splice(order.indexOf(`ins:${nodeId}`) + 1, 0, `ins:${map[nodeId]}`);
      return { ...el, insert: [...(el.insert || []), map[nodeId]], order };
    });
  }
  void scope;
  return next;
}

/** Overrides whose element is not on the current page (e.g. the source changed). */
export function unresolved(c: VisualConfig, scope: string, presentIds: Set<string>): string[] {
  return Object.keys(c.routes[scope]?.el || {}).filter((id) => !id.includes("@*") && !presentIds.has(id));
}

export const countOverrides = (c: VisualConfig, scope: string) => Object.keys(c.routes[scope]?.el || {}).length;
