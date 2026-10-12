import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { ProjectManager, ProjectManagerInput } from "@/types/project-manager";
import handleRequest from "@/utils/helpers/handle-request";

/**
 * The one data layer for Project Managers (`/project-managers` API), shared by the Project Managers
 * admin page and every project manager selector - no component builds its own list.
 *
 * `activeOnly` loads only selectable project managers (the Project forms); otherwise every one with
 * its usage count (the admin page). Mutations keep the local list in sync and throw the backend's
 * error (e.g. a duplicate name) for the caller to show via handleRequest.
 */
export default function useProjectManagers({ activeOnly = false }: { activeOnly?: boolean } = {}) {
  const { language } = useLanguage();
  const privateRequest = usePrivateRequest();

  const [projectManagers, setProjectManagers] = useState<ProjectManager[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const sortByName = (list: ProjectManager[]) =>
    [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const reload = useCallback(
    () =>
      handleRequest(language, setLoading, setError, async () => {
        const res = await privateRequest({
          url: "project-managers",
          params: activeOnly ? { active: "true" } : {},
          language,
        });
        setProjectManagers(Array.isArray(res?.data) ? res.data : []);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeOnly, language],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  async function createProjectManager(input: ProjectManagerInput): Promise<ProjectManager> {
    const res = await privateRequest({ url: "project-managers", method: "POST", data: input, language });
    const created = res.data as ProjectManager;
    setProjectManagers((prev) => sortByName([...prev, created]));
    return created;
  }

  async function updateProjectManager(id: string, input: ProjectManagerInput): Promise<ProjectManager> {
    const res = await privateRequest({ url: `project-managers/${id}`, method: "PATCH", data: input, language });
    const updated = res.data as ProjectManager;
    setProjectManagers((prev) => sortByName(prev.map((m) => (m._id === id ? updated : m))));
    return updated;
  }

  async function deleteProjectManager(id: string): Promise<void> {
    await privateRequest({ url: `project-managers/${id}`, method: "DELETE", language });
    setProjectManagers((prev) => prev.filter((m) => m._id !== id));
  }

  return { projectManagers, loading, error, reload, createProjectManager, updateProjectManager, deleteProjectManager };
}
