import { Customer } from "@/types/customer";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import DeleteModal from "@/components/ui/delete-modal";
import paths from "@/utils/constants/paths";

export default function DeleteCustomerModal({
  opened,
  close,
  customer,
}: {
  opened: boolean;
  close: () => void;
  customer: Customer;
}) {
  const { language, translate } = useLanguage();

  const navigate = useNavigate();

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function deleteCustomer() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ method: "DELETE", url: `customers/${customer._id}`, language });
      navigate(`/${paths.admin}/${paths.home}/${paths.customers}`);
    });
  }

  function handleClose() {
    close();
    setTimeout(() => setError(""), 250);
  }

  return (
    <DeleteModal
      opened={opened}
      onClose={handleClose}
      title={translate(`Delete Customer "${customer.name}"`, `حذف العميل "${customer.name}"`)}
      subTitle={translate(`Are you sure you want to delete this customer?`, `هل أنت متأكد أنك تريد حذف هذا العميل؟`)}
      action={deleteCustomer}
      loading={loading}
      error={error}
    />
  );
}
