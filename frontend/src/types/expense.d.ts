import { Payment } from "@/types/payment";

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

export type Expense = {
  _id: string;
  expenseCategory: ExpenseCategory;
  description: string;
  payment: Payment;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: { _id: string; name: string };
};
