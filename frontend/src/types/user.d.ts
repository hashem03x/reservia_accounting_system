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
  | "shareholders";

export type Action = "create" | "read" | "update" | "delete";

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
