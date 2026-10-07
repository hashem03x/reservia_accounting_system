import { Expense } from "@/types/expense";
import { PaginatedData } from "@/types/global";
import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import paths from "@/utils/constants/paths";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import trancateString from "@/utils/helpers/trancate-string";
import { formatDate } from "@/utils/helpers/date-formaters";
import { getPaymentMethodLabel } from "@/utils/constants/payment-methods";
import { getExpenseCategoryLabel } from "@/utils/constants/expense-categories";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import { Button, Table } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import ExpenseModal from "./_components/expense-modal";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import UnauthorizedSection from "@/components/ui/sections/unauthorized";

const EXPENSES_PER_PAGE = import.meta.env.VITE_EXPENSES_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

export default function Expenses() {
  const { language, translate, translations } = useLanguage();

  useDocumentTitle(`${translations.pages.expenses} | ${translations.adminPanel}`);

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
    data: paginatedExpenses,
    setData: setPaginatedExpenses,
  } = useDataHandler<PaginatedData<Expense>>({ initialData: null, initialLoading: true });

  function handleLoadExpenses() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "expenses",
        params: { limit: EXPENSES_PER_PAGE, ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedExpenses(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  const canIReadExpenses = useHasPermission(resources.expenses, actions.read);
  const canICreateExpenses = useHasPermission(resources.expenses, actions.create);

  useEffect(() => {
    // Sync URL search params with filters
    setSearchParams(params, { replace: true });

    window.scrollTo({ top: 0, behavior: "instant" });

    if (!canIReadExpenses) return; // If the user doesn't have permission to read expenses, don't fetch them.

    const cancelRequest = handleLoadExpenses(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, [canIReadExpenses, activePage]);

  // ========== Handle Modals ==========

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  return (
    <AdminLayoutBox
      header={{
        backLink: `/${paths.admin}/${paths.home}`,
        title: translations.pages.expenses,
        sideElements: canICreateExpenses && (
          <Button onClick={openModal} variant="light" color="teal" leftSection={<solidIcons.Plus />}>
            {translate("Add Expense", "إضافة نفقة")}
          </Button>
        ),
      }}
    >
      {/* Content */}
      {!canIReadExpenses ? (
        <UnauthorizedSection
          message={translate("You don't have permission to read expenses", "ليس لديك إذن لقراءة النفقات")}
        />
      ) : loading ? (
        <LoadingSection message={translate("Loading expenses...", "جاري تحميل النفقات...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading expenses", "خطأ في تحميل النفقات")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadExpenses }}
        />
      ) : (
        paginatedExpenses &&
        (paginatedExpenses.data.length === 0 ? (
          <EmptySection useDefaultImg message={translate("No expenses found", "لا يوجد نفقات")} />
        ) : (
          <>
            {/* Table */}
            <div className="overflow-x-auto">
              <Table className="text-nowrap" verticalSpacing="xs" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Expense Category", "نوع النفقة")}</Table.Th>
                    <Table.Th>{translate("Description", "الوصف")}</Table.Th>
                    <Table.Th>{translate("Warehouse", "الفرع")}</Table.Th>
                    <Table.Th>{translate("Amount", "المبلغ")}</Table.Th>
                    <Table.Th>{translate("Payment Method", "طريقة الدفع")}</Table.Th>
                    <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                    <Table.Th>{translate("By", "بواسطة")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedExpenses.data.map((expense) => (
                    <Table.Tr key={expense._id} className="text-gray-600">
                      <Table.Td className="font-bold text-gray-800">
                        {getExpenseCategoryLabel(expense.expenseCategory, language)}
                      </Table.Td>
                      <Table.Td title={expense.description}>{trancateString(expense.description || "", 30)}</Table.Td>
                      <Table.Td>{getWarehouseNameById(expense.payment.warehouseId)}</Table.Td>
                      <Table.Td className="font-bold text-gray-800">
                        {expense.payment.amountPaid.toFixed(2)} {translations.currency}
                      </Table.Td>
                      <Table.Td>{getPaymentMethodLabel(expense.payment.paymentMethod, language)}</Table.Td>
                      <Table.Td>{formatDate(expense.createdAt, language)}</Table.Td>
                      <Table.Td>{expense.createdBy?.name || ""}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>

            {/* Pagination */}
            <PaginationHandler<Expense>
              paginatedData={paginatedExpenses}
              activePage={activePage}
              setActivePage={setActivePage}
            />
          </>
        ))
      )}

      {/* Modals */}
      <ExpenseModal
        opened={modalOpened}
        close={closeModal}
        callback={(response) => {
          setPaginatedExpenses((prev) => {
            if (!prev) return null;
            return { ...prev, data: [response, ...prev.data] };
          });
        }}
      />
    </AdminLayoutBox>
  );
}
