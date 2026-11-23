import { Payment } from "@/types/payment";
import { ChartOfAccountRef } from "@/types/orders";
import { JournalEntryRef } from "@/types/fixed-asset";
import { VatTreatmentValue } from "@/utils/constants/vat-treatment";

export type ExpenseCategory =
  | "office-supplies"
  | "operating-expenses"
  | "management-expenses"
  | "finance-charges"
  | "travel"
  | "salaries"
  | "marketing"
  | "utilities"
  | "rent"
  | "dividend"
  | "cleaning-and-hosting"
  | "others";

export type ExpensePaymentStatus = "unpaid" | "partially_paid" | "paid";

// One payment made against a vendor expense.
export type ExpensePayment = {
  payment: string;
  amount: number;
  paymentAccount: ChartOfAccountRef | string;
  date: string;
  journalEntry: string | JournalEntryRef;
};

// A vendor expense (has `vendor`, Dr expense account / Cr Suppliers, paid later), a salary expense
// (`expenseType: 'salary'`, no vendor, Dr expense account / Cr Salaries Payable), a liability
// expense (`expenseType: 'liability'`, no vendor, Dr expense account / Cr the chosen
// `liabilityAccount`), or a legacy category expense (`expenseCategory` + `payment`, paid in cash
// at once).
export type Expense = {
  _id: string;
  // 'vendor' (default) requires `vendor`; 'salary'/'liability' never have one - see
  // backend/server/models/expense/expenseModel.js.
  expenseType?: "vendor" | "salary" | "liability";
  // Vendor expense
  vendor?: { _id: string; name: string; vendorNumber?: number | null } | null;
  expenseAccount?: ChartOfAccountRef | null;
  // Liability expense - the Chart of Accounts liability account credited instead of a vendor.
  liabilityAccount?: ChartOfAccountRef | null;
  // Analysis grouping (Admin -> Expense Categories); null on expenses created without one.
  category?: { _id: string; name: string; nameAr?: string | null; isActive: boolean } | null;
  amount?: number;
  vatPercentage?: number;
  vatAmount?: number;
  // VAT Accounting Treatment (utils/vatTreatment.js) - immutable once posted.
  vatTreatment?: VatTreatmentValue;
  totalAmount?: number;
  paidAmount?: number;
  remainingAmount?: number;
  paymentStatus?: ExpensePaymentStatus | null;
  date?: string;
  reference?: string;
  notes?: string;
  journalEntry?: string | JournalEntryRef | null;
  payments?: ExpensePayment[];
  // Legacy category expense
  expenseCategory?: ExpenseCategory | null;
  description?: string;
  payment?: Payment | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: { _id: string; name: string };
};
