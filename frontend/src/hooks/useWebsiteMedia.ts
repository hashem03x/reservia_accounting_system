import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { WebsiteMedia } from "@/types/website";

/**
 * The data layer of the Media Library (`/website/media` API), mirroring
 * useAccountParentGroups.ts's shape. Upload is multipart/form-data (real files), everything else
 * is plain JSON.
 */
export default function useWebsiteMedia(folder?: string) {
  const { language } = useLanguage();
  const privateRequest = usePrivateRequest();

  const [media, setMedia] = useState<WebsiteMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(
    () =>
      handleRequest(language, setLoading, setError, async () => {
        const res = await privateRequest({ url: "website/media", params: { limit: 200, ...(folder ? { folder } : {}) }, language });
        setMedia(Array.isArray(res?.data) ? res.data : []);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, folder],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  async function uploadFiles(files: File[], options: { folder?: string; altEn?: string; altAr?: string } = {}): Promise<WebsiteMedia[]> {
    const form = new FormData();
    files.forEach(file => form.append("files", file));
    if (options.folder) form.append("folder", options.folder);
    if (options.altEn) form.append("altEn", options.altEn);
    if (options.altAr) form.append("altAr", options.altAr);
    const res = await privateRequest({ url: "website/media", method: "POST", data: form, language });
    await reload();
    return res.data as WebsiteMedia[];
  }

  async function updateMedia(id: string, patch: { altEn?: string; altAr?: string; folder?: string }): Promise<WebsiteMedia> {
    const res = await privateRequest({ url: `website/media/${id}`, method: "PATCH", data: patch, language });
    await reload();
    return res.data as WebsiteMedia;
  }

  async function deleteMedia(id: string): Promise<void> {
    await privateRequest({ url: `website/media/${id}`, method: "DELETE", language });
    await reload();
  }

  return { media, loading, error, reload, uploadFiles, updateMedia, deleteMedia };
}
