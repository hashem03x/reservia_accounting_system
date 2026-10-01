import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";
import paths from "@/utils/constants/paths";
import roles from "@/utils/constants/roles";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";

// Routing Pages
import Layout from "@/pages/routes/layout";
import AdminLayout from "@/pages/routes/layout-admin";
import NotFound from "@/pages/routes/not-found";
import AuthGaurd from "@/pages/routes/auth-gaurd";
import RoleGuard from "@/pages/routes/role-guard";
import ResourceGuard from "@/pages/routes/resource-guard";

// Auth Pages
import Login from "@/pages/outer/login";
import ForgotPassword from "@/pages/outer/forgot-password";
import VerifyCode from "@/pages/outer/verify-code";
import ResetPassword from "@/pages/outer/reset-password";

// Account Page
import Profile from "@/pages/inner/profile";

// Admin Panel Pages
import Admin from "@/pages/admin";
import AP_Home from "@/pages/admin/home";
import AP_Vendors from "@/pages/admin/home/vendors";
import AP_Vendor from "@/pages/admin/home/vendors/[id]";
import AP_PurchaseOrders from "@/pages/admin/home/purchase-orders";
import AP_PurchaseOrder from "@/pages/admin/home/purchase-orders/[id]";
import AP_NewPurchaseOrder from "@/pages/admin/home/purchase-orders/new";
import AP_Products from "@/pages/admin/home/products";
import AP_Product from "@/pages/admin/home/products/[id]";
import AP_NewProduct from "@/pages/admin/home/products/new";
import AP_SalesOrders from "@/pages/admin/home/sales-orders";
import AP_SalesOrder from "@/pages/admin/home/sales-orders/[id]";
import AP_NewSalesOrder from "@/pages/admin/home/sales-orders/new";
import AP_Customers from "@/pages/admin/home/customers";
import AP_Customer from "@/pages/admin/home/customers/[id]";
import AP_Expenses from "@/pages/admin/home/expenses";
import AP_Warehouses from "@/pages/admin/home/warehouses";
import AP_Transfers from "@/pages/admin/home/transfers";
import AP_Transfer from "@/pages/admin/home/transfers/[id]";
import AP_Reports from "@/pages/admin/reports";
import AP_VendorsReport from "@/pages/admin/reports/vendors";
import AP_CustomersReport from "@/pages/admin/reports/customers";
import AP_PurchaseOrdersReport from "@/pages/admin/reports/purchase-orders";
import AP_SalesOrdersReport from "@/pages/admin/reports/sales-orders";
import AP_ProductsReport from "@/pages/admin/reports/products";
import AP_InventoryTransferReport from "@/pages/admin/reports/inventory-transfer";
import AP_InventorySummaryReport from "@/pages/admin/reports/inventory-summary";
import AP_ExpensesReport from "@/pages/admin/reports/expenses";
import AP_PaymentsReport from "@/pages/admin/reports/payments";
import AP_VariantHistoryReport from "@/pages/admin/reports/variant-history";
import AP_TreasuryBalanceReport from "@/pages/admin/reports/treasury-balance";
import AP_ProfitBySalesReport from "@/pages/admin/reports/profit-by-sales";
import AP_ProfitByCustomerReport from "@/pages/admin/reports/profit-by-customer";
import AP_ProfitByProductReport from "@/pages/admin/reports/profit-by-product";
import AP_Cash from "@/pages/admin/cash";
import AP_Currencies from "@/pages/admin/currencies";
import AP_Categories from "@/pages/admin/categories";
import AP_Coupons from "@/pages/admin/coupons";
import AP_Customization from "@/pages/admin/customization";
import AP_Governorates from "@/pages/admin/governorates";
import AP_Transactions from "@/pages/admin/transactions";
import AP_Transaction from "@/pages/admin/transactions/[id]";
import AP_Users from "@/pages/admin/users";
import AP_User from "@/pages/admin/users/[id]";
import ReturnsReport from "@/pages/admin/reports/returns";
import IncomeStatementReport from "@/pages/admin/reports/income-statement";
import AP_FixedAssets from "@/pages/admin/fixed-assets";
import AP_FixedAssetsReport from "@/pages/admin/reports/fixed-assets";
import AP_BalanceSheetReport from "@/pages/admin/reports/balance-sheet";
import AP_Analytics from "@/pages/admin/analytics";
import AP_Projects from "@/pages/admin/projects";
import AP_Project from "@/pages/admin/projects/[id]";
import AP_Accounts from "@/pages/admin/accounts";
import AP_JournalEntries from "@/pages/admin/journal-entries";
import AP_JournalEntry from "@/pages/admin/journal-entries/[id]";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route element={<Layout />}>
          {/* Root: send straight into the app - AuthGaurd/RoleGuard below route it to
              /login, /profile, or /admin depending on auth state and role. */}
          <Route index element={<Navigate to={`/${paths.admin}`} replace />} />

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

          {/* Admin Layout Pages (Pages that require user to be admin or moderator) */}
          <Route element={<AuthGaurd requireLoggedIn={true} />}>
            <Route element={<RoleGuard allowedRoles={[roles.admin.value, roles.moderator.value, roles.operator.value]} />}>
              <Route element={<AdminLayout />}>
                <Route path={paths.admin} element={<Admin />}>
                  <Route path={paths.home}>
                    <Route index element={<AP_Home />} />
                    <Route element={<ResourceGuard resource={resources.vendors} action={actions.read} />}>
                      <Route path={paths.vendors} element={<AP_Vendors />} />
                      <Route path={paths.vendors + "/:id"} element={<AP_Vendor />} />
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

                    <Route element={<ResourceGuard resource={resources.warehouses} action={actions.read} />}>
                      <Route path={paths.warehouses} element={<AP_Warehouses />} />
                    </Route>
                    <Route element={<ResourceGuard resource={resources.transfers} action={actions.read} />}>
                      <Route path={paths.transfers} element={<AP_Transfers />} />
                      <Route path={paths.transfers + "/:id"} element={<AP_Transfer />} />
                    </Route>
                  </Route>

                  <Route element={<ResourceGuard resource={resources.reports} action={actions.read} />}>
                    <Route path={paths.reports} element={<AP_Reports />} />
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
                  <Route element={<ResourceGuard resource={resources.coupons} action={actions.read} />}>
                    <Route path={paths.coupons} element={<AP_Coupons />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.customization} action={actions.read} />}>
                    <Route path={paths.customization} element={<AP_Customization />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.governorates} action={actions.read} />}>
                    <Route path={paths.governorates} element={<AP_Governorates />} />
                  </Route>
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
                  </Route>
                  <Route element={<ResourceGuard resource={resources.analytics} action={actions.read} />}>
                    <Route path={paths.analytics} element={<AP_Analytics />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.projects} action={actions.read} />}>
                    <Route path={paths.projects} element={<AP_Projects />} />
                    <Route path={paths.projects + "/:id"} element={<AP_Project />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.accounts} action={actions.read} />}>
                    <Route path={paths.accounts} element={<AP_Accounts />} />
                  </Route>
                  <Route element={<ResourceGuard resource={resources.journalEntries} action={actions.read} />}>
                    <Route path={paths.journalEntries} element={<AP_JournalEntries />} />
                    <Route path={paths.journalEntries + "/:id"} element={<AP_JournalEntry />} />
                  </Route>
                </Route>

                {/* Catch All Admin Routes */}
                <Route path={paths.admin + "/*"} element={<NotFound />} />
              </Route>
            </Route>
          </Route>

          {/* Catch All */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Router>
  );
}
