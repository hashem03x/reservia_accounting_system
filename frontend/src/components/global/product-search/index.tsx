import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Product } from "@/types/product";
import { Button, Combobox, MantineProvider, TextInput, useCombobox } from "@mantine/core";
import { solidIcons } from "@/components/icons";

export default function ProductSearch({
  product,
  setProduct,
  label,
  description,
  placeholder,
  size = "sm",
  variant = "default",
  raduis = "sm",
  required = false,
  gap = 8,
  changeButtonColor = "red",
  changeButtonVariant = "light",
  changeButtonRaduis = "sm",
}: {
  product: Product | null;
  setProduct: React.Dispatch<React.SetStateAction<Product | null>>;
  label?: string;
  description?: string;
  placeholder?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  variant?: "unstyled" | "filled" | "default";
  raduis?: "xs" | "sm" | "md" | "lg" | "xl" | number;
  gap?: number;
  required?: boolean;
  changeButtonColor?: string;
  changeButtonVariant?: "default" | "filled" | "light" | "outline" | "subtle" | "transparent" | "white";
  changeButtonRaduis?: "xs" | "sm" | "md" | "lg" | "xl" | number;
}) {
  const { language, translate, translations } = useLanguage();

  const [keyword, setKeyword] = useState("");

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: products,
    setData: setProducts,
  } = useDataHandler<Product[]>({ initialData: [] });

  useEffect(() => {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "products",
        params: { isDeleted: false, keyword },
        signal: controller.signal,
        language,
      });
      setProducts(response.data);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }, [keyword]);

  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(value) => {
        setProduct(products.find((product) => product._id === value) || null);
        combobox.closeDropdown();
      }}
    >
      {/* Target (Product Search) */}
      <Combobox.Target>
        <div className="flex items-end" style={{ gap }}>
          <TextInput
            size={size}
            label={label}
            description={description}
            placeholder={placeholder}
            variant={variant}
            radius={raduis}
            required={required}
            value={product ? translate(product.title.en, product.title.ar) : keyword}
            onChange={(event) => {
              setKeyword(event.currentTarget.value);
              combobox.openDropdown();
            }}
            disabled={!!product}
            rightSection={product ? <solidIcons.Check /> : null}
            onClick={() => combobox.openDropdown()}
            onFocus={() => combobox.openDropdown()}
            onBlur={() => combobox.closeDropdown()}
            flex={1}
          />

          {product && (
            <MantineProvider theme={{ activeClassName: "" }}>
              <Button
                px="sm"
                size={size}
                color={changeButtonColor}
                variant={changeButtonVariant}
                radius={changeButtonRaduis}
                title={translate("Change", "تغيير")}
                onClick={() => {
                  setProduct(null);
                  setKeyword("");
                }}
              >
                <solidIcons.NoSymbol size={18} />
              </Button>
            </MantineProvider>
          )}
        </div>
      </Combobox.Target>

      {/* Dropdown */}
      <Combobox.Dropdown>
        <Combobox.Options className="max-h-72 overflow-y-auto">
          {error ? (
            <Combobox.Empty>
              <p className="text-red-600">{error}</p>
            </Combobox.Empty>
          ) : loading ? (
            <Combobox.Empty>
              <p>{translate("Loading", "جاري التحميل")}...</p>
            </Combobox.Empty>
          ) : products.length === 0 ? (
            <Combobox.Empty>
              <p>{translate("No products found", "لم يتم العثور على منتجات")}</p>
            </Combobox.Empty>
          ) : (
            products.map((product) => (
              <Combobox.Option key={product._id} value={product._id} dir={translations.dir} className="flex items-center">
                <div>{translate(product.title.en, product.title.ar)}</div>
              </Combobox.Option>
            ))
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
