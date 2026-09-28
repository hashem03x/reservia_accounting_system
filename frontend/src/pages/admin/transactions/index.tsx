import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useHandlePreviousFilters from "@/hooks/useHandlePreviousFilters";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import { Transaction } from "@/types/transaction";
import { PaginatedData } from "@/types/global";
import { TextInput } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import NoResultsSection from "@/components/ui/sections/no-results";
import PaginationHandler from "@/components/ui/pagination-handler";
import TransactionCard from "./_components/transaction-card";

const TRANSACTIONS_PER_PAGE = import.meta.env.VITE_TRANSACTIONS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

export default function Transactions() {
  const { language, translate, translations } = useLanguage();

  useDocumentTitle(`${translations.pages.transactions} | ${translations.adminPanel}`);

  // URL search params for filters
  const [searchParams, setSearchParams] = useSearchParams();

  // State management for filters
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));
  const [keyword, setKeyword] = useState(searchParams.get("transactionId") || "");
  const [debouncedKeyword] = useDebounce(keyword, 350);

  const params = {
    page: activePage.toString(),
    ...(debouncedKeyword ? { transactionId: debouncedKeyword } : {}),
  };

  // Track the previous filters and check if they have changed to reset the active page to 1.
  const { filtersChanged, updatePreviousFilters } = useHandlePreviousFilters({
    debouncedKeyword,
  });

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: paginatedTransactions,
    setData: setPaginatedTransactions,
  } = useDataHandler<PaginatedData<Transaction>>({ initialData: null, initialLoading: true });

  function handleLoadTransactions() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "transactions",
        params: { limit: TRANSACTIONS_PER_PAGE, ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedTransactions(response);
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

    // If the filters have changed, reset the active page to 1.
    const newFilters = { debouncedKeyword };
    if (filtersChanged(newFilters)) {
      updatePreviousFilters(newFilters);
      if (activePage !== 1) {
        setActivePage(1); // This will, in turn, trigger this effect again and call getTransactions().
        return;
      }
    }

    window.scrollTo({ top: 0, behavior: "instant" });
    const cancelRequest = handleLoadTransactions(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, [activePage, debouncedKeyword]);

  return (
    <AdminLayoutBox header={{ title: translations.pages.transactions }}>
      <TextInput
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder={translate("Search by Transaction ID", "البحث برقم المعاملة") + "..."}
        leftSection={<solidIcons.Search />}
        rightSection={
          keyword && (
            <button onClick={() => setKeyword("")}>
              <solidIcons.XMark />
            </button>
          )
        }
      />

      {/* Content */}
      {loading ? (
        <LoadingSection message={translate("Loading Transactions...", "جاري تحميل المعاملات...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error Loading Transactions", "خطأ في تحميل المعاملات")}
          errorMessage={error}
          button={{ text: translate("Retry", "إعادة المحاولة"), onClick: handleLoadTransactions }}
        />
      ) : (
        paginatedTransactions &&
        (paginatedTransactions.data.length === 0 ? (
          debouncedKeyword ? (
            <NoResultsSection
              keyword={debouncedKeyword}
              button={{ text: translate("View All", "عرض الكل"), onClick: () => setKeyword("") }}
            />
          ) : (
            <EmptySection useDefaultImg message={translate("No Transactions Found", "لا توجد معاملات")} />
          )
        ) : (
          <>
            {/* Transactions */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {paginatedTransactions.data.map((t) => (
                <TransactionCard key={t.transactionId} transaction={t} />
              ))}
            </div>

            {/* Pagination */}
            <PaginationHandler<Transaction>
              paginatedData={paginatedTransactions}
              activePage={activePage}
              setActivePage={setActivePage}
            />
          </>
        ))
      )}
    </AdminLayoutBox>
  );
}
