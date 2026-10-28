import type { AccountType } from "@/types/chart-of-account";

// A Chart of Accounts parent group (Accounting -> Parent Account Groups) - a logical classification
// such as "Cash & Cash Equivalents". Not a posting account and unrelated to an account's
// `parentAccount` link. Accounts store the group's names in parentGroupNameEn / parentGroupNameAr.
export interface AccountParentGroup {
  _id: string;
  nameEn: string;
  nameAr: string;
  type: AccountType;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  isSystemDefault: boolean;
  // How many accounts are classified under the group (list/detail responses only).
  accountCount?: number;
  // Accounts whose stored group names were rewritten by the last rename (update response only).
  accountsUpdated?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AccountParentGroupInput {
  nameEn?: string;
  nameAr?: string;
  type?: AccountType;
  description?: string;
  sortOrder?: number | null;
  isActive?: boolean;
}
