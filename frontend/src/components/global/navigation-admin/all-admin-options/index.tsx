import { IconType } from "react-icons";
import { useNavigate } from "react-router-dom";
import { useMantineColorScheme } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { outlineIcons } from "@/components/icons";
import paths from "@/utils/constants/paths";
import { useUser } from "@/context/UserContext";
import { isAdmin } from "@/utils/constants/roles";
import AdminButton from "./components/admin-button";
import AdminNavLink from "./components/admin-nav-link";
import { useTour } from "@/components/global/guided-tour/tour-context";

export type Link = { to: string; label: string; Icon?: IconType; nestedLinks?: Link[] };

// Cycles Light -> Dark -> Auto (system) -> Light.
const NEXT_COLOR_SCHEME = { light: "dark", dark: "auto", auto: "light" } as const;
const COLOR_SCHEME_ICON = { light: outlineIcons.Sun, dark: outlineIcons.Moon, auto: outlineIcons.Computer };

export default function AllAdminOptions({
  closeDrawer,
  collapsed = false,
}: {
  closeDrawer?: () => void;
  collapsed?: boolean;
}) {
  const { translate, translations, toggleLanguage } = useLanguage();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const { user } = useUser();

  const navigate = useNavigate();
  const { start: startTour } = useTour();

  const colorSchemeLabel = translate(
    { light: "Light Theme", dark: "Dark Theme", auto: "System Theme" }[colorScheme],
    { light: "المظهر الفاتح", dark: "المظهر الداكن", auto: "مظهر النظام" }[colorScheme],
  );

  const links: Link[] = [
    {
      to: `${paths.admin}/${paths.home}`,
      label: translations.pages.home,
      Icon: outlineIcons.Home,
      nestedLinks: [
        {
          to: `${paths.admin}/${paths.home}/${paths.vendors}`,
          label: translations.pages.vendors,
        },
        {
          to: `${paths.admin}/${paths.home}/${paths.purchaseOrders}`,
          label: translations.pages.purchaseOrders,
        },
        {
          to: `${paths.admin}/${paths.home}/${paths.products}`,
          label: translations.pages.products,
        },
        {
          to: `${paths.admin}/${paths.home}/${paths.salesOrders}`,
          label: translations.pages.salesOrders,
        },
        {
          to: `${paths.admin}/${paths.home}/${paths.customers}`,
          label: translations.pages.customers,
        },
        {
          to: `${paths.admin}/${paths.home}/${paths.expenses}`,
          label: translations.pages.expenses,
        },
        {
          to: `${paths.admin}/${paths.home}/${paths.warehouses}`,
          label: translations.pages.warehouses,
        },
        {
          to: `${paths.admin}/${paths.home}/${paths.transfers}`,
          label: translations.pages.transfers,
        },
      ],
    },
    {
      to: `${paths.admin}/${paths.analytics}`,
      label: translations.pages.analytics,
      Icon: outlineIcons.Analytics,
    },
    {
      to: `${paths.admin}/${paths.reports}`,
      label: translations.pages.reports,
      Icon: outlineIcons.ChartBar,
    },
    {
      to: `${paths.admin}/${paths.financialReports}`,
      label: translations.pages.financialReports,
      Icon: outlineIcons.ChartBar,
    },
    {
      to: `/${paths.admin}/${paths.fixedAssets}`,
      label: translations.pages.fixedAssets,
      Icon: outlineIcons.FixedAssets,
    },
    {
      to: `/${paths.admin}/${paths.projects}`,
      label: translations.pages.projects,
      Icon: outlineIcons.Projects,
    },
    // Sector management is admin-only (see the RoleGuard around its route in App.tsx).
    ...(user && isAdmin(user.role)
      ? [{ to: `/${paths.admin}/${paths.sectors}`, label: translations.pages.sectors, Icon: outlineIcons.Building }]
      : []),
    // Administrator controls (see the RoleGuard around their routes in App.tsx).
    ...(user && isAdmin(user.role)
      ? [
          {
            to: `/${paths.admin}/${paths.accountingPeriods}`,
            label: translations.pages.accountingPeriods,
            Icon: outlineIcons.Clock,
          },
          {
            to: `/${paths.admin}/${paths.expenseCategories}`,
            label: translations.pages.expenseCategories,
            Icon: outlineIcons.Squares,
          },
        ]
      : []),
    {
      to: `/${paths.admin}/${paths.accounts}`,
      label: translations.pages.accounts,
      Icon: outlineIcons.Accounts,
    },
    {
      to: `/${paths.admin}/${paths.journalEntries}`,
      label: translations.pages.journalEntries,
      Icon: outlineIcons.JournalEntries,
    },
    {
      to: `/${paths.admin}/${paths.advancedPayments}`,
      label: translations.pages.advancedPayments,
      Icon: outlineIcons.DollarSign,
    },
    {
      to: `/${paths.admin}/${paths.shareholders}`,
      label: translations.pages.shareholders,
      Icon: outlineIcons.Users,
    },
    // {
    //   to: `${paths.admin}/${paths.cash}`,
    //   label: translations.pages.cash,
    //   Icon: outlineIcons.DollarSign,
    // },
    // {
    //   to: `${paths.admin}/${paths.currencies}`,
    //   label: translations.pages.currencies,
    //   Icon: outlineIcons.DollarSign,
    // },
    {
      to: `${paths.admin}/${paths.categories}`,
      label: translations.pages.categories,
      Icon: outlineIcons.Squares,
    },
    // {
    //   to: `${paths.admin}/${paths.coupons}`,
    //   label: translations.pages.coupons,
    //   Icon: outlineIcons.Coupon,
    // },
    // {
    //   to: `${paths.admin}/${paths.customization}`,
    //   label: translations.pages.customization,
    //   Icon: outlineIcons.Computer,
    // },
    // {
    //   to: `${paths.admin}/${paths.governorates}`,
    //   label: translations.pages.governorates,
    //   Icon: outlineIcons.Shipping,
    // },
    // {
    //   to: `${paths.admin}/${paths.transactions}`,
    //   label: translations.pages.transactions,
    //   Icon: outlineIcons.Transaction,
    // },
    // {
    //   to: `${paths.admin}/${paths.users}`,
    //   label: translations.pages.users,
    //   Icon: outlineIcons.Users,
    // },
  ];

  return (
    <div className="flex h-full flex-col justify-between gap-2">
      <nav className="flex flex-1 flex-col py-2">
        {links.map((link) => (
          <AdminNavLink key={link.to} link={link} onClick={closeDrawer} collapsed={collapsed} />
        ))}
      </nav>

      {/* Pinned to the bottom of the sidebar, also while the menu scrolls. */}
      <footer className="sticky bottom-0 flex flex-col gap-1 border-t border-gray-100 bg-white py-2">
        <AdminButton
          Icon={outlineIcons.Compass}
          label="Make a tour"
          onClick={() => {
            closeDrawer && closeDrawer();
            startTour();
          }}
          collapsed={collapsed}
          dataTour="make-a-tour"
          highlighted
        />
        <AdminButton
          Icon={COLOR_SCHEME_ICON[colorScheme]}
          label={colorSchemeLabel}
          onClick={() => setColorScheme(NEXT_COLOR_SCHEME[colorScheme])}
          collapsed={collapsed}
        />
        <AdminButton
          Icon={outlineIcons.Globe}
          label={translate("عربي", "English")}
          onClick={toggleLanguage}
          collapsed={collapsed}
        />
        <hr />
        <AdminButton
          Icon={outlineIcons.ArrowUpCircle}
          label={translations.exit}
          onClick={() => {
            closeDrawer && closeDrawer();
            navigate("/");
          }}
          collapsed={collapsed}
        />
      </footer>
    </div>
  );
}
