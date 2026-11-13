# Reservia design system

Every Reservia dashboard shares one visual identity, taken from the **ERP dashboard**, which is the
master reference:

* Central Portal;
* ERP and Accounting;
* CRM;
* Deal Engine (system id `COMMERCIAL`);
* HR Portal;
* Website CMS.

New screens get the design automatically by using the pieces below. Never copy colors or sizes
into a page.

## 1. One source of truth: `frontend/src/theme/tokens.json`

| Group | What it holds |
| --- | --- |
| `font` | Inter (Latin), Cairo (Arabic/RTL), the monospace stack for code fields |
| `palette` | 10-step scales. Index 6 is the brand color. |
| `surface.light` / `surface.dark` | Semantic colors for each scheme: page, surface, subtle, muted, border, text levels, hover, brand, navigation active state, shadows |
| `chart` | The categorical chart palette, in order |
| `radius` | sm 4, md 8, lg 12, pill |
| `layout` | Sidebar 264 / 68 px, header 64 px, nav item 36 px, icon 18 px, page padding 24 / 16 px |

The `palette` scales are:

* `primary`: navy `#123B5D`;
* `secondary`: energy green `#2E7D5B`, also used as success;
* `accent`: gold `#D6A84F`, also used as warning;
* `danger`: `#C94A4A`;
* `gray`: the neutrals.

These three consumers read the file, so a change there reaches every dashboard:

1. **Mantine theme**, `frontend/src/theme/index.ts`:
   * colors: `primary`, `secondary`, `accent`; Mantine's `green`, `yellow` and `red` are redefined
     to the brand success, warning and error; `teal` maps to the gold call-to-action;
   * fonts, `defaultRadius: "md"` and component defaults.
2. **CSS variables**, from the `cssVariablesResolver` in the same file. MantineProvider emits them
   for light **and** dark:
   * `--rsv-page`, `--rsv-surface`, `--rsv-subtle`, `--rsv-muted`, `--rsv-border`,
     `--rsv-border-strong`;
   * `--rsv-text`, `--rsv-text-secondary`, `--rsv-text-muted`, `--rsv-text-faint`;
   * `--rsv-hover`, `--rsv-brand`, `--rsv-nav-active-*`, `--rsv-shadow*`;
   * `--rsv-chart-1..10`, `--rsv-radius-*`, `--rsv-sidebar-*`, `--rsv-header-height`;
   * `--rsv-font-latin`, `--rsv-font-arabic`, `--rsv-font-mono`.
3. **Tailwind**, `frontend/tailwind.config.js`:
   * the `gray`, `primary`, `secondary`, `accent` and `danger` scales;
   * semantic, theme-aware utilities that need no `dark:` twin:
     * `bg-page`, `bg-surface`, `bg-surface-subtle`, `bg-surface-muted`, `bg-surface-hover`;
     * `border-line`, `border-line-strong`;
     * `text-ink`, `text-ink-secondary`, `text-ink-muted`, `text-ink-faint`, `text-brand`;
     * `shadow-card`, `shadow-raised`, `rounded-card`;
     * `w-sidebar`, `h-header`.

Charts drawn on a canvas (Chart.js) cannot read CSS variables. They import `@/theme/tokens.json`
and use `tokens.chart[i]` and `tokens.surface.<scheme>.textMuted`.

## 2. Typography

* **Fonts.** One family for the whole platform: Inter for English and Cairo for Arabic, loaded once
  in `frontend/index.html`.
* **Switching.** The switch follows `dir` on `<html>`, set by LanguageContext. `src/index.css` sets
  `font-family` and `--mantine-font-family(-headings)` there, which also reaches portaled Mantine
  components such as modals, drawers, menus and notifications.
* **No overrides.** No dashboard may set its own `font-family`. Code fields use
  `var(--mantine-font-family-monospace)`. Print documents opened in their own window are the only
  exception.
* **Scale.** The Tailwind type scale (`text-xs` to `text-xl`) and the base heading styles in
  `src/index.css`:
  * page titles are bold `text-2xl` / `sm:text-3xl`;
  * card titles are `text-sm font-semibold`;
  * labels are 12 px uppercase with 0.025em tracking (KPI cards);
  * figures use `tabular-nums`.

## 3. Light and dark mode

* **Switching.** Mantine's color scheme (Light, Dark, System, toggled from the sidebar footer) and
  the `dark` class on `<html>` are switched together (`index.html`, `useColorScheme`).
* **Surfaces.** Use the semantic Tailwind colors, Mantine components, or `--rsv-*` variables, which
  are correct in both schemes.
* **Existing utilities.** `bg-white`, `bg-gray-50`, `text-gray-800`, `border-gray-100` and similar
  are mapped to the dark tokens in one place (`src/index.css`).
* **Never** hard-code a hex value or a `dark:bg-gray-800`-style color in a page.

## 4. The app shell: `frontend/src/components/global/app-shell`

Every dashboard renders the ERP's own shell:

```tsx
<AppShell sections={sections} subtitle="CRM" scope="crm" roleLabel="Sales" navTestId="crm-nav" />
```

* **Desktop and tablet:** a sticky sidebar.
  * The brand block reads "Reservia" plus the system name.
  * The navigation has quick find and collapsible sections, and the open/closed state is remembered
    per dashboard.
  * The active item gets an accent bar and weight; nav items can show a count badge.
  * The footer shows the user and their role **in that system**, plus Tour (ERP only), Theme,
    Language and Exit (back to the portal).
  * The sidebar collapses to a 68 px icon rail, remembered per device.
* **Phone (768 px and below):** a 64 px top bar with a drawer that holds the same navigation and
  footer.
* **What a dashboard passes:** only its own `NavSection[]`, already filtered by its permissions.
  Routes, permissions and items stay the dashboard's own.

Layouts:

* `pages/routes/layout-admin.tsx` (ERP);
* `layout-crm.tsx`;
* `layout-commercial.tsx`;
* `layout-website.tsx`;
* `pages/hr/index.tsx`.

The building blocks are in `components/global/navigation-admin/`: `sidebar-nav`, `sidebar-footer`,
`admin-aside`, `admin-header`, `shell-brand`, `shell-types` and `nav-config`. The Central Portal
(the launcher) uses the same brand block, surface, border and height in its header.

## 5. Components

Use the shared components. Do not restyle them per dashboard.

| Need | Use |
| --- | --- |
| Page container with title, back link and actions | `components/ui/admin-layout-box` |
| Titled card | `components/ui/section-card` |
| KPI tile | `components/ui/kpi-card` |
| Data table | `components/ui/data-table` (`DataTableContainer`, `DataTable`, `dataTableHeadClassName`) |
| Dialog | `components/ui/modal` (Mantine Modal) or Mantine `Drawer` |
| Confirmation | `hooks/useConfirmDialog` |
| Buttons, inputs, selects, badges, alerts, tooltips, notifications | Mantine components, which take the theme |
| Status color | `color="green"` (success), `"yellow"` (warning), `"red"` (error), `"primary"` (info); the main call-to-action is the theme default or `"teal"` (gold) |

**HR Portal.** It keeps the prototype's screen layouts (`pages/hr/hr.css`), but every value there
is a token or a Mantine variable, and its classes mirror these components:

* `.btn` is Mantine Button;
* `.pill` is Badge;
* `.kpi` is KpiCard;
* `.panel` is SectionCard;
* `.tablewrap` is DataTable.

Its dialogs are Mantine and the shared modal, and its feedback uses Mantine notifications.

## 6. Checklist for a new screen

1. Put it under the dashboard's layout. The shell comes with it.
2. Build it from the shared components and Mantine. Use the semantic Tailwind colors for any custom
   block.
3. No hex colors, no `dark:` gray classes, no `font-family`.
4. Check it in light and dark, at 1440 px and 390 px, and in Arabic.
