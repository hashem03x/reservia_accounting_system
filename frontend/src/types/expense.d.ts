import { Payment } from "@/types/payment";
import { ChartOfAccountRef } from "@/types/orders";
import { JournalEntryRef } from "@/types/fixed-asset";

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
// (`expenseType: 'salary'`, no vendor, Dr expense account / Cr Salaries Payable), or a legacy
// category expense (`expenseCategory` + `payment`, paid in cash at once).
export type Expense = {
  _id: string;
  // 'vendor' (default) requires `vendor`; 'salary' never has one - see
  // backend/server/models/expense/expenseModel.js.
  expenseType?: "vendor" | "salary";
  // Vendor expense
  vendor?: { _id: string; name: string; vendorNumber?: number | null } | null;
  expenseAccount?: ChartOfAccountRef | null;
  // Analysis grouping (Admin -> Expense Categories); null on expenses created without one.
  category?: { _id: string; name: string; nameAr?: string | null; isActive: boolean } | null;
  amount?: number;
  vatPercentage?: number;
  vatAmount?: number;
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
