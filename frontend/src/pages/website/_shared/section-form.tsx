import { ReactNode, useState } from "react";
import { ActionIcon, Alert, Button, ColorInput, NumberInput, SegmentedControl, Select, Switch, Textarea, TextInput, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { SectionField, SectionRegistry, SectionSettings, SectionTypeDef, Spacing, WebsiteImageRef } from "@/types/website";
import { ImageField, MediaPicker } from "./media-picker";

// Website Management - the section editor. Every section type gets its own form, generated from
// that type's field list in the backend registry (GET /website/section-types) - the same list the
// server validates against - so each type shows exactly its own fields (a Hero has heading,
// buttons and background media; a Statistics block has numbered counters; an FAQ has questions).
// Bilingual fields show English and Arabic side by side; Arabic inputs are right-to-left.

type Content = Record<string, unknown>;

const GROUP_LABELS: Record<string, { en: string; ar: string }> = {
  content: { en: "Content", ar: "المحتوى" },
  media: { en: "Media", ar: "الوسائط" },
  buttons: { en: "Buttons", ar: "الأزرار" },
  layout: { en: "Layout", ar: "التخطيط" },
};

const OPTION_LABELS: Record<string, { en: string; ar: string }> = {
  start: { en: "Start", ar: "البداية" },
  center: { en: "Center", ar: "الوسط" },
  end: { en: "End", ar: "النهاية" },
  primary: { en: "Primary", ar: "أساسي" },
  secondary: { en: "Secondary", ar: "ثانوي" },
  outline: { en: "Outline", ar: "إطار" },
  whatsapp: { en: "WhatsApp", ar: "واتساب" },
  auto: { en: "Fit content", ar: "حسب المحتوى" },
  small: { en: "Small", ar: "صغير" },
  medium: { en: "Medium", ar: "متوسط" },
  large: { en: "Large", ar: "كبير" },
  full: { en: "Full screen", ar: "ملء الشاشة" },
  narrow: { en: "Narrow", ar: "ضيق" },
  normal: { en: "Normal", ar: "عادي" },
  wide: { en: "Wide", ar: "عريض" },
  grid: { en: "Grid", ar: "شبكة" },
  carousel: { en: "Scrolling row", ar: "شريط متحرك" },
  phone: { en: "Phone", ar: "هاتف" },
  email: { en: "Email", ar: "بريد" },
  address: { en: "Address", ar: "عنوان" },
  hours: { en: "Opening hours", ar: "ساعات العمل" },
  other: { en: "Other", ar: "أخرى" },
};

const isBlank = (v: unknown) => v === undefined || v === null || v === "";

/** Fills defaults for a new section of this type (used when adding one). */
export function defaultContent(def: SectionTypeDef): Content {
  const out: Content = {};
  for (const f of def.fields) {
    if (f.default !== undefined) out[f.key] = f.default;
    if (f.kind === "list") out[f.key] = [];
  }
  return out;
}

/** Client-side required-field check (the server re-validates everything). */
export function missingRequired(def: SectionTypeDef, content: Content): string[] {
  const missing: string[] = [];
  const walk = (fields: SectionField[], value: Content, prefix: string) => {
    for (const f of fields) {
      const v = value?.[f.key];
      if (f.kind === "list") {
        (Array.isArray(v) ? (v as Content[]) : []).forEach((item, i) => walk(f.itemFields || [], item, `${prefix}${f.labelEn || f.key} ${i + 1} › `));
        continue;
      }
      if (!f.required) continue;
      const empty = f.kind === "image" || f.kind === "video" ? isBlank((v as { url?: string })?.url ?? v) : isBlank(v);
      if (empty) missing.push(`${prefix}${f.labelEn || f.key}`);
    }
  };
  walk(def.fields, content, "");
  return missing;
}

export function SectionForm({ def, value, onChange, readOnly }: { def: SectionTypeDef; value: Content; onChange: (v: Content) => void; readOnly?: boolean }) {
  const { translate } = useLanguage();
  const groups = new Map<string, SectionField[]>();
  for (const f of def.fields) {
    const g = f.group || "content";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(f);
  }
  return (
    <div className="flex flex-col gap-5" data-testid={`section-form-${def.type}`}>
      {[...groups.entries()].map(([g, fields]) => (
        <fieldset key={g} className="flex flex-col gap-3">
          {groups.size > 1 && <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{translate(GROUP_LABELS[g]?.en || g, GROUP_LABELS[g]?.ar || g)}</legend>}
          <FieldList fields={fields} value={value} onChange={onChange} readOnly={readOnly} />
        </fieldset>
      ))}
    </div>
  );
}

function FieldList({ fields, value, onChange, readOnly }: { fields: SectionField[]; value: Content; onChange: (v: Content) => void; readOnly?: boolean }) {
  const set = (patch: Content) => onChange({ ...value, ...patch });
  return (
    <>
      {fields.map((f) => (
        <FieldEditor key={f.key} field={f} value={value} set={set} readOnly={readOnly} />
      ))}
    </>
  );
}

function label(f: SectionField) {
  return f.labelEn || f.key;
}

function FieldEditor({ field: f, value, set, readOnly }: { field: SectionField; value: Content; set: (p: Content) => void; readOnly?: boolean }) {
  const { translate } = useLanguage();
  const v = value[f.key];
  const req = !!f.required;

  switch (f.kind) {
    case "text":
    case "richtext": {
      const Input = f.kind === "richtext" ? Textarea : TextInput;
      const extra = f.kind === "richtext" ? { autosize: true, minRows: 2, maxRows: 10 } : {};
      const counter = (s: unknown) => (f.maxLength ? `${String(s ?? "").length}/${f.maxLength}` : undefined);
      if (!f.pairKey) {
        return (
          <Input
            {...extra}
            label={label(f)}
            required={req}
            value={String(v ?? "")}
            maxLength={f.maxLength}
            onChange={(e) => set({ [f.key]: e.currentTarget.value })}
            disabled={readOnly}
            description={counter(v)}
            data-field={f.key}
          />
        );
      }
      const pv = value[f.pairKey];
      return (
        <div className="grid gap-2 md:grid-cols-2">
          <Input
            {...extra}
            label={`${label(f)} · English`}
            required={req}
            value={String(v ?? "")}
            maxLength={f.maxLength}
            onChange={(e) => set({ [f.key]: e.currentTarget.value })}
            disabled={readOnly}
            dir="ltr"
            description={counter(v)}
            data-field={f.key}
          />
          <Input
            {...extra}
            label={`${label(f)} · العربية`}
            value={String(pv ?? "")}
            maxLength={f.maxLength}
            onChange={(e) => set({ [f.pairKey!]: e.currentTarget.value })}
            disabled={readOnly}
            dir="rtl"
            description={counter(pv)}
            data-field={f.pairKey}
          />
        </div>
      );
    }
    case "html":
      return (
        <div className="flex flex-col gap-2">
          <Alert color="orange" variant="light">
            {translate(
              "Custom HTML is inserted into the public page exactly as written. It is never run inside the dashboard. Only add code from a source you trust.",
              "يُدرج كود HTML المخصص في الصفحة العامة كما هو. لا يُشغَّل داخل لوحة التحكم. لا تضف إلا كودًا من مصدر موثوق.",
            )}
          </Alert>
          <Textarea
            label={label(f)}
            required={req}
            value={String(v ?? "")}
            onChange={(e) => set({ [f.key]: e.currentTarget.value })}
            autosize
            minRows={8}
            maxRows={24}
            disabled={readOnly}
            dir="ltr"
            styles={{ input: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 } }}
            maxLength={f.maxLength}
            data-field={f.key}
          />
        </div>
      );
    case "image":
      return <ImageField label={label(f)} required={req} value={v as WebsiteImageRef} onChange={(img) => set({ [f.key]: img })} disabled={readOnly} testId={`field-${f.key}`} />;
    case "video":
      return <VideoField field={f} value={v} onChange={(nv) => set({ [f.key]: nv })} readOnly={readOnly} />;
    case "url":
      return (
        <TextInput
          label={label(f)}
          required={req}
          value={String(v ?? "")}
          onChange={(e) => set({ [f.key]: e.currentTarget.value })}
          disabled={readOnly}
          dir="ltr"
          placeholder="/contact · https://… · #section · tel:+20…"
          data-field={f.key}
        />
      );
    case "select":
      return (
        <Select
          label={label(f)}
          required={req}
          value={(v as string) ?? (f.default as string) ?? null}
          onChange={(nv) => set({ [f.key]: nv ?? undefined })}
          data={(f.options || []).map((o) => ({ value: o, label: translate(OPTION_LABELS[o]?.en || o, OPTION_LABELS[o]?.ar || o) }))}
          clearable={!req}
          disabled={readOnly}
          data-field={f.key}
        />
      );
    case "number":
      return (
        <NumberInput
          label={label(f)}
          required={req}
          value={typeof v === "number" ? v : v === undefined ? (typeof f.default === "number" ? f.default : "") : Number(v)}
          onChange={(nv) => set({ [f.key]: nv === "" ? undefined : Number(nv) })}
          min={f.min}
          max={f.max}
          disabled={readOnly}
          data-field={f.key}
        />
      );
    case "boolean":
      return <Switch label={label(f)} checked={v === undefined ? !!f.default : !!v} onChange={(e) => set({ [f.key]: e.currentTarget.checked })} disabled={readOnly} />;
    case "color":
      return <ColorInput label={label(f)} value={String(v ?? "")} onChange={(nv) => set({ [f.key]: nv || undefined })} disabled={readOnly} format="hex" />;
    case "list":
      return <ListEditor field={f} items={Array.isArray(v) ? (v as Content[]) : []} onChange={(items) => set({ [f.key]: items })} readOnly={readOnly} />;
    default:
      return null;
  }
}

function VideoField({ field: f, value, onChange, readOnly }: { field: SectionField; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean }) {
  const { translate } = useLanguage();
  const [open, setOpen] = useState(false);
  const url = typeof value === "string" ? value : (value as { url?: string } | null)?.url || "";
  return (
    <div className="flex flex-col gap-1">
      <TextInput
        label={label(f)}
        required={!!f.required}
        value={url}
        onChange={(e) => onChange(e.currentTarget.value || null)}
        placeholder="https://www.youtube.com/watch?v=…"
        dir="ltr"
        disabled={readOnly}
        rightSectionWidth={110}
        rightSection={
          !readOnly && (
            <Button size="compact-xs" variant="light" onClick={() => setOpen(true)}>
              {translate("Library", "المكتبة")}
            </Button>
          )
        }
      />
      <MediaPicker opened={open} onClose={() => setOpen(false)} kind="video" onPick={(m) => onChange({ url: m.url, publicId: m.publicId })} />
    </div>
  );
}

function itemTitle(fields: SectionField[], item: Content, i: number) {
  const first = fields.find((f) => (f.kind === "text" || f.kind === "richtext") && !isBlank(item[f.key]));
  const pair = fields.find((f) => f.pairKey && !isBlank(item[f.pairKey!]));
  const s = first ? String(item[first.key]) : pair ? String(item[pair.pairKey!]) : "";
  return s ? `${i + 1}. ${s.slice(0, 60)}` : `${i + 1}.`;
}

function ListEditor({ field: f, items, onChange, readOnly }: { field: SectionField; items: Content[]; onChange: (items: Content[]) => void; readOnly?: boolean }) {
  const { translate } = useLanguage();
  const [open, setOpen] = useState<number | null>(items.length ? null : null);
  const max = f.maxItems ?? 50;
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    setOpen(j);
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-gray-200 p-3" data-testid={`list-${f.key}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          {label(f)} <span className="text-xs text-gray-500">({items.length}/{max})</span>
        </span>
        {!readOnly && (
          <Button
            size="xs"
            variant="light"
            disabled={items.length >= max}
            onClick={() => {
              const blank: Content = {};
              for (const it of f.itemFields || []) if (it.default !== undefined) blank[it.key] = it.default;
              onChange([...items, blank]);
              setOpen(items.length);
            }}
            data-testid={`list-add-${f.key}`}
          >
            {translate("Add item", "إضافة عنصر")}
          </Button>
        )}
      </div>
      {items.length === 0 && <p className="text-xs text-gray-500">{translate("No items yet.", "لا توجد عناصر بعد.")}</p>}
      {items.map((item, i) => (
        <div key={i} className="rounded border border-gray-100 bg-gray-50">
          <div className="flex items-center gap-1 px-2 py-1">
            <button type="button" className="flex-1 truncate py-1 text-start text-sm" onClick={() => setOpen(open === i ? null : i)}>
              {itemTitle(f.itemFields || [], item, i)}
            </button>
            {!readOnly && (
              <>
                <IconBtn label={translate("Move up", "تحريك لأعلى")} onClick={() => move(i, -1)} disabled={i === 0}>
                  ↑
                </IconBtn>
                <IconBtn label={translate("Move down", "تحريك لأسفل")} onClick={() => move(i, 1)} disabled={i === items.length - 1}>
                  ↓
                </IconBtn>
                <IconBtn
                  label={translate("Duplicate", "تكرار")}
                  onClick={() => {
                    if (items.length >= max) return;
                    const next = [...items];
                    next.splice(i + 1, 0, structuredClone(item));
                    onChange(next);
                  }}
                >
                  ⧉
                </IconBtn>
                <IconBtn label={translate("Remove", "حذف")} color="red" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  ✕
                </IconBtn>
              </>
            )}
          </div>
          {open === i && (
            <div className="flex flex-col gap-3 border-t border-gray-100 bg-white p-3">
              <FieldList fields={f.itemFields || []} value={item} onChange={(nv) => onChange(items.map((x, j) => (j === i ? nv : x)))} readOnly={readOnly} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function IconBtn({ label: l, children, onClick, disabled, color }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean; color?: string }) {
  return (
    <Tooltip label={l} withArrow>
      <ActionIcon variant="subtle" size="sm" color={color || "gray"} onClick={onClick} disabled={disabled} aria-label={l}>
        {children}
      </ActionIcon>
    </Tooltip>
  );
}

// ---------------- section settings (presentation, same for every type) ----------------
const SPACING_LABEL: Record<Spacing, { en: string; ar: string }> = {
  none: { en: "None", ar: "بدون" },
  sm: { en: "S", ar: "ص" },
  md: { en: "M", ar: "م" },
  lg: { en: "L", ar: "ك" },
  xl: { en: "XL", ar: "ك+" },
};

export function mergeSettings(registry: SectionRegistry, s?: Partial<SectionSettings>): SectionSettings {
  const d = registry.defaultSettings;
  return {
    devices: { ...d.devices, ...(s?.devices || {}) },
    background: { ...d.background, ...(s?.background || {}) },
    spacing: { ...d.spacing, ...(s?.spacing || {}) },
    align: s?.align || d.align,
    container: s?.container || d.container,
    anchorId: s?.anchorId ?? d.anchorId,
  };
}

export function SectionSettingsForm({ registry, value, onChange, readOnly }: { registry: SectionRegistry; value: SectionSettings; onChange: (v: SectionSettings) => void; readOnly?: boolean }) {
  const { translate } = useLanguage();
  const set = (patch: Partial<SectionSettings>) => onChange({ ...value, ...patch });
  const bgLabels: Record<string, { en: string; ar: string }> = {
    none: { en: "Page default", ar: "افتراضي" },
    light: { en: "Light", ar: "فاتح" },
    brand: { en: "Brand", ar: "ألوان العلامة" },
    dark: { en: "Dark", ar: "داكن" },
    color: { en: "Custom color", ar: "لون مخصص" },
    image: { en: "Image", ar: "صورة" },
  };
  return (
    <div className="flex flex-col gap-4" data-testid="section-settings">
      <div>
        <span className="text-sm font-medium">{translate("Show on", "يظهر على")}</span>
        <div className="mt-1 flex flex-wrap gap-4">
          {(["desktop", "tablet", "mobile"] as const).map((d) => (
            <Switch
              key={d}
              label={translate({ desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" }[d], { desktop: "الكمبيوتر", tablet: "الجهاز اللوحي", mobile: "الجوال" }[d])}
              checked={value.devices[d]}
              onChange={(e) => set({ devices: { ...value.devices, [d]: e.currentTarget.checked } })}
              disabled={readOnly}
              data-testid={`device-${d}`}
            />
          ))}
        </div>
        {!value.devices.desktop && !value.devices.tablet && !value.devices.mobile && <p className="mt-1 text-xs text-orange-600">{translate("Hidden on every device.", "مخفي على كل الأجهزة.")}</p>}
      </div>
      <Select
        label={translate("Background", "الخلفية")}
        value={value.background.type}
        onChange={(v) => set({ background: { ...value.background, type: (v || "none") as SectionSettings["background"]["type"] } })}
        allowDeselect={false}
        data={registry.settings.backgroundTypes.map((b) => ({ value: b, label: translate(bgLabels[b]?.en || b, bgLabels[b]?.ar || b) }))}
        disabled={readOnly}
      />
      {value.background.type === "color" && <ColorInput label={translate("Background color", "لون الخلفية")} value={value.background.color} onChange={(c) => set({ background: { ...value.background, color: c } })} format="hex" disabled={readOnly} />}
      {value.background.type === "image" && (
        <>
          <ImageField label={translate("Background image", "صورة الخلفية")} value={value.background.image} onChange={(img) => set({ background: { ...value.background, image: img } })} disabled={readOnly} />
          <NumberInput label={translate("Dark overlay (%)", "تعتيم (%)")} min={0} max={90} value={value.background.overlay} onChange={(n) => set({ background: { ...value.background, overlay: Number(n) || 0 } })} disabled={readOnly} />
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {(["top", "bottom"] as const).map((side) => (
          <div key={side}>
            <span className="text-sm font-medium">{side === "top" ? translate("Space above", "المسافة أعلى") : translate("Space below", "المسافة أسفل")}</span>
            <SegmentedControl
              fullWidth
              size="xs"
              value={value.spacing[side]}
              onChange={(v) => set({ spacing: { ...value.spacing, [side]: v as Spacing } })}
              data={registry.settings.spacing.map((s) => ({ value: s, label: translate(SPACING_LABEL[s].en, SPACING_LABEL[s].ar) }))}
              disabled={readOnly}
            />
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label={translate("Content alignment", "محاذاة المحتوى")}
          value={value.align}
          onChange={(v) => set({ align: (v || "start") as SectionSettings["align"] })}
          allowDeselect={false}
          data={registry.settings.align.map((a) => ({ value: a, label: translate(OPTION_LABELS[a]?.en || a, OPTION_LABELS[a]?.ar || a) }))}
          disabled={readOnly}
        />
        <Select
          label={translate("Width", "العرض")}
          value={value.container}
          onChange={(v) => set({ container: (v || "normal") as SectionSettings["container"] })}
          allowDeselect={false}
          data={registry.settings.containers.map((c) => ({ value: c, label: translate(OPTION_LABELS[c]?.en || c, OPTION_LABELS[c]?.ar || c) }))}
          disabled={readOnly}
        />
      </div>
      <TextInput
        label={translate("Anchor (for #links)", "مرساة (للروابط #)")}
        description={translate("Lowercase letters, numbers and hyphens, e.g. pricing - link to it with #pricing", "حروف إنجليزية صغيرة وأرقام وشرطات، مثل pricing")}
        value={value.anchorId}
        onChange={(e) => set({ anchorId: e.currentTarget.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
        dir="ltr"
        maxLength={41}
        disabled={readOnly}
      />
    </div>
  );
}
