import { Vendor } from "@/types/vendor";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import DeleteModal from "@/components/ui/delete-modal";
import paths from "@/utils/constants/paths";

export default function DeleteVendorModal({
  opened,
  close,
  vendor,
}: {
  opened: boolean;
  close: () => void;
  vendor: Vendor;
}) {
  const { language, translate } = useLanguage();

  const navigate = useNavigate();

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function deleteVendor() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ method: "DELETE", url: `vendors/${vendor._id}`, language });
      navigate(`/${paths.admin}/${paths.home}/${paths.vendors}`);
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
      title={translate(`Delete Vendor "${vendor.name}"`, `حذف البائع "${vendor.name}"`)}
      subTitle={translate(`Are you sure you want to delete this vendor?`, `هل أنت متأكد أنك تريد حذف هذا البائع؟`)}
      action={deleteVendor}
      loading={loading}
      error={error}
    />
  );
}
