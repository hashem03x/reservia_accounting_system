import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { useLanguage } from "@/context/LanguageContext";
import { useMainCategories } from "@/context/MainCategoriesContext";
import { useBrands } from "@/context/BrandsContext";
import { useSubcategories } from "@/context/SubcategoriesContext";
import useCategoryHelpers from "@/hooks/useCategoryHelpers";
import useDataHandler from "@/hooks/useDataHandler";
import { Product } from "@/types/product";
import handleRequest from "@/utils/helpers/handle-request";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import Modal from "@/components/ui/modal";
import { Button, Select, Table, TextInput } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import { getProductFinalPrice, priceText } from "@/utils/helpers/product-helpers";
import { getPurchaseUnitPrice } from "@/utils/helpers/purchase-unit-price";

// A Product is the sellable/stock-tracked item itself now - there is no separate Variant to search
// for (see docs/entities/products.md). `onSelect` receives the chosen product's barcode, the same
// value a barcode scan into the order item row would produce.
export default function ProductSearchModal({
  opened,
  close,
  mode,
  onSelect,
}: {
  opened: boolean;
  close: () => void;
  mode: "purchase" | "sales";
  onSelect: (barcode: string) => void;
}) {
  const { translate, translations, language } = useLanguage();

  const { data: mainCategories } = useMainCategories();
  const { data: brands } = useBrands();
  const { data: subcategories } = useSubcategories();
  const { getMainCategoryNameById, getBrandNameById } = useCategoryHelpers();

  const [products, setProducts] = useState<Product[]>([]);

  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword] = useDebounce(keyword, 350);
  const [mainCategoryFilter, setMainCategoryFilter] = useState<string>("");
  const [brandFilter, setBrandFilter] = useState<string>("");
  // Subcategories of the selected Main Category only (dependent selector).
  const [subcategoryFilter, setSubcategoryFilter] = useState<string>("");
  const subcategoryOptions = subcategories.filter((s) => !mainCategoryFilter || (s.mainCategory?._id || (s.mainCategory as unknown as string)) === mainCategoryFilter);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({
    initialData: null,
  });

  function handleLoadProducts() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "products",
        params: {
          isDeleted: false,
          limit: 15,
          page: 1,
          keyword: debouncedKeyword,
          ...(mainCategoryFilter ? { mainCategoryId: mainCategoryFilter } : {}),
          ...(brandFilter ? { brands: brandFilter } : {}),
          ...(subcategoryFilter ? { subCategories: subcategoryFilter } : {}),
        },
        signal: controller.signal,
        language,
      });

      setProducts(response.data);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    const cancelRequest = handleLoadProducts(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, [debouncedKeyword, mainCategoryFilter, brandFilter, subcategoryFilter]);

  function handleClose() {
    close();
    setTimeout(() => {
      // setKeyword("");
      // setProducts([]);
      setError("");
    }, 250);
  }

  return (
    <Modal opened={opened} onClose={handleClose} title={translate("Search for a product", "ابحث عن منتج")} size="lg">
      <div className="flex flex-col gap-3">
        {/* Filters */}
        <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
          <TextInput
            placeholder={translate("Title, model / item or SKU...", "العنوان أو الموديل / الصنف أو الكود...")}
            label={translate("Search (title / model / SKU)", "بحث (العنوان / الموديل / الكود)")}
            value={keyword}
            onChange={(e) => setKeyword(e.currentTarget.value)}
            flex={1}
          />

          {/* Main Category */}
          <Select
            value={mainCategoryFilter}
            onChange={(value) => {
              setMainCategoryFilter(value as string);
              setSubcategoryFilter("");
            }}
            label={translate("Main Category", "الفئة الرئيسية")}
            data={[
              { value: "", label: translate("All", "الكل") },
              ...mainCategories.map((category) => ({
                value: category._id,
                label: translate(category.name.en, category.name.ar),
              })),
            ]}
            allowDeselect={false}
            rightSection={mainCategoryFilter ? <solidIcons.Check color="green" size={12} /> : null}
          />

          {/* Subcategory - only those of the selected Main Category */}
          <Select
            value={subcategoryFilter}
            onChange={(value) => setSubcategoryFilter(value as string)}
            label={translate("Subcategory", "الفئة الفرعية")}
            data={[
              { value: "", label: translate("All", "الكل") },
              ...subcategoryOptions.map((s) => ({ value: s._id, label: translate(s.name.en, s.name.ar) })),
            ]}
            allowDeselect={false}
            searchable
            rightSection={subcategoryFilter ? <solidIcons.Check color="green" size={12} /> : null}
          />

          {/* Brand - flat (not scoped to a category), unlike the legacy Subcategory filter this replaces */}
          <Select
            value={brandFilter}
            onChange={(value) => setBrandFilter(value as string)}
            label={translate("Brand", "الماركة")}
            data={[
              { value: "", label: translate("All", "الكل") },
              ...brands.map((b) => ({
                value: b._id,
                label: translate(b.name.en, b.name.ar),
              })),
            ]}
            allowDeselect={false}
            searchable
            rightSection={brandFilter ? <solidIcons.Check color="green" size={12} /> : null}
          />
        </div>

        <div className="flex h-72 flex-col overflow-y-auto">
          {loading ? (
            <LoadingSection message={translate("Loading products", "جاري تحميل المنتجات")} />
          ) : error ? (
            <ErrorSection
              errorTitle={translate("Error loading products", "خطأ في تحميل المنتجات")}
              errorMessage={error}
              button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadProducts }}
            />
          ) : products.length === 0 ? (
            <EmptySection useDefaultImg message={translate("No products found", "لا توجد منتجات")} />
          ) : (
            <>
              {/* Table */}
              <div className="overflow-x-auto">
                <Table className="text-nowrap" verticalSpacing={8.5} stickyHeader highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{translate("Title", "العنوان")}</Table.Th>
                      <Table.Th>{translate("Category / Brand", "الفئة / الماركة")}</Table.Th>
                      <Table.Th>{translate("Model", "الموديل")}</Table.Th>
                      <Table.Th>{translate("Barcode", "الباركود")}</Table.Th>
                      {mode === "purchase" ? (
                        <Table.Th>{translate("Cost", "التكلفة")}</Table.Th>
                      ) : mode === "sales" ? (
                        <>
                          <Table.Th>{translate("Price", "السعر")}</Table.Th>
                          <Table.Th>{translate("After Discount", "بعد الخصم")}</Table.Th>
                        </>
                      ) : null}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {products.map((product) => (
                      <Table.Tr
                        key={product._id}
                        className="cursor-pointer text-gray-600"
                        onClick={() => {
                          if (product.barcode) onSelect(product.barcode);
                          handleClose();
                        }}
                      >
                        <Table.Td className="font-semibold text-gray-800">
                          {translate(product.title.en, product.title.ar)}
                        </Table.Td>
                        <Table.Td>
                          {[product.category ? getMainCategoryNameById(product.category) : null, product.brand ? getBrandNameById(product.brand) : null].filter(Boolean).join(" / ") ||
                            (product.type === "service" ? translate("Service", "خدمة") : "-")}
                        </Table.Td>
                        <Table.Td>{product.model || "-"}</Table.Td>
                        <Table.Td>{product.barcode}</Table.Td>
                        {mode === "purchase" ? (
                          <Table.Td className="font-semibold text-gray-800">
                            {priceText(getPurchaseUnitPrice(product))} {translations.currency}
                          </Table.Td>
                        ) : mode === "sales" ? (
                          <>
                            <Table.Td className="font-semibold text-gray-800">
                              {priceText(product.price)} {translations.currency}
                            </Table.Td>
                            <Table.Td className="font-semibold text-gray-800">
                              {priceText(getProductFinalPrice(product.priceAfterDiscount, product.price))}{" "}
                              {translations.currency}
                            </Table.Td>
                          </>
                        ) : null}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            </>
          )}
        </div>

        <Button onClick={handleClose} variant="light" color="dark" fullWidth>
          {translations.cancel}
        </Button>
      </div>
    </Modal>
  );
}
