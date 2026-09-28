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

  const isOnlineCustomer = customerToUpdate && isOnline(customerToUpdate.type);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: customerToUpdate ? "PUT" : "POST",
        url: customerToUpdate ? `customers/${customerToUpdate._id}` : "customers",
        data: {
          name,
          balance: customerToUpdate ? customerToUpdate.balance : 0,
          contact: { phone, additionalPhone, email: email || undefined },
          offlineAddress: {
            country: country || undefined,
            city: city || undefined,
            street: street || undefined,
            postalCode: postalCode || undefined,
          },
        }, // I send them as undefined instead of empty string to avoid a backend issue.
      });

      callback(res.data);
      handleClose();

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
      setPhone(customerToUpdate?.additionalPhone || "");
      setEmail(customerToUpdate?.email || "");
      setCountry(customerToUpdate?.offlineAddress?.country || "");
      setCity(customerToUpdate?.offlineAddress?.city || "");
      setStreet(customerToUpdate?.offlineAddress?.street || "");
      setPostalCode(customerToUpdate?.offlineAddress?.postalCode || "");
      setError("");
    }, 250);
  }

  const title = translate(
    `${customerToUpdate ? "Update" : "Add"} Customer`,
    `${customerToUpdate ? "تحديث العميل" : "إضافة عميل"}`,
  );

  const dataChanged = customerToUpdate
    ? name !== customerToUpdate.name ||
      phone !== customerToUpdate.phone ||
      additionalPhone !== customerToUpdate.additionalPhone ||
      (email || undefined) !== customerToUpdate.email ||
      (country || undefined) !== customerToUpdate.offlineAddress?.country ||
      (city || undefined) !== customerToUpdate.offlineAddress?.city ||
      (street || undefined) !== customerToUpdate.offlineAddress?.street ||
      (postalCode || undefined) !== customerToUpdate.offlineAddress?.postalCode
    : false;

  return (
    <Modal opened={opened} onClose={handleClose} title={title} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={!name || !phone || (!!customerToUpdate && !dataChanged)}
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
