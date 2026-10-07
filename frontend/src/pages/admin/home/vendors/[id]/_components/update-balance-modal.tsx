import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Vendor } from "@/types/vendor";
import { Button, NumberInput } from "@mantine/core";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";

export default function UpdateBalanceModal({
  opened,
  close,
  vendor,
  setVendor,
}: {
  opened: boolean;
  close: () => void;
  vendor: Vendor;
  setVendor: (vendor: Vendor) => void;
}) {
  const { language, translate, translations } = useLanguage();

  const [balance, setBalance] = useState<string | number>(vendor.balance);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "PUT",
        url: `vendors/${vendor._id}`,
        data: { balance },
      });
      setVendor(res.data);
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => setError(""), 250);
  }

  const title = translate(`Update Balance`, `تحديث الرصيد`);

  const dataChanged = balance !== vendor.balance;

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
