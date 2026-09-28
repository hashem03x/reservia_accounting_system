import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { useLanguage } from "@/context/LanguageContext";
import { useSearchParams, Link } from "react-router-dom";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useHandlePreviousFilters from "@/hooks/useHandlePreviousFilters";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Variant } from "@/types/product";
import { PaginatedData } from "@/types/global";
import { Table, TextInput } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import NoResultsSection from "@/components/ui/sections/no-results";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import { getColorLabel } from "@/utils/constants/colors";
import { useWarehouses } from "@/context/WarehousesContext";

// const VARIANTS_PER_PAGE = import.meta.env.VITE_VARIANTS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;
const VARIANTS_PER_PAGE = 30;

// Local type for variants with populated product data
type VariantWithProduct = Omit<Variant, "product"> & {
  product: {
    _id: string;
    title: { en: string; ar: string };
    cost: number;
    price: number;
    priceAfterDiscount: number | null;
  };
};

export default function Variants() {
  const { language, translate, translations } = useLanguage();

  useDocumentTitle(`${translations.pages.variants} | ${translations.adminPanel}`);

  const { data: warehouses } = useWarehouses();

  // URL search params for filters
  const [searchParams, setSearchParams] = useSearchParams();

  // State management for filters
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));
  const [keyword, setKeyword] = useState(searchParams.get("keyword") || "");
  const [debouncedKeyword] = useDebounce(keyword, 350);

  const params = {
    page: activePage.toString(),
    ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
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
    data: paginatedVariants,
    setData: setPaginatedVariants,
  } = useDataHandler<PaginatedData<VariantWithProduct>>({ initialData: null, initialLoading: true });

  const handleLoadVariants = () => {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "variants",
        params: { isDeleted: false, limit: VARIANTS_PER_PAGE, ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedVariants(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  };

  useEffect(() => {
    // Sync URL search params with filters
    setSearchParams(params, { replace: true });

    // If the filters have changed, reset the active page to 1.
    const newFilters = { debouncedKeyword };
    if (filtersChanged(newFilters)) {
      updatePreviousFilters(newFilters);
      if (activePage !== 1) {
        setActivePage(1); // This will, in turn, trigger this effect again and call getVariants().
        return;
      }
    }

    window.scrollTo({ top: 0, behavior: "instant" });

    const cancelRequest = handleLoadVariants(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, debouncedKeyword]);

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.variants,
        backLink: true,
      }}
    >
      {/* Search and filter */}
      <div className="flex gap-2">
        <div className="flex-grow">
          <TextInput
            value={keyword}
            onChange={(e) => setKeyword(e.currentTarget.value)}
            placeholder={translate("Search for a variant", "ابحث عن صنف")}
            leftSection={<solidIcons.Search />}
            rightSection={
              keyword && (
                <button onClick={() => setKeyword("")}>
                  <solidIcons.XMark />
                </button>
              )
            }
          />
        </div>
      </div>

      <hr />

      {/* Content */}
      {loading ? (
        <LoadingSection message={translate("Loading variants...", "جاري تحميل الأصناف...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading variants", "خطأ في تحميل الأصناف")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadVariants }}
        />
      ) : (
        paginatedVariants &&
        (paginatedVariants.data.length === 0 ? (
          debouncedKeyword ? (
            <NoResultsSection
              keyword={debouncedKeyword}
              button={{ text: translate("View All", "عرض الكل"), onClick: () => setKeyword("") }}
            />
          ) : (
            <EmptySection useDefaultImg message={translate("No Variants Found", "لا يوجد أصناف")} />
          )
        ) : (
          <>
            {/* Table */}
            <div className="overflow-x-auto">
              <Table className="text-nowrap" verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Product", "المنتج")}</Table.Th>
                    <Table.Th>{translate("Variant Code", "كود الصنف")}</Table.Th>
                    <Table.Th>{translate("Color", "اللون")}</Table.Th>
                    <Table.Th>{translate("Size", "المقاس")}</Table.Th>
                    {warehouses.map((warehouse) => (
                      <Table.Th key={warehouse._id}>{warehouse.name}</Table.Th>
                    ))}
                    <Table.Th>{translate("Total Quantity", "الكمية الإجمالية")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedVariants.data.map((variant) => {
                    // Calculate total quantity across all warehouses
                    const totalQuantity = variant.stock.reduce((sum, stockItem) => sum + stockItem.quantity, 0);

                    return (
                      <Table.Tr key={variant._id} className="text-gray-600">
                        <Table.Td className="font-semibold text-gray-800">
                          <Link to={`/admin/home/products/${variant.product._id}`} className="hover:underline">
                            {translate(variant.product.title.en, variant.product.title.ar)}
                          </Link>
                        </Table.Td>
                        <Table.Td className="font-semibold text-gray-800">
                          <Link to={`/admin/home/products/variants/${variant.variantCode}`} className="hover:underline">
                            {variant.variantCode}
                          </Link>
                        </Table.Td>
                        <Table.Td>{getColorLabel(variant.color, language)}</Table.Td>
                        <Table.Td>{variant.size}</Table.Td>
                        {warehouses.map((warehouse) => {
                          const stockItem = variant.stock.find((s) => s.warehouse === warehouse._id);
                          const quantity = stockItem ? stockItem.quantity : 0;
                          return (
                            <Table.Td key={warehouse._id} className={quantity === 0 ? "text-gray-400" : ""}>
                              {quantity}
                            </Table.Td>
                          );
                        })}
                        <Table.Td className="font-semibold text-gray-800">{totalQuantity}</Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </div>

            {/* Pagination */}
            <PaginationHandler<Variant>
              paginatedData={paginatedVariants}
              activePage={activePage}
              setActivePage={setActivePage}
            />
          </>
        ))
      )}
    </AdminLayoutBox>
  );
}
