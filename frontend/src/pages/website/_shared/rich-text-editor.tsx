import { useEffect, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TiptapImage from "@tiptap/extension-image";
import type { Level } from "@tiptap/extension-heading";
import { ActionIcon, Divider, Select, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { WebsiteImageRef } from "@/types/website";
import { MediaPicker } from "./media-picker";

// Website Management - Blog Management's rich-text body editor. The one real inline-formatting
// editor in this codebase (TipTap/ProseMirror) - nothing like it exists elsewhere, because nothing
// else needs genuine inline bold/italic/links-within-a-sentence; every other CMS text field is
// plain text (the Section Builder's "richtext" field kind is a plain Textarea) or admin-only raw
// Custom Code (access-gated, not an authoring surface). `value`/`onChange` carry raw HTML strings;
// the backend sanitizes on save (server/utils/website/htmlSanitizer.js) - this editor's own job is
// just to produce clean-ish HTML through TipTap's own schema, not to be the security boundary.

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

function Toolbar({ editor, onInsertImage }: { editor: Editor; onInsertImage: () => void }) {
  const { translate } = useLanguage();
  const headingValue = HEADING_LEVELS.find((l) => editor.isActive("heading", { level: l }));

  const setHeading = (v: string | null) => {
    const level = v ? Number(v) : 0;
    if (!level) editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
  };

  const toggleLink = () => {
    const current = editor.getAttributes("link").href as string | undefined;
    // eslint-disable-next-line no-alert
    const url = window.prompt(translate("Link URL (leave empty to remove)", "رابط الصفحة (اتركه فارغًا للإزالة)"), current || "https://");
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const Btn = ({ onClick, active, label, children }: { onClick: () => void; active?: boolean; label: string; children: React.ReactNode }) => (
    <Tooltip label={label}>
      <ActionIcon variant={active ? "filled" : "subtle"} color={active ? "teal" : "gray"} onClick={onClick} aria-label={label}>
        {children}
      </ActionIcon>
    </Tooltip>
  );

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-gray-50 p-1.5" data-testid="rte-toolbar">
      <Select
        size="xs"
        w={150}
        value={headingValue ? String(headingValue) : "0"}
        onChange={setHeading}
        allowDeselect={false}
        data={[
          { value: "0", label: translate("Paragraph", "فقرة") },
          ...HEADING_LEVELS.map((l) => ({ value: String(l), label: `H${l}` })),
        ]}
        data-testid="rte-heading"
      />
      <Divider orientation="vertical" />
      <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} label={translate("Bold", "عريض")}>
        <strong>B</strong>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} label={translate("Italic", "مائل")}>
        <em>I</em>
      </Btn>
      <Divider orientation="vertical" />
      <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} label={translate("Bullet list", "قائمة نقطية")}>
        •
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} label={translate("Numbered list", "قائمة مرقمة")}>
        1.
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} label={translate("Blockquote", "اقتباس")}>
        ❝
      </Btn>
      <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()} label={translate("Separator", "خط فاصل")}>
        ―
      </Btn>
      <Divider orientation="vertical" />
      <Btn onClick={toggleLink} active={editor.isActive("link")} label={translate("Link", "رابط")}>
        🔗
      </Btn>
      <Btn onClick={onInsertImage} label={translate("Insert image", "إدراج صورة")}>
        🖼
      </Btn>
    </div>
  );
}

export default function RichTextEditor({
  value,
  onChange,
  dir = "ltr",
  disabled,
  testId,
}: {
  value: string;
  onChange: (html: string) => void;
  dir?: "ltr" | "rtl";
  disabled?: boolean;
  testId?: string;
}) {
  const [mediaOpen, setMediaOpen] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: HEADING_LEVELS as unknown as Level[] }, link: { openOnClick: false, autolink: true } }),
      TiptapImage.configure({ inline: false }),
    ],
    content: value || "",
    editable: !disabled,
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // The language tab switch (En/Ar body) swaps `value` out from under the SAME editor instance -
  // keep the document in sync without fighting the user's own typing (only when genuinely external).
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== (value || "")) editor.commands.setContent(value || "", { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) return null;

  return (
    <div className="overflow-hidden rounded-md border border-gray-200" data-testid={testId}>
      {!disabled && <Toolbar editor={editor} onInsertImage={() => setMediaOpen(true)} />}
      <EditorContent editor={editor} dir={dir} className="rte-content min-h-[220px] max-h-[520px] overflow-y-auto px-3 py-2 text-sm [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[200px]" />
      <MediaPicker
        opened={mediaOpen}
        onClose={() => setMediaOpen(false)}
        onPick={(m) => {
          const ref: WebsiteImageRef = { url: m.url, publicId: m.publicId, altEn: m.altEn || undefined, altAr: m.altAr || undefined };
          if (ref?.url) editor.chain().focus().setImage({ src: ref.url, alt: ref.altEn || ref.altAr || "" }).run();
        }}
      />
    </div>
  );
}
