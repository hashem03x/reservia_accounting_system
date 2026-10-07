import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { PurchaseOrder as PurchaseOrderType } from "@/types/orders";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import OrderHandler from "./_components/order-handler";
import { Payment } from "@/types/payment";
import { ReturnRecord } from "@/types/orders";
import OrderProvider from "./context";

export default function PurchaseOrder() {
  const { language, translate, translations } = useLanguage();

  useDocumentTitle(`${translate("Order Details", "تفاصيل الطلب")} | ${translations.adminPanel}`);

  const { id } = useParams<{ id: string }>();

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler<null>({
    initialData: null,
    initialLoading: true,
  });

  const [order, setOrder] = useState<PurchaseOrderType | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [returnRecords, setReturnRecords] = useState<ReturnRecord[]>([]);

  function handleLoadOrder() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      // Fetch the order, payments, and returns
      const [orderResponse, paymentResponse, returnResponse] = await Promise.all([
        privateRequest({ url: `purchaseorder/${id}`, signal: controller.signal, language }),
        privateRequest({ url: "payment", params: { purchaseOrderId: id || "" }, signal: controller.signal, language }),
        privateRequest({
          url: "purchaseorder/returns",
          params: { purchaseOrderId: id || "" },
          signal: controller.signal,
          language,
        }),
      ]);

      setOrder(orderResponse.data);
      setPayments(paymentResponse.data);
      setReturnRecords(returnResponse.data);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    const cancelRequest = handleLoadOrder(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, []);

  return loading ? (
    <LoadingSection
      message={translate("Loading order information", "جاري تحميل معلومات الطلب") + "..."}
      className="min-h-full bg-white shadow"
    />
  ) : error ? (
    <ErrorSection
      errorTitle={translate("Error loading order information", "خطأ في تحميل معلومات الطلب") + "..."}
      errorMessage={error}
      button={{ text: translate("Retry", "إعادة المحاولة"), onClick: handleLoadOrder }}
      className="min-h-full bg-white shadow"
    />
  ) : (
    order && (
      <OrderProvider
        order={order}
        setOrder={setOrder as React.Dispatch<React.SetStateAction<PurchaseOrderType>>}
        payments={payments}
        setPayments={setPayments}
        returnRecords={returnRecords}
        setReturnRecords={setReturnRecords}
      >
        <OrderHandler />
      </OrderProvider>
    )
  );
}
