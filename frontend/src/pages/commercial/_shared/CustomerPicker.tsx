import { useEffect, useState } from "react";
import { Button, Select, TextInput } from "@mantine/core";
import errorMessage from "@/utils/helpers/error-message";
import { useDebouncedValue } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";

export type CommercialCustomer = { _id: string; name: string; phone?: string; email?: string; customerNumber?: string | number };

/**
 * QA finding U1 - the project's customer is a LOOKUP against the shared customer list (the same
 * customer records the ERP uses), shown as a search with a "Select a customer" placeholder, a clear
 * message when nothing matches, and inline "Create customer" (name + phone, deduplicated by phone on
 * the server - an existing customer with that number is selected instead of duplicated).
 */
export default function CustomerPicker({
  value,
  onChange,
  required = false,
  error,
}: {
  value: CommercialCustomer | null;
  onChange: (c: CommercialCustomer | null) => void;
  required?: boolean;
  error?: string;
}) {
  const { translate, language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 250);
  const [options, setOptions] = useState<CommercialCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [createError, setCreateError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    privateRequest({ url: "commercial/projects/customers", params: { keyword: debounced, limit: "15" }, language })
      .then((res) => {
        if (!canceled) setOptions(res.data as CommercialCustomer[]);
      })
      .catch(() => {
        if (!canceled) setOptions([]);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const all = value && !options.some((o) => o._id === value._id) ? [value, ...options] : options;
  const label = (c: CommercialCustomer) => [c.name, c.customerNumber ? `#${c.customerNumber}` : null, c.phone].filter(Boolean).join(" - ");

  async function createCustomer() {
    setCreateError("");
    if (!newName.trim() || !newPhone.trim()) {
      setCreateError(translate("Name and phone are required.", "الاسم والهاتف مطلوبان."));
      return;
    }
    setSaving(true);
    try {
      const res = await privateRequest({ url: "commercial/projects/customers", method: "POST", data: { name: newName, phone: newPhone, email: newEmail || undefined }, language });
      const customer = res.data.customer as CommercialCustomer;
      onChange(customer);
      setOptions((prev) => [customer, ...prev.filter((p) => p._id !== customer._id)]);
      setCreating(false);
      setNewName("");
      setNewPhone("");
      setNewEmail("");
    } catch (e) {
      setCreateError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Select
        label={translate("Customer", "العميل")}
        placeholder={translate("Select a customer", "اختر عميلاً")}
        description={translate("Search the customer list by name, phone or customer number.", "ابحث في قائمة العملاء بالاسم أو الهاتف أو رقم العميل.")}
        searchable
        clearable
        required={required}
        withAsterisk={required}
        error={error}
        data={all.map((c) => ({ value: c._id, label: label(c) }))}
        value={value?._id || null}
        onChange={(id) => onChange(all.find((c) => c._id === id) || null)}
        searchValue={search}
        onSearchChange={setSearch}
        filter={({ options: o }) => o}
        nothingFoundMessage={
          loading
            ? translate("Searching...", "جاري البحث...")
            : translate("No customer matches this search - create the customer below.", "لا يوجد عميل مطابق - أنشئ العميل بالأسفل.")
        }
      />
      {!creating ? (
        <Button variant="subtle" size="xs" className="self-start" onClick={() => (setCreating(true), setNewName(search))}>
          {translate("+ Create a new customer", "+ إنشاء عميل جديد")}
        </Button>
      ) : (
        <div className="rounded-md border border-gray-200 p-3">
          <p className="mb-2 text-xs text-gray-500">
            {translate(
              "Adds the customer to the shared customer list (used by the ERP too). If the phone number already belongs to a customer, that customer is selected instead.",
              "يضيف العميل إلى قائمة العملاء المشتركة (المستخدمة في نظام ERP أيضاً). إذا كان رقم الهاتف لعميل موجود، يتم اختياره بدلاً من إنشاء عميل مكرر."
            )}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <TextInput size="xs" label={translate("Name", "الاسم")} value={newName} onChange={(e) => setNewName(e.currentTarget.value)} required />
            <TextInput size="xs" label={translate("Phone", "الهاتف")} value={newPhone} onChange={(e) => setNewPhone(e.currentTarget.value)} required />
            <TextInput size="xs" label={translate("Email (optional)", "البريد (اختياري)")} value={newEmail} onChange={(e) => setNewEmail(e.currentTarget.value)} />
          </div>
          {createError && <p className="mt-1 text-xs text-red-600">{createError}</p>}
          <div className="mt-2 flex gap-2">
            <Button size="xs" color="teal" loading={saving} onClick={createCustomer}>
              {translate("Create & select", "إنشاء واختيار")}
            </Button>
            <Button size="xs" variant="default" onClick={() => setCreating(false)}>
              {translate("Cancel", "إلغاء")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
