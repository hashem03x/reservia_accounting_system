import { Expense, ExpensePaymentStatus } from "@/types/expense";
import { PaginatedData } from "@/types/global";
import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import paths from "@/utils/constants/paths";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { formatDate } from "@/utils/helpers/date-formaters";
import { formatAmount } from "@/utils/helpers/format-amount";
import { getExpenseCategoryLabel } from "@/utils/constants/expense-categories";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import { Badge, Button, Table } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import UnauthorizedSection from "@/components/ui/sections/unauthorized";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import TruncatedText from "@/components/ui/truncated-text";
import ExpenseModal from "./_components/expense-modal";
import { expenseStatusColors, useExpenseStatusLabel } from "./_components/status";

const EXPENSES_PER_PAGE = import.meta.env.VITE_EXPENSES_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

export default function Expenses() {
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const statusLabel = useExpenseStatusLabel();

  useDocumentTitle(`${translations.pages.expenses} | ${translations.adminPanel}`);

  const [searchParams, setSearchParams] = useSearchParams();
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));

  const params = { page: activePage.toString() };

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
        params: { limit: EXPENSES_PER_PAGE, sort: "-createdAt", ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedExpenses(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  const canIReadExpenses = useHasPermission(resources.expenses, actions.read);
  const canICreateExpenses = useHasPermission(resources.expenses, actions.create);

  useEffect(() => {
    setSearchParams(params, { replace: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    if (!canIReadExpenses) return;
    const cancelRequest = handleLoadExpenses();
    return cancelRequest;
  }, [canIReadExpenses, activePage]);

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  const money = (value: unknown) => formatAmount(value, translations.currency);

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
      {!canIReadExpenses ? (
        <UnauthorizedSection message={translate("You don't have permission to read expenses", "ليس لديك إذن لقراءة النفقات")} />
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
            <DataTableContainer>
              <DataTable className="min-w-[1050px]">
                <Table.Thead className={dataTableHeadClassName}>
                  <Table.Tr>
                    <Table.Th className="whitespace-nowrap">{translate("Date", "التاريخ")}</Table.Th>
                    <Table.Th>{translate("Vendor", "البائع")}</Table.Th>
                    <Table.Th>{translate("Expense Account", "حساب المصروف")}</Table.Th>
                    <Table.Th>{translate("Reference", "المرجع")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Total", "الإجمالي")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Paid", "المدفوع")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Remaining", "المتبقي")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("By", "بواسطة")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedExpenses.data.map((expense) =>
                    expense.vendor ? (
                      <Table.Tr key={expense._id} className="cursor-pointer" onClick={() => navigate(expense._id)}>
                        <Table.Td className="whitespace-nowrap">{formatDate(expense.date || expense.createdAt, language)}</Table.Td>
                        <Table.Td className="font-medium">
                          <TruncatedText text={expense.vendor.name} maxWidthClassName="max-w-[160px]" />
                        </Table.Td>
                        <Table.Td className="whitespace-nowrap">{expense.expenseAccount ? `${expense.expenseAccount.code} - ${expense.expenseAccount.name}` : "-"}</Table.Td>
                        <Table.Td>
                          <TruncatedText text={expense.reference || "-"} maxWidthClassName="max-w-[140px]" />
                        </Table.Td>
                        <Table.Td className="whitespace-nowrap text-right tabular-nums font-semibold">{money(expense.totalAmount)}</Table.Td>
                        <Table.Td className="whitespace-nowrap text-right tabular-nums">{money(expense.paidAmount ?? 0)}</Table.Td>
                        <Table.Td className="whitespace-nowrap text-right tabular-nums">{money(expense.remainingAmount)}</Table.Td>
                        <Table.Td className="whitespace-nowrap">
                          <Badge color={expenseStatusColors[(expense.paymentStatus || "unpaid") as ExpensePaymentStatus]} variant="light">
                            {statusLabel(expense.paymentStatus || "unpaid")}
                          </Badge>
                        </Table.Td>
                        <Table.Td className="whitespace-nowrap">{expense.createdBy?.name || ""}</Table.Td>
                      </Table.Tr>
                    ) : (
                      // Expense recorded before the Expenses module (a category paid in cash at once).
                      <Table.Tr key={expense._id} className="text-gray-500">
                        <Table.Td className="whitespace-nowrap">{formatDate(expense.createdAt, language)}</Table.Td>
                        <Table.Td>-</Table.Td>
                        <Table.Td className="whitespace-nowrap">{expense.expenseCategory ? getExpenseCategoryLabel(expense.expenseCategory, language) : "-"}</Table.Td>
                        <Table.Td>
                          <TruncatedText text={expense.description || "-"} maxWidthClassName="max-w-[140px]" />
                        </Table.Td>
                        <Table.Td className="whitespace-nowrap text-right tabular-nums">{money(expense.payment?.amountPaid)}</Table.Td>
                        <Table.Td className="whitespace-nowrap text-right tabular-nums">{money(expense.payment?.amountPaid)}</Table.Td>
                        <Table.Td className="whitespace-nowrap text-right tabular-nums">{money(0)}</Table.Td>
                        <Table.Td className="whitespace-nowrap">
                          <Badge color="gray" variant="light">
                            {statusLabel("paid")}
                          </Badge>
                        </Table.Td>
                        <Table.Td className="whitespace-nowrap">{expense.createdBy?.name || ""}</Table.Td>
                      </Table.Tr>
                    ),
                  )}
                </Table.Tbody>
              </DataTable>
            </DataTableContainer>

            <PaginationHandler<Expense> paginatedData={paginatedExpenses} activePage={activePage} setActivePage={setActivePage} />
          </>
        ))
      )}

      <ExpenseModal opened={modalOpened} close={closeModal} callback={(expense) => navigate(expense._id)} />
    </AdminLayoutBox>
  );
}
