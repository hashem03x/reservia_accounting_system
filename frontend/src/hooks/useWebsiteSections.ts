import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { SectionSettings, SectionType, WebsiteSection } from "@/types/website";

/**
 * The data layer of the Visual Editor's left panel - a single page's sections
 * (`/website/pages/:pageId/sections` API), mirroring useAccountParentGroups.ts's shape.
 */
export default function useWebsiteSections(pageId: string | null) {
  const { language } = useLanguage();
  const privateRequest = usePrivateRequest();

  const [sections, setSections] = useState<WebsiteSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(
    () =>
      handleRequest(language, setLoading, setError, async () => {
        if (!pageId) {
          setSections([]);
          return;
        }
        const res = await privateRequest({ url: `website/pages/${pageId}/sections`, language });
        setSections(Array.isArray(res?.data) ? res.data : []);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, pageId],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  async function createSection(type: SectionType, content: Record<string, unknown> = {}, position?: number): Promise<WebsiteSection> {
    const res = await privateRequest({ url: `website/pages/${pageId}/sections`, method: "POST", data: { type, content, ...(Number.isInteger(position) ? { position } : {}) }, language });
    await reload();
    return res.data as WebsiteSection;
  }

  async function updateSection(id: string, patch: { content?: Record<string, unknown>; isVisible?: boolean; settings?: Partial<SectionSettings>; adminLabel?: string }): Promise<WebsiteSection> {
    const res = await privateRequest({ url: `website/pages/${pageId}/sections/${id}`, method: "PATCH", data: patch, language });
    await reload();
    return res.data as WebsiteSection;
  }

  // Optimistic - applies the new order to local state IMMEDIATELY (what the drag-and-drop UI
  // needs to feel responsive), then persists it; reload() on failure restores the real order.
  async function reorderSections(orderedIds: string[]): Promise<void> {
    setSections(prev => orderedIds.map((id, index) => ({ ...prev.find(s => s._id === id)!, sortOrder: index })).filter(Boolean));
    try {
      await privateRequest({ url: `website/pages/${pageId}/sections/reorder`, method: "PATCH", data: { order: orderedIds }, language });
    } catch (err) {
      await reload();
      throw err;
    }
  }

  async function duplicateSection(id: string): Promise<WebsiteSection> {
    const res = await privateRequest({ url: `website/pages/${pageId}/sections/${id}/duplicate`, method: "POST", language });
    await reload();
    return res.data as WebsiteSection;
  }

  async function deleteSection(id: string): Promise<void> {
    await privateRequest({ url: `website/pages/${pageId}/sections/${id}`, method: "DELETE", language });
    await reload();
  }

  return { sections, loading, error, reload, createSection, updateSection, reorderSections, duplicateSection, deleteSection };
}
