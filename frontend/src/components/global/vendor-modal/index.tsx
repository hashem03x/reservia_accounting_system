import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Vendor, VendorType } from "@/types/vendor";
import vendorTypes, { vendorTypesArray } from "@/utils/constants/vendor-types";
import { Button, Select, TextInput } from "@mantine/core";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";

export default function VendorModal({
  opened,
  close,
  callback,
  vendorToUpdate,
}: {
  opened: boolean;
  close: () => void;
  callback: (vendor: Vendor) => void;
  vendorToUpdate?: Vendor;
}) {
  const { language, translate, translations } = useLanguage();

  const [name, setName] = useState(vendorToUpdate?.name || "");
  const [type, setType] = useState<VendorType>(vendorToUpdate?.type || vendorTypes.current.value);
  const [phone, setPhone] = useState(vendorToUpdate?.contact.phone || "");
  const [email, setEmail] = useState(vendorToUpdate?.contact.email || "");
  const [country, setCountry] = useState(vendorToUpdate?.address?.country || "");
  const [bankName, setBankName] = useState(vendorToUpdate?.bankInfo?.bankName || "");
  const [bankBranchName, setBankBranchName] = useState(vendorToUpdate?.bankInfo?.branchName || "");
  const [bankAccountNumber, setBankAccountNumber] = useState(vendorToUpdate?.bankInfo?.accountNumber || "");
  const [bankIbanNumber, setBankIbanNumber] = useState(vendorToUpdate?.bankInfo?.iban || "");
  const [city, setCity] = useState(vendorToUpdate?.address?.city || "");
  const [street, setStreet] = useState(vendorToUpdate?.address?.street || "");
  const [postalCode, setPostalCode] = useState(vendorToUpdate?.address?.postalCode || "");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: vendorToUpdate ? "PUT" : "POST",
        url: vendorToUpdate ? `vendors/${vendorToUpdate._id}` : "vendors",
        data: {
          name,
          type,
          balance: vendorToUpdate ? vendorToUpdate.balance : 0,
          contact: { phone, email: email || undefined },
          address: {
            country: country || undefined,
            city: city || undefined,
            street: street || undefined,
            postalCode: postalCode || undefined,
          },
        }, // I send them as undefined instead of empty string to avoid a backend issue.
      });

      callback(res.data);
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setName(vendorToUpdate?.name || "");
      setType(vendorToUpdate?.type || vendorTypes.current.value);
      setPhone(vendorToUpdate?.contact.phone || "");
      setEmail(vendorToUpdate?.contact.email || "");
      setCountry(vendorToUpdate?.address?.country || "");
      setCity(vendorToUpdate?.address?.city || "");
      setStreet(vendorToUpdate?.address?.street || "");
      setPostalCode(vendorToUpdate?.address?.postalCode || "");
      setError("");
    }, 250);
  }

  const title = translate(
    `${vendorToUpdate ? "Update" : "Add"} Vendor`,
    `${vendorToUpdate ? "تحديث البائع" : "إضافة بائع"}`,
  );

  const dataChanged = vendorToUpdate
    ? name !== vendorToUpdate.name ||
      type !== vendorToUpdate.type ||
      phone !== vendorToUpdate.contact.phone ||
      (email || undefined) !== vendorToUpdate.contact.email ||
      (country || undefined) !== vendorToUpdate.address?.country ||
      (city || undefined) !== vendorToUpdate.address?.city ||
      (street || undefined) !== vendorToUpdate.address?.street ||
      (postalCode || undefined) !== vendorToUpdate.address?.postalCode
    : false;

  return (
    <Modal opened={opened} onClose={handleClose} title={title} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Vendor Name & Phone & Email */}
        <section className="grid gap-2">
          <div className="flex items-center gap-2">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              label={translate("Vendor Name", "اسم البائع")}
              placeholder={translate("Enter Vendor Name", "أدخل اسم البائع")}
              required
              autoFocus
              flex={1}
            />
            <Select
              value={type}
              onChange={(value) => setType(value as VendorType)}
              data={vendorTypesArray.map((type) => ({ value: type.value, label: translate(type.label.en, type.label.ar) }))}
              label={translate("Type", "النوع")}
              placeholder={translate("Select Type", "اختر النوع")}
              allowDeselect={false}
              style={{ width: 185 }}
              required
            />
          </div>

          <TextInput
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            label={translate("Phone", "الهاتف")}
            placeholder={translate("Enter Phone", "أدخل الهاتف")}
            required
          />

          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            label={translate("Email (Optional)", "البريد الإلكتروني (اختياري)")}
            placeholder={translate("Enter Email", "أدخل البريد الإلكتروني")}
          />
        </section>

        {/* Address */}
        <section className="flex flex-col gap-2">
          <h4>{translate("Address (Optional)", "العنوان (اختياري)")}</h4>
          <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
            <TextInput
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              label={translate("Country", "الدولة")}
              placeholder={translate("Enter Country", "أدخل الدولة")}
            />
            <TextInput
              value={city}
              onChange={(e) => setCity(e.target.value)}
              label={translate("City", "المدينة")}
              placeholder={translate("Enter City", "أدخل المدينة")}
            />
            <TextInput
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              label={translate("Street", "الشارع")}
              placeholder={translate("Enter Street", "أدخل الشارع")}
            />
            <TextInput
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              label={translate("Postal Code", "الرمز البريدي")}
              placeholder={translate("Enter Postal Code", "أدخل الرمز البريدي")}
            />
          </div>
        </section>
        <section className="flex flex-col gap-2">
          <h4>{translate("Bank Info", "البيانات البنكية")}</h4>
          <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
            <TextInput
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              label={translate("Bank name", "إسم البنك")}
              placeholder={translate("Enter Bank Name", "ادخل اسم البنك")}
            />
            <TextInput
              value={bankBranchName}
              onChange={(e) => setBankBranchName(e.target.value)}
              label={translate("Branch Name", "إسم الفرع")}
              placeholder={translate("Enter Branch Name", "ادخل اسم الفرع")}
            />
            <TextInput
              value={bankAccountNumber}
              onChange={(e) => setBankAccountNumber(e.target.value)}
              label={translate("Account Number", "رقم الحساب")}
              placeholder={translate("Enter Account Number", "أدخل رقم الحساب")}
            />
            <TextInput
              value={bankIbanNumber}
              onChange={(e) => setBankIbanNumber(e.target.value)}
              label={translate("IBAN Number", "رقم ال IBAN")}
              placeholder={translate("Enter IBAN Number", "أدخل رقم ال IBAN")}
            />
          </div>
        </section>

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={!name || !type || !phone || (!!vendorToUpdate && !dataChanged)}
            fullWidth
          >
            {title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
