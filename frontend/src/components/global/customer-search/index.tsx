import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Customer } from "@/types/customer";
import { Button, Combobox, MantineProvider, TextInput, useCombobox } from "@mantine/core";
import { solidIcons } from "@/components/icons";

export default function CustomerSearch({
  customer,
  setCustomer,
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
  customer: Customer | null;
  setCustomer: React.Dispatch<React.SetStateAction<Customer | null>>;
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
    data: customers,
    setData: setCustomers,
  } = useDataHandler<Customer[]>({ initialData: [] });

  useEffect(() => {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "customers",
        params: { isDeleted: false, limit: 5, keyword, role: "user" },
        signal: controller.signal,
        language,
      });
      setCustomers(response.data);
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
        setCustomer(customers.find((customer) => customer._id === value) || null);
        combobox.closeDropdown();
      }}
    >
      {/* Target (Customer Search) */}
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
            value={customer ? customer.name : keyword}
            onChange={(event) => {
              setKeyword(event.currentTarget.value);
              combobox.openDropdown();
            }}
            disabled={!!customer}
            rightSection={customer ? <solidIcons.Check /> : null}
            onClick={() => combobox.openDropdown()}
            onFocus={() => combobox.openDropdown()}
            onBlur={() => combobox.closeDropdown()}
            flex={1}
          />

          {customer && (
            <MantineProvider theme={{ activeClassName: "" }}>
              <Button
                px="sm"
                size={size}
                color={changeButtonColor}
                variant={changeButtonVariant}
                radius={changeButtonRaduis}
                title={translate("Change", "تغيير")}
                onClick={() => {
                  setCustomer(null);
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
          ) : customers.length === 0 ? (
            <Combobox.Empty>
              <p>{translate("No customers found", "لا يوجد بائعون")}</p>
            </Combobox.Empty>
          ) : (
            customers.map((customer) => (
              <Combobox.Option
                key={customer._id}
                value={customer._id}
                dir={translations.dir}
                className="flex items-center justify-between gap-1"
              >
                <div>{customer.name}</div>
                <div className="text-gray-600">{customer.phone}</div>
              </Combobox.Option>
            ))
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
