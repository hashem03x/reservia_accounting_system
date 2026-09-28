import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Button } from "@mantine/core";
import { useOrder } from "../../../../../../context";

export default function DeliveryModal({ opened, close }: { opened: boolean; close: () => void }) {
  const { translations, language, translate } = useLanguage();

  const { order, setOrder } = useOrder();

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ method: "PUT", url: `sale-orders/${order._id}/deliver` });
      setOrder(res.data);
      close();
    });
  }

  return (
    <Modal opened={opened} onClose={close} title={translate("Mark as Delivered", "تأكيد التوصيل")}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <p>{translate("Are you sure that this order has been delivered?", "هل أنت متأكد أن هذا الطلب قد تم توصيله؟")}</p>

        <div className="flex gap-2">
          <Button variant="light" color="dark" onClick={close} fullWidth>
            {translations.cancel}
          </Button>
          <Button type="submit" loading={loading} fullWidth>
            {translations.confirm}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
