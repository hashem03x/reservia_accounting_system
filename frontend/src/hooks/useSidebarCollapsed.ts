import { useEffect, useState } from "react";

const STORAGE_KEY = "sidebar-collapsed";

// Client-side UI preference only (no backend request) - persists across refreshes via
// localStorage, read synchronously on first render so the sidebar doesn't flash expanded then
// collapse.
export default function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(STORAGE_KEY) === "true");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  return [collapsed, setCollapsed] as const;
}
