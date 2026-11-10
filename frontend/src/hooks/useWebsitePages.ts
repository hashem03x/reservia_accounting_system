import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { WebsitePage } from "@/types/website";

type Pagination = { currentPage: number; numberOfPages: number; limit: number };

export type CreatePageInput = {
  slug: string;
  path: string;
  isHomePage?: boolean;
  pageType?: string;
  parentSlug?: string | null;
  sortOrder?: number;
  locales?: WebsitePage["locales"];
  seo?: Partial<WebsitePage["seo"]>;
};
export type UpdatePageInput = Partial<Omit<CreatePageInput, "slug">>;

/**
 * The data layer of the Website Management "Pages" list (`/website/pages` API), mirroring
 * useAccountParentGroups.ts's shape exactly. Mutations throw the backend's error for the caller
 * to show via handleRequest, and reload the list on success.
 */
export default function useWebsitePages() {
  const { language } = useLanguage();
  const privateRequest = usePrivateRequest();

  const [pages, setPages] = useState<WebsitePage[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ currentPage: 1, numberOfPages: 1, limit: 100 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(
    () =>
      handleRequest(language, setLoading, setError, async () => {
        const res = await privateRequest({ url: "website/pages", params: { limit: 100 }, language });
        setPages(Array.isArray(res?.data) ? res.data : []);
        setPagination(res?.paginationResult ?? { currentPage: 1, numberOfPages: 1, limit: 100 });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  async function createPage(input: CreatePageInput): Promise<WebsitePage> {
    const res = await privateRequest({ url: "website/pages", method: "POST", data: input, language });
    await reload();
    return res.data as WebsitePage;
  }

  async function updatePage(id: string, input: UpdatePageInput): Promise<WebsitePage> {
    const res = await privateRequest({ url: `website/pages/${id}`, method: "PATCH", data: input, language });
    await reload();
    return res.data as WebsitePage;
  }

  async function duplicatePage(id: string, slug: string, path: string): Promise<WebsitePage> {
    const res = await privateRequest({ url: `website/pages/${id}/duplicate`, method: "POST", data: { slug, path }, language });
    await reload();
    return res.data as WebsitePage;
  }

  async function deletePage(id: string): Promise<void> {
    await privateRequest({ url: `website/pages/${id}`, method: "DELETE", language });
    await reload();
  }

  async function publishPage(id: string, label?: string): Promise<{ page: WebsitePage; deploy: { triggered: boolean } }> {
    const res = await privateRequest({ url: `website/pages/${id}/publish`, method: "POST", data: { label }, language });
    await reload();
    return res.data;
  }

  async function unpublishPage(id: string): Promise<void> {
    await privateRequest({ url: `website/pages/${id}/unpublish`, method: "POST", language });
    await reload();
  }

  async function requestPreviewDeploy(): Promise<{ triggered: boolean; previewUrl: string | null }> {
    const res = await privateRequest({ url: "website/pages/preview-deploy", method: "POST", language });
    return res.data;
  }

  return { pages, pagination, loading, error, reload, createPage, updatePage, duplicatePage, deletePage, publishPage, unpublishPage, requestPreviewDeploy };
}
