import { Payment } from "@/types/payment";
import { PaginatedData } from "@/types/global";
import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import { getPaymentMethodLabel } from "@/utils/constants/payment-methods";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import { Button, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import BalanceModal from "./_components/balance-modal";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import PaymentAmount from "@/components/ui/payment-amount";
import { getPaymentCategoryLabel } from "@/utils/constants/payment-category";
import TransferMoneyModal from "./_components/transfer-money-modal";

const PAYMENTS_PER_PAGE = import.meta.env.VITE_PAYMENTS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

export default function Cash() {
  const { language, translate, translations } = useLanguage();

  useDocumentTitle(`${translations.pages.cash} | ${translations.adminPanel}`);

  const { getWarehouseNameById } = useWarehouseHelpers();

  // URL search params for filters
  const [searchParams, setSearchParams] = useSearchParams();

  // State management for filters
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));

  const params = {
    page: activePage.toString(),
  };

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: paginatedPayments,
    setData: setPaginatedPayments,
  } = useDataHandler<PaginatedData<Payment>>({ initialData: null, initialLoading: true });

  function handleLoadPayments() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "payment",
        params: { limit: PAYMENTS_PER_PAGE, ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedPayments(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    // Sync URL search params with filters
    setSearchParams(params, { replace: true });

    window.scrollTo({ top: 0, behavior: "instant" });

    const cancelRequest = handleLoadPayments(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, [activePage]);

  // ========== Handle Modals ==========

  const [balanceModalOpened, { open: openBalanceModal, close: closeBalanceModal }] = useDisclosure();
  const [transferModalOpened, { open: openTransferModal, close: closeTransferModal }] = useDisclosure();

  // Handle export payment report
  // const handleExportPayments = () => {
  //   privateRequest({
  //     url: "payment/export",
  //     method: "GET",
  //     params: { ...params },
  //     language,
  //     download: true,
  //     filename: `payment-report-${new Date().toISOString().split("T")[0]}.xlsx`,
  //   });
  // };

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.cash,
        sideElements: (
          <>
            <div className="flex items-center gap-2">
              {/* <Button 
                color="green" 
                variant="light" 
                onClick={handleExportPayments}
                leftSection={<solidIcons.Download />}
              >
                {translate("Export", "تصدير")}
              </Button> */}
              <Button color="cyan" variant="light" onClick={openTransferModal}>
                {translate("Transfer Money", "تحويل الأموال")}
              </Button>
              <Button variant="light" onClick={openBalanceModal}>
                {translate("Warehouse Balances", "أرصدة الفروع")}
              </Button>
            </div>

            <TransferMoneyModal
              opened={transferModalOpened}
              close={closeTransferModal}
              setPaginatedPayments={setPaginatedPayments}
            />
            <BalanceModal opened={balanceModalOpened} close={closeBalanceModal} />
          </>
        ),
      }}
    >
      {/* Content */}
      {loading ? (
        <LoadingSection message={translate("Loading payments...", "جاري تحميل الدفعات...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading payments", "خطأ في تحميل الدفعات")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadPayments }}
        />
      ) : (
        paginatedPayments &&
        (paginatedPayments.data.length === 0 ? (
          <EmptySection useDefaultImg message={translate("No payments found", "لا يوجد دفعات")} />
        ) : (
          <>
            {/* <p>
              {language === "en-US" ? (
                <>
                  This page displays financial transactions, where <span className="font-bold text-green-500">(+)</span>{" "}
                  indicates income and <span className="font-bold text-red-500">(-)</span> indicates expenses.
                </>
              ) : (
                <>
                  تعرض هذه الصفحة العمليات المالية، حيث تشير <span className="font-bold text-green-500">(+)</span> إلى
                  الإيرادات و <span className="font-bold text-red-500">(-)</span> إلى المصروفات.
                </>
              )}
            </p> */}

            {/* Table */}
            <div className="overflow-x-auto">
              <Table className="text-nowrap" verticalSpacing="xs" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Date & Time", "التاريخ والوقت")}</Table.Th>
                    <Table.Th>{translate("Warehouse", "الفرع")}</Table.Th>
                    <Table.Th>{translate("Amount Paid", "المبلغ المدفوع")}</Table.Th>
                    <Table.Th>{translate("Payment Method", "طريقة الدفع")}</Table.Th>
                    <Table.Th>{translate("Payment Category", "التصنيف")}</Table.Th>
                    <Table.Th>{translate("Order ID", "رقم الطلب")}</Table.Th>
                    <Table.Th>{translate("Notes", "ملاحظات")}</Table.Th>
                    <Table.Th>{translate("By", "بواسطة")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedPayments.data.map((payment) => (
                    <Table.Tr key={payment._id} className="text-gray-600">
                      <Table.Td>{formatDateAndTime(payment.createdAt, language)}</Table.Td>
                      <Table.Td>{getWarehouseNameById(payment.warehouseId)}</Table.Td>
                      <Table.Td>
                        <PaymentAmount payment={payment} />
                      </Table.Td>
                      <Table.Td>{getPaymentMethodLabel(payment.paymentMethod, language)}</Table.Td>
                      <Table.Td>{getPaymentCategoryLabel(payment.paymentCategory, language)}</Table.Td>
                      <Table.Td>{payment.purchaseOrderId || payment.salesOrderId}</Table.Td>
                      <Table.Td>{payment.notes}</Table.Td>
                      <Table.Td>{payment.createdBy?.name || ""}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>

            {/* Pagination */}
            <PaginationHandler<Payment>
              paginatedData={paginatedPayments}
              activePage={activePage}
              setActivePage={setActivePage}
            />
          </>
        ))
      )}
    </AdminLayoutBox>
  );
}
