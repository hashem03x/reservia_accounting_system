export type User = {
  _id: string;
  name: string;
  email: string;
  phone: string;
  password: string;
  role: Role;
  permissions: Permission[];
  addresses: Address[];
  wishlist: string[]; // array of product ids
  // The admin dashboard's guided tour - when it was finished / dismissed (PUT users/me/tour).
  tour?: { completedAt?: string | null; dismissedAt?: string | null } | null;
  // Central Business Portal (docs section "Central Business Portal") - platform-wide
  // administrator, distinct from ERP's own `role`/`isAdmin`. Only ever set by the backend.
  platformAdmin?: boolean;
  isActive?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// This is the type of the user object that is stored in the context
export type UserState = Omit<User, "password"> & { accessToken: string };

export interface UserContextProps {
  user: UserState | null;
  setUser: React.Dispatch<React.SetStateAction<UserState | null>>;
  /** True until session restoration (RememberUser's refresh-token attempt) has finished - lets
   * AuthGaurd wait instead of redirecting to /login while a valid session is still being restored
   * on page load. */
  isInitializing: boolean;
  setIsInitializing: React.Dispatch<React.SetStateAction<boolean>>;
}

// ============================================================================

export type Role = "admin" | "moderator" | "operator" | "user";

export type Resource =
  | "vendors"
  | "products"
  | "purchaseOrders"
  | "purchaseRequisitions"
  | "salesOrders"
  | "customers"
  | "expenses"
  | "warehouses"
  | "transfers"
  | "categories"
  | "subcategories"
  | "reports"
  | "cash"
  | "currencies"
  | "coupons"
  | "customization"
  | "governorates"
  | "transactions"
  | "users"
  | "fixedAssets"
  | "analytics"
  | "databaseExport"
  | "projects"
  | "accounts"
  | "journalEntries"
  | "advancedPayments"
  | "shareholders"
  | "cashFlowForecast";

export type Action = "create" | "read" | "update" | "delete";

// "createGeneral" (Journal Entry Project / General selection - admin-only, see appConstant.js on
// the backend) is additive and deliberately NOT part of `Action`/`actionsArray` above - unlike
// create/read/update/delete, it is not a per-user, per-resource toggle exposed in the permissions
// editor (pages/admin/users/[id]/_components/user-permissions.tsx); it only ever comes from
// adminPermission, and only makes sense for the journalEntries resource. Checked via
// useHasPermission's loosened action type (see that hook) rather than widening `Action` globally.
export type GeneralAction = Action | "createGeneral";

export type Permission = {
  resource: Resource;
  actions: Action[];
};

// ============================================================================

export type Address = {
  _id: string;
  governorate: string;
  city: string;
  street: string;
  landmark?: string;
  details?: string;
  phone: string;
};
