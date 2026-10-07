import { Link } from "react-router-dom";
import { outlineIcons } from "@/components/icons";
import { useLanguage } from "@/context/LanguageContext";
import { Transaction } from "@/types/transaction";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";

export default function TransactionCard({ transaction }: { transaction: Transaction }) {
  const { language, translate, translations } = useLanguage();

  return (
    <Link
      to={transaction.transactionId}
      className="flex flex-col gap-2 rounded-lg border bg-gray-50 p-4 transition-colors hover:bg-gray-100"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-600">
          {translate("Transaction ID", "رقم المعاملة")}: {transaction.transactionId}
        </span>

        {transaction.success ? (
          <outlineIcons.CheckCircle className="text-green-500" title={translate("Success", "نجاح")} />
        ) : (
          <outlineIcons.XMarkCircle className="text-red-500" title={translate("Failed", "فشل")} />
        )}
      </div>

      <span className="text-lg font-bold text-gray-800">
        {transaction.amount.toFixed(2)} {translations.currency}
      </span>

      <div className="flex items-center gap-2 text-sm text-gray-600">
        <outlineIcons.Clock />
        <span>{formatDateAndTime(transaction.createdAt, language)}</span>
      </div>

      <div className="mt-1 flex items-center justify-between">
        <span
          className={`block rounded-full px-3 py-1 text-xs font-semibold ${transaction.success ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
        >
          {translate(transaction.success ? "Successful" : "Failed", transaction.success ? "عملية ناجحة" : "عملية غير ناجحة")}
        </span>
      </div>
    </Link>
  );
}
