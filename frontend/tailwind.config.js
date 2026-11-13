import { createRequire } from "module";

// Reservia design tokens - one source (src/theme/tokens.json) for Tailwind and the Mantine theme.
const tokens = createRequire(import.meta.url)("./src/theme/tokens.json");
const scale = (c) => Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((k, i) => [k, c[i]]));

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  // Toggled by syncing a `dark` class onto <html> (see index.html's inline script and
  // src/hooks/useColorScheme.ts) in lockstep with Mantine's own `data-mantine-color-scheme`.
  darkMode: "class",
  theme: {
    extend: {
      fontSize: {
        xs: ["0.75rem", "1.20rem"],
        sm: ["0.875rem", "1.45rem"],
        base: ["1rem", "1.65rem"],
        lg: ["1.125rem", "1.85rem"],
        xl: ["1.25rem", "2rem"],
      },
      fontFamily: {
        // Utility classes for the rare spot that needs one explicitly - the app-wide Inter / Cairo
        // switch happens via the dir-scoped CSS variables in src/index.css. Values from tokens.json.
        inter: [tokens.font.latin.split(",")[0], "sans-serif"],
        cairo: [tokens.font.arabic.split(",")[0], "sans-serif"],
        mono: tokens.font.mono.split(",").map((f) => f.trim()),
      },
      colors: {
        // Reservia palette, from src/theme/tokens.json (shared with the Mantine theme). `gray` is
        // redefined (not extended) so the hundreds of existing text-gray-* / bg-gray-* / border-gray-*
        // classes pick up the brand neutrals.
        gray: scale(tokens.palette.gray),
        primary: scale(tokens.palette.primary), // 600 = brand primary, deep navy
        secondary: scale(tokens.palette.secondary), // 600 = brand secondary / success, energy green
        accent: scale(tokens.palette.accent), // 600 = brand accent / warning, warm gold
        danger: scale(tokens.palette.danger), // 600 = error
        // Semantic, theme-aware colors: CSS variables emitted for light AND dark by MantineProvider
        // (src/theme/index.ts cssVariablesResolver), so `bg-surface` / `border-line` / `text-ink` need
        // no `dark:` twin. Prefer these in new UI.
        page: "var(--rsv-page)",
        surface: { DEFAULT: "var(--rsv-surface)", subtle: "var(--rsv-subtle)", muted: "var(--rsv-muted)", hover: "var(--rsv-hover)" },
        line: { DEFAULT: "var(--rsv-border)", strong: "var(--rsv-border-strong)" },
        ink: { DEFAULT: "var(--rsv-text)", secondary: "var(--rsv-text-secondary)", muted: "var(--rsv-text-muted)", faint: "var(--rsv-text-faint)" },
        brand: "var(--rsv-brand)",
      },
      borderRadius: { card: tokens.radius.md },
      boxShadow: { card: "var(--rsv-shadow)", raised: "var(--rsv-shadow-raised)" },
      width: { sidebar: `${tokens.layout.sidebarWidth}px`, "sidebar-collapsed": `${tokens.layout.sidebarCollapsedWidth}px` },
      height: { header: `${tokens.layout.headerHeight}px` },
      minHeight: { header: `${tokens.layout.headerHeight}px` },
      container: { center: true },
      animation: {
        "fade-in": "fade-in 0.35s",
      },
    },
  },
};
