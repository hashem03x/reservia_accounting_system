import { useEffect } from "react";
import { useComputedColorScheme } from "@mantine/core";

// Keeps Tailwind's `dark:` utilities (tailwind.config.js's darkMode: "class") in sync with
// Mantine's own resolved color scheme after the initial paint - index.html's inline script handles
// the very first paint (before React mounts) so there's no light->dark flash on load.
export default function useColorScheme() {
  const computedColorScheme = useComputedColorScheme("light");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", computedColorScheme === "dark");
  }, [computedColorScheme]);

  return computedColorScheme;
}
