import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { Transaction as TransactionType } from "@/types/transaction";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import { solidIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import ErrorSection from "@/components/ui/sections/error";
import LoadingSection from "@/components/ui/sections/loading";
import InfoRow from "./_components/info-row";
import UserInfo from "./_components/user-info";

export default function Transaction() {
  const { language, translate, translations } = useLanguage();

  const { id } = useParams<{ id: string }>();

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: transaction,
    setData: updateTransaction,
  } = useDataHandler<TransactionType | null>({ initialData: null, initialLoading: true });

  useDocumentTitle(
    `${transaction?.transactionId ?? translate("Transaction Details", "تفاصيل المعاملة")} | ${translations.pages.transactions}`,
  );

  function handleLoadTransaction() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({ url: `transactions/${id}`, signal: controller.signal, language });
      updateTransaction(response.transaction);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    const cancelRequest = handleLoadTransaction(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, []);

  return (
    <AdminLayoutBox header={{ title: translate("Transaction Details", "تفاصيل المعاملة"), backLink: true, border: true }}>
      {loading ? (
        <LoadingSection message={translate("Loading Transaction Details...", "جاري تحميل تفاصيل المعاملة...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error Loading Transaction Details", "خطأ في تحميل تفاصيل المعاملة")}
          errorMessage={error}
          button={{ text: translate("Try Again", "حاول مرة أخرى"), onClick: handleLoadTransaction }}
        />
      ) : (
        transaction && (
          <div className="flex flex-col gap-6">
            {/* Transaction Info */}
            <section>
              <h3 className="mb-4">{translate("Basic Info", "المعلومات الأساسية")}</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <InfoRow
                  icon={<solidIcons.Hashtag className="text-blue-500" />}
                  label={translate("Transaction ID", "رقم المعاملة")}
                  value={transaction.transactionId}
                />
                <InfoRow
                  icon={
                    transaction.success ? (
                      <solidIcons.CheckCircle className="text-green-500" />
                    ) : (
                      <solidIcons.XmarkCircle className="text-red-500" />
                    )
                  }
                  label={translate("Status", "الحالة")}
                  value={transaction.success ? translate("Success", "ناجحة") : translate("Failed", "فشلت")}
                  valueClassName={transaction.success ? "text-green-500" : "text-red-500"}
                />
                <InfoRow
                  icon={<solidIcons.Tag className="text-sky-500" />}
                  label={translate("Order ID", "رقم الطلب")}
                  value={transaction.orderId}
                />
                <InfoRow
                  icon={<solidIcons.DollarSign className="text-green-500" />}
                  label={translate("Amount", "المبلغ")}
                  value={`${transaction.amount} ${translations.currency}`}
                />
                <InfoRow
                  icon={<solidIcons.Calendar className="text-orange-500" />}
                  label={translate("Date", "التاريخ")}
                  value={formatDateAndTime(transaction.createdAt, language)}
                />
              </div>
            </section>

            <hr />

            <UserInfo transaction={transaction} />
          </div>
        )
      )}
    </AdminLayoutBox>
  );
}
