import { Governorate } from "@/types/governorate";
import { useLanguage } from "@/context/LanguageContext";
import { useGovernorates } from "@/context/GovernorateContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import DeleteModal from "@/components/ui/delete-modal";

export default function DeleteGovernorateModal({
  opened,
  close,
  governorateToDelete,
  setGovernorateToDelete,
}: {
  opened: boolean;
  close: () => void;
  governorateToDelete: Governorate | null;
  setGovernorateToDelete: React.Dispatch<React.SetStateAction<Governorate | null>>;
}) {
  const { language, translate } = useLanguage();

  const { setData: setGovernorates } = useGovernorates();

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function deleteGovernorate() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ method: "DELETE", url: `governorates/${governorateToDelete?._id}`, language });
      setGovernorates((prev) => prev.filter((governorate) => governorate._id !== governorateToDelete?._id));
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setGovernorateToDelete(null);
      setError("");
    }, 250);
  }

  return (
    <DeleteModal
      opened={opened}
      onClose={handleClose}
      title={translate(
        `Delete Governorate "${governorateToDelete?.name.en}"`,
        `حذف المحافظة "${governorateToDelete?.name.ar}"`,
      )}
      subTitle={translate(`Are you sure you want to delete this governorate?`, `هل أنت متأكد أنك تريد حذف هذه المحافظة؟`)}
      action={deleteGovernorate}
      loading={loading}
      error={error}
    />
  );
}
