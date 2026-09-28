import { IconType } from "react-icons";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { outlineIcons } from "@/components/icons";
import paths from "@/utils/constants/paths";
import AdminButton from "./components/admin-button";
import AdminNavLink from "./components/admin-nav-link";

export type Link = { to: string; label: string; Icon?: IconType; nestedLinks?: Link[] };

export default function AllAdminOptions({ closeDrawer }: { closeDrawer?: () => void }) {
  const { translate, translations, toggleLanguage } = useLanguage();

  const navigate = useNavigate();

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
      to: `${paths.admin}/${paths.cash}`,
      label: translations.pages.cash,
      Icon: outlineIcons.DollarSign,
    },
    {
      to: `${paths.admin}/${paths.currencies}`,
      label: translations.pages.currencies,
      Icon: outlineIcons.DollarSign,
    },
    {
      to: `${paths.admin}/${paths.categories}`,
      label: translations.pages.categories,
      Icon: outlineIcons.Squares,
    },
    {
      to: `${paths.admin}/${paths.coupons}`,
      label: translations.pages.coupons,
      Icon: outlineIcons.Coupon,
    },
    {
      to: `${paths.admin}/${paths.customization}`,
      label: translations.pages.customization,
      Icon: outlineIcons.Computer,
    },
    {
      to: `${paths.admin}/${paths.governorates}`,
      label: translations.pages.governorates,
      Icon: outlineIcons.Shipping,
    },
    {
      to: `${paths.admin}/${paths.transactions}`,
      label: translations.pages.transactions,
      Icon: outlineIcons.Transaction,
    },
    {
      to: `${paths.admin}/${paths.users}`,
      label: translations.pages.users,
      Icon: outlineIcons.Users,
    },
    {
      to: `/${paths.admin}/${paths.fixedAssets}`,
      label: translations.pages.fixedAssets,
      Icon: outlineIcons.FixedAssets,
    },
  ];

  return (
    <div className="flex h-full flex-col justify-between gap-2">
      <nav className="flex flex-1 flex-col py-2">
        {links.map((link) => (
          <AdminNavLink key={link.to} link={link} onClick={closeDrawer} />
        ))}
      </nav>

      <footer className="flex flex-col gap-1 py-2">
        <AdminButton Icon={outlineIcons.Globe} label={translate("عربي", "English")} onClick={toggleLanguage} />
        <hr />
        <AdminButton
          Icon={outlineIcons.ArrowUpCircle}
          label={translations.back}
          onClick={() => {
            closeDrawer && closeDrawer();
            navigate("/");
          }}
        />
      </footer>
    </div>
  );
}
