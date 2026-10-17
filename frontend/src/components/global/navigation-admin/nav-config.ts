import { useMemo } from "react";
import { IconType } from "react-icons";
import { useLanguage } from "@/context/LanguageContext";
import { useUser } from "@/context/UserContext";
import { hasPermission } from "@/hooks/useHasPermission";
import { navIcons } from "@/components/icons";
import paths from "@/utils/constants/paths";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { isAdmin } from "@/utils/constants/roles";
import { Resource } from "@/types/user";
import { LocalizedLabel } from "@/types/global";

// The admin navigation in one place: every sidebar destination, its section, and who may see it.
// An item is shown only to users the route itself admits (App.tsx): `resource` = the ResourceGuard's
// read permission, `adminOnly` = the RoleGuard, neither = an unguarded route. Hiding an item is not
// authorization - the routes and the API enforce access on their own.

export type NavItem = { key: string; to: string; label: string; Icon: IconType };
export type NavSection = { key: string; title: string; items: NavItem[] };

type ItemDef = {
  key: string;
  to: string;
  label: string;
  Icon: IconType;
  resource?: LocalizedLabel<Resource>;
  adminOnly?: boolean;
};

const admin = (...segments: string[]) => `/${[paths.admin, ...segments].join("/")}`;
const report = (key: string) => `${admin(paths.financialReports)}/${key}`;

/** The sections and items the signed-in user may open, in display order (empty sections dropped). */
export function useAdminNavigation(): NavSection[] {
  const { translations } = useLanguage();
  const { user } = useUser();
  const { nav, pages } = translations;

  return useMemo(() => {
    const sections: { key: string; title: string; items: ItemDef[] }[] = [
      {
        key: "overview",
        title: nav.overview,
        items: [
          { key: "dashboard", to: admin(paths.home), label: nav.dashboard, Icon: navIcons.Dashboard },
          {
            key: "analytics",
            to: admin(paths.analytics),
            label: pages.analytics,
            Icon: navIcons.Analytics,
            resource: resources.analytics,
          },
        ],
      },
      {
        key: "projects",
        title: nav.projects,
        items: [
          {
            key: "projects",
            to: admin(paths.projects),
            label: pages.projects,
            Icon: navIcons.Projects,
            resource: resources.projects,
          },
          {
            key: "projectManagers",
            to: admin(paths.projectManagers),
            label: pages.projectManagers,
            Icon: navIcons.ProjectManagers,
            adminOnly: true,
          },
          { key: "sectors", to: admin(paths.sectors), label: pages.sectors, Icon: navIcons.Sectors, adminOnly: true },
        ],
      },
      {
        key: "salesPurchasing",
        title: nav.salesPurchasing,
        items: [
          {
            key: "salesOrders",
            to: admin(paths.home, paths.salesOrders),
            label: pages.salesOrders,
            Icon: navIcons.SalesOrders,
          },
          {
            key: "purchaseRequisitions",
            to: admin(paths.home, paths.purchaseRequisitions),
            label: pages.purchaseRequisitions,
            Icon: navIcons.PurchaseRequisitions,
            resource: resources.purchaseRequisitions,
          },
          {
            key: "purchaseOrders",
            to: admin(paths.home, paths.purchaseOrders),
            label: pages.purchaseOrders,
            Icon: navIcons.PurchaseOrders,
            resource: resources.purchaseOrders,
          },
          { key: "customers", to: admin(paths.home, paths.customers), label: pages.customers, Icon: navIcons.Customers },
          {
            key: "vendors",
            to: admin(paths.home, paths.vendors),
            label: pages.vendors,
            Icon: navIcons.Vendors,
            resource: resources.vendors,
          },
        ],
      },
      {
        key: "inventory",
        title: nav.inventory,
        items: [
          {
            key: "products",
            to: admin(paths.home, paths.products),
            label: pages.products,
            Icon: navIcons.Products,
            resource: resources.products,
          },
          {
            key: "warehouses",
            to: admin(paths.home, paths.warehouses),
            label: pages.warehouses,
            Icon: navIcons.Warehouses,
            resource: resources.warehouses,
          },
          {
            key: "transfers",
            to: admin(paths.home, paths.transfers),
            label: pages.transfers,
            Icon: navIcons.Transfers,
            resource: resources.transfers,
          },
          {
            key: "categories",
            to: admin(paths.categories),
            label: pages.categories,
            Icon: navIcons.Categories,
            resource: resources.categories,
          },
        ],
      },
      {
        key: "accounting",
        title: nav.accounting,
        items: [
          {
            key: "journalEntries",
            to: admin(paths.journalEntries),
            label: pages.journalEntries,
            Icon: navIcons.JournalEntries,
            resource: resources.journalEntries,
          },
          {
            key: "accounts",
            to: admin(paths.accounts),
            label: pages.accounts,
            Icon: navIcons.Accounts,
            resource: resources.accounts,
          },
          {
            key: "advancedPayments",
            to: admin(paths.advancedPayments),
            label: pages.advancedPayments,
            Icon: navIcons.AdvancedPayments,
            resource: resources.advancedPayments,
          },
          {
            key: "shareholders",
            to: admin(paths.shareholders),
            label: pages.shareholders,
            Icon: navIcons.Shareholders,
            resource: resources.shareholders,
          },
          {
            key: "accountingPeriods",
            to: admin(paths.accountingPeriods),
            label: pages.accountingPeriods,
            Icon: navIcons.AccountingPeriods,
            adminOnly: true,
          },
        ],
      },
      {
        key: "assetsExpenses",
        title: nav.assetsExpenses,
        items: [
          { key: "expenses", to: admin(paths.home, paths.expenses), label: pages.expenses, Icon: navIcons.Expenses },
          {
            key: "expenseCategories",
            to: admin(paths.expenseCategories),
            label: pages.expenseCategories,
            Icon: navIcons.ExpenseCategories,
            adminOnly: true,
          },
          {
            key: "fixedAssets",
            to: admin(paths.fixedAssets),
            label: pages.fixedAssets,
            Icon: navIcons.FixedAssets,
            resource: resources.fixedAssets,
          },
        ],
      },
      {
        key: "reports",
        title: nav.reports,
        items: [
          {
            key: "financialReports",
            to: admin(paths.financialReports),
            label: nav.allReports,
            Icon: navIcons.Reports,
            resource: resources.reports,
          },
          {
            key: "trialBalance",
            to: report("trial-balance"),
            label: nav.trialBalance,
            Icon: navIcons.TrialBalance,
            resource: resources.reports,
          },
          {
            key: "generalLedger",
            to: report("general-ledger"),
            label: nav.generalLedger,
            Icon: navIcons.GeneralLedger,
            resource: resources.reports,
          },
          {
            key: "projectProfitAnalysis",
            to: report("project-profit-analysis"),
            label: nav.projectProfitAnalysis,
            Icon: navIcons.ProjectProfit,
            resource: resources.reports,
          },
        ],
      },
      {
        // System-level work, kept apart from daily operations and accounting.
        key: "administration",
        title: nav.administration,
        items: [
          { key: "backup", to: admin(paths.backup), label: nav.backupRestore, Icon: navIcons.Backup, adminOnly: true },
          { key: "users", to: admin(paths.users), label: nav.users, Icon: navIcons.Users, adminOnly: true },
        ],
      },
    ];

    const canSee = (item: ItemDef) =>
      item.adminOnly ? !!user && isAdmin(user.role) : !item.resource || hasPermission(user, item.resource, actions.read);
    return sections
      .map((s) => ({
        key: s.key,
        title: s.title,
        items: s.items.filter(canSee).map(({ key, to, label, Icon }) => ({ key, to, label, Icon })),
      }))
      .filter((s) => s.items.length > 0);
  }, [nav, pages, user]);
}

/**
 * The one item the current URL belongs to: the item whose path is the longest prefix of the URL on
 * a segment boundary - so a detail page (/projects/123) selects its list, a pinned report selects
 * itself rather than "All Financial Reports", and two unrelated items are never active together.
 */
export function activeItemKey(sections: NavSection[], pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "");
  let best: NavItem | null = null;
  for (const item of sections.flatMap((s) => s.items)) {
    const matches = path === item.to || path.startsWith(`${item.to}/`);
    if (matches && (!best || item.to.length > best.to.length)) best = item;
  }
  return best?.key ?? null;
}
