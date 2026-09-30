import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Vendor, VendorType } from "@/types/vendor";
import vendorTypes, { vendorTypesArray } from "@/utils/constants/vendor-types";
import { Button, Select, TextInput } from "@mantine/core";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import BusinessDocumentsSection from "@/components/global/business-documents-section";
import { isValidEgyptianIban } from "@/utils/helpers/validate-bank-info";

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
  const [taxRegistrationNumber, setTaxRegistrationNumber] = useState(vendorToUpdate?.taxInfo?.taxRegistrationNumber || "");
  const [commercialRegistrationNumber, setCommercialRegistrationNumber] = useState(
    vendorToUpdate?.taxInfo?.commercialRegistrationNumber || "",
  );
  const [bankName, setBankName] = useState(vendorToUpdate?.bankInfo?.bankName || "");
  const [branch, setBranch] = useState(vendorToUpdate?.bankInfo?.branch || "");
  const [bankAccountNumber, setBankAccountNumber] = useState(vendorToUpdate?.bankInfo?.accountNumber || "");
  const [bankIbanNumber, setBankIbanNumber] = useState(vendorToUpdate?.bankInfo?.iban || "");
  const [swiftCode, setSwiftCode] = useState(vendorToUpdate?.bankInfo?.swiftCode || "");

  const ibanError =
    bankIbanNumber && !isValidEgyptianIban(bankIbanNumber)
      ? translate(
          'IBAN must start with "EG" and be exactly 29 characters (letters and numbers only).',
          'يجب أن يبدأ رقم الآيبان بـ "EG" ويتكون من 29 حرفًا بالضبط (حروف وأرقام فقط).',
        )
      : undefined;
  const [city, setCity] = useState(vendorToUpdate?.address?.city || "");
  const [street, setStreet] = useState(vendorToUpdate?.address?.street || "");
  const [postalCode, setPostalCode] = useState(vendorToUpdate?.address?.postalCode || "");

  // See customer-modal/index.tsx's identical pattern: holds the persisted record after a create so
  // the Documents section (which needs a real _id) becomes usable without closing the modal.
  const [savedVendor, setSavedVendor] = useState<Vendor | undefined>(vendorToUpdate);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: savedVendor ? "PUT" : "POST",
        url: savedVendor ? `vendors/${savedVendor._id}` : "vendors",
        data: {
          name,
          type,
          balance: savedVendor ? savedVendor.balance : 0,
          contact: { phone, email: email || undefined },
          address: {
            country: country || undefined,
            city: city || undefined,
            street: street || undefined,
            postalCode: postalCode || undefined,
          },
          taxInfo: { taxRegistrationNumber: taxRegistrationNumber || undefined, commercialRegistrationNumber: commercialRegistrationNumber || undefined },
          bankInfo: {
            bankName: bankName || undefined,
            branch: branch || undefined,
            accountNumber: bankAccountNumber || undefined,
            iban: bankIbanNumber || undefined,
            swiftCode: swiftCode || undefined,
          },
        }, // I send them as undefined instead of empty string to avoid a backend issue.
      });

      setSavedVendor(res.data);
      callback(res.data);
      // Deliberately does NOT auto-close on create (unlike this form's previous behavior) - the
      // Documents section requires a real _id to upload against, so we keep the modal open (now
      // in "update" mode via `savedVendor`) and let the user add documents before dismissing via
      // the Close button.
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
      setTaxRegistrationNumber(vendorToUpdate?.taxInfo?.taxRegistrationNumber || "");
      setCommercialRegistrationNumber(vendorToUpdate?.taxInfo?.commercialRegistrationNumber || "");
      setBankName(vendorToUpdate?.bankInfo?.bankName || "");
      setBranch(vendorToUpdate?.bankInfo?.branch || "");
      setBankAccountNumber(vendorToUpdate?.bankInfo?.accountNumber || "");
      setBankIbanNumber(vendorToUpdate?.bankInfo?.iban || "");
      setSwiftCode(vendorToUpdate?.bankInfo?.swiftCode || "");
      setSavedVendor(vendorToUpdate);
      setError("");
    }, 250);
  }

  const title = translate(
    `${vendorToUpdate ? "Update" : "Add"} Vendor`,
    `${vendorToUpdate ? "تحديث البائع" : "إضافة بائع"}`,
  );

  const dataChanged = savedVendor
    ? name !== savedVendor.name ||
      type !== savedVendor.type ||
      phone !== savedVendor.contact.phone ||
      (email || undefined) !== savedVendor.contact.email ||
      (country || undefined) !== savedVendor.address?.country ||
      (city || undefined) !== savedVendor.address?.city ||
      (street || undefined) !== savedVendor.address?.street ||
      (postalCode || undefined) !== savedVendor.address?.postalCode ||
      (taxRegistrationNumber || undefined) !== savedVendor.taxInfo?.taxRegistrationNumber ||
      (commercialRegistrationNumber || undefined) !== savedVendor.taxInfo?.commercialRegistrationNumber ||
      (bankName || undefined) !== savedVendor.bankInfo?.bankName ||
      (branch || undefined) !== savedVendor.bankInfo?.branch ||
      (bankAccountNumber || undefined) !== savedVendor.bankInfo?.accountNumber ||
      (bankIbanNumber || undefined) !== savedVendor.bankInfo?.iban ||
      (swiftCode || undefined) !== savedVendor.bankInfo?.swiftCode
    : true;

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

        {/* Tax Info */}
        <section className="flex flex-col gap-2">
          <h4>{translate("Tax Info (Optional)", "البيانات الضريبية (اختياري)")}</h4>
          <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
            <TextInput
              value={taxRegistrationNumber}
              onChange={(e) => setTaxRegistrationNumber(e.target.value)}
              label={translate("Tax Registration Number", "الرقم الضريبي")}
              placeholder={translate("Enter Tax Registration Number", "أدخل الرقم الضريبي")}
            />
            <TextInput
              value={commercialRegistrationNumber}
              onChange={(e) => setCommercialRegistrationNumber(e.target.value)}
              label={translate("Commercial Registration Number", "رقم السجل التجاري")}
              placeholder={translate("Enter Commercial Registration Number", "أدخل رقم السجل التجاري")}
            />
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h4>{translate("Bank Info (Optional)", "البيانات البنكية (اختياري)")}</h4>
          <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
            <TextInput
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              label={translate("Bank name", "إسم البنك")}
              placeholder={translate("Enter Bank Name", "ادخل اسم البنك")}
            />
            <TextInput
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              label={translate("Branch", "الفرع")}
              placeholder={translate("Enter Branch", "ادخل الفرع")}
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
              label={translate("IBAN", "رقم الآيبان (IBAN)")}
              placeholder={translate("EGxxxxxxxxxxxxxxxxxxxxxxxxxxx", "EGxxxxxxxxxxxxxxxxxxxxxxxxxxx")}
              error={ibanError}
            />
            <TextInput
              value={swiftCode}
              onChange={(e) => setSwiftCode(e.target.value.toUpperCase())}
              label={translate("SWIFT Code", "رمز السويفت (SWIFT)")}
              placeholder={translate("Enter SWIFT Code", "أدخل رمز السويفت")}
            />
          </div>
        </section>

        <BusinessDocumentsSection
          entityType="vendors"
          entityId={savedVendor?._id}
          documents={savedVendor?.documents || []}
          onChange={(documents) => {
            const updated = savedVendor ? { ...savedVendor, documents } : undefined;
            if (updated) {
              setSavedVendor(updated);
              callback(updated);
            }
          }}
        />

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {savedVendor ? translate("Close", "إغلاق") : translations.cancel}
          </Button>
          <Button type="submit" loading={loading} disabled={!name || !type || !phone || !dataChanged || !!ibanError} fullWidth>
            {savedVendor ? translate("Save", "حفظ") : title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
