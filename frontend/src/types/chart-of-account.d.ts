export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface ChartOfAccount {
  _id: string;
  code: string;
  name: string;
  type: AccountType;
  parentAccount?: { _id: string; code: string; name: string; type: AccountType } | null;
  description?: string;
  isActive: boolean;
  isSystemDefault: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountBalance {
  account: { _id: string; code: string; name: string; type: AccountType };
  debit: number;
  credit: number;
  balance: number;
}
