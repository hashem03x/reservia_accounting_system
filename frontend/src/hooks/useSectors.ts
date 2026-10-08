import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { Sector, SectorInput } from "@/types/sector";
import handleRequest from "@/utils/helpers/handle-request";

/**
 * The one data layer for Project Sectors (`/sectors` API), shared by the Sectors admin page and
 * every Sector selector, so no component builds its own sector requests or list.
 *
 * `activeOnly` loads only selectable sectors (the Project forms); otherwise every sector with its
 * usage count (the admin page). Mutations return the backend's saved sector and keep the local
 * list in sync; they throw the backend's error (e.g. a duplicate name) for the caller to show via
 * handleRequest.
 */
export default function useSectors({ activeOnly = false }: { activeOnly?: boolean } = {}) {
  const { language } = useLanguage();
  const privateRequest = usePrivateRequest();

  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const sortByName = (list: Sector[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const reload = useCallback(
    () =>
      handleRequest(language, setLoading, setError, async () => {
        const res = await privateRequest({ url: "sectors", params: activeOnly ? { active: "true" } : {}, language });
        setSectors(Array.isArray(res?.data) ? res.data : []);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeOnly, language],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  async function createSector(input: SectorInput): Promise<Sector> {
    const res = await privateRequest({ url: "sectors", method: "POST", data: input, language });
    const created = res.data as Sector;
    setSectors((prev) => sortByName([...prev, created]));
    return created;
  }

  async function updateSector(id: string, input: SectorInput): Promise<Sector> {
    const res = await privateRequest({ url: `sectors/${id}`, method: "PATCH", data: input, language });
    const updated = res.data as Sector;
    setSectors((prev) => sortByName(prev.map((s) => (s._id === id ? updated : s))));
    return updated;
  }

  async function deleteSector(id: string): Promise<void> {
    await privateRequest({ url: `sectors/${id}`, method: "DELETE", language });
    setSectors((prev) => prev.filter((s) => s._id !== id));
  }

  return { sectors, loading, error, reload, createSector, updateSector, deleteSector };
}
