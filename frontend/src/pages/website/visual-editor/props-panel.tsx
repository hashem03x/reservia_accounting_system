import { ReactNode, useState } from "react";
import { Accordion, ActionIcon, Badge, Button, Checkbox, ColorInput, NumberInput, SegmentedControl, Select, Switch, Textarea, TextInput, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { MediaPicker } from "../_shared/media-picker";
import { Bucket, bucketFor, Device, ElOverride, getEl, Lang, RESPONSIVE, setEl, setStyle, StyleBuckets, VisualConfig } from "./ve-config";

// Website Visual Editor - properties of the selected element. The controls depend on what was
// selected (text, heading, image, button/link, icon, container/section, or an element added in the
// editor); every element also gets typography, size, spacing, layout, background, border, effects,
// position and visibility controls. Size/spacing/layout values are saved for the device being
// edited (desktop / tablet / mobile) so other devices keep their layout; colors, fonts and borders
// apply everywhere. Hover state edits the element's :hover look.

export interface ElementInfo {
  id: string;
  tag: string;
  kind: string;
  component: string;
  label: string;
  text: string | null;
  attrs: { src?: string; alt?: string; href?: string; target?: string };
  computed: Record<string, string>;
  parentId: string | null;
  parentDisplay: string;
  siblings: string[];
  childIds: string[];
  wildcard: string | null;
  instances: number;
  global: boolean;
  isH1: boolean;
}

export const FONT_OPTIONS = [
  { value: "var(--display)", label: "Display (site headings)" },
  { value: "var(--body)", label: "Body (site text)" },
  { value: "var(--mono)", label: "Monospace" },
  { value: "Cairo, sans-serif", label: "Cairo" },
  { value: "Tajawal, sans-serif", label: "Tajawal" },
  { value: "Inter, sans-serif", label: "Inter" },
  { value: "Georgia, serif", label: "Georgia (serif)" },
  { value: "system-ui, sans-serif", label: "System UI" },
];

const SHADOWS = [
  { value: "none", label: "None" },
  { value: "var(--shadow-sm)", label: "Small" },
  { value: "var(--shadow-md)", label: "Medium" },
  { value: "var(--shadow-lg)", label: "Large" },
  { value: "0 0 0 3px var(--sun)", label: "Brand ring" },
];

type Ctx = {
  config: VisualConfig;
  scope: string;
  elKey: string;
  device: Device;
  hover: boolean;
  computed: Record<string, string>;
  readOnly: boolean;
  onChange: (c: VisualConfig, opts?: { coalesce?: string }) => void;
};

function useStyle(ctx: Ctx, prop: string): [string, (v: string) => void, Bucket] {
  const bucket = bucketFor(prop, ctx.device, ctx.hover);
  const el = getEl(ctx.config, ctx.scope, ctx.elKey);
  const value = el.styles?.[bucket as keyof StyleBuckets]?.[prop] || "";
  return [value, (v) => ctx.onChange(setStyle(ctx.config, ctx.scope, ctx.elKey, bucket, prop, v), { coalesce: `${ctx.elKey}:${bucket}:${prop}` }), bucket];
}

function DeviceMark({ bucket }: { bucket: Bucket }) {
  if (bucket === "all") return null;
  return (
    <Tooltip label={bucket === "hover" ? "Hover state" : `Saved for ${bucket} only`}>
      <Badge size="xs" variant="light" color={bucket === "hover" ? "grape" : "blue"} ml={4}>
        {bucket}
      </Badge>
    </Tooltip>
  );
}

export function SField({ ctx, prop, label, type = "text", options, placeholder }: { ctx: Ctx; prop: string; label: string; type?: "text" | "color" | "select"; options?: { value: string; label: string }[]; placeholder?: string }) {
  const [value, set, bucket] = useStyle(ctx, prop);
  const ph = placeholder ?? ctx.computed[prop] ?? "";
  const lab = (
    <span className="inline-flex items-center">
      {label}
      <DeviceMark bucket={bucket} />
    </span>
  );
  if (type === "color")
    return <ColorInput size="xs" label={lab} value={value} placeholder={ph} onChange={set} format="hexa" disabled={ctx.readOnly} data-testid={`style-${prop}`} withEyeDropper={false} />;
  if (type === "select")
    return <Select size="xs" label={lab} value={value || null} placeholder={ph} data={options || []} onChange={(v) => set(v || "")} clearable disabled={ctx.readOnly} data-testid={`style-${prop}`} comboboxProps={{ withinPortal: true }} />;
  return <TextInput size="xs" label={lab} value={value} placeholder={ph} onChange={(e) => set(e.currentTarget.value)} disabled={ctx.readOnly} data-testid={`style-${prop}`} dir="ltr" />;
}

function FourSides({ ctx, base, label }: { ctx: Ctx; base: "padding" | "margin"; label: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium">{label}</div>
      <div className="grid grid-cols-4 gap-1">
        {(["Top", "Right", "Bottom", "Left"] as const).map((s) => (
          <SField key={s} ctx={ctx} prop={`${base}${s}`} label={s[0]} />
        ))}
      </div>
    </div>
  );
}

function BgImage({ ctx }: { ctx: Ctx }) {
  const [value, set] = useStyle(ctx, "backgroundImage");
  const [open, setOpen] = useState(false);
  const url = value.match(/url\("?([^")]+)"?\)/)?.[1] || "";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium">Background image</span>
      <div className="flex items-center gap-2">
        <div className="h-10 w-16 overflow-hidden rounded border bg-gray-50">{url && <img src={url} alt="" className="h-full w-full object-cover" />}</div>
        {!ctx.readOnly && (
          <>
            <Button size="compact-xs" variant="light" onClick={() => setOpen(true)} data-testid="bg-image-pick">
              {url ? "Replace" : "Choose"}
            </Button>
            {value && (
              <Button size="compact-xs" variant="subtle" color="red" onClick={() => set("")}>
                Remove
              </Button>
            )}
            <Button size="compact-xs" variant="subtle" onClick={() => set("none")}>
              None
            </Button>
          </>
        )}
      </div>
      <MediaPicker opened={open} onClose={() => setOpen(false)} onPick={(m) => set(`url("${m.url}")`)} />
    </div>
  );
}

function Section({ value, title, children }: { value: string; title: string; children: ReactNode }) {
  return (
    <Accordion.Item value={value}>
      <Accordion.Control>
        <span className="text-sm font-semibold">{title}</span>
      </Accordion.Control>
      <Accordion.Panel>
        <div className="flex flex-col gap-2">{children}</div>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

export function StyleControls({ ctx, kind, tag }: { ctx: Ctx; kind: string; tag: string }) {
  const textual = ["heading", "text", "link", "button", "section", "container", "list"].includes(kind);
  return (
    <Accordion multiple defaultValue={["typography", "spacing", "background"]} variant="contained" chevronPosition="left">
      {textual && (
        <Section value="typography" title="Typography">
          <SField ctx={ctx} prop="fontFamily" label="Font" type="select" options={FONT_OPTIONS} />
          <div className="grid grid-cols-2 gap-2">
            <SField ctx={ctx} prop="fontSize" label="Size" />
            <SField
              ctx={ctx}
              prop="fontWeight"
              label="Weight"
              type="select"
              options={["300", "400", "500", "600", "700", "800"].map((w) => ({ value: w, label: w }))}
            />
            <SField ctx={ctx} prop="lineHeight" label="Line height" />
            <SField ctx={ctx} prop="letterSpacing" label="Letter spacing" />
          </div>
          <SField ctx={ctx} prop="color" label="Text color" type="color" />
          <div className="grid grid-cols-2 gap-2">
            <SField ctx={ctx} prop="textAlign" label="Align" type="select" options={["start", "center", "end", "justify"].map((v) => ({ value: v, label: v }))} />
            <SField ctx={ctx} prop="textTransform" label="Transform" type="select" options={["none", "uppercase", "lowercase", "capitalize"].map((v) => ({ value: v, label: v }))} />
            <SField ctx={ctx} prop="textDecoration" label="Decoration" type="select" options={["none", "underline", "line-through"].map((v) => ({ value: v, label: v }))} />
            <SField ctx={ctx} prop="fontStyle" label="Style" type="select" options={["normal", "italic"].map((v) => ({ value: v, label: v }))} />
          </div>
        </Section>
      )}
      <Section value="size" title="Size">
        <div className="grid grid-cols-2 gap-2">
          <SField ctx={ctx} prop="width" label="Width" />
          <SField ctx={ctx} prop="height" label="Height" />
          <SField ctx={ctx} prop="maxWidth" label="Max width" />
          <SField ctx={ctx} prop="minHeight" label="Min height" />
        </div>
      </Section>
      <Section value="spacing" title="Spacing">
        <FourSides ctx={ctx} base="padding" label="Padding (inside)" />
        <FourSides ctx={ctx} base="margin" label="Margin (outside)" />
      </Section>
      {kind !== "image" && kind !== "icon" && (
        <Section value="layout" title="Layout">
          <div className="grid grid-cols-2 gap-2">
            <SField ctx={ctx} prop="display" label="Display" type="select" options={["block", "flex", "grid", "inline-flex", "inline-block", "none"].map((v) => ({ value: v, label: v }))} />
            <SField ctx={ctx} prop="flexDirection" label="Direction" type="select" options={["row", "column", "row-reverse", "column-reverse"].map((v) => ({ value: v, label: v }))} />
            <SField ctx={ctx} prop="justifyContent" label="Justify" type="select" options={["flex-start", "center", "flex-end", "space-between", "space-around"].map((v) => ({ value: v, label: v }))} />
            <SField ctx={ctx} prop="alignItems" label="Align items" type="select" options={["stretch", "flex-start", "center", "flex-end"].map((v) => ({ value: v, label: v }))} />
            <SField ctx={ctx} prop="gap" label="Gap" />
            <SField ctx={ctx} prop="flexWrap" label="Wrap" type="select" options={["nowrap", "wrap"].map((v) => ({ value: v, label: v }))} />
          </div>
          <SField
            ctx={ctx}
            prop="gridTemplateColumns"
            label="Grid columns"
            type="select"
            options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: `repeat(${n}, minmax(0, 1fr))`, label: `${n} column${n > 1 ? "s" : ""}` }))}
          />
        </Section>
      )}
      {(kind === "image" || tag === "video") && (
        <Section value="image" title="Image">
          <div className="grid grid-cols-2 gap-2">
            <SField ctx={ctx} prop="objectFit" label="Fit" type="select" options={["cover", "contain", "fill", "none", "scale-down"].map((v) => ({ value: v, label: v }))} />
            <SField ctx={ctx} prop="objectPosition" label="Position" type="select" options={["center", "top", "bottom", "left", "right"].map((v) => ({ value: v, label: v }))} />
            <SField ctx={ctx} prop="aspectRatio" label="Aspect ratio" type="select" options={["auto", "1 / 1", "4 / 3", "16 / 9", "3 / 4"].map((v) => ({ value: v, label: v }))} />
            <SField ctx={ctx} prop="filter" label="Filter" type="select" options={["none", "grayscale(1)", "brightness(0.8)", "saturate(1.3)", "blur(2px)"].map((v) => ({ value: v, label: v }))} />
          </div>
        </Section>
      )}
      <Section value="background" title="Background">
        <SField ctx={ctx} prop="backgroundColor" label="Background color" type="color" />
        <BgImage ctx={ctx} />
        <div className="grid grid-cols-2 gap-2">
          <SField ctx={ctx} prop="backgroundSize" label="Size" type="select" options={["cover", "contain", "auto"].map((v) => ({ value: v, label: v }))} />
          <SField ctx={ctx} prop="backgroundPosition" label="Position" type="select" options={["center", "top", "bottom", "left", "right"].map((v) => ({ value: v, label: v }))} />
        </div>
      </Section>
      <Section value="border" title="Border">
        <div className="grid grid-cols-2 gap-2">
          <SField ctx={ctx} prop="borderWidth" label="Width" />
          <SField ctx={ctx} prop="borderStyle" label="Style" type="select" options={["none", "solid", "dashed", "dotted"].map((v) => ({ value: v, label: v }))} />
          <SField ctx={ctx} prop="borderRadius" label="Radius" />
        </div>
        <SField ctx={ctx} prop="borderColor" label="Border color" type="color" />
      </Section>
      <Section value="effects" title="Effects">
        <SField ctx={ctx} prop="boxShadow" label="Shadow" type="select" options={SHADOWS} />
        <SField ctx={ctx} prop="opacity" label="Opacity (0-1)" />
        <SField ctx={ctx} prop="transform" label="Transform" type="select" options={["none", "scale(1.03)", "scale(1.05)", "translateY(-3px)", "rotate(-2deg)"].map((v) => ({ value: v, label: v }))} />
        <SField ctx={ctx} prop="transition" label="Transition" type="select" options={["none", "all .2s ease", "all .4s ease"].map((v) => ({ value: v, label: v }))} />
      </Section>
      <Section value="position" title="Position">
        <div className="grid grid-cols-2 gap-2">
          <SField ctx={ctx} prop="position" label="Position" type="select" options={["static", "relative", "absolute", "sticky", "fixed"].map((v) => ({ value: v, label: v }))} />
          <SField ctx={ctx} prop="zIndex" label="Layer (z-index)" />
          <SField ctx={ctx} prop="top" label="Top" />
          <SField ctx={ctx} prop="left" label="Left" />
          <SField ctx={ctx} prop="right" label="Right" />
          <SField ctx={ctx} prop="bottom" label="Bottom" />
          <SField ctx={ctx} prop="overflow" label="Overflow" type="select" options={["visible", "hidden", "auto"].map((v) => ({ value: v, label: v }))} />
        </div>
      </Section>
    </Accordion>
  );
}

function LangFields({ label, value, onChange, multiline, readOnly, testId, current }: { label: string; value: Partial<Record<Lang, string>>; onChange: (l: Lang, v: string) => void; multiline?: boolean; readOnly?: boolean; testId?: string; current: Lang }) {
  const C = multiline ? Textarea : TextInput;
  const extra = multiline ? { autosize: true, minRows: 2, maxRows: 8 } : {};
  return (
    <div className="flex flex-col gap-1">
      {(["en", "ar"] as Lang[]).map((l) => (
        <C
          key={l}
          {...extra}
          size="xs"
          label={`${label} · ${l === "en" ? "English" : "العربية"}${l === current ? " (shown)" : ""}`}
          value={value[l] ?? ""}
          dir={l === "ar" ? "rtl" : "ltr"}
          onChange={(e) => onChange(l, e.currentTarget.value)}
          disabled={readOnly}
          data-testid={testId ? `${testId}-${l}` : undefined}
        />
      ))}
    </div>
  );
}

/** Content of an existing element: text, image, link. */
export function ContentControls({ info, ctx, lang }: { info: ElementInfo; ctx: Ctx; lang: Lang }) {
  const el: ElOverride = getEl(ctx.config, ctx.scope, ctx.elKey);
  const [pick, setPick] = useState<"src" | "mobileSrc" | null>(null);
  const update = (fn: (e: ElOverride) => ElOverride, coalesce?: string) => ctx.onChange(setEl(ctx.config, ctx.scope, ctx.elKey, fn), coalesce ? { coalesce } : undefined);
  const textVal: Partial<Record<Lang, string>> = { ...(el.text || {}) };
  if (textVal[lang] === undefined && info.text !== null) textVal[lang] = info.text;
  const isImg = info.kind === "image" || info.tag === "video";
  const isLink = info.tag === "a" || info.kind === "button" || info.kind === "link";
  return (
    <div className="flex flex-col gap-3" data-testid="content-controls">
      {info.text !== null && (
        <LangFields
          label="Text"
          current={lang}
          multiline={(info.text || "").length > 60 || info.kind === "text"}
          value={textVal}
          readOnly={ctx.readOnly}
          testId="content-text"
          onChange={(l, v) => update((e) => ({ ...e, text: { ...(e.text || {}), [l]: v } }), `${ctx.elKey}:text:${l}`)}
        />
      )}
      {info.text === null && !isImg && info.kind !== "icon" && (
        <p className="text-xs text-gray-500">This element contains other elements - select an inner element to edit its text.</p>
      )}
      {isImg && (
        <>
          <div className="flex items-center gap-2">
            <div className="h-14 w-20 overflow-hidden rounded border bg-gray-50">{(el.attrs?.src || info.attrs.src) && <img src={el.attrs?.src || info.attrs.src} alt="" className="h-full w-full object-cover" />}</div>
            {!ctx.readOnly && (
              <div className="flex flex-col gap-1">
                <Button size="compact-xs" variant="light" onClick={() => setPick("src")} data-testid="replace-image">
                  Replace image
                </Button>
                {el.attrs?.src && (
                  <Button size="compact-xs" variant="subtle" color="red" onClick={() => update((e) => ({ ...e, attrs: { ...(e.attrs || {}), src: undefined } }))}>
                    Use original
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span>Mobile image {el.attrs?.mobileSrc ? "· set" : "· same as desktop"}</span>
            {!ctx.readOnly && (
              <Button size="compact-xs" variant="subtle" onClick={() => (el.attrs?.mobileSrc ? update((e) => ({ ...e, attrs: { ...(e.attrs || {}), mobileSrc: undefined } })) : setPick("mobileSrc"))}>
                {el.attrs?.mobileSrc ? "Remove" : "Choose"}
              </Button>
            )}
          </div>
          <LangFields label="Alt text" current={lang} value={{ ...(info.attrs.alt !== undefined ? { [lang]: info.attrs.alt } : {}), ...(el.attrs?.alt || {}) }} readOnly={ctx.readOnly} onChange={(l, v) => update((e) => ({ ...e, attrs: { ...(e.attrs || {}), alt: { ...(e.attrs?.alt || {}), [l]: v } } }), `${ctx.elKey}:alt:${l}`)} />
          <MediaPicker opened={!!pick} onClose={() => setPick(null)} kind={info.tag === "video" ? "video" : "image"} onPick={(m) => update((e) => ({ ...e, attrs: { ...(e.attrs || {}), [pick as string]: m.url } }))} />
        </>
      )}
      {isLink && (
        <>
          <TextInput size="xs" label="Link" placeholder={info.attrs.href} value={el.attrs?.href || ""} dir="ltr" disabled={ctx.readOnly} onChange={(e) => {
            const v = e.currentTarget.value;
            update((x) => ({ ...x, attrs: { ...(x.attrs || {}), href: v } }), `${ctx.elKey}:href`);
          }} description="/contact (page) · https://… · tel:… · #section" data-testid="content-href" />
          <Switch size="xs" label="Open in a new tab" checked={(el.attrs?.target || info.attrs.target) === "_blank"} disabled={ctx.readOnly} onChange={(e) => {
            const v = e.currentTarget.checked ? "_blank" : "_self";
            update((x) => ({ ...x, attrs: { ...(x.attrs || {}), target: v } }));
          }} />
        </>
      )}
    </div>
  );
}

/** Content of an element added in the editor (its own fields per type). */
export function NodeControls({ nodeId, config, onChange, readOnly, canCode, lang }: { nodeId: string; config: VisualConfig; onChange: (c: VisualConfig, o?: { coalesce?: string }) => void; readOnly: boolean; canCode: boolean; lang: Lang }) {
  const node = config.nodes[nodeId];
  const [pick, setPick] = useState(false);
  if (!node) return null;
  const p = node.props as Record<string, unknown>;
  const set = (patch: Record<string, unknown>, coalesce?: string) => {
    const next = JSON.parse(JSON.stringify(config)) as VisualConfig;
    next.nodes[nodeId].props = { ...next.nodes[nodeId].props, ...patch };
    onChange(next, coalesce ? { coalesce: `${nodeId}:${coalesce}` } : undefined);
  };
  const loc = (k: string) => (p[k] as Partial<Record<Lang, string>>) || {};
  return (
    <div className="flex flex-col gap-3" data-testid="node-controls">
      {node.type === "heading" && (
        <>
          <SegmentedControl size="xs" value={String(p.level || 2)} onChange={(v) => set({ level: Number(v) })} data={["2", "3", "4"].map((v) => ({ value: v, label: `H${v}` }))} disabled={readOnly} />
          <LangFields label="Heading" current={lang} value={loc("text")} readOnly={readOnly} testId="node-text" onChange={(l, v) => set({ text: { ...loc("text"), [l]: v } }, `text:${l}`)} />
        </>
      )}
      {node.type === "text" && <LangFields label="Text" multiline current={lang} value={loc("text")} readOnly={readOnly} testId="node-text" onChange={(l, v) => set({ text: { ...loc("text"), [l]: v } }, `text:${l}`)} />}
      {node.type === "image" && (
        <>
          <Button size="xs" variant="light" onClick={() => setPick(true)} disabled={readOnly} data-testid="node-image">
            {p.src ? "Replace image" : "Choose image"}
          </Button>
          <LangFields label="Alt text" current={lang} value={loc("alt")} readOnly={readOnly} onChange={(l, v) => set({ alt: { ...loc("alt"), [l]: v } }, `alt:${l}`)} />
          <MediaPicker opened={pick} onClose={() => setPick(false)} onPick={(m) => set({ src: m.url })} />
        </>
      )}
      {node.type === "video" && <TextInput size="xs" label="Video URL (YouTube, Vimeo or a file)" value={String(p.url || "")} onChange={(e) => set({ url: e.currentTarget.value }, "url")} dir="ltr" disabled={readOnly} />}
      {node.type === "button" && (
        <>
          <LangFields label="Label" current={lang} value={loc("label")} readOnly={readOnly} testId="node-label" onChange={(l, v) => set({ label: { ...loc("label"), [l]: v } }, `label:${l}`)} />
          <TextInput size="xs" label="Link" value={String(p.href || "")} onChange={(e) => set({ href: e.currentTarget.value }, "href")} dir="ltr" disabled={readOnly} />
          <Select size="xs" label="Style" value={String(p.style || "primary")} onChange={(v) => set({ style: v || "primary" })} data={[{ value: "primary", label: "Primary" }, { value: "secondary", label: "Secondary" }, { value: "whatsapp", label: "WhatsApp" }]} disabled={readOnly} />
          <Switch size="xs" label="Open in a new tab" checked={p.target === "_blank"} onChange={(e) => set({ target: e.currentTarget.checked ? "_blank" : "_self" })} disabled={readOnly} />
        </>
      )}
      {node.type === "icon" && (
        <Select size="xs" label="Icon" value={String(p.name || "sun")} onChange={(v) => set({ name: v || "sun" })} data={["sun", "bolt", "leaf", "check", "phone", "mail", "star", "arrow", "water", "factory"]} disabled={readOnly} />
      )}
      {node.type === "box" && (
        <div className="grid grid-cols-2 gap-2">
          <Select size="xs" label="Type" value={String(p.variant || "stack")} onChange={(v) => set({ variant: v || "stack" })} data={["stack", "container", "section", "columns", "grid", "card", "cta"]} disabled={readOnly} />
          <NumberInput size="xs" label="Columns" min={1} max={6} value={Number(p.columns || 2)} onChange={(v) => set({ columns: Number(v) || 1 })} disabled={readOnly} />
        </div>
      )}
      {node.type === "spacer" && <TextInput size="xs" label="Height" value={String(p.height || "40px")} onChange={(e) => set({ height: e.currentTarget.value }, "height")} dir="ltr" disabled={readOnly} />}
      {node.type === "list" && (
        <ItemsEditor
          items={(p.items as Partial<Record<Lang, string>>[]) || []}
          readOnly={readOnly}
          render={(it, update) => <LangFields label="Point" current={lang} value={it} onChange={(l, v) => update({ ...it, [l]: v })} readOnly={readOnly} />}
          blank={{ en: "", ar: "" }}
          onChange={(items) => set({ items })}
        />
      )}
      {node.type === "faq" && (
        <ItemsEditor
          items={(p.items as { q: Partial<Record<Lang, string>>; a: Partial<Record<Lang, string>> }[]) || []}
          readOnly={readOnly}
          blank={{ q: { en: "", ar: "" }, a: { en: "", ar: "" } }}
          render={(it, update) => (
            <>
              <LangFields label="Question" current={lang} value={it.q} onChange={(l, v) => update({ ...it, q: { ...it.q, [l]: v } })} readOnly={readOnly} />
              <LangFields label="Answer" multiline current={lang} value={it.a} onChange={(l, v) => update({ ...it, a: { ...it.a, [l]: v } })} readOnly={readOnly} />
            </>
          )}
          onChange={(items) => set({ items })}
        />
      )}
      {node.type === "html" && (
        <Textarea
          size="xs"
          label="HTML (administrators only)"
          description="Inserted as written. Scripts inside do not run - use Custom Code for scripts."
          value={String(p.html || "")}
          onChange={(e) => set({ html: e.currentTarget.value }, "html")}
          autosize
          minRows={6}
          dir="ltr"
          styles={{ input: { fontFamily: "ui-monospace, monospace", fontSize: 12 } }}
          disabled={readOnly || !canCode}
        />
      )}
    </div>
  );
}

function ItemsEditor<T>({ items, render, onChange, blank, readOnly }: { items: T[]; render: (it: T, update: (v: T) => void) => ReactNode; onChange: (items: T[]) => void; blank: T; readOnly: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((it, i) => (
        <div key={i} className="rounded border border-gray-100 p-2">
          <div className="mb-1 flex justify-end">
            {!readOnly && (
              <ActionIcon size="xs" variant="subtle" color="red" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="remove">
                ✕
              </ActionIcon>
            )}
          </div>
          {render(it, (v) => onChange(items.map((x, j) => (j === i ? v : x))))}
        </div>
      ))}
      {!readOnly && (
        <Button size="compact-xs" variant="light" onClick={() => onChange([...items, JSON.parse(JSON.stringify(blank))])}>
          Add item
        </Button>
      )}
    </div>
  );
}

export function VisibilityControls({ ctx }: { ctx: Ctx }) {
  const el = getEl(ctx.config, ctx.scope, ctx.elKey);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium">Show on</span>
      <div className="flex gap-3">
        {(["desktop", "tablet", "mobile"] as Device[]).map((d) => (
          <Checkbox
            key={d}
            size="xs"
            label={d}
            checked={!el.hidden?.[d]}
            disabled={ctx.readOnly}
            data-testid={`visible-${d}`}
            onChange={(e) => {
              const show = e.currentTarget.checked;
              ctx.onChange(setEl(ctx.config, ctx.scope, ctx.elKey, (x) => ({ ...x, hidden: { ...(x.hidden || {}), [d]: show ? undefined : true } })));
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function ResponsiveHint({ device }: { device: Device }) {
  const { translate } = useLanguage();
  return (
    <p className="text-[11px] leading-snug text-gray-500">
      {translate(
        `Sizes, spacing and layout are saved for ${device}; colors, fonts and borders apply on every device.`,
        `تُحفظ الأحجام والمسافات والتخطيط لـ ${device}؛ أما الألوان والخطوط والحدود فتنطبق على كل الأجهزة.`,
      )}
    </p>
  );
}

export { RESPONSIVE };
export type { Ctx };
