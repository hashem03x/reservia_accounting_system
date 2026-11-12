import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { WebsiteMedia } from "@/types/website";

export type MediaQuery = { q?: string; kind?: "image" | "video" | ""; folder?: string; usage?: "used" | "unused" | ""; sort?: "newest" | "oldest" | "name" | "size" };

/**
 * The data layer of the Media Library (`/website/media` API). Upload/replace are multipart
 * form-data (real files - stored in Cloudinary, never in the database); everything else is JSON.
 * Accepts either a folder (older callers) or a full query.
 */
export default function useWebsiteMedia(query?: string | MediaQuery) {
  const { language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const q: MediaQuery = typeof query === "string" ? { folder: query } : query || {};
  const key = JSON.stringify(q);

  const [media, setMedia] = useState<WebsiteMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(
    () =>
      handleRequest(language, setLoading, setError, async () => {
        const params: Record<string, string | number> = { limit: 200 };
        for (const [k, v] of Object.entries(q)) if (v) params[k] = v as string;
        const res = await privateRequest({ url: "website/media", params, language });
        setMedia(Array.isArray(res?.data) ? res.data : []);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, key],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  async function uploadFiles(files: File[], options: { folder?: string; altEn?: string; altAr?: string } = {}): Promise<WebsiteMedia[]> {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    if (options.folder) form.append("folder", options.folder);
    if (options.altEn) form.append("altEn", options.altEn);
    if (options.altAr) form.append("altAr", options.altAr);
    const res = await privateRequest({ url: "website/media", method: "POST", data: form, language });
    await reload();
    return res.data as WebsiteMedia[];
  }

  async function updateMedia(id: string, patch: { altEn?: string; altAr?: string; folder?: string; displayName?: string }): Promise<WebsiteMedia> {
    const res = await privateRequest({ url: `website/media/${id}`, method: "PATCH", data: patch, language });
    await reload();
    return res.data as WebsiteMedia;
  }

  async function replaceMedia(id: string, file: File): Promise<{ message: string }> {
    const form = new FormData();
    form.append("file", file);
    const res = await privateRequest({ url: `website/media/${id}/replace`, method: "POST", data: form, language });
    await reload();
    return { message: res?.message || "" };
  }

  async function deleteMedia(id: string, force = false): Promise<void> {
    await privateRequest({ url: `website/media/${id}`, method: "DELETE", params: force ? { force: "true" } : {}, language });
    await reload();
  }

  return { media, loading, error, reload, uploadFiles, updateMedia, replaceMedia, deleteMedia };
}
