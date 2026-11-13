import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Accordion, ActionIcon, Alert, Badge, Button, ColorInput, Select, Tabs, Textarea, TextInput, Tooltip } from "@mantine/core";
import paths from "@/utils/constants/paths";
import { Bucket, bucketFor, countOverrides, Device, setRuleStyle, setToken, unresolved, VisualConfig } from "./ve-config";
import { FONT_OPTIONS } from "./props-panel";

// Website Visual Editor - left sidebar: Layers (the real element tree of the page), Elements (the
// library - drag onto the page or click to add after the selection), Global design (tokens and
// global component styles), Page (page CSS, overrides report) and Navigation.

export interface TreeNode {
  id: string;
  parent: string | null;
  tag: string;
  kind: string;
  component: string;
  label: string;
  hidden: boolean;
}

const KIND_ICON: Record<string, string> = { heading: "H", text: "¶", image: "▣", icon: "★", video: "▶", button: "⬭", link: "↗", section: "▤", container: "▢", list: "☰", field: "⌨" };

export function Layers({
  nodes,
  selected,
  hovered,
  labels,
  onSelect,
  onHover,
  onRename,
  onMove,
  onToggleHide,
  readOnly,
  emptyText,
}: {
  nodes: TreeNode[];
  selected: string | null;
  hovered: string | null;
  labels: Record<string, string>;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onRename: (id: string, label: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onToggleHide: (id: string) => void;
  readOnly: boolean;
  emptyText?: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const children = useMemo(() => {
    const m = new Map<string | null, TreeNode[]>();
    for (const n of nodes) {
      const k = n.parent;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(n);
    }
    return m;
  }, [nodes]);
  // expand the path to the selection
  const ancestors = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const s = new Set<string>();
    let cur = selected ? byId.get(selected) : undefined;
    while (cur?.parent) {
      s.add(cur.parent);
      cur = byId.get(cur.parent);
    }
    return s;
  }, [nodes, selected]);
  const ql = q.trim().toLowerCase();
  const matches = (n: TreeNode) => !ql || `${n.component} ${n.tag} ${n.label} ${labels[n.id] || ""}`.toLowerCase().includes(ql);

  const render = (parent: string | null, depth: number): JSX.Element[] =>
    (children.get(parent) || []).flatMap((n) => {
      const kids = children.get(n.id) || [];
      const open = ql ? true : (!collapsed.has(n.id) && depth < 2) || ancestors.has(n.id) || (collapsed.has(`+${n.id}`) && !collapsed.has(n.id));
      const row = matches(n) ? (
        <div
          key={n.id}
          className={`group flex items-center gap-1 rounded px-1 py-0.5 text-xs ${selected === n.id ? "bg-blue-100 text-blue-900" : hovered === n.id ? "bg-gray-100" : ""} ${n.hidden ? "opacity-50" : ""}`}
          style={{ paddingInlineStart: 4 + depth * 12 }}
          onMouseEnter={() => onHover(n.id)}
          onMouseLeave={() => onHover(null)}
          data-testid="layer-row"
          data-layer-id={n.id}
        >
          <button
            type="button"
            className="w-4 text-gray-400"
            onClick={() =>
              setCollapsed((s) => {
                const x = new Set(s);
                if (open) {
                  x.add(n.id);
                  x.delete(`+${n.id}`);
                } else {
                  x.delete(n.id);
                  x.add(`+${n.id}`);
                }
                return x;
              })
            }
            aria-label="toggle"
          >
            {kids.length ? (open ? "▾" : "▸") : ""}
          </button>
          <span className="w-4 text-center text-gray-500">{KIND_ICON[n.kind] || "▢"}</span>
          {renaming === n.id ? (
            <TextInput
              size="xs"
              autoFocus
              defaultValue={labels[n.id] || ""}
              onBlur={(e) => {
                onRename(n.id, e.currentTarget.value);
                setRenaming(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            />
          ) : (
            <button type="button" className="min-w-0 flex-1 truncate text-start" onClick={() => onSelect(n.id)} onDoubleClick={() => !readOnly && setRenaming(n.id)} title={n.id}>
              <span className="font-medium">{labels[n.id] || `${n.component} ${n.tag}`}</span>
              {!labels[n.id] && n.label && <span className="text-gray-500"> · {n.label}</span>}
            </button>
          )}
          {!readOnly && (
            <span className="hidden gap-0.5 group-hover:flex">
              <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => onMove(n.id, -1)} aria-label="up">
                ↑
              </ActionIcon>
              <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => onMove(n.id, 1)} aria-label="down">
                ↓
              </ActionIcon>
              <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => onToggleHide(n.id)} aria-label="hide">
                ◌
              </ActionIcon>
            </span>
          )}
        </div>
      ) : null;
      return [...(row ? [row] : []), ...(open ? render(n.id, depth + 1) : [])];
    });

  return (
    <div className="flex h-full flex-col gap-2" data-testid="layers">
      <TextInput size="xs" placeholder="Find an element" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
      <div className="min-h-0 flex-1 overflow-auto">{nodes.length ? render(null, 0) : <p className="p-2 text-xs text-gray-500" data-testid="layers-empty">{emptyText || "Loading the page…"}</p>}</div>
      <p className="text-[11px] text-gray-500">Click to select · double-click to rename · drag elements on the page with ⠿</p>
    </div>
  );
}

export const LIBRARY: { kind: string; label: string; icon: string; admin?: boolean }[] = [
  { kind: "heading", label: "Heading", icon: "H" },
  { kind: "text", label: "Text", icon: "¶" },
  { kind: "image", label: "Image", icon: "▣" },
  { kind: "video", label: "Video", icon: "▶" },
  { kind: "button", label: "Button", icon: "⬭" },
  { kind: "icon", label: "Icon", icon: "★" },
  { kind: "container", label: "Container", icon: "▢" },
  { kind: "columns", label: "Columns", icon: "▥" },
  { kind: "grid", label: "Grid", icon: "▦" },
  { kind: "spacer", label: "Spacer", icon: "↕" },
  { kind: "divider", label: "Divider", icon: "—" },
  { kind: "list", label: "List", icon: "☰" },
  { kind: "card", label: "Card", icon: "▭" },
  { kind: "imageText", label: "Image with text", icon: "◧" },
  { kind: "cta", label: "Call to action", icon: "➤" },
  { kind: "gallery", label: "Gallery", icon: "▤" },
  { kind: "faq", label: "FAQ", icon: "?" },
  { kind: "statistics", label: "Statistics", icon: "#" },
  { kind: "html", label: "Custom HTML", icon: "</>", admin: true },
];

export function Library({ canCode, onAdd, readOnly }: { canCode: boolean; onAdd: (kind: string) => void; readOnly: boolean }) {
  if (readOnly) return <Alert color="gray" variant="light">You can view the page structure. Adding elements needs edit access.</Alert>;
  return (
    <div className="flex flex-col gap-2" data-testid="library">
      <p className="text-[11px] text-gray-500">Drag an element onto the page, or select an element and click to add after it.</p>
      <div className="grid grid-cols-2 gap-2">
        {LIBRARY.filter((l) => !l.admin || canCode).map((l) => (
          <button
            key={l.kind}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", `ve-node:${l.kind}`);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => onAdd(l.kind)}
            className="flex cursor-grab flex-col items-center gap-1 rounded-md border border-gray-200 bg-white p-2 text-xs hover:border-blue-500 hover:bg-blue-50"
            data-testid={`lib-${l.kind}`}
          >
            <span className="text-lg leading-none text-gray-600">{l.icon}</span>
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const GLOBAL_TARGETS: { key: string; label: string }[] = [
  { key: "body", label: "Page body" },
  { key: "headings", label: "All headings" },
  { key: "h1", label: "Heading 1" },
  { key: "h2", label: "Heading 2" },
  { key: "h3", label: "Heading 3" },
  { key: "text", label: "Paragraphs and lists" },
  { key: "links", label: "Links" },
  { key: "buttons", label: "All buttons" },
  { key: "buttonPrimary", label: "Primary button" },
  { key: "buttonSecondary", label: "Secondary button" },
  { key: "buttonWhatsapp", label: "WhatsApp button" },
  { key: "cards", label: "Cards" },
  { key: "header", label: "Header" },
  { key: "headerLinks", label: "Header menu links" },
  { key: "footer", label: "Footer" },
  { key: "footerLinks", label: "Footer links" },
  { key: "forms", label: "Form fields" },
  { key: "container", label: "Page container" },
  { key: "sections", label: "Sections" },
];

const TOKEN_GROUPS: { title: string; match: (n: string, v: string) => boolean }[] = [
  { title: "Colors", match: (_n, v) => /^(#|rgb|hsl|color-mix)/i.test(v) },
  { title: "Typography", match: (n) => /font|display|body|mono|text-size|leading/i.test(n) },
  { title: "Layout and shape", match: (n) => /wrap|radius|^--r|gap|space|shadow|dur|ease/i.test(n) },
];

const RULE_PROPS: { prop: string; label: string; type?: "color" | "select"; options?: { value: string; label: string }[] }[] = [
  { prop: "fontFamily", label: "Font", type: "select", options: FONT_OPTIONS },
  { prop: "fontSize", label: "Font size" },
  { prop: "fontWeight", label: "Weight", type: "select", options: ["300", "400", "500", "600", "700", "800"].map((v) => ({ value: v, label: v })) },
  { prop: "lineHeight", label: "Line height" },
  { prop: "letterSpacing", label: "Letter spacing" },
  { prop: "color", label: "Text color", type: "color" },
  { prop: "backgroundColor", label: "Background", type: "color" },
  { prop: "borderRadius", label: "Corner radius" },
  { prop: "borderColor", label: "Border color", type: "color" },
  { prop: "paddingTop", label: "Padding top" },
  { prop: "paddingBottom", label: "Padding bottom" },
  { prop: "paddingLeft", label: "Padding start" },
  { prop: "paddingRight", label: "Padding end" },
  { prop: "maxWidth", label: "Max width" },
  { prop: "boxShadow", label: "Shadow", type: "select", options: ["none", "var(--shadow-sm)", "var(--shadow-md)", "var(--shadow-lg)"].map((v) => ({ value: v, label: v })) },
];

export function GlobalDesign({ config, siteTokens, device, onChange, canDesign }: { config: VisualConfig; siteTokens: { light: Record<string, string>; dark: Record<string, string> }; device: Device; onChange: (c: VisualConfig, o?: { coalesce?: string }) => void; canDesign: boolean }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [target, setTarget] = useState("headings");
  const [hover, setHover] = useState(false);
  const base = theme === "light" ? siteTokens.light : siteTokens.dark;
  const names = Object.keys(base).sort();
  const grouped = TOKEN_GROUPS.map((g) => ({ ...g, names: names.filter((n) => g.match(n, base[n])) }));
  const other = names.filter((n) => !grouped.some((g) => g.names.includes(n)));
  const key = (n: string) => (theme === "dark" ? `dark:${n}` : n);
  const ro = !canDesign;
  return (
    <div className="flex flex-col gap-3" data-testid="global-design">
      {ro && (
        <Alert color="gray" variant="light">
          Only a website administrator can change the global design.
        </Alert>
      )}
      <Tabs defaultValue="tokens">
        <Tabs.List grow>
          <Tabs.Tab value="tokens">Design tokens</Tabs.Tab>
          <Tabs.Tab value="components">Components</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="tokens" pt="sm">
          <Select size="xs" label="Theme" value={theme} onChange={(v) => setTheme((v as "light" | "dark") || "light")} data={[{ value: "light", label: "Light (default)" }, { value: "dark", label: "Dark mode" }]} allowDeselect={false} mb="sm" />
          <Accordion multiple defaultValue={["Colors"]} variant="contained">
            {[...grouped, { title: "Other", names: other, match: () => true }].map((g) =>
              g.names.length ? (
                <Accordion.Item key={g.title} value={g.title}>
                  <Accordion.Control>
                    <span className="text-sm font-semibold">{g.title}</span>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <div className="flex flex-col gap-2">
                      {g.names.map((n) => {
                        const isColor = /^(#|rgb|hsl)/i.test(base[n]);
                        const v = config.tokens[key(n)] || "";
                        const set = (val: string) => onChange(setToken(config, key(n), val), { coalesce: `token:${key(n)}` });
                        return isColor ? (
                          <ColorInput key={n} size="xs" label={n} value={v} placeholder={base[n]} onChange={set} format="hexa" disabled={ro} data-testid={`token-${n}`} withEyeDropper={false} />
                        ) : (
                          <TextInput key={n} size="xs" label={n} value={v} placeholder={base[n]} onChange={(e) => set(e.currentTarget.value)} disabled={ro} dir="ltr" data-testid={`token-${n}`} />
                        );
                      })}
                    </div>
                  </Accordion.Panel>
                </Accordion.Item>
              ) : null,
            )}
          </Accordion>
          <p className="mt-2 text-[11px] text-gray-500">Every element that uses a token updates, on every page. Empty = the site's original value.</p>
        </Tabs.Panel>
        <Tabs.Panel value="components" pt="sm">
          <div className="flex flex-col gap-2">
            <Select size="xs" label="Component" value={target} onChange={(v) => setTarget(v || "headings")} data={GLOBAL_TARGETS.map((t) => ({ value: t.key, label: t.label }))} allowDeselect={false} searchable />
            <Button size="compact-xs" variant={hover ? "filled" : "light"} color="grape" onClick={() => setHover((h) => !h)} w="fit-content">
              {hover ? "Editing hover state" : "Edit hover state"}
            </Button>
            {RULE_PROPS.map((r) => {
              const bucket: Bucket = bucketFor(r.prop, device, hover);
              const v = config.rules[target]?.[bucket]?.[r.prop] || "";
              const set = (val: string) => onChange(setRuleStyle(config, target, bucket, r.prop, val), { coalesce: `rule:${target}:${bucket}:${r.prop}` });
              const label = (
                <span>
                  {r.label} {bucket !== "all" && <Badge size="xs" variant="light">{bucket}</Badge>}
                </span>
              );
              if (r.type === "color") return <ColorInput key={r.prop} size="xs" label={label} value={v} onChange={set} format="hexa" disabled={ro} withEyeDropper={false} />;
              if (r.type === "select") return <Select key={r.prop} size="xs" label={label} value={v || null} onChange={(x) => set(x || "")} data={r.options || []} clearable disabled={ro} />;
              return <TextInput key={r.prop} size="xs" label={label} value={v} onChange={(e) => set(e.currentTarget.value)} disabled={ro} dir="ltr" />;
            })}
          </div>
        </Tabs.Panel>
      </Tabs>
      <p className="text-[11px] text-gray-500">Breakpoints: desktop ≥ 1024px, tablet 640-1023px, mobile below 640px - the same widths the canvas previews.</p>
    </div>
  );
}

export function PageSettings({ config, scope, present, onChange, canCode, onReset, cmsPageId }: { config: VisualConfig; scope: string; present: Set<string>; onChange: (c: VisualConfig) => void; canCode: boolean; onReset: () => void; cmsPageId: string | null }) {
  const navigate = useNavigate();
  const missing = unresolved(config, scope, present);
  const setCss = (which: "page" | "site", css: string) => {
    const next = JSON.parse(JSON.stringify(config)) as VisualConfig;
    if (which === "site") next.css = css;
    else (next.routes[scope] ||= { el: {}, css: "" }).css = css;
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-3" data-testid="page-settings">
      <div className="text-sm">
        <div className="font-semibold">Page {scope}</div>
        <div className="text-xs text-gray-500">{countOverrides(config, scope)} element change(s) on this page · {countOverrides(config, "*")} on every page</div>
      </div>
      {cmsPageId && (
        <Button size="xs" variant="light" onClick={() => navigate(`/${paths.website}/${paths.websitePages}/${cmsPageId}`)}>
          Page title, address and SEO
        </Button>
      )}
      <Tooltip label="Removes every visual change on this page (other pages keep theirs). You can undo.">
        <Button size="xs" variant="light" color="red" onClick={onReset} disabled={!countOverrides(config, scope)}>
          Reset this page's design
        </Button>
      </Tooltip>
      {missing.length > 0 && (
        <Alert color="yellow" variant="light" title={`${missing.length} saved change(s) not found on this page`}>
          <p className="text-xs">The page's code changed since these were made, so they no longer apply. They are kept until you reset the page.</p>
          <ul className="mt-1 max-h-24 overflow-auto font-mono text-[10px]">
            {missing.slice(0, 20).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alert>
      )}
      {canCode ? (
        <>
          <Textarea size="xs" label="CSS for this page (administrators)" value={config.routes[scope]?.css || ""} onChange={(e) => setCss("page", e.currentTarget.value)} autosize minRows={4} maxRows={14} dir="ltr" styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 12 } }} data-testid="page-css" />
          <Textarea size="xs" label="CSS for the whole site (administrators)" value={config.css || ""} onChange={(e) => setCss("site", e.currentTarget.value)} autosize minRows={4} maxRows={14} dir="ltr" styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 12 } }} data-testid="site-css" />
          <p className="text-[11px] text-gray-500">Checked on save (no &lt;style&gt;, &lt;script&gt;, @import). Scripts and tracking tags belong in Custom Code.</p>
        </>
      ) : (
        <p className="text-xs text-gray-500">Custom CSS is managed by website administrators.</p>
      )}
    </div>
  );
}

export function NavigationTab() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>The header and footer are part of the canvas: click any menu link, the logo or a footer element to edit its text, link and look - on every page at once.</p>
      <p className="text-xs text-gray-500">To add, remove or nest menu items and choose which pages they open, use the menu manager.</p>
      <Button size="xs" variant="light" onClick={() => navigate(`/${paths.website}/${paths.websiteNavigation}`)}>
        Open the menu manager
      </Button>
    </div>
  );
}
