import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Customer } from "@/types/customer";
import { Button, NumberInput } from "@mantine/core";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";

export default function UpdateBalanceModal({
  opened,
  close,
  customer,
  setCustomer,
}: {
  opened: boolean;
  close: () => void;
  customer: Customer;
  setCustomer: (customer: Customer) => void;
}) {
  const { language, translate, translations } = useLanguage();

  const [balance, setBalance] = useState<string | number>(customer.balance);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "PUT",
        url: `customers/${customer._id}`,
        data: { balance },
      });
      setCustomer(res.data);
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => setError(""), 250);
  }

  const title = translate(`Update Balance`, `تحديث الرصيد`);

  const dataChanged = balance !== customer.balance;

  return (
    <Modal opened={opened} onClose={handleClose} title={title}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <NumberInput
            value={balance}
            onChange={(value) => setBalance(value)}
            label={`${translate("Balance", "الرصيد المستحق")} (${translations.currency})`}
            placeholder={`${translate("Enter Balance", "أدخل الرصيد")} (${translations.currency})`}
            description={translate("Only admins can update this field.", "يمكن للمسؤولين فقط تحديث هذا الحقل.")}
            decimalScale={2}
            hideControls
            required
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button type="submit" loading={loading} disabled={balance === "" || !dataChanged} fullWidth>
            {title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
