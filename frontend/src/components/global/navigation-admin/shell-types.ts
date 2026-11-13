import { NavSection } from "./nav-config";

/**
 * What a dashboard gives the shared app shell (components/global/app-shell): its own navigation and
 * labels. Everything else - sidebar, phone header and drawer, footer, colors, sizes - is shared.
 */
export type ShellProps = {
  /** The dashboard's sections and items, already filtered by its own permissions. */
  sections: NavSection[];
  /** Shown under "Reservia" in the brand block: "Admin panel", "CRM", "Deal Engine", "HR Portal"... */
  subtitle: string;
  /** Keeps each dashboard's open/closed sections apart ("erp", "crm", "hr"...). */
  scope?: string;
  /** The user's role in THIS system (e.g. "HR officer"); defaults to the portal role. */
  roleLabel?: string;
  /** The guided tour exists for the ERP only. */
  showTour?: boolean;
  /** data-testid on the <nav> (browser tests). */
  navTestId?: string;
};
