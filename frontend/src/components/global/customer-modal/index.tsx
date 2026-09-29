import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { isOnline } from "@/utils/constants/customer-types";
import { Alert, Button, TextInput } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import { Customer } from "@/types/customer";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import BusinessDocumentsSection from "@/components/global/business-documents-section";
import { notifySuccess } from "@/utils/helpers/notifiers";

export default function CustomerModal({
  opened,
  close,
  callback,
  customerToUpdate,
}: {
  opened: boolean;
  close: () => void;
  callback: (customer: Customer) => void;
  customerToUpdate?: Customer;
}) {
  const { language, translate, translations } = useLanguage();

  const [name, setName] = useState(customerToUpdate?.name || "");
  const [phone, setPhone] = useState(customerToUpdate?.phone || "");
  const [additionalPhone, setAdditionalPhone] = useState(customerToUpdate?.additionalPhone || "");
  const [email, setEmail] = useState(customerToUpdate?.email || "");
  const [country, setCountry] = useState(customerToUpdate?.offlineAddress?.country || "");
  const [city, setCity] = useState(customerToUpdate?.offlineAddress?.city || "");
  const [street, setStreet] = useState(customerToUpdate?.offlineAddress?.street || "");
  const [postalCode, setPostalCode] = useState(customerToUpdate?.offlineAddress?.postalCode || "");
  const [taxRegistrationNumber, setTaxRegistrationNumber] = useState(customerToUpdate?.taxInfo?.taxRegistrationNumber || "");
  const [commercialRegistrationNumber, setCommercialRegistrationNumber] = useState(
    customerToUpdate?.taxInfo?.commercialRegistrationNumber || "",
  );
  const [bankName, setBankName] = useState(customerToUpdate?.bankInfo?.bankName || "");
  const [branch, setBranch] = useState(customerToUpdate?.bankInfo?.branch || "");
  const [accountNumber, setAccountNumber] = useState(customerToUpdate?.bankInfo?.accountNumber || "");
  const [iban, setIban] = useState(customerToUpdate?.bankInfo?.iban || "");

  // Once a customer is created (or when editing an existing one), this holds the persisted record
  // so the Customer Number + Documents section become available without closing the modal - a
  // brand-new customer has no _id yet, and document upload/customer-number display both need one.
  const [savedCustomer, setSavedCustomer] = useState<Customer | undefined>(customerToUpdate);

  const isOnlineCustomer = savedCustomer && isOnline(savedCustomer.type);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: savedCustomer ? "PUT" : "POST",
        url: savedCustomer ? `customers/${savedCustomer._id}` : "customers",
        data: {
          name,
          balance: savedCustomer ? savedCustomer.balance : 0,
          contact: { phone, additionalPhone, email: email || undefined },
          offlineAddress: {
            country: country || undefined,
            city: city || undefined,
            street: street || undefined,
            postalCode: postalCode || undefined,
          },
          taxInfo: { taxRegistrationNumber: taxRegistrationNumber || undefined, commercialRegistrationNumber: commercialRegistrationNumber || undefined },
          bankInfo: { bankName: bankName || undefined, branch: branch || undefined, accountNumber: accountNumber || undefined, iban: iban || undefined },
        }, // I send them as undefined instead of empty string to avoid a backend issue.
      });

      setSavedCustomer(res.data);
      callback(res.data);

      if (!customerToUpdate) {
        notifySuccess({
          language,
          title: translate("Success", "تم بنجاح"),
          message: translate("Customer added successfully", "تمت إضافة العميل بنجاح"),
        });
      }
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setName(customerToUpdate?.name || "");
      setPhone(customerToUpdate?.phone || "");
      setAdditionalPhone(customerToUpdate?.additionalPhone || "");
      setEmail(customerToUpdate?.email || "");
      setCountry(customerToUpdate?.offlineAddress?.country || "");
      setCity(customerToUpdate?.offlineAddress?.city || "");
      setStreet(customerToUpdate?.offlineAddress?.street || "");
      setPostalCode(customerToUpdate?.offlineAddress?.postalCode || "");
      setTaxRegistrationNumber(customerToUpdate?.taxInfo?.taxRegistrationNumber || "");
      setCommercialRegistrationNumber(customerToUpdate?.taxInfo?.commercialRegistrationNumber || "");
      setBankName(customerToUpdate?.bankInfo?.bankName || "");
      setBranch(customerToUpdate?.bankInfo?.branch || "");
      setAccountNumber(customerToUpdate?.bankInfo?.accountNumber || "");
      setIban(customerToUpdate?.bankInfo?.iban || "");
      setSavedCustomer(customerToUpdate);
      setError("");
    }, 250);
  }

  const title = translate(
    `${customerToUpdate ? "Update" : "Add"} Customer`,
    `${customerToUpdate ? "تحديث العميل" : "إضافة عميل"}`,
  );

  const dataChanged = savedCustomer
    ? name !== savedCustomer.name ||
      phone !== savedCustomer.phone ||
      additionalPhone !== savedCustomer.additionalPhone ||
      (email || undefined) !== savedCustomer.email ||
      (country || undefined) !== savedCustomer.offlineAddress?.country ||
      (city || undefined) !== savedCustomer.offlineAddress?.city ||
      (street || undefined) !== savedCustomer.offlineAddress?.street ||
      (postalCode || undefined) !== savedCustomer.offlineAddress?.postalCode ||
      (taxRegistrationNumber || undefined) !== savedCustomer.taxInfo?.taxRegistrationNumber ||
      (commercialRegistrationNumber || undefined) !== savedCustomer.taxInfo?.commercialRegistrationNumber ||
      (bankName || undefined) !== savedCustomer.bankInfo?.bankName ||
      (branch || undefined) !== savedCustomer.bankInfo?.branch ||
      (accountNumber || undefined) !== savedCustomer.bankInfo?.accountNumber ||
      (iban || undefined) !== savedCustomer.bankInfo?.iban
    : true;

  return (
    <Modal opened={opened} onClose={handleClose} title={title} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Customer Number - read-only, server-generated (see docs/entities/customers.md) */}
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-2 px-3">
          <p className="text-sm">{translate("Customer Number", "رقم العميل")}:</p>
          <h4 className="text-sm font-semibold">
            {savedCustomer?.customerNumber ?? translate("Automatically generated", "يُنشأ تلقائيًا")}
          </h4>
        </div>

        {/* Online Customer Alert  */}
        {isOnlineCustomer && (
          <Alert color="orange" icon={<solidIcons.ExclamationCircle size={15} />}>
            {translate(
              "Be aware that you are updating an online customer.",
              "كن على علم أنك تقوم بتحديث عميل على الإنترنت.",
            )}
          </Alert>
        )}

        {/* Customer Name & Phone & Email */}
        <section className="grid gap-2">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            label={translate("Customer Name", "اسم العميل")}
            placeholder={translate("Enter Customer Name", "أدخل اسم العميل")}
            required
            autoFocus
          />

          {!isOnlineCustomer && (
            <>
              <div className="flex gap-2">
                <TextInput
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  label={translate("Phone Number", "رقم الهاتف")}
                  placeholder={translate("Enter Phone", "أدخل الهاتف")}
                  required
                  flex={1}
                />
                <TextInput
                  type="tel"
                  value={additionalPhone}
                  onChange={(e) => setAdditionalPhone(e.target.value)}
                  label={translate("Additional Phone Number", "رقم هاتف اضافي")}
                  placeholder={translate("Enter Phone", "أدخل الهاتف")}
                  flex={1}
                />
              </div>
              <TextInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                label={translate("Email (Optional)", "البريد الإلكتروني (اختياري)")}
                placeholder={translate("Enter Email", "أدخل البريد الإلكتروني")}
              />
            </>
          )}
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

        {/* Bank Info */}
        <section className="flex flex-col gap-2">
          <h4>{translate("Bank Info (Optional)", "البيانات البنكية (اختياري)")}</h4>
          <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
            <TextInput
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              label={translate("Bank Name", "إسم البنك")}
              placeholder={translate("Enter Bank Name", "ادخل اسم البنك")}
            />
            <TextInput
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              label={translate("Branch", "الفرع")}
              placeholder={translate("Enter Branch", "ادخل الفرع")}
            />
            <TextInput
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              label={translate("Account Number", "رقم الحساب")}
              placeholder={translate("Enter Account Number", "أدخل رقم الحساب")}
            />
            <TextInput
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              label={translate("IBAN", "رقم ال IBAN")}
              placeholder={translate("Enter IBAN", "أدخل رقم ال IBAN")}
            />
          </div>
        </section>

        <BusinessDocumentsSection
          entityType="customers"
          entityId={savedCustomer?._id}
          documents={savedCustomer?.documents || []}
          onChange={(documents) => {
            const updated = savedCustomer ? { ...savedCustomer, documents } : undefined;
            if (updated) {
              setSavedCustomer(updated);
              callback(updated);
            }
          }}
        />

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {savedCustomer ? translate("Close", "إغلاق") : translations.cancel}
          </Button>
          <Button type="submit" loading={loading} disabled={!name || !phone || !dataChanged} fullWidth>
            {savedCustomer ? translate("Save", "حفظ") : title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
