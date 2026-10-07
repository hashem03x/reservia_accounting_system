import { createTheme, MantineColorsTuple } from "@mantine/core";

// Reservia Integrated Energy palette - a specified design system (not a color chosen because it
// was already in use, unlike this theme's first version). Every array's index 6 is the exact
// spec'd hex; the rest are hand-graded tints/shades around it (Mantine mostly reads index 6 for
// solid buttons/backgrounds and the lighter indices for `variant="light"` fills).

const primaryNavy: MantineColorsTuple = [
  "#EAF0F5",
  "#CBDAE6",
  "#A8C0D4",
  "#82A3BF",
  "#5D85A8",
  "#396A91",
  "#123B5D", // brand primary - deep navy
  "#0F3352",
  "#0C2A45",
  "#081C30",
];

const secondaryGreen: MantineColorsTuple = [
  "#E8F5EF",
  "#C3E6D6",
  "#9AD5BC",
  "#6FC3A1",
  "#4CAE89",
  "#369973",
  "#2E7D5B", // brand secondary / success - energy green
  "#276B4E",
  "#205740",
  "#17402F",
];

const accentGold: MantineColorsTuple = [
  "#FCF6EA",
  "#F7E9CC",
  "#F0D9A8",
  "#E8C884",
  "#E0B968",
  "#DAB05C",
  "#D6A84F", // brand accent / warning - warm gold
  "#B98E3F",
  "#997434",
  "#785A28",
];

const errorRed: MantineColorsTuple = [
  "#FBEAEA",
  "#F4CACA",
  "#EBA5A5",
  "#E17F7F",
  "#D96060",
  "#D15252",
  "#C94A4A", // error
  "#AD3F3F",
  "#8F3535",
  "#6E2828",
];

const theme = createTheme({
  primaryColor: "primary",
  primaryShade: 6,
  colors: {
    primary: primaryNavy,
    secondary: secondaryGreen,
    accent: accentGold,
    // Overriding Mantine's own built-in `green`/`yellow`/`red` (rather than only adding the new
    // named colors above) is deliberate: dozens of pre-existing status badges/alerts/buttons
    // across the app already use `color="green"` (success), `color="yellow"` (warning), and
    // `color="red"` (error/danger) - see e.g. the journal-entry status badges, project status
    // badges, error alerts. Redefining these three built-in names to the spec's Success/Warning/
    // Error hexes makes every one of those existing call sites correct under the new palette
    // without touching each file individually - exactly the "update the theme, not individual
    // pages" approach this change calls for.
    green: secondaryGreen,
    yellow: accentGold,
    red: errorRed,
    // `color="teal"` is the pre-existing codebase's own convention for primary call-to-action
    // buttons (mostly "Create X" buttons - ~20 admin pages use it), predating this theme. Mapping
    // it to the accent gold rather than leaving Mantine's stock teal keeps those buttons
    // intentional under the new palette: navy carries the structural/navigation chrome, gold marks
    // the actionable primary CTAs - without touching any of those ~20 files individually.
    teal: accentGold,
  },
  // Mantine's stock default radii read as slightly bubbly for a professional accounting/ERP
  // surface (this codebase's own Modal wrapper hardcoded radius={20} everywhere, for example -
  // dialed back separately in components/ui/modal.tsx). `md` is a modest, enterprise-appropriate
  // middle ground - not sharp/harsh, not rounded-pill.
  defaultRadius: "md",
  // The accent gold (#D6A84F) in particular is light enough that white text on a solid/filled
  // accent surface can fail WCAG contrast - autoContrast makes Mantine pick black or white text
  // per-component based on the actual background color's luminance, rather than assuming white
  // always works (the previous default) - a general accessibility safety net across every color
  // in the theme, not just accent.
  autoContrast: true,
  // Base/fallback only - the actual Inter-vs-Cairo switch happens at runtime via the
  // `--mantine-font-family`/`--mantine-font-family-headings` CSS variable overrides in
  // src/index.css, keyed off the `dir` attribute LanguageContext.tsx sets on <html>. Inter here
  // matches the app's default language (English).
  fontFamily: "Inter, sans-serif",
  headings: { fontFamily: "Inter, sans-serif", fontWeight: "700" },
  components: {
    Button: { defaultProps: { radius: "md" } },
    // Badge intentionally keeps Mantine's own default (fully rounded/pill) - status chips read as
    // pills in virtually every ERP/dashboard convention; that's not the "overly rounded" pattern
    // to avoid, unlike large containers/cards/modals using an oversized corner radius.
    Table: {
      defaultProps: {
        verticalSpacing: "sm",
        horizontalSpacing: "md",
      },
    },
  },
});

export default theme;
