import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { useLanguage } from "@/context/LanguageContext";
import { useMainCategories } from "@/context/MainCategoriesContext";
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
import { getProductFinalPrice } from "@/utils/helpers/product-helpers";
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
  const { getSubcategoriesByMainCategoryId } = useCategoryHelpers();

  const [products, setProducts] = useState<Product[]>([]);

  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword] = useDebounce(keyword, 350);
  const [mainCategoryFilter, setMainCategoryFilter] = useState<string>("");
  const [subcategoryFilter, setSubcategoryFilter] = useState<string>("");

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
  }, [debouncedKeyword, mainCategoryFilter, subcategoryFilter]);

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
        <div className="flex items-center gap-2">
          <TextInput
            placeholder={translate("Enter product title...", "ادخل عنوان المنتج...")}
            label={translate("Product Title", "عنوان المنتج")}
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
            className="w-32"
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
                { value: "", label: translate("All", "الكل") },
                ...(mainCategoryFilter
                  ? getSubcategoriesByMainCategoryId(mainCategoryFilter).map((subcategory) => ({
                      value: subcategory._id,
                      label: translate(subcategory.name.en, subcategory.name.ar),
                    }))
                  : []),
              ]}
              className="w-32"
              allowDeselect={false}
              rightSection={subcategoryFilter ? <solidIcons.Check color="green" size={12} /> : null}
            />
          )}
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
                        <Table.Td>{product.barcode}</Table.Td>
                        {mode === "purchase" ? (
                          <Table.Td className="font-semibold text-gray-800">
                            {getPurchaseUnitPrice(product).toFixed(2)} {translations.currency}
                          </Table.Td>
                        ) : mode === "sales" ? (
                          <>
                            <Table.Td className="font-semibold text-gray-800">
                              {product.price.toFixed(2)} {translations.currency}
                            </Table.Td>
                            <Table.Td className="font-semibold text-gray-800">
                              {getProductFinalPrice(product.priceAfterDiscount, product.price).toFixed(2)}{" "}
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
