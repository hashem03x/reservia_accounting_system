import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { toDateOnly } from "@/utils/helpers/format-date";
import { Button, NumberInput, Select, Switch, Textarea, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import PaymentAccountSelect from "@/components/global/payment-account-select";
import useEquityAccounts from "./use-equity-accounts";
import { Shareholder, ShareholderStatus } from "@/types/shareholder";

// Create (with an optional first capital contribution) or edit a shareholder.
export default function ShareholderModal({
  opened,
  close,
  shareholder,
  onSaved,
}: {
  opened: boolean;
  close: () => void;
  shareholder?: Shareholder | null;
  onSaved: (shareholder: Shareholder) => void;
}) {
  const { language, translate } = useLanguage();
  const privateRequest = usePrivateRequest();
  const equityAccounts = useEquityAccounts(opened);
  const isEdit = !!shareholder;

  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [address, setAddress] = useState("");
  const [ownershipPercentage, setOwnershipPercentage] = useState<string | number>("");
  const [equityAccount, setEquityAccount] = useState("");
  const [status, setStatus] = useState<ShareholderStatus>("active");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [notes, setNotes] = useState("");
  const [withContribution, setWithContribution] = useState(false);
  const [amount, setAmount] = useState<string | number>("");
  const [paymentAccount, setPaymentAccount] = useState("");
  const [date, setDate] = useState<Date | null>(new Date());

  const { loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (!opened) return;
    setName(shareholder?.name || "");
    setNameAr(shareholder?.nameAr || "");
    setAddress(shareholder?.address || "");
    setOwnershipPercentage(shareholder?.ownershipPercentage ?? "");
    setEquityAccount(shareholder?.equityAccount?._id || "");
    setStatus(shareholder?.status || "active");
    setPhone(shareholder?.phone || "");
    setEmail(shareholder?.email || "");
    setNationalId(shareholder?.nationalId || "");
    setNotes(shareholder?.notes || "");
    setWithContribution(false);
    setAmount("");
    setPaymentAccount("");
    setDate(new Date());
    setError("");
  }, [opened, shareholder]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const data = {
        name,
        nameAr,
        address,
        ownershipPercentage,
        equityAccount,
        status,
        phone,
        email,
        nationalId,
        notes,
        ...(!isEdit && withContribution ? { contribution: { amount, paymentAccount, date: date ? toDateOnly(date) : undefined, idempotencyKey: crypto.randomUUID() } } : {}),
      };
      const res = await privateRequest({ language, method: isEdit ? "PATCH" : "POST", url: isEdit ? `shareholders/${shareholder._id}` : "shareholders", data });
      onSaved(res.data);
      close();
    });
  }

  // Full client-side National ID checksum validation isn't attempted (the backend's own comment
  // on this explains why - no publicly-published check-digit algorithm); this is just the same
  // length/shape pre-check as a quick form-level signal before the backend's real validation runs.
  const nationalIdLooksValid = /^[23]\d{13}$/.test(nationalId.trim());
  const pct = typeof ownershipPercentage === "number" ? ownershipPercentage : -1;
  const canSubmit =
    !!name &&
    (isEdit || (!!nameAr && !!address && nationalIdLooksValid)) &&
    pct > 0 &&
    pct <= 100 &&
    !!equityAccount &&
    (!withContribution || (typeof amount === "number" && amount > 0 && !!paymentAccount));

  return (
    <Modal opened={opened} onClose={close} title={isEdit ? translate("Edit Shareholder", "تعديل المساهم") : translate("Add Shareholder", "إضافة مساهم")} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput label={translate("Full Name (English)", "الاسم بالكامل (إنجليزي)")} value={name} onChange={(e) => setName(e.target.value)} required />
          <TextInput label={translate("Full Name (Arabic)", "الاسم بالكامل (عربي)")} value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" required={!isEdit} />
        </div>
        <TextInput label={translate("Address", "العنوان")} value={address} onChange={(e) => setAddress(e.target.value)} required={!isEdit} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberInput
            label={translate("Ownership %", "نسبة الملكية %")}
            description={translate("Active shareholders together cannot exceed 100%", "لا يتجاوز مجموع المساهمين النشطين 100%")}
            value={ownershipPercentage}
            onChange={setOwnershipPercentage}
            min={0}
            max={100}
            decimalScale={4}
            required
          />
          <Select
            label={translate("Status", "الحالة")}
            value={status}
            onChange={(v) => v && setStatus(v as ShareholderStatus)}
            data={[
              { value: "active", label: translate("Active", "نشط") },
              { value: "inactive", label: translate("Inactive", "غير نشط") },
            ]}
          />
        </div>
        <Select
          label={translate("Equity Account", "حساب حقوق الملكية")}
          placeholder={translate("Select account", "اختر الحساب")}
          value={equityAccount || null}
          onChange={(v) => setEquityAccount(v || "")}
          data={equityAccounts.map((a) => ({ value: a._id, label: `${a.code} - ${a.name}` }))}
          nothingFoundMessage={translate("No equity accounts in the Chart of Accounts", "لا توجد حسابات حقوق ملكية في دليل الحسابات")}
          searchable
          required
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextInput label={translate("Phone", "الهاتف")} value={phone} onChange={(e) => setPhone(e.target.value)} />
          <TextInput label={translate("Email", "البريد الإلكتروني")} value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextInput
            label={translate("National ID", "الرقم القومي")}
            value={nationalId}
            onChange={(e) => setNationalId(e.target.value)}
            error={nationalId && !nationalIdLooksValid ? translate("Must be a 14-digit Egyptian National ID", "يجب أن يكون رقمًا قوميًا مصريًا من 14 رقمًا") : undefined}
            required={!isEdit}
          />
        </div>
        <Textarea label={translate("Notes", "ملاحظات")} value={notes} onChange={(e) => setNotes(e.target.value)} autosize minRows={2} />

        {!isEdit && (
          <>
            <Switch label={translate("Record a capital contribution now", "تسجيل مساهمة رأس مال الآن")} checked={withContribution} onChange={(e) => setWithContribution(e.currentTarget.checked)} />
            {withContribution && (
              <>
                <NumberInput label={translate("Contribution Amount", "مبلغ المساهمة")} value={amount} onChange={setAmount} min={0.01} decimalScale={2} thousandSeparator required />
                <PaymentAccountSelect value={paymentAccount} onChange={setPaymentAccount} label={translate("Received Into (Cash / Bank)", "تم الاستلام في (نقدية / بنك)")} required />
                <DateInput label={translate("Date", "التاريخ")} value={date} onChange={setDate} />
              </>
            )}
          </>
        )}

        <Button type="submit" loading={loading} disabled={!canSubmit} mt="md">
          {isEdit ? translate("Save", "حفظ") : translate("Create", "إنشاء")}
        </Button>
      </form>
    </Modal>
  );
}
