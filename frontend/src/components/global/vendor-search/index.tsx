import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Vendor } from "@/types/vendor";
import { Button, Combobox, MantineProvider, TextInput, useCombobox } from "@mantine/core";
import { solidIcons } from "@/components/icons";

export default function VendorSearch({
  vendor,
  setVendor,
  label,
  description,
  placeholder,
  size = "sm",
  variant = "default",
  raduis = "sm",
  required = false,
  withAsterisk = false,
  gap = 8,
  changeButtonColor = "red",
  changeButtonVariant = "light",
  changeButtonRaduis = "sm",
}: {
  vendor: Vendor | null;
  setVendor: React.Dispatch<React.SetStateAction<Vendor | null>>;
  label?: string;
  description?: string;
  placeholder?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  variant?: "unstyled" | "filled" | "default";
  raduis?: "xs" | "sm" | "md" | "lg" | "xl" | number;
  required?: boolean;
  withAsterisk?: boolean;
  gap?: number;
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
    data: vendors,
    setData: setVendors,
  } = useDataHandler<Vendor[]>({ initialData: [] });

  useEffect(() => {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "vendors",
        params: { isDeleted: false, limit: 5, keyword },
        signal: controller.signal,
        language,
      });
      setVendors(response.data);
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
        setVendor(vendors.find((vendor) => vendor._id === value) || null);
        combobox.closeDropdown();
      }}
    >
      {/* Target (Vendor Search) */}
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
            withAsterisk={withAsterisk}
            value={vendor ? vendor.name : keyword}
            onChange={(event) => {
              setKeyword(event.currentTarget.value);
              combobox.openDropdown();
            }}
            disabled={!!vendor}
            rightSection={vendor ? <solidIcons.Check /> : null}
            onClick={() => combobox.openDropdown()}
            onFocus={() => combobox.openDropdown()}
            onBlur={() => combobox.closeDropdown()}
            flex={1}
          />

          {vendor && (
            <MantineProvider theme={{ activeClassName: "" }}>
              <Button
                px="sm"
                size={size}
                color={changeButtonColor}
                variant={changeButtonVariant}
                radius={changeButtonRaduis}
                title={translate("Change", "تغيير")}
                onClick={() => {
                  setVendor(null);
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
          ) : vendors.length === 0 ? (
            <Combobox.Empty>
              <p>{translate("No vendors found", "لا يوجد بائعون")}</p>
            </Combobox.Empty>
          ) : (
            vendors.map((vendor) => (
              <Combobox.Option
                key={vendor._id}
                value={vendor._id}
                dir={translations.dir}
                className="flex items-center justify-between gap-1"
              >
                <div>{vendor.name}</div>
                <div className="text-gray-600">{vendor.contact.phone}</div>
              </Combobox.Option>
            ))
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
