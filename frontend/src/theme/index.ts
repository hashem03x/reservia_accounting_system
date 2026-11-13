import { createTheme, CSSVariablesResolver, MantineColorsTuple } from "@mantine/core";
import tokens from "./tokens.json";

// Reservia design system - the Mantine half. Every value comes from ./tokens.json (the single source
// shared with tailwind.config.js), taken from the ERP dashboard, which is the master reference for
// every module (Portal, ERP, CRM, Deal Engine, HR, Website). See docs/design-system.md.
//
// Palette: index 6 of each tuple is the exact specified brand hex; the rest are graded tints/shades
// (Mantine reads index 6 for solid fills and the lighter indices for `variant="light"`).

const tuple = (c: string[]) => c as unknown as MantineColorsTuple;
const { palette } = tokens;

const theme = createTheme({
  primaryColor: "primary",
  primaryShade: 6,
  colors: {
    primary: tuple(palette.primary), // brand primary - deep navy #123B5D
    secondary: tuple(palette.secondary), // brand secondary / success - energy green #2E7D5B
    accent: tuple(palette.accent), // brand accent / warning - warm gold #D6A84F
    // Mantine's own `green`/`yellow`/`red` are redefined (not only added) on purpose: dozens of
    // existing status badges/alerts/buttons use color="green" (success), "yellow" (warning) and
    // "red" (error) - redefining the three names makes every one of them on-brand without touching
    // each file.
    green: tuple(palette.secondary),
    yellow: tuple(palette.accent),
    red: tuple(palette.danger),
    // `color="teal"` is the codebase's existing convention for primary call-to-action buttons
    // (mostly "Create X"); mapping it to the accent gold keeps those intentional: navy carries the
    // structure, gold marks the main actions.
    teal: tuple(palette.accent),
  },
  // A modest, enterprise radius (8px): not sharp, not pill-shaped.
  defaultRadius: "md",
  // Picks black or white text per filled color (the gold accent is too light for white text).
  autoContrast: true,
  // Base only - the Inter / Cairo switch happens via the dir-scoped --mantine-font-family overrides
  // in src/index.css (LanguageContext sets `dir` on <html>), which also reach portaled components.
  fontFamily: tokens.font.latin,
  fontFamilyMonospace: tokens.font.mono,
  headings: { fontFamily: tokens.font.latin, fontWeight: "700" },
  other: { tokens },
  components: {
    Button: { defaultProps: { radius: "md" } },
    // Badge keeps Mantine's pill shape: status chips read as pills in every dashboard convention.
    Table: {
      defaultProps: {
        verticalSpacing: "sm",
        horizontalSpacing: "md",
      },
    },
  },
});

/**
 * The platform's semantic CSS variables (--rsv-*), emitted by MantineProvider for both color schemes
 * from the same tokens. Every shared surface (app shell, cards, the HR module, Tailwind's semantic
 * colors) reads these, so light/dark switching is consistent everywhere with no hard-coded hex.
 */
const semantic = (s: Record<string, string>) => {
  const out: Record<string, string> = {};
  const name = (k: string) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  Object.entries(s).forEach(([k, v]) => (out[`--rsv-${name(k)}`] = v));
  return out;
};

export const cssVariablesResolver: CSSVariablesResolver = () => {
  const variables: Record<string, string> = {
    "--rsv-font-latin": tokens.font.latin,
    "--rsv-font-arabic": tokens.font.arabic,
    "--rsv-font-mono": tokens.font.mono,
    "--rsv-radius-sm": tokens.radius.sm,
    "--rsv-radius-md": tokens.radius.md,
    "--rsv-radius-lg": tokens.radius.lg,
    "--rsv-radius-pill": tokens.radius.pill,
    "--rsv-sidebar-width": `${tokens.layout.sidebarWidth}px`,
    "--rsv-sidebar-collapsed-width": `${tokens.layout.sidebarCollapsedWidth}px`,
    "--rsv-header-height": `${tokens.layout.headerHeight}px`,
    "--rsv-nav-item-height": `${tokens.layout.navItemHeight}px`,
  };
  tokens.chart.forEach((c, i) => (variables[`--rsv-chart-${i + 1}`] = c));
  return { variables, light: semantic(tokens.surface.light), dark: semantic(tokens.surface.dark) };
};

/** Categorical chart colors, in order (navy, green, gold, ...). */
export const chartColors = tokens.chart;
export const layoutTokens = tokens.layout;

export default theme;
