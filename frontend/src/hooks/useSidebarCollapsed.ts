import { useEffect, useState } from "react";

const STORAGE_KEY = "sidebar-collapsed";
// Below this width (tablets, small laptops) the sidebar starts as an icon rail, leaving the page the
// room - until the user chooses otherwise, which is then remembered.
const RAIL_BY_DEFAULT_BELOW = 1280;

function initial(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true" || stored === "false") return stored === "true";
  } catch {
    // Storage unavailable - fall back to the width rule.
  }
  return typeof window !== "undefined" && window.innerWidth < RAIL_BY_DEFAULT_BELOW;
}

// Client-side UI preference only (no backend request) - persists across refreshes via
// localStorage, read synchronously on first render so the sidebar never flashes one state and then
// switches to the other.
export default function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(initial);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // Not remembered when storage is unavailable.
    }
  }, [collapsed, touched]);

  const set = (value: boolean) => {
    setTouched(true);
    setCollapsed(value);
  };
  return [collapsed, set] as const;
}
