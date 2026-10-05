import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useHasPermission from "@/hooks/useHasPermission";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import paths from "@/utils/constants/paths";
import { outlineIcons } from "@/components/icons";
import SectionCard from "@/components/ui/section-card";

// Quick Actions (docs section "Quick Actions") - plain navigation shortcuts to the app's EXISTING
// create flows (a dedicated /new route for Sales/Purchase Orders, the relevant list page itself
// for Projects/Journal Entries/Advanced Payments/Chart of Accounts, where creation is a modal on
// that page already) - never a second/duplicate form. Each action is hidden unless the current
// user actually has the matching permission (docs section "Do not expose actions the current user
// is not authorized to perform").
export default function QuickActionsSection() {
  const { translate } = useLanguage();

  const canCreateProjects = useHasPermission(resources.projects, actions.create);
  const canCreateSalesOrders = useHasPermission(resources.salesOrders, actions.create);
  const canCreatePurchaseOrders = useHasPermission(resources.purchaseOrders, actions.create);
  const canReadJournalEntries = useHasPermission(resources.journalEntries, actions.read);
  const canReadAdvancedPayments = useHasPermission(resources.advancedPayments, actions.read);
  const canReadAccounts = useHasPermission(resources.accounts, actions.read);

  const actionsList = [
    canCreateSalesOrders && {
      to: `/${paths.admin}/${paths.home}/${paths.salesOrders}/${paths.new}`,
      label: translate("New Sales Order", "طلب مبيعات جديد"),
      icon: outlineIcons.ShoppingCart,
    },
    canCreatePurchaseOrders && {
      to: `/${paths.admin}/${paths.home}/${paths.purchaseOrders}/${paths.new}`,
      label: translate("New Purchase Order", "طلب شراء جديد"),
      icon: outlineIcons.ShoppingBag,
    },
    canCreateProjects && {
      to: `/${paths.admin}/${paths.projects}`,
      label: translate("Create Project", "إنشاء مشروع"),
      icon: outlineIcons.Projects,
    },
    canReadAdvancedPayments && {
      to: `/${paths.admin}/${paths.advancedPayments}`,
      label: translate("Advanced Payments", "الدفعات المقدمة"),
      icon: outlineIcons.DollarSign,
    },
    canReadJournalEntries && {
      to: `/${paths.admin}/${paths.journalEntries}`,
      label: translate("Journal Entries", "القيود اليومية"),
      icon: outlineIcons.JournalEntries,
    },
    canReadAccounts && {
      to: `/${paths.admin}/${paths.accounts}`,
      label: translate("Chart of Accounts", "دليل الحسابات"),
      icon: outlineIcons.Accounts,
    },
  ].filter(Boolean) as { to: string; label: string; icon: typeof outlineIcons.Document }[];

  if (actionsList.length === 0) return null;

  return (
    <SectionCard title={translate("Quick Actions", "إجراءات سريعة")}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {actionsList.map((action) => (
          <Link
            key={action.to + action.label}
            to={action.to}
            className="flex flex-col items-center gap-2 rounded-lg border border-gray-100 px-3 py-4 text-center transition-colors hover:border-primary-200 hover:bg-primary-50 dark:border-gray-700 dark:hover:border-primary-700 dark:hover:bg-gray-700"
          >
            <action.icon size={20} className="text-primary-600 dark:text-primary-400" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{action.label}</span>
          </Link>
        ))}
      </div>
    </SectionCard>
  );
}
