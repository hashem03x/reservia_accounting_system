import { useRef, useState } from "react";
import { Alert, Button, SegmentedControl, TextInput } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useWebsiteMedia from "@/hooks/useWebsiteMedia";
import { notifyError } from "@/utils/helpers/notifiers";
import Modal from "@/components/ui/modal";
import LoadingSection from "@/components/ui/sections/loading";
import { WebsiteImageRef, WebsiteMedia } from "@/types/website";
import { errorMessage, formatBytes, useWebsiteRole } from "./cms";

// Website Management - choose an image (or video) from the Media Library, or upload a new one
// right here. Returns { url, publicId, altEn, altAr } - the shape sections and settings store.

export function MediaPicker({
  opened,
  onClose,
  onPick,
  kind = "image",
}: {
  opened: boolean;
  onClose: () => void;
  onPick: (m: WebsiteMedia) => void;
  kind?: "image" | "video";
}) {
  const { language, translate } = useLanguage();
  const { can } = useWebsiteRole();
  const [q, setQ] = useState("");
  const [debounced] = useDebouncedValue(q, 250);
  const [filterKind, setFilterKind] = useState<"image" | "video">(kind);
  const { media, loading, error, uploadFiles } = useWebsiteMedia({ q: debounced, kind: filterKind });
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const created = await uploadFiles(Array.from(files));
      if (created.length === 1) {
        onPick(created[0]);
        onClose();
      }
    } catch (err) {
      notifyError({ language, message: errorMessage(err, translate("Upload failed", "فشل الرفع")) });
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={translate("Choose from the Media Library", "اختر من مكتبة الوسائط")} size="xl">
      <div className="flex flex-col gap-3" data-testid="media-picker">
        <div className="flex flex-wrap items-end gap-2">
          <TextInput className="min-w-[200px] flex-1" placeholder={translate("Search by name or alt text", "ابحث بالاسم أو النص البديل")} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
          <SegmentedControl
            value={filterKind}
            onChange={(v) => setFilterKind(v as "image" | "video")}
            data={[
              { value: "image", label: translate("Images", "صور") },
              { value: "video", label: translate("Videos", "فيديو") },
            ]}
          />
          {can("media.manage") && (
            <>
              <input
                ref={input}
                type="file"
                hidden
                multiple
                accept={filterKind === "video" ? "video/mp4,video/webm,video/quicktime" : "image/jpeg,image/png,image/webp,image/gif,image/avif,image/svg+xml"}
                onChange={(e) => upload(e.currentTarget.files)}
                data-testid="media-picker-upload"
              />
              <Button variant="light" loading={uploading} onClick={() => input.current?.click()}>
                {translate("Upload new", "رفع جديد")}
              </Button>
            </>
          )}
        </div>
        {loading ? (
          <LoadingSection message={translate("Loading media...", "جاري تحميل الوسائط...")} />
        ) : error ? (
          <Alert color="red">{error}</Alert>
        ) : media.length === 0 ? (
          <Alert color="gray" variant="light">
            {translate("No files found. Upload one to use it here.", "لا توجد ملفات. ارفع ملفًا لاستخدامه هنا.")}
          </Alert>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
            {media.map((m) => (
              <button
                key={m._id}
                type="button"
                onClick={() => {
                  onPick(m);
                  onClose();
                }}
                className="group flex flex-col overflow-hidden rounded-md border border-gray-200 text-start hover:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
                data-testid="media-picker-item"
              >
                <div className="flex aspect-video items-center justify-center bg-gray-100">
                  {m.kind === "video" ? <video src={m.url} className="h-full w-full object-cover" muted /> : <img src={m.url} alt={m.altEn || m.displayName} className="h-full w-full object-cover" loading="lazy" />}
                </div>
                <div className="p-1.5 text-xs">
                  <div className="truncate font-medium">{m.displayName || m.originalName || m.publicId}</div>
                  <div className="text-gray-500" dir="ltr">
                    {m.width && m.height ? `${m.width}×${m.height} · ` : ""}
                    {formatBytes(m.bytes)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** A compact image field: thumbnail + choose / remove. */
export function ImageField({
  label,
  value,
  onChange,
  disabled,
  required,
  description,
  testId,
}: {
  label: string;
  value: WebsiteImageRef | undefined;
  onChange: (v: WebsiteImageRef) => void;
  disabled?: boolean;
  required?: boolean;
  description?: string;
  testId?: string;
}) {
  const { translate } = useLanguage();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <span className="text-sm font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {description && <span className="text-xs text-gray-500">{description}</span>}
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-24 items-center justify-center overflow-hidden rounded border border-gray-200 bg-gray-50">
          {value?.url ? <img src={value.url} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-gray-400">{translate("None", "لا يوجد")}</span>}
        </div>
        {!disabled && (
          <div className="flex gap-2">
            <Button size="xs" variant="light" onClick={() => setOpen(true)}>
              {value?.url ? translate("Change", "تغيير") : translate("Choose image", "اختر صورة")}
            </Button>
            {value?.url && (
              <Button size="xs" variant="subtle" color="red" onClick={() => onChange(null)}>
                {translate("Remove", "إزالة")}
              </Button>
            )}
          </div>
        )}
      </div>
      <MediaPicker opened={open} onClose={() => setOpen(false)} onPick={(m) => onChange({ url: m.url, publicId: m.publicId, altEn: m.altEn || undefined, altAr: m.altAr || undefined })} />
    </div>
  );
}
