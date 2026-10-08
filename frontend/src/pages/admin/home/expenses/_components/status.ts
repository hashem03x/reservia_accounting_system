import { useLanguage } from "@/context/LanguageContext";
import { ExpensePaymentStatus } from "@/types/expense";

export const expenseStatusColors: Record<ExpensePaymentStatus, string> = {
  unpaid: "red",
  partially_paid: "yellow",
  paid: "green",
};

export function useExpenseStatusLabel() {
  const { translate } = useLanguage();
  return (status: ExpensePaymentStatus) =>
    ({
      unpaid: translate("Unpaid", "غير مدفوع"),
      partially_paid: translate("Partially Paid", "مدفوع جزئياً"),
      paid: translate("Paid", "مدفوع"),
    })[status];
}
