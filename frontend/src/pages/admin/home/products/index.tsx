import { useEffect, useState, useRef } from "react";
import { useDebounce } from "use-debounce";
import { useLanguage } from "@/context/LanguageContext";
import { useMainCategories } from "@/context/MainCategoriesContext";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useCategoryHelpers from "@/hooks/useCategoryHelpers";
import useHandlePreviousFilters from "@/hooks/useHandlePreviousFilters";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import apiRequest from "@/utils/helpers/api-request";
import { Product } from "@/types/product";
import { PaginatedData } from "@/types/global";
import paths from "@/utils/constants/paths";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { getProductFinalPrice } from "@/utils/helpers/product-helpers";
import { seasonsArray } from "@/utils/constants/seasons";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import { getSeasonLabel } from "@/utils/constants/seasons";
import { getProductTypeLabel, isService } from "@/utils/constants/product-types";
import { formatDate } from "@/utils/helpers/date-formaters";
import { Badge, Button, Select, Table, TagsInput, TextInput } from "@mantine/core";
import { solidIcons, outlineIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import ImportButton from "@/components/global/import-button";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import NoResultsSection from "@/components/ui/sections/no-results";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import { isAdmin } from "@/utils/constants/roles";
import { useUser } from "@/context/UserContext";
import GlobalDiscount from "./_components/global-discount";

const PRODUCTS_PER_PAGE = import.meta.env.VITE_PRODUCTS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

const noFilterLabel = { en: "All", ar: "الكل" };

export default function Products() {
  const { language, translate, translations } = useLanguage();

  useDocumentTitle(`${translations.pages.products} | ${translations.adminPanel}`);

  const navigate = useNavigate();

  const { user: loggedInUser } = useUser();

  const { data: mainCategories } = useMainCategories();
  const { getSubcategoriesByMainCategoryId, getSubcategoryNameById, getMainCategoryNameById } = useCategoryHelpers();

  // URL search params for filters
  const [searchParams, setSearchParams] = useSearchParams();

  // State management for filters
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));
  const [keyword, setKeyword] = useState(searchParams.get("keyword") || "");
  const [debouncedKeyword] = useDebounce(keyword, 350);
  const [seasonFilter, setSeasonFilter] = useState(searchParams.get("season") || "");
  const [mainCategoryFilter, setMainCategoryFilter] = useState(searchParams.get("mainCategoryId") || "");
  const [subcategoryFilter, setSubcategoryFilter] = useState(searchParams.get("subCategories") || "");
  const [tagsFilter, setTagsFilter] = useState<string[]>(
    searchParams.get("tags")?.split(",").filter(Boolean) || [],
  );
  const [distinctTags, setDistinctTags] = useState<string[]>([]);

  const [showFilters, setShowFilters] = useState(false);

  const tagsFilterParam = tagsFilter.join(",");

  const params = {
    page: activePage.toString(),
    ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
    ...(seasonFilter ? { season: seasonFilter } : {}),
    ...(mainCategoryFilter ? { mainCategoryId: mainCategoryFilter } : {}),
    ...(subcategoryFilter ? { subCategories: subcategoryFilter } : {}),
    ...(tagsFilterParam ? { tags: tagsFilterParam } : {}),
  };

  // Track the previous filters and check if they have changed to reset the active page to 1.
  const { filtersChanged, updatePreviousFilters } = useHandlePreviousFilters({
    debouncedKeyword,
    seasonFilter,
    mainCategoryFilter,
    subcategoryFilter,
    tagsFilterParam,
  });

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: paginatedProducts,
    setData: setPaginatedProducts,
  } = useDataHandler<PaginatedData<Product>>({ initialData: null, initialLoading: true });

  const handleLoadProducts = () => {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "products",
        params: { isDeleted: false, limit: PRODUCTS_PER_PAGE, ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedProducts(response);
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
    const newFilters = { debouncedKeyword, seasonFilter, mainCategoryFilter, subcategoryFilter, tagsFilterParam };
    if (filtersChanged(newFilters)) {
      updatePreviousFilters(newFilters);
      if (activePage !== 1) {
        setActivePage(1); // This will, in turn, trigger this effect again and call getProducts().
        return;
      }
    }

    window.scrollTo({ top: 0, behavior: "instant" });

    const cancelRequest = handleLoadProducts(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, [activePage, debouncedKeyword, seasonFilter, mainCategoryFilter, subcategoryFilter, tagsFilterParam]);

  // Distinct tags across the catalog, fetched once for the tags filter's autocomplete suggestions.
  useEffect(() => {
    let canceled = false;
    apiRequest({ url: "products/tags/distinct", language })
      .then((response) => {
        if (!canceled) setDistinctTags(response.data || []);
      })
      .catch(() => {
        // Suggestions are a nice-to-have - the filter still works with free-typed tags.
      });
    return () => {
      canceled = true;
    };
  }, []);

  const canICreateProducts = useRef(useHasPermission(resources.products, actions.create)).current; // Ref to avoid re-renders
  const AmIAdmin = loggedInUser && useRef(isAdmin(loggedInUser.role)).current; // Ref to avoid re-renders

  const renderIfAdmin = (children: React.ReactNode) => {
    if (AmIAdmin) return children;
    return null;
  };

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.products,
        backLink: true,
        sideElements: canICreateProducts && (
          <div className="flex items-center gap-2">
            <Link to={`${paths.variants}`}>
              <Button variant="light" color="cyan" leftSection={<solidIcons.Box />}>
                <div className="flex-center gap-1.5">
                  {translate("Variants", "الأصناف")}{" "}
                  <Badge size="sm" color="cyan">
                    {translate("New", "جديد")}
                  </Badge>
                </div>
              </Button>
            </Link>
            <GlobalDiscount singleProduct={null} />
            <ImportButton url="import/products" callback={handleLoadProducts} />
            <Link to={`${paths.new}`}>
              <Button variant="light" color="teal" leftSection={<solidIcons.Plus />}>
                {translate("Add New Product", "إضافة منتج جديد")}
              </Button>
            </Link>
          </div>
        ),
      }}
    >
      {/* Search and filter */}
      <div className="flex gap-2">
        <div className="flex-grow">
          <TextInput
            value={keyword}
            onChange={(e) => setKeyword(e.currentTarget.value)}
            placeholder={translate("Search for a product", "ابحث عن منتج")}
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

        {/* Clear All Filters */}
        {(debouncedKeyword || seasonFilter || mainCategoryFilter || subcategoryFilter || tagsFilter.length > 0) && (
          <Button
            color="red"
            variant="light"
            onClick={() => {
              setKeyword("");
              setSeasonFilter("");
              setMainCategoryFilter("");
              setSubcategoryFilter("");
              setTagsFilter([]);
            }}
            title={translate("Clear All Filters", "مسح جميع الفلاتر")}
          >
            <outlineIcons.Trash />
          </Button>
        )}

        {/* Show/Hide Filters */}
        <div className="relative">
          <Button
            variant="light"
            onClick={() => setShowFilters(!showFilters)}
            title={showFilters ? translate("Hide Filters", "إخفاء الفلاتر") : translate("Show Filters", "إظهار الفلاتر")}
          >
            <solidIcons.Filter />
          </Button>

          {/* Highlight the filter button if any filter is active */}
          {seasonFilter || mainCategoryFilter || subcategoryFilter || tagsFilter.length > 0 ? (
            <span
              className={`absolute -top-[6px] ${translate("-right-[6px]", "-left-[6px]")} h-[15px] w-[15px] rounded-full bg-blue-500`}
            ></span>
          ) : null}
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="flex items-center gap-2 whitespace-nowrap">
          {/* Season */}
          <Select
            value={seasonFilter}
            onChange={(value) => setSeasonFilter(value as string)}
            label={translate("Season", "الموسم")}
            data={[
              { value: "", label: translate(noFilterLabel.en, noFilterLabel.ar) },
              ...seasonsArray.map((season) => ({
                value: season.value,
                label: translate(season.label.en, season.label.ar),
              })),
            ]}
            allowDeselect={false}
            rightSection={seasonFilter ? <solidIcons.Check color="green" size={12} /> : null}
          />

          {/* Main Category */}
          <Select
            value={mainCategoryFilter}
            onChange={(value) => setMainCategoryFilter(value as string)}
            label={translate("Main Category", "الفئة الرئيسية")}
            data={[
              { value: "", label: translate(noFilterLabel.en, noFilterLabel.ar) },
              ...mainCategories.map((category) => ({
                value: category._id,
                label: translate(category.name.en, category.name.ar),
              })),
            ]}
            allowDeselect={false}
            rightSection={mainCategoryFilter ? <solidIcons.Check color="green" size={12} /> : null}
          />

          {/* Subcategory */}
          {mainCategoryFilter && (
            <Select
              value={subcategoryFilter}
              onChange={(value) => setSubcategoryFilter(value as string)}
              label={translate("Subcategory", "الفئة الفرعية")}
              data={[
                { value: "", label: translate(noFilterLabel.en, noFilterLabel.ar) },
                ...(mainCategoryFilter
                  ? getSubcategoriesByMainCategoryId(mainCategoryFilter).map((subcategory) => ({
                      value: subcategory._id,
                      label: translate(subcategory.name.en, subcategory.name.ar),
                    }))
                  : []),
              ]}
              allowDeselect={false}
              rightSection={subcategoryFilter ? <solidIcons.Check color="green" size={12} /> : null}
            />
          )}

          {/* Tags - matches on ANY of the selected tags (backend $in filter) */}
          <TagsInput
            value={tagsFilter}
            onChange={setTagsFilter}
            data={distinctTags}
            splitChars={[","]}
            label={translate("Tags", "الوسوم")}
            placeholder={translate("Filter by tags", "تصفية حسب الوسوم")}
            className="min-w-[220px] flex-1 whitespace-normal"
            rightSection={tagsFilter.length > 0 ? <solidIcons.Check color="green" size={12} /> : null}
          />
        </div>
      )}

      <hr />

      {/* Content */}
      {loading ? (
        <LoadingSection message={translate("Loading products...", "جاري تحميل المنتجات...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading products", "خطأ في تحميل المنتجات")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadProducts }}
        />
      ) : (
        paginatedProducts &&
        (paginatedProducts.data.length === 0 ? (
          debouncedKeyword ? (
            <NoResultsSection
              keyword={debouncedKeyword}
              button={{ text: translate("View All", "عرض الكل"), onClick: () => setKeyword("") }}
            />
          ) : (
            <EmptySection useDefaultImg message={translate("No Products Found", "لا يوجد منتجات")} />
          )
        ) : (
          <>
            {/* Table */}
            <div className="overflow-x-auto">
              <Table className="text-nowrap" verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Title", "العنوان")}</Table.Th>
                    <Table.Th>{translate("Type", "النوع")}</Table.Th>
                    <Table.Th>{translate("Price", "السعر")}</Table.Th>
                    <Table.Th>{translate("After Discount", "بعد الخصم")}</Table.Th>
                    {renderIfAdmin(<Table.Th>{translate("Cost", "التكلفة")}</Table.Th>)}
                    <Table.Th>{translate("Quantity", "الكمية")}</Table.Th>
                    {renderIfAdmin(<Table.Th>{translate("Total Cost", "التكلفة الكلية")}</Table.Th>)}
                    <Table.Th>{translate("Sold", "المباع")}</Table.Th>
                    <Table.Th>{translate("Season", "الموسم")}</Table.Th>
                    <Table.Th>{translate("Category", "الفئة")}</Table.Th>
                    <Table.Th>{translate("Subcategory", "الفئة الفرعية")}</Table.Th>
                    <Table.Th>{translate("Tags", "الوسوم")}</Table.Th>
                    <Table.Th>{translate("Created On", "أنشئ في")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedProducts.data.map((product) => {
                    // Calculate total quantity and total amount
                    const totalQuantity = product.variants.reduce(
                      (sum, variant) =>
                        sum + variant.stock.reduce((stockSum, stockItem) => stockSum + stockItem.quantity, 0),
                      0,
                    );

                    // A service has no cost/inventory (see docs/entities/products.md) - `cost` is
                    // undefined for one, so this must not blindly call .toFixed() on it.
                    const productIsService = isService(product.type);
                    const totalAmount = productIsService ? 0 : (product.cost || 0) * totalQuantity;

                    return (
                      <Table.Tr
                        key={product._id}
                        className="cursor-pointer text-gray-600"
                        onClick={() => navigate(product._id)}
                      >
                        <Table.Td className="font-semibold text-gray-800">
                          {translate(product.title.en, product.title.ar)}
                        </Table.Td>
                        <Table.Td>
                          <div className="flex flex-col gap-0.5">
                            <Badge size="sm" variant="light" color={productIsService ? "grape" : "blue"} radius="sm">
                              {getProductTypeLabel(product.type, language)}
                            </Badge>
                            {productIsService && product.durationValue && (
                              <span className="text-xs text-gray-500">
                                {product.durationValue} {translate("months", "شهر")}
                              </span>
                            )}
                          </div>
                        </Table.Td>
                        <Table.Td>
                          {product.price.toFixed(2)} {translations.currency}
                        </Table.Td>
                        <Table.Td className="font-semibold text-gray-800">
                          {getProductFinalPrice(product.priceAfterDiscount, product.price).toFixed(2)}{" "}
                          {translations.currency}
                        </Table.Td>
                        {renderIfAdmin(
                          <Table.Td>
                            {productIsService ? "-" : `${(product.cost || 0).toFixed(2)} ${translations.currency}`}
                          </Table.Td>,
                        )}
                        <Table.Td>{productIsService ? "-" : totalQuantity}</Table.Td>
                        {renderIfAdmin(
                          <Table.Td className="font-semibold text-gray-800">
                            {productIsService ? "-" : `${totalAmount.toFixed(2)} ${translations.currency}`}
                          </Table.Td>,
                        )}
                        <Table.Td>{product.totalSold}</Table.Td>
                        <Table.Td>{productIsService ? "-" : getSeasonLabel(product.season, language)}</Table.Td>
                        <Table.Td>{productIsService ? "-" : getMainCategoryNameById(product.category || "")}</Table.Td>
                        <Table.Td>{productIsService ? "-" : getSubcategoryNameById(product.subcategory || "")}</Table.Td>
                        <Table.Td>
                          {product.tags?.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {product.tags.slice(0, 2).map((tag) => (
                                <Badge key={tag} size="sm" variant="light" color="grape" radius="sm">
                                  {tag}
                                </Badge>
                              ))}
                              {product.tags.length > 2 && (
                                <Badge size="sm" variant="outline" color="gray" radius="sm">
                                  +{product.tags.length - 2}
                                </Badge>
                              )}
                            </div>
                          ) : (
                            "-"
                          )}
                        </Table.Td>
                        <Table.Td>{formatDate(product.createdAt, language)}</Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </div>

            {/* Pagination */}
            <PaginationHandler<Product>
              paginatedData={paginatedProducts}
              activePage={activePage}
              setActivePage={setActivePage}
            />
          </>
        ))
      )}
    </AdminLayoutBox>
  );
}
