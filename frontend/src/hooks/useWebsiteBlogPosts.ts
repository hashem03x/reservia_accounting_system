import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { WebsiteBlogPost } from "@/types/website";

type Pagination = { currentPage: number; numberOfPages: number; limit: number };

export type CreateBlogPostInput = {
  slug: string;
  titleEn?: string;
  titleAr?: string;
  excerptEn?: string;
  excerptAr?: string;
  bodyEn?: string;
  bodyAr?: string;
  category?: string;
  tags?: string[];
  author?: WebsiteBlogPost["author"];
  featuredImage?: WebsiteBlogPost["featuredImage"];
  showRecentSidebar?: boolean;
  locales?: WebsiteBlogPost["locales"];
  seo?: Partial<WebsiteBlogPost["seo"]>;
};
export type UpdateBlogPostInput = Partial<CreateBlogPostInput>;

/**
 * The data layer of the Website Management "Blog" list (`/website/blog-posts` API), mirroring
 * useWebsitePages.ts's exact shape.
 */
export default function useWebsiteBlogPosts(filters: { status?: string; q?: string } = {}) {
  const { language } = useLanguage();
  const privateRequest = usePrivateRequest();

  const [posts, setPosts] = useState<WebsiteBlogPost[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ currentPage: 1, numberOfPages: 1, limit: 100 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(
    () =>
      handleRequest(language, setLoading, setError, async () => {
        const params: Record<string, string | number> = { limit: 200 };
        if (filters.status) params.status = filters.status;
        if (filters.q) params.q = filters.q;
        const res = await privateRequest({ url: "website/blog-posts", params, language });
        setPosts(Array.isArray(res?.data) ? res.data : []);
        setPagination(res?.paginationResult ?? { currentPage: 1, numberOfPages: 1, limit: 100 });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, filters.status, filters.q],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  async function createBlogPost(input: CreateBlogPostInput): Promise<WebsiteBlogPost> {
    const res = await privateRequest({ url: "website/blog-posts", method: "POST", data: input, language });
    await reload();
    return res.data as WebsiteBlogPost;
  }

  async function updateBlogPost(id: string, input: UpdateBlogPostInput): Promise<WebsiteBlogPost> {
    const res = await privateRequest({ url: `website/blog-posts/${id}`, method: "PATCH", data: input, language });
    await reload();
    return res.data as WebsiteBlogPost;
  }

  async function deleteBlogPost(id: string): Promise<void> {
    await privateRequest({ url: `website/blog-posts/${id}`, method: "DELETE", language });
    await reload();
  }

  async function publishBlogPost(id: string, label?: string): Promise<{ post: WebsiteBlogPost; deploy: { triggered: boolean } }> {
    const res = await privateRequest({ url: `website/blog-posts/${id}/publish`, method: "POST", data: { label }, language });
    await reload();
    return res.data;
  }

  async function unpublishBlogPost(id: string): Promise<void> {
    await privateRequest({ url: `website/blog-posts/${id}/unpublish`, method: "POST", language });
    await reload();
  }

  async function fetchCategorySuggestions(q: string): Promise<string[]> {
    const res = await privateRequest({ url: "website/blog-posts/categories", params: { q }, language });
    return Array.isArray(res?.data) ? res.data : [];
  }

  return { posts, pagination, loading, error, reload, createBlogPost, updateBlogPost, deleteBlogPost, publishBlogPost, unpublishBlogPost, fetchCategorySuggestions };
}
