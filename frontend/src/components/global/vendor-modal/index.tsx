import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { PaymentTerms as VendorPaymentTerms, PaymentTermsConfig, Vendor, VendorType } from "@/types/vendor";
import { PaymentMode, WalletProvider } from "@/types/document";
import vendorTypes, { vendorTypesArray } from "@/utils/constants/vendor-types";
import { Button, NumberInput, Select, TextInput } from "@mantine/core";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import BusinessDocumentsSection from "@/components/global/business-documents-section";
import { isValidEgyptianIban } from "@/utils/helpers/validate-bank-info";
import PaymentTermsConfigSection, { validatePaymentTermsConfigClientSide } from "./payment-terms-config-section";

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
  const [cashFlowActivity, setCashFlowActivity] = useState<string>(vendorToUpdate?.cashFlowActivity || "");
  const [phone, setPhone] = useState(vendorToUpdate?.contact.phone || "");
  const [email, setEmail] = useState(vendorToUpdate?.contact.email || "");
  const [country, setCountry] = useState(vendorToUpdate?.address?.country || "");
  const [taxRegistrationNumber, setTaxRegistrationNumber] = useState(vendorToUpdate?.taxInfo?.taxRegistrationNumber || "");
  const [commercialRegistrationNumber, setCommercialRegistrationNumber] = useState(
    vendorToUpdate?.taxInfo?.commercialRegistrationNumber || "",
  );
  // Payment Information (docs section "Vendor Payment Information") - replaces the old
  // free-standing Bank Info section below with a single mode selector. Writes to the new
  // `paymentInfo` field only - the legacy `bankInfo` field is never touched by this form anymore,
  // but stays intact in the database (see scripts/migrateVendorPaymentInfo.js).
  const [paymentMode, setPaymentMode] = useState<PaymentMode | "">(vendorToUpdate?.paymentInfo?.mode || "");
  const [instapayIdentifier, setInstapayIdentifier] = useState(vendorToUpdate?.paymentInfo?.instapay?.identifier || "");
  const [walletProvider, setWalletProvider] = useState<WalletProvider | "">(vendorToUpdate?.paymentInfo?.wallet?.provider || "");
  const [walletIdentifier, setWalletIdentifier] = useState(vendorToUpdate?.paymentInfo?.wallet?.identifier || "");
  const [bankName, setBankName] = useState(vendorToUpdate?.paymentInfo?.bank?.bankName || "");
  const [bankAccountHolderName, setBankAccountHolderName] = useState(vendorToUpdate?.paymentInfo?.bank?.accountHolderName || "");
  const [bankAccountNumber, setBankAccountNumber] = useState(vendorToUpdate?.paymentInfo?.bank?.accountNumber || "");
  const [bankIbanNumber, setBankIbanNumber] = useState(vendorToUpdate?.paymentInfo?.bank?.iban || "");
  const [swiftCode, setSwiftCode] = useState(vendorToUpdate?.paymentInfo?.bank?.swiftCode || "");

  // Payment Terms (docs section "Payment Terms for Customers and Vendors") - governs the due
  // date calculated for this vendor's future Purchase Invoices. Defaults to the schema's own
  // 'Net 30' for a brand-new vendor.
  const [paymentTerms, setPaymentTerms] = useState<VendorPaymentTerms>(vendorToUpdate?.paymentTerms || "Net 30");
  const [customPaymentDays, setCustomPaymentDays] = useState<string | number>(vendorToUpdate?.customPaymentDays ?? "");
  const paymentTermsIncomplete = paymentTerms === "Custom" && (customPaymentDays === "" || customPaymentDays == null);

  // Vendor Payment Terms - Lump Sum and Installments (docs section "Vendor Payment Terms") -
  // additive, separate from paymentTerms/customPaymentDays above (never replaces them).
  const defaultPaymentTermsConfig: PaymentTermsConfig = { kind: "lump_sum", lumpSum: { timing: "immediate", durationDays: 0 } };
  const [paymentTermsConfig, setPaymentTermsConfig] = useState<PaymentTermsConfig>(vendorToUpdate?.paymentTermsConfig || defaultPaymentTermsConfig);
  const paymentTermsConfigError = validatePaymentTermsConfigClientSide(paymentTermsConfig, translate);

  // Mirrors the backend's conditional validator (vendorValidators.js#paymentInfoValidators) -
  // whichever mode is selected, its required sub-fields must be filled before submitting.
  const paymentInfoIncomplete =
    paymentMode === "instapay"
      ? !instapayIdentifier
      : paymentMode === "wallet"
        ? !walletProvider || !walletIdentifier
        : paymentMode === "bank"
          ? !bankName || !bankAccountNumber
          : false;

  const ibanError =
    bankIbanNumber && !isValidEgyptianIban(bankIbanNumber)
      ? translate(
          'IBAN must start with "EG" and be exactly 29 characters (letters and numbers only).',
          'يجب أن يبدأ رقم الآيبان بـ "EG" ويتكون من 29 حرفًا بالضبط (حروف وأرقام فقط).',
        )
      : undefined;

  const emailError =
    email && !/\S+@\S+\.\S+/.test(email)
      ? translate("Enter a valid email address.", "أدخل بريدًا إلكترونيًا صحيحًا.")
      : undefined;
  const [city, setCity] = useState(vendorToUpdate?.address?.city || "");
  const [street, setStreet] = useState(vendorToUpdate?.address?.street || "");
  // Postal Code is no longer collected (docs section "Remove Postal Code") - this form has no
  // input for it anymore. Kept as internal, never-edited state (initialized from any existing
  // value) purely so an unrelated edit still resends it unchanged in `address` below - this
  // controller applies the whole `address` object via `$set`, so omitting the field here would
  // otherwise silently wipe a legacy vendor's already-stored postal code.
  const [postalCode] = useState(vendorToUpdate?.address?.postalCode || "");

  // See customer-modal/index.tsx's identical pattern: holds the persisted record after a create so
  // the Documents section (which needs a real _id) becomes usable without closing the modal.
  const [savedVendor, setSavedVendor] = useState<Vendor | undefined>(vendorToUpdate);

  // Email is mandatory for a NEW vendor (docs section "Mandatory Vendor and Customer Contact
  // Information") - an existing vendor missing one (created before this rule existed) is never
  // blocked from saving an unrelated change just because its email is empty.
  const isNewVendor = !savedVendor;

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
          cashFlowActivity: cashFlowActivity || null,
          balance: savedVendor ? savedVendor.balance : 0,
          contact: { phone, email: email || undefined },
          address: {
            country: country || undefined,
            city: city || undefined,
            street: street || undefined,
            postalCode: postalCode || undefined,
          },
          taxInfo: {
            taxRegistrationNumber: taxRegistrationNumber || undefined,
            commercialRegistrationNumber: commercialRegistrationNumber || undefined,
          },
          paymentInfo: paymentMode
            ? {
                mode: paymentMode,
                instapay: paymentMode === "instapay" ? { identifier: instapayIdentifier || undefined } : undefined,
                wallet: paymentMode === "wallet" ? { provider: walletProvider || undefined, identifier: walletIdentifier || undefined } : undefined,
                bank:
                  paymentMode === "bank"
                    ? {
                        bankName: bankName || undefined,
                        accountHolderName: bankAccountHolderName || undefined,
                        accountNumber: bankAccountNumber || undefined,
                        iban: bankIbanNumber || undefined,
                        swiftCode: swiftCode || undefined,
                      }
                    : undefined,
              }
            : undefined,
          paymentTerms,
          customPaymentDays: paymentTerms === "Custom" ? Number(customPaymentDays) : undefined,
          paymentTermsConfig,
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
      setCashFlowActivity(vendorToUpdate?.cashFlowActivity || "");
      setPhone(vendorToUpdate?.contact.phone || "");
      setEmail(vendorToUpdate?.contact.email || "");
      setCountry(vendorToUpdate?.address?.country || "");
      setCity(vendorToUpdate?.address?.city || "");
      setStreet(vendorToUpdate?.address?.street || "");
      setTaxRegistrationNumber(vendorToUpdate?.taxInfo?.taxRegistrationNumber || "");
      setCommercialRegistrationNumber(vendorToUpdate?.taxInfo?.commercialRegistrationNumber || "");
      setPaymentMode(vendorToUpdate?.paymentInfo?.mode || "");
      setInstapayIdentifier(vendorToUpdate?.paymentInfo?.instapay?.identifier || "");
      setWalletProvider(vendorToUpdate?.paymentInfo?.wallet?.provider || "");
      setWalletIdentifier(vendorToUpdate?.paymentInfo?.wallet?.identifier || "");
      setBankName(vendorToUpdate?.paymentInfo?.bank?.bankName || "");
      setBankAccountHolderName(vendorToUpdate?.paymentInfo?.bank?.accountHolderName || "");
      setBankAccountNumber(vendorToUpdate?.paymentInfo?.bank?.accountNumber || "");
      setBankIbanNumber(vendorToUpdate?.paymentInfo?.bank?.iban || "");
      setSwiftCode(vendorToUpdate?.paymentInfo?.bank?.swiftCode || "");
      setPaymentTerms(vendorToUpdate?.paymentTerms || "Net 30");
      setCustomPaymentDays(vendorToUpdate?.customPaymentDays ?? "");
      setPaymentTermsConfig(vendorToUpdate?.paymentTermsConfig || defaultPaymentTermsConfig);
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
      (taxRegistrationNumber || undefined) !== savedVendor.taxInfo?.taxRegistrationNumber ||
      (commercialRegistrationNumber || undefined) !== savedVendor.taxInfo?.commercialRegistrationNumber ||
      (paymentMode || undefined) !== (savedVendor.paymentInfo?.mode || undefined) ||
      (instapayIdentifier || undefined) !== savedVendor.paymentInfo?.instapay?.identifier ||
      (walletProvider || undefined) !== (savedVendor.paymentInfo?.wallet?.provider || undefined) ||
      (walletIdentifier || undefined) !== savedVendor.paymentInfo?.wallet?.identifier ||
      (bankName || undefined) !== savedVendor.paymentInfo?.bank?.bankName ||
      (bankAccountHolderName || undefined) !== savedVendor.paymentInfo?.bank?.accountHolderName ||
      (bankAccountNumber || undefined) !== savedVendor.paymentInfo?.bank?.accountNumber ||
      (bankIbanNumber || undefined) !== savedVendor.paymentInfo?.bank?.iban ||
      (swiftCode || undefined) !== savedVendor.paymentInfo?.bank?.swiftCode ||
      paymentTerms !== (savedVendor.paymentTerms || "Net 30") ||
      (paymentTerms === "Custom" ? Number(customPaymentDays) : undefined) !== savedVendor.customPaymentDays ||
      JSON.stringify(paymentTermsConfig) !== JSON.stringify(savedVendor.paymentTermsConfig || defaultPaymentTermsConfig)
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

          <Select
            value={cashFlowActivity || null}
            onChange={(value) => setCashFlowActivity(value || "")}
            data={[
              { value: "operating", label: translate("Operating", "تشغيلية") },
              { value: "investing", label: translate("Investing", "استثمارية") },
              { value: "financing", label: translate("Financing", "تمويلية") },
            ]}
            label={translate("Cash Flow Classification (optional)", "التصنيف في التدفقات النقدية (اختياري)")}
            description={translate(
              'How payments to this vendor appear in the Cash Flow Statement. Leave empty to classify by account (operating). Use Financing for e.g. "Supplier - Finance Activities".',
              'كيف تظهر المدفوعات لهذا المورد في قائمة التدفقات النقدية. اتركه فارغاً للتصنيف حسب الحساب (تشغيلية). استخدم تمويلية مثلاً لـ "Supplier - Finance Activities".',
            )}
            placeholder={translate("By account (default)", "حسب الحساب (افتراضي)")}
            clearable
          />

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
            label={isNewVendor ? translate("Email", "البريد الإلكتروني") : translate("Email (Optional)", "البريد الإلكتروني (اختياري)")}
            placeholder={translate("Enter Email", "أدخل البريد الإلكتروني")}
            required={isNewVendor}
            error={emailError}
          />

          {/* Payment Terms (docs section "Payment Terms for Customers and Vendors") - governs the
              due date calculated for this vendor's future Purchase Invoices. */}
          <div className="flex gap-2">
            <Select
              value={paymentTerms}
              onChange={(value) => setPaymentTerms((value as VendorPaymentTerms) || "Net 30")}
              data={[
                { value: "Immediate", label: translate("Immediate", "فوري") },
                { value: "Net 15", label: translate("Net 15", "صافي 15 يوم") },
                { value: "Net 30", label: translate("Net 30", "صافي 30 يوم") },
                { value: "Net 45", label: translate("Net 45", "صافي 45 يوم") },
                { value: "Net 60", label: translate("Net 60", "صافي 60 يوم") },
                { value: "Custom", label: translate("Custom", "مخصص") },
              ]}
              label={translate("Payment Terms", "شروط الدفع")}
              allowDeselect={false}
              flex={1}
            />
            {paymentTerms === "Custom" && (
              <NumberInput
                value={customPaymentDays}
                onChange={setCustomPaymentDays}
                label={translate("Custom Days", "عدد الأيام المخصصة")}
                placeholder={translate("Enter number of days", "أدخل عدد الأيام")}
                min={0}
                required
                flex={1}
              />
            )}
          </div>
        </section>

        <PaymentTermsConfigSection value={paymentTermsConfig} onChange={setPaymentTermsConfig} />

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

        {/* Payment Information (docs section "Vendor Payment Information") - exactly one mode at
            a time; only that mode's fields are shown. This is the vendor's OWN preferred payout
            method - never the company's Chart-of-Accounts cash/bank account used to record an
            actual payment (that selection happens separately, on the Payment form itself). */}
        <section className="flex flex-col gap-2">
          <h4>{translate("Payment Information (Optional)", "معلومات الدفع (اختياري)")}</h4>
          <Select
            value={paymentMode || null}
            onChange={(value) => setPaymentMode((value as PaymentMode) || "")}
            data={[
              { value: "instapay", label: translate("Instapay", "إنستاباي") },
              { value: "wallet", label: translate("Wallet", "محفظة إلكترونية") },
              { value: "bank", label: translate("Bank Details", "بيانات بنكية") },
            ]}
            label={translate("Payment Mode", "طريقة الدفع")}
            placeholder={translate("Select payment mode", "اختر طريقة الدفع")}
            clearable
          />

          {paymentMode === "instapay" && (
            <TextInput
              value={instapayIdentifier}
              onChange={(e) => setInstapayIdentifier(e.target.value)}
              label={translate("Instapay Identifier", "معرف إنستاباي")}
              placeholder={translate("Mobile number, username or IPA", "رقم الهاتف أو اسم المستخدم أو IPA")}
              required
            />
          )}

          {paymentMode === "wallet" && (
            <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
              <Select
                value={walletProvider || null}
                onChange={(value) => setWalletProvider((value as WalletProvider) || "")}
                data={[
                  { value: "vodafone_cash", label: translate("Vodafone Cash", "فودافون كاش") },
                  { value: "orange_cash", label: translate("Orange Cash", "أورنج كاش") },
                  { value: "etisalat_cash", label: translate("Etisalat Cash", "اتصالات كاش") },
                  { value: "we_pay", label: translate("WE Pay", "وي باي") },
                  { value: "fawry", label: translate("Fawry", "فوري") },
                  { value: "other", label: translate("Other", "أخرى") },
                ]}
                label={translate("Wallet Provider", "مزود المحفظة")}
                placeholder={translate("Select provider", "اختر المزود")}
                required
              />
              <TextInput
                value={walletIdentifier}
                onChange={(e) => setWalletIdentifier(e.target.value)}
                label={translate("Wallet Number", "رقم المحفظة")}
                placeholder={translate("Enter wallet phone number", "أدخل رقم المحفظة")}
                required
              />
            </div>
          )}

          {paymentMode === "bank" && (
            <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
              <TextInput
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                label={translate("Bank Name", "إسم البنك")}
                placeholder={translate("Enter Bank Name", "ادخل اسم البنك")}
                required
              />
              <TextInput
                value={bankAccountHolderName}
                onChange={(e) => setBankAccountHolderName(e.target.value)}
                label={translate("Account Holder Name", "اسم صاحب الحساب")}
                placeholder={translate("Enter Account Holder Name", "أدخل اسم صاحب الحساب")}
              />
              <TextInput
                value={bankAccountNumber}
                onChange={(e) => setBankAccountNumber(e.target.value)}
                label={translate("Account Number", "رقم الحساب")}
                placeholder={translate("Enter Account Number", "أدخل رقم الحساب")}
                required
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
          )}
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
          <Button
            type="submit"
            loading={loading}
            disabled={
              !name ||
              !type ||
              !phone ||
              (isNewVendor && !email) ||
              !dataChanged ||
              !!ibanError ||
              !!emailError ||
              paymentInfoIncomplete ||
              paymentTermsIncomplete ||
              !!paymentTermsConfigError
            }
            fullWidth
          >
            {savedVendor ? translate("Save", "حفظ") : title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
