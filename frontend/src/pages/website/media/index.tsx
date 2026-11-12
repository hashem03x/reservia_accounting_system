import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Drawer, Select, TextInput } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useWebsiteMedia, { MediaQuery } from "@/hooks/useWebsiteMedia";
import { notifyError, notifySuccess } from "@/utils/helpers/notifiers";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import { WebsiteMedia } from "@/types/website";
import { formatCairoDateTime } from "@/pages/crm/_shared/business-date";
import { errorMessage, formatBytes, useCmsApi, useConfirm, useWebsiteRole } from "../_shared/cms";

// Website Management - Media Library. Images and videos are stored in Cloudinary (the database
// keeps only their details and address). Search, filter by type/folder/usage, rename, alt text in
// both languages, folders, copy URL, replace the file everywhere it is used in drafts, and delete -
// which the server refuses while the file is used on the live website.

type Usage = { total: number; live: number; draft: number; uses: { scope: "live" | "draft"; where: string; pageSlug: string | null }[] };

export default function WebsiteMediaLibrary() {
  const { language, translate } = useLanguage();
  const { can } = useWebsiteRole();
  const canManage = can("media.manage");
  const confirm = useConfirm();
  const { call } = useCmsApi();
  useDocumentTitle(`${translate("Media Library", "مكتبة الوسائط")} | Reservia Website`);

  const [q, setQ] = useState("");
  const [debouncedQ] = useDebouncedValue(q, 300);
  const [kind, setKind] = useState<MediaQuery["kind"]>("");
  const [folder, setFolder] = useState("");
  const [usage, setUsage] = useState<MediaQuery["usage"]>("");
  const [sort, setSort] = useState<MediaQuery["sort"]>("newest");
  const { media, loading, error, reload, uploadFiles, updateMedia, replaceMedia, deleteMedia } = useWebsiteMedia({ q: debouncedQ, kind, folder, usage, sort });
  const [folders, setFolders] = useState<{ name: string; count: number }[]>([]);
  const [stats, setStats] = useState<{ files: number; bytes: number; images: number; videos: number } | null>(null);
  const [selected, setSelected] = useState<WebsiteMedia | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadFolder, setUploadFolder] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function loadMeta() {
    const [f, s] = await Promise.all([call<{ name: string; count: number }[]>({ url: "website/media/folders" }, { silent: true }), call<{ files: number; bytes: number; images: number; videos: number }>({ url: "website/media/stats" }, { silent: true })]);
    if (f) setFolders(f.data);
    if (s) setStats(s.data);
  }
  useEffect(() => {
    loadMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.length]);

  async function upload(files: FileList | File[] | null) {
    const list = Array.from(files || []);
    if (!list.length) return;
    setUploading(true);
    try {
      const created = await uploadFiles(list, { folder: uploadFolder || folder || undefined });
      notifySuccess({ language, message: translate(`${created.length} file(s) uploaded.`, `تم رفع ${created.length} ملف.`) });
    } catch (err) {
      notifyError({ language, message: errorMessage(err, translate("Upload failed", "فشل الرفع")) });
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <AdminLayoutBox
      header={{
        title: translate("Media Library", "مكتبة الوسائط"),
        subTitle: translate(
          "Images and videos used on the website. Files used on the live website cannot be deleted until they are replaced there.",
          "الصور والفيديوهات المستخدمة في الموقع. لا يمكن حذف ملف مستخدم في الموقع المنشور حتى يُستبدل هناك.",
        ),
        sideElements: canManage && (
          <div className="flex flex-wrap items-end gap-2">
            <TextInput size="xs" placeholder={translate("Upload to folder (optional)", "الرفع إلى مجلد (اختياري)")} value={uploadFolder} onChange={(e) => setUploadFolder(e.currentTarget.value)} w={200} />
            <input
              ref={input}
              type="file"
              multiple
              hidden
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/svg+xml,video/mp4,video/webm,video/quicktime"
              onChange={(e) => upload(e.currentTarget.files)}
              data-testid="media-upload-input"
            />
            <Button color="teal" loading={uploading} onClick={() => input.current?.click()} data-testid="media-upload">
              {translate("Upload files", "رفع ملفات")}
            </Button>
          </div>
        ),
      }}
    >
      <div className="flex flex-col gap-4">
        {stats && (
          <div className="flex flex-wrap gap-4 text-sm text-gray-600">
            <span>{translate(`${stats.files} files`, `${stats.files} ملف`)}</span>
            <span>{translate(`${stats.images} images`, `${stats.images} صورة`)}</span>
            <span>{translate(`${stats.videos} videos`, `${stats.videos} فيديو`)}</span>
            <span>{formatBytes(stats.bytes)}</span>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <TextInput label={translate("Search", "بحث")} placeholder={translate("Name, alt text, folder", "الاسم أو النص البديل أو المجلد")} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={240} data-testid="media-search" />
          <Select
            label={translate("Type", "النوع")}
            value={kind || ""}
            onChange={(v) => setKind((v || "") as MediaQuery["kind"])}
            allowDeselect={false}
            w={140}
            data={[
              { value: "", label: translate("All", "الكل") },
              { value: "image", label: translate("Images", "صور") },
              { value: "video", label: translate("Videos", "فيديو") },
            ]}
          />
          <Select label={translate("Folder", "المجلد")} value={folder} onChange={(v) => setFolder(v || "")} w={180} data={[{ value: "", label: translate("All folders", "كل المجلدات") }, ...folders.map((f) => ({ value: f.name, label: `${f.name} (${f.count})` }))]} allowDeselect={false} />
          <Select
            label={translate("Usage", "الاستخدام")}
            value={usage || ""}
            onChange={(v) => setUsage((v || "") as MediaQuery["usage"])}
            allowDeselect={false}
            w={160}
            data={[
              { value: "", label: translate("Any", "الكل") },
              { value: "used", label: translate("Used", "مستخدم") },
              { value: "unused", label: translate("Unused", "غير مستخدم") },
            ]}
          />
          <Select
            label={translate("Sort", "الترتيب")}
            value={sort}
            onChange={(v) => setSort((v || "newest") as MediaQuery["sort"])}
            allowDeselect={false}
            w={150}
            data={[
              { value: "newest", label: translate("Newest", "الأحدث") },
              { value: "oldest", label: translate("Oldest", "الأقدم") },
              { value: "name", label: translate("Name", "الاسم") },
              { value: "size", label: translate("Largest", "الأكبر") },
            ]}
          />
        </div>

        <div
          onDragOver={(e) => {
            if (!canManage) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            if (!canManage) return;
            e.preventDefault();
            setDragOver(false);
            upload(e.dataTransfer.files);
          }}
          className={`rounded-lg ${dragOver ? "outline-dashed outline-2 outline-teal-500" : ""}`}
        >
          {loading ? (
            <LoadingSection message={translate("Loading media...", "جاري تحميل الوسائط...")} />
          ) : error ? (
            <ErrorSection errorTitle={translate("Could not load the library", "تعذر تحميل المكتبة")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: reload }} />
          ) : media.length === 0 ? (
            <Alert color="blue" variant="light" title={translate("No files", "لا توجد ملفات")}>
              {canManage ? translate("Upload images or videos, or drop files here.", "ارفع صورًا أو فيديوهات، أو أفلت الملفات هنا.") : translate("No files match.", "لا توجد ملفات مطابقة.")}
            </Alert>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6" data-testid="media-grid">
              {media.map((m) => (
                <button key={m._id} type="button" onClick={() => setSelected(m)} className="flex flex-col overflow-hidden rounded-md border border-gray-200 bg-white text-start hover:border-teal-500" data-testid="media-item">
                  <div className="relative flex aspect-video items-center justify-center bg-gray-100">
                    {m.kind === "video" ? <video src={m.url} className="h-full w-full object-cover" muted preload="metadata" /> : <img src={m.url} alt={m.altEn || m.displayName} className="h-full w-full object-cover" loading="lazy" />}
                    {m.kind === "video" && (
                      <Badge size="xs" className="absolute start-1 top-1">
                        {translate("Video", "فيديو")}
                      </Badge>
                    )}
                    {m.usage && m.usage.live > 0 && (
                      <Badge size="xs" color="teal" className="absolute end-1 top-1">
                        {translate("Live", "منشور")}
                      </Badge>
                    )}
                  </div>
                  <div className="p-2 text-xs">
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
      </div>

      <MediaDetails
        media={selected}
        onClose={() => setSelected(null)}
        canManage={canManage}
        onSave={async (patch) => {
          if (!selected) return;
          try {
            const updated = await updateMedia(selected._id, patch);
            setSelected({ ...selected, ...updated });
            notifySuccess({ language, message: translate("Saved.", "تم الحفظ.") });
          } catch (err) {
            notifyError({ language, message: errorMessage(err, translate("Could not save", "تعذر الحفظ")) });
          }
        }}
        onReplace={async (file) => {
          if (!selected) return;
          try {
            const r = await replaceMedia(selected._id, file);
            notifySuccess({ language, message: r.message || translate("File replaced.", "تم استبدال الملف.") });
            setSelected(null);
          } catch (err) {
            notifyError({ language, message: errorMessage(err, translate("Could not replace the file", "تعذر استبدال الملف")) });
          }
        }}
        onDelete={async (u) => {
          if (!selected) return;
          if (u && u.live > 0) {
            notifyError({ language, message: translate("This file is used on the live website. Replace it there and publish first.", "هذا الملف مستخدم في الموقع المنشور. استبدله هناك وانشر أولًا.") });
            return;
          }
          const draftUse = !!u && u.draft > 0;
          const ok = await confirm({
            title: translate("Delete this file?", "حذف هذا الملف؟"),
            message: draftUse ? translate(`It is used in ${u!.draft} draft place(s); those will show an empty image.`, `مستخدم في ${u!.draft} موضع في المسودات؛ ستظهر فارغة.`) : translate("It is removed from the library.", "سيُزال من المكتبة."),
            confirmLabel: translate("Delete", "حذف"),
            danger: true,
          });
          if (!ok) return;
          try {
            await deleteMedia(selected._id, draftUse);
            notifySuccess({ language, message: translate("File deleted.", "تم حذف الملف.") });
            setSelected(null);
          } catch (err) {
            notifyError({ language, message: errorMessage(err, translate("Could not delete", "تعذر الحذف")) });
          }
        }}
      />
    </AdminLayoutBox>
  );
}

function MediaDetails({
  media,
  onClose,
  canManage,
  onSave,
  onReplace,
  onDelete,
}: {
  media: WebsiteMedia | null;
  onClose: () => void;
  canManage: boolean;
  onSave: (patch: { displayName?: string; altEn?: string; altAr?: string; folder?: string }) => Promise<void>;
  onReplace: (file: File) => Promise<void>;
  onDelete: (usage: Usage | null) => Promise<void>;
}) {
  const { language, translate } = useLanguage();
  const { call } = useCmsApi();
  const [form, setForm] = useState({ displayName: "", altEn: "", altAr: "", folder: "" });
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!media) return;
    setForm({ displayName: media.displayName || "", altEn: media.altEn || "", altAr: media.altAr || "", folder: media.folder || "general" });
    setUsage(null);
    call<Usage>({ url: `website/media/${media._id}/usage` }, { silent: true }).then((r) => r && setUsage(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media?._id]);
  if (!media) return null;
  const dirty = form.displayName !== (media.displayName || "") || form.altEn !== (media.altEn || "") || form.altAr !== (media.altAr || "") || form.folder !== (media.folder || "general");

  return (
    <Drawer opened={!!media} onClose={onClose} position={translate("right", "left") as "right" | "left"} size="lg" title={media.displayName || translate("File", "ملف")}>
      <div className="flex flex-col gap-4" data-testid="media-details">
        <div className="flex max-h-72 items-center justify-center overflow-hidden rounded bg-gray-100">
          {media.kind === "video" ? <video src={media.url} controls className="max-h-72 w-full" /> : <img src={media.url} alt={media.altEn} className="max-h-72 object-contain" />}
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-gray-500">{translate("Type", "النوع")}</dt>
          <dd>{media.kind === "video" ? translate("Video", "فيديو") : translate("Image", "صورة")} {media.format ? `(${media.format})` : ""}</dd>
          <dt className="text-gray-500">{translate("Dimensions", "الأبعاد")}</dt>
          <dd dir="ltr">{media.width && media.height ? `${media.width} × ${media.height}px` : "-"}</dd>
          <dt className="text-gray-500">{translate("Size", "الحجم")}</dt>
          <dd>{formatBytes(media.bytes)}</dd>
          <dt className="text-gray-500">{translate("Uploaded", "تاريخ الرفع")}</dt>
          <dd>{formatCairoDateTime(media.createdAt, language)}</dd>
          {media.originalName && (
            <>
              <dt className="text-gray-500">{translate("Original file", "الملف الأصلي")}</dt>
              <dd className="truncate">{media.originalName}</dd>
            </>
          )}
        </dl>
        <div className="flex gap-2">
          <TextInput className="flex-1" value={media.url} readOnly dir="ltr" size="xs" />
          <Button
            size="xs"
            variant="light"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(media.url);
                notifySuccessSafe(language, translate("Address copied.", "تم نسخ العنوان."));
              } catch {
                notifyError({ language, message: translate("Copy failed - select the address and copy it.", "فشل النسخ - حدد العنوان وانسخه.") });
              }
            }}
          >
            {translate("Copy URL", "نسخ الرابط")}
          </Button>
        </div>

        <div className="rounded border border-gray-100 p-3 text-sm">
          <div className="mb-1 font-medium">{translate("Where it is used", "أماكن الاستخدام")}</div>
          {!usage ? (
            <span className="text-gray-500">…</span>
          ) : usage.total === 0 ? (
            <span className="text-gray-500">{translate("Not used anywhere.", "غير مستخدم في أي مكان.")}</span>
          ) : (
            <ul className="flex flex-col gap-1">
              {usage.uses.map((u, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Badge size="xs" color={u.scope === "live" ? "teal" : "gray"}>
                    {u.scope === "live" ? translate("Live", "منشور") : translate("Draft", "مسودة")}
                  </Badge>
                  <span>
                    {u.where}
                    {u.pageSlug ? ` · ${u.pageSlug}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <TextInput label={translate("Name", "الاسم")} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.currentTarget.value })} maxLength={120} disabled={!canManage} data-testid="media-name" />
          <TextInput label={translate("Alt text (English)", "النص البديل (الإنجليزية)")} description={translate("Describes the image for screen readers and search engines", "يصف الصورة لقارئات الشاشة ومحركات البحث")} value={form.altEn} onChange={(e) => setForm({ ...form, altEn: e.currentTarget.value })} maxLength={200} dir="ltr" disabled={!canManage} data-testid="media-alt-en" />
          <TextInput label={translate("Alt text (Arabic)", "النص البديل (العربية)")} value={form.altAr} onChange={(e) => setForm({ ...form, altAr: e.currentTarget.value })} maxLength={200} dir="rtl" disabled={!canManage} />
          <TextInput label={translate("Folder", "المجلد")} value={form.folder} onChange={(e) => setForm({ ...form, folder: e.currentTarget.value })} maxLength={40} disabled={!canManage} />
        </div>

        {canManage && (
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex gap-2">
              <input
                ref={replaceInput}
                type="file"
                hidden
                accept={media.kind === "video" ? "video/mp4,video/webm,video/quicktime" : "image/jpeg,image/png,image/webp,image/gif,image/avif,image/svg+xml"}
                onChange={async (e) => {
                  const file = e.currentTarget.files?.[0];
                  if (!file) return;
                  setBusy(true);
                  await onReplace(file);
                  setBusy(false);
                }}
              />
              <Button size="xs" variant="light" loading={busy} onClick={() => replaceInput.current?.click()}>
                {translate("Replace file", "استبدال الملف")}
              </Button>
              <Button size="xs" variant="light" color="red" onClick={() => onDelete(usage)} data-testid="media-delete">
                {translate("Delete", "حذف")}
              </Button>
            </div>
            <Button
              size="xs"
              color="teal"
              disabled={!dirty || !form.displayName.trim()}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                await onSave(form);
                setBusy(false);
              }}
              data-testid="media-save"
            >
              {translate("Save details", "حفظ التفاصيل")}
            </Button>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function notifySuccessSafe(language: Parameters<typeof notifySuccess>[0]["language"], message: string) {
  notifySuccess({ language, message });
}
