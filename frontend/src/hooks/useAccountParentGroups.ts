import { useCallback, useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { AccountParentGroup, AccountParentGroupInput } from "@/types/account-parent-group";

export type ParentGroupStatusFilter = "all" | "active" | "inactive";
export type ParentGroupQuery = {
  keyword?: string;
  status?: ParentGroupStatusFilter;
  type?: string;
  sort?: string;
  page?: number;
  limit?: number;
};
type Pagination = { currentPage: number; numberOfPages: number; limit: number };

/**
 * The data layer of the Parent Account Groups page (`/account-parent-groups` API). Search, filters,
 * sorting and pagination run on the server. Mutations throw the backend's error (duplicate names,
 * system-default protection, a group still assigned to accounts) for the caller to show via
 * handleRequest, and reload the list on success.
 */
export default function useAccountParentGroups(query: ParentGroupQuery = {}) {
  const { language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const { keyword = "", status = "all", type = "", sort = "sortOrder", page = 1, limit = 20 } = query;

  const [groups, setGroups] = useState<AccountParentGroup[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ currentPage: 1, numberOfPages: 1, limit });
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(
    () =>
      handleRequest(language, setLoading, setError, async () => {
        const res = await privateRequest({
          url: "account-parent-groups",
          params: { ...(keyword.trim() ? { keyword: keyword.trim() } : {}), ...(type ? { type } : {}), status, sort, page, limit },
          language,
        });
        setGroups(Array.isArray(res?.data) ? res.data : []);
        setPagination(res?.paginationResult ?? { currentPage: 1, numberOfPages: 1, limit });
        setTotalCount(res?.totalCount ?? 0);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, keyword, status, type, sort, page, limit],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  async function createGroup(input: AccountParentGroupInput): Promise<AccountParentGroup> {
    const res = await privateRequest({ url: "account-parent-groups", method: "POST", data: input, language });
    await reload();
    return res.data as AccountParentGroup;
  }

  async function updateGroup(id: string, input: AccountParentGroupInput): Promise<AccountParentGroup> {
    const res = await privateRequest({ url: `account-parent-groups/${id}`, method: "PATCH", data: input, language });
    await reload();
    return res.data as AccountParentGroup;
  }

  async function setGroupStatus(id: string, isActive: boolean): Promise<AccountParentGroup> {
    const res = await privateRequest({ url: `account-parent-groups/${id}/status`, method: "PATCH", data: { isActive }, language });
    await reload();
    return res.data as AccountParentGroup;
  }

  async function deleteGroup(id: string): Promise<void> {
    await privateRequest({ url: `account-parent-groups/${id}`, method: "DELETE", language });
    await reload();
  }

  return { groups, pagination, totalCount, loading, error, reload, createGroup, updateGroup, setGroupStatus, deleteGroup };
}
