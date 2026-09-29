import { createTheme, MantineColorsTuple } from "@mantine/core";

// Deep engineering/energy teal as the primary brand color - chosen because `color="teal"` was
// already the 4th most-used Mantine color prop across the existing admin pages before this theme
// existed (Mantine had no custom theme at all - every component was using pure library defaults,
// i.e. Mantine's stock blue). Promoting the color the app already leans on to be the actual
// primary, rather than introducing an unrelated brand color, keeps every existing page visually
// consistent with this change instead of clashing against it.
const energyTeal: MantineColorsTuple = [
  "#e6f7f6",
  "#ccebe8",
  "#99d6d0",
  "#66c2b8",
  "#3aada0",
  "#1f8f83",
  "#166e64", // primary shade (index 6) - what color="teal" resolves to by default
  "#125650",
  "#0d3f3b",
  "#082925",
];

const theme = createTheme({
  primaryColor: "teal",
  primaryShade: 6,
  colors: { teal: energyTeal },
  // Mantine's stock default radii read as slightly bubbly for a professional accounting/ERP
  // surface (this codebase's own Modal wrapper hardcoded radius={20} everywhere, for example -
  // dialed back separately in components/ui/modal.tsx). `md` is a modest, enterprise-appropriate
  // middle ground - not sharp/harsh, not rounded-pill.
  defaultRadius: "md",
  fontFamily: "Tajawal, sans-serif",
  headings: { fontFamily: "Tajawal, sans-serif", fontWeight: "700" },
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
