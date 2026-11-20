import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";
import useColorScheme from "@/hooks/useColorScheme";
import LoadingSection from "@/components/ui/sections/loading";
import paths from "@/utils/constants/paths";
import roles from "@/utils/constants/roles";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";

// Routing Pages
const Layout = lazy(() => import("@/pages/routes/layout"));
const AdminLayout = lazy(() => import("@/pages/routes/layout-admin"));
const CrmLayout = lazy(() => import("@/pages/routes/layout-crm"));
const CommercialLayout = lazy(() => import("@/pages/routes/layout-commercial"));
const WebsiteLayout = lazy(() => import("@/pages/routes/layout-website"));
const HrPortal = lazy(() => import("@/pages/hr"));
import NotFound from "@/pages/routes/not-found";
import AuthGaurd from "@/pages/routes/auth-gaurd";
import RoleGuard from "@/pages/routes/role-guard";
import ResourceGuard from "@/pages/routes/resource-guard";
import SystemGuard from "@/pages/routes/system-guard";
import PlatformAdminGuard from "@/pages/routes/platform-admin-guard";
import PortalAccessGuard from "@/pages/routes/portal-access-guard";
import LegacyPrefixRedirect from "@/pages/routes/legacy-prefix-redirect";

// Auth Pages
const Login = lazy(() => import("@/pages/outer/login"));
const ForgotPassword = lazy(() => import("@/pages/outer/forgot-password"));
const VerifyCode = lazy(() => import("@/pages/outer/verify-code"));
const ResetPassword = lazy(() => import("@/pages/outer/reset-password"));

// Account Page
const Profile = lazy(() => import("@/pages/inner/profile"));

// Central Business Portal
const Portal = lazy(() => import("@/pages/portal"));
const PlatformAdminUsers = lazy(() => import("@/pages/portal/admin/users"));
const PlatformAdminUser = lazy(() => import("@/pages/portal/admin/users/[id]"));

// Admin Panel Pages
const Admin = lazy(() => import("@/pages/admin"));
const AP_Home = lazy(() => import("@/pages/admin/home"));
const AP_Vendors = lazy(() => import("@/pages/admin/home/vendors"));
const AP_Vendor = lazy(() => import("@/pages/admin/home/vendors/[id]"));
const AP_PurchaseOrders = lazy(() => import("@/pages/admin/home/purchase-orders"));
const AP_PurchaseOrder = lazy(() => import("@/pages/admin/home/purchase-orders/[id]"));
const AP_NewPurchaseOrder = lazy(() => import("@/pages/admin/home/purchase-orders/new"));
const AP_PurchaseRequisitions = lazy(() => import("@/pages/admin/home/purchase-requisitions"));
const AP_PurchaseRequisition = lazy(() => import("@/pages/admin/home/purchase-requisitions/[id]"));
const AP_NewPurchaseRequisition = lazy(() => import("@/pages/admin/home/purchase-requisitions/new"));
const AP_Products = lazy(() => import("@/pages/admin/home/products"));
const AP_Product = lazy(() => import("@/pages/admin/home/products/[id]"));
const AP_ProductTransactions = lazy(() => import("@/pages/admin/home/products/[id]/transactions"));
const AP_NewProduct = lazy(() => import("@/pages/admin/home/products/new"));
const AP_SalesOrders = lazy(() => import("@/pages/admin/home/sales-orders"));
const AP_SalesOrder = lazy(() => import("@/pages/admin/home/sales-orders/[id]"));
const AP_NewSalesOrder = lazy(() => import("@/pages/admin/home/sales-orders/new"));
const AP_Customers = lazy(() => import("@/pages/admin/home/customers"));
const AP_Customer = lazy(() => import("@/pages/admin/home/customers/[id]"));
const AP_Expenses = lazy(() => import("@/pages/admin/home/expenses"));
const AP_Expense = lazy(() => import("@/pages/admin/home/expenses/[id]"));
const AP_Warehouses = lazy(() => import("@/pages/admin/home/warehouses"));
const AP_ProjectInventory = lazy(() => import("@/pages/admin/home/project-inventory"));
const AP_Transfers = lazy(() => import("@/pages/admin/home/transfers"));
const AP_Transfer = lazy(() => import("@/pages/admin/home/transfers/[id]"));
const AP_Reports = lazy(() => import("@/pages/admin/reports"));
const AP_VendorsReport = lazy(() => import("@/pages/admin/reports/vendors"));
const AP_CustomersReport = lazy(() => import("@/pages/admin/reports/customers"));
const AP_PurchaseOrdersReport = lazy(() => import("@/pages/admin/reports/purchase-orders"));
const AP_SalesOrdersReport = lazy(() => import("@/pages/admin/reports/sales-orders"));
const AP_ProductsReport = lazy(() => import("@/pages/admin/reports/products"));
const AP_InventoryTransferReport = lazy(() => import("@/pages/admin/reports/inventory-transfer"));
const AP_InventorySummaryReport = lazy(() => import("@/pages/admin/reports/inventory-summary"));
const AP_ExpensesReport = lazy(() => import("@/pages/admin/reports/expenses"));
const AP_PaymentsReport = lazy(() => import("@/pages/admin/reports/payments"));
const AP_VariantHistoryReport = lazy(() => import("@/pages/admin/reports/variant-history"));
const AP_TreasuryBalanceReport = lazy(() => import("@/pages/admin/reports/treasury-balance"));
const AP_ProfitBySalesReport = lazy(() => import("@/pages/admin/reports/profit-by-sales"));
const AP_ProfitByCustomerReport = lazy(() => import("@/pages/admin/reports/profit-by-customer"));
const AP_ProfitByProductReport = lazy(() => import("@/pages/admin/reports/profit-by-product"));
const AP_Cash = lazy(() => import("@/pages/admin/cash"));
const AP_Currencies = lazy(() => import("@/pages/admin/currencies"));
const AP_Categories = lazy(() => import("@/pages/admin/categories"));
// Hidden pages (their routes are commented out below) - imports kept here, commented, to restore together.
// import AP_Coupons from "@/pages/admin/coupons";
// import AP_Customization from "@/pages/admin/customization";
// import AP_Governorates from "@/pages/admin/governorates";
const AP_Transactions = lazy(() => import("@/pages/admin/transactions"));
const AP_Transaction = lazy(() => import("@/pages/admin/transactions/[id]"));
const AP_Users = lazy(() => import("@/pages/admin/users"));
const AP_User = lazy(() => import("@/pages/admin/users/[id]"));
const ReturnsReport = lazy(() => import("@/pages/admin/reports/returns"));
const IncomeStatementReport = lazy(() => import("@/pages/admin/reports/income-statement"));
const AP_FixedAssets = lazy(() => import("@/pages/admin/fixed-assets"));
const AP_FixedAsset = lazy(() => import("@/pages/admin/fixed-assets/[id]"));
const AP_FixedAssetsReport = lazy(() => import("@/pages/admin/reports/fixed-assets"));
const AP_BalanceSheetReport = lazy(() => import("@/pages/admin/reports/balance-sheet"));
const AP_Analytics = lazy(() => import("@/pages/admin/analytics"));
const AP_CashFlowForecast = lazy(() => import("@/pages/admin/cash-flow-forecast"));
const AP_ProjectCashFlowForecast = lazy(() => import("@/pages/admin/cash-flow-forecast/[projectId]"));
const AP_Projects = lazy(() => import("@/pages/admin/projects"));
const AP_Project = lazy(() => import("@/pages/admin/projects/[id]"));
const AP_Sectors = lazy(() => import("@/pages/admin/sectors"));
const AP_ProjectManagers = lazy(() => import("@/pages/admin/project-managers"));
const AP_Backup = lazy(() => import("@/pages/admin/backup"));
const AP_AccountingPeriods = lazy(() => import("@/pages/admin/accounting-periods"));
const AP_ExpenseCategories = lazy(() => import("@/pages/admin/expense-categories"));
const AP_CompanySettings = lazy(() => import("@/pages/admin/company-settings"));
const AP_Accounts = lazy(() => import("@/pages/admin/accounts"));
const AP_AccountParentGroups = lazy(() => import("@/pages/admin/account-parent-groups"));
const AP_JournalEntries = lazy(() => import("@/pages/admin/journal-entries"));
const AP_JournalEntry = lazy(() => import("@/pages/admin/journal-entries/[id]"));
const AP_AdvancedPayments = lazy(() => import("@/pages/admin/advanced-payments"));
const AP_AdvancedPayment = lazy(() => import("@/pages/admin/advanced-payments/[id]"));
const AP_Shareholders = lazy(() => import("@/pages/admin/shareholders"));
const AP_FinancialReports = lazy(() => import("@/pages/admin/financial-reports"));
const AP_FinancialReport = lazy(() => import("@/pages/admin/financial-reports/[key]"));
const AP_Shareholder = lazy(() => import("@/pages/admin/shareholders/[id]"));

// Reservia CRM Pages
const Crm = lazy(() => import("@/pages/crm"));
const CRM_Dashboard = lazy(() => import("@/pages/crm/dashboard"));
const CRM_Pipeline = lazy(() => import("@/pages/crm/pipeline"));
const CRM_Leads = lazy(() => import("@/pages/crm/leads"));
const CRM_Lead = lazy(() => import("@/pages/crm/leads/[id]"));
const CRM_Performance = lazy(() => import("@/pages/crm/performance"));
const CRM_Integrations = lazy(() => import("@/pages/crm/integrations"));
import CrmRoleGuard from "@/pages/routes/crm-role-guard";

// Reservia Commercial Pages
const Commercial = lazy(() => import("@/pages/commercial"));
const COM_Dashboard = lazy(() => import("@/pages/commercial/dashboard"));
const COM_Projects = lazy(() => import("@/pages/commercial/projects"));
const COM_Project = lazy(() => import("@/pages/commercial/projects/[id]"));
const COM_Materials = lazy(() => import("@/pages/commercial/materials"));
const COM_PricingConfig = lazy(() => import("@/pages/commercial/pricing-config"));
const COM_Suppliers = lazy(() => import("@/pages/commercial/suppliers"));
const COM_Supplier = lazy(() => import("@/pages/commercial/suppliers/[id]"));

// Website Management Pages
const WebsiteOverview = lazy(() => import("@/pages/website"));
const WebsitePages = lazy(() => import("@/pages/website/pages"));
const WebsitePageEditor = lazy(() => import("@/pages/website/pages/[id]"));
const WebsiteBlogPosts = lazy(() => import("@/pages/website/blog"));
const WebsiteBlogPostEditor = lazy(() => import("@/pages/website/blog/[id]"));
const WebsiteSettingsPage = lazy(() => import("@/pages/website/settings"));
import WebsiteRoleGuard from "@/pages/routes/website-role-guard";
const WebsiteMediaLibrary = lazy(() => import("@/pages/website/media"));
const WebsiteNavigationPage = lazy(() => import("@/pages/website/navigation"));
const WebsiteIntegrationsPage = lazy(() => import("@/pages/website/integrations"));
const WebsiteCustomCodePage = lazy(() => import("@/pages/website/custom-code"));
const WebsiteActivityPage = lazy(() => import("@/pages/website/activity"));
const WebsiteVisualEditor = lazy(() => import("@/pages/website/visual-editor"));
const WebsiteCodeWorkspace = lazy(() => import("@/pages/website/code"));

export default function App() {
  useColorScheme();

  return (
    <Router>
      <Suspense fallback={<LoadingSection className="min-h-screen" />}>
      <Routes>
        <Route element={<Layout />}>
          {/* Root: send straight into the app - AuthGaurd/RoleGuard below route it to
              /login, /profile, or /portal depending on auth state and role. */}
          <Route index element={<Navigate to={`/${paths.portal}`} replace />} />

          {/* Auth Pages (require logged out) */}
          <Route element={<AuthGaurd requireLoggedIn={false} />}>
            <Route path={paths.login} element={<Login />} />
            <Route path={paths.forgotPassword} element={<ForgotPassword />} />
            <Route path={paths.verifyCode} element={<VerifyCode />} />
            <Route path={paths.resetPassword} element={<ResetPassword />} />
          </Route>

          {/* Account Page (require logged in) */}
          <Route element={<AuthGaurd requireLoggedIn={true} />}>
            <Route path={paths.profile} element={<Profile />} />
          </Route>

          {/* Central Business Portal (docs section "Central Business Portal") - the common entry
              point for staff after login. Customers (role: user, no system access) are out of
              scope - gated by PortalAccessGuard (platform admin, a legacy ERP role, or ANY active
              system membership), not by the ERP role enum alone (pre-launch audit, 22 Nov 2026 -
              that excluded a CRM/Deal-Engine-only staff member, who also has role: 'user'). */}
          <Route element={<AuthGaurd requireLoggedIn={true} />}>
            <Route element={<PortalAccessGuard />}>
              <Route path={paths.portal} element={<Portal />} />
              <Route element={<PlatformAdminGuard />}>
                <Route path={`${paths.portal}/${paths.platformAdmin}/${paths.users}`} element={<PlatformAdminUsers />} />
                <Route path={`${paths.portal}/${paths.platformAdmin}/${paths.users}/:id`} element={<PlatformAdminUser />} />
              </Route>
            </Route>
          </Route>

          {/* Admin Layout Pages (Pages that require user to be admin or moderator) */}
          <Route element={<AuthGaurd requireLoggedIn={true} />}>
            <Route element={<RoleGuard allowedRoles={[roles.admin.value, roles.moderator.value, roles.operator.value]} />}>
              {/* Defense in depth: the backend is the real authority (checkUserPermissions/
                  allowedTo now require active ERP membership on every request) - this additionally
                  stops the route tree itself from rendering once membership is revoked, not just
                  the Portal card. */}
              <Route element={<SystemGuard systemId="ERP" />}>
              <Route element={<AdminLayout />}>
                <Route path={paths.admin} element={<Admin />}>
                  <Route path={paths.home}>
                    <Route index element={<AP_Home />} />
                    <Route element={<ResourceGuard resource={resources.vendors} action={actions.read} />}>
                      <Route path={paths.vendors} element={<AP_Vendors />} />
                      <Route path={paths.vendors + "/:id"} element={<AP_Vendor />} />
                    </Route>
                    <Route element={<ResourceGuard resource={resources.purchaseRequisitions} action={actions.read} />}>
                      <Route path={paths.purchaseRequisitions} element={<AP_PurchaseRequisitions />} />
                      <Route path={paths.purchaseRequisitions + "/:id"} element={<AP_PurchaseRequisition />} />
                      <Route element={<ResourceGuard resource={resources.purchaseRequisitions} action={actions.create} />}>
                        <Route path={paths.purchaseRequisitions + "/" + paths.new} element={<AP_NewPurchaseRequisition />} />
                      </Route>
                    </Route>
                    <Route element={<ResourceGuard resource={resources.purchaseOrders} action={actions.read} />}>
                      <Route path={paths.purchaseOrders} element={<AP_PurchaseOrders />} />
                      <Route path={paths.purchaseOrders + "/:id"} element={<AP_PurchaseOrder />} />
                      <Route element={<ResourceGuard resource={resources.purchaseOrders} action={actions.create} />}>
                        <Route path={paths.purchaseOrders + "/" + paths.new} element={<AP_NewPurchaseOrder />} />
                      </Route>
                    </Route>
                    <Route element={<ResourceGuard resource={resources.products} action={actions.read} />}>
                      <Route path={paths.products} element={<AP_Products />} />
                      <Route path={paths.products + "/:id"} element={<AP_Product />} />
                      <Route path={paths.products + "/:id/" + paths.transactions} element={<AP_ProductTransactions />} />
                      <Route element={<ResourceGuard resource={resources.products} action={actions.create} />}>
                        <Route path={paths.products + "/" + paths.new} element={<AP_NewProduct />} />
                      </Route>
                    </Route>

                    {/* Sales orders (read) routes are not protected by the ResourceGuard component */}
                    <Route path={paths.salesOrders} element={<AP_SalesOrders />} />
                    <Route path={paths.salesOrders + "/:id"} element={<AP_SalesOrder />} />
                    <Route element={<ResourceGuard resource={resources.salesOrders} action={actions.create} />}>
                      <Route path={paths.salesOrders + "/" + paths.new} element={<AP_NewSalesOrder />} />
                    </Route>

                    {/* Customers (read) routes are not protected by the ResourceGuard component */}
                    <Route path={paths.customers} element={<AP_Customers />} />
                    <Route path={paths.customers + "/:id"} element={<AP_Customer />} />

                    {/* Expenses (read) route is not protected by the ResourceGuard component */}
                    <Route path={paths.expenses} element={<AP_Expenses />} />
                    <Route path={paths.expenses + "/:id"} element={<AP_Expense />} />

                    <Route element={<ResourceGuard resource={resources.warehouses} action={actions.read} />}>
                      <Route path={paths.warehouses} element={<AP_Warehouses />} />
                    </Route>
                    <Route element={<ResourceGuard resource={resources.projects} action={actions.read} />}>
                      <Route path={paths.projectInventory} element={<AP_ProjectInventory />} />
                    </Route>
                    <Route element={<ResourceGuard resource={resources.transfers} action={actions.read} />}>
                      <Route path={paths.transfers} element={<AP_Transfers />} />
                      <Route path={paths.transfers + "/:id"} element={<AP_Transfer />} />
                    </Route>
                  </Route>

                  <Route element={<ResourceGuard resource={resources.reports} action={actions.read} />}>
                    <Route path={paths.reports} element={<AP_Reports />} />
                    <Route path={paths.financialReports} element={<AP_FinancialReports />} />
                    <Route path={paths.financialReports + "/:key"} element={<AP_FinancialReport />} />
                    <Route path={`${paths.reports}/${paths.vendors}`} element={<AP_VendorsReport />} />
                    <Route path={`${paths.reports}/${paths.customers}`} element={<AP_CustomersReport />} />
                    <Route path={`${paths.reports}/${paths.purchaseOrders}`} element={<AP_PurchaseOrdersReport />} />
                    <Route path={`${paths.reports}/${paths.salesOrders}`} element={<AP_SalesOrdersReport />} />
                    <Route path={`${paths.reports}/${paths.products}`} element={<AP_ProductsReport />} />
                    <Route path={`${paths.reports}/${paths.inventoryTransfer}`} element={<AP_InventoryTransferReport />} />
                    <Route path={`${paths.reports}/${paths.inventorySummary}`} element={<AP_InventorySummaryReport />} />
                    <Route path={`${paths.reports}/${paths.expenses}`} element={<AP_ExpensesReport />} />
                    <Route path={`${paths.reports}/${paths.payments}`} element={<AP_PaymentsReport />} />
                    <Route path={`${paths.reports}/${paths.variantHistory}`} element={<AP_VariantHistoryReport />} />
                    <Route path={`${paths.reports}/${paths.treasuryBalance}`} element={<AP_TreasuryBalanceReport />} />
                    <Route path={`${paths.reports}/${paths.profitBySales}`} element={<AP_ProfitBySalesReport />} />
                    <Route path={`${paths.reports}/${paths.profitByCustomer}`} element={<AP_ProfitByCustomerReport />} />
                    <Route path={`${paths.reports}/${paths.profitByProduct}`} element={<AP_ProfitByProductReport />} />
                    <Route path={`${paths.reports}/${paths.returns}`} element={<ReturnsReport />} />
                    <Route path={`${paths.reports}/${paths.fixedAssets}`} element={<AP_FixedAssetsReport />} />
                    <Route path={`${paths.reports}/${paths.balanceSheet}`} element={<AP_BalanceSheetReport />} />
                    <Route path={`${paths.reports}/${paths.incomeStatement}`} element={<IncomeStatementReport />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.cash} action={actions.read} />}>
                    <Route path={paths.cash} element={<AP_Cash />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.currencies} action={actions.read} />}>
                    <Route path={paths.currencies} element={<AP_Currencies />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.categories} action={actions.read} />}>
                    <Route path={paths.categories} element={<AP_Categories />} />
                  </Route>
                  {/* <Route element={<ResourceGuard resource={resources.coupons} action={actions.read} />}>
                    <Route path={paths.coupons} element={<AP_Coupons />} />
                  </Route> */}
                  {/* <Route element={<ResourceGuard resource={resources.customization} action={actions.read} />}>
                    <Route path={paths.customization} element={<AP_Customization />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.governorates} action={actions.read} />}>
                    <Route path={paths.governorates} element={<AP_Governorates />} />
                  </Route> */}
                  <Route element={<ResourceGuard resource={resources.transactions} action={actions.read} />}>
                    <Route path={paths.transactions} element={<AP_Transactions />} />
                    <Route path={paths.transactions + "/:id"} element={<AP_Transaction />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.users} action={actions.read} />}>
                    <Route path={paths.users} element={<AP_Users />} />
                    <Route path={paths.users + "/:id"} element={<AP_User />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.fixedAssets} action={actions.read} />}>
                    <Route path={paths.fixedAssets} element={<AP_FixedAssets />} />
                    <Route path={paths.fixedAssets + "/:id"} element={<AP_FixedAsset />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.analytics} action={actions.read} />}>
                    <Route path={paths.analytics} element={<AP_Analytics />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.cashFlowForecast} action={actions.read} />}>
                    <Route path={paths.cashFlowForecast} element={<AP_CashFlowForecast />} />
                    <Route path={paths.cashFlowForecast + "/:projectId"} element={<AP_ProjectCashFlowForecast />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.projects} action={actions.read} />}>
                    <Route path={paths.projects} element={<AP_Projects />} />
                    <Route path={paths.projects + "/:id"} element={<AP_Project />} />
                  </Route>
                  {/* Sector management is admin-only (the API allows only admins to change sectors). */}
                  <Route element={<RoleGuard allowedRoles={[roles.admin.value]} />}>
                    <Route path={paths.sectors} element={<AP_Sectors />} />
                    <Route path={paths.projectManagers} element={<AP_ProjectManagers />} />
                    {/* Backup & Restore - every endpoint is admin-only on the server too. */}
                    <Route path={paths.backup} element={<AP_Backup />} />
                    {/* Closing / reopening periods and managing expense categories are administrator controls. */}
                    <Route path={paths.accountingPeriods} element={<AP_AccountingPeriods />} />
                    <Route path={paths.expenseCategories} element={<AP_ExpenseCategories />} />
                    {/* ERP company controls: VAT default, price variance warning, negative project stock. */}
                    <Route path={paths.companySettings} element={<AP_CompanySettings />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.accounts} action={actions.read} />}>
                    <Route path={paths.accounts} element={<AP_Accounts />} />
                    <Route path={paths.accountParentGroups} element={<AP_AccountParentGroups />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.journalEntries} action={actions.read} />}>
                    <Route path={paths.journalEntries} element={<AP_JournalEntries />} />
                    <Route path={paths.journalEntries + "/:id"} element={<AP_JournalEntry />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.advancedPayments} action={actions.read} />}>
                    <Route path={paths.advancedPayments} element={<AP_AdvancedPayments />} />
                    <Route path={paths.advancedPayments + "/:id"} element={<AP_AdvancedPayment />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.shareholders} action={actions.read} />}>
                    <Route path={paths.shareholders} element={<AP_Shareholders />} />
                    <Route path={paths.shareholders + "/:id"} element={<AP_Shareholder />} />
                  </Route>
                </Route>

                {/* Catch All Admin Routes */}
                <Route path={paths.admin + "/*"} element={<NotFound />} />
              </Route>
              </Route>
            </Route>
          </Route>

          {/* Reservia CRM (Developer Brief) - a separate system from ERP, gated by SystemGuard on
              the "CRM" system id/active membership, with its own layout/nav (layout-crm.tsx)
              since the CRM's role vocabulary (md/admin/sales/technical) and section count have
              nothing to do with the ERP's resource:action permission matrix. Pre-launch audit
              (22 Nov 2026): this used to ALSO require the legacy ERP role enum (admin/moderator/
              operator) before SystemGuard even ran - wrong now that ERP access is optional, since
              a CRM-only staff member has no ERP role at all. SystemGuard's own active-membership
              check (backed by the real GET /me/systems authority) is already sufficient on its
              own; the ERP-role pre-check added nothing except this bug. */}
          <Route element={<AuthGaurd requireLoggedIn={true} />}>
            <Route element={<SystemGuard systemId="CRM" />}>
              <Route element={<CrmLayout />}>
                <Route path={paths.crm} element={<Crm />}>
                  <Route path={paths.dashboard} element={<CRM_Dashboard />} />
                  <Route path={paths.pipeline} element={<CRM_Pipeline />} />
                  <Route path={paths.leads} element={<CRM_Leads />} />
                  <Route path={paths.leads + "/:id"} element={<CRM_Lead />} />
                  <Route path={paths.performance} element={<CRM_Performance />} />
                  {/* Change Request 2, section 4: lead integrations - MD/Admin only (the API
                      enforces the same, and key creation/revocation is MD-only server-side). */}
                  <Route element={<CrmRoleGuard allowedRoles={["md", "admin"]} />}>
                    <Route path={paths.integrations} element={<CRM_Integrations />} />
                  </Route>
                </Route>
                <Route path={paths.crm + "/*"} element={<NotFound />} />
              </Route>
            </Route>
          </Route>

          {/* Reservia Commercial ("Deal Engine") - engineering estimation, BOQ, pricing and
              quotation workflow (On-Grid/Off-Grid/Agriculture Pumping/Utility Scale, calculation
              logic sourced from the three Excel reference workbooks - see
              services/commercial/*Engine.js on the backend). Gated by SystemGuard on the
              "COMMERCIAL" system id/active membership, with its own layout/nav
              (layout-commercial.tsx) since the Commercial role vocabulary
              (md/commercial_director/sales/technical/member) has nothing to do with the ERP's
              resource:action permission matrix. Pre-launch audit (22 Nov 2026): the legacy ERP
              RoleGuard pre-check removed - see the identical fix and reasoning on CRM above. */}
          <Route element={<AuthGaurd requireLoggedIn={true} />}>
            <Route element={<SystemGuard systemId="COMMERCIAL" />}>
              <Route element={<CommercialLayout />}>
                <Route path={paths.commercial} element={<Commercial />}>
                  <Route path={paths.dashboard} element={<COM_Dashboard />} />
                  <Route path={paths.commercialProjects} element={<COM_Projects />} />
                  <Route path={paths.commercialProjects + "/:id"} element={<COM_Project />} />
                  <Route path={paths.commercialMaterials} element={<COM_Materials />} />
                  <Route path={paths.commercialPricingConfig} element={<COM_PricingConfig />} />
                  <Route path={paths.commercialSuppliers} element={<COM_Suppliers />} />
                  <Route path={`${paths.commercialSuppliers}/:id`} element={<COM_Supplier />} />
                </Route>
                <Route path={paths.commercial + "/*"} element={<NotFound />} />
              </Route>
            </Route>
          </Route>

          {/* Reservia HR Portal (HR Portal Developer Spec, 11 Nov 2026) - gated like CRM and the
              Deal Engine (SystemGuard on the "HR" membership, no legacy ERP RoleGuard pre-check -
              pre-launch audit, 22 Nov 2026, same fix and reasoning as CRM above); the prototype's
              own layout lives inside pages/hr. The HR role (md/hr/manager/finance) is enforced by the API. */}
          <Route element={<AuthGaurd requireLoggedIn={true} />}>
            <Route element={<SystemGuard systemId="HR" />}>
              <Route path={paths.hr} element={<HrPortal />} />
              <Route path={paths.hr + "/:view"} element={<HrPortal />} />
            </Route>
          </Route>

          {/* Website Management (CMS for the public Reservia website, Reservia_Website repo) -
              gated by SystemGuard on the "WEBSITE" system id/active membership, with its own
              layout/nav (layout-website.tsx), since Website Management's own admin/editor/viewer
              role vocabulary (middleware/websiteAccess.js) has nothing to do with the ERP's
              resource:action permission matrix. Pre-launch audit (22 Nov 2026): the legacy ERP
              RoleGuard pre-check removed - see the identical fix and reasoning on CRM above.
              Milestone 1: only Overview exists; Pages/Media/Navigation/SEO/Tracking/Custom Code/
              Settings/Publishing/Activity Logs are added as their own milestones ship real data
              behind them. */}
          <Route element={<AuthGaurd requireLoggedIn={true} />}>
            <Route element={<SystemGuard systemId="WEBSITE" />}>
              <Route element={<WebsiteLayout />}>
                <Route path={paths.website} element={<WebsiteOverview />} />
                <Route path={paths.website + "/" + paths.websitePages} element={<WebsitePages />} />
                <Route path={paths.website + "/" + paths.websitePages + "/:id"} element={<WebsitePageEditor />} />
                <Route path={paths.website + "/" + paths.websiteBlog} element={<WebsiteBlogPosts />} />
                <Route path={paths.website + "/" + paths.websiteBlog + "/:id"} element={<WebsiteBlogPostEditor />} />
                <Route path={paths.website + "/" + paths.websiteMedia} element={<WebsiteMediaLibrary />} />
                <Route path={paths.website + "/" + paths.websiteNavigation} element={<WebsiteNavigationPage />} />
                <Route path={paths.website + "/" + paths.websiteActivity} element={<WebsiteActivityPage />} />
                <Route path={paths.website + "/" + paths.websiteVisualEditor} element={<WebsiteVisualEditor />} />
                {/* Site settings: website admins only (backend: settings.manage). */}
                <Route element={<WebsiteRoleGuard allowedRoles={["admin"]} />}>
                  <Route path={paths.website + "/" + paths.websiteSettings} element={<WebsiteSettingsPage />} />
                  {/* Tracking and executable code: administrators only (backend: integrations.manage / code.manage). */}
                  <Route path={paths.website + "/" + paths.websiteIntegrations} element={<WebsiteIntegrationsPage />} />
                  <Route path={paths.website + "/" + paths.websiteCustomCode} element={<WebsiteCustomCodePage />} />
                  <Route path={paths.website + "/" + paths.websiteCode} element={<WebsiteCodeWorkspace />} />
                </Route>
              </Route>
              <Route path={paths.website + "/*"} element={<NotFound />} />
            </Route>
          </Route>

          {/* Pre-launch audit (22 Nov 2026): /admin -> /erp and /commercial -> /dealengine backward compatibility. */}
          <Route path={`${paths.legacyAdmin}/*`} element={<LegacyPrefixRedirect from={paths.legacyAdmin} to={paths.admin} />} />
          <Route path={`${paths.legacyCommercial}/*`} element={<LegacyPrefixRedirect from={paths.legacyCommercial} to={paths.commercial} />} />

          {/* Catch All */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      </Suspense>
    </Router>
  );
}
